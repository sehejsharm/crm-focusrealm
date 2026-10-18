# Focus Realm — Sales CRM & AI Call Intelligence

One platform for the Focus Realm sales floor: import the contact database,
allocate prospects fairly, call with one tap, record every call, and have AI
analyse **every recording at the end of the day** — how each salesperson
spoke, how they handled the conversation, how the prospect responded, scored
against the major sales frameworks — then write **one report per salesperson
every evening**, ready in Daily Reports for the founders, sales heads and
Legion.

Connected to the Focus Realm **HR console**: when someone joins the sales
department there, they get a CRM login automatically.

Blue-and-white Focus Realm brand, light by default with a dark theme, and
motion everywhere.

---

## The three portals

| Portal | Who | What they do |
|---|---|---|
| **Sales Team** (`/sales`) | Sales team members (and sales heads) | *My Day* (target ring, follow-ups due, fresh prospects, latest coaching, leaderboard) · **Call Sprint** (power dialler) · prospects · the board · one-tap **Call** and **WhatsApp** · follow-ups & reminders · **Upload Recordings** · call history with transcripts and AI coaching · their daily reports. Sales heads also get Team Pulse, Allocation, Database & Import, Call Intelligence, Daily Reports and Team Tasks. |
| **Legion** (`/legion`) | The Legion team | Legion HQ · **handoff inbox** (accept, or return with a reason) · Legion Meet 1 & 2 scheduling and outcomes · the pipeline · a live view of the **sales team's work** (leaderboard, activity feed, calls, daily reports). |
| **Founders** (`/founder`) | CEO, COO, founders | **Command Center** (funnel, conversion, decision-maker reach, follow-up compliance, overdue work, objections, product feedback, system health) · everything the other portals have · **assign tasks** to anyone · people & access · settings (daily reports, calling mode, HR connection, allocation & morning top-up, qualification checklist, WhatsApp messages) · audit log. |

Plus **Phone Link** (`/phone`) — a mobile screen for each salesperson's phone
(add it to the home screen). Pressing **Call** in the CRM sends the number to
it: tap to dial, then attach the recording.

## Who signs in how

| Who | Login ID | Where the login comes from |
|---|---|---|
| **Sales team & sales heads** | FR number from Workspace | automatic from the **HR console** when they join sales |
| **Founders** | FR number from Workspace | the first founder sets up on the sign-in page with `SETUP_CODE`; they add the others in **People & Access** |
| **Legion** | `LG-0001`… (never on Workspace) | a founder adds them in **People & Access**; the CRM assigns the LG ID |

