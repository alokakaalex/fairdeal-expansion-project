import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { StoredFile, User } from "@/lib/expansion/types";
import { CATEGORY_INFO, FILE_CATEGORIES, isEditable, stageIndex, type FileCategory, type Stage } from "@/lib/expansion/workflow";
import { audit } from "./audit";
import { config } from "./config";
import { all, now, one, run, tx } from "./db";
import { canAccess, canSeeFile, propertyRow, PropertyError, type FileRow, type PropertyRow } from "./properties";
import * as storage from "./storage";

// Uploads of any size. The browser first asks to start an upload (we check
// the person may add this kind of file here, and that the type is allowed),
// then sends the bytes — straight to the bucket in parts, or to the server
// in chunks — and finally asks to complete it. Only then do we check the
// file's real contents match its type and record it. Files are never
// deleted; removing or replacing one archives it.

type Kind = StoredFile["kind"];

const MEDIA_TYPES: Record<string, Kind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
  "image/heic": "image",
  "image/heif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "video/x-matroska": "video",
  "video/3gpp": "video",
};

const DOCUMENT_TYPES: Record<string, Kind> = {
  "application/pdf": "pdf",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/heic": "image",
  "image/heif": "image",
};

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const WORD_ALLOWED: FileCategory[] = ["loi", "signed_loi", "agreement", "other_document"];

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
  pdf: "application/pdf",
  docx: WORD,
};

export function allowedTypes(category: FileCategory): Record<string, Kind> {
  if (CATEGORY_INFO[category].kind === "media") return MEDIA_TYPES;
  return WORD_ALLOWED.includes(category) ? { ...DOCUMENT_TYPES, [WORD]: "doc" } : DOCUMENT_TYPES;
}

export function acceptAttribute(category: FileCategory): string {
  const types = Object.keys(allowedTypes(category));
  const exts = Object.entries(EXTENSION_TYPES)
    .filter(([, t]) => types.includes(t))
    .map(([e]) => `.${e}`);
  return [...types, ...exts].join(",");
}

/** The declared type, falling back to the file extension (phones often send no type for HEIC/MOV). */
function resolveMime(mime: string, name: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m && m !== "application/octet-stream") return m;
  return EXTENSION_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? m;
}

/** Checks the file's leading bytes match its declared type, so a script can't be uploaded as "image/png". */
export function matchesSignature(mime: string, head: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...head.slice(start, end));
  switch (mime) {
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return head[0] === 0x89 && ascii(1, 4) === "PNG";
    case "image/gif":
      return ascii(0, 4) === "GIF8";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/avif":
    case "image/heic":
    case "image/heif":
    case "video/mp4":
    case "video/quicktime":
    case "video/3gpp":
      return ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(ascii(4, 8));
    case "video/webm":
    case "video/x-matroska":
      return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    case "application/pdf":
      return ascii(0, 5) === "%PDF-";
    case WORD:
      return ascii(0, 4) === "PK\x03\x04";
    default:
      return false;
  }
}

// --- Permissions ---------------------------------------------------------------

async function hasOpenStampRequest(propertyId: number): Promise<boolean> {
  return Boolean(await one("SELECT 1 FROM payments WHERE property_id = ? AND kind = 'stamp_duty' AND status = 'requested'", propertyId));
}

/** Whether this viewer may add (or archive) a file of this category on this property right now. */
export async function canUpload(viewer: User, row: PropertyRow, category: FileCategory): Promise<boolean> {
  if (!CATEGORY_INFO[category].uploaders.includes(viewer.role)) return false;
  if (!canAccess(viewer, row)) return false;
  const at = (stage: Stage) => row.stage === stage && row.state === "active";
  const reached = (stage: Stage) => row.furthest_stage >= stageIndex(stage);
  switch (category) {
    case "property_media":
      return isEditable(row.state) && row.created_by === viewer.id;
    case "ops_media":
      return at("ops_review");
    case "loi":
      return at("loi") || at("signed_loi");
    case "signed_loi":
      return at("signed_loi");
    case "agreement":
      return at("agreement");
    case "stamp_duty_calculation":
      return reached("token_payment");
    case "token_receipt":
      return at("token_payment");
    case "balance_receipt":
      return at("balance_payment");
    case "stamp_duty_receipt":
      return hasOpenStampRequest(row.id);
    default:
      // Owner KYC and property documents: from the documents stage onward.
      return reached("documents") && row.state !== "rejected" && row.created_by === viewer.id;
  }
}

