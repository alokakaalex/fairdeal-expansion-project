import { ACTIONS, DEFAULT_PERMISSIONS, DEPARTMENT_INFO, DEPARTMENTS, MODULES, ROLE_DEPARTMENT } from "@/lib/business/permissions";
import { ROLES } from "@/lib/expansion/roles";

// Migration 2: the Sales, Finance and Operations modules, generic
// documents, approvals, and database-level authorization.
//
// How authorization works: the app connects as the database owner, but every
// business query runs inside withUser() (lib/server/db.ts), which switches the
// transaction to the restricted role fd_app and records the signed-in user in
// app.user_id. fd_app can only reach rows the policies below allow, and has no
// DELETE right anywhere and no write access to users or role_permissions. So
// even a bug in a server-side check cannot leak another department's rows or
// let anyone change their own role.

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Row rules per table for fd_app. `update` decides which rows may be changed;
 * `check` (default: `update`) is what the changed row must satisfy — looser
 * where a change legitimately hands the row to someone else.
 */
type Policy = { select: string; insert: string; update?: string; check?: string };

const can = (module: string, action: string) => `app_can(${q(module)}, ${q(action)})`;
const me = "app_user_id()";

/**
 * Standard rules: viewers see every row, creators and owners see theirs;
 * editors change rows they own (any row when the department owns the records
 * collectively, `shared`); managers change everything.
 */
function standard(module: string, own: string, shared = false): Policy {
  const edit = shared ? `${can(module, "edit")} OR ${can(module, "delete")}` : `(${can(module, "edit")} OR ${can(module, "delete")}) AND (${own})`;
  return {
    select: `${can(module, "view")} OR ${own}`,
    insert: `${can(module, "create")} AND created_by = ${me}`,
    update: `${can(module, "manage")} OR (${edit})`,
    check: `${can(module, "manage")} OR ${can(module, "edit")} OR ${can(module, "delete")}`,
  };
}

const POLICIES: Record<string, Policy> = {
  customers: standard("customers", `owner_id = ${me} OR created_by = ${me}`),
  leads: {
    ...standard("leads", `assigned_to = ${me} OR created_by = ${me}`),
    // Assigning a lead to someone else needs the assign right.
    insert: `${can("leads", "create")} AND created_by = ${me} AND (assigned_to IS NULL OR assigned_to = ${me} OR ${can("leads", "assign")})`,
  },
  deals: standard("deals", `owner_id = ${me} OR created_by = ${me}`),
  sales_activities: standard("sales_activities", `created_by = ${me}`),
  quotations: standard("quotations", `created_by = ${me}`),
  sales_targets: {
    select: `${can("sales_targets", "view")} OR user_id = ${me}`,
    insert: `${can("sales_targets", "manage")} AND created_by = ${me}`,
    update: can("sales_targets", "manage"),
  },
  pipeline_stages: { select: "true", insert: can("deals", "manage"), update: can("deals", "manage") },

  vendors: standard("vendors", `created_by = ${me}`, true),
  projects: {
    ...standard("projects", `owner_id = ${me} OR created_by = ${me}`),
    // Anyone with a task in a project can see the project it belongs to.
    select: `${can("projects", "view")} OR owner_id = ${me} OR created_by = ${me} OR id IN (SELECT project_id FROM tasks WHERE assigned_to = ${me})`,
  },
  tasks: {
    select: `${can("tasks", "view")} OR assigned_to = ${me} OR created_by = ${me}`,
    insert: `${can("tasks", "create")} AND created_by = ${me} AND (assigned_to IS NULL OR assigned_to = ${me} OR ${can("tasks", "assign")})`,
    // Assignees may update progress; tasks_guard() stops them changing anything else.
    update: `${can("tasks", "manage")} OR (${can("tasks", "edit")} AND created_by = ${me}) OR assigned_to = ${me}`,
    check: `${can("tasks", "manage")} OR ${can("tasks", "edit")} OR assigned_to = ${me} OR created_by = ${me}`,
  },
  task_comments: {
    select: "task_id IN (SELECT id FROM tasks)",
    insert: `author_id = ${me} AND task_id IN (SELECT id FROM tasks)`,
  },
  inventory_items: standard("inventory", `created_by = ${me}`, true),
  inventory_movements: {
    select: can("inventory", "view"),
    insert: `${can("inventory", "edit")} AND created_by = ${me}`,
  },
  purchase_orders: {
    select: `${can("purchase_orders", "view")} OR created_by = ${me}`,
    insert: `${can("purchase_orders", "create")} AND created_by = ${me}`,
    update: `${can("purchase_orders", "manage")} OR ${can("purchase_orders", "approve")} OR (${can("purchase_orders", "edit")} AND created_by = ${me})`,
  },

  budgets: standard("budgets", `created_by = ${me}`, true),
  transactions: {
    select: can("transactions", "view"),
    insert: `${can("transactions", "create")} AND created_by = ${me}`,
    update: `${can("transactions", "edit")} OR ${can("transactions", "approve")}`,
  },
  expenses: {
    select: `${can("expenses", "view")} OR submitted_by = ${me}`,
    insert: `${can("expenses", "create")} AND submitted_by = ${me}`,
    update: `${can("expenses", "manage")} OR ${can("expenses", "approve")} OR (submitted_by = ${me} AND status = 'submitted')`,
    check: `${can("expenses", "manage")} OR ${can("expenses", "approve")} OR (submitted_by = ${me} AND status = 'submitted')`,
  },
  invoices: {
    select: can("invoices", "view"),
    insert: `${can("invoices", "create")} AND created_by = ${me}`,
    update: can("invoices", "edit"),
  },
  finance_payments: {
    select: can("finance_payments", "view"),
    insert: `${can("finance_payments", "create")} AND recorded_by = ${me}`,
  },
  approval_requests: {
    select: `requested_by = ${me} OR ${can("approvals", "view")} OR app_can(approval_module(kind), 'approve')`,
    insert: `requested_by = ${me}`,
    update: `app_can(approval_module(kind), 'approve') OR (requested_by = ${me} AND status = 'pending')`,
    check: `app_can(approval_module(kind), 'approve') OR requested_by = ${me}`,
  },

  documents: {
    select: `created_by = ${me} OR (${can("documents", "view")} AND (NOT confidential OR department = app_department() OR ${can("documents", "manage")}))`,
    insert: `${can("documents", "create")} AND created_by = ${me}`,
    update: `created_by = ${me} OR ${can("documents", "manage")}`,
  },
  // Only files that belong to a visible document (property files stay server-side only).
  files: { select: "document_id IN (SELECT id FROM documents)", insert: "false" },
  notifications: { select: `user_id = ${me}`, insert: "true", update: `user_id = ${me}` },
  audit_log: { select: can("audit", "view"), insert: `actor_id = ${me}` },
  departments: { select: "true", insert: "false" },
  role_permissions: { select: "true", insert: "false" },
  // Colleagues' names and roles (the column grant below hides everything else).
  users: { select: "true", insert: "false" },
};


