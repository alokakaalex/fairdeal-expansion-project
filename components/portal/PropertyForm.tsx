"use client";

import { startTransition, useActionState } from "react";
import { saveProperty, type ActionState } from "@/app/actions/pipeline";
import { STRUCTURE_LABEL, STRUCTURE_TYPES, type PropertyInput } from "@/lib/expansion/propertyInput";
import type { PropertyView } from "@/lib/expansion/types";
import { Alert, buttonClass, inputClass } from "./ui";

type Name = keyof PropertyInput;

function Field({
  name,
  label,
  hint,
  error,
  children,
  className = "",
}: {
  name: Name;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={name} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="text-xs text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

function initial(property: PropertyView | undefined, name: Name): string {
  if (!property) return "";
  if (name === "mapUrl") {
    return property.mapUrl ?? (property.latitude != null ? `${property.latitude}, ${property.longitude}` : "");
  }
  const v = property[name as keyof PropertyView];
  return v == null ? "" : String(v);
}

export default function PropertyForm({ property }: { property?: PropertyView }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProperty, {});
  const errors = (state.fieldErrors ?? {}) as Partial<Record<Name, string>>;

  const input = (name: Name, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={name}
      name={name}
      defaultValue={initial(property, name)}
      aria-invalid={errors[name] ? true : undefined}
      aria-describedby={errors[name] ? `${name}-error` : undefined}
      className={`${inputClass} ${errors[name] ? "border-rose-400" : ""}`}
      required
      {...props}
    />
  );
  const amount = { type: "number", min: 0, step: "any", inputMode: "decimal" as const };
  const whole = { type: "number", min: 0, step: 1, inputMode: "numeric" as const };

  return (
    <form
      className="space-y-8"
      // Submitting through onSubmit (not the action prop) keeps what was typed
      // when the server sends back validation errors; React resets forms after
      // action-prop submissions.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      {property ? <input type="hidden" name="propertyId" value={property.id} /> : null}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Property &amp; location</legend>
        <Field name="storeName" label="Store / property name" hint="e.g. Rohini Sec-7 Dark Store" error={errors.storeName}>
          {input("storeName", { maxLength: 150 })}
        </Field>
        <Field name="handoverDate" label="Handover date" error={errors.handoverDate}>
          {input("handoverDate", { type: "date" })}
        </Field>
        <Field name="address" label="Address" error={errors.address} className="sm:col-span-2">
          {input("address", { maxLength: 500 })}
        </Field>
        <Field
          name="mapUrl"
          label="Google Maps link"
          hint="Paste the Google Maps share link, or coordinates like 28.7041, 77.1025."
          error={errors.mapUrl}
          className="sm:col-span-2"
        >
          {input("mapUrl", { maxLength: 2000, placeholder: "https://maps.app.goo.gl/…" })}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Area &amp; structure</legend>
        <Field name="totalAreaSqft" label="Total area (sq ft)" error={errors.totalAreaSqft}>
          {input("totalAreaSqft", { ...amount, min: 1 })}
        </Field>
        <Field name="carpetAreaSqft" label="Carpet area (sq ft)" error={errors.carpetAreaSqft}>
          {input("carpetAreaSqft", { ...amount, min: 1 })}
        </Field>
        <Field name="structureType" label="Type of structure" error={errors.structureType}>
          <select
            id="structureType"
            name="structureType"
            required
            defaultValue={initial(property, "structureType")}
            className={`${inputClass} ${errors.structureType ? "border-rose-400" : ""}`}
          >
            <option value="" disabled>
              Choose…
            </option>
            {STRUCTURE_TYPES.map((t) => (
              <option key={t} value={t}>
                {STRUCTURE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field name="structureHeightFt" label="Height (ft)" error={errors.structureHeightFt}>
          {input("structureHeightFt", { ...amount, min: 1 })}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Commercials</legend>
        <Field name="askingRent" label="Asking rent per month (₹)" error={errors.askingRent}>
          {input("askingRent", { ...amount, min: 1 })}
        </Field>
        <Field name="securityDeposit" label="Security deposit (₹)" error={errors.securityDeposit}>
          {input("securityDeposit", amount)}
        </Field>
        <Field name="advanceRent" label="Advance rent (₹)" error={errors.advanceRent}>
          {input("advanceRent", amount)}
        </Field>
        <Field name="rentFreeDays" label="Rent-free period (days)" error={errors.rentFreeDays}>
          {input("rentFreeDays", whole)}
        </Field>
        <Field name="lockInMonths" label="Lock-in period (months)" error={errors.lockInMonths}>
          {input("lockInMonths", whole)}
        </Field>
        <Field name="leaseTenureMonths" label="Lease tenure (months, optional)" hint="e.g. 108 for 9 years" error={errors.leaseTenureMonths}>
          {input("leaseTenureMonths", { ...whole, min: 1, required: false })}
        </Field>
        <Field name="rentEscalationPct" label="Rent escalation (% per year, optional)" error={errors.rentEscalationPct}>
          {input("rentEscalationPct", { ...amount, max: 100, required: false })}
        </Field>
      </fieldset>

      <Field name="notes" label="Other details (optional)" hint="Visible to the Expansion Manager, Sales, Ops and the Founder." error={errors.notes}>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={5000}
          defaultValue={property?.notes ?? ""}
          className={inputClass}
        />
      </Field>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Saving…" : property ? "Save changes" : "Save & continue to photos/videos"}
        </button>
      </div>
    </form>
  );
}
