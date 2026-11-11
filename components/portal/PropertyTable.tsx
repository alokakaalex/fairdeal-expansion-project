import Link from "next/link";
import { formatDate, formatINR, formatNumber } from "@/lib/expansion/format";
import type { Role } from "@/lib/expansion/roles";
import type { PropertyView } from "@/lib/expansion/types";
import { FIELD_VISIBILITY } from "@/lib/expansion/workflow";
import { Icon } from "./Icons";
import { EmptyState, StatusBadge } from "./ui";

function Thumb({ p }: { p: PropertyView }) {
  const photo = p.files.find((f) => f.category === "property_media" && f.kind === "image" && !f.archivedAt && !f.mime.includes("hei"));
  return photo ? (
    // Authenticated file route: next/image's optimizer can't forward the session cookie.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/files/${photo.id}`} alt="" loading="lazy" className="h-11 w-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
  ) : (
    <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-400">
      <Icon name="building" />
    </span>
  );
}

export default function PropertyTable({ properties, role, empty }: { properties: PropertyView[]; role: Role; empty: string }) {
  if (properties.length === 0) return <EmptyState>{empty}</EmptyState>;
  const fields = FIELD_VISIBILITY[role];
  const th = "px-4 py-3 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-slate-500";
  const td = "px-4 py-3 align-middle";
  const money = (["askingRent", "securityDeposit", "advanceRent"] as const).filter((k) => fields.has(k));
  const moneyLabel = { askingRent: "Rent / mo", securityDeposit: "Deposit", advanceRent: "Advance" };
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(48,51,68,0.06)]">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-navy-50/60">
          <tr>
            <th className={th}>Property</th>
            <th className={th}>Status</th>
            <th className={`${th} text-right`}>Area</th>
            {money.map((k) => (
              <th key={k} className={`${th} text-right`}>
                {moneyLabel[k]}
              </th>
            ))}
            <th className={th}>Scouted by</th>
            <th className={th}>Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {properties.map((p) => (
            <tr key={p.id} className="transition-colors hover:bg-brand-50/40">
              <td className={td}>
                <Link href={`/properties/${p.id}`} className="group flex items-center gap-3">
                  <Thumb p={p} />
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900 group-hover:text-brand-600">{p.storeName}</span>
                    <span className="block max-w-xs truncate text-xs text-slate-500">
                      {p.code}
                      {p.round > 1 ? ` · round ${p.round}` : ""}
                      {p.address ? ` · ${p.address}` : ""}
                    </span>
                  </span>
                </Link>
              </td>
              <td className={td}>
                <StatusBadge state={p.state} stage={p.stage} />
              </td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums text-slate-700`}>{formatNumber(p.totalAreaSqft, " sq ft")}</td>
              {money.map((k) => (
                <td key={k} className={`${td} whitespace-nowrap text-right tabular-nums text-slate-700`}>
                  {formatINR(p[k])}
                </td>
              ))}
              <td className={`${td} whitespace-nowrap text-slate-600`}>{p.createdByName}</td>
              <td className={`${td} whitespace-nowrap text-slate-500`}>{formatDate(p.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
