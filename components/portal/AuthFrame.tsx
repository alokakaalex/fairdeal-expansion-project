import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "./Brand";

const STEPS = [
  ["Scout", "Real estate uploads the site, media and terms"],
  ["Approve", "Expansion, Business, Sales, Ops and the Founder sign off"],
  ["Onboard", "LOI, documents, agreement and payments — all on record"],
];

/** Split-screen frame for sign-in and set-password pages. */
export default function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen flex-1 lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-400/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-400/10 blur-3xl" />
        <LogoMark className="pointer-events-none absolute -bottom-24 -right-24 h-[26rem] w-[26rem] opacity-[0.07]" />
        <div className="relative flex items-center gap-4">
          <LogoMark className="h-14 w-14" />
          <Wordmark light />
        </div>
        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Expansion OS</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight">Every new store, from first visit to keys in hand.</h1>
          <ol className="mt-10 space-y-5">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sm font-bold text-brand-300">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-navy-200">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="relative text-xs text-navy-300">fairdeal.market · internal use only</p>
      </section>
      <section className="flex items-center justify-center bg-slate-50 px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark className="h-11 w-11" />
            <Wordmark />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
