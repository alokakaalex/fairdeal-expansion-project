import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/expansion/roles";

// These tests talk to the database directly, as each employee, to prove the
// rules hold in Postgres itself (row-level security), not just in app code.

const { all, one, run, withUser, resetDbForTests } = await import("./db");

async function person(role: Role, name: string = role): Promise<string> {
  const id = randomUUID();
  await run(
    "INSERT INTO users (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
    id,
    `${name}.${id.slice(0, 6)}@example.com`,
    name,
    role,
    new Date().toISOString(),
  );
  return id;
}

let founder: string, sales: string, sales2: string, finance: string, finance2: string, ops: string;

beforeEach(async () => {
  await resetDbForTests();
  founder = await person("founder");
  sales = await person("sales");
  sales2 = await person("sales", "sales2");
  finance = await person("finance");
  finance2 = await person("finance", "finance2");
  ops = await person("ops");
});

const as = <T,>(id: string, fn: () => Promise<T>) => withUser(id, fn);

describe("row-level security", () => {
  it("puts new people in their role's department", async () => {
    expect((await one<{ department: string }>("SELECT department FROM users WHERE id = ?", ops))!.department).toBe("operations");
  });

  it("keeps finance records away from sales", async () => {
    await as(finance, () =>
      run("INSERT INTO transactions (txn_date, type, amount, category, payment_method, created_by) VALUES ('2026-11-01', 'expense', 5000, 'Rent', 'upi', ?)", finance),
    );
    expect(await as(finance, () => all("SELECT id FROM transactions"))).toHaveLength(1);
    expect(await as(founder, () => all("SELECT id FROM transactions"))).toHaveLength(1);
    expect(await as(sales, () => all("SELECT id FROM transactions"))).toHaveLength(0);
    await expect(
      as(sales, () =>
        run("INSERT INTO transactions (txn_date, type, amount, category, payment_method, created_by) VALUES ('2026-11-01', 'income', 1, 'x', 'upi', ?)", sales),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets sales create leads but not edit a colleague's, and stops finance editing them", async () => {
    const [lead] = await as(sales, () =>
      all<{ id: number }>("INSERT INTO leads (customer_name, phone, source, assigned_to, created_by) VALUES ('Asha Traders', '9999999999', 'referral', ?, ?) RETURNING id", sales, sales),
    );
    expect(await as(sales2, () => all("SELECT id FROM leads"))).toHaveLength(1);
    expect(await as(sales2, () => run("UPDATE leads SET notes = 'mine now' WHERE id = ?", lead.id))).toBe(0);
    expect(await as(finance, () => all("SELECT id FROM leads"))).toHaveLength(0);
    expect(await as(finance, () => run("UPDATE leads SET notes = 'x' WHERE id = ?", lead.id))).toBe(0);
    expect(await as(sales, () => run("UPDATE leads SET status = 'contacted' WHERE id = ?", lead.id))).toBe(1);
  });

  it("never lets anyone change roles or read password hashes through the app role", async () => {
    await expect(as(ops, () => run("UPDATE users SET role = 'founder' WHERE id = ?", ops))).rejects.toThrow(/permission denied/);
    await expect(as(ops, () => all("SELECT password_hash FROM users"))).rejects.toThrow(/permission denied/);
    await expect(as(ops, () => run("UPDATE role_permissions SET action = 'manage'"))).rejects.toThrow(/permission denied/);
    await expect(as(founder, () => run("DELETE FROM leads"))).rejects.toThrow(/permission denied/);
    expect((await as(ops, () => all<{ name: string }>("SELECT name FROM users"))).length).toBe(6);
  });

  it("routes expenses to finance for approval, without self-approval", async () => {
    const [exp] = await as(ops, () =>
      all<{ id: number }>(
        "INSERT INTO expenses (title, amount, category, expense_date, department, submitted_by) VALUES ('Site cleaning', 2500, 'Maintenance', '2026-11-02', 'operations', ?) RETURNING id",
        ops,
      ),
    );
    // Ops sees their own expense, not other people's.
    expect(await as(ops, () => all("SELECT id FROM expenses"))).toHaveLength(1);
    // Ops cannot approve it — not in their own name, not in a finance colleague's.
    await expect(as(ops, () => run("UPDATE expenses SET status = 'approved', decided_by = ?, decided_at = now() WHERE id = ?", ops, exp.id))).rejects.toThrow(
      /row-level security|own request/,
    );
    await expect(as(ops, () => run("UPDATE expenses SET status = 'approved', decided_by = ?, decided_at = now() WHERE id = ?", finance, exp.id))).rejects.toThrow(
      /row-level security|own name/,
    );
    // Finance can't record a decision in someone else's name either.
    await expect(as(finance, () => run("UPDATE expenses SET status = 'approved', decided_by = ?, decided_at = now() WHERE id = ?", finance2, exp.id))).rejects.toThrow(
      /own name/,
    );
    // Finance can, and can't then edit the amount.
    expect(await as(finance, () => run("UPDATE expenses SET status = 'approved', decided_by = ?, decided_at = now() WHERE id = ?", finance, exp.id))).toBe(1);
    await expect(as(finance, () => run("UPDATE expenses SET amount = 1 WHERE id = ?", exp.id))).rejects.toThrow(/can't be changed/);
    // A finance member's own expense needs a colleague.
    const [own] = await as(finance, () =>
      all<{ id: number }>(
        "INSERT INTO expenses (title, amount, category, expense_date, department, submitted_by) VALUES ('Courier', 300, 'Admin', '2026-11-02', 'finance', ?) RETURNING id",
        finance,
      ),
    );
    await expect(as(finance, () => run("UPDATE expenses SET status = 'approved', decided_by = ?, decided_at = now() WHERE id = ?", finance, own.id))).rejects.toThrow(
      /own request/,
    );
    expect(await as(finance2, () => run("UPDATE expenses SET status = 'approved', decided_by = ?, decided_at = now() WHERE id = ?", finance2, own.id))).toBe(1);
    // Invalid transitions are refused by the database.
    await expect(as(finance2, () => run("UPDATE expenses SET status = 'submitted', decided_by = NULL WHERE id = ?", own.id))).rejects.toThrow(/can't go from approved to submitted|own name/);
  });

  it("lets assignees move their tasks along but not rewrite them", async () => {
    const [task] = await as(ops, () =>
      all<{ id: number }>("INSERT INTO tasks (title, department, assigned_to, created_by) VALUES ('Fit-out checklist', 'operations', ?, ?) RETURNING id", sales, ops),
    );
    expect(await as(sales, () => all("SELECT id FROM tasks"))).toHaveLength(1);
    expect(await as(sales, () => run("UPDATE tasks SET status = 'in_progress' WHERE id = ?", task.id))).toBe(1);
    await expect(as(sales, () => run("UPDATE tasks SET title = 'Something else' WHERE id = ?", task.id))).rejects.toThrow(/status and notes/);
    expect(await as(finance, () => all("SELECT id FROM tasks"))).toHaveLength(0);
  });

  it("keeps stock from going negative", async () => {
    const [item] = await as(ops, () => all<{ id: number }>("INSERT INTO inventory_items (sku, name, created_by) VALUES ('RACK-01', 'Rack', ?) RETURNING id", ops));
    await as(ops, () => run("INSERT INTO inventory_movements (item_id, kind, quantity, created_by) VALUES (?, 'in', 10, ?)", item.id, ops));
    await as(ops, () => run("INSERT INTO inventory_movements (item_id, kind, quantity, created_by) VALUES (?, 'out', 4, ?)", item.id, ops));
    expect((await one<{ quantity: number }>("SELECT quantity FROM inventory_items WHERE id = ?", item.id))!.quantity).toBe(6);
    await expect(as(ops, () => run("INSERT INTO inventory_movements (item_id, kind, quantity, created_by) VALUES (?, 'out', 7, ?)", item.id, ops))).rejects.toThrow(
      /Not enough stock/,
    );
    // Sales may look, not touch.
    expect(await as(sales, () => all("SELECT id FROM inventory_items"))).toHaveLength(1);
    await expect(as(sales, () => run("INSERT INTO inventory_movements (item_id, kind, quantity, created_by) VALUES (?, 'in', 1, ?)", item.id, sales))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("writes who changed what to the audit log, which only the Founder reads", async () => {
    const [lead] = await as(sales, () =>
      all<{ id: number }>("INSERT INTO leads (customer_name, email, source, created_by) VALUES ('Om Stores', 'om@example.com', 'website', ?) RETURNING id", sales),
    );
    await as(sales, () => run("UPDATE leads SET status = 'contacted' WHERE id = ?", lead.id));
    const entries = await all<{ actor_id: string; action: string; before_data: Record<string, unknown>; after_data: Record<string, unknown> }>(
      "SELECT actor_id, action, before_data, after_data FROM audit_log WHERE entity_type = 'leads' ORDER BY id",
    );
    expect(entries.map((e) => e.action)).toEqual(["leads.created", "leads.status.contacted"]);
    expect(entries[1]).toMatchObject({ actor_id: sales, before_data: { status: "new" }, after_data: { status: "contacted" } });
    expect(await as(sales, () => all("SELECT id FROM audit_log"))).toHaveLength(0);
    expect((await as(founder, () => all("SELECT id FROM audit_log"))).length).toBeGreaterThanOrEqual(2);
    await expect(as(founder, () => run("UPDATE audit_log SET action = 'x'"))).rejects.toThrow(/permission denied/);
  });

  it("returns dates and timestamps as strings", async () => {
    await as(finance, () =>
      run("INSERT INTO transactions (txn_date, type, amount, category, payment_method, created_by) VALUES ('2026-11-01', 'income', 1234.5, 'Sales', 'upi', ?)", finance),
    );
    const t = (await as(finance, () => one<{ txn_date: string; created_at: string; amount: number }>("SELECT txn_date, created_at, amount FROM transactions")))!;
    expect(t.txn_date).toBe("2026-11-01");
    expect(t.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(t.amount).toBe(1234.5);
  });
});
