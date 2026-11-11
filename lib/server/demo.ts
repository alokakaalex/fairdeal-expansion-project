import "server-only";
import { createHash } from "node:crypto";
import type { PropertyInput } from "@/lib/expansion/propertyInput";
import type { Role } from "@/lib/expansion/roles";
import type { User } from "@/lib/expansion/types";
import type { FileCategory, Stage } from "@/lib/expansion/workflow";
import { config } from "./config";
import { hashPasswordSync } from "./crypto";
import { now, one, run } from "./db";
import { DEMO_ASSETS, type DemoAsset } from "./demoAssets";
import { storeBytes } from "./files";
import * as pipeline from "./pipeline";
import { createProperty, submitProperty } from "./properties";
import { getUser } from "./users";

// Demo environment: one account per role (shown on the sign-in page) and
// eight sample properties spread across the pipeline, so the whole flow can
// be shown without setting anything up. Seeded once per fresh database;
// ids are deterministic so every server instance serves the same data.

export const DEMO_PASSWORD = "Demo@12345";

export const DEMO_USERS: { id: string; email: string; name: string; role: Role; salesApprover?: boolean }[] = [
  { id: "demo-admin", email: "admin@demo.fairdeal.in", name: "Aarti (Access Manager)", role: "admin" },
  { id: "demo-em", email: "expansion@demo.fairdeal.in", name: "Esha (Expansion Manager)", role: "expansion_manager" },
  { id: "demo-re", email: "realestate@demo.fairdeal.in", name: "Ravi (Real Estate)", role: "real_estate" },
  { id: "demo-bl", email: "business@demo.fairdeal.in", name: "Bina (Business Leader)", role: "business" },
  { id: "demo-sales", email: "sales@demo.fairdeal.in", name: "Sonal (Sales approver)", role: "sales", salesApprover: true },
  { id: "demo-sales-view", email: "sales.viewer@demo.fairdeal.in", name: "Sameer (Sales, view only)", role: "sales" },
  { id: "demo-ops", email: "ops@demo.fairdeal.in", name: "Om (Ops)", role: "ops" },
  { id: "demo-founder", email: "founder@demo.fairdeal.in", name: "Farhan (Founder)", role: "founder" },
  { id: "demo-finance", email: "finance@demo.fairdeal.in", name: "Fiona (Finance)", role: "finance" },
];

