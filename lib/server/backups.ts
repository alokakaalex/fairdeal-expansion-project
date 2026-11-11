import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { config } from "./config";
import { all, databaseKind, now, one, run } from "./db";
import * as storage from "./storage";

// Automatic backups. Every BACKUP_INTERVAL_HOURS (and daily from Vercel
// Cron) a snapshot of every table is written as compressed JSON to the
// bucket (or BACKUP_DIR without one). These sit on top of your database
// provider's own backups (Neon/Supabase keep point-in-time history), so a
// copy of every record also lives outside the database. Uploaded files are
// already in the bucket. The app never deletes a backup.

const TABLES = [
  "users",
  "properties",
  "owners",
  "payments",
  "files",
  "decisions",
  "ops_visits",
  "notifications",
  "audit_log",
  "settings",
  "backups",
];

export interface BackupRecord {
  id: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  location: string;
  trigger: string;
  error: string | null;
  createdAt: string;
}

let running: Promise<BackupRecord> | null = null;

export function runBackup(trigger: "scheduled" | "manual" | "startup" | "cron"): Promise<BackupRecord> {
  running ??= doBackup(trigger).finally(() => {
    running = null;
  });
  return running;
}

async function doBackup(trigger: string): Promise<BackupRecord> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `expansion-${stamp}.json.gz`;
  const kind = storage.storageKind();
  let size = 0;
  let sha = "";
  let error: string | null = null;
  try {
    const snapshot: Record<string, unknown> = { createdAt: now(), database: await databaseKind(), tables: {} };
    for (const t of TABLES) (snapshot.tables as Record<string, unknown>)[t] = await all(`SELECT * FROM ${t}`);
    const bytes = gzipSync(Buffer.from(JSON.stringify(snapshot)));
    size = bytes.length;
    sha = createHash("sha256").update(bytes).digest("hex");
    await storage.putBytes(kind, `backups/${fileName}`, bytes, "application/gzip");
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error("[backup] failed", e);
  }
  const r = await one<{ id: number }>(
    "INSERT INTO backups (file_name, size_bytes, sha256, location, trigger, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    fileName,
    size,
    sha,
    kind === "local" ? "server disk" : "bucket",
    trigger,
    error,
    now(),
  );
  return (await listBackups(1)).find((b) => b.id === r!.id)!;
}

export async function listBackups(limit = 20): Promise<BackupRecord[]> {
  const rows = await all<{
    id: number;
    file_name: string;
    size_bytes: number;
    sha256: string;
    location: string;
    trigger: string;
    error: string | null;
    created_at: string;
  }>("SELECT * FROM backups ORDER BY id DESC LIMIT ?", limit);
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    location: r.location,
    trigger: r.trigger,
    error: r.error,
    createdAt: r.created_at,
  }));
}

export async function storageStatus() {
  const files = (await one<{ n: number; bytes: number }>("SELECT COUNT(*)::int AS n, COALESCE(SUM(size_bytes), 0)::float8 AS bytes FROM files"))!;
  return {
    files: files.n,
    bytes: files.bytes,
    storage: storage.storageKind(),
    bucket:
      storage.storageKind() === "s3"
        ? `${config.s3!.bucket}/${config.s3!.prefix}`
        : storage.storageKind() === "supabase"
          ? `Supabase Storage "${config.supabase!.bucket}" (private)`
          : null,
    authProvider: config.authProvider,
    maxFileBytes: storage.storageKind() === "supabase" ? config.supabase!.maxFileBytes : null,
    database: await databaseKind(),
    backupsDir: config.backupsDir,
    intervalHours: config.backupIntervalHours,
  };
}

/** True when there's been no successful backup for over two intervals. */
export async function backupIsStale(): Promise<boolean> {
  const ok = await one<{ created_at: string }>("SELECT created_at FROM backups WHERE error IS NULL ORDER BY id DESC LIMIT 1");
  return !ok || Date.now() - Date.parse(ok.created_at) > (Math.max(config.backupIntervalHours, 24) * 2 + 1) * 3_600_000;
}

// --- Scheduler (long-running servers; Vercel uses /api/cron/backup) -----------------------

const globalForJobs = globalThis as unknown as { __expansionJobs?: NodeJS.Timeout };

export function startBackgroundJobs() {
  if (globalForJobs.__expansionJobs || process.env.VITEST || config.serverless) return;
  const intervalMs = config.backupIntervalHours * 3_600_000;
  const tick = async () => {
    try {
      const last = (await listBackups(1))[0];
      if (!last || Date.now() - Date.parse(last.createdAt) >= intervalMs - 60_000) await runBackup(last ? "scheduled" : "startup");
      // Uploads abandoned for over a day are marked so they don't linger.
      await run("UPDATE uploads SET completed_at = ? WHERE completed_at IS NULL AND created_at < ?", `expired ${now()}`, new Date(Date.now() - 86_400_000).toISOString());
    } catch (e) {
      console.error("[backup] scheduler", e);
    }
  };
  globalForJobs.__expansionJobs = setInterval(tick, 10 * 60_000);
  globalForJobs.__expansionJobs.unref();
  setTimeout(tick, 5_000).unref();
}
