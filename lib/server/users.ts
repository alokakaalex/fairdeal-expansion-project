import "server-only";
import { randomUUID } from "node:crypto";
import { ROLE_INFO, type Role } from "@/lib/expansion/roles";
import type { User, UserStatus } from "@/lib/expansion/types";
import { audit } from "./audit";
import { config } from "./config";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { all, now, one, run, tx } from "./db";
import { emailEnabled, sendEmail } from "./mailer";
import * as supabaseAuth from "./supabaseAuth";

export class UserError extends Error {}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  sales_approver: number;
  password_hash: string | null;
  /** Supabase Auth account, when Supabase sign-in is used. */
  auth_id: string | null;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    salesApprover: row.sales_approver === 1,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

function rowById(id: string): Promise<UserRow | undefined> {
  return one<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

function rowByEmail(email: string): Promise<UserRow | undefined> {
  return one<UserRow>("SELECT * FROM users WHERE lower(email) = lower(?)", email.trim());
}

export async function getUser(id: string): Promise<User | null> {
  const row = await rowById(id);
  return row ? toUser(row) : null;
}

export async function listUsers(): Promise<User[]> {
  const rows = await all<UserRow>("SELECT * FROM users ORDER BY status = 'disabled', role, lower(name)");
  return rows.map(toUser);
}

export async function countUsers(): Promise<number> {
  return (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users"))!.n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!EMAIL_RE.test(value) || value.length > 254) throw new UserError("Enter a valid email address.");
  return value;
}

export function validatePassword(password: string) {
  if (password.length < 10) throw new UserError("Password must be at least 10 characters.");
  if (password.length > 200) throw new UserError("Password is too long.");
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new UserError("Password must contain at least one letter and one number.");
  }
}

// --- Invite / reset links ---------------------------------------------------

export interface IssuedLink {
  url: string;
  emailed: boolean;
}

/** A one-time link: Supabase's (expiry set in Supabase → Auth) or the built-in one. */
async function createLink(user: UserRow, purpose: "invite" | "reset"): Promise<string> {
  if (config.authProvider === "supabase") return supabaseAuth.emailLink(user, purpose);
  const token = randomToken();
  const expires = new Date(Date.now() + config.inviteDays * 86_400_000).toISOString();
  // Only the newest link for a user works.
  await run("DELETE FROM auth_tokens WHERE user_id = ? AND used_at IS NULL", user.id);
  await run(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    sha256(token),
    user.id,
    purpose,
    expires,
    now(),
  );
  return `${config.appUrl}/invite/${token}`;
}

async function issueToken(user: UserRow, purpose: "invite" | "reset"): Promise<IssuedLink> {
  const url = await createLink(user, purpose);
  const role = ROLE_INFO[user.role].label;
  sendEmail({
    to: user.email,
    subject: purpose === "invite" ? "You've been given access to fairdeal.market Expansion OS" : "Reset your fairdeal.market Expansion OS password",
    text:
      purpose === "invite"
        ? `Hi ${user.name},\n\nYou've been added to fairdeal.market Expansion OS as ${role}. Set your password to sign in:\n\n${url}\n\nThis link works once and expires soon. If it has expired, ask your access manager for a new one.`
        : `Hi ${user.name},\n\nUse this link to set a new password:\n\n${url}\n\nThis link works once and expires soon. If you didn't ask for it, you can ignore this email.`,
  });
  return { url, emailed: emailEnabled() };
}

export async function inviteUser(
  actor: User,
  input: { email: string; name: string; role: Role; salesApprover?: boolean },
): Promise<{ user: User; link: IssuedLink }> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!name) throw new UserError("Enter the person's name.");
  if (name.length > 120) throw new UserError("Name is too long.");

  return tx(async () => {
    if (await rowByEmail(email)) throw new UserError(`${email} already has an account.`);
    const id = randomUUID();
    await run(
      `INSERT INTO users (id, email, name, role, status, sales_approver, created_by, created_at)
       VALUES (?, ?, ?, ?, 'invited', ?, ?, ?)`,
      id,
      email,
      name,
      input.role,
      input.role === "sales" && input.salesApprover ? 1 : 0,
      actor.id,
      now(),
    );
    const row = (await rowById(id))!;
    await audit({
      actorId: actor.id,
      action: "user.invited",
      subjectUserId: id,
      details: `as ${ROLE_INFO[input.role].label}${input.role === "sales" && input.salesApprover ? " (can approve)" : ""}`,
    });
    return { user: toUser(row), link: await issueToken(row, "invite") };
  });
}

