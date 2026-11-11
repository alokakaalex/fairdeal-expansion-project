"use server";

import { revalidatePath } from "next/cache";
import { isRole } from "@/lib/expansion/roles";
import { requireRole } from "@/lib/server/session";
import { runBackup } from "@/lib/server/backups";
import { verifyFiles } from "@/lib/server/files";
import { updateSettings } from "@/lib/server/settings";
import { changeRole, inviteUser, issueAccessLink, setSalesApprover, setUserEnabled, UserError } from "@/lib/server/users";

export interface AdminFormState {
  error?: string;
  /** Set after issuing an invite or reset link, so the access manager can copy it. */
  link?: { email: string; url: string; emailed: boolean };
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

async function guarded(fn: () => Promise<AdminFormState>): Promise<AdminFormState> {
  try {
    const result = await fn();
    revalidatePath("/admin/users");
    return result;
  } catch (error) {
    if (error instanceof UserError) return { error: error.message };
    throw error;
  }
}

export async function addUser(_: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await requireRole("admin");
  const role = field(formData, "role");
  if (!isRole(role)) return { error: "Choose a role." };
  return guarded(async () => {
    const { user, link } = await inviteUser(actor, {
      email: field(formData, "email"),
      name: field(formData, "name"),
      role,
      salesApprover: field(formData, "salesApprover") === "on",
    });
    return { link: { email: user.email, ...link } };
  });
}

export async function updateUser(_: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await requireRole("admin");
  const userId = field(formData, "userId");
  const intent = field(formData, "intent");
  return guarded(async () => {
    if (intent === "role") {
      const role = field(formData, "role");
      if (!isRole(role)) return { error: "Choose a role." };
      await changeRole(actor, userId, role);
    } else if (intent === "disable" || intent === "enable") {
      await setUserEnabled(actor, userId, intent === "enable");
    } else if (intent === "approver_on" || intent === "approver_off") {
      await setSalesApprover(actor, userId, intent === "approver_on");
    } else if (intent === "link") {
      const link = await issueAccessLink(actor, userId);
      return { link: { email: field(formData, "email"), ...link } };
    }
    return {};
  });
}

export interface SystemState {
  error?: string;
  success?: string;
}

export async function saveSettings(_: SystemState, formData: FormData): Promise<SystemState> {
  const actor = await requireRole("admin");
  const approvals = Number(field(formData, "salesApprovalsRequired"));
  const rejections = Number(field(formData, "salesRejectionsRequired"));
  if (![approvals, rejections].every((n) => Number.isInteger(n) && n >= 1 && n <= 50)) {
    return { error: "Enter whole numbers between 1 and 50." };
  }
  await updateSettings(actor, { salesApprovalsRequired: approvals, salesRejectionsRequired: rejections });
  revalidatePath("/admin/system");
  return { success: "Settings saved." };
}

export async function backupNow(): Promise<SystemState> {
  await requireRole("admin");
  const b = await runBackup("manual");
  revalidatePath("/admin/system");
  return b.error ? { error: b.error } : { success: `Backup ${b.fileName} saved to the ${b.location}.` };
}

export async function verifyStorage(): Promise<SystemState> {
  await requireRole("admin");
  const r = await verifyFiles();
  return r.problems.length
    ? { error: `${r.problems.length} of ${r.checked} files have problems: ${r.problems.slice(0, 10).join("; ")}` }
    : { success: `All ${r.checked} files are present and complete.` };
}
