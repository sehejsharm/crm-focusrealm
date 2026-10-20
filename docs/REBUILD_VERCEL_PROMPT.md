# Prompt for Claude in Chrome: rebuild the CRM on Vercel from scratch

Use this prompt if the Vercel project was deleted. It re-imports the CRM from
GitHub and adds every setting again: database, Cloudflare R2, Gemini,
Deepgram and the security keys. It then checks that the founder login works.

Deleting the Vercel project didn't touch your data. Prospects, calls, users
and reports live in Supabase, and recordings live in Cloudflare R2. Only the
Vercel settings were lost. Saved keys can't be read back from Vercel, so the
prompt creates fresh API keys. Everyone has to sign in again once, because
the login secret changes.

Open **Claude in Chrome**. Sign in to **GitHub, Vercel, Supabase, Cloudflare,
Google (AI Studio) and Deepgram** in the same browser. Fill in MY DETAILS,
then paste everything inside the box. Claude stops and asks you whenever a
password is needed, and you type it yourself.

---

````text
Rebuild the Focus Realm Sales CRM on Vercel. The Vercel project was deleted.
The code is on GitHub, the database is in Supabase and recordings are in
Cloudflare R2; those all still exist. I'm signed in to GitHub, Vercel,
Supabase, Cloudflare, Google AI Studio and Deepgram in this browser.

MY DETAILS (only used if the CRM asks for first-time setup):
  FR number: FR-____
  Full name: ____
  Email: ____
  Title: ____   (e.g. Co-founder & CEO)

FACTS
- GitHub repo: sehejsharm/crm-focusrealm
- Production branch: claude/zealous-darwin-565r0v
- Supabase project: "Alielectricwala's Project" (ref lvfdrhvpukkdmxziwtnn).
  The HR console shares it. Never change or reset anything there.
- Cloudflare R2 bucket: crm-call-recordings
- Don't touch the Vercel projects "focusrealm" or "focusrealm-fzi2". They
  are the HR console.

SAFETY RULES (follow them throughout)
- Never type, paste or show a secret (password, API key, access key,
  connection string, generated secret) anywhere except the Vercel
  environment-variable value field. That means not in the chat, notes,
  your report or other sites. In your report, show at most the first 4
  characters of any key.
- Never type my passwords. When one is needed, stop and ask me to type it.
- Never reset the Supabase database password. If I don't know it, stop and
  tell me.
- Never enter payment details or accept a paid plan. If a step needs that,
  stop and tell me.
- Don't delete anything except what this prompt names.
- For every environment variable: Environments = Production AND Preview.
  Mark the ones labelled (Sensitive) as Sensitive.

────────────────────────────────────────
PART 1: IMPORT THE PROJECT (Vercel)
1. Vercel → Add New → Project → Import Git Repository → GitHub →
   sehejsharm/crm-focusrealm → Import.
   If the repo isn't listed: "Adjust GitHub App Permissions" → sehejsharm →
   Only select repositories → add crm-focusrealm while keeping the existing
   ones → Save → back to Vercel. If GitHub says only the owner can approve,
   stop and tell me.
2. On the configure screen:
   - Project name: crm-focusrealm
   - Framework Preset: Other
   - Root Directory: leave as ./ (the repo root)
   - Build & Output settings: leave all overrides OFF. The repo's
     vercel.json sets them (install "npm install", build
     "npm run build:vercel", output "apps/web/dist").
   - Don't add environment variables yet. Click Deploy. This first
     deployment may fail or show an error page; that's expected, because
     we redeploy at the end.
3. Settings → Git (or Settings → Environments → Production → Branch
   Tracking): set the production branch to
   claude/zealous-darwin-565r0v. Save.
4. Settings → Deployment Protection → Vercel Authentication: set it to
   "Only Preview Deployments" (or Standard Protection, which leaves the
   production domain public). The team must open the live site without a
   Vercel login. Save.
5. Settings → Domains: write down the production domain, e.g.
   crm-focusrealm.vercel.app or crm-focusrealm-xxxx.vercel.app. Below, this
   is LIVE_URL = https://<that domain> (no trailing slash).

────────────────────────────────────────
PART 2: CORE SETTINGS (Vercel → crm-focusrealm → Settings →
Environment Variables)
6. Generate each secret yourself as random letters and digits, and type it
   only into its Vercel field:
     JWT_SECRET   = 64 random letters/digits      (Sensitive)
     CRON_SECRET  = 48 random letters/digits      (Sensitive)
     APP_URL      = LIVE_URL from step 5
     AI_PROVIDER  = gemini
   Remember nothing; they don't need to be reused anywhere.

PART 3: DATABASE (Supabase → Vercel)
7. Supabase → "Alielectricwala's Project" → "Connect" button (top) →
   Connection string → "Transaction pooler" (port 6543) → copy the URI.
8. Vercel → Environment Variables → Add DATABASE_URL (Sensitive) and paste
   the URI into the value field. STOP and ask me to replace
   [YOUR-PASSWORD] (brackets included) with the database password myself.
   Save only after I say it's done.

