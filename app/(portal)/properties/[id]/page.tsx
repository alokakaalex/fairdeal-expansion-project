import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchivedFiles, DocumentList, MediaGrid } from "@/components/portal/Files";
import FileUploader from "@/components/portal/FileUploader";
import {
  DecisionForm,
  OwnerForm,
  PaymentForm,
  RemoveOwnerButton,
  StampDutyRequestForm,
  StepButton,
  VisitForm,
} from "@/components/portal/Forms";
import { Icon } from "@/components/portal/Icons";
import MapEmbed from "@/components/portal/MapEmbed";
import Pipeline, { DecisionHistory } from "@/components/portal/Pipeline";
import PropertyFacts from "@/components/portal/PropertyFacts";
import { Alert, buttonClass, Card, StatusBadge } from "@/components/portal/ui";
import { formatDateTime, formatINR, formatNumber } from "@/lib/expansion/format";
import type { PropertyView, StoredFile, User } from "@/lib/expansion/types";
import {
  CATEGORY_INFO,
  DECISION_LABEL,
  FIELD_VISIBILITY,
  isEditable,
  OWNER_DOCUMENTS,
  PROPERTY_DOCUMENTS,
  STAGE_INFO,
  STAMP_DUTY_REQUESTERS,
  stageIndex,
  type FileCategory,
  type Stage,
} from "@/lib/expansion/workflow";
import { propertyAudit } from "@/lib/server/audit";
import { acceptAttribute, uploadPermissions } from "@/lib/server/files";
import { documentsChecklist } from "@/lib/server/pipeline";
import { getProperty, propertyRow, type PropertyRow } from "@/lib/server/properties";
import { requireUser } from "@/lib/server/session";

export const metadata: Metadata = { title: "Property" };

const ACTION_LABEL: Record<string, string> = {
  "property.created": "Created draft",
  "property.updated": "Edited details",
  "property.submitted": "Submitted to Expansion Manager",
  "property.resubmitted": "Revised and resubmitted",
  "file.added": "Uploaded",
  "file.archived": "Removed (archived)",
  "owner.added": "Added owner",
  "owner.updated": "Updated owner",
  "owner.removed": "Removed owner",
  "ops.visited": "Marked site visited",
  "ops.visit_updated": "Updated site visit",
  "documents.completed": "Submitted documents",
  "loi.sent": "Issued LOI",
  "loi.resent": "Re-issued LOI",
  "loi.signed_uploaded": "Uploaded signed LOI, sent to Founder",
  "agreement.uploaded": "Uploaded signed agreement",
  "stamp_duty.requested": "Requested stamp duty",
  "payment.token": "Released token",
  "payment.balance": "Released balance",
  "payment.stamp_duty": "Released stamp duty",
};

function actionLabel(action: string): string {
  const m = action.match(/^decision\.(\w+)\.(\w+)$/);
  if (m && m[1] in STAGE_INFO) return `${STAGE_INFO[m[1] as Stage].label}: ${DECISION_LABEL[m[2] as keyof typeof DECISION_LABEL]}`;
  return ACTION_LABEL[action] ?? action;
}

const DONE: Record<string, string> = {
  submitted: "Submitted. The Expansion Manager has been notified, and you'll be notified of every decision.",
  decision: "Decision recorded. Everyone concerned has been notified.",
  documents: "Documents submitted. The Expansion Manager has been notified to prepare the LOI.",
  loi_emailed: "LOI emailed to the landowner. The real estate manager has been notified to get it signed.",
  loi_manual:
    "LOI recorded. Email isn't configured on the server, so download it and send it to the landowner yourself. The real estate manager has been notified.",
  signed_loi: "Signed LOI saved and sent to the Founder for approval.",
  agreement: "Signed agreement saved and sent to Finance for the balance payment.",
  stamp_requested: "Stamp duty requested. Finance and the Founder have been notified.",
  paid: "Marked paid. The Expansion Manager and the Founder have been notified.",
};

const of = (files: StoredFile[], category: FileCategory) => files.filter((f) => f.category === category && !f.archivedAt);

type Perms = Record<FileCategory, boolean>;

function Uploader({ row, perms, category, ownerId, label, compact, multiple }: {
  row: PropertyRow;
  perms: Perms;
  category: FileCategory;
  ownerId?: number;
  label?: string;
  compact?: boolean;
  multiple?: boolean;
}) {
  if (!perms[category]) return null;
  return (
    <FileUploader
      propertyId={row.id}
      category={category}
      ownerId={ownerId}
      accept={acceptAttribute(category)}
      label={label ?? `Upload ${CATEGORY_INFO[category].label.toLowerCase()}`}
      compact={compact}
      multiple={multiple}
      hint={CATEGORY_INFO[category].kind === "media" ? "Photos and videos, as many as you like" : "PDF or photo"}
    />
  );
}

