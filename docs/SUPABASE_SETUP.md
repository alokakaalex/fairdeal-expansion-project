# Running Expansion OS on Supabase

One Supabase project gives the portal three things:

| What | Supabase feature | Environment variables |
|---|---|---|
| Records (properties, approvals, payments, audit log…) | Postgres database | `DATABASE_URL` |
| Multi-user sign-in (password, email link, optional Google) | Supabase Auth | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Photos, videos and documents | Supabase Storage (private bucket) | same as above; `SUPABASE_BUCKET`, `SUPABASE_MAX_FILE_MB` optional |

The app still runs on your host (Vercel, Netlify, Render…). Supabase only
holds the data, so nothing is lost when the app restarts, redeploys or sleeps.

## How it's secured

- **Who you are** comes from Supabase Auth. **What you may do** comes from
  the portal's `users` table: role, department, active/disabled. That table is
  the `profiles` table in Supabase's usual pattern. A Supabase account on its
  own grants nothing. Only emails an access manager added can get in, so a
  stranger signing in with Google sees "no access".
- **Keys never reach the browser.** Sign-in, sign-out and email links all go
  through the server. The service-role key is used only on the server, to
  create invite links, block disabled accounts and sign storage URLs.
- **Files are private.** The bucket is private and has no storage policies.
  Browsers can't list or read it. To upload, the server first checks that
  your role may add that kind of file at that stage. It then hands the
  browser a one-time signed upload URL. After the upload it checks the file's
  real type (magic bytes) and size. Downloads redirect to signed links that
  expire after 10 minutes.
  The common "each user owns a folder" storage policy doesn't fit here.
  Documents are shared by role (Finance must see the KYC that Real Estate
  uploaded), so those rules live in the portal and are checked on every
  request.
- **Row-level security is on for every table.** On every start the app
  enables RLS and removes all grants for Supabase's `anon`/`authenticated`
  roles, so the auto-generated Data API can't read anything. The business
  modules also run every query as a restricted database role. Postgres itself
  then enforces who sees which rows (see `lib/server/migrations/business.ts`).
- **Email links are one-time and need a click.** Invite, reset and sign-in
  links open `/auth/confirm`, and the token is only used when the person
  presses the button. That stops email virus scanners, which open links
  automatically, from using up the link.
- Disabling someone in **People & roles** also bans their Supabase account.
  Five wrong passwords lock an account for 15 minutes.

## Setup (about 20 minutes)

### 1. Create the project

[supabase.com](https://supabase.com) → **New project**. Pick the region
closest to your team (e.g. *South Asia (Mumbai)*) and a strong database
password. Keep the password in your password manager.

### 2. Database connection → `DATABASE_URL`

Project → **Connect** → copy a connection string and put the database
password in it:

- On Vercel or Netlify (serverless), use the **Transaction pooler** (port 6543).
- On a regular server (Render, Docker), use the **Session pooler** (port 5432).

Add `?sslmode=require` at the end if it isn't there. The app creates all
tables on first start.

### 3. API keys

**Project Settings → API Keys**:

| Copy | Into |
|---|---|
| Project URL (`https://<ref>.supabase.co`) | `SUPABASE_URL` |
| `anon` / publishable key | `SUPABASE_ANON_KEY` |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY` (secret: host environment only, never `NEXT_PUBLIC_…`, never in code or chat) |

### 4. Auth settings

**Authentication → Sign In / Providers**
- Email: enabled. **Confirm email: on.**
- **Allow new users to sign up: off.** People are added by the access
  manager only.
- Minimum password length: 10. That matches the portal's own rule (at least
  10 characters, with a letter and a number).

**Authentication → URL Configuration**
- Site URL: your portal URL (same as `APP_URL`).
- Redirect URLs: add `https://YOUR-PORTAL/auth/callback`.

**Optional — "Continue with Google"**
1. Google Cloud Console → APIs & Services → Credentials → *OAuth client ID*
   (Web application). Authorised redirect URI:
   `https://<ref>.supabase.co/auth/v1/callback`.
2. Supabase → Authentication → Providers → **Google**: paste the client ID
   and secret, then enable it.
3. Set `SUPABASE_GOOGLE_SIGNIN=true`.

Only Google accounts whose email was added in **People & roles** get in.

### 5. Storage

Nothing to do: on the first upload the app creates the private bucket
`expansion-files` (or `SUPABASE_BUCKET`) with the per-file size limit. If the
bucket was made public by mistake, the app switches it back to private.

**Per-file limit.** Supabase limits the size of each file by plan. Third-party
summaries put the Free plan at 50 MB per file; check it under **Storage →
Settings** and set `SUPABASE_MAX_FILE_MB` to match. Larger videos are refused
before uploading, with a clear message. For bigger videos, either upgrade
Supabase or switch media to Cloudflare R2:
1. Set the `S3_*` variables (README → Going live).
2. Set `STORAGE_PROVIDER=s3`.

Files already stored keep working, because each file remembers where it lives.

### 6. Email (`SMTP_*`)

The portal sends its own emails: invites, reset links, sign-in links, step
notifications and the LOI. Supabase's built-in mailer only delivers to your
Supabase team's own addresses. So set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS` and `SMTP_FROM`. A Google Workspace app password works, as do the
free tiers of Brevo or Resend.

Without SMTP, everything still works except "Email me a link" and "Forgot
password". The access manager then copies each invite or reset link from
**People & roles** and sends it themselves.

### 7. Host environment variables

On Vercel: **Project → Settings → Environment Variables** (Production and
Preview). On Netlify: **Site configuration → Environment variables**. Set:

```
APP_URL=https://YOUR-PORTAL
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAIL=you@fairdeal.market
ADMIN_NAME=Your Name
ADMIN_INITIAL_PASSWORD=<a long temporary password>
CRON_SECRET=<long random string>
SMTP_HOST=...  SMTP_PORT=587  SMTP_USER=...  SMTP_PASS=...  SMTP_FROM=...
# optional
SUPABASE_GOOGLE_SIGNIN=true
SUPABASE_MAX_FILE_MB=50
```

Don't set `DEMO_MODE`. Redeploy.

### 8. First sign-in

Sign in with `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD`. That first sign-in
creates your Supabase account. Change the password under **Account**. Then
add your team under **People & roles**: each person gets a one-time link to
choose their password. Check that **Data & backups** shows green dots for
records, files and sign-in.

### 9. Backups

The Supabase Free plan has no automatic backups. The portal's own daily
snapshot of every table goes into the storage bucket's `backups/` folder.
Turn it on with the GitHub Action (README → Going live → Daily backup): add
`PORTAL_URL` and `CRON_SECRET` as repository secrets.

## Free plan limits to plan around

Third-party summaries from 2026; confirm on supabase.com/pricing.

| Limit | Free plan |
|---|---|
| Database | 500 MB |
| File storage | **1 GB in total** (≈ 20 videos of 50 MB) |
| Egress | 5 GB / month |
| Monthly active users | 50,000 |
| Inactivity | Project pauses after 7 days with no activity (data is kept; resume from the dashboard). The daily backup job keeps the database active. |
| Backups | None automatic: use the portal's daily snapshot |

If photos and videos will exceed 1 GB, keep sign-in and records on Supabase
and put files on Cloudflare R2 (10 GB free, no download fees). See
"Per-file limit" above.

## Not included yet

- Two-factor authentication for admin accounts. Supabase Auth supports TOTP;
  it needs an enrolment screen in the portal.
- Resumable uploads (TUS) for very large files. The single signed upload is
  retried if it fails, but a dropped connection restarts that file.