/** Every category this viewer may upload right now (for the page to decide which upload buttons to show). */
export async function uploadPermissions(viewer: User, row: PropertyRow): Promise<Record<FileCategory, boolean>> {
  const entries = await Promise.all(FILE_CATEGORIES.map(async (c) => [c, await canUpload(viewer, row, c)] as const));
  return Object.fromEntries(entries) as Record<FileCategory, boolean>;
}

// --- Upload sessions -----------------------------------------------------------------

interface UploadRow {
  id: string;
  property_id: number;
  owner_id: number | null;
  category: FileCategory;
  mime: string;
  original_name: string;
  size_bytes: number;
  part_size: number;
  storage: storage.StorageKind;
  storage_key: string;
  multipart_id: string | null;
  received_bytes: number;
  user_id: string;
  completed_at: string | null;
}

export interface BeginUpload {
  propertyId: number;
  category: FileCategory;
  ownerId: number | null;
  name: string;
  mime: string;
  size: number;
}

export type UploadPlan =
  | { uploadId: string; mode: "local"; chunkBytes: number }
  | { uploadId: string; mode: "s3"; partBytes: number; partCount: number }
  | { uploadId: string; mode: "supabase"; url: string; mime: string };

async function checkTarget(viewer: User, propertyId: number, category: FileCategory, ownerId: number | null) {
  const info = CATEGORY_INFO[category];
  const row = await propertyRow(propertyId);
  if (!row || !canAccess(viewer, row)) throw new PropertyError("Property not found.");
  if (!(await canUpload(viewer, row, category))) throw new PropertyError(`You can't upload a ${info.label.toLowerCase()} at this stage.`);
  if (info.perOwner) {
    const owner = ownerId ? await one("SELECT id FROM owners WHERE id = ? AND property_id = ? AND archived_at IS NULL", ownerId, propertyId) : undefined;
    if (!owner) throw new PropertyError("Choose which owner this document belongs to.");
    return ownerId;
  }
  return null;
}

function checkType(category: FileCategory, mimeRaw: string, name: string): { mime: string; kind: Kind } {
  const mime = resolveMime(mimeRaw, name);
  const kind = allowedTypes(category)[mime];
  if (!kind) {
    throw new PropertyError(
      CATEGORY_INFO[category].kind === "media"
        ? "Only photos (JPEG, PNG, WebP, GIF, AVIF, HEIC) and videos (MP4, MOV, WebM, MKV, 3GP) can be uploaded here."
        : `Only PDF or image files${WORD_ALLOWED.includes(category) ? " (or Word .docx)" : ""} can be uploaded here.`,
    );
  }
  return { mime, kind };
}

/** On a host with no lasting disk, files must go to the bucket or they'd be lost. */
function requireDurableStorage() {
  if (config.serverless && !config.demoMode && storage.storageKind() === "local") {
    throw new PropertyError(
      "File storage isn't set up yet, so uploads are paused to avoid losing files. Ask your access manager to add the Supabase (or S3/R2) settings.",
    );
  }
}

