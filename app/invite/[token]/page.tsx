import type { Metadata } from "next";
import Link from "next/link";
import { SetPasswordForm } from "@/components/portal/AuthForms";
import AuthFrame from "@/components/portal/AuthFrame";
import { Alert } from "@/components/portal/ui";
import { ROLE_INFO } from "@/lib/expansion/roles";
import { inspectToken } from "@/lib/server/users";

export const metadata: Metadata = { title: "Set your password", referrer: "no-referrer" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const link = await inspectToken(token);

  return (
    <AuthFrame>
      <div className="w-full max-w-sm space-y-6">
        <h2 className="text-2xl font-semibold text-navy-950">Set your password</h2>
        {link ? (
          <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(48,51,68,0.25)]">
            <div>
              <p className="text-sm text-slate-700">
                {link.purpose === "invite" ? "Welcome" : "Hi"}, <strong>{link.user.name}</strong>.
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {link.purpose === "invite"
                  ? `You've been given access as ${ROLE_INFO[link.user.role].label}. Choose a password for ${link.user.email}.`
                  : `Choose a new password for ${link.user.email}.`}
              </p>
            </div>
            <SetPasswordForm token={token} email={link.user.email} />
          </div>
        ) : (
          <Alert tone="error">
            This link is invalid, already used, or has expired. Ask your access manager for a new one, or{" "}
            <Link href="/login" className="underline">
              sign in
            </Link>
            .
          </Alert>
        )}
      </div>
    </AuthFrame>
  );
}
