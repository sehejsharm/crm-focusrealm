# Deploying to Vercel

The whole CRM — the web app and the API — deploys as **one Vercel project**
from this repository. Supabase provides the database and private storage for
call recordings.

```
Browser ──► Vercel CDN (apps/web/dist — the React app)
        └─► /api/*  ──► one Vercel Function (api/index.mjs → Express API)
                          ├─► Supabase Postgres (pooler)
                          ├─► Supabase Storage (private recordings bucket)
                          ├─► Anthropic (Claude) · Deepgram · SMTP · Exotel/Twilio
                          └─◄ HR console (signed events)
Vercel Cron ──► /api/cron/daily-reports (20:00 IST) · /api/cron/maintenance
```

## 1. Supabase

1. Create a project (choose **Mumbai / ap-south-1**, next to your users).
2. **Database → Connection string → Transaction pooler** (port `6543`). This is
   `DATABASE_URL`. The pooler lets many short-lived functions share Postgres.
3. **Project Settings → API**: copy the project URL (`SUPABASE_URL`) and the
   **service role** key (`SUPABASE_SERVICE_ROLE_KEY`). Server-side only.

That's all — tables are created automatically on the first request
(`supabase/migrations/*.sql`, applied once, safely, even if several functions
start at the same moment). You can also apply them yourself in the SQL editor.
Every table has row level security on with no policies, so the anon key can't
read anything; only the server can. The recordings bucket
(`crm-call-recordings`, private) is created on the first upload.

You can reuse the HR console's Supabase project: all CRM tables are prefixed
`crm_`, so nothing collides.

## 2. Vercel

1. **Add New → Project →** import `crm-focusrealm`. Leave the root directory as
   the repository root. `vercel.json` sets everything else (install, build,
   output directory, the API function, rewrites, crons and security headers),
   so leave Framework Preset as **Other**.
2. **Environment Variables** (Production, and Preview if you use it):

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | ✅ | Supabase transaction-pooler string |
   | `JWT_SECRET` | ✅ | `openssl rand -hex 32` |
   | `CRON_SECRET` | ✅ | `openssl rand -hex 32` — Vercel Cron sends it automatically |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✅ | for call recordings |
   | `APP_URL` | recommended | your domain, e.g. `https://crm.focusrealm.com` (defaults to the Vercel production URL) |
   | `HR_WEBHOOK_SECRET` | for HR sync | same value as `FOCUS_REALM_CRM_SECRET` in the HR console |
   | `ANTHROPIC_API_KEY` | for real AI | otherwise demo analysis |
   | `DEEPGRAM_API_KEY` | for transcripts | otherwise recordings are stored but not transcribed |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for report emails | e.g. your SpaceMail mailbox |
   | `TELEPHONY_PROVIDER` + Exotel/Twilio keys, `TELEPHONY_WEBHOOK_TOKEN` | for bridge calling | see `.env.example` |
   | `SEED_DEMO`, `DEMO_LOGINS` | optional | `true` to try it with demo data — turn off before real use |

   See [`.env.example`](../.env.example) for every variable.
3. **Deploy.** Open the site. With `SEED_DEMO=true` you'll see one-tap demo
   logins; otherwise create the first founder account (below).

### First founder account (no demo data)

From your laptop, point the CRM at the production database once and create
yourself:

```bash
DATABASE_URL="<the Supabase connection string>" npm run create-user -- \
  --id FR-0001 --name "Your Name" --email you@focusrealm.com \
  --role founder --title "Co-founder & CEO"
```

It prints a temporary password once. Sign in with `FR-0001` and that password;
you'll choose your own. Add the COO, sales heads and Legion from **People &
Access**; sales team members arrive from the HR console.

## 3. How the background work runs on Vercel

Vercel functions don't run between requests, so the CRM is built for that:

- **Jobs** (transcription, AI analysis, report writing, emails) live in the
  `crm_jobs` table. After a request queues one, the same function keeps running
  it after the response (`waitUntil`), with retries and backoff.
- **End-of-day reports**: Vercel Cron calls `/api/cron/daily-reports` at
  **14:30 UTC = 20:00 IST** (change it in `vercel.json`). It queues every
  recording of the day for analysis in parallel, then one report per
  salesperson, then the emails. A big day that doesn't fit in one 5-minute
  invocation hands itself on to a fresh one automatically.
- **Reminders & overdue escalation**: `/api/cron/maintenance` runs daily, and
  any signed-in activity nudges the queue and reminders along (at most once a
  minute). On the **Pro** plan you can make maintenance run every 5 minutes —
  change its schedule in `vercel.json` to `*/5 * * * *` for minute-accurate
  reminders.
- **Live updates** (dial requests on the Phone Link, call progress,
  notifications) are polled every 1–2.5 seconds from a small events table —
  no long-lived connections, which serverless can't keep open.
- **Recordings** upload from the browser straight to Supabase Storage through
  a one-time signed URL (Vercel limits function request bodies to 4.5 MB), and
  play back through short-lived signed URLs after a permission check.

Hobby plan notes: daily crons run sometime within their hour, and functions
can run up to 300 s (Fluid compute). Both are fine for the CRM; Pro gives
exact cron timing and longer functions.

## 4. Connect the rest

- **HR console**: set `HR_WEBHOOK_SECRET` here and follow
  [`HR_CONSOLE_PROMPT.md`](HR_CONSOLE_PROMPT.md) in the HR console repo.
- **Bridge calling** (auto-recorded calls): set the Exotel or Twilio variables,
  then **Settings → Calling → Bridge**. Each person adds their phone number in
  **My profile**.
- **Report recipients**: **Settings → Daily reports** (founders and sales heads
  are included automatically; add the CEO/COO or anyone else there).

## Self-hosting instead (Render, Railway, a VM)

`npm install && npm run build && npm start` serves both the API and the built
web app on `PORT` (default 4000), with the minute-by-minute scheduler and job
worker running in-process. Same environment variables.
