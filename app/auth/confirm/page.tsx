import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmLinkForm } from "@/components/portal/AuthForms";
import AuthFrame from "@/components/portal/AuthFrame";
import { Alert } from "@/components/portal/ui";
import { config } from "@/lib/server/config";
import { addressCheck } from "@/lib/server/session";
import { LINK_TYPES, type LinkType } from "@/lib/server/supabaseAuth";

export const metadata: Metadata = { title: "Continue", referrer: "no-referrer" };

const COPY: Record<LinkType, { title: string; body: string; button: string }> = {
  invite: { title: "Welcome to Expansion OS", body: "Continue to choose your password.", button: "Continue" },
  recovery: { title: "Reset your password", body: "Continue to choose a new password.", button: "Continue" },
  magiclink: { title: "Sign in", body: "Continue to sign in to fairdeal.market Expansion OS.", button: "Sign in" },
};

// Landing page for every emailed link (Supabase sign-in). The one-time
// token is only used when the person presses the button, because email
// security scanners open links automatically and would use it up.
export default async function ConfirmPage(props: PageProps<"/auth/confirm">) {
  const params = await props.searchParams;
  const type = typeof params.type === "string" ? params.type : "";
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";
  const valid = (LINK_TYPES as readonly string[]).includes(type) && tokenHash.length > 0;
  const copy = valid ? COPY[type as LinkType] : null;
  const where = await addressCheck();

  return (
    <AuthFrame>
      <div className="w-full max-w-sm space-y-6">
        <h2 className="text-2xl font-semibold text-navy-950">{copy?.title ?? "Link problem"}</h2>
        {config.authProvider !== "supabase" ? (
          <Alert tone="error">
            This copy of the portal ({where.here}) isn&apos;t connected to Supabase sign-in, so this link can&apos;t work here. The access manager
            should check that this Vercel project has the Supabase settings, or open the link at {where.expected}.
          </Alert>
        ) : !where.ok ? (
          <Alert tone="warning">
            You&apos;re on {where.here}, but the portal&apos;s address is set to {where.expected} (APP_URL). If the next step doesn&apos;t work, open
            the portal at {where.expected} or set APP_URL to https://{where.here} in Vercel and redeploy.
          </Alert>
        ) : null}
        {copy ? (
          <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(48,51,68,0.25)]">
            <p className="text-sm text-slate-600">{copy.body}</p>
            <ConfirmLinkForm type={type} tokenHash={tokenHash} label={copy.button} />
          </div>
        ) : (
          <Alert tone="error">
            This link is incomplete. Open it again from the email, or{" "}
            <Link href="/login" className="underline">
              go to sign in
            </Link>
            .
          </Alert>
        )}
      </div>
    </AuthFrame>
  );
}
