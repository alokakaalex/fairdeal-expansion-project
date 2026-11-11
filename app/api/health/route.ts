import { backupIsStale } from "@/lib/server/backups";
import { config } from "@/lib/server/config";
import { databaseKind, describeDbError } from "@/lib/server/db";
import { firstAdminStatus } from "@/lib/server/users";

// For the host's health check, uptime monitors and setup troubleshooting.
// Reveals nothing private: which pieces are configured, and the kind of
// problem if the database won't open.
export async function GET(request: Request) {
  const appUrlHost = new URL(config.appUrl).host;
  const here = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const configured = {
    appUrl: appUrlHost,
    appUrlMatchesThisAddress: !here || here.split(",")[0].trim().toLowerCase() === appUrlHost.toLowerCase(),
    database: Boolean(config.databaseUrl),
    supabaseAuth: config.authProvider === "supabase",
    storage: config.storageProvider,
    email: Boolean(config.smtp),
    demo: config.demoMode,
  };
  try {
    const database = await databaseKind();
    return Response.json(
      { ok: true, database, configured, firstAdmin: await firstAdminStatus(), backupStale: await backupIsStale() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ ok: false, configured, problem: describeDbError(error) }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
