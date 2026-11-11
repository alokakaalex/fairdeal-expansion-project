# Expansion OS → Business OS: technical audit (Phase 1)

Audit of the platform as it stood before Phase 2, when it lived in the earlier `javascript` repository (commit `b3bc0eb`).

## 1. Stack

| Layer | What is actually used |
|---|---|
| Language | TypeScript 5 (strict) |
| Framework | Next.js 16 App Router: server components, server actions (`app/actions/*`), route handlers (`app/api/*`), `instrumentation.ts`. No client-side data fetching library. |
| UI | React 19, Tailwind CSS v4 with brand tokens (`navy-*`, `brand-*`), Poppins + Inter. Hand-built components in `components/portal/`. |
| Package manager | npm (`package-lock.json`), Node ≥ 22.13 |
| Database | PostgreSQL through `pg` when `DATABASE_URL` is set; otherwise PGlite (embedded Postgres, WASM) under `DATA_DIR`. One migration list in `lib/server/db.ts`, tracked in `schema_migrations`. |
| Auth | In-house: scrypt password hashes, DB-backed sessions (random token in an httpOnly cookie, SHA-256 in the DB), invite and reset links, lockout after 5 failures, no self-signup. |
| Files | S3-compatible bucket (Cloudflare R2 / AWS) with presigned multipart uploads straight from the browser; local-disk fallback with resumable chunks. Magic-byte type checks, signed short-lived downloads. |
| Email | nodemailer over SMTP (optional). |
| Backups | Gzipped JSON snapshot of every table to the bucket (`lib/server/backups.ts`); in-process scheduler on servers, `/api/cron/backup` + GitHub Actions on serverless hosts. |
| Tests | Vitest: 38 tests (workflow, uploads, backups, calculator, maps), run on PGlite; server tests also pass on PostgreSQL 16. |
| Hosting config | `vercel.json`, `netlify.toml`, `render.yaml`, `Dockerfile`, `docker-compose.yml`. |

## 2. What exists and works

- **Expansion pipeline** (the property-acquisition flow): 11 steps across 8 roles (`admin`, `expansion_manager`, `real_estate`, `business`, `sales`, `ops`, `founder`, `finance`), approvals with remarks, KYC and property documents, LOI email, token / balance / stamp-duty payments with UTR and receipts, notifications at each step, audit trail, per-role field visibility.
- **Access management**: invite by email, role assignment, enable/disable, sales-approver flag, reset links, last-admin protection.
- **Files**: unlimited-size uploads, archive-instead-of-delete, integrity verification.
- **Data safety**: delete/update-refusing triggers on business tables, row locks on approvals, backups, CSV export.
- **Electrical calculator** (`/calculator`), unrelated to the business modules.

## 3. Why the deployed link is not "fully functional"

1. **No database is attached on Vercel.** The deployment therefore runs in demo mode: an embedded database in `/tmp` that is wiped whenever Vercel recycles the function, signed-cookie sessions, and sample data. Anything entered disappears. This is by design (the app refuses to store real data on a disk that will be erased), not a bug.
2. **No bucket is configured**, so uploads in the demo also live in `/tmp`.
3. **Vercel Deployment Protection** puts a Vercel login in front of preview URLs.
4. **The Sales / Finance / Ops / Founder pages are only views of the expansion pipeline.** `/finance`, for example, lists property payments to release; there is no general ledger, expenses, invoices, budgets, leads, deals, tasks, inventory, vendors or projects. These modules have to be built — they are not broken, they don't exist yet.
5. **Vercel Hobby is non-commercial only**, so the current host is not a valid production home for a company tool.

## 4. Gaps against the new brief

| Area | Status |
|---|---|
| Sales (leads, customers, deals, configurable pipeline, follow-ups, quotations, targets) | Missing |
| Finance (transactions, expenses + approvals, AP/AR, invoices, payments, budgets, reports) | Missing (only expansion payments) |
| Operations (projects, tasks with kanban/list/calendar, inventory + movements, vendors, procurement) | Missing (only site visits) |
| Founder dashboard (company KPIs, filters, drill-down, exports) | Partial (expansion-only dashboard) |
| Permission matrix (view/create/edit/delete/approve/export/assign/manage) | Missing: access is role → portal, checked in server code |
| Database-level authorization (RLS) | Missing: the app connects as the table owner |
| Generic documents (not tied to a property) | Missing: `files.property_id` is mandatory |
| Audit before/after values, entity references | Partial: free-text details only |
| Founder as employee administrator | Missing: only `admin` manages people |
| Departments | Implicit in role only |
| E2E / responsive UI tests in the repo | Missing (were run ad hoc, not committed) |

## 5. Risks found

- **Dependencies**: `next@16.3.5` had a critical advisory (RCE in `next/og`), plus advisories in nodemailer, sharp and source-map-js. **Fixed in Phase 2**: upgraded to `next@16.4.5`; `npm audit --omit=dev` now reports 0.
- **Committed tooling**: 20 Python `.whl` files (S3 test stand-in) were committed in `d7e2009`. **Removed in Phase 2.**
- **Single-owner DB connection**: any bug in a server check exposes data. Phase 2 adds Postgres row-level security for every new business table.
- **Login throttling** is per account only (lock after 5 failures); there's no per-IP rate limit.
- **Free tiers pause or sleep**: Supabase free pauses after 7 idle days; Render free sleeps after 15 idle minutes; Neon free scales to zero. All need the keep-alive / backup ping described in §7.