/** Status transitions the database accepts, per table. */
const TRANSITIONS: Record<string, Record<string, string[]>> = {
  invoices: { draft: ["issued", "void"], issued: ["partially_paid", "paid", "void"], partially_paid: ["paid"], paid: [], void: [] },
  expenses: { submitted: ["approved", "rejected"], approved: ["paid"], rejected: [], paid: [] },
  purchase_orders: {
    draft: ["pending_approval", "cancelled"],
    pending_approval: ["approved", "rejected", "cancelled"],
    approved: ["ordered", "cancelled"],
    ordered: ["received", "cancelled"],
    rejected: ["draft"],
    received: [],
    cancelled: [],
  },
  transactions: { pending: ["approved", "rejected"], approved: [], rejected: [] },
  approval_requests: { pending: ["approved", "rejected", "cancelled"], approved: [], rejected: [], cancelled: [] },
  deals: { open: ["won", "lost"], won: [], lost: ["open"] },
  quotations: { draft: ["sent", "accepted", "rejected"], sent: ["accepted", "rejected", "expired"], accepted: [], rejected: [], expired: [] },
};

/** Tables whose every change is written to the audit log by the database itself. */
const AUDITED = [
  "customers",
  "leads",
  "deals",
  "quotations",
  "sales_targets",
  "pipeline_stages",
  "vendors",
  "projects",
  "tasks",
  "inventory_items",
  "purchase_orders",
  "budgets",
  "transactions",
  "expenses",
  "invoices",
  "finance_payments",
  "approval_requests",
  "documents",
];

/** Tables whose rows are never deleted, by anyone. */
const NEVER_DELETED = [...AUDITED, "sales_activities", "task_comments", "inventory_movements"];

const WITH_UPDATED_AT = [
  "customers",
  "leads",
  "deals",
  "quotations",
  "vendors",
  "projects",
  "tasks",
  "inventory_items",
  "purchase_orders",
  "budgets",
  "transactions",
  "expenses",
  "invoices",
  "documents",
];

const id = "id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY";
const money = (col: string, extra = "") => `${col} NUMERIC(14,2) ${extra}`;
const createdBy = "created_by TEXT NOT NULL REFERENCES users(id)";
const stamps = "created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()";
const PAYMENT_METHODS = "('bank_transfer', 'upi', 'cash', 'cheque', 'card', 'other')";

