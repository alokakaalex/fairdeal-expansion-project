"use client";

import { useActionState, useState } from "react";
import { addUser, updateUser, type AdminFormState } from "@/app/actions/admin";
import { ROLE_INFO, ROLES, type Role } from "@/lib/expansion/roles";
import type { User } from "@/lib/expansion/types";
import { Alert, buttonClass, inputClass } from "./ui";

function IssuedLink({ link }: { link: NonNullable<AdminFormState["link"]> }) {
  const [copied, setCopied] = useState(false);
  return (
    <Alert tone="success">
      <p>
        {link.emailed ? `Emailed a sign-in link to ${link.email}. ` : ""}
        Share this one-time link with <strong>{link.email}</strong> so they can set their password
        {link.emailed ? " (if the email doesn't arrive)" : ""}:
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="max-w-full break-all rounded bg-white/70 px-2 py-1 text-xs text-slate-800">
          {link.url}
        </code>
        <button
          type="button"
          className={buttonClass.secondary}
          onClick={async () => {
            await navigator.clipboard.writeText(link.url);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </Alert>
  );
}

function RoleSelect({ name = "role", defaultValue, id, onChange }: { name?: string; defaultValue?: Role; id?: string; onChange?: (r: Role) => void }) {
  return (
    <select id={id} name={name} defaultValue={defaultValue ?? ""} required className={inputClass} onChange={(e) => onChange?.(e.target.value as Role)}>
      {defaultValue ? null : (
        <option value="" disabled>
          Choose a role…
        </option>
      )}
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_INFO[r].label}
        </option>
      ))}
    </select>
  );
}

export function AddUserForm() {
  const [state, action, pending] = useActionState<AdminFormState, FormData>(addUser, {});
  const [role, setRole] = useState<Role | "">("");
  return (
    <div className="space-y-4">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.link ? <IssuedLink link={state.link} /> : null}
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="new-email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <input id="new-email" name="email" type="email" required placeholder="name@company.com" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-name" className="text-sm font-medium text-slate-700">
            Name
          </label>
          <input id="new-name" name="name" required maxLength={120} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-role" className="text-sm font-medium text-slate-700">
            Role
          </label>
          <RoleSelect id="new-role" onChange={setRole} />
        </div>
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Adding…" : "Add & create invite"}
        </button>
        {role === "sales" ? (
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-4">
            <input type="checkbox" name="salesApprover" className="h-4 w-4" />
            Can approve / reject properties (otherwise view only)
          </label>
        ) : null}
      </form>
    </div>
  );
}

export function UserActions({ user, isSelf }: { user: User; isSelf: boolean }) {
  const [state, action, pending] = useActionState<AdminFormState, FormData>(updateUser, {});
  const [role, setRole] = useState<Role>(user.role);
  const hidden = (
    <>
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="email" value={user.email} />
    </>
  );
  if (isSelf) return <span className="text-xs text-slate-500">This is you</span>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={action} className="flex items-center gap-2">
          {hidden}
          <input type="hidden" name="intent" value="role" />
          <select
            name="role"
            aria-label={`Role for ${user.name}`}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={`${inputClass} w-44 py-1.5`}
            disabled={pending || user.status === "disabled"}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_INFO[r].label}
              </option>
            ))}
          </select>
          {role !== user.role ? (
            <button type="submit" disabled={pending} className={`${buttonClass.primary} px-3 py-1.5`}>
              Save
            </button>
          ) : null}
        </form>
        {user.role === "sales" ? (
          <form action={action}>
            {hidden}
            <input type="hidden" name="intent" value={user.salesApprover ? "approver_off" : "approver_on"} />
            <button type="submit" disabled={pending} className={`${buttonClass.secondary} px-3 py-1.5`}>
              {user.salesApprover ? "Remove approval access" : "Give approval access"}
            </button>
          </form>
        ) : null}
        {user.status !== "disabled" ? (
          <form action={action}>
            {hidden}
            <input type="hidden" name="intent" value="link" />
            <button type="submit" disabled={pending} className={`${buttonClass.secondary} px-3 py-1.5`}>
              {user.status === "invited" ? "New invite link" : "Reset password link"}
            </button>
          </form>
        ) : null}
        <form
          action={action}
          onSubmit={(e) => {
            if (user.status !== "disabled" && !confirm(`Disable ${user.name}? They'll be signed out immediately.`)) e.preventDefault();
          }}
        >
          {hidden}
          <input type="hidden" name="intent" value={user.status === "disabled" ? "enable" : "disable"} />
          <button type="submit" disabled={pending} className={`${user.status === "disabled" ? buttonClass.secondary : buttonClass.danger} px-3 py-1.5`}>
            {user.status === "disabled" ? "Re-enable" : "Disable"}
          </button>
        </form>
      </div>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.link ? <IssuedLink link={state.link} /> : null}
    </div>
  );
}
