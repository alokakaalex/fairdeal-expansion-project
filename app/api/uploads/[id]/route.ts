import { NextRequest, NextResponse } from "next/server";
import { abortUpload, uploadChunk } from "@/lib/server/files";
import { PropertyError } from "@/lib/server/properties";
import { currentUser } from "@/lib/server/session";

// Server-stored uploads: each request carries one chunk, appended at ?offset=.
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  if (!request.body) return NextResponse.json({ error: "No data received." }, { status: 400 });
  try {
    const received = await uploadChunk(user, id, Number(request.nextUrl.searchParams.get("offset")), request.body);
    return NextResponse.json({ received });
  } catch (error) {
    if (error instanceof PropertyError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[upload] chunk failed", error);
    return NextResponse.json({ error: "Upload interrupted." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/uploads/[id]">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  await abortUpload(user, (await ctx.params).id);
  return NextResponse.json({ ok: true });
}
