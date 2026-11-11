import { runBackup } from "@/lib/server/backups";

// Called by Vercel Cron (see vercel.json). Vercel sends the CRON_SECRET as a bearer token.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const b = await runBackup("cron");
  return Response.json({ ok: !b.error, file: b.fileName, error: b.error });
}
