// The property pipeline, and who may see what at each point. Pure (no I/O)
// so the rules are unit tested and shared by the server and the UI.

import type { Role } from "./roles";

// --- Stages -----------------------------------------------------------------

// The steps a property moves through, in order. "review" stages record a
// decision; "task" stages finish when their owner completes the work.
export const STAGES = [
  "em_review",
  "bl_review",
  "sales_review",
  "ops_review",
  "documents",
  "loi",
  "signed_loi",
  "founder_review",
  "token_payment",
  "agreement",
  "balance_payment",
] as const;
export type Stage = (typeof STAGES)[number];

export type Decision = "approved" | "rejected" | "hold";

export interface StageInfo {
  label: string;
  /** Who acts at this stage. */
  actor: Role;
  kind: "review" | "task";
  /** Decisions a review stage offers. */
  decisions: readonly Decision[];
  /** Shown while the property waits here. */
  waiting: string;
}

export const STAGE_INFO: Record<Stage, StageInfo> = {
  em_review: { label: "Expansion Manager review", actor: "expansion_manager", kind: "review", decisions: ["approved", "rejected"], waiting: "Awaiting Expansion Manager" },
  bl_review: { label: "Business Leaders review", actor: "business", kind: "review", decisions: ["approved", "hold", "rejected"], waiting: "Awaiting Business Leaders" },
  sales_review: { label: "Sales review", actor: "sales", kind: "review", decisions: ["approved", "rejected"], waiting: "Awaiting Sales" },
  ops_review: { label: "Ops site visit", actor: "ops", kind: "review", decisions: ["approved", "rejected"], waiting: "Awaiting Ops visit" },
  documents: { label: "Owner & property documents", actor: "real_estate", kind: "task", decisions: [], waiting: "Awaiting documents" },
  loi: { label: "LOI issued", actor: "expansion_manager", kind: "task", decisions: [], waiting: "Awaiting LOI" },
  signed_loi: { label: "Signed LOI", actor: "expansion_manager", kind: "task", decisions: [], waiting: "Awaiting signed LOI" },
  founder_review: { label: "Founder approval", actor: "founder", kind: "review", decisions: ["approved", "hold", "rejected"], waiting: "Awaiting Founder" },
  token_payment: { label: "Token released", actor: "finance", kind: "task", decisions: [], waiting: "Awaiting token release" },
  agreement: { label: "Signed agreement", actor: "expansion_manager", kind: "task", decisions: [], waiting: "Awaiting signed agreement" },
  balance_payment: { label: "Balance released", actor: "finance", kind: "task", decisions: [], waiting: "Awaiting balance payment" },
};

export const DECISION_LABEL: Record<Decision, string> = {
  approved: "Approved",
  rejected: "Rejected",
  hold: "On hold",
};

export type PropertyState = "draft" | "active" | "on_hold" | "rejected" | "completed";

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export function nextStage(stage: Stage): Stage | null {
  return STAGES[stageIndex(stage) + 1] ?? null;
}

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

/** Result of a decision at a review stage. */
export function afterDecision(stage: Stage, decision: Decision): { stage: Stage; state: PropertyState } {
  if (decision === "rejected") return { stage, state: "rejected" };
  if (decision === "hold") return { stage, state: "on_hold" };
  const next = nextStage(stage);
  return next ? { stage: next, state: "active" } : { stage, state: "completed" };
}

/** Result of completing a task stage. */
export function afterTask(stage: Stage): { stage: Stage; state: PropertyState } {
  const next = nextStage(stage);
  return next ? { stage: next, state: "active" } : { stage, state: "completed" };
}

export function statusLabel(state: PropertyState, stage: Stage | null): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "completed":
      return "Completed";
    case "rejected":
      return stage ? `Rejected — ${STAGE_INFO[stage].label}` : "Rejected";
    case "on_hold":
      return stage ? `On hold — ${STAGE_INFO[stage].label}` : "On hold";
    case "active":
      return stage ? STAGE_INFO[stage].waiting : "In progress";
  }
}

/** Only the uploader edits property details, and only before review or after a rejection. */
export function isEditable(state: PropertyState): boolean {
  return state === "draft" || state === "rejected";
}

/** Roles that may raise a stamp duty request (sent to Finance). */
export const STAMP_DUTY_REQUESTERS: readonly Role[] = ["expansion_manager", "admin"];

