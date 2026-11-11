import "server-only";
import { formatINR, propertyCode } from "@/lib/expansion/format";
import type { OwnerInput, PaymentInput, StampDutyRequestInput } from "@/lib/expansion/propertyInput";
import type { User } from "@/lib/expansion/types";
import {
  afterDecision,
  afterTask,
  CATEGORY_INFO,
  DECISION_LABEL,
  missingDocuments,
  STAGE_INFO,
  STAMP_DUTY_REQUESTERS,
  stageIndex,
  type Decision,
  type FileCategory,
  type Stage,
} from "@/lib/expansion/workflow";
import { audit } from "./audit";
import { all, now, one, run, tx } from "./db";
import { attachToPayment, emailAttachment, pendingAttachments } from "./files";
import { emailEnabled, sendEmail } from "./mailer";
import { notifyRole, notifyUser, type NewNotification } from "./notifications";
import {
  activeFiles,
  canAccess,
  moveTo,
  ownProperty,
  propertyRow,
  PropertyError,
  requireRole,
  type PropertyRow,
} from "./properties";
import { getSettings } from "./settings";

// Every step of the pipeline after submission: review decisions, the ops
// visit, documents, LOI, agreement and payments. Each function checks the
// viewer's role and the property's current stage inside a transaction, and
// re-reads the row with FOR UPDATE, so two people acting at once can't both
// move the same property.

function link(id: number) {
  return `/properties/${id}`;
}

function label(row: PropertyRow) {
  return `${propertyCode(row.id)} ${row.store_name}`;
}

/** Locks the property row for the rest of the transaction. */
async function lock(id: number) {
  await one("SELECT id FROM properties WHERE id = ? FOR UPDATE", id);
}

/** Loads the property and checks it's waiting at `stage` (and, unless allowed, not on hold). */
async function atStage(viewer: User, id: number, stage: Stage, allowHold = false): Promise<PropertyRow> {
  requireRole(viewer, STAGE_INFO[stage].actor);
  await lock(id);
  const row = await propertyRow(id);
  if (!row || !canAccess(viewer, row)) throw new PropertyError("Property not found.");
  const ok = row.stage === stage && (row.state === "active" || (allowHold && row.state === "on_hold"));
  if (!ok) throw new PropertyError(`This property isn't waiting on ${STAGE_INFO[stage].label.toLowerCase()} right now — it may have just moved on.`);
  return row;
}

/** Sales approvers get the request to decide; the rest of the sales team get it for information. */
async function notifySalesTeam(approvers: NewNotification, viewers: NewNotification) {
  const members = await all<{ id: string; sales_approver: number }>(
    "SELECT id, sales_approver FROM users WHERE role = 'sales' AND status = 'active'",
  );
  for (const m of members) await notifyUser(m.id, m.sales_approver ? approvers : viewers);
}

async function notifyMany(targets: { user?: string; roles?: Parameters<typeof notifyRole>[0][] }, n: NewNotification) {
  if (targets.user) await notifyUser(targets.user, n);
  for (const r of targets.roles ?? []) await notifyRole(r, n);
}

// --- Review decisions ---------------------------------------------------------

const REVIEW_STAGES: Stage[] = ["em_review", "bl_review", "sales_review", "ops_review", "founder_review"];