function tables(): string {
  return `
  -- Departments and the permission matrix --------------------------------------
  CREATE TABLE departments (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  INSERT INTO departments (code, name, position) VALUES
    ${DEPARTMENTS.map((d, i) => `(${q(d)}, ${q(DEPARTMENT_INFO[d].label)}, ${i})`).join(",\n    ")};

  ALTER TABLE users ADD COLUMN department TEXT REFERENCES departments(code);
  ALTER TABLE users ADD COLUMN title TEXT;
  ALTER TABLE users ADD COLUMN phone TEXT;
  CREATE FUNCTION role_department(p_role TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_role
      ${ROLES.map((r) => `WHEN ${q(r)} THEN ${q(ROLE_DEPARTMENT[r])}`).join("\n      ")}
    END
  $$;
  UPDATE users SET department = role_department(role);
  -- New people land in their role's department unless one is given.
  CREATE FUNCTION users_default_department() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    NEW.department := coalesce(NEW.department, role_department(NEW.role));
    RETURN NEW;
  END $$;
  CREATE TRIGGER users_department BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION users_default_department();

  CREATE TABLE role_permissions (
    role TEXT NOT NULL CHECK (role IN (${ROLES.map(q).join(", ")})),
    module TEXT NOT NULL CHECK (module IN (${MODULES.map(q).join(", ")})),
    action TEXT NOT NULL CHECK (action IN (${ACTIONS.map(q).join(", ")})),
    granted_by TEXT REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role, module, action)
  );
  INSERT INTO role_permissions (role, module, action) VALUES
    ${ROLES.flatMap((role) =>
      Object.entries(DEFAULT_PERMISSIONS[role]).flatMap(([module, actions]) => actions!.map((a) => `(${q(role)}, ${q(module)}, ${q(a)})`)),
    ).join(",\n    ")};

  -- Sales ------------------------------------------------------------------------
  CREATE TABLE pipeline_stages (
    ${id},
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    position INTEGER NOT NULL,
    probability INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
    outcome TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('open', 'won', 'lost')),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX pipeline_stages_name ON pipeline_stages (lower(name));
  INSERT INTO pipeline_stages (name, position, probability, outcome) VALUES
    ('Qualification', 1, 10, 'open'), ('Needs analysis', 2, 25, 'open'), ('Proposal', 3, 50, 'open'),
    ('Negotiation', 4, 75, 'open'), ('Won', 5, 100, 'won'), ('Lost', 6, 0, 'lost');

  CREATE TABLE customers (
    ${id},
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    gstin TEXT,
    address TEXT,
    city TEXT,
    owner_id TEXT REFERENCES users(id),
    notes TEXT NOT NULL DEFAULT '',
    ${createdBy},
    ${stamps},
    archived_at TIMESTAMPTZ
  );
  CREATE INDEX customers_name ON customers (lower(name));
  CREATE UNIQUE INDEX customers_email ON customers (lower(email)) WHERE email IS NOT NULL AND archived_at IS NULL;

  CREATE TABLE leads (
    ${id},
    customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0),
    company TEXT,
    email TEXT,
    phone TEXT,
    source TEXT NOT NULL CHECK (source IN ('referral', 'website', 'walk_in', 'cold_call', 'social', 'event', 'partner', 'other')),
    location TEXT,
    assigned_to TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost')),
    ${money("potential_value", "CHECK (potential_value >= 0)")},
    follow_up_date DATE,
    notes TEXT NOT NULL DEFAULT '',
    customer_id BIGINT REFERENCES customers(id),
    deal_id BIGINT,
    converted_at TIMESTAMPTZ,
    lost_reason TEXT,
    ${createdBy},
    ${stamps},
    archived_at TIMESTAMPTZ,
    CHECK (email IS NOT NULL OR phone IS NOT NULL),
    CHECK (status <> 'converted' OR (customer_id IS NOT NULL AND converted_at IS NOT NULL))
  );
  CREATE INDEX leads_assigned ON leads (assigned_to, status);
  CREATE INDEX leads_follow_up ON leads (follow_up_date) WHERE status NOT IN ('converted', 'lost', 'unqualified');

  CREATE TABLE deals (
    ${id},
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    lead_id BIGINT REFERENCES leads(id),
    stage_id BIGINT NOT NULL REFERENCES pipeline_stages(id),
    ${money("value", "NOT NULL CHECK (value >= 0)")},
    expected_close_date DATE,
    owner_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
    closed_at TIMESTAMPTZ,
    lost_reason TEXT,
    notes TEXT NOT NULL DEFAULT '',
    ${createdBy},
    ${stamps},
    archived_at TIMESTAMPTZ,
    CHECK ((status = 'open') = (closed_at IS NULL))
  );
  CREATE INDEX deals_owner ON deals (owner_id, status);
  CREATE INDEX deals_customer ON deals (customer_id);
  ALTER TABLE leads ADD CONSTRAINT leads_deal_fk FOREIGN KEY (deal_id) REFERENCES deals(id);

  CREATE TABLE sales_activities (
    ${id},
    kind TEXT NOT NULL CHECK (kind IN ('call', 'email', 'meeting', 'whatsapp', 'visit', 'note', 'follow_up')),
    subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
    body TEXT NOT NULL DEFAULT '',
    lead_id BIGINT REFERENCES leads(id),
    customer_id BIGINT REFERENCES customers(id),
    deal_id BIGINT REFERENCES deals(id),
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    ${createdBy},
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (lead_id IS NOT NULL OR customer_id IS NOT NULL OR deal_id IS NOT NULL)
  );
  CREATE INDEX sales_activities_lead ON sales_activities (lead_id);
  CREATE INDEX sales_activities_deal ON sales_activities (deal_id);
  CREATE INDEX sales_activities_customer ON sales_activities (customer_id);
  CREATE INDEX sales_activities_due ON sales_activities (created_by, due_at) WHERE completed_at IS NULL;

  CREATE TABLE quotations (
    ${id},
    number TEXT NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    deal_id BIGINT REFERENCES deals(id),
    issue_date DATE NOT NULL,
    valid_until DATE,
    ${money("subtotal", "NOT NULL CHECK (subtotal >= 0)")},
    ${money("tax", "NOT NULL DEFAULT 0 CHECK (tax >= 0)")},
    total NUMERIC(14,2) GENERATED ALWAYS AS (subtotal + tax) STORED,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
    notes TEXT NOT NULL DEFAULT '',
    ${createdBy},
    ${stamps},
    CHECK (valid_until IS NULL OR valid_until >= issue_date)
  );

  CREATE TABLE sales_targets (
    ${id},
    user_id TEXT REFERENCES users(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    ${money("target_amount", "NOT NULL CHECK (target_amount > 0)")},
    ${createdBy},
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start),
    UNIQUE NULLS NOT DISTINCT (user_id, period_start, period_end)
  );

  -- Operations -------------------------------------------------------------------
  CREATE TABLE vendors (
    ${id},
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    category TEXT,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    gstin TEXT,
    address TEXT,
    notes TEXT NOT NULL DEFAULT '',
    ${createdBy},
    ${stamps},
    archived_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX vendors_name ON vendors (lower(name)) WHERE archived_at IS NULL;

  CREATE TABLE projects (
    ${id},
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('expansion', 'customer_order', 'internal')),
    status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
    department TEXT NOT NULL DEFAULT 'operations' REFERENCES departments(code),
    owner_id TEXT REFERENCES users(id),
    customer_id BIGINT REFERENCES customers(id),
    deal_id BIGINT REFERENCES deals(id),
    property_id INTEGER REFERENCES properties(id),
    ${money("budget", "CHECK (budget >= 0)")},
    start_date DATE,
    due_date DATE,
    completed_at TIMESTAMPTZ,
    ${createdBy},
    ${stamps},
    archived_at TIMESTAMPTZ,
    CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
  );
  -- Converting a deal twice can't create two projects.
  CREATE UNIQUE INDEX projects_deal ON projects (deal_id) WHERE deal_id IS NOT NULL;
  CREATE INDEX projects_status ON projects (status);

  CREATE TABLE tasks (
    ${id},
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    project_id BIGINT REFERENCES projects(id),
    assigned_to TEXT REFERENCES users(id),
    department TEXT NOT NULL REFERENCES departments(code),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    start_date DATE,
    due_date DATE,
    status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (status IN ('not_started', 'in_progress', 'under_review', 'completed', 'on_hold', 'cancelled')),
    completion_notes TEXT,
    completed_at TIMESTAMPTZ,
    ${createdBy},
    ${stamps},
    archived_at TIMESTAMPTZ,
    CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
  );
  CREATE INDEX tasks_assignee ON tasks (assigned_to, status);
  CREATE INDEX tasks_project ON tasks (project_id);
  CREATE INDEX tasks_due ON tasks (due_date) WHERE status NOT IN ('completed', 'cancelled');

  CREATE TABLE task_comments (
    ${id},
    task_id BIGINT NOT NULL REFERENCES tasks(id),
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    author_id TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX task_comments_task ON task_comments (task_id);

  CREATE TABLE inventory_items (
    ${id},
    sku TEXT NOT NULL CHECK (length(trim(sku)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    category TEXT,
    unit TEXT NOT NULL DEFAULT 'pcs',
    quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    ${money("unit_cost", "CHECK (unit_cost >= 0)")},
    location TEXT,
    ${createdBy},
    ${stamps},
    archived_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX inventory_items_sku ON inventory_items (lower(sku));

  CREATE TABLE purchase_orders (
    ${id},
    number TEXT NOT NULL UNIQUE,
    vendor_id BIGINT NOT NULL REFERENCES vendors(id),
    project_id BIGINT REFERENCES projects(id),
    description TEXT NOT NULL CHECK (length(trim(description)) > 0),
    ${money("amount", "NOT NULL CHECK (amount > 0)")},
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'ordered', 'received', 'cancelled')),
    expected_date DATE,
    approved_by TEXT REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    ${createdBy},
    ${stamps}
  );
  CREATE INDEX purchase_orders_status ON purchase_orders (status);

  -- Every stock change is a movement; the item's quantity follows (and can't go below zero).
  CREATE TABLE inventory_movements (
    ${id},
    item_id BIGINT NOT NULL REFERENCES inventory_items(id),
    kind TEXT NOT NULL CHECK (kind IN ('in', 'out', 'adjust')),
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity <> 0 AND (kind = 'adjust' OR quantity > 0)),
    reason TEXT NOT NULL DEFAULT '',
    project_id BIGINT REFERENCES projects(id),
    vendor_id BIGINT REFERENCES vendors(id),
    purchase_order_id BIGINT REFERENCES purchase_orders(id),
    ${createdBy},
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX inventory_movements_item ON inventory_movements (item_id);

  -- Finance ----------------------------------------------------------------------
  CREATE TABLE budgets (
    ${id},
    department TEXT NOT NULL REFERENCES departments(code),
    category TEXT NOT NULL CHECK (length(trim(category)) > 0),
    project_id BIGINT REFERENCES projects(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    ${money("amount", "NOT NULL CHECK (amount > 0)")},
    notes TEXT NOT NULL DEFAULT '',
    ${createdBy},
    ${stamps},
    CHECK (period_end >= period_start),
    UNIQUE NULLS NOT DISTINCT (department, category, project_id, period_start, period_end)
  );

  CREATE TABLE invoices (
    ${id},
    number TEXT NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    deal_id BIGINT REFERENCES deals(id),
    project_id BIGINT REFERENCES projects(id),
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    ${money("subtotal", "NOT NULL CHECK (subtotal > 0)")},
    ${money("tax", "NOT NULL DEFAULT 0 CHECK (tax >= 0)")},
    total NUMERIC(14,2) GENERATED ALWAYS AS (subtotal + tax) STORED,
    ${money("amount_paid", "NOT NULL DEFAULT 0 CHECK (amount_paid >= 0)")},
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void')),
    notes TEXT NOT NULL DEFAULT '',
    ${createdBy},
    ${stamps},
    CHECK (due_date >= issue_date),
    CHECK (amount_paid <= subtotal + tax),
    CHECK (status <> 'paid' OR amount_paid = subtotal + tax)
  );
  CREATE INDEX invoices_status ON invoices (status, due_date);
  CREATE INDEX invoices_customer ON invoices (customer_id);

  CREATE TABLE expenses (
    ${id},
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    ${money("amount", "NOT NULL CHECK (amount > 0)")},
    category TEXT NOT NULL CHECK (length(trim(category)) > 0),
    expense_date DATE NOT NULL,
    department TEXT NOT NULL REFERENCES departments(code),
    project_id BIGINT REFERENCES projects(id),
    vendor_id BIGINT REFERENCES vendors(id),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'paid')),
    submitted_by TEXT NOT NULL REFERENCES users(id),
    decided_by TEXT REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    paid_at TIMESTAMPTZ,
    ${stamps},
    CHECK ((status = 'submitted') = (decided_by IS NULL)),
    CHECK ((status = 'paid') = (paid_at IS NOT NULL))
  );
  CREATE INDEX expenses_status ON expenses (status, department);
  CREATE INDEX expenses_submitter ON expenses (submitted_by);

  CREATE TABLE transactions (
    ${id},
    txn_date DATE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    ${money("amount", "NOT NULL CHECK (amount > 0)")},
    category TEXT NOT NULL CHECK (length(trim(category)) > 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ${PAYMENT_METHODS}),
    reference TEXT,
    project_id BIGINT REFERENCES projects(id),
    department TEXT REFERENCES departments(code),
    vendor_id BIGINT REFERENCES vendors(id),
    customer_id BIGINT REFERENCES customers(id),
    expense_id BIGINT UNIQUE REFERENCES expenses(id),
    invoice_id BIGINT REFERENCES invoices(id),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by TEXT REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    ${createdBy},
    ${stamps},
    CHECK ((status = 'pending') = (approved_by IS NULL))
  );
  CREATE INDEX transactions_date ON transactions (txn_date, type);
  CREATE INDEX transactions_status ON transactions (status);

  CREATE TABLE finance_payments (
    ${id},
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    ${money("amount", "NOT NULL CHECK (amount > 0)")},
    paid_on DATE NOT NULL,
    method TEXT NOT NULL CHECK (method IN ${PAYMENT_METHODS}),
    reference TEXT,
    invoice_id BIGINT REFERENCES invoices(id),
    expense_id BIGINT REFERENCES expenses(id),
    purchase_order_id BIGINT REFERENCES purchase_orders(id),
    vendor_id BIGINT REFERENCES vendors(id),
    customer_id BIGINT REFERENCES customers(id),
    transaction_id BIGINT REFERENCES transactions(id),
    notes TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (direction = 'incoming' OR invoice_id IS NULL),
    CHECK (direction = 'outgoing' OR (expense_id IS NULL AND purchase_order_id IS NULL))
  );
  CREATE INDEX finance_payments_invoice ON finance_payments (invoice_id);

  -- Approvals ----------------------------------------------------------------------
  CREATE TABLE approval_requests (
    ${id},
    kind TEXT NOT NULL CHECK (kind IN ('expense', 'purchase_order', 'transaction', 'budget')),
    expense_id BIGINT REFERENCES expenses(id),
    purchase_order_id BIGINT REFERENCES purchase_orders(id),
    transaction_id BIGINT REFERENCES transactions(id),
    budget_id BIGINT REFERENCES budgets(id),
    title TEXT NOT NULL,
    ${money("amount")},
    department TEXT REFERENCES departments(code),
    requested_by TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    decided_by TEXT REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(expense_id, purchase_order_id, transaction_id, budget_id) = 1),
    CHECK (kind <> 'expense' OR expense_id IS NOT NULL),
    CHECK (kind <> 'purchase_order' OR purchase_order_id IS NOT NULL),
    CHECK (kind <> 'transaction' OR transaction_id IS NOT NULL),
    CHECK (kind <> 'budget' OR budget_id IS NOT NULL),
    CHECK ((status IN ('pending', 'cancelled')) = (decided_by IS NULL))
  );
  -- One open request per record.
  CREATE UNIQUE INDEX approval_requests_open ON approval_requests (kind, coalesce(expense_id, purchase_order_id, transaction_id, budget_id))
    WHERE status = 'pending';

  -- Documents ----------------------------------------------------------------------
  CREATE TABLE documents (
    ${id},
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    category TEXT NOT NULL CHECK (category IN
      ('contract', 'invoice', 'receipt', 'report', 'proposal', 'quotation', 'kyc', 'photo', 'video', 'specification', 'other')),
    description TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL REFERENCES departments(code),
    confidential BOOLEAN NOT NULL DEFAULT false,
    project_id BIGINT REFERENCES projects(id),
    customer_id BIGINT REFERENCES customers(id),
    lead_id BIGINT REFERENCES leads(id),
    deal_id BIGINT REFERENCES deals(id),
    vendor_id BIGINT REFERENCES vendors(id),
    task_id BIGINT REFERENCES tasks(id),
    expense_id BIGINT REFERENCES expenses(id),
    invoice_id BIGINT REFERENCES invoices(id),
    transaction_id BIGINT REFERENCES transactions(id),
    purchase_order_id BIGINT REFERENCES purchase_orders(id),
    ${createdBy},
    ${stamps},
    archived_at TIMESTAMPTZ,
    archived_by TEXT REFERENCES users(id)
  );
  CREATE INDEX documents_department ON documents (department, category);

  -- Files now belong to a property (expansion pipeline) or a document; each new
  -- file on a document is a new version and the old ones stay.
  ALTER TABLE files ALTER COLUMN property_id DROP NOT NULL;
  ALTER TABLE files ADD COLUMN document_id BIGINT REFERENCES documents(id);
  ALTER TABLE files ADD CONSTRAINT files_parent CHECK (property_id IS NOT NULL OR document_id IS NOT NULL);
  CREATE INDEX files_document ON files (document_id) WHERE document_id IS NOT NULL;
  ALTER TABLE uploads ALTER COLUMN property_id DROP NOT NULL;
  ALTER TABLE uploads ADD COLUMN document_id BIGINT REFERENCES documents(id);

  -- Notifications and audit carry a reference to any record ----------------------------
  ALTER TABLE notifications ADD COLUMN entity_type TEXT;
  ALTER TABLE notifications ADD COLUMN entity_id TEXT;
  ALTER TABLE audit_log ADD COLUMN entity_type TEXT;
  ALTER TABLE audit_log ADD COLUMN entity_id TEXT;
  ALTER TABLE audit_log ADD COLUMN before_data JSONB;
  ALTER TABLE audit_log ADD COLUMN after_data JSONB;
  CREATE INDEX audit_entity ON audit_log (entity_type, entity_id);
  `;
}

