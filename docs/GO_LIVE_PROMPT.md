# Prompt for Claude in Chrome: get the CRM ready to go live

The Vercel project **crm-focusrealm** already exists, with `JWT_SECRET`,
`CRON_SECRET` and `SETUP_CODE` set. This prompt does the rest of the setup
that needs your accounts:

1. it lets Vercel read the GitHub repo
2. it adds the database connection
3. it sets up Cloudflare R2 for call recordings
4. it adds the AI key

It does **not** deploy. When it's finished, tell Claude Code "done" and it
will deploy, watch the build and check the live site.

Open **Claude in Chrome** and sign in to **GitHub**, **Vercel**,
**Supabase**, **Cloudflare** and Google (for a Gemini key) in the same
browser. Fill in the AI CHOICE line at the top of the box, then paste
everything inside the box. Claude asks you to type the database password
yourself, so it never sees it.

---

````text
Get the Focus Realm Sales CRM ready to go live on Vercel. I'm signed in to
GitHub, Vercel, Supabase, Cloudflare and Google in this browser.

AI CHOICE: gemini      (write "gemini" for Google's free key, or "anthropic"
                        for a paid Claude key)

FACTS
- GitHub repo: sehejsharm/crm-focusrealm. Production branch:
  claude/zealous-darwin-565r0v
- Vercel project: crm-focusrealm (it has no Git connection yet). Don't
  touch the other Vercel projects ("focusrealm", "focusrealm-fzi2"). They
  are the HR console.
- Supabase project: "Alielectricwala's Project" (ref lvfdrhvpukkdmxziwtnn).
  The HR console uses it too. The CRM adds its own tables, all starting
  with crm_, so the two don't collide.

SAFETY RULES (follow them throughout)
- Never type, paste or show a secret (password, API key, access key,
  connection string) anywhere except the Vercel environment-variable form.
  That means not in the chat, notes or other sites. In your report, show at
  most the first 4 characters of any key.
- Never type my database password. When it's needed, stop and ask me to
  type it myself.
- Never reset the Supabase database password, and never change Supabase
  settings. If I don't know the password, stop and tell me, because a reset
  could break the HR console.
- Never enter payment details or accept a paid plan. If a step needs that,
  stop and tell me. I'll do it, then you continue.
- In Vercel, add or edit only the variables named here. Don't touch
  JWT_SECRET, CRON_SECRET or SETUP_CODE. If a variable already exists,
  edit it rather than adding a duplicate.
- Don't deploy or redeploy anything. I'll do that afterwards.

PART 1: LET VERCEL READ THE REPO
1. Vercel → project crm-focusrealm → Settings → Git → Connect Git
   Repository → GitHub.
2. If sehejsharm/crm-focusrealm is in the list, connect it. If it isn't:
   click "Adjust GitHub App Permissions" (or "Configure GitHub App"). On
   GitHub, choose the sehejsharm account → Repository access → "Only select
   repositories" → add crm-focusrealm, keeping every repo that's already
   selected → Save. Then go back to Vercel and connect it.
   If GitHub says only the owner of sehejsharm can approve this, stop and
   tell me.
3. Make sure the production branch is claude/zealous-darwin-565r0v. It's
   under Settings → Git or Settings → Environments → Production → Branch
   Tracking. Change it only if it's different.

PART 2: THE DATABASE
4. Supabase → "Alielectricwala's Project" → the "Connect" button at the top
   → Connection string → choose "Transaction pooler" (port 6543) → copy the
   URI. It looks like
   postgresql://postgres.lvfdrhvpukkdmxziwtnn:[YOUR-PASSWORD]@aws-…pooler.supabase.com:6543/postgres
5. Vercel → crm-focusrealm → Settings → Environment Variables → Add:
   Key DATABASE_URL, Value = that URI, Environments Production and Preview,
   Sensitive on.
   Don't save yet. STOP and ask me to replace [YOUR-PASSWORD] (brackets
   included) in the value field with the database password. Wait until I
   say it's done, then click Save.

PART 3: CLOUDFLARE R2 FOR CALL RECORDINGS
6. Use my existing Cloudflare account. If there's more than one account,
   ask me which. Don't change anything that's already there.
   R2 Object Storage → copy the Account ID (it isn't secret).
7. Create bucket: name crm-call-recordings (if that name is taken by
   something that isn't the CRM's, use crm-call-recordings-focusrealm),
   location Automatic with hint "Asia-Pacific (APAC)", storage class
   Standard. Keep public access OFF: no r2.dev URL and no custom domain.
8. Bucket → Settings → CORS policy → save exactly this:
     [
       {
         "AllowedOrigins": ["https://crm-focusrealm.vercel.app"],
         "AllowedMethods": ["GET", "HEAD", "PUT"],
         "AllowedHeaders": ["Content-Type"],
         "ExposeHeaders": ["ETag"],
         "MaxAgeSeconds": 3600
       }
     ]
   If Vercel → crm-focusrealm → Settings → Domains lists other domains,
   add each one to AllowedOrigins as https://domain (no trailing slash).
9. R2 → Manage API tokens → Create Account API token (it may be labelled
   "Create API token"): name focus-realm-crm-recordings, permission "Object
   Read & Write", apply to the bucket from step 7 only, TTL Forever, no IP
   filtering. Create it, and leave the page open. Cloudflare shows the keys
   only once.
10. Vercel → crm-focusrealm → Environment Variables. Add each of these for
    Production and Preview, copying each value straight from the Cloudflare
    tab:
      R2_ACCOUNT_ID         = Account ID from step 6
      R2_ACCESS_KEY_ID      = Access Key ID from step 9       (Sensitive)
      R2_SECRET_ACCESS_KEY  = Secret Access Key from step 9   (Sensitive)
      R2_BUCKET             = bucket name from step 7
    When all four are saved, close the Cloudflare token page.

PART 4: THE AI KEY (follow the AI CHOICE at the top)
If AI CHOICE is "gemini":
11. Go to aistudio.google.com → Get API key → Create API key. Pick an
    existing Google Cloud project or let it make a new one, and don't
    enable billing. Copy the key.
12. Vercel → Environment Variables, for Production and Preview:
      GEMINI_API_KEY = the key   (Sensitive)
      AI_PROVIDER    = gemini
If AI CHOICE is "anthropic":
11. Go to console.anthropic.com → API keys → Create key, named
    focus-realm-crm. If the account has no credits, stop and tell me.
12. Vercel → Environment Variables, for Production and Preview:
      ANTHROPIC_API_KEY = the key            (Sensitive)
      AI_PROVIDER       = anthropic
      AI_MODEL          = claude-haiku-5-5   (the cheapest model; I can
                                              change it later)

PART 5: REPORT BACK
13. Tell me:
    - whether the repo is connected, and the production branch Vercel shows
    - the list of variable NAMES now in Vercel for crm-focusrealm, with
      their environments (names only, no values)
    - the R2 bucket name and the CORS origins you set
    - which AI option you set up
    - anything you skipped or couldn't do, and why.
````

---

## Then

Tell Claude Code it's done. It will deploy from
`claude/zealous-darwin-565r0v`, follow the build to Ready, and check that the
live site starts. After that:

1. Open the live link and go to `/login`.
2. Create your founder login with your FR number. The setup code is in
   Vercel → crm-focusrealm → Settings → Environment Variables → SETUP_CODE
   (click to reveal it).
3. Delete `SETUP_CODE` in Vercel.
4. Add the other founders and the Legion team in People & Access.
   `docs/LOGIN_SETUP_PROMPT.md` covers this.
5. Import your leads (Prospects → Import) and click **Allocate now**.
