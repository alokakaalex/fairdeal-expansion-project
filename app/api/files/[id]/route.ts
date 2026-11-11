import type { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { viewableFile } from "@/lib/server/files";
import { currentUser } from "@/lib/server/session";
import { readLocalStream, signedDownloadUrl, stat } from "@/lib/server/storage";

/**
 * Node stream → web stream that pulls on demand (backpressure) and stops
 * cleanly when the browser cancels (e.g. a video seek or leaving the page).
 */
function webStream(node: Readable): ReadableStream<Uint8Array> {
  const it = node[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(new Uint8Array(value as Buffer));
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      node.destroy();
    },
  });
}

// Serves a file only to users whose role may see that category on that
// property. Bucket files (S3/R2 or Supabase Storage) redirect to a short-lived signed link; files on
// the server's disk stream from here, with Range support so videos seek.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const meta = await viewableFile(user, (await ctx.params).id);
  if (!meta) return new Response("Not found", { status: 404 });
  const download = request.nextUrl.searchParams.has("download");

  if (meta.storage !== "local") {
    const url = await signedDownloadUrl(meta.storage, meta.storage_key, meta.original_name, meta.mime, download);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  }

  const info = await stat("local", meta.storage_key);
  if (!info) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": meta.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(meta.original_name)}`,
  });
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start: number;
    let end: number;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    } else {
      start = Math.max(info.size - Number(range[2]), 0);
      end = info.size - 1;
    }
    if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(webStream(readLocalStream(meta.storage_key, { start, end })), { status: 206, headers });
  }
  headers.set("Content-Length", String(info.size));
  return new Response(webStream(readLocalStream(meta.storage_key)), { headers });
}
