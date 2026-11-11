import "server-only";
import { formatNumber, propertyCode } from "@/lib/expansion/format";
import type { PropertyInput } from "@/lib/expansion/propertyInput";
import type { Role } from "@/lib/expansion/roles";
import type {
  DecisionRecord,
  Owner,
  Payment,
  PropertyDetails,
  PropertyView,
  StoredFile,
  User,
} from "@/lib/expansion/types";
import {
  ACCESS_FROM,
  BANK_VIEWERS,
  CATEGORY_INFO,
  FIELD_VISIBILITY,
  isEditable,
  OWNER_VIEWERS,
  PAYMENT_VIEWERS,
  PROPERTY_FIELDS,
  STAGES,
  stageIndex,
  stagesFor,
  VISIT_VIEWERS,
  type Decision,
  type FileCategory,
  type PropertyState,
  type Stage,
} from "@/lib/expansion/workflow";
import { audit } from "./audit";
import { all, now, one, run, tx } from "./db";
import { notifyRole } from "./notifications";

export class PropertyError extends Error {}

// --- Rows -------------------------------------------------------------------

export interface PropertyRow {
  id: number;
  state: PropertyState;
  stage: Stage | null;
  round: number;
  furthest_stage: number;
  store_name: string;
  address: string;
  map_url: string | null;
  latitude: number | null;
  longitude: number | null;
  total_area_sqft: number;
  carpet_area_sqft: number;
  asking_rent: number;
  security_deposit: number;
  advance_rent: number;
  lock_in_months: number;
  structure_type: "tin" | "shed" | "rcc";
  structure_height_ft: number;
  rent_free_days: number;
  handover_date: string;
  lease_tenure_months: number | null;
  rent_escalation_pct: number | null;
  notes: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  documents_completed_at: string | null;
  loi_sent_at: string | null;
  loi_sent_to: string | null;
  completed_at: string | null;
}

export interface FileRow {
  id: string;
  property_id: number;
  owner_id: number | null;
  category: FileCategory;
  kind: StoredFile["kind"];
  mime: string;
  original_name: string;
  size_bytes: number;
  sha256: string | null;
  etag: string | null;
  storage: "local" | "s3";
  storage_key: string;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: string;
  archived_at: string | null;
  payment_id: number | null;
}

interface DecisionRow {
  id: number;
  property_id: number;
  round: number;
  stage: Stage;
  decision: Decision;
  remarks: string;
  decided_by: string;
  decided_by_name: string;
  decided_at: string;
}

interface OwnerRow {
  id: number;
  property_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  is_organisation: number;
  gst_number: string | null;
  pan_number: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
}

interface VisitRow {
  property_id: number;
  round: number;
  visited_at: string | null;
  visited_by_name: string | null;
  scope_of_work: string;
  updated_at: string | null;
}

interface PaymentRow {
  id: number;
  property_id: number;
  kind: Payment["kind"];
  status: Payment["status"];
  requested_amount: number | null;
  requested_by_name: string | null;
  requested_at: string | null;
  request_remarks: string | null;
  amount: number | null;
  utr: string | null;
  paid_on: string | null;
  paid_by_name: string | null;
  paid_at: string | null;
  notes: string | null;
}

const SELECT_PROPERTY = `
  SELECT p.*, u.name AS created_by_name
  FROM properties p JOIN users u ON u.id = p.created_by`;

export async function propertyRow(id: number): Promise<PropertyRow | undefined> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return undefined;
  return one<PropertyRow>(`${SELECT_PROPERTY} WHERE p.id = ?`, id);
}

// --- Access -----------------------------------------------------------------

/** SQL condition (on alias p) for the properties a user may open at all. */
function accessCondition(viewer: User): { sql: string; params: (string | number)[] } {
  if (viewer.role === "real_estate") return { sql: "p.created_by = ?", params: [viewer.id] };
  const from = ACCESS_FROM[viewer.role];
  if (from) return { sql: "p.furthest_stage >= ?", params: [stageIndex(from)] };
  if (viewer.role === "founder") return { sql: "p.state != 'draft'", params: [] };
  return { sql: "1 = 1", params: [] };
}