────────────────────────────────────────
PART 4: CLOUDFLARE R2 (call recordings)
9. Cloudflare → R2 Object Storage. Copy the Account ID (not secret).
10. Open bucket crm-call-recordings (don't create a new one, and don't
    delete anything in it). Settings:
    - Public access must stay OFF (no r2.dev, no custom domain).
    - CORS policy → Edit → set exactly this, with LIVE_URL from step 5:
      [
        {
          "AllowedOrigins": ["LIVE_URL"],
          "AllowedMethods": ["GET", "HEAD", "PUT"],
          "AllowedHeaders": ["Content-Type"],
          "ExposeHeaders": ["ETag"],
          "MaxAgeSeconds": 3600
        }
      ]
11. R2 → Manage API tokens. If an old token named
    "focus-realm-crm-recordings" exists, delete it; its secret is lost. Then
    Create Account API token:
      Name: focus-realm-crm-recordings
      Permission: Object Read & Write
      Apply to: crm-call-recordings only
      TTL: Forever, no IP filtering
    Create it and keep the page open (the secret is shown once).
12. Vercel → Environment Variables, copying straight from the Cloudflare
    tab:
      R2_ACCOUNT_ID         = Account ID from step 9
      R2_ACCESS_KEY_ID      = Access Key ID           (Sensitive)
      R2_SECRET_ACCESS_KEY  = Secret Access Key       (Sensitive)
      R2_BUCKET             = crm-call-recordings
    Then close the Cloudflare token page.

────────────────────────────────────────
PART 5: GEMINI (AI call analysis and daily reports)
13. https://aistudio.google.com → Get API key → Create API key. Name it
    focus-realm-crm and use the existing Google project, without enabling
    billing. If an older focus-realm-crm key exists, you may reuse its
    value only if AI Studio shows it; otherwise create a new one.
14. Vercel → Environment Variables:
      GEMINI_API_KEY = the key   (Sensitive)

PART 6: DEEPGRAM (transcription)
15. https://console.deepgram.com → API Keys. If an old "focus-realm-crm"
    key exists, delete it (its secret can't be shown again). Create a New
    API Key: name focus-realm-crm, permission Member, expiration Never.
    Copy it.
16. Vercel → Environment Variables:
      DEEPGRAM_API_KEY = the key   (Sensitive)
    Close the Deepgram key page.

────────────────────────────────────────
PART 7: FIRST-LOGIN SAFETY NET
17. Vercel → Environment Variables:
      SETUP_CODE = 32 random letters/digits   (Production only, NOT
                                               Sensitive, so I can reveal
                                               it if it's needed)
    It only works while the CRM has no founder yet. The database probably
    already has my founder login, in which case it does nothing.

PART 8: DEPLOY
18. Check the variable list. It must contain exactly these 12 names:
    JWT_SECRET, CRON_SECRET, APP_URL, AI_PROVIDER, DATABASE_URL,
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
    GEMINI_API_KEY, DEEPGRAM_API_KEY, SETUP_CODE
    Fix any typo in a name.
19. Deployments → Create Deployment (or Redeploy the latest one) from
    branch claude/zealous-darwin-565r0v, target Production. Wait until it
    shows Ready. If the build fails, open the build log and tell me the
    first red error line, then stop.

────────────────────────────────────────
PART 9: LOG IN AND CHECK
20. Open LIVE_URL/login.
    A) If it shows "Set up the CRM": in another tab, Vercel → Environment
       Variables → SETUP_CODE → reveal → copy it into the "Setup code"
       field. Fill FR number, Full name, Email and Title from MY DETAILS.
       Leave both password fields empty and STOP. Ask me to type a NEW
       password (10+ characters) twice and click "Create founder login".
    B) If it shows the normal "Welcome back" sign-in: choose the Founders
       tab, type my FR number from MY DETAILS, then STOP and ask me to type
       my password and click "Enter the Founders portal".
    C) If it shows "Something went wrong on our side" or a blank page:
       Vercel → crm-focusrealm → Logs → Errors. Tell me the first line of
       the most recent errors (no secrets), and stop.
21. When I'm in the Founders portal: Settings → ⚙️ System → Integrations.
    Every row should have a green dot:
      AI analysis        → Google Gemini (gemini-flash-latest)
      Transcription      → Deepgram (Hindi/English, speaker labels)
      Alert emails       → Off — alerts stay in the CRM (correct)
      Recordings storage → Cloudflare R2 (private bucket)
      Database           → Postgres (Supabase)
    Tell me exactly what each row says.
22. Vercel → Environment Variables → delete SETUP_CODE. No redeploy needed.

PART 10: REPORT BACK
23. Tell me:
    - LIVE_URL
    - the production branch Vercel shows
    - the list of environment variable NAMES and their environments (no
      values)
    - the R2 CORS origin you set
    - which keys were newly created (names and first 4 characters only)
    - whether the deployment reached Ready
    - which login path (A, B or C) happened and whether I'm in
    - the five Integrations rows exactly as shown
    - anything you skipped or couldn't do, and why.
````

---

## Afterwards

- **Everyone signs in again** with their usual login ID and password, because
  the login secret is new. No data is lost.
- **HR console link (optional).** If the HR console sends new sales hires to
  the CRM, generate one random value. Add it to this project as
  `HR_WEBHOOK_SECRET` (Sensitive), set the same value as
  `FOCUS_REALM_CRM_SECRET` in the HR console's Vercel project, then redeploy
  both. Also update the CRM address in the HR console if `LIVE_URL` changed.
- **Old site.** If an old `crm-focusrealm.vercel.app` from another Vercel
  account still shows an outdated CRM, delete that project so nobody uses it.
