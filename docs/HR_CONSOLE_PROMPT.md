# Prompt for the HR console (Claude Code)

Open a Claude Code session in the **`sehejsharm/focusrealmhr`** repository and
paste everything inside the box below (from "You are working in…" to the end
of the code block). It adds the CRM connection: when someone in the sales
department joins in the HR console, they get a CRM login automatically — the
same way everyone already gets a Workspace login.

Before you start: set `HR_WEBHOOK_SECRET` on the CRM (`openssl rand -hex 32`),
and have the CRM's URL ready. The same secret goes into the HR console as
`FOCUS_REALM_CRM_SECRET`.

---

````text
You are working in the Focus Realm HR console (Next.js App Router, Supabase,
deployed on Vercel). Read README.md and AGENTS.md first, and follow the
existing patterns exactly — especially how the Focus Realm Workspace
connection works today:

  - lib/onboarding/workspace-sync.server.ts  (signed client, copied verbatim from the other app)
  - lib/onboarding/workspace.server.ts       (records the login, seals the temporary password, one-time reveal)
  - app/api/onboarding/admin/workspace/sync/route.ts  ("Sync everyone")
  - app/api/cron/workspace-leavers/route.ts  (nightly leavers)
  - the candidate types/view in lib/onboarding/types.ts and lib/onboarding/view.ts
  - the WorkspaceAccess component and where the founders' record page and the
    candidate portal show the Workspace login

GOAL
Add a second, parallel connection to the new Focus Realm Sales CRM. Everyone
keeps getting a Workspace login exactly as now. In addition, people whose role
is in the SALES department get a CRM login. Nobody outside sales gets one, and
nobody outside sales has any data sent to the CRM.

WHAT TO BUILD

1. Client. Create lib/onboarding/crm-sync.server.ts with EXACTLY the file
   content at the end of this prompt (it is the CRM's own client; do not edit
   it — it will be replaced wholesale when the CRM changes it). It reads
   FOCUS_REALM_CRM_URL and FOCUS_REALM_CRM_SECRET and is a silent no-op when
   either is unset.

2. Server module lib/onboarding/crm.server.ts, mirroring workspace.server.ts:
   - forCrm(candidate): build a CrmCandidate with the same privacy rules as
     forWorkspace — never Aadhaar, address, parent's name; phone ONLY when the
     candidate's consent covers the CRM (see "Privacy" below). Pass role:
     { id: track.id, label: track.label, roleTitle: track.roleTitle } from
     trackOf(candidate), workspaceLoginId: candidate.workspace?.loginId, and
     crmAccess when a founder set it explicitly (step 6).
   - linkCrmAccount(candidate): provisionCrmAccount(...) → record the login.
   - refreshCrmAccount(candidate): updateCrmAccount(..., { hadCrmLogin:
     Boolean(candidate.crm) }); record a newly returned login/password (a
     person moved INTO sales gets one; moved OUT of sales the CRM switches it
     off — record crm.offboarded).
   - recordCrmLogin(id, login): store { loginId, provisionedAt, crmRole,
     sealedPassword (seal() exactly like the Workspace/mailbox passwords),
     viewedAt, offboarded } on the candidate under a new `crm` field, keeping
     history the same way recordWorkspaceLogin does.
   - claimCrmPassword(id): one-time reveal, destroyed after first view, claim
     made inside the write — copy claimWorkspacePassword's approach.
   - offboard / restore / resetCrmPassword wrappers that record confirmation
     the same way the Workspace removal/restore does (retried by the nightly
     run and by "Sync everyone" until confirmed).
   - crmConfigured() and crmLoginUrl() helpers like the Workspace ones.

3. Types & view. Add `crm?: CrmLogin` to Candidate in lib/onboarding/types.ts
   (same shape as WorkspaceLogin plus crmRole), and expose
   `crm: { loginId, viewed, crmRole } | null` in the candidate view. Never
   expose the sealed password anywhere except the one-time reveal.

4. Wire it in — a CRM call must NEVER block or fail an HR action (log the
   error and carry on, exactly like the Workspace calls):
   - Candidate created (invite and "add existing employee"): after the
     Workspace login is linked (so the same employee ID is reused), call
     linkCrmAccount for sales roles.
   - Details submitted, company mailbox recorded, role/track changed:
     refreshCrmAccount.
   - Founder removes a person, and the nightly leavers cron when a last day
     ends: offboard the CRM login too (only if they have one).
   - Founder restores a person: restore the CRM login (unless their last day
     is already over, same rule as the Workspace).
   - "Sync everyone to the Workspace" at the foot of /hr/admin: also give
     every active sales person without a CRM login one, and retry unconfirmed
     CRM offboardings; list CRM failures alongside Workspace failures. Rename
     the button to "Sync everyone (Workspace & CRM)" if the CRM is configured.