Email works as a login too. Details: [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md#who-signs-in-how). Claude in Chrome prompt that sets up the first logins: [docs/LOGIN_SETUP_PROMPT.md](docs/LOGIN_SETUP_PROMPT.md).

## The sales journey (as specified by the founders)

1. **Import the contact database** — Excel (.xlsx) or CSV, with a downloadable
   template; columns matched automatically whatever they're called,
   duplicates (by phone, then email) and invalid numbers reported row by row.
   Thousands of rows at a time (tested with 6,000).
2. **Allocate** prospects to the salespeople — balanced, randomised within each
   segment, capped by everyone's active-prospect limit, previewed before it's
   committed, fully audited (proposal §4). Right after an import, **Allocate
   now** fills everyone's book; the **morning top-up** (Settings → Allocation)
   then hands each salesperson their next batch every morning, Mon–Sat, from
   what's left. Inactive or offboarded people's prospects are flagged for
   review, never silently reassigned.
3. **Call** — the **Call** button creates a unique call ID and puts the number
   on the salesperson's phone, either:
   - **Bridge** (Exotel/Twilio): the provider rings the salesperson's own phone,
     connects the prospect and **records both sides automatically**; or
   - **Phone Link**: the number appears on their phone to dial on their SIM;
     the recording from the phone's call recorder is attached after — on the
     phone, in the wrap-up, or on **Upload Recordings** (MP3, M4A, WAV, AAC,
     OGG/Opus, AMR, 3GP, WebM, FLAC); or
   - **Demo**: simulated calls with sample conversations.
4. **Record** — recordings go to a private Cloudflare R2 bucket, never public.
5. **End of day, AI analyses every recording** (transcription with speaker
   labels — Hindi/English mix supported — then Claude or Gemini): call score,
   ten skills, **SPIN, BANT, MEDDIC, Challenger, Sandler, GAP Selling, NEAT,
   SNAP, Straight Line and AIDA**, talk ratio, questions, filler words,
   objections and how they were handled (with a better line to use), the
   prospect's sentiment from start to end, interest, decision-maker, BANT
   evidence, pain points, product requests, competitors, coaching with
   example lines, next action, and a confidence score with human review for
   uncertain results. Founders can switch on *immediate* analysis too.
6. **One report per salesperson per day**, written by AI from those analyses
   plus the day's metrics, shown in **Daily Reports** to the founders, sales
   heads and Legion (with a notification when each is ready). Nothing is
   emailed; any report can be printed or saved as PDF.

Built in to make the floor faster:

- **Call Sprint** — a power dialler: follow-ups due, fresh prospects and
  leads gone quiet, one at a time with the context and the AI's suggested
  line; Space to call, S to skip, the next one appears after the wrap-up.
- **WhatsApp quick messages** — templates the founders write, filled with
  the prospect's name and company, opened in WhatsApp in one tap and logged
  on the timeline.
- **Live floor** on the founder and Legion dashboards — who's on a call
  right now and how everyone's day is going — plus a *Needs your attention*
  list.

Everything else follows the proposal: the four-milestone Kanban (Prospect →
Qualified → Legion Meet 1 → Legion Meet 2) with individual statuses
underneath, qualification checklist, handoff with accept/return, follow-ups
with reminders and overdue escalation, interaction timeline, notifications,
dashboards, objection and product-feedback intelligence, audit log, retention
controls.

## Quick start (local)

```bash
npm install          # also bundles the API (postinstall)
npm run dev          # API on :4000, web app on http://localhost:5173
```

No database or keys needed: it runs on an embedded Postgres in `./.data`, with
a demo sales floor (2 founders, a sales head, 5 salespeople, 2 Legion members,
540 prospects, two weeks of calls with transcripts and coaching, daily
reports). Sign in with one tap, or:

| Portal | Employee ID | Password |
|---|---|---|
| Founders | `FR-0001` (CEO), `FR-0002` (COO) | `focus-realm-demo` |
| Sales head | `FR-0010` | `focus-realm-demo` |
| Sales team | `FR-0021` … `FR-0025` | `focus-realm-demo` |
| Legion | `FR-0031`, `FR-0032` | `focus-realm-demo` |

Demo mode never dials real numbers. Without SMTP, alert emails are written
to `./.data/outbox/` so you can open them. Reset the demo with
`rm -rf .data` (or `npm run seed -- --force`).

## Deploy

**Vercel** (recommended) — one project, Supabase Postgres for the database,
**Cloudflare R2** for call recordings, Vercel Cron for the 20:00 IST report
run. Step by step: **[docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)**. R2
setup prompt for Claude in Chrome:
**[docs/CLOUDFLARE_R2_PROMPT.md](docs/CLOUDFLARE_R2_PROMPT.md)**. All
settings: **[.env.example](.env.example)**.

Self-hosted: `npm run build && npm start` on any Node 20+ server.

## Connect the HR console

- Contract: **[docs/HR_CONSOLE_INTEGRATION.md](docs/HR_CONSOLE_INTEGRATION.md)**
- Prompt to paste into Claude Code in the HR console repo:
  **[docs/HR_CONSOLE_PROMPT.md](docs/HR_CONSOLE_PROMPT.md)**
- Drop-in client for the HR console: [docs/hr-console/crm-sync.server.ts](docs/hr-console/crm-sync.server.ts)

Signed (HMAC-SHA256) and idempotent like the HR console's Workspace
connection. Sales hires get a login (with their Workspace employee ID, so one
ID everywhere) and a one-time temporary password; non-sales people are never
sent; offboarding in HR locks them out of the CRM on every device.

## Architecture

```
apps/web     React 19 + TypeScript + Vite, Tailwind v4, Motion, TanStack Query
apps/api     Node + Express 5 + TypeScript (bundled with esbuild)
supabase/    SQL migrations (Supabase Postgres; every table crm_*, RLS on)
api/         Vercel function entry (re-exports the bundled Express app)
docs/        Deploy guide, HR console contract, prompt and client
```

- **Business rules run on the server** (allocation, ownership, status
  changes, qualification before handoff, permissions per role) — never in the
  browser.
- **Background jobs** (transcription, analysis, reports, emails) in a durable
  Postgres queue with retries; run in-process on a server, or after the
  response / by cron on Vercel.
- **Live updates** by short-polling an events table (works on serverless).
- **AI**: Claude via the official SDK with structured outputs (typed JSON
  validated against a schema) and refusal fallbacks; model and effort set by
  `AI_MODEL` / `AI_EFFORT`. Or Google Gemini (`AI_PROVIDER=gemini`), which has
  a free tier and can also transcribe — see [AI costs](#ai-costs). Without a
  key, a clearly-labelled rule-based demo analyser keeps everything explorable.

## AI costs

The Anthropic (Claude) API is **paid per use** — there's no free tier. Rough
cost per analysed call (a ~10-minute call ≈ 6K tokens in, ~4K out):

| `AI_MODEL` | Price per 1M tokens (in / out) | ≈ per call | ≈ 200 calls/day, 26 days |
|---|---|---|---|
| `claude-opus-5-5` (default, best) | $4 / $20 | $0.10 | ~$540 / month |
| `claude-sonnet-5-5` | $2 / $10 | $0.05 | ~$270 / month |
| `claude-haiku-5-5` (cheapest) | $0.10 / $0.50 | $0.003 | ~$14 / month |

Only connected calls with a recording are analysed, so real numbers are
usually lower; daily reports add a little on top. Transcription (Deepgram) is
billed separately.

**Free option:** `AI_PROVIDER=gemini` with a `GEMINI_API_KEY` from Google AI
Studio runs analysis, reports *and* transcription on Gemini's free tier.
Two catches: the free tier has daily request limits (the job queue retries
the next day), and Google's terms let it use — and people review — what you
send on the free tier, which here means recordings of customer calls.
Turning on billing for the Google project makes it a paid service that isn't
used for training.

## Security & privacy

- Employee ID login (as in the HR console), bcrypt passwords, httpOnly session
  cookie, sign-out everywhere on offboarding/reset, forced password change on
  first sign-in, brute-force throttling.
- Role-based access on every endpoint; salespeople see only their own
  prospects and calls.
- Recordings in a private Cloudflare R2 bucket (key scoped to that bucket),
  played through 10-minute signed URLs after a permission check; every playback is audited. Retention is configurable
  (default 180 days).
- Recording notice text configurable: Twilio bridge calls play it; Phone Link shows it to the salesperson to read out.
- Audit log of logins, allocations, reassignments, settings, HR events and
  recording playback.

## Scripts

| | |
|---|---|
| `npm run dev` | API + web with hot reload |
| `npm run build` | Production build (API bundle + web) |
| `npm start` | Serve API + built web app |
| `npm test` | API tests (allocation rules, phone normalisation, HR sync end to end) |
| `npm run typecheck` | Type-check API and web |
| `npm run seed -- --force` | Wipe and re-seed demo data (destroys data!) |
| `npm run create-user -- --id FR-0001 --name "…" --role founder` | Create a login from the command line |
| `npm run copy-recordings-to-r2` | One-off copy of existing recordings from Supabase Storage to Cloudflare R2 |

## Next steps

- **Native Android companion** that auto-uploads the phone's call recordings
  (the proposal's Android app) — Phone Link and Bridge cover recording today;
  the native app must be validated on the team's actual devices first.
- Odoo integration (stable IDs are already in place).
