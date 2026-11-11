# Expansion OS — fairdeal.market

fairdeal.market's in-house platform for opening new stores. A real estate
manager scouts a property; the Expansion Manager, Business Leaders, Sales,
Ops and the Founder approve it; owner documents, the LOI and the agreement
are collected; and Finance releases the token, balance and stamp duty —
with every photo, video, document, decision and payment stored permanently
and shown only to the people who should see it. The warehouse electrical
asset calculator lives at `/calculator`.

**Stack:** Next.js · PostgreSQL (managed Postgres in production, embedded
PGlite for local/demo) · S3-compatible object storage (Cloudflare R2, AWS
S3…) for files of any size.

## The pipeline

| # | Stage | Who acts | What happens | Who is notified |
|---|---|---|---|---|
| 1 | Expansion Manager review | Expansion Manager | Approve or reject, with remarks | Real estate manager; on approval, Business Leaders |
| 2 | Business Leaders review | Business Leaders | Approve, hold or reject, with remarks | Expansion Manager and real estate manager; on approval, the whole Sales team |
| 3 | Sales review | Designated sales approvers | Only sales members given approval access vote approve/reject with remarks; the stage resolves when enough agree (setting, default 1). The rest of the sales team can view | Real estate manager on every vote; Expansion Manager when it resolves; on approval, Ops |
| 4 | Ops site visit | Ops | Upload site photos/videos, mark visited, write the scope of work, approve or reject | Real estate manager and Expansion Manager |
| 5 | Owner & property documents | Real estate manager | Owners (one or more) with Aadhaar front/back, PAN, contact and bank details; electricity bill, lease deed / registered document / power of attorney, property tax receipt, GST (if an organisation), and optional water bill, rent agreement, tenant NOC, other | Expansion Manager |
| 6 | LOI issued | Expansion Manager | Upload the LOI; it's emailed to every owner with an email address | Real estate manager (to get it signed) |
| 7 | Signed LOI | Expansion Manager | Upload the signed LOI | Founder |
| 8 | Founder approval | Founder | Approve, hold or reject, seeing everything | Expansion Manager and real estate manager; on approval, Finance |
| 9 | Token released | Finance | Upload the UTR receipt, enter amount/UTR/date, mark paid | Expansion Manager and Founder |
| 10 | Signed agreement | Expansion Manager | Upload the agreement (notarised / ₹100 stamp paper, signed with the Founder) | Finance, Founder |
| 11 | Balance released | Finance | Sees the agreement, landlord bank details and the token payment; pays the remainder, marks paid with UTR and receipt | Expansion Manager and Founder |
| — | Stamp duty (optional) | Access Manager or Expansion Manager → Finance | Any time after the Founder approves: request stamp duty with the calculation PDF; Finance pays and marks paid with UTR | Finance and Founder; then Expansion Manager and Founder |

- **Remarks are required** for every approve, hold and reject, and every
  decision is recorded with the person's name and time.
- **Hold** keeps the property with that team until they approve or reject.
- **Rejected** properties go back to the real estate manager, who can revise
  and resubmit; that starts a new round at stage 1, and earlier rounds stay
  in the history.
- Actions are checked on the server against the property's current stage,
  so two people can't both move the same property.

## Roles and what they see