export async function decide(viewer: User, id: number, decision: Decision, remarksRaw: string) {
  const remarks = remarksRaw.trim();
  if (remarks.length < 3) throw new PropertyError("Remarks are required for every decision.");
  if (remarks.length > 5000) throw new PropertyError("Remarks must be at most 5000 characters.");
  const stage = REVIEW_STAGES.find((s) => STAGE_INFO[s].actor === viewer.role);
  if (!stage) throw new PropertyError("Your role doesn't review properties.");
  const info = STAGE_INFO[stage];
  if (!info.decisions.includes(decision)) throw new PropertyError(`${info.label} can't ${decision === "hold" ? "hold" : decision} a property.`);

  await tx(async () => {
    const row = await atStage(viewer, id, stage, true);
    if (decision === "hold" && row.state === "on_hold") throw new PropertyError("This property is already on hold.");

    if (stage === "sales_review") {
      if (!viewer.salesApprover) {
        throw new PropertyError("You have view access to sales reviews. Approvals are given by the designated sales approvers.");
      }
      const voted = await one(
        "SELECT 1 FROM decisions WHERE property_id = ? AND round = ? AND stage = ? AND decided_by = ?",
        id,
        row.round,
        stage,
        viewer.id,
      );
      if (voted) throw new PropertyError("You've already given your decision on this property.");
    }
    if (stage === "ops_review" && decision === "approved") {
      const visit = await one<{ visited_at: string | null }>("SELECT visited_at FROM ops_visits WHERE property_id = ? AND round = ?", id, row.round);
      if (!visit?.visited_at) throw new PropertyError("Mark the property as visited before approving it.");
    }

    await run(
      "INSERT INTO decisions (property_id, round, stage, decision, remarks, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      row.round,
      stage,
      decision,
      remarks,
      viewer.id,
      now(),
    );
    await audit({ actorId: viewer.id, action: `decision.${stage}.${decision}`, propertyId: id, details: remarks });

    // Sales is a vote among the designated approvers: the stage resolves once enough agree.
    let outcome: Decision | null = decision;
    if (stage === "sales_review") {
      const { salesApprovalsRequired, salesRejectionsRequired } = await getSettings();
      const counts = await all<{ decision: Decision; n: number }>(
        "SELECT decision, COUNT(*)::int AS n FROM decisions WHERE property_id = ? AND round = ? AND stage = 'sales_review' GROUP BY decision",
        id,
        row.round,
      );
      const n = (d: Decision) => counts.find((c) => c.decision === d)?.n ?? 0;
      outcome = n("rejected") >= salesRejectionsRequired ? "rejected" : n("approved") >= salesApprovalsRequired ? "approved" : null;

      await notifyUser(row.created_by, {
        propertyId: id,
        title: `Sales: ${viewer.name} voted to ${decision === "approved" ? "approve" : "reject"} ${label(row)}`,
        body: `Remarks: ${remarks}${outcome ? "" : `\n\nSales votes so far: ${n("approved")} approve, ${n("rejected")} reject.`}`,
        link: link(id),
      });
    }
    if (!outcome) return;

    const result = afterDecision(stage, outcome);
    await moveTo(id, result.stage, result.state);
    await notifyDecision(viewer, row, stage, outcome, remarks);
  });
}

async function notifyDecision(viewer: User, row: PropertyRow, stage: Stage, decision: Decision, remarks: string) {
  const id = row.id;
  const verb = decision === "hold" ? "put on hold" : DECISION_LABEL[decision].toLowerCase();
  const who = stage === "sales_review" ? "Sales team" : `${STAGE_INFO[stage].label.replace(/ review| approval| site visit/i, "")} (${viewer.name})`;
  const n = (title: string, body: string): NewNotification => ({ propertyId: id, title, body, link: link(id) });
  const decided = n(`${who} ${verb} ${label(row)}`, `Remarks: ${remarks}`);

  switch (stage) {
    case "em_review":
      await notifyMany({ user: row.created_by }, decided);
      if (decision === "approved") {
        await notifyRole("business", n(`Awaiting your review: ${label(row)}`, "The Expansion Manager approved this property. Approve, hold or reject it."));
      }
      break;
    case "bl_review":
      await notifyMany({ user: row.created_by, roles: ["expansion_manager"] }, decided);
      if (decision === "approved") {
        await notifySalesTeam(
          n(`Awaiting your decision: ${label(row)}`, "Business Leaders approved this property. Review the details and media and approve or reject it."),
          n(`For your review: ${label(row)}`, "Business Leaders approved this property. You have view access; the designated sales approvers will decide."),
        );
      }
      break;
    case "sales_review":
      await notifyMany({ user: row.created_by, roles: ["expansion_manager"] }, n(`Sales team ${verb} ${label(row)}`, `Latest remarks: ${remarks}`));
      if (decision === "approved") {
        await notifyRole("ops", n(`Site visit needed: ${label(row)}`, "Sales approved this property. Visit it, upload photos/videos, write the scope of work and approve or reject."));
      }
      break;
    case "ops_review":
      await notifyMany({ roles: ["expansion_manager"] }, decided);
      await notifyUser(
        row.created_by,
        decision === "approved"
          ? n(`Ops approved ${label(row)} — upload documents`, `Remarks: ${remarks}\n\nPlease upload the owner KYC, bank details and property documents.`)
          : decided,
      );
      break;
    case "founder_review":
      await notifyMany({ user: row.created_by, roles: ["expansion_manager"] }, decided);
      if (decision === "approved") {
        await notifyRole("finance", n(`Release token: ${label(row)}`, "The Founder approved this property. Release the token payment and mark it paid with the UTR."));
      }
      break;
    default:
      break;
  }
}

