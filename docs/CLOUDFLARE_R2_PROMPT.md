# Prompt for Claude in Chrome: Cloudflare R2 storage

Cloudflare R2 is the CRM's main storage for call recordings. The bucket is
private: the CRM keeps the access key on the server and gives the browser
signed links that expire after a short time. The database stays on Postgres
(Supabase); see "Why not the database too?" below.

Open **Claude in Chrome**, sign in to **Cloudflare** (your existing account)
and **Vercel** in the same browser, then paste everything inside the box
below. It creates the bucket, a key that can only reach that bucket, and the
upload rules for your CRM's domain, and saves the keys straight into Vercel.
The keys are never written anywhere else.

Before you start: the code that adds R2 must be on the branch Vercel
deploys to production (merge this branch first). Until it is, Vercel ignores
the R2 variables.

---

````text
Set up Cloudflare R2 as the recording storage for the Focus Realm Sales CRM,
which is deployed on Vercel. I'm already signed in to Cloudflare and Vercel
in this browser. I already have a Cloudflare account with a project in it.
Use that account. Don't create a new account, and don't change or delete
anything that's already in it (Workers, Pages, other buckets, DNS, tokens).

SAFETY RULES (follow them throughout)
- Never type, paste or show a secret anywhere except the Vercel
  environment-variable form described below. That includes the chat, notes,
  screenshots you describe, and other sites. When you report back, show at
  most the first 4 characters of a key.
- Never enter payment details or accept a paid plan. If R2 asks me to add a
  payment method or subscribe before it can be used, stop and tell me. I'll
  do that part myself, then you continue.
- If Cloudflare shows more than one account, ask me which one before doing
  anything.
- Don't turn on public access for the bucket: no r2.dev URL, no custom domain.

PART 1: FIND THE CRM'S WEB ADDRESSES (Vercel)
1. In Vercel, open the CRM project (the one built from the GitHub repo
   "sehejsharm/crm-focusrealm"; if you can't tell which it is, ask me).
2. Settings → Domains: write down every domain the CRM is served on, as
   origins, e.g. https://crm.focusrealm.com and
   https://<project>.vercel.app. Keep this list for Part 3.

PART 2: CREATE THE BUCKET (Cloudflare)
3. Cloudflare dashboard → choose the account → R2 Object Storage.
4. On the R2 overview page, copy the Account ID. It isn't secret. Keep it
   for Part 5.
5. Create bucket:
   - Name: crm-call-recordings
     (if a bucket with that name already exists and isn't the CRM's, use
     crm-call-recordings-focusrealm instead and remember the name)
   - Location: Automatic, with the location hint "Asia-Pacific (APAC)",
     since the sales team is in India
   - Jurisdiction: none (default)
   - Default storage class: Standard
6. Open the bucket → Settings:
   - Public access: leave it disabled (r2.dev subdomain off, no custom
     domains).
   - CORS policy → Add/Edit, and save exactly this JSON, with the
     AllowedOrigins replaced by the origins from step 2 (no trailing slash,
     no paths):
     [
       {
         "AllowedOrigins": ["https://crm.focusrealm.com", "https://<project>.vercel.app"],
         "AllowedMethods": ["GET", "HEAD", "PUT"],
         "AllowedHeaders": ["Content-Type"],
         "ExposeHeaders": ["ETag"],
         "MaxAgeSeconds": 3600
       }
     ]

PART 3: CREATE AN ACCESS KEY FOR THAT BUCKET ONLY (Cloudflare)
7. R2 Object Storage → Manage API tokens (may be labelled "API Tokens" or
   "Manage R2 API Tokens") → Create Account API token (or "Create API
   token").
   - Name: focus-realm-crm-recordings
   - Permissions: Object Read & Write
   - Specify bucket(s): apply to specific buckets only → the bucket from
     step 5
   - TTL: Forever
   - Client IP filtering: none
8. Create it. Cloudflare shows the Access Key ID and the Secret Access Key
   only once. Leave this tab open. Don't close it until both values are
   saved in Vercel (Part 4).

PART 4: SAVE THE SETTINGS IN VERCEL
9. In another tab: Vercel → the CRM project → Settings → Environment
   Variables. Add each of these for Production and Preview. Where Vercel
   offers "Sensitive", mark the two secret ones as Sensitive.
     R2_ACCOUNT_ID         = the Account ID from step 4
     R2_ACCESS_KEY_ID      = Access Key ID from step 8      (Sensitive)
     R2_SECRET_ACCESS_KEY  = Secret Access Key from step 8  (Sensitive)
     R2_BUCKET             = the bucket name from step 5
   Copy each value straight from the Cloudflare tab into the Vercel field.
   If any of these variables already exists, edit it instead of adding a
   duplicate. Don't touch any other variable. In particular, keep
   DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as they are.
10. Once all four are saved, go back to the Cloudflare tab and close the
    token page.
11. Vercel → Deployments → the latest Production deployment → ⋯ → Redeploy
    (without the build cache is fine). Wait until it reports Ready.

PART 5: CHECK IT WORKS
12. Open the CRM, sign in as a founder → Settings → System (the
    "Integrations" card). "Recordings storage" must say
    "Cloudflare R2 (private bucket)" with a green dot. If it still says
    Supabase or Local disk, the deployment doesn't have the new code or the
    variables yet. Tell me which, and stop.
13. Report back with:
    - the Cloudflare account name and bucket name you used
    - the CORS origins you set
    - which Vercel environments got the four variables
    - the result of step 12
    - anything you couldn't do and why.
````

---

## After the prompt

- **Existing recordings in Supabase** (only if the CRM has been in use):
  copy them to R2 once from your laptop. It skips anything already in R2,
  so it's safe to re-run:

  ```bash
  DATABASE_URL="…" SUPABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…" \
  R2_ACCOUNT_ID="…" R2_ACCESS_KEY_ID="…" R2_SECRET_ACCESS_KEY="…" \
    npm run copy-recordings-to-r2
  ```

  The object keys stay the same, so nothing in the database changes. Keep
  the Supabase bucket until you've played a few old recordings from the CRM.
  After that you can delete it.
- **Try it:** start a Phone Link call, attach a recording, and play it back
  from the call page. The upload goes from the browser straight to R2.
  Playback uses a signed link that expires after 10 minutes.

## Why not the database too?

The CRM's data (people, prospects, calls, transcripts, reports, the job
queue) uses Postgres features throughout: `jsonb`, row locking for the job
queue, advisory locks for migrations, and interval arithmetic. Cloudflare's
database, D1, is SQLite and is built to be used from Cloudflare Workers, not
from Vercel. Moving the data there would mean rewriting most of the API's
queries and moving the API to Workers. So Postgres keeps the records and R2
keeps the files. If you later move the whole app to Cloudflare Workers,
Hyperdrive can connect it to the same Postgres database.
