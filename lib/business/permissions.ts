// The permission matrix: which role may do what in each business module.
// These are the defaults seeded into the role_permissions table; the
// Founder can change them in-app, and the database's row-level security
// reads that table on every query (see lib/server/migrations/business.ts).
// The Founder always has every permission, whatever the table says.

import type { Role } from "@/lib/expansion/roles";

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "assign", "manage"] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_INFO: Record<Action, string> = {
  view: "See the department's records",
  create: "Add new records",
  edit: "Change records they own or are assigned (all records with Manage)",
  delete: "Archive records",
  approve: "Approve or reject requests",
  export: "Download CSV reports",
  assign: "Assign records to colleagues",
  manage: "Edit every record and configure the module",
};

export const MODULES = [
  "leads",
  "customers",
  "deals",
  "sales_activities",
  "quotations",
  "sales_targets",
  "transactions",
  "expenses",
  "budgets",
  "invoices",
  "finance_payments",
  "projects",
  "tasks",
  "inventory",
  "vendors",
  "purchase_orders",
  "documents",
  "approvals",
  "employees",
  "reports",
  "audit",
] as const;
export type Module = (typeof MODULES)[number];

export const DEPARTMENTS = ["founder", "sales", "finance", "operations", "expansion"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_INFO: Record<Department, { label: string }> = {
  founder: { label: "Founder's office" },
  sales: { label: "Sales" },
  finance: { label: "Finance" },
  operations: { label: "Operations" },
  expansion: { label: "Expansion" },
};

export const MODULE_INFO: Record<Module, { label: string; department: Department }> = {
  leads: { label: "Leads", department: "sales" },
  customers: { label: "Customers", department: "sales" },
  deals: { label: "Deals & pipeline", department: "sales" },
  sales_activities: { label: "Follow-ups & activity", department: "sales" },
  quotations: { label: "Quotations", department: "sales" },
  sales_targets: { label: "Sales targets", department: "sales" },
  transactions: { label: "Transactions", department: "finance" },
  expenses: { label: "Expenses", department: "finance" },
  budgets: { label: "Budgets", department: "finance" },
  invoices: { label: "Invoices", department: "finance" },
  finance_payments: { label: "Payments", department: "finance" },
  projects: { label: "Projects", department: "operations" },
  tasks: { label: "Tasks", department: "operations" },
  inventory: { label: "Inventory", department: "operations" },
  vendors: { label: "Vendors", department: "operations" },
  purchase_orders: { label: "Procurement", department: "operations" },
  documents: { label: "Documents", department: "founder" },
  approvals: { label: "Approvals inbox", department: "founder" },
  employees: { label: "Employees", department: "founder" },
  reports: { label: "Company reports", department: "founder" },
  audit: { label: "Audit log", department: "founder" },
};

/** Which department each role belongs to by default. */
export const ROLE_DEPARTMENT: Record<Role, Department> = {
  founder: "founder",
  admin: "founder",
  sales: "sales",
  finance: "finance",
  ops: "operations",
  expansion_manager: "expansion",
  real_estate: "expansion",
  business: "expansion",
};

type Grants = Partial<Record<Module, readonly Action[]>>;

const ALL: readonly Action[] = ACTIONS;

// Everyone may submit expenses and see/create documents in their own
// department; tasks assigned to someone are always visible to them
// (ownership rules live in the database policies, not here).
const EVERYONE: Grants = {
  expenses: ["create"],
  documents: ["view", "create"],
};

export const DEFAULT_PERMISSIONS: Record<Role, Grants> = {
  founder: Object.fromEntries(MODULES.map((m) => [m, ALL])) as Grants,
  admin: {
    ...EVERYONE,
    employees: ["view", "create", "edit", "manage"],
    audit: ["view"],
  },
  sales: {
    ...EVERYONE,
    leads: ["view", "create", "edit", "assign", "export"],
    customers: ["view", "create", "edit", "export"],
    deals: ["view", "create", "edit", "export"],
    sales_activities: ["view", "create", "edit"],
    quotations: ["view", "create", "edit", "export"],
    sales_targets: ["view"],
    projects: ["view"],
    inventory: ["view"],
  },
  finance: {
    ...EVERYONE,
    transactions: ["view", "create", "edit", "approve", "export"],
    expenses: ["view", "create", "edit", "approve", "export"],
    budgets: ["view", "create", "edit", "manage", "export"],
    invoices: ["view", "create", "edit", "export"],
    finance_payments: ["view", "create", "export"],
    purchase_orders: ["view", "approve"],
    customers: ["view"],
    deals: ["view"],
    vendors: ["view"],
    projects: ["view"],
    approvals: ["view"],
  },
  ops: {
    ...EVERYONE,
    projects: ["view", "create", "edit", "assign"],
    tasks: ["view", "create", "edit", "assign", "manage", "export"],
    inventory: ["view", "create", "edit", "export"],
    vendors: ["view", "create", "edit"],
    purchase_orders: ["view", "create", "edit"],
    customers: ["view"],
    deals: ["view"],
  },
  expansion_manager: {
    ...EVERYONE,
    projects: ["view", "create", "edit", "assign"],
    tasks: ["view", "create", "edit", "assign"],
    vendors: ["view"],
  },
  real_estate: { ...EVERYONE },
  business: { ...EVERYONE, projects: ["view"], deals: ["view"], customers: ["view"] },
};

/** Modules and actions the Founder can never take away from themselves. */
export function isLocked(role: Role): boolean {
  return role === "founder";
}