// --- Ops site visit -------------------------------------------------------------

export async function saveVisit(viewer: User, id: number, input: { visited: boolean; scopeOfWork: string }) {
  const scope = input.scopeOfWork.trim();
  if (scope.length > 20000) throw new PropertyError("Scope of work is too long.");
  await tx(async () => {
    const row = await atStage(viewer, id, "ops_review");
    const existing = await one<{ visited_at: string | null }>("SELECT visited_at FROM ops_visits WHERE property_id = ? AND round = ?", id, row.round);
    const visitedAt = input.visited ? (existing?.visited_at ?? now()) : null;
    await run(
      `INSERT INTO ops_visits (property_id, round, visited_at, visited_by, scope_of_work, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (property_id, round) DO UPDATE SET
         visited_at = excluded.visited_at,
         visited_by = CASE WHEN excluded.visited_at IS NULL THEN NULL WHEN ops_visits.visited_at IS NULL THEN excluded.visited_by ELSE ops_visits.visited_by END,
         scope_of_work = excluded.scope_of_work, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      id,
      row.round,
      visitedAt,
      input.visited ? viewer.id : null,
      scope,
      viewer.id,
      now(),
    );
    const firstVisit = input.visited && !existing?.visited_at;
    await audit({ actorId: viewer.id, action: firstVisit ? "ops.visited" : "ops.visit_updated", propertyId: id });
    if (firstVisit) {
      await notifyMany(
        { user: row.created_by, roles: ["expansion_manager"] },
        { propertyId: id, title: `Ops visited ${label(row)}`, body: `${viewer.name} marked the site as visited.`, link: link(id) },
      );
    }
  });
}

// --- Owners & documents (real estate manager) --------------------------------------

async function ownDocumentsProperty(viewer: User, id: number): Promise<PropertyRow> {
  const row = await ownProperty(viewer, id);
  if (row.furthest_stage < stageIndex("documents")) throw new PropertyError("Owner details and documents are added after Ops approves the property.");
  if (row.state === "rejected") throw new PropertyError("This property was rejected.");
  return row;
}

function ownerValues(o: OwnerInput) {
  return [
    o.name,
    o.email || null,
    o.phone || null,
    o.isOrganisation ? 1 : 0,
    o.gstNumber || null,
    o.panNumber || null,
    o.bankAccountName || null,
    o.bankAccountNumber || null,
    o.bankIfsc || null,
    o.bankName || null,
  ];
}

export async function addOwner(viewer: User, propertyId: number, input: OwnerInput): Promise<number> {
  return tx(async () => {
    await ownDocumentsProperty(viewer, propertyId);
    const r = await one<{ id: number }>(
      `INSERT INTO owners (property_id, name, email, phone, is_organisation, gst_number, pan_number, bank_account_name,
         bank_account_number, bank_ifsc, bank_name, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      propertyId,
      ...ownerValues(input),
      viewer.id,
      now(),
      now(),
    );
    await audit({ actorId: viewer.id, action: "owner.added", propertyId, details: input.name });
    return r!.id;
  });
}

export async function updateOwner(viewer: User, propertyId: number, ownerId: number, input: OwnerInput) {
  await tx(async () => {
    await ownDocumentsProperty(viewer, propertyId);
    const changed = await run(
      `UPDATE owners SET name = ?, email = ?, phone = ?, is_organisation = ?, gst_number = ?, pan_number = ?,
         bank_account_name = ?, bank_account_number = ?, bank_ifsc = ?, bank_name = ?, updated_at = ?
       WHERE id = ? AND property_id = ? AND archived_at IS NULL`,
      ...ownerValues(input),
      now(),
      ownerId,
      propertyId,
    );
    if (changed !== 1) throw new PropertyError("Owner not found.");
    await audit({ actorId: viewer.id, action: "owner.updated", propertyId, details: input.name });
  });
}

export async function archiveOwner(viewer: User, propertyId: number, ownerId: number) {
  await tx(async () => {
    await ownDocumentsProperty(viewer, propertyId);
    const changed = await run("UPDATE owners SET archived_at = ? WHERE id = ? AND property_id = ? AND archived_at IS NULL", now(), ownerId, propertyId);
    if (changed !== 1) throw new PropertyError("Owner not found.");
    await run("UPDATE files SET archived_at = ?, archived_by = ? WHERE owner_id = ? AND archived_at IS NULL", now(), viewer.id, ownerId);
    await audit({ actorId: viewer.id, action: "owner.removed", propertyId });
  });
}

export async function documentsChecklist(propertyId: number): Promise<string[]> {
  const owners = await all<{ id: number; name: string; is_organisation: number; bank_account_number: string | null }>(
    "SELECT id, name, is_organisation, bank_account_number FROM owners WHERE property_id = ? AND archived_at IS NULL",
    propertyId,
  );
  const files = await activeFiles(propertyId);
  return missingDocuments(
    owners.map((o) => ({
      name: o.name,
      isOrganisation: o.is_organisation === 1,
      hasBankDetails: Boolean(o.bank_account_number),
      categories: files.filter((f) => f.owner_id === o.id).map((f) => f.category),
    })),
    files.filter((f) => !f.owner_id).map((f) => f.category),
  );
}

export async function completeDocuments(viewer: User, id: number) {
  await tx(async () => {
    const row = await atStage(viewer, id, "documents");
    if (row.created_by !== viewer.id) throw new PropertyError("Property not found.");
    const missing = await documentsChecklist(id);
    if (missing.length) throw new PropertyError(`Still missing: ${missing.join("; ")}.`);
    await run("UPDATE properties SET documents_completed_at = ? WHERE id = ?", now(), id);
    const next = afterTask("documents");
    await moveTo(id, next.stage, next.state);
    await audit({ actorId: viewer.id, action: "documents.completed", propertyId: id });
    await notifyRole("expansion_manager", {
      propertyId: id,
      title: `Documents uploaded: ${label(row)}`,
      body: `${viewer.name} uploaded the owner and property documents. Prepare the LOI and upload it to send it to the landowner.`,
      link: link(id),
    });
  });
}

// --- LOI ---------------------------------------------------------------------

export interface LoiResult {
  emailedTo: string[];
  emailConfigured: boolean;
}

export async function sendLoi(viewer: User, id: number): Promise<LoiResult> {
  return tx(async () => {
    const current = await propertyRow(id);
    const resend = current?.stage === "signed_loi";
    const row = await atStage(viewer, id, resend ? "signed_loi" : "loi");
    const lois = await activeFiles(id, "loi");
    if (lois.length === 0) throw new PropertyError("Upload the LOI first.");
    const owners = await all<{ name: string; email: string }>(
      "SELECT name, email FROM owners WHERE property_id = ? AND archived_at IS NULL AND email IS NOT NULL",
      id,
    );
    const configured = emailEnabled();
    if (configured && owners.length === 0) {
      throw new PropertyError("No owner has an email address. Ask the real estate manager to add the landowner's email under owner details.");
    }
    const latest = lois[lois.length - 1];
    const attachment = configured ? await emailAttachment(latest) : null;
    for (const o of configured ? owners : []) {
      sendEmail({
        to: o.email,
        subject: `Letter of Intent — ${row.store_name}`,
        text: `Dear ${o.name},\n\nPlease find attached the Letter of Intent for your property (${row.store_name}, ${row.address}).\n\nKindly review and sign it; our real estate manager will coordinate collecting the signed copy.\n\nRegards,\n${viewer.name}\nfairdeal.market`,
        attachments: attachment ? [attachment] : [],
      });
    }
    const sentTo = configured ? owners.map((o) => o.email).join(", ") : null;
    await run("UPDATE properties SET loi_sent_at = ?, loi_sent_to = ? WHERE id = ?", now(), sentTo, id);
    if (!resend) {
      const next = afterTask("loi");
      await moveTo(id, next.stage, next.state);
    }
    await audit({ actorId: viewer.id, action: resend ? "loi.resent" : "loi.sent", propertyId: id, details: sentTo ?? "not emailed (SMTP not configured)" });
    await notifyUser(row.created_by, {
      propertyId: id,
      title: `LOI ${resend ? "re-issued" : "issued"}: ${label(row)}`,
      body: `${viewer.name} uploaded the LOI${sentTo ? ` and emailed it to ${sentTo}` : ""}. Please get it signed by the landlord and share the signed copy with the Expansion Manager.`,
      link: link(id),
    });
    return { emailedTo: configured ? owners.map((o) => o.email) : [], emailConfigured: configured };
  });
}

export async function confirmSignedLoi(viewer: User, id: number) {
  await tx(async () => {
    const row = await atStage(viewer, id, "signed_loi");
    if ((await activeFiles(id, "signed_loi")).length === 0) throw new PropertyError("Upload the signed LOI first.");
    const next = afterTask("signed_loi");
    await moveTo(id, next.stage, next.state);
    await audit({ actorId: viewer.id, action: "loi.signed_uploaded", propertyId: id });
    await notifyRole("founder", {
      propertyId: id,
      title: `Approval needed: ${label(row)}`,
      body: "Expansion Manager, Business Leaders, Sales and Ops have approved this property and the signed LOI is in. Approve, hold or reject it.",
      link: link(id),
    });
    await notifyUser(row.created_by, { propertyId: id, title: `Signed LOI received: ${label(row)}`, body: "Sent to the Founder for approval.", link: link(id) });
  });
}

// --- Agreement ---------------------------------------------------------------

export async function confirmAgreement(viewer: User, id: number) {
  await tx(async () => {
    const row = await atStage(viewer, id, "agreement");
    if ((await activeFiles(id, "agreement")).length === 0) throw new PropertyError("Upload the signed agreement first.");
    const next = afterTask("agreement");
    await moveTo(id, next.stage, next.state);
    await audit({ actorId: viewer.id, action: "agreement.uploaded", propertyId: id });
    await notifyRole("finance", {
      propertyId: id,
      title: `Release balance: ${label(row)}`,
      body: "The signed agreement is uploaded. Release the remaining amount to the landlord and mark it paid with the UTR.",
      link: link(id),
    });
    await notifyMany(
      { user: row.created_by, roles: ["founder"] },
      { propertyId: id, title: `Agreement signed: ${label(row)}`, body: "The signed agreement has been uploaded and sent to Finance for the balance payment.", link: link(id) },
    );
  });
}

// --- Payments ------------------------------------------------------------------

const RECEIPT: Record<"token" | "balance" | "stamp_duty", FileCategory> = {
  token: "token_receipt",
  balance: "balance_receipt",
  stamp_duty: "stamp_duty_receipt",
};

async function requireReceipt(propertyId: number, kind: keyof typeof RECEIPT) {
  const receipts = await pendingAttachments(propertyId, RECEIPT[kind]);
  if (receipts.length === 0) throw new PropertyError(`Upload the ${CATEGORY_INFO[RECEIPT[kind]].label.toLowerCase()} first.`);
  return receipts;
}

async function duplicateUtr(utr: string) {
  const existing = await one<{ property_id: number }>("SELECT property_id FROM payments WHERE utr = ?", utr);
  if (existing) throw new PropertyError(`UTR ${utr} is already recorded for ${propertyCode(existing.property_id)}.`);
}

export async function recordPayment(viewer: User, id: number, kind: "token" | "balance", input: PaymentInput) {
  const stage: Stage = kind === "token" ? "token_payment" : "balance_payment";
  await tx(async () => {
    const row = await atStage(viewer, id, stage);
    await duplicateUtr(input.utr);
    const receipts = await requireReceipt(id, kind);
    const r = await one<{ id: number }>(
      `INSERT INTO payments (property_id, kind, status, amount, utr, paid_on, paid_by, paid_at, notes)
       VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?) RETURNING id`,
      id,
      kind,
      input.amount,
      input.utr,
      input.paidOn,
      viewer.id,
      now(),
      input.notes || null,
    );
    await attachToPayment(receipts.map((f) => f.id), r!.id);
    const next = afterTask(stage);
    await moveTo(id, next.stage, next.state);
    await audit({ actorId: viewer.id, action: `payment.${kind}`, propertyId: id, details: `${formatINR(input.amount)} · UTR ${input.utr}` });

    const what = kind === "token" ? "Token" : "Balance";
    const body = `${viewer.name} released ${formatINR(input.amount)} (UTR ${input.utr}, paid ${input.paidOn}).${
      kind === "token" ? " Next: share the agreement, get it signed and upload it." : " All payments are complete."
    }`;
    await notifyMany({ roles: ["expansion_manager", "founder"] }, { propertyId: id, title: `${what} paid: ${label(row)}`, body, link: link(id) });
    await notifyUser(row.created_by, { propertyId: id, title: `${what} paid: ${label(row)}`, body: `${what} payment of ${formatINR(input.amount)} released.`, link: link(id) });
  });
}

export async function requestStampDuty(viewer: User, id: number, input: StampDutyRequestInput) {
  requireRole(viewer, ...STAMP_DUTY_REQUESTERS);
  await tx(async () => {
    await lock(id);
    const row = await propertyRow(id);
    if (!row) throw new PropertyError("Property not found.");
    if (row.furthest_stage < stageIndex("token_payment")) throw new PropertyError("Stamp duty can be requested once the Founder has approved the property.");
    const calc = await pendingAttachments(id, "stamp_duty_calculation");
    if (calc.length === 0) throw new PropertyError("Upload the stamp duty calculation PDF first.");
    const r = await one<{ id: number }>(
      `INSERT INTO payments (property_id, kind, status, requested_amount, requested_by, requested_at, request_remarks)
       VALUES (?, 'stamp_duty', 'requested', ?, ?, ?, ?) RETURNING id`,
      id,
      input.amount,
      viewer.id,
      now(),
      input.remarks || null,
    );
    await attachToPayment(calc.map((f) => f.id), r!.id);
    await audit({ actorId: viewer.id, action: "stamp_duty.requested", propertyId: id, details: formatINR(input.amount) });
    await notifyMany(
      { roles: ["finance", "founder"] },
      {
        propertyId: id,
        title: `Stamp duty requested: ${label(row)}`,
        body: `${viewer.name} requested ${formatINR(input.amount)} for lease registration stamp duty.${input.remarks ? `\n\n${input.remarks}` : ""}`,
        link: link(id),
      },
    );
  });
}

export async function payStampDuty(viewer: User, paymentId: number, input: PaymentInput) {
  requireRole(viewer, "finance");
  await tx(async () => {
    const p = await one<{ property_id: number; status: string }>(
      "SELECT property_id, status FROM payments WHERE id = ? AND kind = 'stamp_duty' FOR UPDATE",
      paymentId,
    );
    const row = p ? await propertyRow(p.property_id) : undefined;
    if (!p || !row || !canAccess(viewer, row)) throw new PropertyError("Stamp duty request not found.");
    if (p.status !== "requested") throw new PropertyError("This stamp duty request is already paid.");
    await duplicateUtr(input.utr);
    const receipts = await requireReceipt(row.id, "stamp_duty");
    await run(
      "UPDATE payments SET status = 'paid', amount = ?, utr = ?, paid_on = ?, paid_by = ?, paid_at = ?, notes = ? WHERE id = ?",
      input.amount,
      input.utr,
      input.paidOn,
      viewer.id,
      now(),
      input.notes || null,
      paymentId,
    );
    await attachToPayment(receipts.map((f) => f.id), paymentId);
    await run("UPDATE properties SET updated_at = ? WHERE id = ?", now(), row.id);
    await audit({ actorId: viewer.id, action: "payment.stamp_duty", propertyId: row.id, details: `${formatINR(input.amount)} · UTR ${input.utr}` });
    await notifyMany(
      { roles: ["expansion_manager", "founder"] },
      {
        propertyId: row.id,
        title: `Stamp duty paid: ${label(row)}`,
        body: `${viewer.name} released ${formatINR(input.amount)} (UTR ${input.utr}, paid ${input.paidOn}).`,
        link: link(row.id),
      },
    );
  });
}
