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
