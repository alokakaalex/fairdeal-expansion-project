import { NextRequest, NextResponse } from "next/server";
import { completeUpload } from "@/lib/server/files";
import { PropertyError } from "@/lib/server/properties";
import { currentUser } from "@/lib/server/session";

// Finishes an upload: checks the stored file's real type and records it.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const parts = Array.isArray(body?.parts)
    ? body.parts.map((p: { partNumber: number; etag: string }) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
    : undefined;
  try {
    return NextResponse.json(await completeUpload(user, (await ctx.params).id, parts), { status: 201 });
  } catch (error) {
    if (error instanceof PropertyError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[upload] complete failed", error);
    return NextResponse.json({ error: "Couldn't finish the upload. Please try again." }, { status: 500 });
  }
}