/** Which stages a role acts on. */
export function stagesFor(role: Role): Stage[] {
  return STAGES.filter((s) => STAGE_INFO[s].actor === role);
}

// --- Who sees which properties -----------------------------------------------

/**
 * The stage a role's access starts at: a team sees a property once it has
 * reached that team (and keeps seeing it afterwards). null = sees all
 * (subject to ownership for real estate managers).
 */
export const ACCESS_FROM: Record<Role, Stage | null> = {
  admin: null,
  expansion_manager: null,
  founder: null,
  real_estate: null,
  business: "bl_review",
  sales: "sales_review",
  ops: "ops_review",
  finance: "token_payment",
};

// --- Which fields each role sees -----------------------------------------------

export const PROPERTY_FIELDS = [
  "storeName",
  "address",
  "mapUrl",
  "latitude",
  "longitude",
  "totalAreaSqft",
  "carpetAreaSqft",
  "askingRent",
  "securityDeposit",
  "advanceRent",
  "lockInMonths",
  "structureType",
  "structureHeightFt",
  "rentFreeDays",
  "handoverDate",
  "leaseTenureMonths",
  "rentEscalationPct",
  "notes",
] as const;
export type PropertyField = (typeof PROPERTY_FIELDS)[number];

const ALL_FIELDS = new Set<PropertyField>(PROPERTY_FIELDS);

export const FIELD_VISIBILITY: Record<Role, ReadonlySet<PropertyField>> = {
  admin: ALL_FIELDS,
  expansion_manager: ALL_FIELDS,
  founder: ALL_FIELDS,
  real_estate: ALL_FIELDS,
  sales: ALL_FIELDS,
  ops: ALL_FIELDS,
  business: new Set<PropertyField>([
    "storeName",
    "totalAreaSqft",
    "carpetAreaSqft",
    "askingRent",
    "securityDeposit",
    "rentFreeDays",
    "advanceRent",
  ]),
  finance: new Set<PropertyField>(["storeName", "address", "totalAreaSqft", "carpetAreaSqft", "advanceRent", "securityDeposit"]),
};

// --- Files --------------------------------------------------------------------

