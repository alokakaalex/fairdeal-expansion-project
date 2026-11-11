// Parses and validates the forms. Pure, so the same rules are unit tested
// and enforced on the server regardless of what the browser sent.

import { parseCoordinates, safeHttpUrl } from "./maps";

export const STRUCTURE_TYPES = ["tin", "shed", "rcc"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];
export const STRUCTURE_LABEL: Record<StructureType, string> = { tin: "Tin", shed: "Shed", rcc: "RCC" };

export interface PropertyInput {
  storeName: string;
  address: string;
  mapUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  totalAreaSqft: number;
  carpetAreaSqft: number;
  askingRent: number;
  securityDeposit: number;
  advanceRent: number;
  lockInMonths: number;
  structureType: StructureType;
  structureHeightFt: number;
  rentFreeDays: number;
  handoverDate: string;
  leaseTenureMonths: number | null;
  rentEscalationPct: number | null;
  notes: string;
}

type Source = { get(name: string): unknown };

export type Errors<T> = Partial<Record<keyof T, string>>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Errors<T> };

function text(src: Source, name: string): string {
  const v = src.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Small helpers bound to one form's error map. */
function reader<T>(src: Source, errors: Errors<T>) {
  const str = (name: keyof T & string, label: string, max: number, required = true) => {
    const v = text(src, name);
    if (required && !v) errors[name] = `${label} is required.`;
    else if (v.length > max) errors[name] = `${label} must be at most ${max} characters.`;
    return v;
  };
  const num = (
    name: keyof T & string,
    label: string,
    opts: { min?: number; max?: number; integer?: boolean; positive?: boolean; optional?: boolean } = {},
  ): number | null => {
    const raw = text(src, name).replace(/,/g, "");
    if (!raw) {
      if (!opts.optional) errors[name] = `${label} is required.`;
      return opts.optional ? null : 0;
    }
    const v = Number(raw);
    const { min = 0, max = 1e12, integer = false, positive = false } = opts;
    if (!Number.isFinite(v)) errors[name] = `${label} must be a number.`;
    else if (integer && !Number.isInteger(v)) errors[name] = `${label} must be a whole number.`;
    else if (positive && v <= 0) errors[name] = `${label} must be greater than 0.`;
    else if (v < min) errors[name] = `${label} can't be less than ${min}.`;
    else if (v > max) errors[name] = `${label} can't be more than ${max}.`;
    return v;
  };
  const date = (name: keyof T & string, label: string, required = true) => {
    const v = text(src, name);
    if (!v) {
      if (required) errors[name] = `${label} is required.`;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
      errors[name] = `Enter a valid date.`;
    }
    return v;
  };
  return { str, num, date };
}

function done<T>(errors: Errors<T>, value: T): Parsed<T> {
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

export function parsePropertyInput(src: Source): Parsed<PropertyInput> {
  const errors: Errors<PropertyInput> = {};
  const { str, num, date } = reader<PropertyInput>(src, errors);

  const storeName = str("storeName", "Store / property name", 150);
  const address = str("address", "Address", 500);
  const notes = str("notes", "Notes", 5000, false);

  const mapRaw = text(src, "mapUrl");
  let mapUrl: string | null = null;
  let coords = null;
  if (!mapRaw) errors.mapUrl = "Google Maps link is required.";
  else if (mapRaw.length > 2000) errors.mapUrl = "Map link is too long.";
  else {
    coords = parseCoordinates(mapRaw);
    mapUrl = safeHttpUrl(mapRaw);
    if (!mapUrl && !coords) errors.mapUrl = "Paste a Google Maps link (https://…) or coordinates like 28.6139, 77.2090.";
  }

  const totalAreaSqft = num("totalAreaSqft", "Total area", { positive: true, max: 10_000_000 })!;
  const carpetAreaSqft = num("carpetAreaSqft", "Carpet area", { positive: true, max: 10_000_000 })!;
  if (!errors.totalAreaSqft && !errors.carpetAreaSqft && carpetAreaSqft > totalAreaSqft) {
    errors.carpetAreaSqft = "Carpet area can't be more than the total area.";
  }
  const askingRent = num("askingRent", "Asking rent", { positive: true })!;
  const securityDeposit = num("securityDeposit", "Security deposit")!;
  const advanceRent = num("advanceRent", "Advance rent")!;
  const lockInMonths = num("lockInMonths", "Lock-in period", { integer: true, max: 1200 })!;
  const rentFreeDays = num("rentFreeDays", "Rent-free period", { integer: true, max: 3650 })!;
  const structureHeightFt = num("structureHeightFt", "Structure height", { positive: true, max: 500 })!;
  const leaseTenureMonths = num("leaseTenureMonths", "Lease tenure", { integer: true, positive: true, max: 1200, optional: true });
  const rentEscalationPct = num("rentEscalationPct", "Rent escalation", { max: 100, optional: true });

  const structureRaw = text(src, "structureType");
  const structureType = (STRUCTURE_TYPES as readonly string[]).includes(structureRaw) ? (structureRaw as StructureType) : "rcc";
  if (!(STRUCTURE_TYPES as readonly string[]).includes(structureRaw)) errors.structureType = "Choose tin, shed or RCC.";

  const handoverDate = date("handoverDate", "Handover date");

  if (leaseTenureMonths != null && !errors.lockInMonths && lockInMonths > leaseTenureMonths) {
    errors.lockInMonths = "Lock-in period can't be longer than the lease tenure.";
  }

  return done(errors, {
    storeName,
    address,
    mapUrl,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    totalAreaSqft,
    carpetAreaSqft,
    askingRent,
    securityDeposit,
    advanceRent,
    lockInMonths,
    structureType,
    structureHeightFt,
    rentFreeDays,
    handoverDate,
    leaseTenureMonths,
    rentEscalationPct,
    notes,
  });
}

// --- Owners -----------------------------------------------------------------

export interface OwnerInput {
  name: string;
  email: string;
  phone: string;
  isOrganisation: boolean;
  gstNumber: string;
  panNumber: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
}

export function parseOwnerInput(src: Source): Parsed<OwnerInput> {
  const errors: Errors<OwnerInput> = {};
  const { str } = reader<OwnerInput>(src, errors);
  const name = str("name", "Owner name", 150);
  const email = str("email", "Email", 254, false).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  const phone = str("phone", "Phone", 30, false);
  const isOrganisation = text(src, "isOrganisation") === "on" || text(src, "isOrganisation") === "true";
  const gstNumber = str("gstNumber", "GST number", 20, false).toUpperCase();
  if (isOrganisation && !gstNumber) errors.gstNumber = "GST number is required for an organisation.";
  else if (gstNumber && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstNumber)) errors.gstNumber = "GST number should be 15 characters (e.g. 07ABCDE1234F1Z5).";
  const panNumber = str("panNumber", "PAN", 10, false).toUpperCase();
  if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) errors.panNumber = "PAN should look like ABCDE1234F.";

  const bankAccountName = str("bankAccountName", "Account holder name", 150, false);
  const bankAccountNumber = str("bankAccountNumber", "Account number", 30, false).replace(/\s/g, "");
  const bankIfsc = str("bankIfsc", "IFSC", 11, false).toUpperCase();
  const bankName = str("bankName", "Bank name", 150, false);
  const anyBank = bankAccountName || bankAccountNumber || bankIfsc || bankName;
  if (anyBank) {
    if (!bankAccountName) errors.bankAccountName = "Account holder name is required with bank details.";
    if (!/^[0-9]{6,20}$/.test(bankAccountNumber)) errors.bankAccountNumber = "Account number should be 6–20 digits.";
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc)) errors.bankIfsc = "IFSC should look like HDFC0001234.";
    if (!bankName) errors.bankName = "Bank name is required with bank details.";
  }

  return done(errors, {
    name,
    email,
    phone,
    isOrganisation,
    gstNumber,
    panNumber,
    bankAccountName,
    bankAccountNumber,
    bankIfsc,
    bankName,
  });
}

