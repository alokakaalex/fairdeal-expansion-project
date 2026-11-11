import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config";
import { adminClient } from "./supabase";

// Where file bytes live.
//
// - "s3": an S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2…).
//   Browsers upload straight to the bucket in parts using short-lived
//   signed URLs, so there is no size limit and big videos never pass
//   through the app server. Downloads redirect to signed URLs.
// - "supabase": a private Supabase Storage bucket. The server checks who may
//   upload, then hands the browser a one-time signed upload URL; downloads
//   redirect to signed URLs that expire in minutes. Each file is capped by
//   the Supabase plan (SUPABASE_MAX_FILE_MB).
// - "local": a folder on the server (DATA_DIR/uploads). Browsers send files
//   in chunks the server appends, so again any size works.
//
// Nothing here deletes a stored file except to discard an upload that
// failed its checks before it was ever recorded.

export type StorageKind = "local" | "s3" | "supabase";

export function storageKind(): StorageKind {
  if (config.storageProvider === "s3" && config.s3) return "s3";
  if (config.storageProvider === "supabase" && config.supabase) return "supabase";
  return "local";
}

// --- Supabase Storage ---------------------------------------------------------------

function bucket() {
  return adminClient().storage.from(config.supabase!.bucket);
}

let bucketChecked = false;

/**
 * Creates the bucket if it's missing and makes sure it is private, with the
 * per-file size cap. Best effort: returns a problem description, or null.
 */
export async function ensureSupabaseBucket(): Promise<string | null> {
  if (bucketChecked || !config.supabase) return null;
  const { bucket: name, maxFileBytes } = config.supabase;
  const storageApi = adminClient().storage;
  try {
    const { data, error } = await storageApi.getBucket(name);
    if (error || !data) {
      const created = await storageApi.createBucket(name, { public: false, fileSizeLimit: maxFileBytes });
      if (created.error) return `Couldn't create the "${name}" bucket: ${created.error.message}`;
    } else if (data.public || data.file_size_limit !== maxFileBytes) {
      const updated = await storageApi.updateBucket(name, { public: false, fileSizeLimit: maxFileBytes });
      if (updated.error) return `Couldn't make the "${name}" bucket private: ${updated.error.message}`;
    }
    bucketChecked = true;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A one-time URL the browser uploads one file to (valid for about two hours). */
export async function signSupabaseUpload(key: string): Promise<string> {
  const problem = await ensureSupabaseBucket();
  if (problem) throw new Error(problem);
  const { data, error } = await bucket().createSignedUploadUrl(key);
  if (error || !data) throw new Error(`Supabase Storage refused the upload: ${error?.message ?? "no URL returned"}`);
  return data.signedUrl;
}

async function supabaseSignedUrl(key: string, seconds: number, download: string | false = false): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(key, seconds, { download });
  if (error || !data) throw new Error(`Supabase Storage couldn't sign a link: ${error?.message ?? "no URL returned"}`);
  return data.signedUrl;
}

let client: S3Client | null = null;

function s3(): S3Client {
  const c = config.s3;
  if (!c) throw new Error("S3 storage is not configured");
  client ??= new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    forcePathStyle: c.forcePathStyle,
    credentials: c.accessKeyId ? { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } : undefined,
  });
  return client;
}

function objectKey(key: string) {
  return `${config.s3!.prefix}/${key}`;
}

const KEY = /^(\d+\/[0-9a-f-]{36}|backups\/[\w.-]+)$/;

export function localPath(key: string): string {
  // Keys are generated server-side; refuse anything else (no path traversal).
  if (!KEY.test(key)) throw new Error(`Invalid storage key: ${key}`);
  return key.startsWith("backups/") ? path.join(config.backupsDir, key.slice(8)) : path.join(config.uploadsDir, key);
}

// --- Multipart uploads (bucket) ------------------------------------------------

const MIN_PART = 8 * 1024 * 1024;

/** Part size for a file: at least 8 MB, and large enough to stay under S3's 10,000-part limit. */
export function partSizeFor(size: number): number {
  return Math.max(MIN_PART, Math.ceil(size / 9_000 / (1024 * 1024)) * 1024 * 1024);
}

let corsDone = false;