let fileSeq = 0;
function fileId(): string {
  const h = createHash("sha256").update(`demo-file-${++fileSeq}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function put(user: User, propertyId: number, category: FileCategory, asset: DemoAsset, name: string, ownerId?: number) {
  const { mime, data } = DEMO_ASSETS[asset];
  await storeBytes(user, propertyId, { fileId: fileId(), category, ownerId: ownerId ?? null, mime, name, bytes: Buffer.from(data, "base64") });
}

const BASE: Omit<PropertyInput, "storeName" | "address" | "mapUrl" | "latitude" | "longitude"> = {
  totalAreaSqft: 6000,
  carpetAreaSqft: 5500,
  askingRent: 160000,
  securityDeposit: 480000,
  advanceRent: 160000,
  lockInMonths: 36,
  structureType: "rcc",
  structureHeightFt: 18,
  rentFreeDays: 30,
  handoverDate: "2026-11-15",
  leaseTenureMonths: 108,
  rentEscalationPct: 5,
  notes: "",
};

interface Scenario {
  name: string;
  area: string;
  lat: number;
  lng: number;
  overrides?: Partial<PropertyInput>;
  /** Run the pipeline up to (not including) this stage; "done" completes it. */
  until: Stage | "done";
  end?: "em_reject" | "bl_hold";
  stampDuty?: "requested" | "paid";
}

const SCENARIOS: Scenario[] = [
  { name: "Rohini Sec-7 Dark Store", area: "Plot 12, Sector 7, Rohini, New Delhi 110085", lat: 28.7159, lng: 77.1146, until: "done", stampDuty: "paid",
    overrides: { totalAreaSqft: 6500, carpetAreaSqft: 6000, askingRent: 185000, securityDeposit: 555000, advanceRent: 185000, notes: "Corner plot, 40 ft road frontage." } },
  { name: "Saket Express Store", area: "B-14, Press Enclave Marg, Saket, New Delhi 110017", lat: 28.5245, lng: 77.2066, until: "agreement", stampDuty: "requested",
    overrides: { totalAreaSqft: 4200, carpetAreaSqft: 3900, askingRent: 210000, securityDeposit: 630000, advanceRent: 210000, structureType: "rcc", structureHeightFt: 14 } },
  { name: "Pitampura Kirana Hub", area: "LU Block, Pitampura, New Delhi 110034", lat: 28.6981, lng: 77.1383, until: "founder_review",
    overrides: { totalAreaSqft: 5200, carpetAreaSqft: 4800, askingRent: 140000, securityDeposit: 420000, advanceRent: 140000 } },
  { name: "Janakpuri Warehouse", area: "C-2B, Janakpuri, New Delhi 110058", lat: 28.6219, lng: 77.0878, until: "documents",
    overrides: { totalAreaSqft: 8000, carpetAreaSqft: 7400, askingRent: 190000, structureType: "shed", structureHeightFt: 24 } },
  { name: "Dwarka Sec-12 Store", area: "Plot 7, Sector 12, Dwarka, New Delhi 110075", lat: 28.5921, lng: 77.0460, until: "sales_review",
    overrides: { totalAreaSqft: 5600, carpetAreaSqft: 5100, askingRent: 150000 } },
  { name: "Mayur Vihar Outlet", area: "Pocket 1, Mayur Vihar Phase 1, Delhi 110091", lat: 28.6048, lng: 77.2947, until: "bl_review", end: "bl_hold",
    overrides: { structureType: "tin", structureHeightFt: 16, askingRent: 120000 } },
  { name: "Laxmi Nagar Shop", area: "Vikas Marg, Laxmi Nagar, Delhi 110092", lat: 28.6304, lng: 77.2773, until: "em_review", end: "em_reject",
    overrides: { totalAreaSqft: 2800, carpetAreaSqft: 2500, askingRent: 175000 } },
  { name: "Okhla Ph-2 Godown", area: "Okhla Industrial Area Phase 2, New Delhi 110020", lat: 28.5355, lng: 77.2732, until: "em_review",
    overrides: { totalAreaSqft: 9500, carpetAreaSqft: 9000, askingRent: 230000, structureType: "shed", structureHeightFt: 28 } },
];

const ORDER: (Stage | "done")[] = [
  "em_review", "bl_review", "sales_review", "ops_review", "documents", "loi", "signed_loi",
  "founder_review", "token_payment", "agreement", "balance_payment", "done",
];

async function runScenario(u: Record<string, User>, s: Scenario, index: number) {
  const input: PropertyInput = {
    ...BASE,
    storeName: s.name,
    address: s.area,
    mapUrl: `https://www.google.com/maps/@${s.lat},${s.lng},17z`,
    latitude: s.lat,
    longitude: s.lng,
    ...s.overrides,
  };
  const id = await createProperty(u.re, input);
  await put(u.re, id, "property_media", "front", "shop-front.jpg");
  await put(u.re, id, "property_media", "interior", "interior.jpg");
  await put(u.re, id, "property_media", "loading", "loading-bay.jpg");
  await submitProperty(u.re, id);
  const reach = (stage: Stage | "done") => ORDER.indexOf(s.until) > ORDER.indexOf(stage);

  if (s.end === "em_reject") {
    await pipeline.decide(u.em, id, "rejected", "Rent is ~40% above comparable shops on Vikas Marg and carpet area is too small for a dark store.");
    return;
  }
  if (!reach("em_review")) return;
  await pipeline.decide(u.em, id, "approved", "Good catchment and access; rent in line with the area.");
  if (s.end === "bl_hold") {
    await pipeline.decide(u.bl, id, "hold", "Hold until the Q3 East Delhi budget is signed off.");
    return;
  }
  if (!reach("bl_review")) return;
  await pipeline.decide(u.bl, id, "approved", "Fits the city expansion plan and budget.");
  if (!reach("sales_review")) return;
  await pipeline.decide(u.sales, id, "approved", "Dense residential catchment within 2 km; strong order density.");
  if (!reach("ops_review")) return;
  await put(u.ops, id, "ops_media", "site", "site-visit.jpg");
  await pipeline.saveVisit(u.ops, id, {
    visited: true,
    scopeOfWork: "1. Repaint interior and shutters\n2. 63A 3-phase electrical connection\n3. Epoxy flooring\n4. Two new rolling shutters at the loading bay",
  });
  await pipeline.decide(u.ops, id, "approved", "Structure sound; loading bay fits a 14 ft truck.");
  if (!reach("documents")) return;
  const ownerId = await pipeline.addOwner(u.re, id, {
    name: index % 2 ? "Sunita Aggarwal" : "R. K. Sharma",
    email: index % 2 ? "sunita.owner@example.com" : "rk.owner@example.com",
    phone: "9876543210",
    isOrganisation: false,
    gstNumber: "",
    panNumber: "ABCDE1234F",
    bankAccountName: index % 2 ? "Sunita Aggarwal" : "R K Sharma",
    bankAccountNumber: "123456789012",
    bankIfsc: "HDFC0001234",
    bankName: "HDFC Bank",
  });
  await put(u.re, id, "aadhaar_front", "aadhaar", "aadhaar-front.jpg", ownerId);
  await put(u.re, id, "aadhaar_back", "aadhaar", "aadhaar-back.jpg", ownerId);
  await put(u.re, id, "pan_card", "pan", "pan.jpg", ownerId);
  await put(u.re, id, "electricity_bill", "bill", "electricity-bill.pdf");
  await put(u.re, id, "lease_deed", "bill", "registered-lease-deed.pdf");
  await put(u.re, id, "property_tax_receipt", "bill", "property-tax-receipt.pdf");
  await pipeline.completeDocuments(u.re, id);
  if (!reach("loi")) return;
  await put(u.em, id, "loi", "loi", "LOI.pdf");
  await pipeline.sendLoi(u.em, id);
  await put(u.em, id, "signed_loi", "loi", "LOI-signed.pdf");
  await pipeline.confirmSignedLoi(u.em, id);
  if (!reach("founder_review")) return;
  await pipeline.decide(u.founder, id, "approved", "Approved. Proceed with the token and agreement.");
  if (!reach("token_payment")) return;
  await put(u.finance, id, "token_receipt", "receipt", "token-utr.pdf");
  await pipeline.recordPayment(u.finance, id, "token", { amount: 100000, utr: `HDFCN5202610${String(id).padStart(7, "0")}`, paidOn: now().slice(0, 10), notes: "" });
  if (s.stampDuty) {
    await put(u.em, id, "stamp_duty_calculation", "bill", "stamp-duty-calculation.pdf");
    await pipeline.requestStampDuty(u.em, id, { amount: 42000, remarks: "Owner wants the lease registered." });
  }
  if (!reach("agreement")) return;
  await put(u.em, id, "agreement", "agreement", "lease-agreement-notarised.pdf");
  await pipeline.confirmAgreement(u.em, id);
  if (!reach("balance_payment")) return;
  await put(u.finance, id, "balance_receipt", "receipt", "balance-utr.pdf");
  const balance = (input.securityDeposit + input.advanceRent) - 100000;
  await pipeline.recordPayment(u.finance, id, "balance", { amount: balance, utr: `HDFCN5202611${String(id).padStart(7, "0")}`, paidOn: now().slice(0, 10), notes: "" });
  if (s.stampDuty === "paid") {
    const request = (await one<{ id: number }>("SELECT id FROM payments WHERE property_id = ? AND kind = 'stamp_duty'", id))!;
    await put(u.finance, id, "stamp_duty_receipt", "receipt", "stamp-duty-utr.pdf");
    await pipeline.payStampDuty(u.finance, request.id, { amount: 42000, utr: `SBIN0STAMP${String(id).padStart(6, "0")}`, paidOn: now().slice(0, 10), notes: "" });
  }
}

