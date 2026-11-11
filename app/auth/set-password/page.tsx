import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewPasswordForm } from "@/components/portal/AuthForms";
import AuthFrame from "@/components/portal/AuthFrame";
import { ROLE_INFO } from "@/lib/expansion/roles";
import { sessionUserAnyStatus } from "@/lib/server/session";

export const metadata: Metadata = { title: "Choose your password" };

// Supabase sign-in: reached from an invite or reset link, which has already
// signed the person in. They choose a password here.
export default async function SetPasswordPage() {
  const user = await sessionUserAnyStatus();
  if (!user) redirect("/login");
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
