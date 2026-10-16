import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, json } from "../db/index.js";
import { env } from "../env.js";
import { hashPassword, nextLoginId, temporaryPassword, type Role } from "../lib/auth.js";
import { badRequest, HttpError } from "../lib/http.js";
import { phoneKey } from "../lib/phone.js";
import { audit, notifyRoles } from "../lib/record.js";
import { getSetting } from "./settings.js";

/**
 * Focus Realm HR console → CRM account sync.
 *
 * Same contract as the HR console's Workspace connection, so the HR side can
 * reuse its pattern: one signed endpoint, POST /api/integrations/hr/events,
 * body {id, type, createdAt, data}, headers X-FR-Timestamp and
 * X-FR-Signature: v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">.
 *
 * Only the sales department gets a CRM login. The HR console decides who is
 * in sales; the CRM checks again against its own department list (Settings →
 * HR integration) and politely skips anyone else.
 *
 * Every event id is applied once. A retried event returns the stored result
 * (without the temporary password) instead of creating a second account.
 */

const EmployeeData = z.object({
  externalId: z.string().min(1),
  fullName: z.string().min(1).optional(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  /** The Workspace employee ID (e.g. FR-0042), so the CRM login matches it. */
  employeeCode: z.string().optional().nullable(),
  /** Optional explicit CRM role; otherwise worked out from the title. */
  crmRole: z.enum(["sales_rep", "sales_head", "legion"]).optional().nullable(),
  /** The HR console may say explicitly that this person is in sales. */
  crmAccess: z.boolean().optional(),
  reason: z.string().optional().nullable(),
});

const Event = z.object({
  id: z.string().min(1),
  type: z.enum(["employee.created", "employee.updated", "employee.offboarded", "employee.restored", "employee.credentials_reset"]),
  createdAt: z.string().optional(),
  data: EmployeeData,
});

export function verifySignature(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined) {
  if (!env.hrWebhookSecret) throw new HttpError(503, "HR integration is not configured on the CRM (HR_WEBHOOK_SECRET)");
  if (!timestamp || !signature?.startsWith("v1=")) throw new HttpError(401, "Missing signature");
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) throw new HttpError(401, "Stale or invalid timestamp");
  const expected = createHmac("sha256", env.hrWebhookSecret).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(signature.slice(3), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, "Bad signature");
}

async function isSales(d: z.infer<typeof EmployeeData>) {
  if (d.crmAccess === true || d.crmRole) return true;
  if (d.crmAccess === false) return false;
  const s = await getSetting("hr");
  const hay = [d.department, d.title, d.role].filter(Boolean).map((x) => x!.toLowerCase());
  return s.crmDepartments.some((dep) => {
    const word = new RegExp(`(^|[^a-z])${dep.toLowerCase().replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}([^a-z]|$)`);
    return hay.some((h) => word.test(h));
  });
}

async function roleFor(d: z.infer<typeof EmployeeData>): Promise<Role> {
  if (d.crmRole) return d.crmRole;
  const s = await getSetting("hr");
  const title = (d.title ?? "").toLowerCase();
  return s.headKeywords.some((k) => new RegExp(`\\b${k.toLowerCase()}\\b`).test(title)) ? "sales_head" : "sales_rep";
}

function loginPayload(u: { employee_code: string; email: string | null; role: string }) {
  return { employeeCode: u.employee_code, email: u.email ?? "", loginUrl: `${env.appUrl}/login`, crmRole: u.role };
}

export async function handleHrEvent(rawBody: Buffer) {
  let parsed: z.infer<typeof Event>;
  try {
    parsed = Event.parse(JSON.parse(rawBody.toString("utf8")));
  } catch {
    throw badRequest("Malformed event");
  }
  const seen = await db.maybe(`select result from crm_hr_events where event_id = $1`, [parsed.id]);
  if (seen) return { ...seen.result, replayed: true };

  const result = await apply(parsed);
  // Never store a temporary password, even in the idempotency log.
  const { credentials: _omit, ...storable } = result as any;
  await db.query(
    `insert into crm_hr_events (event_id, type, external_id, result) values ($1, $2, $3, $4::jsonb) on conflict (event_id) do nothing`,
    [parsed.id, parsed.type, parsed.data.externalId, json(storable)],
  );
  return result;
}

