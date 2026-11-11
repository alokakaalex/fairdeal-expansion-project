import "server-only";
import type { User } from "@/lib/expansion/types";
import { audit } from "./audit";
import { all, now, run } from "./db";

// Settings the access manager can change in the app.

export interface Settings {
  /** Sales approvals needed to approve a property (default 1: the first approval moves it on). */
  salesApprovalsRequired: number;
  /** Sales rejections needed to reject it. */
  salesRejectionsRequired: number;
}

const DEFAULTS: Settings = { salesApprovalsRequired: 1, salesRejectionsRequired: 1 };

export async function getSettings(): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>("SELECT key, value FROM settings");
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) };
}

export async function updateSettings(actor: User, next: Settings) {
  for (const [key, value] of Object.entries(next)) {
    if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error(`Invalid value for ${key}`);
  }
  for (const [key, value] of Object.entries(next)) {
    await run(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      actor.id,
      now(),
    );
  }
  await audit({ actorId: actor.id, action: "settings.updated", details: JSON.stringify(next) });
}
