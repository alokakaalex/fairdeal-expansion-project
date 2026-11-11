// Roles and the portal each one lands on after signing in. A user holds
// exactly one role; the access manager assigns it.

export const ROLES = [
  "admin",
  "expansion_manager",
  "real_estate",
  "business",
  "sales",
  "ops",
  "founder",
  "finance",
] as const;
export type Role = (typeof ROLES)[number];

export interface RoleInfo {
  label: string;
  description: string;
  portal: string;
}

export const ROLE_INFO: Record<Role, RoleInfo> = {
  admin: {
    label: "Access Manager",
    description:
      "Adds people by email and assigns their role. Sees every property and document, manages backups and settings.",
    portal: "/admin",
  },
  expansion_manager: {
    label: "Expansion Manager",
    description:
      "First review of every scouted property. Uploads the LOI, signed LOI and signed agreement, requests stamp duty, and sees the complete dashboard.",
    portal: "/expansion",
  },
  real_estate: {
    label: "Real Estate Manager",
    description:
      "Scouts and uploads properties with photos/videos, then uploads owner KYC, bank and property documents once Ops approves.",
    portal: "/real-estate",
  },
  business: {
    label: "Business Leader",
    description:
      "Reviews properties the Expansion Manager approved: store name, area, rent, deposit, advance and rent-free days. Approves, holds or rejects.",
    portal: "/business",
  },
  sales: {
    label: "Sales Team",
    description: "Reviews properties Business Leaders approved, with all property details and media. Approves or rejects.",
    portal: "/sales",
  },
  ops: {
    label: "Ops Team",
    description:
      "Visits properties Sales approved, uploads site photos/videos, marks visited, writes the scope of work, then approves or rejects.",
    portal: "/ops",
  },
  founder: {
    label: "Founder",
    description:
      "Final approval once the signed LOI is in. Sees everything: details, media, documents, every department's decision and all payments.",
    portal: "/founder",
  },
  finance: {
    label: "Finance Team",
    description:
      "Releases the token, the balance after the agreement, and stamp duty when requested. Marks each paid with the UTR and receipt.",
    portal: "/finance",
  },
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