export function canAccess(viewer: User, row: PropertyRow): boolean {
  if (viewer.role === "real_estate") return row.created_by === viewer.id;
  const from = ACCESS_FROM[viewer.role];
  if (from) return row.furthest_stage >= stageIndex(from);
  if (viewer.role === "founder") return row.state !== "draft";
  return true;
}

// --- Views ------------------------------------------------------------------

const COLUMN: Record<keyof PropertyDetails, keyof PropertyRow> = {
  storeName: "store_name",
  address: "address",
  mapUrl: "map_url",
  latitude: "latitude",
  longitude: "longitude",
  totalAreaSqft: "total_area_sqft",
  carpetAreaSqft: "carpet_area_sqft",
  askingRent: "asking_rent",
  securityDeposit: "security_deposit",
  advanceRent: "advance_rent",
  lockInMonths: "lock_in_months",
  structureType: "structure_type",
  structureHeightFt: "structure_height_ft",
  rentFreeDays: "rent_free_days",
  handoverDate: "handover_date",
  leaseTenureMonths: "lease_tenure_months",
  rentEscalationPct: "rent_escalation_pct",
  notes: "notes",
};

const SEES_ARCHIVED: readonly Role[] = ["admin", "expansion_manager", "founder"];

export function canSeeFile(role: Role, category: FileCategory): boolean {
  return CATEGORY_INFO[category].viewers.includes(role);
}

function toFile(r: FileRow): StoredFile {
  return {
    id: r.id,
    category: r.category,
    ownerId: r.owner_id,
    paymentId: r.payment_id,
    kind: r.kind,
    mime: r.mime,
    originalName: r.original_name,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    uploadedByName: r.uploaded_by_name,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
  };
}

function toDecision(r: DecisionRow): DecisionRecord {
  return {
    id: r.id,
    round: r.round,
    stage: r.stage,
    decision: r.decision,
    remarks: r.remarks,
    decidedBy: r.decided_by,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at,
  };
}

function toOwner(r: OwnerRow, withBank: boolean): Owner {
  const hasBank = Boolean(r.bank_account_number);
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    isOrganisation: r.is_organisation === 1,
    gstNumber: r.gst_number,
    panNumber: r.pan_number,
    hasBankDetails: hasBank,
    bank:
      withBank && hasBank
        ? {
            accountName: r.bank_account_name ?? "",
            accountNumber: r.bank_account_number ?? "",
            ifsc: r.bank_ifsc ?? "",
            bankName: r.bank_name ?? "",
          }
        : null,
  };
}

function toPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    requestedAmount: r.requested_amount,
    requestedByName: r.requested_by_name,
    requestedAt: r.requested_at,
    requestRemarks: r.request_remarks,
    amount: r.amount,
    utr: r.utr,
    paidOn: r.paid_on,
    paidByName: r.paid_by_name,
    paidAt: r.paid_at,
    notes: r.notes,
  };
}

function group<T extends { property_id: number }>(rows: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const r of rows) map.set(r.property_id, [...(map.get(r.property_id) ?? []), r]);
  return map;
}

interface Related {
  files: Map<number, FileRow[]>;
  decisions: Map<number, DecisionRow[]>;
  owners: Map<number, OwnerRow[]>;
  visits: Map<number, VisitRow[]>;
  payments: Map<number, PaymentRow[]>;
}

async function loadRelated(ids: number[]): Promise<Related> {
  if (ids.length === 0) return { files: new Map(), decisions: new Map(), owners: new Map(), visits: new Map(), payments: new Map() };
  const inList = `(${ids.map(() => "?").join(",")})`;
  const q = <T,>(sql: string) => all<T & { property_id: number }>(sql, ...ids);
  const [files, decisions, owners, visits, payments] = await Promise.all([
    q<FileRow>(
      `SELECT f.*, u.name AS uploaded_by_name FROM files f JOIN users u ON u.id = f.uploaded_by
       WHERE f.property_id IN ${inList} ORDER BY f.created_at, f.id`,
    ),
    q<DecisionRow>(
      `SELECT d.*, u.name AS decided_by_name FROM decisions d JOIN users u ON u.id = d.decided_by
       WHERE d.property_id IN ${inList} ORDER BY d.id`,
    ),
    q<OwnerRow>(`SELECT * FROM owners WHERE property_id IN ${inList} AND archived_at IS NULL ORDER BY id`),
    q<VisitRow>(
      `SELECT v.*, u.name AS visited_by_name FROM ops_visits v LEFT JOIN users u ON u.id = v.visited_by
       WHERE v.property_id IN ${inList}`,
    ),
    q<PaymentRow>(
      `SELECT p.*, r.name AS requested_by_name, x.name AS paid_by_name FROM payments p
       LEFT JOIN users r ON r.id = p.requested_by LEFT JOIN users x ON x.id = p.paid_by
       WHERE p.property_id IN ${inList} ORDER BY p.id`,
    ),
  ]);
  return {
    files: group(files),
    decisions: group(decisions),
    owners: group(owners),
    visits: group(visits),
    payments: group(payments),
  };
}

