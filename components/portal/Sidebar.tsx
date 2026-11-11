"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogoMark, Wordmark } from "./Brand";
import { Icon, type IconName } from "./Icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  /** Highlight only on an exact path match (for portal homes that are prefixes of other links). */
  exact?: boolean;
}

/**
 * Navy sidebar (fixed on desktop, a drawer on phones) plus the slim top bar
 * that holds the menu button on small screens.
 */
export default function Sidebar({ nav, footer, topRight }: { nav: NavItem[]; footer: ReactNode; topRight: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  const panel = (
    <div className="flex h-full flex-col bg-navy-900 text-navy-100">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <LogoMark className="h-10 w-10 shrink-0" />
        <div className="flex flex-col">
          <Wordmark light />
        </div>
      </div>
      <div className="mx-5 mb-4 rounded-lg bg-white/5 px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-brand-300">Expansion OS</div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {nav.map((item) => {
          const on = active(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                on ? "bg-white/10 text-white" : "text-navy-200 hover:bg-white/5 hover:text-white"
              }`}
            >
              {on ? <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-400" aria-hidden /> : null}
              <Icon name={item.icon} className={`h-5 w-5 ${on ? "text-brand-300" : "text-navy-300 group-hover:text-brand-300"}`} />
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="rounded-full bg-brand-400 px-2 py-0.5 text-[0.7rem] font-bold text-navy-950">{item.badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-3">{footer}</div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{panel}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl">{panel}</aside>
        </div>
      ) : null}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur sm:px-6 lg:ml-64">
        <button type="button" className="rounded-lg p-2 text-navy-800 hover:bg-navy-50 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          <Icon name="menu" />
        </button>
        <Link href="/" className="flex items-center gap-2 lg:hidden">
          <LogoMark className="h-8 w-8" />
        </Link>
        <div className="flex-1" />
        {topRight}
      </header>
    </>
  );
}
