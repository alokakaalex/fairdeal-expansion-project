"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ROLE_INFO } from "@/lib/expansion/roles";
import { config } from "@/lib/server/config";
import { DEMO_PASSWORD, DEMO_USERS } from "@/lib/server/demo";
import { addressCheck, endSession, requireUser, sessionUserAnyStatus, startSession } from "@/lib/server/session";
import { confirmLink, googleSignInUrl, LINK_TYPES, type LinkType } from "@/lib/server/supabaseAuth";
import { authenticate, changePassword, finishPasswordSetup, redeemToken, requestEmailLink, UserError } from "@/lib/server/users";

export interface FormState {
  error?: string;
  success?: string;
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  let portal: string;
  try {
    const user = await authenticate(field(formData, "email"), field(formData, "password"));
    await startSession(user.id, (await headers()).get("user-agent"));
    portal = ROLE_INFO[user.role].portal;
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    throw error;
  }
  redirect(portal);
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function setPasswordFromLink(_: FormState, formData: FormData): Promise<FormState> {
  const password = field(formData, "password");
  if (password !== field(formData, "confirm")) return { error: "Passwords don't match." };
  let portal: string;
  try {
    const user = await redeemToken(field(formData, "token"), password);
    await startSession(user.id, (await headers()).get("user-agent"));
    portal = ROLE_INFO[user.role].portal;
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    throw error;
  }
  redirect(portal);
}

export async function updatePassword(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const next = field(formData, "next");
  if (next !== field(formData, "confirm")) return { error: "New passwords don't match." };
  try {
    await changePassword(user, field(formData, "current"), next);
    return { success: "Password updated." };
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    throw error;
  }
}

/** Demo only: one-click sign-in as a sample account. */
export async function demoLogin(formData: FormData) {
  if (!config.demoMode) redirect("/login");
  const account = DEMO_USERS.find((u) => u.id === field(formData, "userId"));
  if (!account) redirect("/login");
  const user = await authenticate(account.email, DEMO_PASSWORD);
  await startSession(user.id, (await headers()).get("user-agent"));
  redirect(ROLE_INFO[user.role].portal);
}

/** "Email me a sign-in link" (Supabase) and "Forgot password" (both). */
export async function emailMeALink(_: FormState, formData: FormData): Promise<FormState> {
  const purpose = field(formData, "purpose") === "reset" ? "reset" : "signin";
  const email = field(formData, "email").trim();
  if (!email) return { error: "Enter your work email." };
  try {
    await requestEmailLink(email, purpose);
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    throw error;
  }
  return { success: `If ${email} has access, a link is on its way. It works once and expires soon.` };
}

/** Continue with Google (Supabase): off to Google, back through /auth/callback. */
export async function signInWithGoogle() {
  if (config.authProvider !== "supabase" || !config.supabase?.google) redirect("/login");
  redirect(await googleSignInUrl());
}

/**
 * The button on /auth/confirm: uses the email link's one-time token, which
 * signs the person in, then sends them on.
 */
export async function redeemEmailLink(_: FormState, formData: FormData): Promise<FormState> {
  if (config.authProvider !== "supabase") {
    const where = await addressCheck();
    return {
      error: `This copy of the portal (${where.here || "this address"}) isn't connected to Supabase sign-in, so the link can't be used here. Open the link at ${where.expected}, or add the Supabase settings to this Vercel project and redeploy.`,
    };
  }
  const type = field(formData, "type") as LinkType;
  const tokenHash = field(formData, "token_hash");
  if (!LINK_TYPES.includes(type) || !tokenHash) return { error: "This link is incomplete. Open it again from the email." };
  if (!(await confirmLink(type, tokenHash))) {
    return { error: "This link has already been used or has expired. Ask for a new one." };
  }
  const user = await sessionUserAnyStatus();
  if (!user) {
    await endSession();
    return { error: "This email doesn't have access to the portal. Ask your access manager to add you." };
  }
  redirect(type === "magiclink" && user.status === "active" ? ROLE_INFO[user.role].portal : "/auth/set-password");
}

/** /auth/set-password (Supabase): choose a password after an invite or reset link. */
export async function setPasswordAfterLink(_: FormState, formData: FormData): Promise<FormState> {
  const user = await sessionUserAnyStatus();
  if (!user) return { error: "Your session from the link has ended before the password was saved. Ask your access manager for a new link and use it straight away." };
  const password = field(formData, "password");
  if (password !== field(formData, "confirm")) return { error: "Passwords don't match." };
  let portal: string;
  try {
    const updated = await finishPasswordSetup(user, password);
    portal = ROLE_INFO[updated.role].portal;
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    if (error instanceof Error) return { error: `Couldn't save the password: ${error.message}` };
    throw error;
  }
  redirect(portal);
}
