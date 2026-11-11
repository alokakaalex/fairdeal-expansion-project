import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { ROLE_INFO, type Role } from "@/lib/expansion/roles";
import type { User } from "@/lib/expansion/types";
import { config } from "./config";
import { randomToken, sha256 } from "./crypto";
import { now, one, run } from "./db";
import { ensureDemo } from "./demo";
import * as supabaseAuth from "./supabaseAuth";
import { toUser, type UserRow } from "./users";

// Sessions. With Supabase sign-in, Supabase Auth's cookies say who someone
// is. Otherwise (development, tests) the built-in sessions: the cookie holds
// a random token, the database holds its hash. Either way role and status
// are read fresh from the users table on every request, so a role change or
// a disabled account takes effect immediately.

const COOKIE = "expansion_session";

// The demo can run on several short-lived server instances that don't
// share a database, so its sessions are signed cookies (user id + expiry +
// HMAC) that any instance can check. Real deployments use the table above.
const DEMO_SECRET = process.env.DEMO_SECRET || process.env.VERCEL_DEPLOYMENT_ID || "expansion-portal-demo";

function demoToken(userId: string, expires: Date): string {
  const body = `${userId}.${expires.getTime()}`;
  return `${body}.${createHmac("sha256", DEMO_SECRET).update(body).digest("base64url")}`;
}

function demoUserId(token: string): string | null {
  const [userId, exp] = token.split(".");
  if (!userId || !exp || Number(exp) < Date.now()) return null;
  const expected = demoToken(userId, new Date(Number(exp)));
  return expected.length === token.length && timingSafeEqual(Buffer.from(expected), Buffer.from(token)) ? userId : null;
}

export async function startSession(userId: string, userAgent: string | null) {
  // Supabase already set its session cookies when the password or link was checked.
  if (config.authProvider === "supabase") return;
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
  if (config.demoMode) {
    (await cookies()).set(COOKIE, demoToken(userId, expires), { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/", expires });
    return;
  }
  const token = randomToken();
  await run(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)",
    sha256(token),
    userId,
    expires.toISOString(),
    now(),
    userAgent?.slice(0, 300) ?? null,
  );
  // Opportunistic cleanup of expired sessions.
  await run("DELETE FROM sessions WHERE expires_at < ?", now());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession() {
  if (config.authProvider === "supabase") {
    await supabaseAuth.signOut();
    return;
  }
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token && !config.demoMode) await run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  store.delete(COOKIE);
}

/** The signed-in user for this request, or null. */
export const currentUser = cache(async (): Promise<User | null> => {
  // Who is signed in is only known per request: never let a page that asks
  // be prerendered at build time (when the host's settings may be absent).
  await connection();
  await ensureDemo();
  if (config.authProvider === "supabase") {
    const row = await supabaseAuth.sessionRow<UserRow>();
    return row && row.status === "active" ? toUser(row) : null;
  }
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  if (config.demoMode) {
    const id = demoUserId(token);
    const row = id ? await one<UserRow>("SELECT * FROM users WHERE id = ? AND status = 'active'", id) : undefined;
    return row ? toUser(row) : null;
  }
  const row = await one<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
    sha256(token),
    now(),
  );
  return row ? toUser(row) : null;
});

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Guards a portal page: other roles are sent to their own portal. */
export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(ROLE_INFO[user.role].portal);
  return user;
}

/**
 * Supabase sign-in only: the person this session belongs to, even before
 * they've set a password (status "invited"). Used by the set-password page.
 */
export async function sessionUserAnyStatus(): Promise<User | null> {
  await connection();
  if (config.authProvider !== "supabase") return null;
  const row = await supabaseAuth.sessionRow<UserRow>();
  return row && row.status !== "disabled" ? toUser(row) : null;
}

/**
 * Is this request on the address the portal is configured for (APP_URL)?
 * Sign-in cookies belong to one address, and email links are built from
 * APP_URL, so a mismatch (a second Vercel project, a preview link) breaks
 * links in confusing ways. Used to explain that on the link pages.
 */
export async function addressCheck(): Promise<{ ok: boolean; here: string; expected: string }> {
  const h = await headers();
  const here = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const expected = new URL(config.appUrl).host.toLowerCase();
  return { ok: !here || here === expected, here, expected };
}
