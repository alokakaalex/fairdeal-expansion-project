import type { ReactNode } from "react";
import { statusLabel, type PropertyState, type Stage } from "@/lib/expansion/workflow";

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:opacity-60";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonClass = {
  primary: `${buttonBase} bg-navy-800 text-white shadow-sm hover:bg-navy-700`,
  accent: `${buttonBase} bg-brand-400 text-navy-950 shadow-sm hover:bg-brand-300`,
  secondary: `${buttonBase} border border-slate-300 bg-white text-navy-800 shadow-sm hover:border-navy-300 hover:bg-navy-50`,
  approve: `${buttonBase} bg-emerald-600 text-white shadow-sm hover:bg-emerald-700`,
  hold: `${buttonBase} bg-violet-600 text-white shadow-sm hover:bg-violet-700`,
  reject: `${buttonBase} bg-rose-600 text-white shadow-sm hover:bg-rose-700`,
  danger: `${buttonBase} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50`,
  link: "text-sm font-semibold text-brand-600 underline-offset-4 hover:underline",
};

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(48,51,68,0.06),0_4px_16px_-8px_rgba(48,51,68,0.12)] sm:p-6 ${className}`}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold text-navy-900">
              <span className="h-4 w-1 rounded-full bg-brand-400" aria-hidden />
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950 sm:text-[1.7rem]">{title}</h1>
        {subtitle ? <div className="mt-1.5 text-sm text-slate-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const STATE_TONE: Record<PropertyState, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-300",
  active: "bg-brand-50 text-brand-700 ring-brand-200",
  on_hold: "bg-violet-50 text-violet-800 ring-violet-300",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  rejected: "bg-rose-50 text-rose-800 ring-rose-300",
};

export function StatusBadge({ state, stage }: { state: PropertyState; stage: Stage | null }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATE_TONE[state]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {statusLabel(state, stage)}
    </span>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "success" | "error" | "warning"; children: ReactNode }) {
  const tones = {
    info: "border-brand-200 bg-brand-50 text-navy-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    error: "border-rose-200 bg-rose-50 text-rose-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
