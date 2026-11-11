import { formatDate, formatINR, formatMonths, formatNumber } from "@/lib/expansion/format";
import { STRUCTURE_LABEL } from "@/lib/expansion/propertyInput";
import type { Role } from "@/lib/expansion/roles";
import type { PropertyView } from "@/lib/expansion/types";
import { FIELD_VISIBILITY, type PropertyField } from "@/lib/expansion/workflow";

// Only fields the viewer's role may see are rendered (the server has
// already blanked the rest).
const FACTS: { field: PropertyField; label: string; render: (p: PropertyView) => string }[] = [
  { field: "totalAreaSqft", label: "Total area", render: (p) => formatNumber(p.totalAreaSqft, " sq ft") },
  { field: "carpetAreaSqft", label: "Carpet area", render: (p) => formatNumber(p.carpetAreaSqft, " sq ft") },
  { field: "askingRent", label: "Asking rent / month", render: (p) => formatINR(p.askingRent) },
  { field: "securityDeposit", label: "Security deposit", render: (p) => formatINR(p.securityDeposit) },
  { field: "advanceRent", label: "Advance rent", render: (p) => formatINR(p.advanceRent) },
  { field: "rentFreeDays", label: "Rent-free period", render: (p) => formatNumber(p.rentFreeDays, " days") },
  { field: "lockInMonths", label: "Lock-in period", render: (p) => formatMonths(p.lockInMonths) },
  {
    field: "structureType",
    label: "Structure",
    render: (p) => (p.structureType ? `${STRUCTURE_LABEL[p.structureType]}, ${formatNumber(p.structureHeightFt, " ft")} high` : "—"),
  },
  { field: "handoverDate", label: "Handover date", render: (p) => formatDate(p.handoverDate) },
  { field: "leaseTenureMonths", label: "Lease tenure", render: (p) => formatMonths(p.leaseTenureMonths) },
  { field: "rentEscalationPct", label: "Rent escalation", render: (p) => formatNumber(p.rentEscalationPct, "% per year") },
];

export default function PropertyFacts({ property, role }: { property: PropertyView; role: Role }) {
  const fields = FIELD_VISIBILITY[role];
  const facts = FACTS.filter((f) => fields.has(f.field) && !(f.field === "leaseTenureMonths" && property.leaseTenureMonths == null) && !(f.field === "rentEscalationPct" && property.rentEscalationPct == null));
  const perSqft = property.askingRent && property.carpetAreaSqft ? property.askingRent / property.carpetAreaSqft : null;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.field}>
            <dt className="text-xs uppercase tracking-wide text-slate-500">{f.label}</dt>
            <dd className="mt-0.5 text-base font-medium text-slate-900">{f.render(property)}</dd>
          </div>
        ))}
        {perSqft !== null ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Rent / carpet sq ft</dt>
            <dd className="mt-0.5 text-base font-medium text-slate-900">₹{perSqft.toFixed(2)}</dd>
          </div>
        ) : null}
      </dl>
      {fields.has("notes") && property.notes ? (
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Notes</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{property.notes}</p>
        </div>
      ) : null}
    </div>
  );
}
