import Link from "next/link";
import { formatINR, formatNumber } from "@/lib/expansion/format";
import type { User } from "@/lib/expansion/types";
import { isStage, STAGE_INFO, STAGES, type PropertyState } from "@/lib/expansion/workflow";
import { actionQueue, dashboardStats, listProperties, type ListFilter } from "@/lib/server/properties";
import { Icon, type IconName } from "./Icons";
import PropertyTable from "./PropertyTable";
import { buttonClass, Card, inputClass, PageHeader } from "./ui";

const STATES: PropertyState[] = ["active", "on_hold", "rejected", "completed", "draft"];
const STATE_LABEL: Record<PropertyState, string> = {
  active: "In progress",
  on_hold: "On hold",
  rejected: "Rejected",
  completed: "Completed",
  draft: "Drafts",
};

function Stat({ label, value, sub, href, icon, tone = "navy" }: { label: string; value: string | number; sub?: string; href?: string; icon: IconName; tone?: "navy" | "brand" | "green" | "rose" }) {
  const tones = {
    navy: "bg-navy-50 text-navy-700",
    brand: "bg-brand-50 text-brand-600",
    green: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
  };
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-1.5 break-words text-xl font-semibold tabular-nums text-navy-950 sm:text-2xl" style={{ fontFamily: "var(--font-display)" }}>
          {value}
        </div>
        {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
      </div>
      <span className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex ${tones[tone]}`}>
        <Icon name={icon} />
      </span>
    </div>
  );
  const cls = "rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(48,51,68,0.06)]";
  return href ? (
    <Link href={href} className={`${cls} transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** The complete view for the expansion manager, founder and access manager. */
export default async function Dashboard({
  user,
  basePath,
  title,
  subtitle,
  params,
}: {
  user: User;
  basePath: string;
  title: string;
  subtitle: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const stage = one("stage");
  const state = one("state") as PropertyState;
  const q = one("q");
  const filter: ListFilter = isStage(stage) ? { kind: "stage", stage } : STATES.includes(state) ? { kind: "state", state } : { kind: "all" };
  const [properties, stats, mine] = await Promise.all([listProperties(user, filter, q), dashboardStats(), actionQueue(user)]);
  const href = (extra: Record<string, string>) => `${basePath}?${new URLSearchParams({ ...extra, ...(q ? { q } : {}) })}`;
  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
      active ? "bg-navy-800 text-white" : "bg-white text-navy-700 ring-1 ring-slate-200 hover:ring-brand-300"
    }`;
  const inProgress = (stats.byState.active ?? 0) + (stats.byState.on_hold ?? 0);
  const maxStage = Math.max(1, ...STAGES.map((s) => stats.byStage[s] ?? 0));

  return (
    <>
      <PageHeader
        eyebrow="fairdeal.market · Expansion"
        title={title}
        subtitle={subtitle}
        actions={
          <a href="/api/admin/export" className={buttonClass.secondary}>
            Export CSV
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Properties" value={stats.total} sub={`${stats.byState.draft ?? 0} drafts`} href={basePath} icon="building" />
        <Stat label="In pipeline" value={inProgress} sub={`${stats.byState.on_hold ?? 0} on hold`} href={href({ state: "active" })} icon="trend" tone="brand" />
        <Stat label="Completed" value={stats.byState.completed ?? 0} sub={`${formatNumber(stats.completedArea, " sq ft")} onboarded`} href={href({ state: "completed" })} icon="check" tone="green" />
        <Stat label="Rejected" value={stats.byState.rejected ?? 0} href={href({ state: "rejected" })} icon="close" tone="rose" />
        <Stat label="Paid out" value={formatINR(stats.paid.token + stats.paid.balance + stats.paid.stamp_duty)} sub={`Token ${formatINR(stats.paid.token)}`} icon="wallet" />
        <Stat label="Stamp duty" value={formatINR(stats.paid.stamp_duty)} sub={`${stats.stampDutyRequested} pending`} icon="file" tone="brand" />
      </div>

      <Card title="Pipeline at a glance">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-11">
          {STAGES.map((s, i) => {
            const n = stats.byStage[s] ?? 0;
            const on = filter.kind === "stage" && filter.stage === s;
            return (
              <li key={s}>
                <Link
                  href={href({ stage: s })}
                  className={`flex h-full flex-col justify-between rounded-xl border p-2.5 transition ${on ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-brand-300"}`}
                >
                  <span className="text-[0.68rem] font-semibold leading-tight text-slate-500">
                    {i + 1}. {STAGE_INFO[s].label}
                  </span>
                  <span className="mt-2 flex items-end justify-between gap-1">
                    <span className="text-xl font-semibold tabular-nums text-navy-900" style={{ fontFamily: "var(--font-display)" }}>
                      {n}
                    </span>
                    <span className="mb-1 h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-brand-400" style={{ width: `${(n / maxStage) * 100}%` }} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>

      {mine.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-navy-900">
            Needs your action <span className="rounded-full bg-brand-400 px-2 py-0.5 text-xs font-bold text-navy-950">{mine.length}</span>
          </h2>
          <PropertyTable properties={mine} role={user.role} empty="" />
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Link href={basePath} className={chip(filter.kind === "all")}>
              All
            </Link>
            {STATES.map((s) => (
              <Link key={s} href={href({ state: s })} className={chip(filter.kind === "state" && filter.state === s)}>
                {STATE_LABEL[s]} <span className="opacity-60">{stats.byState[s] ?? 0}</span>
              </Link>
            ))}
            {filter.kind === "stage" ? <span className={chip(true)}>{STAGE_INFO[filter.stage].label}</span> : null}
          </div>
          <form className="flex gap-2" action={basePath}>
            {filter.kind === "stage" ? <input type="hidden" name="stage" value={stage} /> : null}
            {filter.kind === "state" ? <input type="hidden" name="state" value={state} /> : null}
            <input name="q" defaultValue={q} placeholder="Search store, address, scout, PR-0001" className={`${inputClass} w-64 sm:w-72`} />
            <button type="submit" className={buttonClass.primary}>
              Search
            </button>
          </form>
        </div>
        <PropertyTable properties={properties} role={user.role} empty="No properties match." />
      </section>
    </>
  );
}
