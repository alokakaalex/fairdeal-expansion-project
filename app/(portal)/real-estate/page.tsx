import type { Metadata } from "next";
import Link from "next/link";
import PropertyTable from "@/components/portal/PropertyTable";
import { buttonClass, PageHeader } from "@/components/portal/ui";
import { actionQueue, listProperties } from "@/lib/server/properties";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "My properties" };

export default async function RealEstateHome() {
  const user = await requireRole("real_estate");
  const [all, todo] = await Promise.all([listProperties(user), actionQueue(user)]);
  const todoIds = new Set(todo.map((p) => p.id));
  return (
    <>
      <PageHeader
        title="My properties"
        subtitle="Scout and upload properties, then upload owner documents once Ops approves."
        actions={
          <Link href="/real-estate/new" className={buttonClass.primary}>
            + Upload property
          </Link>
        }
      />
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Needs your action ({todo.length})</h2>
        <PropertyTable properties={todo} role={user.role} empty="Nothing needs you right now." />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">In the pipeline ({all.length - todo.length})</h2>
        <PropertyTable properties={all.filter((p) => !todoIds.has(p.id))} role={user.role} empty="Nothing in review yet." />
      </section>
    </>
  );
}