export async function beginUpload(viewer: User, input: BeginUpload): Promise<UploadPlan> {
  requireDurableStorage();
  const ownerId = await checkTarget(viewer, input.propertyId, input.category, input.ownerId);
  const { mime } = checkType(input.category, input.mime, input.name);
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new PropertyError("The file is empty.");
  const count = (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM files WHERE property_id = ?", input.propertyId))!.n;
  if (count >= config.maxFilesPerProperty) throw new PropertyError("This property has reached its file limit.");

  const kind = storage.storageKind();
  if (kind === "supabase" && input.size > config.supabase!.maxFileBytes) {
    const mb = Math.round(config.supabase!.maxFileBytes / (1024 * 1024));
    throw new PropertyError(
      `This file is larger than the ${mb} MB per-file limit of the storage plan. Compress the video or split it, or ask your access manager to raise the limit.`,
    );
  }

  const id = randomUUID();
  const key = `${input.propertyId}/${id}`;
  const partSize = kind === "s3" ? storage.partSizeFor(input.size) : kind === "supabase" ? input.size : config.chunkBytes;
  const multipartId = kind === "s3" ? await storage.startMultipart(key, mime) : null;
  await run(
    `INSERT INTO uploads (id, property_id, owner_id, category, mime, original_name, size_bytes, part_size, storage, storage_key, multipart_id, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.propertyId,
    ownerId,
    input.category,
    mime,
    input.name.slice(0, 255) || "upload",
    input.size,
    partSize,
    kind,
    key,
    multipartId,
    viewer.id,
    now(),
  );
  if (kind === "supabase") return { uploadId: id, mode: "supabase", url: await storage.signSupabaseUpload(key), mime };
  return kind === "s3"
    ? { uploadId: id, mode: "s3", partBytes: partSize, partCount: Math.ceil(input.size / partSize) }
    : { uploadId: id, mode: "local", chunkBytes: partSize };
}

async function ownUpload(viewer: User, uploadId: string): Promise<UploadRow> {
  const u = await one<UploadRow>("SELECT * FROM uploads WHERE id = ?", uploadId);
  if (!u || u.user_id !== viewer.id) throw new PropertyError("Upload not found. Please start again.");
  if (u.completed_at) throw new PropertyError("This upload has already finished.");
  return u;
}

/** Local storage: appends one chunk at `offset`. Returns the bytes received so far. */
export async function uploadChunk(viewer: User, uploadId: string, offset: number, body: ReadableStream<Uint8Array>): Promise<number> {
  const u = await ownUpload(viewer, uploadId);
  if (u.storage !== "local") throw new PropertyError("This upload goes straight to storage.");
  // A retried chunk the server already has: report where we are.
  if (offset !== u.received_bytes) return u.received_bytes;
  let received: number;
  try {
    received = await storage.appendLocal(u.storage_key, body, u.part_size);
  } catch {
    storage.truncateLocal(u.storage_key, u.received_bytes);
    throw new PropertyError("Part of the file didn't arrive. It will be retried.");
  }
  if (received > u.size_bytes) {
    storage.truncateLocal(u.storage_key, u.received_bytes);
    throw new PropertyError("More data arrived than the file's size.");
  }
  await run("UPDATE uploads SET received_bytes = ? WHERE id = ?", received, uploadId);
  return received;
}

/** Bucket storage: signed URLs the browser PUTs each part to. */
export async function signParts(viewer: User, uploadId: string, partNumbers: number[]): Promise<Record<number, string>> {
  const u = await ownUpload(viewer, uploadId);
  if (u.storage !== "s3" || !u.multipart_id) throw new PropertyError("This upload goes through the server.");
  const max = Math.ceil(u.size_bytes / u.part_size);
  const urls: Record<number, string> = {};
  for (const n of partNumbers.slice(0, 50)) {
    if (!Number.isInteger(n) || n < 1 || n > max) throw new PropertyError("Invalid part.");
    urls[n] = await storage.signPart(u.storage_key, u.multipart_id, n);
  }
  return urls;
}

export async function abortUpload(viewer: User, uploadId: string) {
  const u = await ownUpload(viewer, uploadId).catch(() => null);
  if (!u) return;
  if (u.storage === "s3" && u.multipart_id) await storage.abortMultipart(u.storage_key, u.multipart_id);
  else if (u.storage === "supabase") await storage.discard("supabase", u.storage_key);
  else storage.discardLocal(u.storage_key);
  await run("UPDATE uploads SET completed_at = ? WHERE id = ?", `aborted ${now()}`, uploadId);
}

async function sha256Of(kind: storage.StorageKind, key: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = await storage.readStream(kind, key);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Checks the stored bytes and records the file. */
export async function completeUpload(viewer: User, uploadId: string, parts?: { partNumber: number; etag: string }[]): Promise<{ id: string }> {
  const u = await ownUpload(viewer, uploadId);
  if (u.storage === "s3") {
    if (!parts?.length) throw new PropertyError("No parts were uploaded.");
    await storage.completeMultipart(u.storage_key, u.multipart_id!, parts);
  } else if (u.storage === "local") {
    if (u.received_bytes !== u.size_bytes) throw new PropertyError("The upload is incomplete. Please try again.");
    storage.finishLocal(u.storage_key);
  }
  const info = await storage.stat(u.storage, u.storage_key);
  const head = info ? await storage.readHead(u.storage, u.storage_key) : new Uint8Array();
  const problem = !info
    ? "The file didn't arrive. Please try again."
    : info.size !== u.size_bytes
      ? "The file arrived incomplete. Please try again."
      : !matchesSignature(u.mime, head)
        ? "The file's contents don't match its type."
        : null;
  if (problem) {
    await storage.discard(u.storage, u.storage_key);
    await run("UPDATE uploads SET completed_at = ? WHERE id = ?", `rejected ${now()}`, uploadId);
    throw new PropertyError(problem);
  }
  // Fingerprint files on the server's disk; bucket files carry the bucket's ETag.
  const sha = u.storage === "local" ? await sha256Of("local", u.storage_key) : null;
  const id = u.storage_key.split("/")[1];
  await record(viewer, u.property_id, {
    id,
    category: u.category,
    ownerId: u.owner_id,
    mime: u.mime,
    name: u.original_name,
    size: u.size_bytes,
    sha256: sha,
    etag: info!.etag,
    storage: u.storage,
    key: u.storage_key,
  });
  await run("UPDATE uploads SET completed_at = ? WHERE id = ?", now(), uploadId);
  return { id };
}

async function record(
  viewer: User,
  propertyId: number,
  f: { id: string; category: FileCategory; ownerId: number | null; mime: string; name: string; size: number; sha256: string | null; etag: string | null; storage: storage.StorageKind; key: string },
) {
  const { kind } = checkType(f.category, f.mime, f.name);
  await tx(async () => {
    // Re-check: the property may have moved to another stage while the file was uploading.
    const row = await propertyRow(propertyId);
    if (!row || !(await canUpload(viewer, row, f.category))) {
      throw new PropertyError("This property moved to another stage while you were uploading.");
    }
    await run(
      `INSERT INTO files (id, property_id, owner_id, category, kind, mime, original_name, size_bytes, sha256, etag, storage, storage_key, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.id,
      propertyId,
      f.ownerId,
      f.category,
      kind,
      f.mime,
      f.name,
      f.size,
      f.sha256,
      f.etag,
      f.storage,
      f.key,
      viewer.id,
      now(),
    );
    await run("UPDATE properties SET updated_at = ? WHERE id = ?", now(), propertyId);
    await audit({ actorId: viewer.id, action: "file.added", propertyId, details: `${CATEGORY_INFO[f.category].label}: ${f.name}` });
  });
}