/** Lets browsers on the app's origin PUT parts and read the ETag header. Best effort. */
export async function ensureBucketCors(): Promise<string | null> {
  if (corsDone || !config.s3) return null;
  try {
    await s3().send(
      new PutBucketCorsCommand({
        Bucket: config.s3.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [config.appUrl],
              AllowedMethods: ["PUT", "GET", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    corsDone = true;
    return null;
  } catch (error) {
    // The bucket's CORS may already be set by hand, or the key may lack permission.
    corsDone = true;
    return error instanceof Error ? error.message : String(error);
  }
}

export async function startMultipart(key: string, mime: string): Promise<string> {
  await ensureBucketCors();
  const r = await s3().send(new CreateMultipartUploadCommand({ Bucket: config.s3!.bucket, Key: objectKey(key), ContentType: mime }));
  return r.UploadId!;
}

export async function signPart(key: string, uploadId: string, partNumber: number): Promise<string> {
  return getSignedUrl(s3(), new UploadPartCommand({ Bucket: config.s3!.bucket, Key: objectKey(key), UploadId: uploadId, PartNumber: partNumber }), {
    expiresIn: 3600,
  });
}

export async function completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
  await s3().send(
    new CompleteMultipartUploadCommand({
      Bucket: config.s3!.bucket,
      Key: objectKey(key),
      UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  );
}

export async function abortMultipart(key: string, uploadId: string) {
  await s3()
    .send(new AbortMultipartUploadCommand({ Bucket: config.s3!.bucket, Key: objectKey(key), UploadId: uploadId }))
    .catch(() => {});
}

// --- Chunked uploads (local) -----------------------------------------------------

/** Appends a chunk to a local upload in progress; returns the new length. */
export async function appendLocal(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  const file = `${localPath(key)}.part`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = fs.createWriteStream(file, { flags: "a" });
  let written = 0;
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      written += value.byteLength;
      if (written > maxBytes) {
        await reader.cancel();
        throw new Error("Chunk too large");
      }
      if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
  return fs.statSync(file).size;
}

/** Truncates a local upload back to `length` (after a failed chunk). */
export function truncateLocal(key: string, length: number) {
  const file = `${localPath(key)}.part`;
  if (fs.existsSync(file)) fs.truncateSync(file, length);
}

export function finishLocal(key: string) {
  const file = localPath(key);
  const fd = fs.openSync(`${file}.part`, "r");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(`${file}.part`, file);
}

export function discardLocal(key: string) {
  fs.rmSync(`${localPath(key)}.part`, { force: true });
}

// --- Reading & small writes ---------------------------------------------------------

export async function stat(kind: StorageKind, key: string): Promise<{ size: number; etag: string | null } | null> {
  if (kind === "local") {
    try {
      return { size: fs.statSync(localPath(key)).size, etag: null };
    } catch {
      return null;
    }
  }
  if (kind === "supabase") {
    const { data, error } = await bucket().info(key);
    if (error || !data || typeof data.size !== "number") return null;
    return { size: data.size, etag: data.etag?.replace(/"/g, "") ?? null };
  }
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: config.s3!.bucket, Key: objectKey(key) }));
    return { size: r.ContentLength ?? 0, etag: r.ETag?.replace(/"/g, "") ?? null };
  } catch {
    return null;
  }
}

/** The first bytes of a stored file (to check its real type). */
export async function readHead(kind: StorageKind, key: string, bytes = 16): Promise<Uint8Array> {
  if (kind === "local") {
    const fd = fs.openSync(localPath(key), "r");
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n);
  }
  if (kind === "supabase") {
    const res = await fetch(await supabaseSignedUrl(key, 60), { headers: { Range: `bytes=0-${bytes - 1}` } });
    if (!res.ok) throw new Error(`Couldn't read the stored file (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer()).subarray(0, bytes);
  }
  const r = await s3().send(new GetObjectCommand({ Bucket: config.s3!.bucket, Key: objectKey(key), Range: `bytes=0-${bytes - 1}` }));
  return new Uint8Array(await r.Body!.transformToByteArray());
}

export function readLocalStream(key: string, range?: { start: number; end: number }) {
  return fs.createReadStream(localPath(key), range);
}

/** A short-lived link to download (or show) a bucket file. */
export async function signedDownloadUrl(kind: StorageKind, key: string, filename: string, mime: string, download: boolean): Promise<string> {
  if (kind === "supabase") return supabaseSignedUrl(key, 600, download ? filename : false);
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: config.s3!.bucket,
      Key: objectKey(key),
      ResponseContentType: mime,
      ResponseContentDisposition: `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    }),
    { expiresIn: 600 },
  );
}

/** Writes a small file in one go (demo seed data, backups). */
export async function putBytes(kind: StorageKind, key: string, bytes: Uint8Array, mime: string) {
  if (kind === "local") {
    const file = localPath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return;
  }
  if (kind === "supabase") {
    const problem = await ensureSupabaseBucket();
    if (problem) throw new Error(problem);
    const { error } = await bucket().upload(key, bytes, { contentType: mime, upsert: false });
    if (error) throw new Error(`Supabase Storage refused the file: ${error.message}`);
    return;
  }
  await s3().send(new PutObjectCommand({ Bucket: config.s3!.bucket, Key: objectKey(key), Body: bytes, ContentType: mime }));
}

/** Full contents as a stream (integrity checks). */
export async function readStream(kind: StorageKind, key: string): Promise<Readable> {
  if (kind === "local") return fs.createReadStream(localPath(key));
  if (kind === "supabase") {
    const { data, error } = await bucket().download(key);
    if (error || !data) throw new Error(`Couldn't read the stored file: ${error?.message ?? "missing"}`);
    return Readable.from(Buffer.from(await data.arrayBuffer()));
  }
  const r = await s3().send(new GetObjectCommand({ Bucket: config.s3!.bucket, Key: objectKey(key) }));
  return r.Body as Readable;
}

/** Discards a file that failed validation before it was recorded. */
export async function discard(kind: StorageKind, key: string) {
  if (kind === "local") {
    fs.rmSync(localPath(key), { force: true });
    discardLocal(key);
    return;
  }
  if (kind === "supabase") {
    await bucket()
      .remove([key])
      .catch(() => {});
    return;
  }
  await s3()
    .send(new DeleteObjectCommand({ Bucket: config.s3!.bucket, Key: objectKey(key) }))
    .catch(() => {});
}
