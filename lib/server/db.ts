import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { config } from "./config";
import { hashPasswordSync } from "./crypto";
import { businessSchema, LOCK_DOWN_SQL } from "./migrations/business";

// PostgreSQL everywhere. In production DATABASE_URL points at a managed
// Postgres (Neon, Supabase, RDS…). Without it — local development, tests
// and the demo — the same schema runs on PGlite, an embedded Postgres
// stored under DATA_DIR. Queries use "?" placeholders, converted to $n.

// --- Schema -----------------------------------------------------------------

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
    sales_approver INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX users_email ON users (lower(email));

  CREATE TABLE auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE properties (
    id SERIAL PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('draft', 'active', 'on_hold', 'rejected', 'completed')),
    stage TEXT,
    round INTEGER NOT NULL DEFAULT 0,
    furthest_stage INTEGER NOT NULL DEFAULT -1,
    store_name TEXT NOT NULL,
    address TEXT NOT NULL,
    map_url TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    total_area_sqft DOUBLE PRECISION NOT NULL,
    carpet_area_sqft DOUBLE PRECISION NOT NULL,
    asking_rent DOUBLE PRECISION NOT NULL,
    security_deposit DOUBLE PRECISION NOT NULL,
    advance_rent DOUBLE PRECISION NOT NULL,
    lock_in_months INTEGER NOT NULL,
    structure_type TEXT NOT NULL CHECK (structure_type IN ('tin', 'shed', 'rcc')),
    structure_height_ft DOUBLE PRECISION NOT NULL,
    rent_free_days INTEGER NOT NULL,
    handover_date TEXT NOT NULL,
    lease_tenure_months INTEGER,
    rent_escalation_pct DOUBLE PRECISION,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT,
    documents_completed_at TEXT,
    loi_sent_at TEXT,
    loi_sent_to TEXT,
    completed_at TEXT
  );
  CREATE INDEX properties_stage ON properties(state, stage);
  CREATE INDEX properties_creator ON properties(created_by);

  CREATE TABLE owners (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    is_organisation INTEGER NOT NULL DEFAULT 0,
    gst_number TEXT,
    pan_number TEXT,
    bank_account_name TEXT,
    bank_account_number TEXT,
    bank_ifsc TEXT,
    bank_name TEXT,
    archived_at TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX owners_property ON owners(property_id);

  CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    kind TEXT NOT NULL CHECK (kind IN ('token', 'balance', 'stamp_duty')),
    status TEXT NOT NULL CHECK (status IN ('requested', 'paid')),
    requested_amount DOUBLE PRECISION,
    requested_by TEXT REFERENCES users(id),
    requested_at TEXT,
    request_remarks TEXT,
    amount DOUBLE PRECISION,
    utr TEXT,
    paid_on TEXT,
    paid_by TEXT REFERENCES users(id),
    paid_at TEXT,
    notes TEXT
  );
  CREATE INDEX payments_property ON payments(property_id, kind);

  -- Every uploaded file. Rows are never deleted: removing or replacing a
  -- file sets archived_at, and the object stays in storage.
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    owner_id INTEGER REFERENCES owners(id),
    payment_id INTEGER REFERENCES payments(id),
    category TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'pdf', 'doc')),
    mime TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT,
    etag TEXT,
    storage TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    archived_at TEXT,
    archived_by TEXT REFERENCES users(id)
  );
  CREATE INDEX files_property ON files(property_id, category);

  -- Uploads in progress (large files arrive in parts).
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    owner_id INTEGER,
    category TEXT NOT NULL,
    mime TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    part_size BIGINT NOT NULL,
    storage TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    multipart_id TEXT,
    received_bytes BIGINT NOT NULL DEFAULT 0,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE decisions (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id),
    round INTEGER NOT NULL,
    stage TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'hold')),
    remarks TEXT NOT NULL,
    decided_by TEXT NOT NULL REFERENCES users(id),
    decided_at TEXT NOT NULL
  );
  CREATE INDEX decisions_property ON decisions(property_id, round, stage);

  CREATE TABLE ops_visits (
    property_id INTEGER NOT NULL REFERENCES properties(id),
    round INTEGER NOT NULL,
    visited_at TEXT,
    visited_by TEXT REFERENCES users(id),
    scope_of_work TEXT NOT NULL DEFAULT '',
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT,
    PRIMARY KEY (property_id, round)
  );

  CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    property_id INTEGER REFERENCES properties(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX notifications_user ON notifications(user_id, read_at);

  CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    actor_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    property_id INTEGER REFERENCES properties(id),
    subject_user_id TEXT REFERENCES users(id),
    details TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX audit_property ON audit_log(property_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE backups (
    id SERIAL PRIMARY KEY,
    file_name TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    location TEXT NOT NULL,
    trigger TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );

  -- Business records are append-only: the database itself refuses to
  -- delete them (and to edit decisions and the audit log), whatever the
  -- application code does.
  CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION '%', TG_ARGV[0];
  END $$;
  CREATE TRIGGER properties_no_delete BEFORE DELETE ON properties FOR EACH ROW EXECUTE FUNCTION refuse_change('properties are never deleted');
  CREATE TRIGGER owners_no_delete BEFORE DELETE ON owners FOR EACH ROW EXECUTE FUNCTION refuse_change('owners are never deleted');
  CREATE TRIGGER files_no_delete BEFORE DELETE ON files FOR EACH ROW EXECUTE FUNCTION refuse_change('files are never deleted');
  CREATE TRIGGER decisions_no_delete BEFORE DELETE ON decisions FOR EACH ROW EXECUTE FUNCTION refuse_change('decisions are never deleted');
  CREATE TRIGGER decisions_no_update BEFORE UPDATE ON decisions FOR EACH ROW EXECUTE FUNCTION refuse_change('decisions are never changed');
  CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION refuse_change('payments are never deleted');
  CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_change('audit entries are never deleted');
  CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION refuse_change('audit entries are never changed');
  CREATE TRIGGER users_no_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION refuse_change('users are disabled, never deleted');
  `,
  businessSchema(),
  `
  -- The person's Supabase Auth account (when Supabase sign-in is used). The
  -- users table stays the source of truth for name, role and status.
  ALTER TABLE users ADD COLUMN auth_id TEXT;
  CREATE UNIQUE INDEX users_auth_id ON users (auth_id) WHERE auth_id IS NOT NULL;
  `,
];

// --- Drivers ----------------------------------------------------------------

interface Result {
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface Executor {
  query(sql: string, params: unknown[]): Promise<Result>;
  /** Several statements, no parameters (migrations). */
  script(sql: string): Promise<void>;
}

interface Driver extends Executor {
  kind: "postgres" | "pglite";
  /** Runs fn with an executor bound to one transaction. */
  transaction<T>(fn: (ex: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Postgres timestamp text ("2026-11-09 10:00:00.12+05:30") → ISO 8601 UTC. */
function isoTimestamp(v: string): string {
  const t = v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`).toISOString();
}

