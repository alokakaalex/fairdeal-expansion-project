import Link from "next/link";
import { STAGES, type Stage } from "@/lib/expansion/workflow";
import { Icon, type IconName } from "./Icons";

// The pipeline as a journey: a road from "Scouted" to "Store opened", with
// each stage a milestone. A pin above a milestone shows how many properties
// are sitting there right now; clicking a milestone filters the list below.

const MILESTONE: Record<Stage, { short: string; icon: IconName }> = {
  em_review: { short: "Expansion review", icon: "check" },
  bl_review: { short: "Business leaders", icon: "briefcase" },
  sales_review: { short: "Sales review", icon: "trend" },
  ops_review: { short: "Ops site visit", icon: "hardhat" },
  documents: { short: "Owner documents", icon: "file" },
  loi: { short: "LOI issued", icon: "upload" },
  signed_loi: { short: "LOI signed", icon: "signature" },
  founder_review: { short: "Founder approval", icon: "crown" },
  token_payment: { short: "Token paid", icon: "wallet" },
  agreement: { short: "Agreement signed", icon: "handshake" },
  balance_payment: { short: "Balance paid", icon: "wallet" },
};

const CHAPTERS: { title: string; stages: Stage[]; tone: string }[] = [
  { title: "Approvals", stages: ["em_review", "bl_review", "sales_review", "ops_review"], tone: "text-brand-700" },
  { title: "Paperwork", stages: ["documents", "loi", "signed_loi"], tone: "text-violet-700" },
  { title: "Deal closing", stages: ["founder_review", "token_payment", "agreement", "balance_payment"], tone: "text-emerald-700" },
];

const CHAPTER_OF = Object.fromEntries(CHAPTERS.flatMap((c, i) => c.stages.map((s) => [s, i]))) as Record<Stage, number>;
const NODE_TONE = [
  "bg-brand-500 ring-brand-100", // approvals
  "bg-violet-500 ring-violet-100", // paperwork
  "bg-emerald-500 ring-emerald-100", // closing
];

