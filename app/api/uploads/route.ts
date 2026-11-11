import { NextRequest, NextResponse } from "next/server";
import { isFileCategory } from "@/lib/expansion/workflow";
import { beginUpload } from "@/lib/server/files";
import { PropertyError } from "@/lib/server/properties";
import { currentUser } from "@/lib/server/session";

// Starts an upload of any size. Returns how to send the bytes: straight to
// the bucket in parts ("s3"), or to /api/uploads/:id in chunks ("local").
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !isFileCategory(body.category)) return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
  try {
    const plan = await beginUpload(user, {
      propertyId: Number(body.propertyId),
      category: body.category,
      ownerId: body.ownerId ? Number(body.ownerId) : null,
      name: String(body.name ?? "upload"),
      mime: String(body.mime ?? ""),
      size: Number(body.size),
    });
    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    if (error instanceof PropertyError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[upload] begin failed", error);
    return NextResponse.json({ error: "Couldn't start the upload. Please try again." }, { status: 500 });
  }
}