| Role | Portal | Sees |
|---|---|---|
| Access Manager (admin) | `/admin` | Everything; manages people, roles, backups and settings |
| Expansion Manager | `/expansion` | Complete dashboard: every property, all details, media, documents, decisions and payments |
| Real Estate Manager | `/real-estate` | Everything about their own properties (payment status but not Finance's receipts) |
| Business Leader | `/business` | Store name, total/carpet area, asking rent, security deposit, rent-free period, advance rent, and decisions |
| Sales Team | `/sales` | All property details, location and photos/videos (not owner documents). Only members with **approval access** (set per person on Access & roles) can approve or reject; the rest view |
| Ops Team | `/ops` | All property details and media, plus the site visit they record |
| Founder | `/founder` | Everything, including KYC documents and payments |
| Finance | `/finance` | Store name, address, area, advance rent, security deposit, decisions, signed LOI, agreement, owner names and bank details, payments and receipts (not Aadhaar/PAN or property documents) |

These rules live in `lib/expansion/workflow.ts` (`FIELD_VISIBILITY`,
`CATEGORY_INFO`, `ACCESS_FROM`) and are enforced on the server: hidden fields
are never sent to the browser, and `/api/files/:id` refuses a file to any
role not allowed to see that document type. Each team only sees a property
once it has reached them.

## How data is kept safe ("never lose it")

1. **Records live in PostgreSQL.** In production, `DATABASE_URL` points at a
   managed Postgres (Neon, Supabase, AWS RDS…), which keeps its own
   point-in-time backups. Without it, the app runs an embedded Postgres
   (PGlite) under `DATA_DIR` — fine for development and the demo.
2. **Nothing is deleted.** The database itself refuses to delete properties,
   owners, files, decisions, payments, users or audit entries, and refuses
   edits to decisions and the audit log (PostgreSQL triggers). Removing or
   replacing a document *archives* it: it leaves normal views but stays in
   storage, listed under "Archived files" for the access manager, Expansion
   Manager and Founder.
3. **Files of any size go to a bucket.** With `S3_*` set, browsers upload
   photos, videos and documents straight to the bucket in parts (8 MB+ each,
   3 at a time, retried automatically if the network drops) — no size limit
   and nothing passes through the app server. Downloads use short-lived
   signed links. Without a bucket, files are sent to the server in chunks
   and kept under `DATA_DIR/uploads` (also no size limit).
4. **Every file is checked.** Only photos, videos, PDFs (and .docx for
   LOI/agreements) are accepted, and the file's first bytes must match its
   type. Server-stored files are SHA-256 fingerprinted; *Data & backups →
   Verify all files* re-checks everything.
5. **Automatic snapshots.** Every `BACKUP_INTERVAL_HOURS` (default 6) on a
   server, and daily via GitHub Actions or Vercel Cron on serverless hosts, a compressed JSON snapshot of every
   table is written to the bucket (or `BACKUP_DIR`), on top of your
   database provider's own backups.
6. **Audit log** of every action, on each property and on People & roles.

For the strongest protection turn on **versioning** for the bucket.

## Access management

- **Adding someone**: Access & roles → email, name, role → *Add & create
  invite*. A one-time link is emailed if SMTP is set up and always shown to
  copy. They choose a password and land on their portal. With Supabase
  sign-in they can also use "Email me a sign-in link", "Forgot password?"
  and, if enabled, "Continue with Google" (for added emails only).
- **Changing a role** takes effect on their next page load; **disabling**
  signs them out everywhere immediately; **reset password link** issues a
  new one-time link.
- You can't change your own role or disable yourself, and there's always at
  least one active access manager. Five wrong passwords lock an account for
  15 minutes.

## Local development

Requires Node.js 22.13+.

```bash
npm install
cp .env.example .env.local   # ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD at minimum
npm run dev                  # http://localhost:3000 — embedded Postgres + local files
```

Set `DEMO_MODE=true` for the demo (below). `npm test` runs on the embedded
Postgres; set `DATABASE_URL` to run it against a real one. `npm run lint` and
`npm run typecheck` are the other checks to run before pushing.

## Demo environment (for walkthroughs)

With `DEMO_MODE=true` — and automatically on Netlify or Vercel when no database is set — the portal runs as a
demo:

- nine sample accounts, one per role plus a view-only sales member, all
  with password `Demo@12345`, listed on the sign-in page for one-click
  sign-in;
- eight sample properties seeded at different stages (new, rejected, on
  hold, awaiting Sales, awaiting documents, awaiting the Founder, awaiting
  the agreement with stamp duty requested, and fully completed);
- a banner saying data resets.

On a serverless host without a database the demo uses a temporary embedded
database, so anything added disappears when the host recycles the server. Attach a
database and bucket (below) for real use; the demo then switches off.

## Going live

**Recommended: one Supabase project** for the database, multi-user sign-in
(password, email link, optional Google) and private file storage. Step-by-step
setup, security model and free-plan limits are in
[docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md). The rest of this section
covers the alternative stack (Neon + Cloudflare R2), which you can also mix
in: for example Supabase for sign-in and records with R2 for large videos.

Records live in a **Postgres database**, files in a **bucket**
(Supabase Storage, or S3-compatible such as R2), and the app runs on a host. All three have free plans, and nothing
is lost on refresh or redeploy, because neither the database nor the bucket
lives on the app host:

| Piece | Free choice | Free allowance |
|---|---|---|
| App | **Netlify** (free plan allows commercial use) | 300 credits/month |
| Database | **Neon** Postgres | 0.5 GB, scales to zero when idle |
| Files | **Cloudflare R2** | 10 GB stored, no download fees (then about $0.015/GB-month) |
| Daily backup | **GitHub Actions** (`.github/workflows/daily-backup.yml`) | free |

Vercel also works (`vercel.json`), but its free Hobby plan is for
non-commercial use only.

On Netlify, Vercel or any other serverless host the app refuses to start
without `DATABASE_URL`, and refuses uploads until the bucket is configured,
so data can never silently land on the host's temporary disk.

### 1. Database — Neon (2 minutes)

neon.tech → sign up → **Create project** (region: Asia Pacific / Singapore)
→ **Connect** → copy the connection string
(`postgresql://…neon.tech/neondb?sslmode=require`). That is `DATABASE_URL`.
The tables are created on first start.

(If you use Netlify's own **Extensions → Neon** instead, it sets
`NETLIFY_DATABASE_URL`, which the app also reads.)

### 2. File storage — Cloudflare R2 (5 minutes)

1. Cloudflare dashboard → **R2 → Create bucket** (e.g. `fairdeal-expansion`).
2. Bucket → **Settings → CORS policy**, paste (with your real URL):
   ```json
   [{ "AllowedOrigins": ["https://YOUR-APP-URL"], "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
   (The app also tries to set this itself if its key has permission.)
3. **R2 → Manage API tokens → Create token** with *Object Read & Write* on
   the bucket. Note the access key ID, secret, and the S3 endpoint
   `https://<account-id>.r2.cloudflarestorage.com`.

(AWS S3 works the same: bucket with versioning + the CORS rule above + an
IAM key with Get/Put/List; leave `S3_ENDPOINT` empty, set `S3_REGION`.)

### 3. App — Netlify (5 minutes)

app.netlify.com → **Add new project → Import an existing project → GitHub**
→ pick this repo and branch. `netlify.toml` already holds the build
settings. Before deploying, open **Environment variables** and add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | From step 1 |
| `APP_URL` | Your site URL, e.g. `https://fairdeal-expansion.netlify.app` |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_INITIAL_PASSWORD` | The first access manager (created once) |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION` (`auto` for R2), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | From step 2 |
| `CRON_SECRET` | Any long random string (protects the backup endpoint) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional — emails invites, alerts and LOIs (e.g. a Google Workspace app password) |

Deploy. Sign in with `ADMIN_EMAIL`, change the password under your
profile, add your team under **People & roles** (tick *Can approve* for
sales approvers), and check **Data & backups** shows "Managed PostgreSQL"
and your bucket with green dots.

### 4. Daily backup — GitHub Actions (1 minute)

GitHub → this repo → **Settings → Secrets and variables → Actions** → add
`PORTAL_URL` (your site URL) and `CRON_SECRET` (same value as above). Every
night at 02:00 IST the workflow asks the portal to write a full snapshot to
the bucket's `backups/` folder. Run it once by hand from the **Actions** tab
to check it works.

### Other hosts

`render.yaml` (Render blueprint) and `Dockerfile` / `docker-compose.yml`
run the same app on a regular server; set the same variables. On a server
the backup scheduler runs in-process. Render's free web service sleeps after
15 minutes idle (about a minute to wake) and its free Postgres expires after
30 days, so pair it with Neon. `/api/health` reports status for uptime
monitors.

## Code layout

- `lib/expansion/` — pure rules shared by server and UI: roles, the
  pipeline and visibility tables (`workflow.ts`), validation, formatting.
- `lib/server/` — server-only: database & migrations (`db.ts`), property
  access and views (`properties.ts`), every pipeline step (`pipeline.ts`),
  uploads (`files.ts`), bucket/disk storage (`storage.ts`), backups, users,
  sessions, notifications, email, audit, demo data.
- `app/(portal)/` — role portals and the shared property page;
  `app/api/uploads/*` — resumable uploads; `app/api/files/[id]` — downloads;
  `app/api/cron/backup` — daily backup.
- `components/portal/` — the fairdeal.market UI (brand, app shell, forms).

## Electrical calculator (`/calculator`)

A calculator that estimates the count and cost of electrical assets needed
to fit out a new warehouse: lighting, fans, wiring/conduit, switches/sockets,
distribution hardware (MCBs, junction boxes, etc), site conditions, and
installation labour.

### How it works

1. **Calculator tab** — enter the warehouse area (and an optional name). The
   app computes a line-item list of required assets per category, with an
   editable unit cost per line, and shows category/grand totals.
2. **Formulas tab** — every quantity is derived from an editable ratio (e.g.
   "4.92 LED bulbs per 1000 sq ft") or, for a few items, a fixed count that
   didn't scale with area in the source data.

Inputs, formula ratios, and unit costs are saved to the browser's
`localStorage`, so they persist across reloads on the same device/browser.

### Calibration data

The default ratios and prices are calibrated from three real warehouse
electrical fit-outs:

| Site | Area | Vendor | Actual total |
|---|---|---|---|
| Ashok Vihar | 7,000 sq ft | Bakshi Enterprises | Rs 264,985 |
| Naraina | 5,400 sq ft | Bakshi Enterprises | Rs 159,255 |
| Jahangirpuri | 5,400 sq ft | Bakshi Associate | Rs 199,500 (incl. Rs 30,310 labour) |

For each item, `qty per 1000 sq ft` is the average of (quantity ÷
area-in-thousands) across whichever sites itemized that item — a site that
didn't list a comparable line is excluded from that item's ratio rather than
treated as needing zero (silence isn't evidence of zero; it usually means
that vendor bundled it into a different line). A few items (MCBs, gangbox)
used the exact same count at every site that itemized them regardless of
area, so they're modeled as fixed quantities instead.

Naraina and Jahangirpuri are both 5,400 sq ft but from different vendors,
which is a useful cross-check: their **materials-only** totals were Rs
159,255 vs Rs 169,190 — about 6% apart, which is reassuring for the overall
$/sqft level even though the two vendors itemized things quite differently.

### Two lighting schemes, not additive

Ashok Vihar and Naraina used point LED bulbs; Jahangirpuri used LED tube
lights instead. These are alternative designs, not things you'd install
both of, so the tube-light item (`led-tube-light-22w`) defaults to **Rs 0**
unit cost to avoid double-counting. If your design uses tube lights, set its
unit cost (Rs 235 at Jahangirpuri) and zero out the LED-bulb/shade/holder
lines instead.

### Labour is single-site data, but confirmed to be a real separate cost

Labour is billed separately from materials at all three sites — Ashok Vihar
and Naraina's quotes were materials-only by design, not because installation
was free. Only Jahangirpuri's quote happened to itemize its labour cost (Rs
30,310, ~15% of that project's total), so the per-sqft labour rate is based
on that single data point and should be treated as a rough placeholder. Keep
this line in your estimate for the full cost of the rollout; set it to 0
only if you're tracking material and labour costs separately and don't want
this total to include labour.

### Known low-confidence items

Two items disagreed sharply between sites and should not be trusted as-is
— the app flags these in amber and recommends setting them manually from
your own circuit/point plan:

- **Switch, 10A 1-way**: 1 unit at Ashok Vihar vs 87 at Naraina; not
  itemized at all at Jahangirpuri.
- **Socket, 6A universal**: 2 units at Ashok Vihar, 37 at Naraina, 25 at
  Jahangirpuri — and Jahangirpuri's "sockets" were priced at ~Rs 510 each
  (a heavier-duty spec), not blended into the Rs 80 default.

The PVC conduit line also carries a caveat: Jahangirpuri priced the same
item name at ~30x the other two sites' price, almost certainly because it
was quoted as a bulk coil rather than a single length — that site's price
is excluded from the blended default, but confirm the purchase unit with
your own vendor.

### Getting more accurate results

Add data from more of your own warehouse fit-outs to tighten the model:

1. For a completed project, record the actual quantity of each asset and
   the total area.
2. Recompute `quantity / (area / 1000)` for each item, and update the ratio
   on the Formulas tab (average it with the existing ratio, weighting by
   how many sites went into each, or replace it if you trust the new data
   more).
3. Update unit costs on the Calculator tab from your vendor's actual quote.
4. If a site didn't itemize a given line, don't average it in as zero —
   leave the existing ratio alone (see "Calibration data" above for why).

### Calculator development notes

```bash
npm run dev      # start the dev server at http://localhost:3000
npm test         # run the calculation engine unit tests (includes a
                 # regression check against all three calibration sites)
npm run lint     # lint
npm run build    # production build
```

Calculation logic lives in `lib/calculator.ts`, the asset catalog and
calibrated defaults in `lib/config.ts`, and shared types in `lib/types.ts`.