/** New invite for someone who hasn't accepted yet, or a password reset link for an active user. */
export async function issueAccessLink(actor: User, userId: string): Promise<IssuedLink> {
  return tx(async () => {
    const row = await rowById(userId);
    if (!row) throw new UserError("User not found.");
    if (row.status === "disabled") throw new UserError("Re-enable this user before sending a link.");
    const purpose = row.status === "invited" ? "invite" : "reset";
    await audit({ actorId: actor.id, action: purpose === "invite" ? "user.invite_resent" : "user.reset_link", subjectUserId: userId });
    return issueToken(row, purpose);
  });
}

interface TokenRow {
  user_id: string;
  purpose: "invite" | "reset";
  expires_at: string;
  used_at: string | null;
}

async function liveToken(token: string): Promise<TokenRow | null> {
  const row = await one<TokenRow>("SELECT user_id, purpose, expires_at, used_at FROM auth_tokens WHERE token_hash = ?", sha256(token));
  if (!row || row.used_at || row.expires_at < now()) return null;
  return row;
}

/** Who a link belongs to, for the set-password page. Null if invalid, used or expired. */
export async function inspectToken(token: string): Promise<{ user: User; purpose: "invite" | "reset" } | null> {
  const t = await liveToken(token);
  if (!t) return null;
  const row = await rowById(t.user_id);
  if (!row || row.status === "disabled") return null;
  return { user: toUser(row), purpose: t.purpose };
}

export async function redeemToken(token: string, password: string): Promise<User> {
  validatePassword(password);
  const hash = await hashPassword(password);
  return tx(async () => {
    const t = await liveToken(token);
    const row = t ? await rowById(t.user_id) : undefined;
    if (!t || !row || row.status === "disabled") {
      throw new UserError("This link is invalid or has expired. Ask your access manager for a new one.");
    }
    await run("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ?", now(), sha256(token));
    await run(
      "UPDATE users SET password_hash = ?, status = 'active', failed_logins = 0, locked_until = NULL WHERE id = ?",
      hash,
      row.id,
    );
    // A reset signs out every other device.
    await run("DELETE FROM sessions WHERE user_id = ?", row.id);
    await audit({ actorId: row.id, action: t.purpose === "invite" ? "user.activated" : "user.password_reset", subjectUserId: row.id });
    return toUser((await rowById(row.id))!);
  });
}

// --- Sign in ----------------------------------------------------------------

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function authenticate(email: string, password: string): Promise<User> {
  const row = await rowByEmail(email);
  // Built-in sign-in hashes even for unknown emails, so timing doesn't reveal who has an account.
  const builtinOk = config.authProvider === "builtin" ? await verifyPassword(password, row?.password_hash ?? null) : false;
  const generic = new UserError("Incorrect email or password.");
  if (!row) throw generic;

  if (row.locked_until && row.locked_until > now()) {
    throw new UserError(`Too many failed attempts. Try again after ${LOCK_MINUTES} minutes, or ask your access manager to reset your password.`);
  }
  if (row.status === "disabled") throw new UserError("Your access has been disabled. Contact your access manager.");
  if (row.status === "invited") throw new UserError("Finish setting up your account using the invite link you were sent.");

  // Supabase checks the password and, if it's right, sets the session cookies.
  const ok = config.authProvider === "supabase" ? await supabaseAuth.passwordSignIn(row, password) : builtinOk;
  if (!ok) {
    const failed = row.failed_logins + 1;
    const lockedUntil = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    await run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", lockedUntil ? 0 : failed, lockedUntil, row.id);
    if (lockedUntil) await audit({ actorId: null, action: "user.locked", subjectUserId: row.id });
    throw generic;
  }

  await run("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", now(), row.id);
  return toUser({ ...row, last_login_at: now() });
}

/**
 * "Email me a sign-in link" and "Forgot password": emails a one-time link
 * to an active account. Says nothing about whether the email has access.
 */
export async function requestEmailLink(email: string, purpose: "signin" | "reset"): Promise<void> {
  if (!emailEnabled()) throw new UserError("Email isn't set up yet, so links can't be sent. Ask your access manager for a link.");
  const row = await rowByEmail(email);
  if (!row || row.status !== "active" || (row.locked_until && row.locked_until > now())) return;
  if (purpose === "reset") {
    await issueToken(row, "reset");
    await audit({ actorId: null, action: "user.reset_requested", subjectUserId: row.id });
    return;
  }
  if (config.authProvider !== "supabase") return;
  const url = await supabaseAuth.emailLink(row, "signin");
  sendEmail({
    to: row.email,
    subject: "Your fairdeal.market Expansion OS sign-in link",
    text: `Hi ${row.name},\n\nUse this link to sign in:\n\n${url}\n\nIt works once and expires soon. If you didn't ask for it, you can ignore this email.`,
  });
  await audit({ actorId: null, action: "user.signin_link_sent", subjectUserId: row.id });
}