function functionsAndTriggers(): string {
  return `
  -- Who is asking ------------------------------------------------------------------
  CREATE FUNCTION app_user_id() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.user_id', true), '')
  $$;
  CREATE FUNCTION app_role() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role FROM users WHERE id = app_user_id() AND status = 'active'
  $$;
  CREATE FUNCTION app_department() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT department FROM users WHERE id = app_user_id() AND status = 'active'
  $$;
  -- The Founder can do everything; everyone else needs a row in role_permissions.
  CREATE FUNCTION app_can(p_module TEXT, p_action TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT coalesce(app_role() = 'founder', false)
        OR EXISTS (SELECT 1 FROM role_permissions WHERE role = app_role() AND module = p_module AND action = p_action)
  $$;
  CREATE FUNCTION approval_module(p_kind TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_kind WHEN 'expense' THEN 'expenses' WHEN 'purchase_order' THEN 'purchase_orders'
                       WHEN 'transaction' THEN 'transactions' WHEN 'budget' THEN 'budgets' END
  $$;

  -- Housekeeping ---------------------------------------------------------------------
  CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END $$;

  -- Status changes must follow the allowed transitions (TG_ARGV[0] is a JSON map).
  CREATE FUNCTION guard_status() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE allowed JSONB := TG_ARGV[0]::jsonb;
  BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT coalesce((allowed -> OLD.status) ? NEW.status, false) THEN
      RAISE EXCEPTION 'A % can''t go from % to %.', TG_TABLE_NAME, OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;

  -- Nobody approves their own request, except the Founder.
  CREATE FUNCTION refuse_self_approval(approver TEXT, requester TEXT) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    IF approver IS NOT NULL AND approver = requester
       AND NOT EXISTS (SELECT 1 FROM users WHERE id = approver AND role = 'founder') THEN
      RAISE EXCEPTION 'You can''t approve your own request.' USING ERRCODE = 'check_violation';
    END IF;
  END $$;

  -- Whoever is recorded as deciding must be the person signed in.
  CREATE FUNCTION require_signed_in_decider(new_decider TEXT, old_decider TEXT) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'fd_app' AND new_decider IS DISTINCT FROM old_decider AND new_decider IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'A decision can only be recorded in your own name.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END $$;

  CREATE FUNCTION expenses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    PERFORM require_signed_in_decider(NEW.decided_by, OLD.decided_by);
    IF OLD.status <> 'submitted' AND (NEW.amount, NEW.category, NEW.expense_date, NEW.department, NEW.submitted_by)
         IS DISTINCT FROM (OLD.amount, OLD.category, OLD.expense_date, OLD.department, OLD.submitted_by) THEN
      RAISE EXCEPTION 'An expense can''t be changed once it has been decided.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM refuse_self_approval(NEW.decided_by, NEW.submitted_by);
    RETURN NEW;
  END $$;

  CREATE FUNCTION transactions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'An approved or rejected transaction can''t be changed; record a correcting entry instead.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM require_signed_in_decider(NEW.approved_by, OLD.approved_by);
    PERFORM refuse_self_approval(NEW.approved_by, NEW.created_by);
    RETURN NEW;
  END $$;

  CREATE FUNCTION purchase_orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.status NOT IN ('draft', 'rejected') AND (NEW.amount, NEW.vendor_id) IS DISTINCT FROM (OLD.amount, OLD.vendor_id) THEN
      RAISE EXCEPTION 'A purchase order''s amount and vendor are fixed once submitted.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM require_signed_in_decider(NEW.approved_by, OLD.approved_by);
    PERFORM refuse_self_approval(NEW.approved_by, NEW.created_by);
    RETURN NEW;
  END $$;

  CREATE FUNCTION invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF OLD.status <> 'draft' AND (NEW.subtotal, NEW.tax, NEW.customer_id, NEW.issue_date) IS DISTINCT FROM (OLD.subtotal, OLD.tax, OLD.customer_id, OLD.issue_date) THEN
      RAISE EXCEPTION 'An issued invoice can''t be changed; void it and issue a new one.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END $$;

  CREATE FUNCTION approval_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.status = 'cancelled' AND OLD.requested_by <> coalesce(app_user_id(), OLD.requested_by) THEN
      RAISE EXCEPTION 'Only the person who asked can cancel a request.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM require_signed_in_decider(NEW.decided_by, OLD.decided_by);
    PERFORM refuse_self_approval(NEW.decided_by, NEW.requested_by);
    RETURN NEW;
  END $$;

  -- Someone a task is assigned to (without edit rights over it) may only move it along.
  CREATE FUNCTION tasks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'fd_app' AND NOT app_can('tasks', 'manage') AND OLD.created_by IS DISTINCT FROM app_user_id()
       AND (NEW.title, NEW.description, NEW.project_id, NEW.assigned_to, NEW.department, NEW.priority, NEW.start_date, NEW.due_date, NEW.archived_at)
           IS DISTINCT FROM (OLD.title, OLD.description, OLD.project_id, OLD.assigned_to, OLD.department, OLD.priority, OLD.start_date, OLD.due_date, OLD.archived_at) THEN
      RAISE EXCEPTION 'You can update the status and notes of tasks assigned to you; ask the task owner to change anything else.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF current_user = 'fd_app' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS DISTINCT FROM app_user_id()
       AND NOT app_can('tasks', 'assign') THEN
      RAISE EXCEPTION 'You don''t have permission to assign tasks to others.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;

  CREATE FUNCTION leads_guard() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF current_user = 'fd_app' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS DISTINCT FROM app_user_id()
       AND NOT app_can('leads', 'assign') THEN
      RAISE EXCEPTION 'You don''t have permission to assign leads to others.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;

  -- Stock follows movements. SECURITY DEFINER: recording a movement is the
  -- permission that matters; the quantity CHECK still refuses negative stock.
  CREATE FUNCTION apply_inventory_movement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    UPDATE inventory_items
       SET quantity = quantity + CASE NEW.kind WHEN 'out' THEN -NEW.quantity ELSE NEW.quantity END
     WHERE id = NEW.item_id;
    RETURN NEW;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Not enough stock for this movement.' USING ERRCODE = 'check_violation';
  END $$;

  -- Every change to a business record lands in the audit log, written by the
  -- database itself: who (app.user_id), what, and the changed values.
  CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    old_j JSONB;
    new_j JSONB;
    k TEXT;
    action TEXT;
  BEGIN
    new_j := to_jsonb(NEW) - 'updated_at';
    IF TG_OP = 'UPDATE' THEN
      old_j := to_jsonb(OLD) - 'updated_at';
      FOR k IN SELECT jsonb_object_keys(new_j) LOOP
        IF old_j -> k = new_j -> k THEN
          old_j := old_j - k;
          new_j := new_j - k;
        END IF;
      END LOOP;
      IF new_j = '{}'::jsonb THEN RETURN NEW; END IF;
      action := TG_TABLE_NAME || CASE WHEN new_j ? 'status' THEN '.status.' || (new_j ->> 'status')
                                      WHEN new_j ? 'archived_at' AND new_j -> 'archived_at' <> 'null'::jsonb THEN '.archived'
                                      ELSE '.updated' END;
    ELSE
      action := TG_TABLE_NAME || '.created';
    END IF;
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before_data, after_data, created_at)
    VALUES (app_user_id(), action, TG_TABLE_NAME, NEW.id::text, old_j, new_j, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    RETURN NEW;
  END $$;

  ${WITH_UPDATED_AT.map((t) => `CREATE TRIGGER ${t}_touch BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`).join("\n  ")}
  ${Object.entries(TRANSITIONS)
    .map(([t, map]) => `CREATE TRIGGER ${t}_status BEFORE UPDATE OF status ON ${t} FOR EACH ROW EXECUTE FUNCTION guard_status(${q(JSON.stringify(map))});`)
    .join("\n  ")}
  CREATE TRIGGER expenses_guard BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION expenses_guard();
  CREATE TRIGGER transactions_guard BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION transactions_guard();
  CREATE TRIGGER purchase_orders_guard BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION purchase_orders_guard();
  CREATE TRIGGER invoices_guard BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();
  CREATE TRIGGER approval_requests_guard BEFORE UPDATE ON approval_requests FOR EACH ROW EXECUTE FUNCTION approval_requests_guard();
  CREATE TRIGGER tasks_guard BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION tasks_guard();
  CREATE TRIGGER leads_guard BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION leads_guard();
  CREATE TRIGGER inventory_movements_apply AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION apply_inventory_movement();
  CREATE TRIGGER finance_payments_no_update BEFORE UPDATE ON finance_payments FOR EACH ROW EXECUTE FUNCTION refuse_change('payments are never changed; record a correcting entry');
  CREATE TRIGGER inventory_movements_no_update BEFORE UPDATE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION refuse_change('stock movements are never changed; record an adjustment');
  ${NEVER_DELETED.map((t) => `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION refuse_change(${q(`${t.replace(/_/g, " ")} are never deleted`)});`).join("\n  ")}
  ${AUDITED.map((t) => `CREATE TRIGGER ${t}_audit AFTER INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION audit_row();`).join("\n  ")}
  `;
}