/** Stores a small file in one step (demo data and tests). Same checks as a browser upload. */
export async function storeBytes(
  viewer: User,
  propertyId: number,
  input: { category: FileCategory; ownerId?: number | null; mime: string; name: string; bytes: Uint8Array; fileId?: string },
): Promise<{ id: string }> {
  requireDurableStorage();
  const ownerId = await checkTarget(viewer, propertyId, input.category, input.ownerId ?? null);
  const { mime } = checkType(input.category, input.mime, input.name);
  if (input.bytes.length === 0) throw new PropertyError("The file is empty.");
  if (!matchesSignature(mime, input.bytes.subarray(0, 16))) throw new PropertyError("The file's contents don't match its type.");
  const id = input.fileId ?? randomUUID();
  const kind = storage.storageKind();
  const key = `${propertyId}/${id}`;
  await storage.putBytes(kind, key, input.bytes, mime);
  const info = await storage.stat(kind, key);
  await record(viewer, propertyId, {
    id,
    category: input.category,
    ownerId,
    mime,
    name: input.name,
    size: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    etag: info?.etag ?? null,
    storage: kind,
    key,
  });
  return { id };
}

// --- Viewing, archiving -----------------------------------------------------------------

async function fileRow(id: string): Promise<FileRow | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  return one<FileRow>("SELECT f.*, u.name AS uploaded_by_name FROM files f JOIN users u ON u.id = f.uploaded_by WHERE f.id = ?", id);
}

