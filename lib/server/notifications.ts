import "server-only";
import type { Role } from "@/lib/expansion/roles";
import type { Notification } from "@/lib/expansion/types";
import { config } from "./config";
import { all, now, one, run } from "./db";
import { sendEmail } from "./mailer";

export interface NewNotification {
  propertyId: number | null;
  title: string;
  body: string;
  link: string | null;
}

interface Recipient {
  id: string;
  email: string;
}

async function deliver(recipients: Recipient[], n: NewNotification) {
  const at = now();
  for (const r of recipients) {
    await run(
      `INSERT INTO notifications (user_id, property_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      r.id,
      n.propertyId,
      n.title,
      n.body,
      n.link,
      at,
    );
    sendEmail({
      to: r.email,
      subject: n.title,
      text: `${n.body}${n.link ? `\n\nOpen: ${config.appUrl}${n.link}` : ""}`,
    });
  }
}

export async function notifyUser(userId: string, n: NewNotification) {
  const user = await one<Recipient>("SELECT id, email FROM users WHERE id = ? AND status = 'active'", userId);
  if (user) await deliver([user], n);
}

/** Notifies every active member of a team. */
export async function notifyRole(role: Role, n: NewNotification) {
  await deliver(await all<Recipient>("SELECT id, email FROM users WHERE role = ? AND status = 'active'", role), n);
}

interface NotificationRow {
  id: number;
  property_id: number | null;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export async function listNotifications(userId: string, limit = 100): Promise<Notification[]> {
  const rows = await all<NotificationRow>(
    `SELECT id, property_id, title, body, link, read_at, created_at
     FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    userId,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    propertyId: r.property_id,
    title: r.title,
    body: r.body,
    link: r.link,
    readAt: r.read_at,
    createdAt: r.created_at,
  }));
}

export async function unreadCount(userId: string): Promise<number> {
  return (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", userId))!.n;
}

export async function markRead(userId: string, notificationId?: number) {
  if (notificationId === undefined) {
    await run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", now(), userId);
  } else {
    await run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL", now(), userId, notificationId);
  }
}
