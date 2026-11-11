import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmailLinkForm, LoginForm } from "@/components/portal/AuthForms";
import AuthFrame from "@/components/portal/AuthFrame";
import { Alert } from "@/components/portal/ui";
import { ROLE_INFO } from "@/lib/expansion/roles";
import { currentUser } from "@/lib/server/session";
import { countUsers } from "@/lib/server/users";
import { demoLogin, signInWithGoogle } from "@/app/actions/auth";
import { emailEnabled } from "@/lib/server/mailer";
import { config } from "@/lib/server/config";
import { DEMO_PASSWORD, DEMO_USERS } from "@/lib/server/demo";

function DemoAccounts() {
  return (
    <div className="space-y-3 rounded-2xl border border-brand-200 bg-brand-50 p-4">
      <div>
        <p className="text-sm font-semibold text-navy-900">Demo — sign in as any role</p>
        <p className="text-xs text-navy-700">
          Every account&apos;s password is <code className="font-mono">{DEMO_PASSWORD}</code>. Sample data resets from time to time.
        </p>
      </div>
      <div className="grid gap-2">
        {DEMO_USERS.map((u) => (
          <form key={u.id} action={demoLogin}>
            <input type="hidden" name="userId" value={u.id} />
            <button
              type="submit"
              className="flex w-full items-center justify-between rounded-xl border border-brand-100 bg-white px-3 py-2 text-left text-sm transition hover:border-brand-400 hover:shadow-sm"
            >
              <span className="font-semibold text-navy-900">{u.name}</span>
              <span className="text-xs text-slate-500">{u.email}</span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  "no-access": "That account doesn't have access to the portal. Ask your access manager to add your work email.",
  link: "That sign-in link has expired or was already used. Try again.",
};

function GoogleButton() {
  return (
    <form action={signInWithGoogle}>
      <button
        type="submit"
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-navy-900 shadow-sm hover:bg-slate-50"
      >
        <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continue with Google
      </button>
    </form>
  );
}

function MoreOptions({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-navy-800 marker:text-brand-500">{title}</summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

export default async function LoginPage(props: PageProps<"/login">) {
  const user = await currentUser();
  if (user) redirect(ROLE_INFO[user.role].portal);
  const noUsers = !config.demoMode && (await countUsers()) === 0;
  const errorKey = (await props.searchParams).error;
  const error = typeof errorKey === "string" ? ERRORS[errorKey] : undefined;
  const supabase = config.authProvider === "supabase";
  const canEmail = emailEnabled();

  return (
    <AuthFrame>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-navy-950">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use the work email your access manager added.</p>
        </div>
        {noUsers ? (
          <Alert tone="warning">
            No accounts exist yet. Set <code>ADMIN_EMAIL</code> and <code>ADMIN_INITIAL_PASSWORD</code> in the server environment and restart to
            create the first access manager.
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(48,51,68,0.25)]">
          {supabase && config.supabase?.google ? (
            <>
              <GoogleButton />
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" /> or with your password <span className="h-px flex-1 bg-slate-200" />
              </div>
            </>
          ) : null}
          <LoginForm />
        </div>
        {canEmail ? (
          <div className="space-y-2">
            {supabase ? (
              <MoreOptions title="Email me a sign-in link instead">
                <EmailLinkForm purpose="signin" />
              </MoreOptions>
            ) : null}
            <MoreOptions title="Forgot your password?">
              <EmailLinkForm purpose="reset" />
            </MoreOptions>
          </div>
        ) : null}
        {config.demoMode ? <DemoAccounts /> : null}
        <p className="text-xs text-slate-500">
          {canEmail ? "Need access? Ask your access manager to add your work email." : "Forgot your password or need access? Ask your access manager for a new link."}
        </p>
      </div>
    </AuthFrame>
  );
}