/** Archives a file: it disappears from normal views but is kept in storage and the record. */
export async function archiveFile(viewer: User, fileId: string) {
  await tx(async () => {
    const f = await fileRow(fileId);
    const row = f ? await propertyRow(f.property_id) : undefined;
    if (!f || !row || f.archived_at) throw new PropertyError("File not found.");
    if (f.payment_id) throw new PropertyError("Files attached to a payment record can't be removed.");
    if (!(await canUpload(viewer, row, f.category))) throw new PropertyError("You can't remove this file at this stage.");
    await run("UPDATE files SET archived_at = ?, archived_by = ? WHERE id = ?", now(), viewer.id, fileId);
    await audit({ actorId: viewer.id, action: "file.archived", propertyId: f.property_id, details: `${CATEGORY_INFO[f.category].label}: ${f.original_name}` });
  });
}

/** The file if this viewer may see it. */
export async function viewableFile(viewer: User, fileId: string): Promise<FileRow | null> {
  const f = await fileRow(fileId);
  if (!f || !canSeeFile(viewer.role, f.category)) return null;
  if (f.archived_at && !["admin", "expansion_manager", "founder"].includes(viewer.role)) return null;
  const row = await propertyRow(f.property_id);
  return row && canAccess(viewer, row) ? f : null;
}

/** For emailing a stored file (the LOI): a local path, or a short-lived link the mailer downloads. */
export async function emailAttachment(f: FileRow): Promise<{ filename: string; contentType: string; path?: string; href?: string }> {
  return f.storage === "local"
    ? { filename: f.original_name, contentType: f.mime, path: storage.localPath(f.storage_key) }
    : { filename: f.original_name, contentType: f.mime, href: await storage.signedDownloadUrl(f.storage, f.storage_key, f.original_name, f.mime, true) };
}

/** Re-reads every stored file: disk files are re-hashed, bucket files checked for presence and size. */
export async function verifyFiles(): Promise<{ checked: number; problems: string[] }> {
  const rows = await all<FileRow>("SELECT f.*, '' AS uploaded_by_name FROM files f");
  const problems: string[] = [];
  for (const r of rows) {
    const info = await storage.stat(r.storage, r.storage_key);
    if (!info) problems.push(`${r.original_name} (${r.id}): missing`);
    else if (info.size !== r.size_bytes) problems.push(`${r.original_name} (${r.id}): size changed`);
    else if (r.sha256 && r.storage === "local" && (await sha256Of("local", r.storage_key)) !== r.sha256) {
      problems.push(`${r.original_name} (${r.id}): contents changed`);
    }
  }
  return { checked: rows.length, problems };
}

/** Unattached files of a category (e.g. a receipt uploaded just before marking a payment paid). */
export async function pendingAttachments(propertyId: number, category: FileCategory): Promise<FileRow[]> {
  return all<FileRow>(
    `SELECT f.*, u.name AS uploaded_by_name FROM files f JOIN users u ON u.id = f.uploaded_by
     WHERE f.property_id = ? AND f.category = ? AND f.archived_at IS NULL AND f.payment_id IS NULL ORDER BY f.created_at`,
    propertyId,
    category,
  );
}

export async function attachToPayment(fileIds: string[], paymentId: number) {
  for (const id of fileIds) await run("UPDATE files SET payment_id = ? WHERE id = ?", paymentId, id);
}
