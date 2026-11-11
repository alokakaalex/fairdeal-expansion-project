import { ROLE_INFO } from "@/lib/expansion/roles";
import type { User } from "@/lib/expansion/types";
import { actionQueue, listProperties } from "@/lib/server/properties";
import PropertyTable from "./PropertyTable";
import { Alert, PageHeader } from "./ui";

function SectionTitle({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-semibold text-navy-900">
      {children}
      <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-bold text-navy-700">{count}</span>
    </h2>
  );
}

/** Portal home for the review and finance teams: what's waiting on them, then everything they can see. */
export default async function TeamHome({ user, title, waitingLabel }: { user: User; title: string; waitingLabel: string }) {
  const [waiting, all] = await Promise.all([actionQueue(user), listProperties(user)]);
  const waitingIds = new Set(waiting.map((p) => p.id));
  const rest = all.filter((p) => !waitingIds.has(p.id));
  return (
    <>
      <PageHeader eyebrow={ROLE_INFO[user.role].label} title={title} subtitle={ROLE_INFO[user.role].description} />
      {waiting.length === 0 ? <Alert tone="info">Nothing is waiting on you right now. You&apos;ll be notified when something is.</Alert> : null}
      <section className="space-y-3">
        <SectionTitle count={waiting.length}>{waitingLabel}</SectionTitle>
        <PropertyTable properties={waiting} role={user.role} empty="Nothing waiting." />
      </section>
      <section className="space-y-3">
        <SectionTitle count={rest.length}>Everything else you have access to</SectionTitle>
        <PropertyTable properties={rest} role={user.role} empty="Nothing yet." />
      </section>
    </>
  );
}