// --- Action panels: what this viewer can do right now ----------------------------

function RealEstateActions({ p, row, user, perms }: { p: PropertyView; row: PropertyRow; user: User; perms: Perms }) {
  if (p.createdBy !== user.id || !isEditable(p.state)) return null;
  const media = of(p.files, "property_media");
  return (
    <Card title={p.state === "draft" ? "Finish and submit" : "Revise and resubmit"} actions={<Link href={`/properties/${p.id}/edit`} className={buttonClass.secondary}>Edit details</Link>}>
      <div className="space-y-4">
        {p.state === "rejected" ? <Alert tone="warning">This property was rejected. Revise the details or media and resubmit it to start a new review round.</Alert> : null}
        <MediaGrid files={media} propertyId={p.id} canRemove />
        <Uploader row={row} perms={perms} category="property_media" label="Add photos / videos" />
        <StepButton step="submit" propertyId={p.id} label={p.round > 0 ? "Resubmit to Expansion Manager" : "Submit to Expansion Manager"} disabled={media.length === 0} />
      </div>
    </Card>
  );
}

function ReviewActions({ p, user }: { p: PropertyView; user: User }) {
  const stage = p.stage;
  if (!stage || STAGE_INFO[stage].kind !== "review" || STAGE_INFO[stage].actor !== user.role) return null;
  if (p.state !== "active" && p.state !== "on_hold") return null;
  const info = STAGE_INFO[stage];
  if (stage === "sales_review") {
    if (!user.salesApprover) {
      return <Alert tone="info">You have view access. Approval for the sales team is given by the designated sales approvers.</Alert>;
    }
    const mine = p.decisions.find((d) => d.round === p.round && d.stage === stage && d.decidedBy === user.id);
    if (mine) return <Alert tone="info">You {DECISION_LABEL[mine.decision].toLowerCase()} this property. Waiting for the rest of the sales team.</Alert>;
  }
  const decisions = info.decisions.filter((d) => !(d === "hold" && p.state === "on_hold"));
  const needsVisit = stage === "ops_review" && !p.visit?.visitedAt;
  return (
    <Card title={`${info.label}${p.state === "on_hold" ? " (on hold)" : ""}`}>
      <DecisionForm
        propertyId={p.id}
        decisions={decisions}
        disabledReason={needsVisit ? "Mark the site as visited (above) before approving. You can still reject." : undefined}
      />
    </Card>
  );
}

function OpsVisit({ p, row, user, perms }: { p: PropertyView; row: PropertyRow; user: User; perms: Perms }) {
  if (!p.visit || !p.furthestStage || stageIndex(p.furthestStage) < stageIndex("ops_review")) return null;
  const editing = user.role === "ops" && p.stage === "ops_review" && p.state === "active";
  return (
    <Card title="Ops site visit">
      <div className="space-y-4">
        <p className="text-sm">
          {p.visit.visitedAt ? (
            <span className="font-medium text-emerald-700">
              ✓ Visited {formatDateTime(p.visit.visitedAt)} by {p.visit.visitedByName}
            </span>
          ) : (
            <span className="text-slate-500">Not visited yet.</span>
          )}
        </p>
        {editing ? (
          <VisitForm propertyId={p.id} visited={Boolean(p.visit.visitedAt)} scopeOfWork={p.visit.scopeOfWork} />
        ) : p.visit.scopeOfWork ? (
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Scope of work</div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{p.visit.scopeOfWork}</p>
          </div>
        ) : null}
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Site photos &amp; videos</div>
          <MediaGrid files={of(p.files, "ops_media")} propertyId={p.id} canRemove={editing} />
        </div>
        <Uploader row={row} perms={perms} category="ops_media" label="Upload site photos / videos" />
      </div>
    </Card>
  );
}

