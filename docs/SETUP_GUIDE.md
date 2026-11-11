# Expansion OS: complete setup guide

Follow the stages **in order**. Each one ends with a ✅ check. Don't move
on until that check passes; most problems come from a step skipped earlier.

| Stage | Where | Time |
|---|---|---|
| 0. Before you start | Vercel | 5 min |
| 1. Create the Supabase project | Supabase | 5 min |
| 2. Collect the connection details | Supabase | 5 min |
| 3. Configure sign-in | Supabase | 5 min |
| 4. Set up email (optional but recommended) | Google account | 5 min |
| 5. Add the settings to Vercel and redeploy | Vercel | 10 min |
| 6. Check the health page | Browser | 1 min |
| 7. First sign-in and adding your team | The portal | 5 min |
| 8. Daily backups | GitHub | 3 min |
| 9. Optional: "Continue with Google" | Google Cloud + Supabase | 10 min |

**Golden rules**

- Keys and passwords go **only** into Vercel (and GitHub secrets). Never
  into code, chat or email.
- After **any** change to Vercel environment variables you must
  **redeploy**, or nothing changes.
- Keep a private note (e.g. your password manager) open while you work, to
  hold the values you collect.

---

## Stage 0: Before you start (Vercel)

1. **Keep one Vercel project.** If the repo was imported twice (e.g.
   `fairdeal-expansion-project` and `fairdeal-expansion-project-617z`), keep
   one. Open the other → **Settings** → scroll to the bottom → **Delete Project**.
2. In the project you keep, open **Settings → Build and Deployment**:
   - **Framework Preset:** Next.js
   - **Root Directory**, **Build Command**, **Output Directory**: defaults
     (no overrides)
3. **Settings → Git → Production Branch:** `main`.
4. **Settings → Deployment Protection → Vercel Authentication: Disabled**,
   so your team doesn't need Vercel accounts to open the portal.
5. Note your **production address**. Go to **Settings → Domains** and use
   the one ending in `.vercel.app` without random letters, e.g.
   `https://fairdeal-expansion-project.vercel.app`. This is your `APP_URL`.
   Don't use a deployment-specific URL with a long random part.

✅ Opening your production address shows the sign-in page, with a yellow
"Demo environment" banner (no database yet).

> Vercel's free Hobby plan is for non-commercial use. For company use,
> either upgrade or host on Netlify (free plan allows commercial use). The
> rest of this guide is the same apart from where you paste the settings.

---

## Stage 1: Create the Supabase project

1. Go to **supabase.com** → sign in (GitHub is easiest) → **New project**.
2. Fill in the form:
   - **Organization:** your own
   - **Project name:** `fairdeal-expansion`
   - **Database password:** click **Generate a password**, then **copy it
     into your note now**. It is shown only once. Prefer a password of only
     letters and numbers. If the generated one has symbols such as
     `@ # / : ? % &`, either regenerate or see the note in Stage 2A.
   - **Region:** *South Asia (Mumbai)* (closest to your team)
3. Click **Create new project** and wait 1–2 minutes until the dashboard loads.

✅ The project dashboard opens with no "setting up" spinner.

---

## Stage 2: Collect the connection details

### 2A. Database connection → `DATABASE_URL`

1. Click **Connect** (top of the project page).
2. Choose the **Transaction pooler** tab (port **6543**). Vercel needs this one.
3. Copy the connection string. It looks like:
   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
   ```
4. Replace `[YOUR-PASSWORD]` (including the brackets) with the database
   password from Stage 1.
5. Save the result in your note as **DATABASE_URL**. Adding
   `?sslmode=require` at the end is optional; the app handles both.

> **Password has symbols?** They must be encoded in the URL: `@` → `%40`,
> `#` → `%23`, `/` → `%2F`, `:` → `%3A`, `?` → `%3F`, `%` → `%25`,
> `&` → `%26`. The easier fix is **Project Settings → Database → Reset
> database password** to letters and numbers only, then rebuild the string.

### 2B. API keys

Go to **Project Settings → API Keys** (or **Data API** for the project URL) and copy:

