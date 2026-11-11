"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatBytes } from "@/lib/expansion/format";
import { buttonClass } from "./ui";

interface Job {
  key: string;
  name: string;
  size: number;
  sent: number;
  error?: string;
  done?: boolean;
}

type Plan =
  | { uploadId: string; mode: "local"; chunkBytes: number }
  | { uploadId: string; mode: "s3"; partBytes: number; partCount: number }
  | { uploadId: string; mode: "supabase"; url: string; mime: string };

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body as T;
}

/** PUT with upload progress (fetch can't report it). Resolves with the response's ETag header. */
function put(
  url: string,
  body: Blob | FormData,
  onProgress: (loaded: number) => void,
  withCredentials: boolean,
  headers: Record<string, string> = {},
): Promise<{ status: number; etag: string | null; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = withCredentials;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, etag: xhr.getResponseHeader("ETag"), text: xhr.responseText });
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(body);
  });
}

async function retry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
    }
  }
}

/**
 * Uploads one file of any size. Large files are sent in pieces — straight
 * to the storage bucket (3 at a time) or to the server — and each piece is
 * retried if the connection drops, so a long video survives a flaky network.
 */
async function uploadFile(
  target: { propertyId: number; category: string; ownerId?: number },
  file: File,
  onProgress: (sent: number) => void,
): Promise<void> {
  const plan = await json<Plan>(
    await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...target, name: file.name, mime: file.type, size: file.size }),
    }),
  );
  try {
    if (plan.mode === "supabase") {
      // One signed request straight to Supabase Storage, in the same form
      // supabase-js's uploadToSignedUrl() sends (no key needed).
      await retry(async () => {
        const form = new FormData();
        form.append("cacheControl", "3600");
        form.append("", new File([file], file.name, { type: plan.mime }));
        const r = await put(plan.url, form, onProgress, false, { "x-upsert": "false" });
        if (r.status >= 400) {
          const message = (() => {
            try {
              return JSON.parse(r.text).message as string;
            } catch {
              return "";
            }
          })();
          throw new Error(message ? `Storage refused the file: ${message}` : `Storage refused the file (${r.status}).`);
        }
      }, 3);
      onProgress(file.size);
      await json(await fetch(`/api/uploads/${plan.uploadId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
      return;
    }
    if (plan.mode === "local") {
      let offset = 0;
      while (offset < file.size) {
        const chunk = file.slice(offset, offset + plan.chunkBytes);
        const start = offset;
        offset = await retry(async () => {
          const r = await put(`/api/uploads/${plan.uploadId}?offset=${start}`, chunk, (n) => onProgress(start + n), true);
          if (r.status >= 400) throw new Error(JSON.parse(r.text || "{}").error ?? `Upload failed (${r.status}).`);
          return JSON.parse(r.text).received as number;
        });
        onProgress(offset);
      }
      await json(await fetch(`/api/uploads/${plan.uploadId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
      return;
    }

    // Bucket: sign parts in batches, send up to 3 at once.
    const sent = new Map<number, number>();
    const report = () => onProgress([...sent.values()].reduce((a, b) => a + b, 0));
    const etags: { partNumber: number; etag: string }[] = [];
    const queue = Array.from({ length: plan.partCount }, (_, i) => i + 1);
    const worker = async () => {
      for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
        const part = n;
        const blob = file.slice((part - 1) * plan.partBytes, part * plan.partBytes);
        const etag = await retry(async () => {
          const { urls } = await json<{ urls: Record<number, string> }>(
            await fetch(`/api/uploads/${plan.uploadId}/parts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts: [part] }) }),
          );
          const r = await put(urls[part], blob, (x) => {
            sent.set(part, x);
            report();
          }, false);
          if (r.status >= 400 || !r.etag) {
            throw new Error(r.status >= 400 ? `Storage refused part ${part} (${r.status}).` : "The storage bucket's CORS settings must expose the ETag header.");
          }
          return r.etag;
        });
        sent.set(part, blob.size);
        report();
        etags.push({ partNumber: part, etag });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await json(
      await fetch(`/api/uploads/${plan.uploadId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parts: etags }) }),
    );
  } catch (error) {
    fetch(`/api/uploads/${plan.uploadId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export default function FileUploader({
  propertyId,
  category,
  ownerId,
  accept,
  multiple = true,
  label = "Choose files",
  hint,
  compact = false,
}: {
  propertyId: number;
  category: string;
  ownerId?: number;
  accept: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = jobs.some((j) => !j.done && !j.error);

  const update = (key: string, patch: Partial<Job>) => setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  async function start(files: FileList | File[]) {
    const list = Array.from(files).slice(0, multiple ? undefined : 1);
    if (list.length === 0) return;
    const batch = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, sent: 0 }));
    setJobs((prev) => [...prev.filter((j) => !j.done), ...batch]);
    for (let i = 0; i < list.length; i++) {
      const job = batch[i];
      try {
        await uploadFile({ propertyId, category, ownerId }, list[i], (sent) => update(job.key, { sent }));
        update(job.key, { done: true, sent: job.size });
        router.refresh();
      } catch (error) {
        update(job.key, { error: (error as Error).message });
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      className="hidden"
      data-category={category}
      data-owner={ownerId}
      onChange={(e) => e.target.files && start(e.target.files)}
    />
  );

  return (
    <div className="space-y-2">
      {compact ? (
        <div className="flex items-center gap-2">
          <button type="button" className={`${buttonClass.secondary} px-3 py-1.5`} onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : label}
          </button>
          {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
          {input}
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            start(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-7 text-center text-sm transition-colors ${
            dragging ? "border-sky-400 bg-sky-50" : "border-slate-300 bg-slate-50/60"
          }`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-8 w-8 text-sky-500" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-slate-600">Drag files here, or</p>
          <button type="button" className={buttonClass.secondary} onClick={() => inputRef.current?.click()} disabled={busy}>
            {label}
          </button>
          {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
          {input}
        </div>
      )}
      {jobs.length > 0 ? (
        <ul className="space-y-1.5">
          {jobs.map((j) => {
            const pct = j.size ? Math.min(100, Math.round((j.sent / j.size) * 100)) : 100;
            return (
              <li key={j.key} className="text-xs">
                <div className="flex justify-between gap-3">
                  <span className="truncate text-slate-700">{j.name}</span>
                  <span className={j.error ? "text-rose-600" : "text-slate-500"}>
                    {j.error ? "Failed" : j.done ? "Uploaded" : `${pct}% · ${formatBytes(j.sent)} of ${formatBytes(j.size)}`}
                  </span>
                </div>
                {j.error ? (
                  <p className="text-rose-600">{j.error}</p>
                ) : (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className={`h-full rounded-full ${j.done ? "bg-emerald-500" : "bg-sky-500"} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