/**
 * Supabase sign-in: sets the password for someone who arrived through an
 * invite or reset link (their session is already started by the link).
 */
export async function finishPasswordSetup(user: User, password: string): Promise<User> {
  validatePassword(password);
  const row = await rowById(user.id);
  if (!row || row.status === "disabled") throw new UserError("Your access has been disabled. Contact your access manager.");
  await supabaseAuth.setOwnPassword(password);
  await run("UPDATE users SET status = 'active', failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", now(), row.id);
  await audit({ actorId: row.id, action: row.status === "invited" ? "user.activated" : "user.password_reset", subjectUserId: row.id });
  return toUser((await rowById(row.id))!);
}

export async function changePassword(user: User, current: string, next: string) {
  const row = await rowById(user.id);
  const correct =
    row && (config.authProvider === "supabase" ? await supabaseAuth.passwordIsCorrect(row.email, current) : await verifyPassword(current, row.password_hash));
  if (!correct) throw new UserError("Current password is incorrect.");
  validatePassword(next);
  if (config.authProvider === "supabase") await supabaseAuth.setOwnPassword(next);
  else await run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(next), user.id);
  await audit({ actorId: user.id, action: "user.password_changed", subjectUserId: user.id });
}

// --- Access management ------------------------------------------------------

async function activeAdminCount(): Promise<number> {
  return (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'"))!.n;
}

export async function changeRole(actor: User, userId: string, role: Role) {
  await tx(async () => {
    const row = await rowById(userId);
    if (!row) throw new UserError("User not found.");
    if (row.role === role) return;
    if (row.id === actor.id) throw new UserError("You can't change your own role. Ask another access manager.");
    if (row.role === "admin" && row.status === "active" && (await activeAdminCount()) <= 1) {
      throw new UserError("There must always be at least one active access manager.");
    }
    await run("UPDATE users SET role = ? WHERE id = ?", role, userId);
    await audit({
      actorId: actor.id,
      action: "user.role_changed",
      subjectUserId: userId,
      details: `${ROLE_INFO[row.role].label} → ${ROLE_INFO[role].label}`,
    });
  });
}

export async function setUserEnabled(actor: User, userId: string, enabled: boolean) {
  await tx(async () => {
    const row = await rowById(userId);
    if (!row) throw new UserError("User not found.");
    if (row.id === actor.id) throw new UserError("You can't disable your own account.");
    if (enabled) {
      if (row.status !== "disabled") return;
      await supabaseAuth.setBlocked(row.auth_id, false);
      // Someone who never set a password goes back to "invited".
      const status = row.password_hash || row.last_login_at ? "active" : "invited";
      await run("UPDATE users SET status = ?, failed_logins = 0, locked_until = NULL WHERE id = ?", status, userId);
      await audit({ actorId: actor.id, action: "user.enabled", subjectUserId: userId });
    } else {
      if (row.status === "disabled") return;
      if (row.role === "admin" && row.status === "active" && (await activeAdminCount()) <= 1) {
        throw new UserError("There must always be at least one active access manager.");
      }
      await supabaseAuth.setBlocked(row.auth_id, true);
      await run("UPDATE users SET status = 'disabled' WHERE id = ?", userId);
      await run("DELETE FROM sessions WHERE user_id = ?", userId);
      await run("DELETE FROM auth_tokens WHERE user_id = ? AND used_at IS NULL", userId);
      await audit({ actorId: actor.id, action: "user.disabled", subjectUserId: userId });
    }
  });
}

/** Gives or removes a sales team member's right to approve/reject (others in sales have view access). */
export async function setSalesApprover(actor: User, userId: string, approver: boolean) {
  await tx(async () => {
    const row = await rowById(userId);
    if (!row) throw new UserError("User not found.");
    if (row.role !== "sales") throw new UserError("Only sales team members have approval access to set.");
    if ((row.sales_approver === 1) === approver) return;
    await run("UPDATE users SET sales_approver = ? WHERE id = ?", approver ? 1 : 0, userId);
    await audit({ actorId: actor.id, action: approver ? "user.sales_approver_on" : "user.sales_approver_off", subjectUserId: userId });
  });
}

export async function salesApproverCount(): Promise<number> {
  return (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE role = 'sales' AND status = 'active' AND sales_approver = 1"))!.n;
}