function Pin({ count, active }: { count: number; active: boolean }) {
  if (!count) return <span className="h-9" aria-hidden />;
  return (
    <span className="relative flex h-9 flex-col items-center" title={`${count} ${count === 1 ? "property is" : "properties are"} here`}>
      <span
        className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold shadow-sm ring-2 ring-white ${
          active ? "bg-navy-900 text-white" : "bg-amber-400 text-navy-950"
        }`}
      >
        {count}
      </span>
      <span className={`-mt-1 h-2 w-2 rotate-45 ${active ? "bg-navy-900" : "bg-amber-400"}`} aria-hidden />
    </span>
  );
}

export default function PipelineRoadmap({
  byStage,
  drafts,
  completed,
  selected,
  href,
}: {
  byStage: Partial<Record<Stage, number>>;
  drafts: number;
  completed: number;
  selected: Stage | null;
  href: (stage: Stage) => string;
}) {
  const onTheRoad = STAGES.reduce((n, s) => n + (byStage[s] ?? 0), 0);
  // Name the busiest milestone only when one clearly stands out.
  const counts = STAGES.map((s) => byStage[s] ?? 0);
  const top = Math.max(0, ...counts);
  const busiest = top > 1 && counts.filter((n) => n === top).length === 1 ? STAGES[counts.indexOf(top)] : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(48,51,68,0.06),0_4px_16px_-8px_rgba(48,51,68,0.12)]">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 pb-4 pt-5 sm:px-6">
        <div>
          <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold text-navy-900">
            <span className="h-4 w-1 rounded-full bg-brand-400" aria-hidden />
            The road to a new store
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {onTheRoad} {onTheRoad === 1 ? "property" : "properties"} on the road
            {busiest ? (
              <>
                {" "}
                · most are at <span className="font-medium text-navy-800">{MILESTONE[busiest].short}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white" /> properties waiting there
          </span>
        </div>
      </div>

      {/* Desktop: the road runs left to right */}
      <div className="hidden overflow-x-auto px-4 pb-6 pt-4 lg:block">
        <div className="min-w-[840px]">
          {/* Chapter labels over their stretch of road */}
          <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] text-center">
            <span />
            {CHAPTERS.map((c) => (
              <div key={c.title} className="px-1" style={{ gridColumn: `span ${c.stages.length} / span ${c.stages.length}` }}>
                <div className={`text-[0.68rem] font-bold uppercase tracking-[0.14em] ${c.tone}`}>{c.title}</div>
                <div className="mx-3 mt-1 h-2 rounded-t-md border-x border-t border-slate-200" />
              </div>
            ))}
            <span />
          </div>

          <ol className="relative grid grid-cols-[repeat(13,minmax(0,1fr))]">
            {/* The road: a dashed centre line on a soft band, through every milestone */}
            <span className="pointer-events-none absolute left-[3.85%] right-[3.85%] top-[49px] h-3.5 rounded-full bg-gradient-to-r from-slate-200 via-slate-200 to-emerald-200" aria-hidden />
            <span className="pointer-events-none absolute left-[3.85%] right-[3.85%] top-[55px] border-t-2 border-dashed border-white" aria-hidden />

            <li className="relative flex flex-col items-center text-center">
              <Pin count={drafts} active={false} />
              <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-xl bg-navy-800 text-white shadow ring-4 ring-navy-100">
                <Icon name="map" className="h-5 w-5" />
              </span>
              <span className="mt-2 text-[0.72rem] font-semibold leading-tight text-navy-900">Scouted</span>
              <span className="text-[0.68rem] text-slate-500">{drafts} draft{drafts === 1 ? "" : "s"}</span>
            </li>

            {STAGES.map((s, i) => {
              const n = byStage[s] ?? 0;
              const on = selected === s;
              return (
                <li key={s} className="relative">
                  <Link
                    href={href(s)}
                    aria-current={on ? "true" : undefined}
                    className={`group flex flex-col items-center rounded-xl pb-2 text-center transition ${on ? "bg-brand-50" : "hover:bg-slate-50"}`}
                  >
                    <Pin count={n} active={on} />
                    <span
                      className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full shadow ring-4 transition group-hover:scale-110 ${
                        n ? `text-white ${NODE_TONE[CHAPTER_OF[s]]}` : "border border-slate-200 bg-white text-slate-400 ring-white"
                      } ${on ? "scale-110" : ""}`}
                    >
                      <Icon name={MILESTONE[s].icon} className="h-[18px] w-[18px]" />
                    </span>
                    <span className="mt-2 text-[0.62rem] font-bold text-slate-400">STEP {i + 1}</span>
                    <span className={`px-1 text-[0.72rem] font-semibold leading-tight ${n ? "text-navy-900" : "text-slate-500"}`}>{MILESTONE[s].short}</span>
                  </Link>
                </li>
              );
            })}

            <li className="relative flex flex-col items-center text-center">
              <Pin count={0} active={false} />
              <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow ring-4 ring-emerald-100">
                <Icon name="flag" className="h-5 w-5" />
              </span>
              <span className="mt-2 text-[0.72rem] font-semibold leading-tight text-navy-900">Store opened</span>
              <span className="text-[0.68rem] font-semibold text-emerald-700">{completed} done</span>
            </li>
          </ol>
        </div>
      </div>

      {/* Phones and tablets: the road runs top to bottom */}
      <div className="px-5 py-5 lg:hidden">
        <ol className="relative space-y-1 before:absolute before:bottom-6 before:left-[19px] before:top-6 before:w-1 before:rounded-full before:bg-slate-200">
          <li className="relative flex items-center gap-4 py-1.5">
            <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-800 text-white ring-4 ring-white">
              <Icon name="map" className="h-5 w-5" />
            </span>
            <span className="flex-1 text-sm font-semibold text-navy-900">Scouted</span>
            <span className="text-xs text-slate-500">
              {drafts} draft{drafts === 1 ? "" : "s"}
            </span>
          </li>
          {CHAPTERS.map((c) => (
            <li key={c.title} className="space-y-1">
              <div className={`ml-14 pt-2 text-[0.68rem] font-bold uppercase tracking-[0.14em] ${c.tone}`}>{c.title}</div>
              <ol className="space-y-1">
                {c.stages.map((s) => {
                  const n = byStage[s] ?? 0;
                  const on = selected === s;
                  return (
                    <li key={s}>
                      <Link href={href(s)} className={`relative flex items-center gap-4 rounded-xl py-1.5 pr-2 ${on ? "bg-brand-50" : ""}`}>
                        <span
                          className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${
                            n ? `${NODE_TONE[CHAPTER_OF[s]].split(" ")[0]} text-white` : "border border-slate-200 bg-white text-slate-400"
                          }`}
                        >
                          <Icon name={MILESTONE[s].icon} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.62rem] font-bold text-slate-400">STEP {STAGES.indexOf(s) + 1}</span>
                          <span className={`block text-sm font-semibold ${n ? "text-navy-900" : "text-slate-500"}`}>{MILESTONE[s].short}</span>
                        </span>
                        {n ? (
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${on ? "bg-navy-900 text-white" : "bg-amber-400 text-navy-950"}`}>{n}</span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
          <li className="relative flex items-center gap-4 pt-2">
            <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white ring-4 ring-white">
              <Icon name="flag" className="h-5 w-5" />
            </span>
            <span className="flex-1 text-sm font-semibold text-navy-900">Store opened</span>
            <span className="text-xs font-semibold text-emerald-700">{completed} done</span>
          </li>
        </ol>
      </div>
    </section>
  );
}
