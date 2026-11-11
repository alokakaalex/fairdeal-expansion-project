import { backupIsStale } from "@/lib/server/backups";
import { databaseKind } from "@/lib/server/db";

// For the host's health check and uptime monitors. Reveals nothing private.
export async function GET() {
  try {
    const database = await databaseKind();
    return Response.json({ ok: true, database, backupStale: await backupIsStale() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
