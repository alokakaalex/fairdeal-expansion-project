"use client";

import { useActionState } from "react";
import { emailMeALink, login, redeemEmailLink, setPasswordAfterLink, setPasswordFromLink, updatePassword, type FormState } from "@/app/actions/auth";
import { Alert, buttonClass, inputClass } from "./ui";

function Labeled({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Labeled id="email" label="Work email">
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
      </Labeled>
      <Labeled id="password" label="Password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Labeled>
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

const PASSWORD_HINT = "At least 10 characters, with a letter and a number.";

export function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setPasswordFromLink, {});
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers associate the new password with the account. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Labeled id="password" label="New password">
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </Labeled>
      <p className="-mt-2 text-xs text-slate-500">{PASSWORD_HINT}</p>
      <Labeled id="confirm" label="Confirm password">
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </Labeled>
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? "Saving…" : "Set password & sign in"}
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePassword, {});
  return (
    <form action={action} className="max-w-sm space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <Labeled id="current" label="Current password">
        <input id="current" name="current" type="password" autoComplete="current-password" required className={inputClass} />
      </Labeled>
      <Labeled id="next" label="New password">
        <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </Labeled>
      <p className="-mt-2 text-xs text-slate-500">{PASSWORD_HINT}</p>
      <Labeled id="confirm" label="Confirm new password">
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </Labeled>
      <button type="submit" disabled={pending} className={buttonClass.primary}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

/** "Email me a sign-in link" or "Forgot password?" — one email field, one button. */
export function EmailLinkForm({ purpose }: { purpose: "signin" | "reset" }) {
  const [state, action, pending] = useActionState<FormState, FormData>(emailMeALink, {});
  const id = `${purpose}-email`;
  return (
    <form action={action} className="space-y-3">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      <input type="hidden" name="purpose" value={purpose} />
      <Labeled id={id} label="Work email">
        <input id={id} name="email" type="email" autoComplete="username" required className={inputClass} />
      </Labeled>
      <button type="submit" disabled={pending} className={`${buttonClass.secondary} w-full`}>
        {pending ? "Sending…" : purpose === "signin" ? "Email me a sign-in link" : "Email me a reset link"}
      </button>
    </form>
  );
}

/** The click that uses a one-time email link (so link scanners can't use it up). */
export function ConfirmLinkForm({ type, tokenHash, label }: { type: string; tokenHash: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(redeemEmailLink, {});
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="token_hash" value={tokenHash} />
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? "Checking…" : label}
      </button>
    </form>
  );
}

/** Supabase sign-in: choose a password after following an invite or reset link. */
export function NewPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setPasswordAfterLink, {});
  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Labeled id="password" label="New password">
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </Labeled>
      <p className="-mt-2 text-xs text-slate-500">{PASSWORD_HINT}</p>
      <Labeled id="confirm" label="Confirm password">
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
      </Labeled>
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? "Saving…" : "Save password & continue"}
      </button>
    </form>
  );
}
