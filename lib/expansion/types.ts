// Shapes passed from the server data layer to pages and components. These
// never carry secrets (password hashes, tokens) and only carry what the
// viewer's role may see.

import type { StructureType } from "./propertyInput";
import type { Role } from "./roles";
import type { Decision, FileCategory, PropertyState, Stage } from "./workflow";

export type UserStatus = "invited" | "active" | "disabled";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  /** Sales team only: may approve or reject (others have view access). */
  salesApprover: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface StoredFile {
  id: string;
  category: FileCategory;
  ownerId: number | null;
  /** Receipts and calculations attached to a payment record. */
  paymentId: number | null;
  kind: "image" | "video" | "pdf" | "doc";
  mime: string;
  originalName: string;
  sizeBytes: number;
  /** SHA-256 fingerprint (files stored on the server's disk); bucket files carry the bucket's ETag instead. */
  sha256: string | null;
  uploadedByName: string;
  createdAt: string;
  /** Replaced or removed; kept for the record, only admins/EM/founder see these. */
  archivedAt: string | null;
}

export interface DecisionRecord {
  id: number;
  round: number;
  stage: Stage;
  decision: Decision;
  remarks: string;
  decidedBy: string;
  decidedByName: string;
  decidedAt: string;
}

/** Property fields; any the viewer's role may not see are null. */
export interface PropertyDetails {
  storeName: string;
  address: string | null;
  mapUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  totalAreaSqft: number | null;
  carpetAreaSqft: number | null;
  askingRent: number | null;
  securityDeposit: number | null;
  advanceRent: number | null;
  lockInMonths: number | null;
  structureType: StructureType | null;
  structureHeightFt: number | null;
  rentFreeDays: number | null;
  handoverDate: string | null;
  leaseTenureMonths: number | null;
  rentEscalationPct: number | null;
  notes: string | null;
}

export interface Owner {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  isOrganisation: boolean;
  gstNumber: string | null;
  panNumber: string | null;
  /** Present only for roles that may see bank details. */
  bank: { accountName: string; accountNumber: string; ifsc: string; bankName: string } | null;
  hasBankDetails: boolean;
}

export interface OpsVisit {
  visitedAt: string | null;
  visitedByName: string | null;
  scopeOfWork: string;
  updatedAt: string | null;
}

export type PaymentKind = "token" | "balance" | "stamp_duty";

export interface Payment {
  id: number;
  kind: PaymentKind;
  status: "requested" | "paid";
  /** Stamp duty only: what the expansion manager asked for. */
  requestedAmount: number | null;
  requestedByName: string | null;
  requestedAt: string | null;
  requestRemarks: string | null;
  amount: number | null;
  utr: string | null;
  paidOn: string | null;
  paidByName: string | null;
  paidAt: string | null;
  notes: string | null;
}

export interface PropertyView extends PropertyDetails {
  id: number;
  code: string;
  state: PropertyState;
  stage: Stage | null;
  onHold: boolean;
  round: number;
  furthestStage: Stage | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  loiSentAt: string | null;
  loiSentTo: string | null;
  documentsCompletedAt: string | null;
  /** Files the viewer may see. */
  files: StoredFile[];
  /** Every decision, oldest first, across all rounds. */
  decisions: DecisionRecord[];
  owners: Owner[] | null;
  visit: OpsVisit | null;
  payments: Payment[] | null;
}

export interface Notification {
  id: number;
  propertyId: number | null;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  actorName: string | null;
  action: string;
  details: string | null;
  createdAt: string;
}