## 6. Target architecture (and why it differs from the brief in two places)

```
Browser ──HTTPS──► Next.js app (server components + server actions + route handlers)
                       │  every business query runs as DB role fd_app
                       │  with app.user_id set for the transaction
                       ▼
                 PostgreSQL (Supabase free, or Neon free)   ◄── RLS policies + permission matrix
                       │
Browser ──presigned PUT/GET──► Cloudflare R2 (private bucket, 10 GB free)
GitHub Actions ──daily──► /api/cron/backup → JSON snapshot into R2
```

**Kept: the existing in-house authentication, not Supabase Auth.** It already does invites, resets, lockout, revocable server sessions and instant role/disable effect. Replacing it would mean rewriting every page guard, losing offline tests (Supabase Auth can't run inside PGlite), and coupling the app to one vendor — for no security gain.

**Database-level enforcement without Supabase Auth.** RLS is enforced by Postgres, not by Supabase. Each request's business queries run inside a transaction that switches to a non-privileged role (`SET LOCAL ROLE fd_app`) and records the signed-in user (`set_config('app.user_id', …, true)`). Policies call `app_can(module, action)`, which reads the editable `role_permissions` table, plus ownership/assignment rules. A bug in a server check therefore still cannot return another department's rows. This works identically on Supabase, Neon, any Postgres and PGlite, and is transaction-scoped, so it is safe with Supabase's transaction pooler.

**Database host: Supabase free** (as preferred) via its Postgres connection string — or Neon free; the code doesn't care. **Files: Cloudflare R2** (10 GB free vs Supabase Storage's 1 GB). **Realtime**: dashboards refresh on navigation and after every action (server revalidation); live push is not needed for an internal tool of this size and would add a client SDK and keys.

**Hosting**: Vercel Hobby is non-commercial. Free, commercially usable options: **Netlify free** (serverless) or **Render free** (sleeps after 15 min idle). Cloudflare Workers free is not suitable: the free plan's small compressed-script limit and per-request CPU budget of a few milliseconds are too tight for this app (Postgres driver, AWS SDK, server rendering).

## 7. Free-tier facts that shape the design (verify before go-live)

| Service | Free allowance | Caveat |
|---|---|---|
| Supabase | 500 MB database, 1 GB storage, 5 GB egress, 2 projects | Pauses after 7 days without activity (data kept, manual restore). No automatic backups on Free → our own daily snapshot to R2 is the backup. |
| Neon | 0.5 GB per project | Scales to zero (cold start ≈ 1 s). |
| Cloudflare R2 | 10 GB-month, 1M writes, 10M reads, free egress | Then ≈ $0.015/GB-month. |
| Netlify | 300 credits/month, commercial use allowed | Next.js 16 support to be verified on first deploy. |
| Render | 750 h/month | Sleeps after 15 min idle; free Postgres expires after 30 days (don't use it). |

## 8. Role and department model

The brief's four roles map onto the existing roles; nothing existing is removed.

| Brief | Role(s) in the app | Department |
|---|---|---|
| FOUNDER | `founder` — full authority, employee management, all modules, approvals, audit | founder |
| — | `admin` — delegated access manager (people, backups) | founder |
| SALES | `sales` | sales |
| FINANCE | `finance` | finance |
| OPERATIONS | `ops` | operations |
| — | `expansion_manager`, `real_estate`, `business` (expansion pipeline) | expansion |

## 9. Implementation plan

1. **Phase 2 — Database & authorization foundation.** Business schema (departments, permission matrix, leads, customers, pipeline stages, deals, sales activities, quotations, targets, projects, tasks, comments, vendors, inventory + movements, purchase orders, budgets, transactions, expenses, invoices, finance payments, approval requests, documents), audit/notification extensions, `fd_app` role, RLS policies, `asUser()` request context, tests that prove isolation at the database level.
2. **Phase 3 — Services.** Validated server services per module with status transitions, approvals, notifications and before/after audit; generic documents on the existing upload pipeline.
3. **Phase 4 — UI.** Department navigation, Sales / Finance / Operations / Founder dashboards, tables with search, filters, sorting and pagination, kanban/list/calendar for tasks, permission-matrix and employee screens for the Founder, CSV exports.
4. **Phase 5 — Cross-department workflows.** Deal won → invoice for Finance → Founder metrics; Ops expense → Finance approval → ledger; Founder project → Ops tasks → progress; deal → Ops project.
5. **Phase 6 — Testing.** Role/permission tests against the DB, workflow tests, Playwright E2E on desktop and phone widths, four demo accounts from a development-only seed.
6. **Phase 7 — Deployment.** Supabase + R2 + host setup guide, backup/restore runbook, rollback procedure. Deploy only on your approval.