function OwnersAndDocuments({ p, row, user, perms, missing }: { p: PropertyView; row: PropertyRow; user: User; perms: Perms; missing: string[] }) {
  if (!p.owners || !p.furthestStage || stageIndex(p.furthestStage) < stageIndex("documents")) return null;
  const editable = perms.electricity_bill;
  const kycVisible = CATEGORY_INFO.aadhaar_front.viewers.includes(user.role);
  const atDocuments = p.stage === "documents" && p.state === "active";

  return (
    <Card title="Owners & documents">
      <div className="space-y-6">
        {atDocuments && user.role === "real_estate" ? (
          <Alert tone={missing.length ? "warning" : "success"}>
            {missing.length ? (
              <>
                <p className="font-medium">Still needed before you can submit:</p>
                <ul className="mt-1 list-disc pl-5">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            ) : (
              "Everything required is uploaded. Submit to notify the Expansion Manager."
            )}
          </Alert>
        ) : null}

        {p.owners.length === 0 ? <p className="text-sm text-slate-500">No owners added yet.</p> : null}
        {p.owners.map((o) => (
          <div key={o.id} className="space-y-3 rounded-md border border-slate-200 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="font-medium text-slate-900">{o.name}</span>
                {o.isOrganisation ? <span className="ml-2 text-xs text-slate-500">Organisation · GST {o.gstNumber}</span> : null}
                <div className="text-xs text-slate-500">
                  {[o.email, o.phone, o.panNumber ? `PAN ${o.panNumber}` : null].filter(Boolean).join(" · ") || "No contact details"}
                </div>
              </div>
              {editable ? <RemoveOwnerButton propertyId={p.id} ownerId={o.id} name={o.name} /> : null}
            </div>
            {o.bank ? (
              <dl className="grid gap-2 rounded bg-slate-50 p-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-slate-500">Account holder</dt><dd className="font-medium">{o.bank.accountName}</dd></div>
                <div><dt className="text-xs text-slate-500">Account number</dt><dd className="font-mono">{o.bank.accountNumber}</dd></div>
                <div><dt className="text-xs text-slate-500">IFSC</dt><dd className="font-mono">{o.bank.ifsc}</dd></div>
                <div><dt className="text-xs text-slate-500">Bank</dt><dd>{o.bank.bankName}</dd></div>
              </dl>
            ) : (
              <p className="text-xs text-slate-500">{o.hasBankDetails ? "Bank details on file." : "No bank details."}</p>
            )}
            {kycVisible ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {OWNER_DOCUMENTS.map((c) => (
                  <div key={c} className="space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{CATEGORY_INFO[c].label}</div>
                    <DocumentList files={p.files.filter((f) => f.category === c && f.ownerId === o.id)} propertyId={p.id} canRemove={editable} />
                    <Uploader row={row} perms={perms} category={c} ownerId={o.id} label="Upload" compact multiple={false} />
                  </div>
                ))}
              </div>
            ) : null}
            {editable ? (
              <details>
                <summary className="cursor-pointer text-sm text-slate-600">Edit owner details</summary>
                <div className="mt-3">
                  <OwnerForm propertyId={p.id} owner={o} />
                </div>
              </details>
            ) : null}
          </div>
        ))}
        {editable ? (
          <details open={p.owners.length === 0} className="rounded-md border border-dashed border-slate-300 p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">+ Add {p.owners.length ? "another " : ""}owner</summary>
            <div className="mt-3">
              <OwnerForm propertyId={p.id} />
            </div>
          </details>
        ) : null}

        {kycVisible ? (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property documents</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {PROPERTY_DOCUMENTS.map((c) => {
                const files = of(p.files, c);
                if (!editable && files.length === 0) return null;
                return (
                  <div key={c} className="space-y-1 rounded-md border border-slate-200 p-3">
                    <div className="text-sm font-medium text-slate-800">{CATEGORY_INFO[c].label}</div>
                    <DocumentList files={files} propertyId={p.id} canRemove={editable} />
                    <Uploader row={row} perms={perms} category={c} label="Upload" compact />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {atDocuments && user.role === "real_estate" && p.createdBy === user.id ? (
          <StepButton step="documents" propertyId={p.id} label="Submit documents to Expansion Manager" disabled={missing.length > 0} />
        ) : null}
        {p.documentsCompletedAt ? <p className="text-xs text-slate-500">Documents submitted {formatDateTime(p.documentsCompletedAt)}.</p> : null}
      </div>
    </Card>
  );
}

function LoiAndAgreement({ p, row, user, perms }: { p: PropertyView; row: PropertyRow; user: User; perms: Perms }) {
  const reached = p.furthestStage && stageIndex(p.furthestStage) >= stageIndex("loi");
  const cats: FileCategory[] = ["loi", "signed_loi", "agreement"];
  const visible = cats.filter((c) => CATEGORY_INFO[c].viewers.includes(user.role));
  if (!reached || visible.length === 0) return null;
  const em = user.role === "expansion_manager";
  const at = (s: Stage) => p.stage === s && p.state === "active";

  return (
    <Card title="LOI & agreement">
      <div className="grid gap-5 lg:grid-cols-3">
        {visible.includes("loi") ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-slate-800">Letter of Intent</h3>
            <DocumentList files={of(p.files, "loi")} propertyId={p.id} canRemove={em && at("loi")} />
            {p.loiSentAt ? (
              <p className="text-xs text-slate-500">
                Issued {formatDateTime(p.loiSentAt)}
                {p.loiSentTo ? ` · emailed to ${p.loiSentTo}` : " · not emailed (share it manually)"}
              </p>
            ) : null}
            {em && (at("loi") || at("signed_loi")) ? (
              <>
                <Uploader row={row} perms={perms} category="loi" label={at("signed_loi") ? "Upload revised LOI" : "Upload LOI"} compact />
                <StepButton
                  step="sendLoi"
                  propertyId={p.id}
                  label={at("signed_loi") ? "Re-send latest LOI to landowner" : "Send LOI to landowner"}
                  disabled={of(p.files, "loi").length === 0}
                  variant={at("signed_loi") ? "secondary" : "primary"}
                  confirmText="Email the latest LOI to every owner with an email address?"
                />
              </>
            ) : null}
          </div>
        ) : null}
        {visible.includes("signed_loi") ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-slate-800">Signed LOI</h3>
            <DocumentList files={of(p.files, "signed_loi")} propertyId={p.id} canRemove={em && at("signed_loi")} />
            {em && at("signed_loi") ? (
              <>
                <Uploader row={row} perms={perms} category="signed_loi" label="Upload signed LOI" compact />
                <StepButton step="signedLoi" propertyId={p.id} label="Send to Founder for approval" disabled={of(p.files, "signed_loi").length === 0} />
              </>
            ) : null}
          </div>
        ) : null}
        {visible.includes("agreement") ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-slate-800">Signed agreement</h3>
            <p className="text-xs text-slate-500">Notarised / on ₹100 stamp paper, signed with the Founder.</p>
            <DocumentList files={of(p.files, "agreement")} propertyId={p.id} canRemove={em && at("agreement")} />
            {em && at("agreement") ? (
              <>
                <Uploader row={row} perms={perms} category="agreement" label="Upload signed agreement" compact />
                <StepButton step="agreement" propertyId={p.id} label="Send to Finance for balance payment" disabled={of(p.files, "agreement").length === 0} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Payments({ p, row, user, perms }: { p: PropertyView; row: PropertyRow; user: User; perms: Perms }) {
  if (!p.payments) return null;
  const reachedToken = p.furthestStage && stageIndex(p.furthestStage) >= stageIndex("token_payment");
  if (!reachedToken && p.payments.length === 0) return null;
  const finance = user.role === "finance";
  const at = (s: Stage) => p.stage === s && p.state === "active";
  const receipts = (paymentId: number) => p.files.filter((f) => f.paymentId === paymentId);
  const pending = (c: FileCategory) => p.files.filter((f) => f.category === c && !f.paymentId && !f.archivedAt);
  const tokens = p.payments.filter((x) => x.kind === "token");
  const balances = p.payments.filter((x) => x.kind === "balance");
  const stamps = p.payments.filter((x) => x.kind === "stamp_duty");
  const deposit = (p.securityDeposit ?? 0) + (p.advanceRent ?? 0);
  const tokenPaid = tokens.reduce((s, x) => s + (x.amount ?? 0), 0);

  const paidLine = (x: (typeof p.payments)[number]) => (
    <div key={x.id} className="space-y-1 rounded bg-emerald-50 p-3 text-sm">
      <div className="font-medium text-emerald-800">
        ✓ Paid {formatINR(x.amount)} on {x.paidOn} · UTR <span className="font-mono">{x.utr}</span>
      </div>
      <div className="text-xs text-slate-600">
        Marked by {x.paidByName} {formatDateTime(x.paidAt)}
        {x.notes ? ` · ${x.notes}` : ""}
      </div>
      <DocumentList files={receipts(x.id)} propertyId={p.id} empty="" />
    </div>
  );

  return (
    <Card title="Payments">
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-slate-800">Token release</h3>
          {p.securityDeposit != null ? (
            <p className="text-xs text-slate-500">
              Security deposit {formatINR(p.securityDeposit)} + advance rent {formatINR(p.advanceRent)} = {formatINR(deposit)}
            </p>
          ) : null}
          {tokens.map(paidLine)}
          {finance && at("token_payment") ? (
            <div className="space-y-3">
              <DocumentList files={pending("token_receipt")} propertyId={p.id} canRemove empty="" />
              <Uploader row={row} perms={perms} category="token_receipt" label="Upload UTR receipt" compact />
              <PaymentForm propertyId={p.id} kind="token" receiptReady={pending("token_receipt").length > 0} />
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-xs text-slate-500">{at("token_payment") ? "Waiting for Finance." : "Not due yet."}</p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-slate-800">Balance payment</h3>
          {tokenPaid && p.securityDeposit != null ? (
            <p className="text-xs text-slate-500">Remaining after token: {formatINR(Math.max(deposit - tokenPaid, 0))}</p>
          ) : null}
          {balances.map(paidLine)}
          {finance && at("balance_payment") ? (
            <div className="space-y-3">
              <DocumentList files={pending("balance_receipt")} propertyId={p.id} canRemove empty="" />
              <Uploader row={row} perms={perms} category="balance_receipt" label="Upload UTR receipt" compact />
              <PaymentForm
                propertyId={p.id}
                kind="balance"
                suggestedAmount={p.securityDeposit != null ? Math.max(deposit - tokenPaid, 0) || null : null}
                receiptReady={pending("balance_receipt").length > 0}
              />
            </div>
          ) : balances.length === 0 ? (
            <p className="text-xs text-slate-500">{at("balance_payment") ? "Waiting for Finance." : "Released after the signed agreement is uploaded."}</p>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-slate-800">Stamp duty (lease registration)</h3>
          {stamps.length === 0 && !STAMP_DUTY_REQUESTERS.includes(user.role) ? <p className="text-xs text-slate-500">Not requested.</p> : null}
          {stamps.map((x) => (
            <div key={x.id} className="space-y-2">
              <div className="rounded border border-slate-200 p-3 text-sm">
                <div className="font-medium">Requested {formatINR(x.requestedAmount)}</div>
                <div className="text-xs text-slate-500">
                  by {x.requestedByName} {formatDateTime(x.requestedAt)}
                  {x.requestRemarks ? ` · ${x.requestRemarks}` : ""}
                </div>
                <DocumentList files={receipts(x.id).filter((f) => f.category === "stamp_duty_calculation")} propertyId={p.id} empty="" />
              </div>
              {x.status === "paid" ? (
                <div className="space-y-1 rounded bg-emerald-50 p-3 text-sm">
                  <div className="font-medium text-emerald-800">
                    ✓ Paid {formatINR(x.amount)} on {x.paidOn} · UTR <span className="font-mono">{x.utr}</span>
                  </div>
                  <DocumentList files={receipts(x.id).filter((f) => f.category === "stamp_duty_receipt")} propertyId={p.id} empty="" />
                </div>
              ) : finance ? (
                <div className="space-y-3">
                  <DocumentList files={pending("stamp_duty_receipt")} propertyId={p.id} canRemove empty="" />
                  <Uploader row={row} perms={perms} category="stamp_duty_receipt" label="Upload UTR receipt" compact />
                  <PaymentForm propertyId={p.id} kind="stamp_duty" paymentId={x.id} suggestedAmount={x.requestedAmount} receiptReady={pending("stamp_duty_receipt").length > 0} />
                </div>
              ) : (
                <p className="text-xs text-amber-700">Waiting for Finance.</p>
              )}
            </div>
          ))}
          {STAMP_DUTY_REQUESTERS.includes(user.role) && reachedToken ? (
            <details className="rounded-md border border-dashed border-slate-300 p-3" open={stamps.length === 0 ? undefined : false}>
              <summary className="cursor-pointer text-sm text-slate-700">Request stamp duty release</summary>
              <div className="mt-3 space-y-3">
                <DocumentList files={pending("stamp_duty_calculation")} propertyId={p.id} canRemove empty="" />
                <Uploader row={row} perms={perms} category="stamp_duty_calculation" label="Upload calculation PDF" compact />
                <StampDutyRequestForm propertyId={p.id} calculationReady={pending("stamp_duty_calculation").length > 0} />
              </div>
            </details>
          ) : null}
        </section>
      </div>
    </Card>
  );
}

// --- Page ----------------------------------------------------------------------------

export default async function PropertyPage(props: PageProps<"/properties/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const q = await props.searchParams;
  const [p, row] = await Promise.all([getProperty(user, Number(id)), propertyRow(Number(id))]);
  if (!p || !row) notFound();
  const seesAudit = ["admin", "expansion_manager", "founder"].includes(user.role);
  const [perms, missing, activity] = await Promise.all([
    uploadPermissions(user, row),
    user.role === "real_estate" || user.role === "expansion_manager" ? documentsChecklist(p.id) : Promise.resolve([]),
    seesAudit ? propertyAudit(p.id) : Promise.resolve([]),
  ]);

  const fields = FIELD_VISIBILITY[user.role];
  const seesEverything = ["admin", "expansion_manager", "founder"].includes(user.role);
  const media = of(p.files, "property_media");
  const ownerEditing = user.id === p.createdBy && isEditable(p.state);
  const cover = media.find((f) => f.kind === "image" && !f.mime.includes("hei"));
  const quick = (
    [
      ["Area", p.totalAreaSqft != null ? formatNumber(p.totalAreaSqft, " sq ft") : null],
      ["Rent / mo", p.askingRent != null ? formatINR(p.askingRent) : null],
      ["Deposit", p.securityDeposit != null ? formatINR(p.securityDeposit) : null],
      ["Rent-free", p.rentFreeDays != null ? `${p.rentFreeDays} days` : null],
    ] as [string, string | null][]
  ).filter((x): x is [string, string] => x[1] !== null);

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(48,51,68,0.06),0_8px_24px_-12px_rgba(48,51,68,0.18)]">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${cover.id}`} alt="" className="h-32 w-full shrink-0 rounded-xl object-cover ring-1 ring-slate-200 sm:h-28 sm:w-44" />
          ) : (
            <div className="flex h-28 w-full shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-navy-800 to-navy-950 text-brand-300 sm:w-44">
              <Icon name="building" className="h-10 w-10" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{p.code}</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy-950 sm:text-[1.7rem]">{p.storeName}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <StatusBadge state={p.state} stage={p.stage} />
              {p.round > 1 ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Round {p.round}</span> : null}
              <span>
                Scouted by <span className="font-medium text-slate-700">{p.createdByName}</span>
                {p.submittedAt ? ` · submitted ${formatDateTime(p.submittedAt)}` : ""}
              </span>
            </div>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:text-right">
            {quick.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
                <dd className="font-semibold tabular-nums text-navy-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      {q.created ? <Alert tone="success">Draft saved. Add photos and videos, then submit it to the Expansion Manager.</Alert> : null}
      {q.saved ? <Alert tone="success">Changes saved.</Alert> : null}
      {typeof q.done === "string" && DONE[q.done] ? <Alert tone="success">{DONE[q.done]}</Alert> : null}

      <RealEstateActions p={p} row={row} user={user} perms={perms} />
      <ReviewActions p={p} user={user} />

      {p.state !== "draft" ? (
        <Card title="Approval pipeline">
          <Pipeline property={p} />
        </Card>
      ) : null}

      <OpsVisit p={p} row={row} user={user} perms={perms} />

      <div className={`grid gap-6 ${fields.has("address") ? "lg:grid-cols-2" : ""}`}>
        <Card title="Property details">
          <PropertyFacts property={p} role={user.role} />
        </Card>
        {fields.has("address") ? (
          <Card title="Location">
            <MapEmbed property={p} />
          </Card>
        ) : null}
      </div>

      {!ownerEditing && CATEGORY_INFO.property_media.viewers.includes(user.role) ? (
        <Card title={`Photos & videos (${media.length})`}>
          <MediaGrid files={media} propertyId={p.id} />
        </Card>
      ) : null}

      <OwnersAndDocuments p={p} row={row} user={user} perms={perms} missing={missing} />
      <LoiAndAgreement p={p} row={row} user={user} perms={perms} />
      <Payments p={p} row={row} user={user} perms={perms} />

      <Card title="Decisions">
        <DecisionHistory property={p} />
      </Card>

      {seesEverything ? (
        <Card title="Activity log">
          <ol className="space-y-1.5 text-sm">
            {activity.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <time className="w-44 shrink-0 text-slate-500">{formatDateTime(h.createdAt)}</time>
                <span className="font-medium text-slate-800">{h.actorName ?? "System"}</span>
                <span className="text-slate-600">
                  {actionLabel(h.action)}
                  {h.details ? ` — ${h.details}` : ""}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <ArchivedFiles files={p.files} />
          </div>
        </Card>
      ) : null}
    </>
  );
}