/** Builds what this viewer may see; hidden fields come back null and hidden sections are dropped. */
function toView(viewer: User, row: PropertyRow, rel: Related): PropertyView {
  const role = viewer.role;
  const fields = FIELD_VISIBILITY[role];
  const details = {} as Record<keyof PropertyDetails, unknown>;
  for (const f of PROPERTY_FIELDS) details[f] = fields.has(f) ? row[COLUMN[f]] : null;
  details.storeName = row.store_name;

  const files = (rel.files.get(row.id) ?? [])
    .filter((f) => canSeeFile(role, f.category))
    .filter((f) => !f.archived_at || SEES_ARCHIVED.includes(role))
    .map(toFile);
  const visit = (rel.visits.get(row.id) ?? []).find((v) => v.round === row.round);

  return {
    ...(details as unknown as PropertyDetails),
    id: row.id,
    code: propertyCode(row.id),
    state: row.state,
    stage: row.stage,
    onHold: row.state === "on_hold",
    round: row.round,
    furthestStage: row.furthest_stage >= 0 ? STAGES[row.furthest_stage] : null,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    loiSentAt: row.loi_sent_at,
    loiSentTo: OWNER_VIEWERS.includes(role) ? row.loi_sent_to : null,
    documentsCompletedAt: row.documents_completed_at,
    files,
    decisions: (rel.decisions.get(row.id) ?? []).map(toDecision),
    owners: OWNER_VIEWERS.includes(role)
      ? (rel.owners.get(row.id) ?? []).map((o) => toOwner(o, BANK_VIEWERS.includes(role)))
      : null,
    visit: VISIT_VIEWERS.includes(role)
      ? {
          visitedAt: visit?.visited_at ?? null,
          visitedByName: visit?.visited_by_name ?? null,
          scopeOfWork: visit?.scope_of_work ?? "",
          updatedAt: visit?.updated_at ?? null,
        }
      : null,
    payments: PAYMENT_VIEWERS.includes(role) ? (rel.payments.get(row.id) ?? []).map(toPayment) : null,
  };
}

async function viewsFor(viewer: User, rows: PropertyRow[]): Promise<PropertyView[]> {
  const rel = await loadRelated(rows.map((r) => r.id));
  return rows.map((r) => toView(viewer, r, rel));
}

export async function getProperty(viewer: User, id: number): Promise<PropertyView | null> {
  const row = await propertyRow(id);
  return row && canAccess(viewer, row) ? (await viewsFor(viewer, [row]))[0] : null;
}

export type ListFilter =
  | { kind: "all" }
  | { kind: "state"; state: PropertyState }
  | { kind: "stage"; stage: Stage };

export async function listProperties(viewer: User, filter: ListFilter = { kind: "all" }, search = ""): Promise<PropertyView[]> {
  const access = accessCondition(viewer);
  const where = [`(${access.sql})`];
  const params: (string | number)[] = [...access.params];
  if (filter.kind === "state") {
    where.push("p.state = ?");
    params.push(filter.state);
  } else if (filter.kind === "stage") {
    where.push("p.stage = ? AND p.state IN ('active', 'on_hold')");
    params.push(filter.stage);
  }
  const q = search.trim();
  if (q) {
    const idMatch = q.match(/^(?:pr-?)?0*(\d+)$/i);
    const like = `%${q.replace(/[%_]/g, "")}%`;
    where.push("(p.store_name ILIKE ? OR p.address ILIKE ? OR u.name ILIKE ? OR p.id = ?)");
    const n = idMatch ? Number(idMatch[1]) : -1;
    params.push(like, like, like, n <= 2_147_483_647 ? n : -1);
  }
  const rows = await all<PropertyRow>(`${SELECT_PROPERTY} WHERE ${where.join(" AND ")} ORDER BY p.updated_at DESC, p.id DESC`, ...params);
  return viewsFor(viewer, rows);
}