| Supabase shows | Save as | Secret? |
|---|---|---|
| Project URL `https://abcdefghijkl.supabase.co` | **SUPABASE_URL** | no |
| **Publishable** key (`sb_publishable_…`) or legacy **anon** key | **SUPABASE_ANON_KEY** | no, but keep it private anyway |
| **Secret** key (`sb_secret_…`) or legacy **service_role** key | **SUPABASE_SERVICE_ROLE_KEY** | **YES**: full access to everything |

If there's no secret key yet, click **Create new secret key**. Use the same
generation for both keys: either both new (`sb_…`) or both legacy.

✅ Your note has `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`.

---

## Stage 3: Configure sign-in (Supabase → Authentication)

1. **Authentication → Sign In / Providers** (on older dashboards: **Providers** and **Settings**):
   - **Allow new users to sign up: OFF.** Only the access manager adds people.
   - **Email provider: ON** (password sign-in needs it), with **Confirm email: ON**.
2. **Authentication → Sign In / Providers → Email** (or **Policies / Passwords**):
   - **Minimum password length: 10.** The portal requires 10 characters
     including a letter and a number.
   - **Email OTP Expiration:** `86400` (24 hours), so invite links don't
     expire before people open them. The default is 1 hour.
3. **Authentication → URL Configuration:**
   - **Site URL:** your production address, e.g. `https://fairdeal-expansion-project.vercel.app`
   - **Redirect URLs → Add URL:** `https://fairdeal-expansion-project.vercel.app/auth/callback`
4. **Storage → Settings:** note the **Upload file size limit** (Free plan:
   usually 50 MB). This is **SUPABASE_MAX_FILE_MB**.
   - Don't create a bucket: the portal creates a private one called
     `expansion-files` on the first upload.
5. *(Optional, extra safety)* **Project Settings → Data API:** the portal
   doesn't use Supabase's auto-generated API, so you may turn it off. The
   portal already blocks it either way.

✅ Sign-ups are off, the Site URL and redirect URL are saved, and the file
size limit is in your note.

---

## Stage 4: Email (recommended)

The portal sends its own emails: invites, password resets, sign-in links,
step notifications and the LOI to landowners. Supabase's built-in mailer
only delivers to your own Supabase team, so the portal needs an SMTP account.

**Using a Gmail / Google Workspace account** (e.g. `expansion@fairdeal.market`):

1. Sign in to that Google account → **myaccount.google.com → Security** →
   turn on **2-Step Verification**.
