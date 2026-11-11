import "server-only";
import type { EmailOtpType } from "@supabase/supabase-js";
import { config } from "./config";
import { verifyPassword } from "./crypto";
import { one, run } from "./db";
import { adminClient, anonClient, authClient } from "./supabase";

// Supabase Auth: who someone is. The users table still decides what they
// may do (role, department, active/disabled), so a Supabase account alone
// grants nothing: only people an access manager added can get in.
//
// Every email link (invite, password reset, sign-in link) is created with
// the service role and sent by the portal's own mailer, pointing at
// /auth/confirm, which asks for a click before using the one-time token so
// email security scanners that pre-open links can't burn it.

export interface AuthRow {
  id: string;
  email: string;
  auth_id: string | null;
  password_hash: string | null;
}

export type LinkPurpose = "invite" | "reset" | "signin";

/** The link types /auth/confirm accepts. */
export const LINK_TYPES = ["invite", "recovery", "magiclink"] as const satisfies readonly EmailOtpType[];
export type LinkType = (typeof LINK_TYPES)[number];

async function linkAccount(userId: string, authId: string) {
  await run("UPDATE users SET auth_id = ? WHERE id = ? AND (auth_id IS NULL OR auth_id <> ?)", authId, userId, authId);
}

/** A one-time link that signs the person in (and, for invites and resets, leads to setting a password). */
export async function emailLink(row: AuthRow, purpose: LinkPurpose): Promise<string> {
  const admin = adminClient().auth.admin;
  let type: LinkType = purpose === "signin" ? "magiclink" : purpose === "invite" && !row.auth_id ? "invite" : "recovery";
  let { data, error } = await admin.generateLink({ type, email: row.email });
  // Re-inviting someone who already has a Supabase account: a reset link does the same job.
  if (error && type === "invite" && /already|exists|registered/i.test(error.message)) {
    type = "recovery";
    ({ data, error } = await admin.generateLink({ type, email: row.email }));
  }
  if (error || !data.properties) throw new Error(`Supabase couldn't create the link: ${error?.message ?? "no link returned"}`);
  if (data.user) await linkAccount(row.id, data.user.id);
  return `${config.appUrl}/auth/confirm?type=${type}&token_hash=${encodeURIComponent(data.properties.hashed_token)}`;
}

/**
 * Checks the password with Supabase and, if right, starts the session
 * (cookies). The first access manager (ADMIN_EMAIL) gets their Supabase
 * account on first sign-in with ADMIN_INITIAL_PASSWORD.
 */
export async function passwordSignIn(row: AuthRow, password: string): Promise<boolean> {
  const sb = await authClient();
  let { data, error } = await sb.auth.signInWithPassword({ email: row.email, password });
  // Until their first successful sign-in, the first access manager can use
  // ADMIN_INITIAL_PASSWORD as it is set now (even if it changed since the
  // database was created) or as it was then.
  const bootstrapPassword =
    !row.auth_id &&
    row.email === config.bootstrapAdmin.email &&
    ((config.bootstrapAdmin.password !== null && password === config.bootstrapAdmin.password) || (await verifyPassword(password, row.password_hash)));
  if (error && bootstrapPassword) {
    const created = await adminClient().auth.admin.createUser({ email: row.email, password, email_confirm: true });
    if (created.error) throw new Error(`Supabase couldn't create the first account: ${created.error.message}`);
    ({ data, error } = await sb.auth.signInWithPassword({ email: row.email, password }));
  }
  if (error || !data.user) return false;
  if (row.auth_id && row.auth_id !== data.user.id) {
    // Same email, different Supabase account: don't let it borrow this person's access.
    await sb.auth.signOut();
    return false;
  }
  await linkAccount(row.id, data.user.id);
  return true;
}

/** Checks a password without changing who is signed in. */
export async function passwordIsCorrect(email: string, password: string): Promise<boolean> {
  const { error } = await anonClient().auth.signInWithPassword({ email, password });
  return !error;
}

/** Sets the signed-in person's password. */
export async function setOwnPassword(password: string) {
  const { error } = await (await authClient()).auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

/** Disabling someone also blocks their Supabase account; enabling lifts it. */
export async function setBlocked(authId: string | null, blocked: boolean) {
  if (!authId || config.authProvider !== "supabase") return;
  const { error } = await adminClient().auth.admin.updateUserById(authId, { ban_duration: blocked ? "876000h" : "none" });
  if (error) throw new Error(`Supabase couldn't ${blocked ? "block" : "unblock"} the account: ${error.message}`);
}

/** The Supabase account behind this request's session, if any. */
export async function sessionAccount(): Promise<{ authId: string; email: string | null } | null> {
  const { data, error } = await (await authClient()).auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { authId: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : null };
}

/**
 * The portal user for this session's account. Someone signing in for the
 * first time with Google (or any confirmed email) is matched to the
 * account an access manager created for that email.
 */
export async function sessionRow<T extends AuthRow>(): Promise<T | null> {
  const account = await sessionAccount();
  if (!account) return null;
  const linked = await one<T>("SELECT * FROM users WHERE auth_id = ?", account.authId);
  if (linked) return linked;
  if (!account.email) return null;
  // Only trust the email once Supabase has confirmed the person owns it.
  const { data } = await (await authClient()).auth.getUser();
  if (!data.user?.email_confirmed_at || data.user.id !== account.authId) return null;
  const row = await one<T>("SELECT * FROM users WHERE lower(email) = lower(?) AND auth_id IS NULL", account.email);
  if (!row) return null;
  await linkAccount(row.id, account.authId);
  return { ...row, auth_id: account.authId };
}

/** Uses a link's one-time token and starts the session. */
export async function confirmLink(type: LinkType, tokenHash: string): Promise<boolean> {
  const { error } = await (await authClient()).auth.verifyOtp({ type, token_hash: tokenHash });
  return !error;
}

/** Finishes Google sign-in (the code Supabase sends back to /auth/callback). */
export async function exchangeCode(code: string): Promise<boolean> {
  const { error } = await (await authClient()).auth.exchangeCodeForSession(code);
  return !error;
}

/** The Google sign-in page to send the browser to. */
export async function googleSignInUrl(): Promise<string> {
  const { data, error } = await (await authClient()).auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${config.appUrl}/auth/callback` },
  });
  if (error || !data.url) throw new Error(error?.message ?? "Google sign-in isn't available.");
  return data.url;
}

export async function signOut() {
  await (await authClient()).auth.signOut();
}
