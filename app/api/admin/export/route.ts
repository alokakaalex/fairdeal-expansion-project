import { formatDate } from "@/lib/expansion/format";
import { statusLabel, STAGES, STAGE_INFO } from "@/lib/expansion/workflow";
import { listProperties } from "@/lib/server/properties";
import { currentUser } from "@/lib/server/session";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  // Prefix formula-looking values so spreadsheets don't execute them.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET() {
  const user = await currentUser();
  if (!user || !["admin", "expansion_manager", "founder"].includes(user.role)) return new Response("Forbidden", { status: 403 });

  const reviews = STAGES.filter((s) => STAGE_INFO[s].kind === "review");
  const header = [
    "Code", "Status", "Round", "Store name", "Address", "Map link", "Total area (sq ft)", "Carpet area (sq ft)",
    "Asking rent", "Security deposit", "Advance rent", "Lock-in (months)", "Structure", "Height (ft)",
    "Rent-free days", "Handover date", "Owners", "Scouted by", "Submitted", "LOI sent",
    ...reviews.flatMap((s) => [`${STAGE_INFO[s].label}`, `${STAGE_INFO[s].label} remarks`]),
    "Token paid", "Token UTR", "Balance paid", "Balance UTR", "Stamp duty paid", "Stamp duty UTR", "Completed",
  ];
  const rows = (await listProperties(user)).map((p) => {
    const last = (s: string) => [...p.decisions].reverse().find((d) => d.round === p.round && d.stage === s);
    const pay = (k: string) => p.payments?.filter((x) => x.kind === k && x.status === "paid") ?? [];
    return [
      p.code, statusLabel(p.state, p.stage), p.round, p.storeName, p.address, p.mapUrl, p.totalAreaSqft, p.carpetAreaSqft,
      p.askingRent, p.securityDeposit, p.advanceRent, p.lockInMonths, p.structureType, p.structureHeightFt,
      p.rentFreeDays, p.handoverDate, p.owners?.map((o) => o.name).join("; "), p.createdByName, formatDate(p.submittedAt), formatDate(p.loiSentAt),
      ...reviews.flatMap((s) => {
        const d = last(s);
        return [d ? `${d.decision} by ${d.decidedByName} on ${formatDate(d.decidedAt)}` : "", d?.remarks];
      }),
      pay("token").reduce((a, x) => a + (x.amount ?? 0), 0) || "", pay("token").map((x) => x.utr).join("; "),
      pay("balance").reduce((a, x) => a + (x.amount ?? 0), 0) || "", pay("balance").map((x) => x.utr).join("; "),
      pay("stamp_duty").reduce((a, x) => a + (x.amount ?? 0), 0) || "", pay("stamp_duty").map((x) => x.utr).join("; "),
      formatDate(p.completedAt),
    ];
  });
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expansion-properties-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
