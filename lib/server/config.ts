import "server-only";
import path from "node:path";

// All environment access for the portal lives here. See README for the
// full list and what each one controls.

/**
 * The portal's public address, as "https://host" with no trailing slash,
 * whatever was typed: surrounding spaces or quotes, no "https://", a
 * trailing slash or path. Without APP_URL, Vercel's production address is
 * used, then localhost.
 */
export function normalizeAppUrl(raw: string | undefined, vercelProductionHost?: string): string {
  let value = (raw ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  if (!value && vercelProductionHost) value = vercelProductionHost.trim();
  if (!value) return "http://localhost:3000";
  if (!/^https?:\/\//i.test(value)) value = `${/^(localhost|127\.0\.0\.1)(:|$)/.test(value) ? "http" : "https"}://${value}`;
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function storageProvider(): "s3" | "supabase" | "local" {
  const wanted = process.env.STORAGE_PROVIDER;
  if (wanted === "s3" || wanted === "supabase" || wanted === "local") return wanted;
  if (process.env.S3_BUCKET) return "s3";
  if (supabase) return "supabase";
  return "local";
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Serverless hosts (Vercel, Netlify, AWS Lambda) have no lasting disk: only
// /tmp is writable and it is wiped between invocations. There, records must
// be in DATABASE_URL and files in the S3 bucket.
const serverless = Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
// Demo mode: seeded sample data, one-click sign-in per role, and a banner
// saying data resets. On by default on a serverless host with no database;
// once a real database is attached (DATABASE_URL), the demo switches off.
const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NETLIFY_DATABASE_URL);
const demoMode = process.env.DEMO_MODE === "true" || (serverless && !hasDatabase && process.env.DEMO_MODE !== "false");
const defaultDataDir = serverless ? "/tmp/expansion-portal" : path.join(process.cwd(), "data");
const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || defaultDataDir);

// Supabase: sign-in (Supabase Auth) and, optionally, file storage. The
// service-role key stays on the server; nothing here is sent to browsers.
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const supabase =
  supabaseUrl && supabaseAnonKey && supabaseServiceKey
    ? {
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
        serviceRoleKey: supabaseServiceKey,
        bucket: process.env.SUPABASE_BUCKET || "expansion-files",
        // Supabase caps each file by plan (Free: 50 MB at the time of writing); keep in step with the bucket setting.
        maxFileBytes: (Number(process.env.SUPABASE_MAX_FILE_MB) || 50) * 1024 * 1024,
        google: process.env.SUPABASE_GOOGLE_SIGNIN === "true",
      }
    : null;

export const config = {
  serverless,
  supabase,
  /** Who checks passwords: Supabase Auth when configured, else the built-in sign-in (development, tests, demo). */
  authProvider: (supabase && !demoMode ? "supabase" : "builtin") as "supabase" | "builtin",
  /** Where new uploads go; STORAGE_PROVIDER picks one when several are configured. */
  storageProvider: storageProvider(),
  demoMode,
  dataDir,
  /** Managed Postgres (production). Vercel's Neon integration sets POSTGRES_URL / DATABASE_URL. */
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NETLIFY_DATABASE_URL || null,
  /** Embedded Postgres (PGlite) folder when there's no DATABASE_URL; ":memory:" for tests. */
  databasePath: process.env.DATABASE_PATH || path.join(dataDir, "pgdata"),
  uploadsDir: path.join(dataDir, "uploads"),
  appUrl: normalizeAppUrl(process.env.APP_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL),
  secureCookies: process.env.NODE_ENV === "production" && !process.env.INSECURE_COOKIES,

  bootstrapAdmin: {
    email: process.env.ADMIN_EMAIL?.trim().toLowerCase() || null,
    name: process.env.ADMIN_NAME?.trim() || "Access Manager",
    // Forgiving of what hosting dashboards often add by accident: surrounding spaces or quotes.
    password: process.env.ADMIN_INITIAL_PASSWORD?.trim().replace(/^(["'])(.*)\1$/, "$2") || null,
  },

  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: int("SMTP_PORT", 587),
        secure: process.env.SMTP_SECURE === "true",
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@localhost",
      }
    : null,

  // Optional S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2,
  // MinIO…). When set, every uploaded file and every database backup is
  // also written there, so losing the server's disk loses nothing.
  s3: process.env.S3_BUCKET
    ? {
        bucket: process.env.S3_BUCKET,
        region: process.env.S3_REGION || "auto",
        endpoint: process.env.S3_ENDPOINT || undefined,
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        prefix: (process.env.S3_PREFIX || "expansion-portal").replace(/^\/+|\/+$/g, ""),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      }
    : null,

  backupsDir: process.env.BACKUP_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.BACKUP_DIR) : path.join(/*turbopackIgnore: true*/ dataDir, "backups"),
  backupIntervalHours: int("BACKUP_INTERVAL_HOURS", 6),
  backupKeepLocal: int("BACKUP_KEEP", 60),

  sessionDays: int("SESSION_DAYS", 7),
  inviteDays: int("INVITE_DAYS", 7),
  // Uploads have no size limit: large files go straight to the bucket in
  // parts, or through the server in chunks small enough for any host.
  // Serverless functions accept only a few MB per request, hence 4 MB chunks there.
  chunkBytes: (serverless ? 4 : int("UPLOAD_CHUNK_MB", 16)) * 1024 * 1024,
  maxFilesPerProperty: int("MAX_FILES_PER_PROPERTY", 1000),
};
