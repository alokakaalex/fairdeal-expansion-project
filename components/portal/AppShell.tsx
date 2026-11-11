import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/actions/auth";
import { ROLE_INFO } from "@/lib/expansion/roles";
import type { User } from "@/lib/expansion/types";
import { unreadCount } from "@/lib/server/notifications";
import { queueCount } from "@/lib/server/properties";
import { Icon } from "./Icons";
import Sidebar, { type NavItem } from "./Sidebar";

async function navFor(user: User): Promise<NavItem[]> {
  const portal = ROLE_INFO[user.role].portal;
  const waiting = await queueCount(user);
  const calc: NavItem = { href: "/calculator", label: "Electrical calculator", icon: "calculator" };
  const common: NavItem[] = [{ href: "/notifications", label: "Notifications", icon: "bell" }];
  switch (user.role) {
    case "admin":
      return [
        { href: "/admin", label: "Dashboard", icon: "dashboard", exact: true },
        { href: "/admin/users", label: "People & roles", icon: "users" },
        { href: "/admin/system", label: "Data & backups", icon: "database" },
        ...common,
        calc,
      ];
    case "expansion_manager":
      return [{ href: portal, label: "Dashboard", icon: "dashboard", badge: waiting }, ...common, calc];
    case "real_estate":
      return [
        { href: portal, label: "My properties", icon: "building", badge: waiting, exact: true },
        { href: "/real-estate/new", label: "Scout a property", icon: "plus" },
        ...common,
      ];
    case "business":
      return [{ href: portal, label: "Approvals", icon: "briefcase", badge: waiting }, ...common];
    case "sales":
      return [{ href: portal, label: "Sales review", icon: "trend", badge: waiting }, ...common];
    case "ops":
      return [{ href: portal, label: "Site visits", icon: "hardhat", badge: waiting }, ...common, calc];
    case "founder":
      return [{ href: portal, label: "Dashboard", icon: "crown", badge: waiting }, ...common];
    case "finance":
      return [{ href: portal, label: "Payments", icon: "wallet", badge: waiting }, ...common];
  }
}

function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function AppShell({ user, banner, children }: { user: User; banner?: ReactNode; children: ReactNode }) {
  const [nav, unread] = await Promise.all([navFor(user), unreadCount(user.id)]);
  const footer = (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2">
      <Link href="/account" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-400 text-sm font-bold text-navy-950">{initials(user.name)}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
          <span className="block truncate text-xs text-navy-300">{ROLE_INFO[user.role].label}</span>
        </span>
      </Link>
      <form action={logout}>
        <button type="submit" title="Sign out" className="rounded-lg p-2 text-navy-300 hover:bg-white/10 hover:text-white">
          <Icon name="logout" className="h-[18px] w-[18px]" />
        </button>
      </form>
    </div>
  );
  const topRight = (
    <div className="flex items-center gap-2">
      <span className="hidden rounded-full bg-navy-50 px-3 py-1 text-xs font-semibold text-navy-700 sm:inline">{ROLE_INFO[user.role].label}</span>
      <Link href="/notifications" className="relative rounded-full p-2 text-navy-700 hover:bg-navy-50" aria-label={`Notifications (${unread} unread)`}>
        <Icon name="bell" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[0.65rem] font-bold text-white ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Link>
    </div>
  );
  return (
    <div className="min-h-screen">
      <Sidebar nav={nav} footer={footer} topRight={topRight} />
      <div className="lg:pl-64">
        {banner}
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