// Big integers (file sizes, counts) and NUMERIC amounts as JS numbers rather
// than strings; dates as "YYYY-MM-DD" and timestamps as ISO strings, the same
// shapes the rest of the app passes around.
const PARSERS: Record<number, (v: string) => unknown> = {
  20: (v) => Number(v),
  1700: (v) => Number(v),
  1082: (v) => v,
  1114: isoTimestamp,
  1184: isoTimestamp,
};
for (const [oid, parse] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), parse);

/**
 * The connection string without its SSL parameters, plus the TLS settings
 * to use. node-postgres lets `sslmode` in the URL override the options
 * passed alongside it, and treats `sslmode=require` as full certificate
 * verification — which fails against Supabase's pooler (its certificate
 * chains to Supabase's own CA), so every query would error. Here
 * "require"/"prefer"/none mean encrypted without verifying the CA (what
 * libpq does), "verify-full" verifies, and "disable" or a local host
 * means no TLS.
 */
export function connectionOptions(url: string): { connectionString: string; ssl: false | { rejectUnauthorized: boolean } } {
  let mode: string | null = null;
  let connectionString = url;
  try {
    const u = new URL(url);
    mode = u.searchParams.get("sslmode");
    for (const p of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "ssl"]) u.searchParams.delete(p);
    connectionString = u.toString();
    if (mode === "disable" || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) return { connectionString, ssl: false };
  } catch {
    // Not a URL pg's own parser can't handle either; pass it through.
  }
  return { connectionString, ssl: { rejectUnauthorized: mode === "verify-full" } };
}