function security(): string {
  const tablesWithPolicies = Object.keys(POLICIES);
  return `
  -- The restricted role every business query runs as.
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fd_app') THEN
      CREATE ROLE fd_app NOLOGIN NOBYPASSRLS;
    END IF;
  END $$;
  GRANT fd_app TO CURRENT_USER;
  GRANT USAGE ON SCHEMA public TO fd_app;
  GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO fd_app;
  -- Names and roles of colleagues, never password hashes; no writes at all.
  GRANT SELECT (id, email, name, role, status, department, title, phone, created_at, last_login_at) ON users TO fd_app;
  GRANT UPDATE (read_at) ON notifications TO fd_app;
  ${tablesWithPolicies
    .map((t) => {
      const p = POLICIES[t];
      // users and notifications get column-level grants above instead.
      const privileges = ["SELECT", ...(p.insert !== "false" ? ["INSERT"] : []), ...(p.update && t !== "notifications" ? ["UPDATE"] : [])];
      const lines = [
        ...(t === "users" ? [] : [`GRANT ${privileges.join(", ")} ON ${t} TO fd_app;`]),
        `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
        `CREATE POLICY ${t}_select ON ${t} FOR SELECT TO fd_app USING (${p.select});`,
      ];
      if (p.insert !== "false") lines.push(`CREATE POLICY ${t}_insert ON ${t} FOR INSERT TO fd_app WITH CHECK (${p.insert});`);
      if (p.update) lines.push(`CREATE POLICY ${t}_update ON ${t} FOR UPDATE TO fd_app USING (${p.update}) WITH CHECK (${p.check ?? p.update});`);
      return lines.join("\n  ");
    })
    .join("\n  ")}
  `;
}

export function businessSchema(): string {
  return tables() + functionsAndTriggers() + security();
}

/**
 * Run after every start: row-level security on every table (so a table
 * without policies is closed to fd_app, and to Supabase's public API roles),
 * and no grants for Supabase's anon/authenticated roles if they exist —
 * this app never uses Supabase's auto-generated REST API.
 */
export const LOCK_DOWN_SQL = `
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated';
  END IF;
END $$;
`;