async function seed() {
  if ((await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users"))!.n > 0) return;
  const hash = hashPasswordSync(DEMO_PASSWORD);
  for (const d of DEMO_USERS) {
    await run(
      "INSERT INTO users (id, email, name, role, status, sales_approver, password_hash, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
      d.id,
      d.email,
      d.name,
      d.role,
      d.salesApprover ? 1 : 0,
      hash,
      now(),
    );
  }
  const u: Record<string, User> = {};
  for (const [k, id] of [["admin", "demo-admin"], ["em", "demo-em"], ["re", "demo-re"], ["bl", "demo-bl"], ["sales", "demo-sales"], ["ops", "demo-ops"], ["founder", "demo-founder"], ["finance", "demo-finance"]]) {
    u[k] = (await getUser(id))!;
  }
  fileSeq = 0;
  // Oldest first, so the dashboard lists the newest-looking ones at the top.
  for (const [i, s] of [...SCENARIOS].reverse().entries()) await runScenario(u, s, i);
}

let seeding: Promise<void> | null = null;

/** Seeds the demo data once per database (no-op outside demo mode). */
export function ensureDemo(): Promise<void> {
  if (!config.demoMode) return Promise.resolve();
  seeding ??= seed().catch((error) => {
    console.error("[demo] seeding failed", error);
    seeding = null;
  });
  return seeding;
}
