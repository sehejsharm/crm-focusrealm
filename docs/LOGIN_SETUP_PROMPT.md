# Prompt for Claude in Chrome: first sign-in for founders and Legion

This prompt sets up the CRM's first logins. It gets the latest code live,
adds the one-time setup code in Vercel, creates the first founder (you), and
adds the other founders and the Legion team. The sales team doesn't need
this, because their logins arrive from the HR console.

Open **Claude in Chrome**, sign in to **GitHub** and **Vercel** in the same
browser, fill in the three lists at the top of the box (your details, the
other founders, the Legion team), then paste everything inside the box. You
type your own password yourself when it asks; Claude never sees it.

---

````text
Set up the first logins for the Focus Realm Sales CRM. It's deployed on
Vercel from the GitHub repo "sehejsharm/crm-focusrealm". I'm signed in to
GitHub and Vercel in this browser.

MY DETAILS (the first founder):
  FR number: FR-____
  Full name: ____
  Email: ____
  Title: ____            (e.g. Co-founder & CEO)

OTHER FOUNDERS (they're on Workspace and use their FR numbers):
  - FR-____ · Full name · email · title
  - (add more lines or delete this one)

LEGION TEAM (never on Workspace; the CRM gives them LG IDs):
  - Full name · email · phone (optional)
  - (add more lines or delete this one)

SAFETY RULES (follow them throughout)
- Never type, paste or show the setup code or any password anywhere except
  the exact fields described below. The one exception is the one-time
  passwords in Part 5, which you list for me in your final report and
  nowhere else.
- Never type my own password. When the setup form needs it, stop and ask me
  to type it myself.
- Don't change any Vercel or GitHub settings other than the ones named here.
  Ask me before merging anything.

PART 1: MAKE SURE THE LATEST CODE IS LIVE
1. Vercel → the CRM project (built from "sehejsharm/crm-focusrealm"; ask me
   if you can't tell which one it is) → Settings → Git: note the Production
   Branch (usually "main").
2. GitHub → sehejsharm/crm-focusrealm → Pull requests: check whether branch
   "claude/practical-thompson-q304i0" is already merged into that
   production branch.
   - If it isn't, open a pull request from it into the production branch,
     or use the one that's already open. Title: "Cloudflare R2 recordings +
     sign-in for founders and Legion". Then STOP and ask me before you
     click Merge. Merge only after I say yes.
   - If GitHub shows conflicts or failing checks, stop and tell me what
     they say.
3. Vercel → Deployments: wait until a Production deployment of that merge
   shows Ready.

PART 2: ADD THE ONE-TIME SETUP CODE (Vercel)
4. Make up a random setup code: 32 letters and digits, no spaces. Keep it
   only in your memory for Part 3.
5. Vercel → the CRM project → Settings → Environment Variables → add
   SETUP_CODE = that code, for Production, marked Sensitive. If SETUP_CODE
   already exists, edit it. Don't touch any other variable.
6. Deployments → the latest Production deployment → ⋯ → Redeploy. Wait
   until it shows Ready.

PART 3: CREATE THE FIRST FOUNDER (the CRM)
7. Open the CRM's production URL (Vercel → the project → Domains; use the
   custom domain if there is one) and go to /login.
   - If you see "Set up the CRM", continue with step 8.
   - If you see "Setup is locked", the redeploy in step 6 isn't live yet.
     Wait, reload, and check again.
   - If you see the normal "Welcome back" sign-in, a founder already
     exists. Skip to step 10, and ask me to sign in myself first.
8. Fill in: Setup code = the code from step 4, FR number, Full name, Email
   and Title from MY DETAILS. Leave Password and Repeat password empty.
9. STOP and ask me to type my password in both password fields (10+
   characters) and click "Create founder login" myself. Wait until I tell
   you I'm in the Founders portal.

PART 4: TIDY UP THE SETUP CODE (Vercel)
10. Vercel → Settings → Environment Variables → delete SETUP_CODE. (It
    stops working anyway once a founder exists; this just removes it.) No
    redeploy is needed.

PART 5: ADD THE OTHER FOUNDERS AND LEGION (the CRM, signed in as me)
11. In the CRM: Founders portal → People & Access → "Add person", once per
    person:
    - Founders: Role = "Founder (CEO/COO…)", Full name, FR number = their
      FR number, Title, Email.
    - Legion: Role = "Legion", Full name, Login ID left EMPTY (the CRM
      assigns LG-0001, LG-0002…), Email, Phone if given.
    Click "Create login". The dialog shows their Login ID and a one-time
    password only once. Note both before you close it.
    If the CRM says an FR number is "already someone's login", skip that
    person and tell me. Don't invent a different ID.
12. Check the People & Access list. Each person should appear once with the
    right role, and Legion should have LG IDs.

PART 6: REPORT BACK
13. Tell me:
    - whether the code was merged (with the pull request link) and
      deployed
    - whether the first-founder setup worked
    - a table of everyone added: name · role · login ID · one-time password
      (they'll be asked to choose their own password the first time they
      sign in)
    - anything you skipped or couldn't do, and why.
````

---

## Then

Give each person their login ID, the one-time password and the CRM link.
Founders and the sales team sign in on the **Founders** or **Sales Team** tab
with their FR number; Legion use the **Legion** tab with their LG ID. Email
works as a login too. Lost a password? People & Access → the person → Reset
password gives them a new one-time password.