async function apply(ev: z.infer<typeof Event>): Promise<Record<string, unknown>> {
  const d = ev.data;
  const existing = await db.maybe(`select * from crm_users where hr_external_id = $1`, [d.externalId]);
  const actor = { label: "HR console" };

  switch (ev.type) {
    case "employee.created":
    case "employee.updated": {
      const sales = await isSales(d);
      if (!existing) {
        if (!sales) return { ok: true, skipped: true, reason: "not_in_crm_departments" };
        return createFromHr(d, actor);
      }
      // Moved out of sales: their CRM login stops working; history is kept.
      if (!sales) {
        await db.query(`update crm_users set status = 'inactive', token_version = token_version + 1, updated_at = now() where id = $1`, [existing.id]);
        await audit(actor, "hr.left_sales", "user", existing.id, { department: d.department });
        await flagProspects(existing);
        return { ok: true, user: loginPayload(existing), deactivated: true };
      }
      const role = existing.role === "founder" ? "founder" : await roleFor(d);
      const u = await db.one(
        `update crm_users set full_name = coalesce($2, full_name), email = coalesce($3, email), phone = coalesce($4, phone),
           title = coalesce($5, title), department = coalesce($6, department), role = $7,
           status = case when status = 'inactive' then 'active' else status end, updated_at = now()
         where id = $1 returning *`,
        [existing.id, d.fullName ?? null, d.email ?? null, d.phone ?? null, d.title ?? null, d.department ?? null, role],
      );
      await audit(actor, "hr.updated", "user", u.id, { fields: Object.keys(d) });
      return { ok: true, user: loginPayload(u) };
    }
    case "employee.offboarded": {
      if (!existing) return { ok: true, skipped: true, reason: "unknown_employee" };
      await db.query(
        `update crm_users set status = 'offboarded', token_version = token_version + 1, updated_at = now() where id = $1`,
        [existing.id],
      );
      await audit(actor, "hr.offboarded", "user", existing.id, { reason: d.reason });
      await flagProspects(existing);
      return { ok: true, user: loginPayload(existing), offboarded: true };
    }
    case "employee.restored": {
      if (!existing) return { ok: true, skipped: true, reason: "unknown_employee" };
      const u = await db.one(`update crm_users set status = 'active', updated_at = now() where id = $1 returning *`, [existing.id]);
      await audit(actor, "hr.restored", "user", u.id);
      return { ok: true, user: loginPayload(u), restored: true };
    }
    case "employee.credentials_reset": {
      if (!existing) return { ok: true, skipped: true, reason: "unknown_employee" };
      const pw = temporaryPassword();
      const u = await db.one(
        `update crm_users set password_hash = $2, must_change_password = true, token_version = token_version + 1, updated_at = now()
         where id = $1 returning *`,
        [existing.id, await hashPassword(pw)],
      );
      await audit(actor, "hr.credentials_reset", "user", u.id);
      return { ok: true, user: loginPayload(u), credentials: { loginId: u.employee_code, email: u.email ?? "", temporaryPassword: pw } };
    }
  }
}

async function createFromHr(d: z.infer<typeof EmployeeData>, actor: { label: string }) {
  let code = d.employeeCode?.trim().toUpperCase() || (await nextLoginId("FRS"));
  // An employee code already used by someone else in the CRM: fall back to our own series.
  if (await db.maybe(`select 1 from crm_users where employee_code = $1`, [code])) code = await nextLoginId("FRS");
  const pw = temporaryPassword();
  const role = await roleFor(d);
  const pk = phoneKey(d.phone);
  const u = await db.one(
    `insert into crm_users (employee_code, email, full_name, phone, role, title, department, status, password_hash,
       must_change_password, hr_external_id, source, avatar_hue, start_date)
     values ($1,$2,$3,$4,$5,$6,$7,'active',$8,true,$9,'hr',$10,$11) returning *`,
    [
      code, d.email ?? null, d.fullName ?? "New teammate", pk ? `+${pk}` : d.phone ?? null, role, d.title ?? null, d.department ?? null,
      await hashPassword(pw), d.externalId, 190 + Math.floor(Math.random() * 40), d.startDate || null,
    ],
  );
  await audit(actor, "hr.provisioned", "user", u.id, { role, department: d.department });
  await notifyRoles(["founder", "sales_head"], "team", `${u.full_name} joined the sales team`, `CRM login ${u.employee_code} created from the HR console`, "/founder/team");
  return {
    ok: true,
    user: loginPayload(u),
    credentials: { loginId: u.employee_code, email: u.email ?? "", temporaryPassword: pw },
  };
}

/** Someone left: their open prospects go to managers for review (never auto-reassigned). */
async function flagProspects(u: { id: string; full_name: string }) {
  const n = await db.one<{ n: number }>(
    `select count(*) as n from crm_contacts where owner_id = $1 and status not in ('closed_won','closed_lost','disqualified','handed_off')`,
    [u.id],
  );
  if (n.n > 0) {
    await notifyRoles(["founder", "sales_head"], "review", `${n.n} prospects need a new owner`, `${u.full_name} no longer has CRM access.`, "/founder/allocation?tab=flags");
  }
}

export async function hrStatus() {
  const recent = await db.many(`select event_id, type, external_id, result, received_at from crm_hr_events order by received_at desc limit 20`);
  const counts = await db.one(`select count(*) filter (where source = 'hr') as provisioned from crm_users`);
  return {
    configured: Boolean(env.hrWebhookSecret),
    endpoint: `${env.publicApiUrl}/api/integrations/hr/events`,
    provisioned: counts.provisioned,
    recent,
  };
}