// --- Payments -----------------------------------------------------------------

export interface PaymentInput {
  amount: number;
  utr: string;
  paidOn: string;
  notes: string;
}

export function parsePaymentInput(src: Source): Parsed<PaymentInput> {
  const errors: Errors<PaymentInput> = {};
  const { str, num, date } = reader<PaymentInput>(src, errors);
  const amount = num("amount", "Amount", { positive: true })!;
  const utr = str("utr", "UTR number", 40).toUpperCase().replace(/\s/g, "");
  if (utr && !/^[A-Z0-9]{8,40}$/.test(utr)) errors.utr = "UTR should be 8–40 letters and digits.";
  const paidOn = date("paidOn", "Payment date");
  const notes = str("notes", "Notes", 2000, false);
  return done(errors, { amount, utr, paidOn, notes });
}

export interface StampDutyRequestInput {
  amount: number;
  remarks: string;
}

export function parseStampDutyRequest(src: Source): Parsed<StampDutyRequestInput> {
  const errors: Errors<StampDutyRequestInput> = {};
  const { str, num } = reader<StampDutyRequestInput>(src, errors);
  const amount = num("amount", "Stamp duty amount", { positive: true })!;
  const remarks = str("remarks", "Remarks", 2000, false);
  return done(errors, { amount, remarks });
}