function postgresDriver(url: string): Driver {
  const pool = new pg.Pool({
    ...connectionOptions(url),
    max: Number(process.env.DATABASE_POOL_SIZE) || 5,
  });
  // An idle connection dropped by the pooler shouldn't crash the server.
  pool.on("error", (error) => console.error("[db] idle connection error", error.message));
  const run = async (c: pg.Pool | pg.PoolClient, sql: string, params: unknown[]) => {
    const r = await c.query(sql, params);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  };
  return {
    kind: "postgres",
    query: (sql, params) => run(pool, sql, params),
    script: async (sql) => void (await pool.query(sql)),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (sql, params) => run(client, sql, params), script: async (sql) => void (await client.query(sql)) });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function pgliteDriver(dataDir: string | null): Driver {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir ?? undefined);
  // PGlite is a single connection, so statements are serialised: a
  // transaction holds the lock until it commits.
  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const run = async (sql: string, params: unknown[]) => {
    // Parsers per query: this PGlite version ignores constructor-level ones.
    const r = await db.query(sql, params, { parsers: PARSERS });
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? 0 };
  };
  return {
    kind: "pglite",
    query: (sql, params) => locked(() => run(sql, params)),
    script: (sql) => locked(async () => void (await db.exec(sql))),
    transaction: (fn) =>
      locked(async () => {
        await db.exec("BEGIN");
        try {
          const result = await fn({ query: run, script: async (sql) => void (await db.exec(sql)) });
          await db.exec("COMMIT");
          return result;
        } catch (error) {
          await db.exec("ROLLBACK").catch(() => {});
          throw error;
        }
      }),
    close: () => db.close(),
  };
}

// --- Connection & migrations ---------------------------------------------------

const globalForDb = globalThis as unknown as { __expansionDb?: Promise<Driver> };
const txStore = new AsyncLocalStorage<Executor>();
/** The user the current withUser() block runs as. */
const actorStore = new AsyncLocalStorage<string>();

async function open(): Promise<Driver> {
  if (config.serverless && !config.databaseUrl && !config.demoMode && !process.env.VITEST) {
    throw new Error("This host has no lasting disk, so the portal needs DATABASE_URL (a hosted Postgres such as Neon) — see README → Going live.");
  }
  const driver = config.databaseUrl
    ? postgresDriver(config.databaseUrl)
    : pgliteDriver(config.databasePath === ":memory:" ? null : config.databasePath);
  await driver.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    [],
  );
  const done = new Set((await driver.query("SELECT version FROM schema_migrations", [])).rows.map((r) => Number(r.version)));
  for (let v = 0; v < MIGRATIONS.length; v++) {
    if (done.has(v + 1)) continue;
    await driver.transaction(async (ex) => {
      await ex.script(MIGRATIONS[v]);
      await ex.query("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)", [v + 1, now()]);
    });
  }
  await driver.script(LOCK_DOWN_SQL);
  await bootstrapAdmin(driver);
  return driver;
}

// The first access manager comes from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD,
// set by whoever deploys the app. Created once; change the password in-app.
async function bootstrapAdmin(driver: Driver) {
  const { email, name, password } = config.bootstrapAdmin;
  if (!email || !password) return;
  const exists = await driver.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
  if (exists.rows.length) return;
  await driver.query(
    `INSERT INTO users (id, email, name, role, status, password_hash, created_at)
     VALUES ($1, $2, $3, 'admin', 'active', $4, $5) ON CONFLICT DO NOTHING`,
    [randomUUID(), email, name, hashPasswordSync(password), now()],
  );
}

function driver(): Promise<Driver> {
  globalForDb.__expansionDb ??= open().catch((error) => {
    globalForDb.__expansionDb = undefined;
    console.error("[db] could not open the database:", error);
    throw error;
  });
  return globalForDb.__expansionDb;
}

export async function databaseKind(): Promise<Driver["kind"]> {
  return (await driver()).kind;
}

/** "?" placeholders → $1, $2… (outside quoted strings). */
function toPg(sql: string): string {
  let n = 0;
  let out = "";
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === "?" && !quoted ? `$${++n}` : ch;
  }
  return out;
}

