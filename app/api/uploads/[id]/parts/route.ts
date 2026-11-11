import { NextRequest, NextResponse } from "next/server";
import { signParts } from "@/lib/server/files";
import { PropertyError } from "@/lib/server/properties";
import { currentUser } from "@/lib/server/session";

// Bucket uploads: short-lived signed URLs for the parts the browser is about to send.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/uploads/[id]/parts">) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const urls = await signParts(user, (await ctx.params).id, Array.isArray(body?.parts) ? body.parts.map(Number) : []);
    return NextResponse.json({ urls });
  } catch (error) {
    if (error instanceof PropertyError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[upload] sign failed", error);
    return NextResponse.json({ error: "Couldn't continue the upload." }, { status: 500 });
  }
}
