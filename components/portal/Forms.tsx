"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import {
  completeDocuments,
  confirmAgreement,
  confirmSignedLoi,
  markPaid,
  recordDecision,
  removeFile,
  removeOwner,
  requestStampDuty,
  saveOwner,
  saveVisit,
  sendLoi,
  submitForReview,
  type ActionState,
} from "@/app/actions/pipeline";
import type { Owner } from "@/lib/expansion/types";
import { DECISION_LABEL, type Decision } from "@/lib/expansion/workflow";
import { Alert, buttonClass, inputClass } from "./ui";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.success) return <Alert tone="success">{state.success}</Alert>;
  return null;
}

/**
 * A form bound to a server action. Submits through onSubmit rather than the
 * action prop so typed values survive a validation error (React resets
 * forms after action-prop submissions).
 */
function ActionForm({
  action,
  propertyId,
  children,
  confirmText,
  className = "space-y-3",
  resetOnSuccess = false,
}: {
  action: Action;
  propertyId: number;
  children: (pending: boolean, state: ActionState) => ReactNode;
  confirmText?: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.success) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmText && !confirm(confirmText)) return;
        const data = new FormData(e.currentTarget);
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.name) data.set(submitter.name, submitter.value);
        startTransition(() => run(data));
      }}
    >
      <input type="hidden" name="propertyId" value={propertyId} />
      <Feedback state={state} />
      {children(pending, state)}
    </form>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {error ? <span className="text-xs text-rose-600">{error}</span> : hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

// --- Simple one-button steps --------------------------------------------------------

const SIMPLE: Record<string, Action> = {
  submit: submitForReview,
  documents: completeDocuments,
  sendLoi,
  signedLoi: confirmSignedLoi,
  agreement: confirmAgreement,
};

export function StepButton({
  step,
  propertyId,
  label,
  confirmText,
  disabled,
  variant = "primary",
}: {
  step: keyof typeof SIMPLE;
  propertyId: number;
  label: string;
  confirmText?: string;
  disabled?: boolean;
  variant?: keyof typeof buttonClass;
}) {
  return (
    <ActionForm action={SIMPLE[step]} propertyId={propertyId} confirmText={confirmText}>
      {(pending) => (
        <button type="submit" disabled={pending || disabled} className={buttonClass[variant]}>
          {pending ? "Working…" : label}
        </button>
      )}
    </ActionForm>
  );
}

// --- Review decision --------------------------------------------------------------------

const DECISION_STYLE: Record<Decision, { cls: string; icon: string; verb: string }> = {
  approved: { cls: buttonClass.approve, icon: "✓", verb: "Approve" },
  hold: { cls: buttonClass.hold, icon: "❚❚", verb: "Hold" },
  rejected: { cls: buttonClass.reject, icon: "✕", verb: "Reject" },
};

export function DecisionForm({
  propertyId,
  decisions,
  disabledReason,
}: {
  propertyId: number;
  decisions: readonly Decision[];
  disabledReason?: string;
}) {
  const [remarks, setRemarks] = useState("");
  const ready = remarks.trim().length >= 3 && !disabledReason;
  return (
    <ActionForm action={recordDecision} propertyId={propertyId}>
      {(pending) => (
        <>
          <Field label="Remarks (required)">
            <textarea
              name="remarks"
              rows={3}
              maxLength={5000}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Explain the reason for your decision…"
              className={inputClass}
            />
          </Field>
          {disabledReason ? <p className="text-sm text-amber-700">{disabledReason}</p> : null}
          <div className="flex flex-wrap gap-3">
            {decisions.map((d) => (
              <button
                key={d}
                type="submit"
                name="decision"
                value={d}
                disabled={pending || !ready || (d === "approved" && Boolean(disabledReason))}
                className={DECISION_STYLE[d].cls}
                onClick={(e) => {
                  if (!confirm(`${DECISION_STYLE[d].verb} this property?`)) e.preventDefault();
                }}
              >
                {DECISION_STYLE[d].icon} {DECISION_STYLE[d].verb}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">Decisions are final and recorded with your name: {decisions.map((d) => DECISION_LABEL[d]).join(" / ")}.</p>
        </>
      )}
    </ActionForm>
  );
}

// --- Ops visit --------------------------------------------------------------------------

export function VisitForm({ propertyId, visited, scopeOfWork }: { propertyId: number; visited: boolean; scopeOfWork: string }) {
  return (
    <ActionForm action={saveVisit} propertyId={propertyId}>
      {(pending) => (
        <>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" name="visited" defaultChecked={visited} className="h-4 w-4" />
            Site visited
          </label>
          <Field label="Scope of work" hint="What needs to be done before the store can open (civil, electrical, flooring, shutters…).">
            <textarea name="scopeOfWork" rows={6} maxLength={20000} defaultValue={scopeOfWork} className={inputClass} />
          </Field>
          <button type="submit" disabled={pending} className={buttonClass.secondary}>
            {pending ? "Saving…" : "Save visit"}
          </button>
        </>
      )}
    </ActionForm>
  );
}

// --- Owners -------------------------------------------------------------------------------

export function OwnerForm({ propertyId, owner }: { propertyId: number; owner?: Owner }) {
  const [org, setOrg] = useState(owner?.isOrganisation ?? false);
  return (
    <ActionForm action={saveOwner} propertyId={propertyId} resetOnSuccess={!owner}>
      {(pending, state) => {
        const e = (state.fieldErrors ?? {}) as Record<string, string | undefined>;
        return (
          <>
            {owner ? <input type="hidden" name="ownerId" value={owner.id} /> : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Owner name" error={e.name}>
                <input name="name" required defaultValue={owner?.name} className={inputClass} />
              </Field>
              <Field label="Email (for the LOI)" error={e.email}>
                <input name="email" type="email" defaultValue={owner?.email ?? ""} className={inputClass} />
              </Field>
              <Field label="Phone" error={e.phone}>
                <input name="phone" defaultValue={owner?.phone ?? ""} className={inputClass} />
              </Field>
              <Field label="PAN number" error={e.panNumber}>
                <input name="panNumber" defaultValue={owner?.panNumber ?? ""} placeholder="ABCDE1234F" className={`${inputClass} uppercase`} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                <input type="checkbox" name="isOrganisation" checked={org} onChange={(ev) => setOrg(ev.target.checked)} className="h-4 w-4" />
                Owner is an organisation
              </label>
              {org ? (
                <Field label="GST number" error={e.gstNumber}>
                  <input name="gstNumber" defaultValue={owner?.gstNumber ?? ""} className={`${inputClass} uppercase`} />
                </Field>
              ) : null}
            </div>
            <fieldset className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-4">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Bank details (for rent/token payments)</legend>
              <Field label="Account holder" error={e.bankAccountName}>
                <input name="bankAccountName" defaultValue={owner?.bank?.accountName ?? ""} className={inputClass} />
              </Field>
              <Field label="Account number" error={e.bankAccountNumber}>
                <input name="bankAccountNumber" inputMode="numeric" defaultValue={owner?.bank?.accountNumber ?? ""} className={inputClass} />
              </Field>
              <Field label="IFSC" error={e.bankIfsc}>
                <input name="bankIfsc" defaultValue={owner?.bank?.ifsc ?? ""} className={`${inputClass} uppercase`} />
              </Field>
              <Field label="Bank name" error={e.bankName}>
                <input name="bankName" defaultValue={owner?.bank?.bankName ?? ""} className={inputClass} />
              </Field>
            </fieldset>
            <button type="submit" disabled={pending} className={buttonClass.primary}>
              {pending ? "Saving…" : owner ? "Save owner" : "Add owner"}
            </button>
          </>
        );
      }}
    </ActionForm>
  );
}

export function RemoveOwnerButton({ propertyId, ownerId, name }: { propertyId: number; ownerId: number; name: string }) {
  return (
    <ActionForm action={removeOwner} propertyId={propertyId} confirmText={`Remove ${name} and archive their documents?`} className="inline">
      {(pending) => (
        <>
          <input type="hidden" name="ownerId" value={ownerId} />
          <button type="submit" disabled={pending} className="text-xs text-rose-600 hover:underline">
            Remove owner
          </button>
        </>
      )}
    </ActionForm>
  );
}

export function RemoveFileButton({ propertyId, fileId }: { propertyId: number; fileId: string }) {
  return (
    <ActionForm action={removeFile} propertyId={propertyId} confirmText="Remove this file? It stays in the archive." className="inline">
      {(pending) => (
        <>
          <input type="hidden" name="fileId" value={fileId} />
          <button type="submit" disabled={pending} className="text-xs text-rose-600 hover:underline">
            Remove
          </button>
        </>
      )}
    </ActionForm>
  );
}

// --- Payments ---------------------------------------------------------------------------

export function PaymentForm({
  propertyId,
  kind,
  paymentId,
  suggestedAmount,
  receiptReady,
}: {
  propertyId: number;
  kind: "token" | "balance" | "stamp_duty";
  paymentId?: number;
  suggestedAmount?: number | null;
  receiptReady: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={markPaid} propertyId={propertyId} confirmText="Mark this payment as paid? Finance records can't be edited afterwards.">
      {(pending, state) => {
        const e = (state.fieldErrors ?? {}) as Record<string, string | undefined>;
        return (
          <>
            <input type="hidden" name="kind" value={kind} />
            {paymentId ? <input type="hidden" name="paymentId" value={paymentId} /> : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Amount paid (₹)" error={e.amount}>
                <input name="amount" type="number" min={1} step="any" defaultValue={suggestedAmount ?? ""} required className={inputClass} />
              </Field>
              <Field label="UTR number" error={e.utr}>
                <input name="utr" required className={`${inputClass} uppercase`} />
              </Field>
              <Field label="Paid on" error={e.paidOn}>
                <input name="paidOn" type="date" max={today} defaultValue={today} required className={inputClass} />
              </Field>
            </div>
            <Field label="Notes (optional)">
              <input name="notes" maxLength={2000} className={inputClass} />
            </Field>
            {!receiptReady ? <p className="text-sm text-amber-700">Upload the UTR receipt above first.</p> : null}
            <button type="submit" disabled={pending || !receiptReady} className={buttonClass.approve}>
              {pending ? "Saving…" : "Mark paid"}
            </button>
          </>
        );
      }}
    </ActionForm>
  );
}

export function StampDutyRequestForm({ propertyId, calculationReady }: { propertyId: number; calculationReady: boolean }) {
  return (
    <ActionForm action={requestStampDuty} propertyId={propertyId} confirmText="Send this stamp duty request to Finance and the Founder?" resetOnSuccess>
      {(pending, state) => {
        const e = (state.fieldErrors ?? {}) as Record<string, string | undefined>;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <Field label="Stamp duty amount (₹)" error={e.amount}>
                <input name="amount" type="number" min={1} step="any" required className={inputClass} />
              </Field>
              <Field label="Remarks (optional)">
                <input name="remarks" maxLength={2000} className={inputClass} placeholder="e.g. Owner wants the lease registered" />
              </Field>
            </div>
            {!calculationReady ? <p className="text-sm text-amber-700">Upload the calculation PDF above first.</p> : null}
            <button type="submit" disabled={pending || !calculationReady} className={buttonClass.primary}>
              {pending ? "Sending…" : "Request stamp duty release"}
            </button>
          </>
        );
      }}
    </ActionForm>
  );
}