async function exec(sql: string, params: unknown[]): Promise<Result> {
  const ex = txStore.getStore() ?? (await driver());
  return ex.query(toPg(sql), params.map((p) => (p === undefined ? null : p)));
}

/** All rows. */
export async function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await exec(sql, params)).rows as T[];
}

/** First row, or undefined. */
export async function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  return (await exec(sql, params)).rows[0] as T | undefined;
}

/** For INSERT/UPDATE/DELETE: number of rows affected. */
export async function run(sql: string, ...params: unknown[]): Promise<number> {
  return (await exec(sql, params)).rowCount;
}

/**
 * Runs fn in a transaction. Nested calls join the outer transaction, so a
 * service called from another service shares its commit or rollback.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
  return (await driver()).transaction((ex) => txStore.run(ex, fn));
}

/**
 * Runs fn as the given employee: inside one transaction, as the restricted
 * database role fd_app with app.user_id set, so Postgres row-level security
 * decides which rows every query can see and change. Use it for every
 * business-module query made on someone's behalf.
 */
export async function withUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const current = actorStore.getStore();
  if (current === userId) return fn();
  if (current !== undefined) throw new Error("withUser() can't switch to another user inside a withUser() block.");
  return tx(() =>
    actorStore.run(userId, async () => {
      await exec("SELECT set_config('app.user_id', ?, true)", [userId]);
      await exec("SET LOCAL ROLE fd_app", []);
      try {
        return await fn();
      } finally {
        // Back to the owner for the rest of an enclosing transaction (fails harmlessly if it already aborted).
        await exec("RESET ROLE", []).catch(() => {});
        await exec("SELECT set_config('app.user_id', '', true)", []).catch(() => {});
      }
    }),
  );
}

/**
 * Inside withUser(): runs fn with the owner's privileges, in the same
 * transaction, for bookkeeping a business permission has already
 * authorised (for example writing file records for an upload).
 */
export async function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  const userId = actorStore.getStore();
  if (userId === undefined) return fn();
  await exec("RESET ROLE", []);
  try {
    return await actorStore.exit(fn);
  } finally {
    await exec("SET LOCAL ROLE fd_app", []).catch(() => {});
  }
}

/** The employee the current withUser() block runs as, if any. */
export function currentActorId(): string | undefined {
  return actorStore.getStore();
}

/** Tests only: start the next query on an empty database. */
export async function resetDbForTests() {
  const d = globalForDb.__expansionDb;
  globalForDb.__expansionDb = undefined;
  if (d) {
    const driver = await d;
    // A real Postgres keeps its data, so wipe the schema; PGlite in memory just goes away.
    if (driver.kind === "postgres") await driver.script("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await driver.close().catch(() => {});
  } else if (config.databaseUrl) {
    const fresh = postgresDriver(config.databaseUrl);
    await fresh.script("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await fresh.close();
  }
}

export function now(): string {
  return new Date().toISOString();
}

/**
 * What kind of problem stopped the database from opening, in words safe to
 * show anyone (no hosts, users or passwords). For /api/health.
 */
export function describeDbError(error: unknown): string {
  const e = error as { message?: string; code?: string };
  const m = `${e?.code ?? ""} ${e?.message ?? ""}`;
  if (/certificate|SELF_SIGNED|UNABLE_TO_VERIFY|CERT_/i.test(m)) return "ssl: the database's certificate was rejected";
  if (/password authentication failed|28P01|SASL|28000/i.test(m)) return "auth: wrong database user or password in DATABASE_URL";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return "network: the database host in DATABASE_URL wasn't found";
  if (/ECONNREFUSED|ETIMEDOUT|timeout|ECONNRESET/i.test(m)) return "network: couldn't reach the database (paused project, wrong port, or firewall)";
  if (/Tenant or user not found|XX000/i.test(m)) return "auth: the pooler doesn't recognise the user — copy DATABASE_URL again from Supabase → Connect";
  if (/Invalid URL|connection string/i.test(m)) return "config: DATABASE_URL isn't a valid connection string (special characters in the password must be URL-encoded)";
  if (/no lasting disk/.test(m)) return "config: DATABASE_URL isn't set";
  if (/permission denied|must be owner|42501/i.test(m)) return "setup: the database user lacks a permission the setup needs";
  return "other: see the deployment's logs for the full error";
}