/** Properties waiting on this viewer's team (and, for sales, not yet voted on by this person). */
export async function actionQueue(viewer: User): Promise<PropertyView[]> {
  const stages = stagesFor(viewer.role);
  const props = await listProperties(viewer);
  const waiting = props.filter((p) => p.stage && stages.includes(p.stage) && (p.state === "active" || p.state === "on_hold"));
  if (viewer.role === "finance") {
    const stamp = props.filter((p) => p.payments?.some((x) => x.kind === "stamp_duty" && x.status === "requested"));
    return [...new Map([...waiting, ...stamp].map((p) => [p.id, p])).values()];
  }
  if (viewer.role === "sales") {
    if (!viewer.salesApprover) return [];
    return waiting.filter((p) => !p.decisions.some((d) => d.round === p.round && d.stage === "sales_review" && d.decidedBy === viewer.id));
  }
  if (viewer.role === "real_estate") {
    return props.filter((p) => p.state === "rejected" || p.state === "draft" || (p.stage === "documents" && p.state === "active"));
  }
  return waiting;
}

export async function queueCount(viewer: User): Promise<number> {
  return (await actionQueue(viewer)).length;
}

export interface DashboardStats {
  total: number;
  byState: Partial<Record<PropertyState, number>>;
  byStage: Partial<Record<Stage, number>>;
  completedArea: number;
  paid: { token: number; balance: number; stamp_duty: number };
  stampDutyRequested: number;
}

export async function dashboardStats(): Promise<DashboardStats> {
  const [states, stages, area, paid, stamp] = await Promise.all([
    all<{ state: PropertyState; n: number }>("SELECT state, COUNT(*)::int AS n FROM properties GROUP BY state"),
    all<{ stage: Stage; n: number }>("SELECT stage, COUNT(*)::int AS n FROM properties WHERE state IN ('active', 'on_hold') GROUP BY stage"),
    one<{ a: number }>("SELECT COALESCE(SUM(total_area_sqft), 0)::float8 AS a FROM properties WHERE state = 'completed'"),
    all<{ kind: keyof DashboardStats["paid"]; total: number }>(
      "SELECT kind, COALESCE(SUM(amount), 0)::float8 AS total FROM payments WHERE status = 'paid' GROUP BY kind",
    ),
    one<{ n: number }>("SELECT COUNT(*)::int AS n FROM payments WHERE kind = 'stamp_duty' AND status = 'requested'"),
  ]);
  return {
    total: states.reduce((s, r) => s + r.n, 0),
    byState: Object.fromEntries(states.map((r) => [r.state, r.n])),
    byStage: Object.fromEntries(stages.map((r) => [r.stage, r.n])),
    completedArea: area!.a,
    paid: { token: 0, balance: 0, stamp_duty: 0, ...Object.fromEntries(paid.map((r) => [r.kind, r.total])) },
    stampDutyRequested: stamp!.n,
  };
}

// --- Real estate manager: create, edit, submit ---------------------------------

function values(i: PropertyInput) {
  return [
    i.storeName,
    i.address,
    i.mapUrl,
    i.latitude,
    i.longitude,
    i.totalAreaSqft,
    i.carpetAreaSqft,
    i.askingRent,
    i.securityDeposit,
    i.advanceRent,
    i.lockInMonths,
    i.structureType,
    i.structureHeightFt,
    i.rentFreeDays,
    i.handoverDate,
    i.leaseTenureMonths,
    i.rentEscalationPct,
    i.notes,
  ];
}

export function requireRole(viewer: User, ...roles: Role[]) {
  if (!roles.includes(viewer.role)) throw new PropertyError("Your role can't do that.");
}

