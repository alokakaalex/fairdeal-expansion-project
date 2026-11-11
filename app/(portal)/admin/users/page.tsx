import type { Metadata } from "next";
import { AddUserForm, UserActions } from "@/components/portal/AccessForms";
import { Card, PageHeader } from "@/components/portal/ui";
import { formatDateTime } from "@/lib/expansion/format";
import { ROLE_INFO, ROLES } from "@/lib/expansion/roles";
import { accessAudit } from "@/lib/server/audit";
import { emailEnabled } from "@/lib/server/mailer";
import { requireRole } from "@/lib/server/session";
import { listUsers } from "@/lib/server/users";

export const metadata: Metadata = { title: "Access & roles" };

const STATUS_TONE = {
  active: "text-emerald-700",
  invited: "text-amber-700",
  disabled: "text-slate-400",
};

const ACTION_LABEL: Record<string, string> = {
  "user.invited": "Invited",
  "user.invite_resent": "New invite link for",
  "user.reset_link": "Password reset link for",
  "user.activated": "Accepted invite",
  "user.password_reset": "Reset password",
  "user.password_changed": "Changed password",
  "user.role_changed": "Changed role of",
  "user.disabled": "Disabled",
  "user.enabled": "Re-enabled",
  "user.locked": "Locked after failed sign-ins:",
  "user.sales_approver_on": "Gave sales approval access to",
  "user.sales_approver_off": "Removed sales approval access from",
  "settings.updated": "Changed settings",
};

export default async function UsersPage() {
  const admin = await requireRole("admin");
  const [users, log] = await Promise.all([listUsers(), accessAudit(50)]);

  return (
    <>
      <PageHeader
        title="Access & roles"
        subtitle="Add people by email and assign a role. Each person lands on their role's portal when they sign in."
      />

      <Card title="Add a person">
        <AddUserForm />
        <p className="mt-3 text-xs text-slate-500">
          {emailEnabled()
            ? "The invite link is emailed to them and also shown here."
            : "Email isn't configured (SMTP_HOST), so copy the invite link shown after adding and send it to them."}{" "}
          Links expire after 7 days and work once.
        </p>
      </Card>

      <Card title="Roles">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r}>
              <dt className="font-medium text-slate-900">
                {ROLE_INFO[r].label} <span className="text-slate-500">({users.filter((u) => u.role === r && u.status !== "disabled").length})</span>
              </dt>
              <dd className="mt-0.5 text-xs text-slate-500">{ROLE_INFO[r].description}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={`People (${users.length})`}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last sign-in</th>
                <th className="px-3 py-2">Role &amp; access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className={u.status === "disabled" ? "opacity-60" : ""}>
                  <td className="px-3 py-3 align-top">
                    <div className="font-medium text-slate-900">{u.name}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                    {u.role === "sales" ? (
                      <div className={`mt-0.5 text-xs font-medium ${u.salesApprover ? "text-emerald-700" : "text-slate-500"}`}>
                        {u.salesApprover ? "✓ Sales approver" : "Sales — view only"}
                      </div>
                    ) : null}
                  </td>
                  <td className={`px-3 py-3 align-top font-medium capitalize ${STATUS_TONE[u.status]}`}>{u.status}</td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-slate-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                  <td className="px-3 py-3 align-top">
                    <UserActions user={u} isSelf={u.id === admin.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Recent access changes">
        {log.length === 0 ? (
          <p className="text-sm text-slate-500">No changes yet.</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {log.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <time className="w-44 shrink-0 text-slate-500">{formatDateTime(h.createdAt)}</time>
                <span className="font-medium text-slate-800">{h.actorName ?? "System"}</span>
                <span className="text-slate-600">
                  {ACTION_LABEL[h.action] ?? h.action} {h.details}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