5. Founders' console UI (/hr/admin/[id]): next to the Workspace login block,
   show a "Sales CRM" block for people who have (or should have) a CRM login:
   the CRM login ID and role, the one-time temporary password reveal (same
   component behaviour as Workspace), a "Reset CRM password" button, and the
   CRM sign-in link. Candidate portal: on the last onboarding step (and in
   their portal after it), sales people also see their CRM login and the
   one-time password reveal, exactly like the Workspace one. Match the
   existing design system (brand tokens in app/globals.css, BrandMark,
   components/onboarding/ui.tsx); light and dark.

6. Explicit override at invite: in the founders' "invite candidate" form add
   a checkbox "Give Sales CRM access", ticked by default when the chosen role
   is a sales role (isSalesRole from crm-sync.server.ts), so founders can also
   give it to, e.g., a Founder's Office intern who will sell. Store the choice
   on the candidate as crmAccess and pass it through forCrm.

7. Privacy. The CRM is a new recipient of personal data. Update the privacy
   notice (content and version — follow how notice 2026-10-10.1 added the
   Workspace, and the consentCoversWorkspace pattern in
   lib/onboarding/compliance.ts) to name the Focus Realm Sales CRM, what it
   receives (name, role, start date, email, phone), and why (sales work and
   call recording/coaching for sales team members). Add
   consentCoversCrm(consent) and send the phone number to the CRM only for
   people who consented under the new notice. Update the README's
   "Focus Realm Workspace" section with a parallel "Focus Realm Sales CRM"
   section (setup variables, what it receives, the events table) and the
   breach section (rotate FOCUS_REALM_CRM_SECRET on both sides).

8. Environment. Add to .env.example (commented like the Workspace ones):
     FOCUS_REALM_CRM_URL=        # e.g. https://crm.focusrealm.com
     FOCUS_REALM_CRM_SECRET=     # same value as HR_WEBHOOK_SECRET on the CRM
   Server-only; never NEXT_PUBLIC_.

VERIFY
- npm run lint and npm run build pass.
- With the two variables unset, the console behaves exactly as before.
- With them set to a running CRM: invite a "Business Development" candidate →
  the founders' record shows a CRM login and a one-time password, and the
  person appears in the CRM under Founder → People & Access with an "HR"
  badge. Invite a "Marketing" candidate → no CRM login and no request sent.
  Remove the BD candidate → they can no longer sign in to the CRM. Restore →
  they can. Reset CRM password → a new one-time password.
- Re-running "Sync everyone" twice creates nothing twice (event ids are
  idempotent).

Don't push to main; open a pull request with a summary of what changed.

The client file — create lib/onboarding/crm-sync.server.ts with exactly this:

```ts
import { createHmac, randomUUID } from "node:crypto";

/**
 * Focus Realm HR console → Focus Realm Sales CRM account sync. SERVER ONLY.
 *
 * Drop this file into the HR console at lib/onboarding/crm-sync.server.ts,
 * unchanged. It has no dependencies beyond Node and fetch, and it fails
 * soft: if the two environment variables below are not set, every call is a
 * no-op that returns null, so the HR console keeps working exactly as before.
 *
 *   FOCUS_REALM_CRM_URL     e.g. https://crm.focusrealm.com
 *   FOCUS_REALM_CRM_SECRET  the same value as HR_WEBHOOK_SECRET on the CRM
 *
 * Only the sales department gets a CRM login. isSalesRole() decides that on
 * this side, so nobody else's data is ever sent; the CRM checks again against
 * its own department list (Settings → HR console) and skips anyone else.
 *
 * Every request is signed (HMAC-SHA256 over "<timestamp>.<body>") and carries
 * an event id. The CRM applies each event id once, so a retried request can
 * never create a second account. Same contract as the Workspace connection.
 */

export interface CrmCandidate {
  id: string;
  invitedName: string;
  invitedEmail: string;
  startDate: string;
  details?: { fullName?: string; phone?: string } | null;
  mailbox?: { address: string } | null;
  /** Role title and label, e.g. from trackOf(candidate). */
  role?: { roleTitle: string; label: string; id?: string };
  /** Their Workspace login (e.g. FR-0042), so the CRM login is the same ID. */
  workspaceLoginId?: string | null;
  /** A founder's explicit choice at invite time; overrides the role check. */
  crmAccess?: boolean;
}

export interface CrmCredentials {
  /** The ID they sign in to the CRM with — the Workspace employee ID when one exists. */
  loginId: string;
  email: string;
  /** Present only when the CRM generated a password. Seal it, show it once, then discard it. */
  temporaryPassword?: string;
  loginUrl: string;
  /** "sales_rep" or "sales_head", decided by the CRM from the title. */
  crmRole?: string;
}

type EventType =
  | "employee.created"
  | "employee.updated"
  | "employee.offboarded"
  | "employee.restored"
  | "employee.credentials_reset";

/** Roles that get a CRM login. Keep in step with the CRM's Settings → HR console list. */
const SALES_WORDS = ["sales", "business development", "business-development", "bd", "inside sales"];

export function isSalesRole(c: Pick<CrmCandidate, "role" | "crmAccess">): boolean {
  if (typeof c.crmAccess === "boolean") return c.crmAccess;
  const hay = [c.role?.id, c.role?.label, c.role?.roleTitle].filter(Boolean).map((s) => s!.toLowerCase());
  return SALES_WORDS.some((w) => {
    const word = new RegExp(`(^|[^a-z])${w.replace(/-/g, "\\-")}([^a-z]|$)`);
    return hay.some((h) => word.test(h));
  });
}

function settings() {
  const url = process.env.FOCUS_REALM_CRM_URL?.replace(/\/$/, "");
  const secret = process.env.FOCUS_REALM_CRM_SECRET;
  return url && secret ? { url, secret } : null;
}

export function crmConfigured(): boolean {
  return settings() !== null;
}

async function send(type: EventType, data: Record<string, unknown>, eventId = `evt_${randomUUID()}`) {
  const s = settings();
  if (!s) return null;

  const body = JSON.stringify({ id: eventId, type, createdAt: new Date().toISOString(), data });

  // Three attempts with backoff. The same event id is reused, so retries are safe.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", s.secret).update(`${timestamp}.${body}`).digest("hex");
    try {
      const res = await fetch(`${s.url}/api/integrations/hr/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FR-Timestamp": String(timestamp),
          "X-FR-Signature": `v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) return json;
      // 4xx means the request itself is wrong — retrying will not help.
      if (res.status < 500) throw new Error(`CRM rejected ${type}: ${json.error ?? res.status}`);
      lastError = new Error(`CRM error ${res.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("CRM rejected")) throw error;
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("CRM unreachable");
}