/** The property, checked to belong to this real estate manager. */
export async function ownProperty(viewer: User, id: number): Promise<PropertyRow> {
  requireRole(viewer, "real_estate");
  const row = await propertyRow(id);
  if (!row || row.created_by !== viewer.id) throw new PropertyError("Property not found.");
  return row;
}

export async function ownEditableProperty(viewer: User, id: number): Promise<PropertyRow> {
  const row = await ownProperty(viewer, id);
  if (!isEditable(row.state)) throw new PropertyError("This property is in review and can't be edited unless it's rejected.");
  return row;
}

export async function createProperty(viewer: User, input: PropertyInput): Promise<number> {
  requireRole(viewer, "real_estate");
  return tx(async () => {
    const at = now();
    const { id } = (await one<{ id: number }>(
      `INSERT INTO properties (state, store_name, address, map_url, latitude, longitude, total_area_sqft,
         carpet_area_sqft, asking_rent, security_deposit, advance_rent, lock_in_months, structure_type,
         structure_height_ft, rent_free_days, handover_date, lease_tenure_months, rent_escalation_pct, notes,
         created_by, created_at, updated_at)
       VALUES ('draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      ...values(input),
      viewer.id,
      at,
      at,
    ))!;
    await audit({ actorId: viewer.id, action: "property.created", propertyId: id });
    return id;
  });
}

export async function updateProperty(viewer: User, id: number, input: PropertyInput) {
  await tx(async () => {
    await ownEditableProperty(viewer, id);
    await run(
      `UPDATE properties SET store_name = ?, address = ?, map_url = ?, latitude = ?, longitude = ?,
         total_area_sqft = ?, carpet_area_sqft = ?, asking_rent = ?, security_deposit = ?, advance_rent = ?,
         lock_in_months = ?, structure_type = ?, structure_height_ft = ?, rent_free_days = ?, handover_date = ?,
         lease_tenure_months = ?, rent_escalation_pct = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      ...values(input),
      now(),
      id,
    );
    await audit({ actorId: viewer.id, action: "property.updated", propertyId: id });
  });
}

/** Moves a property to a stage, keeping track of the furthest stage it has reached (which drives team access). */
export async function moveTo(id: number, stage: Stage, state: PropertyState) {
  await run(
    `UPDATE properties SET stage = ?, state = ?, furthest_stage = GREATEST(furthest_stage, ?::int), updated_at = ?,
       completed_at = CASE WHEN ?::text = 'completed' THEN ? ELSE completed_at END
     WHERE id = ?`,
    stage,
    state,
    stageIndex(stage),
    now(),
    state,
    now(),
    id,
  );
}

export async function activeFiles(propertyId: number, category?: FileCategory): Promise<FileRow[]> {
  const sql = `SELECT f.*, u.name AS uploaded_by_name FROM files f JOIN users u ON u.id = f.uploaded_by
     WHERE f.property_id = ? AND f.archived_at IS NULL ${category ? "AND f.category = ?" : ""} ORDER BY f.created_at`;
  return all<FileRow>(sql, ...(category ? [propertyId, category] : [propertyId]));
}

/** Sends a draft, or a rejected property after revision, to the expansion manager. */
export async function submitProperty(viewer: User, id: number) {
  await tx(async () => {
    const row = await ownEditableProperty(viewer, id);
    if ((await activeFiles(id, "property_media")).length === 0) {
      throw new PropertyError("Add at least one photo or video before submitting.");
    }
    const resubmission = row.round > 0;
    await run("UPDATE properties SET round = round + 1, submitted_at = ? WHERE id = ?", now(), id);
    await moveTo(id, "em_review", "active");
    await audit({ actorId: viewer.id, action: resubmission ? "property.resubmitted" : "property.submitted", propertyId: id });
    await notifyRole("expansion_manager", {
      propertyId: id,
      title: `${resubmission ? "Resubmitted" : "New"} property: ${propertyCode(id)} ${row.store_name}`,
      body: `${viewer.name} ${resubmission ? "revised and resubmitted" : "scouted"} ${row.store_name} (${formatNumber(row.total_area_sqft, " sq ft")}). Review it and approve or reject with remarks.`,
      link: `/properties/${id}`,
    });
  });
}

