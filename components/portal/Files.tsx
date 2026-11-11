import { formatBytes, formatDateTime } from "@/lib/expansion/format";
import type { StoredFile } from "@/lib/expansion/types";
import { CATEGORY_INFO } from "@/lib/expansion/workflow";
import { RemoveFileButton } from "./Forms";
import { EmptyState } from "./ui";

/** Photo/video grid. */
export function MediaGrid({ files, propertyId, canRemove }: { files: StoredFile[]; propertyId: number; canRemove?: boolean }) {
  const live = files.filter((f) => !f.archivedAt);
  if (live.length === 0) return <EmptyState>No photos or videos yet.</EmptyState>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {live.map((f) => (
        <li key={f.id} className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          {f.kind === "video" ? (
            <video src={`/api/files/${f.id}`} controls preload="metadata" className="aspect-video w-full bg-black" />
          ) : f.mime === "image/heic" || f.mime === "image/heif" ? (
            <a href={`/api/files/${f.id}?download`} className="flex aspect-video items-center justify-center text-xs text-slate-500">
              HEIC photo — download
            </a>
          ) : (
            <a href={`/api/files/${f.id}`} target="_blank" rel="noopener">
              {/* Authenticated file route: next/image's optimizer can't forward the session cookie. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${f.id}`} alt={f.originalName} loading="lazy" className="aspect-video w-full object-cover" />
            </a>
          )}
          <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-500">
            <span className="truncate" title={`${f.originalName} · ${f.uploadedByName} · ${formatDateTime(f.createdAt)}`}>
              {f.uploadedByName} · {formatBytes(f.sizeBytes)}
            </span>
            {canRemove ? <RemoveFileButton propertyId={propertyId} fileId={f.id} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A compact list of documents with view/download links. */
export function DocumentList({
  files,
  propertyId,
  canRemove,
  showCategory = false,
  empty = "Not uploaded yet.",
}: {
  files: StoredFile[];
  propertyId: number;
  canRemove?: boolean;
  showCategory?: boolean;
  empty?: string;
}) {
  const live = files.filter((f) => !f.archivedAt);
  if (live.length === 0) return <p className="text-xs text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-1">
      {live.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
          <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="font-medium text-sky-700 hover:underline">
            {f.kind === "pdf" ? "📄" : f.kind === "doc" ? "📝" : "🖼"} {showCategory ? `${CATEGORY_INFO[f.category].label} — ` : ""}
            {f.originalName}
          </a>
          <span className="text-xs text-slate-500">
            {formatBytes(f.sizeBytes)} · {f.uploadedByName} · {formatDateTime(f.createdAt)}
          </span>
          <a href={`/api/files/${f.id}?download`} className="text-xs text-slate-500 hover:underline">
            Download
          </a>
          {canRemove ? <RemoveFileButton propertyId={propertyId} fileId={f.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Replaced/removed files, kept forever; shown to admins, the expansion manager and the founder. */
export function ArchivedFiles({ files }: { files: StoredFile[] }) {
  const archived = files.filter((f) => f.archivedAt);
  if (archived.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-600">Archived files ({archived.length})</summary>
      <ul className="mt-2 space-y-1">
        {archived.map((f) => (
          <li key={f.id} className="text-slate-600">
            <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="text-sky-700 hover:underline">
              {CATEGORY_INFO[f.category].label}: {f.originalName}
            </a>{" "}
            <span className="text-xs">
              uploaded by {f.uploadedByName} {formatDateTime(f.createdAt)}, archived {formatDateTime(f.archivedAt)} · {f.sha256 ? `sha256 ${f.sha256.slice(0, 12)}…` : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