2. Search **"App passwords"** in the account settings → create one named
   *Expansion OS* → copy the **16-character password** (spaces don't matter).
3. Save in your note:
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = the full Gmail address
   - `SMTP_PASS` = the 16-character app password
   - `SMTP_FROM` = `fairdeal.market Expansion <the same Gmail address>`

*Without email:* everything still works except "Email me a link" and
"Forgot password?". Invite links are shown in **People & roles** for you to
copy and send yourself (e.g. on WhatsApp).

✅ You have the five `SMTP_*` values, or have decided to skip email.

---

## Stage 5: Add the settings to Vercel and redeploy

Vercel → your project → **Settings → Environment Variables**. For each row,
click **Add**, choose **All Environments** (or tick Production and Preview),
and tick **Sensitive** for the secret ones.

| Key | Value | Sensitive |
|---|---|---|
| `APP_URL` | production address from Stage 0, **no slash at the end** | |
| `DATABASE_URL` | from 2A | ✔ |
| `SUPABASE_URL` | from 2B | |
| `SUPABASE_ANON_KEY` | from 2B | ✔ |
| `SUPABASE_SERVICE_ROLE_KEY` | from 2B | ✔ |
| `SUPABASE_MAX_FILE_MB` | from Stage 3 (e.g. `50`) | |
| `ADMIN_EMAIL` | your work email (you become the first access manager) | |
| `ADMIN_NAME` | your name | |
| `ADMIN_INITIAL_PASSWORD` | a temporary password: 10+ characters with letters **and** numbers | ✔ |
| `CRON_SECRET` | any long random text, e.g. 40 random letters and digits | ✔ |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | from Stage 4 | `SMTP_PASS` ✔ |

Rules:
- **Don't** add `DEMO_MODE`. If it exists from before, delete it.
- No quotes around values, and no spaces before or after.
- `ADMIN_INITIAL_PASSWORD` works until your first successful sign-in.
  After that, only the password you set in the portal counts.

Then **Deployments** → **⋯** on the top (latest) one → **Redeploy** → wait
until it says **Ready** (about 1–2 minutes).

✅ The latest deployment is **Ready** and was created **after** you saved
the variables.

---

## Stage 6: Check the health page

Open `https://YOUR-PRODUCTION-ADDRESS/api/health`. The first load can take
5–15 seconds while the portal creates its tables.

**Good result:**
```json
{"ok":true,"database":"postgres","configured":{"database":true,"supabaseAuth":true,"storage":"supabase","email":true,"demo":false},"firstAdmin":"ready for first sign-in with ADMIN_INITIAL_PASSWORD","backupStale":true}
```
(`backupStale: true` is normal until Stage 8.)

| You see | Meaning and fix |
|---|---|
| `"database":"pglite"` or `"demo":true` | `DATABASE_URL` isn't reaching the app. Check the name is exactly `DATABASE_URL`, that it applies to Production, then **redeploy**. |
| `"supabaseAuth":false` | One of `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` is missing or misnamed. Redeploy after fixing. |
| `"storage":"local"` | Same as above (storage uses the same three keys). |
| `"email":false` | `SMTP_HOST` missing. Fine if you skipped Stage 4. |
| `problem: "auth: wrong database user or password"` | The password inside `DATABASE_URL` is wrong. Reset it (2A) and update the variable. |
| `problem: "auth: the pooler doesn't recognise the user"` | The user part must look like `postgres.abcdefghijkl`. Copy the string again from **Connect → Transaction pooler**. |
| `problem: "config: … isn't a valid connection string"` | The password has symbols. See the note in 2A. |
| `problem: "network: … host … wasn't found"` | A typo in the host part of `DATABASE_URL`. Copy it again. |
| `problem: "network: couldn't reach the database"` | The Supabase project is **paused** (free projects pause after 7 idle days; open it in Supabase and click **Restore**), or the port isn't `6543`. |
| `problem: "ssl: …"` | Make sure you have the latest deployment (Stage 5 redeploy). |
| `problem: "setup: … lacks a permission"` | The URL must use the `postgres` user from **Connect**, not a custom one. |

✅ `"ok":true`, `"database":"postgres"`, `"supabaseAuth":true`,
`"storage":"supabase"`, `"demo":false`.

---

## Stage 7: First sign-in and adding your team

1. Open your production address. There should be no yellow demo banner.
2. Sign in with **`ADMIN_EMAIL`** and **`ADMIN_INITIAL_PASSWORD`**. This
   first sign-in also creates your Supabase account.
3. Go to **Account** (click your name, bottom left) → change your password.
4. Go to **Data & backups** → you should see green dots for **Records**
   (Managed PostgreSQL), **Photos, videos & documents** (Supabase Storage)
   and **Sign-in** (Supabase Auth).
5. Go to **People & roles** → **Add**: email, name, role (tick *Can approve*
   for sales approvers) → the person gets an email with a one-time link (or
   copy the link shown).
6. **Test with a second email of your own first:**
   - open the link → press **Continue** → choose a password → you land on
     that role's portal.
7. Scout a test property (Real Estate role) and upload a photo. It should
   upload with a progress bar and show a thumbnail.

✅ A second account can sign in, and a photo uploads and displays.

---

## Stage 8: Daily backups (GitHub)

The Supabase Free plan has **no automatic backups**. The portal saves a
full snapshot of every table every night into storage (`backups/` folder).
GitHub triggers it.

1. GitHub → `fairdeal-expansion-project` → **Settings → Secrets and
   variables → Actions → New repository secret**:
   - `PORTAL_URL` = your production address
   - `CRON_SECRET` = **exactly** the same value as in Vercel
2. **Actions** tab → **Daily backup** → **Run workflow** → it should finish
   green in under a minute.
3. In the portal: **Data & backups** → the backup list shows the new
   snapshot.

This nightly call also keeps the free Supabase project active, so it won't pause.

✅ The workflow run is green and a backup appears in **Data & backups**.

---

## Stage 9 (optional): "Continue with Google"

Do this only after everything above works.

1. **console.cloud.google.com** → create (or pick) a project → **APIs &
   Services → OAuth consent screen**:
   - choose **Internal** if you use Google Workspace (only your company's
     accounts), otherwise **External**
   - fill in the app name and support email, and save.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - **Application type:** Web application
   - **Authorized redirect URI:** `https://abcdefghijkl.supabase.co/auth/v1/callback`
     (your Supabase project URL + `/auth/v1/callback`)
   - copy the **Client ID** and **Client secret**.
3. **Supabase → Authentication → Sign In / Providers → Google**: enable it,
   paste the ID and secret, and save.
4. **Vercel:** add `SUPABASE_GOOGLE_SIGNIN` = `true` → **Redeploy**.

Only Google accounts whose email was added in **People & roles** can get
in. Anyone else sees "doesn't have access".

✅ The sign-in page shows **Continue with Google**, and it works for an added email.

---

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| Vercel shows **404 NOT_FOUND** (black page) | Framework Preset isn't Next.js, or Production Branch isn't `main`. See Stage 0, then redeploy. |
| **"This page couldn't load / A server error occurred"** | Open `/api/health` (Stage 6) and follow the table there. The full error is in Vercel → **Logs**. |
| I changed a variable but nothing changed | Redeploy (Stage 5). Variables apply only to new deployments. |
| First admin can't sign in | Open `/api/health` and read `firstAdmin`. **"ready for first sign-in…"**: type `ADMIN_INITIAL_PASSWORD` exactly as saved in Vercel; the sign-in page now says so if it doesn't match. **"not created yet"**: `ADMIN_EMAIL`/`ADMIN_INITIAL_PASSWORD` aren't reaching the app (check Production environment, then redeploy). **"signed in before"**: use the password you chose, or **Forgot your password?** Any message mentioning Supabase or `SUPABASE_SERVICE_ROLE_KEY` means a key is wrong: re-copy it (Stage 2B) and redeploy. |
| **"Too many failed attempts"** | Wait 15 minutes. |
| **"Finish setting up your account using the invite link"** | That person hasn't set a password yet. Resend from **People & roles → New invite link**. |
| Invite link says **already used or expired** | Links work once and expire (Stage 3 sets 24 h). Send a new one from **People & roles**. |
| Invite email never arrives | Check spam. Check **Data & backups → Email** is green, that `SMTP_PASS` is an *app password* (not the normal Gmail password), and that 2-Step Verification is on. Meanwhile copy the link from **People & roles**. |
| **"That account doesn't have access"** after Google | That email wasn't added in **People & roles**, or a different Google account was picked. |
| Google says **redirect_uri_mismatch** | The redirect URI in Google Cloud must be exactly `https://<ref>.supabase.co/auth/v1/callback`. |
| After Google, back on the sign-in page | Stage 3 step 3: the `/auth/callback` redirect URL is missing in Supabase, or `APP_URL` doesn't match the address you're using. |
| Upload: **"larger than the … MB per-file limit"** | The file exceeds the Supabase plan limit. Compress the video (e.g. 720p), or see "Big videos" below. |
| Upload: **"File storage isn't set up yet"** | The Supabase keys are missing. Check `/api/health` → `"storage":"supabase"`. |
| Upload: **"Storage refused the file"** | Check Supabase → **Storage → Settings** limit vs `SUPABASE_MAX_FILE_MB`, and that the free 1 GB total isn't full (**Project → Usage**). |
| Site was fine, now every page errors after a quiet week | Supabase paused the project. Open it in Supabase → **Restore**. Stage 8 prevents this. |
| Daily backup workflow fails with 401 | `CRON_SECRET` in GitHub doesn't exactly match Vercel. |

## Limits of the free plans

Free-plan figures are from third-party summaries; confirm on supabase.com/pricing.

| | Free allowance | What to do when you outgrow it |
|---|---|---|
| Supabase database | 500 MB | ample for years of records; upgrade to Pro if needed |
| Supabase storage | **1 GB total**, ~50 MB per file | see "Big videos" |
| Supabase pausing | after 7 idle days | Stage 8 keeps it awake |
| Supabase backups | none automatic | Stage 8 |
| Vercel Hobby | non-commercial use only | Vercel Pro, or Netlify free |

**Big videos:** keep sign-in and records on Supabase and put files on
Cloudflare R2 (10 GB free, any file size). Create an R2 bucket and token
(README → Going live → File storage), then add to Vercel:
- `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `STORAGE_PROVIDER=s3`

Then redeploy. Files already in Supabase keep working.