export const FILE_CATEGORIES = [
  "property_media",
  "ops_media",
  "aadhaar_front",
  "aadhaar_back",
  "pan_card",
  "electricity_bill",
  "lease_deed",
  "registered_deed",
  "power_of_attorney",
  "gst_certificate",
  "water_bill",
  "rent_agreement",
  "tenant_noc",
  "property_tax_receipt",
  "other_document",
  "loi",
  "signed_loi",
  "agreement",
  "stamp_duty_calculation",
  "token_receipt",
  "balance_receipt",
  "stamp_duty_receipt",
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export type FileKind = "media" | "document";

export interface CategoryInfo {
  label: string;
  kind: FileKind;
  /** Attached to a specific owner (KYC) rather than the property. */
  perOwner?: boolean;
  /** Roles that may view/download it (beyond these, nobody). */
  viewers: readonly Role[];
  /** Roles that upload it. */
  uploaders: readonly Role[];
}

const MEDIA_VIEWERS: Role[] = ["admin", "expansion_manager", "real_estate", "sales", "ops", "founder"];
const DOC_VIEWERS: Role[] = ["admin", "expansion_manager", "real_estate", "founder"];
const DEAL_VIEWERS: Role[] = ["admin", "expansion_manager", "real_estate", "founder", "finance"];
const MONEY_VIEWERS: Role[] = ["admin", "expansion_manager", "founder", "finance"];

const doc = (label: string, extra: Partial<CategoryInfo> = {}): CategoryInfo => ({
  label,
  kind: "document",
  viewers: DOC_VIEWERS,
  uploaders: ["real_estate"],
  ...extra,
});

export const CATEGORY_INFO: Record<FileCategory, CategoryInfo> = {
  property_media: { label: "Property photos & videos", kind: "media", viewers: MEDIA_VIEWERS, uploaders: ["real_estate"] },
  ops_media: { label: "Ops site-visit photos & videos", kind: "media", viewers: MEDIA_VIEWERS, uploaders: ["ops"] },
  aadhaar_front: doc("Aadhaar card (front)", { perOwner: true }),
  aadhaar_back: doc("Aadhaar card (back)", { perOwner: true }),
  pan_card: doc("PAN card", { perOwner: true }),
  electricity_bill: doc("Electricity bill"),
  lease_deed: doc("Lease deed"),
  registered_deed: doc("Registered property document"),
  power_of_attorney: doc("Power of attorney"),
  gst_certificate: doc("GST certificate"),
  water_bill: doc("Water bill"),
  rent_agreement: doc("Existing rent agreement"),
  tenant_noc: doc("NOC from tenants"),
  property_tax_receipt: doc("Property tax receipt"),
  other_document: doc("Other document"),
  loi: doc("Letter of Intent (LOI)", { uploaders: ["expansion_manager"] }),
  signed_loi: doc("Signed LOI", { uploaders: ["expansion_manager"], viewers: DEAL_VIEWERS }),
  agreement: doc("Signed agreement", { uploaders: ["expansion_manager"], viewers: DEAL_VIEWERS }),
  stamp_duty_calculation: doc("Stamp duty calculation", { uploaders: ["expansion_manager", "admin"], viewers: MONEY_VIEWERS }),
  token_receipt: doc("Token payment UTR receipt", { uploaders: ["finance"], viewers: MONEY_VIEWERS }),
  balance_receipt: doc("Balance payment UTR receipt", { uploaders: ["finance"], viewers: MONEY_VIEWERS }),
  stamp_duty_receipt: doc("Stamp duty UTR receipt", { uploaders: ["finance"], viewers: MONEY_VIEWERS }),
};

export function isFileCategory(value: unknown): value is FileCategory {
  return typeof value === "string" && (FILE_CATEGORIES as readonly string[]).includes(value);
}

/** Property-level documents the real estate manager uploads at the documents stage. */
export const PROPERTY_DOCUMENTS: FileCategory[] = [
  "electricity_bill",
  "lease_deed",
  "registered_deed",
  "power_of_attorney",
  "property_tax_receipt",
  "gst_certificate",
  "water_bill",
  "rent_agreement",
  "tenant_noc",
  "other_document",
];

export const OWNER_DOCUMENTS: FileCategory[] = ["aadhaar_front", "aadhaar_back", "pan_card"];

// --- Other sections -----------------------------------------------------------

/** Owner names, contact details and KYC status. */
export const OWNER_VIEWERS: readonly Role[] = [...DOC_VIEWERS, "finance"];
/** Landlord bank details. */
export const BANK_VIEWERS: readonly Role[] = DEAL_VIEWERS;
/** Payments (amounts, UTRs) and stamp duty requests. */
export const PAYMENT_VIEWERS: readonly Role[] = [...MONEY_VIEWERS, "real_estate"];
/** Ops visit notes and scope of work. */
export const VISIT_VIEWERS: readonly Role[] = ["admin", "expansion_manager", "real_estate", "sales", "ops", "founder"];

// --- Documents checklist ----------------------------------------------------------

export interface OwnerChecklistInput {
  name: string;
  isOrganisation: boolean;
  hasBankDetails: boolean;
  categories: FileCategory[];
}

/**
 * What's still missing before the real estate manager can mark documents
 * complete. Required: each owner's Aadhaar (both sides) and PAN, bank
 * details for at least one owner, an electricity bill, a property tax
 * receipt, and proof of ownership (lease deed, registered document or power
 * of attorney). GST is required when an owner is an organisation. Water
 * bill, rent agreement and tenant NOC are optional ("if they have").
 */
export function missingDocuments(owners: OwnerChecklistInput[], propertyCategories: FileCategory[]): string[] {
  const missing: string[] = [];
  if (owners.length === 0) missing.push("Add at least one owner");
  for (const o of owners) {
    for (const c of OWNER_DOCUMENTS) {
      if (!o.categories.includes(c)) missing.push(`${CATEGORY_INFO[c].label} for ${o.name}`);
    }
  }
  if (owners.length > 0 && !owners.some((o) => o.hasBankDetails)) missing.push("Owner bank details");
  const has = (c: FileCategory) => propertyCategories.includes(c);
  if (!has("electricity_bill")) missing.push(CATEGORY_INFO.electricity_bill.label);
  if (!has("property_tax_receipt")) missing.push(CATEGORY_INFO.property_tax_receipt.label);
  if (!has("lease_deed") && !has("registered_deed") && !has("power_of_attorney")) {
    missing.push("Ownership proof (lease deed, registered document or power of attorney)");
  }
  if (owners.some((o) => o.isOrganisation) && !has("gst_certificate")) missing.push(CATEGORY_INFO.gst_certificate.label);
  return missing;
}
