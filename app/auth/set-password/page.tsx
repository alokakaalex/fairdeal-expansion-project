import type { Metadata } from "next";
import Link from "next/link";
import { NewPasswordForm } from "@/components/portal/AuthForms";
import AuthFrame from "@/components/portal/AuthFrame";
import { Alert } from "@/components/portal/ui";
import { ROLE_INFO } from "@/lib/expansion/roles";
import { addressCheck, sessionUserAnyStatus } from "@/lib/server/session";

export const metadata: Metadata = { title: "Choose your password" };

// Supabase sign-in: reached from an invite or reset link, which has already
// signed the person in. They choose a password here.
export default async function SetPasswordPage() {
  const user = await sessionUserAnyStatus();
  if (!user) {
    // Say why, instead of silently showing the sign-in page.
    const where = await addressCheck();
    return (
      <AuthFrame>
        <div className="w-full max-w-sm space-y-4">
          <h2 className="text-2xl font-semibold text-navy-950">Your link didn&apos;t sign you in</h2>
          <Alert tone="error">
            {where.ok ? (
              <>
                The session from your invite or reset link wasn&apos;t found in this browser. Open the link again in the same browser (not an app&apos;s
                built-in browser, and not a private window that has since been closed), or ask your access manager for a new link.
              </>
            ) : (
              <>
                You&apos;re on <strong>{where.here}</strong>, but the portal&apos;s address is set to <strong>{where.expected}</strong>. Ask your access
                manager to send a new link and open it at {where.expected}, or to set APP_URL to https://{where.here} in Vercel and redeploy.
              </>
            )}
          </Alert>
          <Link href="/login" className="text-sm font-semibold text-brand-600 underline-offset-4 hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthFrame>
    );
  }
  const invited = user.status === "invited";

  return (
    <AuthFrame>
      <div className="w-full max-w-sm space-y-6">
        <h2 className="text-2xl font-semibold text-navy-950">{invited ? "Choose your password" : "Choose a new password"}</h2>
        <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(48,51,68,0.25)]">
          <p className="text-sm text-slate-600">
            {invited ? (
              <>
                Welcome, <strong>{user.name}</strong>. You&apos;ve been given access as {ROLE_INFO[user.role].label}. Choose a password for{" "}
                {user.email}.
              </>
            ) : (
              <>Choose a new password for {user.email}.</>
            )}
          </p>
          <NewPasswordForm email={user.email} />
        </div>
      </div>
    </AuthFrame>
  );
}