function toEmployee(c: CrmCandidate) {
  return {
    externalId: c.id,
    fullName: c.details?.fullName || c.invitedName,
    // The company mailbox once it exists, the invite address until then.
    email: c.mailbox?.address || c.invitedEmail,
    role: "INTERN",
    title: c.role?.roleTitle,
    department: c.role?.label,
    phone: c.details?.phone,
    startDate: c.startDate,
    employeeCode: c.workspaceLoginId ?? undefined,
    // Only a founder's explicit choice is sent; otherwise the CRM decides from
    // the department/title against its own list.
    ...(typeof c.crmAccess === "boolean" ? { crmAccess: c.crmAccess } : {}),
  };
}

function credentialsFrom(json: Record<string, unknown> | null): CrmCredentials | null {
  if (!json || json.skipped) return null;
  const user = json.user as { employeeCode: string; email: string; loginUrl: string; crmRole?: string } | undefined;
  const creds = json.credentials as { loginId: string; email: string; temporaryPassword: string } | undefined;
  if (!user) return null;
  return {
    loginId: user.employeeCode,
    email: user.email,
    loginUrl: user.loginUrl,
    crmRole: user.crmRole,
    ...(creds ? { temporaryPassword: creds.temporaryPassword } : {}),
  };
}

/**
 * Call right after a candidate is created (and after their Workspace login
 * exists, so the CRM can reuse the same employee ID). Returns their CRM login
 * — with a temporary password the first time — or null when the person is not
 * in sales or the integration is not configured.
 *
 * The event id is derived from the candidate id, so calling this twice for the
 * same candidate is harmless.
 */
export async function provisionCrmAccount(c: CrmCandidate) {
  if (!isSalesRole(c)) return null;
  return credentialsFrom(await send("employee.created", toEmployee(c), `evt_hr_${c.id}_crm_created`));
}

/**
 * Call when their name, email, title, role or phone changes. Moving INTO sales
 * creates their CRM login (returned, with a password); moving OUT of sales
 * switches it off — the CRM keeps their history.
 */
export async function updateCrmAccount(c: CrmCandidate, opts: { hadCrmLogin?: boolean } = {}) {
  if (!isSalesRole(c) && !opts.hadCrmLogin) return null;
  return credentialsFrom(await send("employee.updated", toEmployee(c)));
}

/** Call when a founder removes them or their last day ends. Their CRM login stops working at once, everywhere. */
export async function offboardCrmAccount(candidateId: string, reason?: string) {
  return send("employee.offboarded", { externalId: candidateId, reason });
}

/** Call when a removal is undone. */
export async function restoreCrmAccount(candidateId: string) {
  return send("employee.restored", { externalId: candidateId });
}

/** Issues a fresh temporary password (returned once) and signs them out everywhere. */
export async function resetCrmPassword(candidateId: string) {
  return credentialsFrom(await send("employee.credentials_reset", { externalId: candidateId }));
}
```
````
