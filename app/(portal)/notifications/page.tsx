import type { Metadata } from "next";
import Link from "next/link";
import { markNotificationsRead } from "@/app/actions/pipeline";
import { buttonClass, EmptyState, PageHeader } from "@/components/portal/ui";
import { formatDateTime } from "@/lib/expansion/format";
import { listNotifications } from "@/lib/server/notifications";
import { requireUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await listNotifications(user.id);
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up."}
        actions={
          unread ? (
            <form action={markNotificationsRead}>
              <button type="submit" className={buttonClass.secondary}>
                Mark all as read
              </button>
            </form>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState>No notifications yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {items.map((n) => (
            <li key={n.id} className={`flex gap-4 px-5 py-4 ${n.readAt ? "" : "bg-sky-50/60"}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-sky-500"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-slate-900">{n.title}</p>
                  <time className="text-xs text-slate-500">{formatDateTime(n.createdAt)}</time>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{n.body}</p>
                <div className="mt-2 flex gap-4">
                  {n.link ? (
                    <Link href={n.link} className={buttonClass.link}>
                      Open property →
                    </Link>
                  ) : null}
                  {!n.readAt ? (
                    <form action={markNotificationsRead}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <button type="submit" className="text-sm text-slate-500 hover:underline">
                        Mark as read
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
