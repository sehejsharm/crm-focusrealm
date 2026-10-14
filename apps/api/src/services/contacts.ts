import { db, json, type Queryable } from "../db/index.js";
import type { AuthUser } from "../lib/auth.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { companyKey, emailKey, formatPhone, phoneKey } from "../lib/phone.js";
import { activity, audit, notify, notifyRoles } from "../lib/record.js";
import { broadcast } from "../lib/bus.js";
import { getSetting } from "./settings.js";

export const STAGES = ["prospect", "qualified", "legion_meet_1", "legion_meet_2"] as const;
export type Stage = (typeof STAGES)[number];

export const STATUSES = [
  "new", "outreach", "follow_up", "qualification_review", "qualified", "handoff_pending",
  "handed_off", "returned", "closed_won", "closed_lost", "disqualified",
] as const;
export type Status = (typeof STATUSES)[number];

/** Status changes a salesperson may make by hand (proposal §5.2). */
const MANUAL_TRANSITIONS: Record<string, Status[]> = {
  new: ["outreach", "follow_up", "qualification_review", "disqualified"],
  outreach: ["follow_up", "qualification_review", "disqualified"],
  follow_up: ["outreach", "qualification_review", "disqualified"],
  qualification_review: ["outreach", "follow_up", "qualified", "disqualified"],
  qualified: ["qualification_review", "follow_up"],
  returned: ["outreach", "follow_up", "qualification_review", "disqualified"],
  disqualified: ["outreach"],
};

export const CONTACT_SELECT = `
  c.*, co.name as company_name, co.industry as company_industry, co.city as company_city, co.website as company_website,
  o.full_name as owner_name, o.avatar_hue as owner_hue, o.employee_code as owner_code,
  l.full_name as legion_owner_name,
  (select t.due_at from crm_tasks t where t.contact_id = c.id and t.status = 'open' order by t.due_at nulls last limit 1) as next_task_at,
  (select t.title from crm_tasks t where t.contact_id = c.id and t.status = 'open' order by t.due_at nulls last limit 1) as next_task_title`;

export const CONTACT_FROM = `
  from crm_contacts c
  left join crm_companies co on co.id = c.company_id
  left join crm_users o on o.id = c.owner_id
  left join crm_users l on l.id = c.legion_owner_id`;

export function presentContact(c: any) {
  return { ...c, phone_display: formatPhone(c.phone_key) ?? c.phone };
}

/** Can this person see the prospect at all? */
export function canView(user: AuthUser, c: { owner_id: string | null }) {
  if (user.role === "sales_rep") return c.owner_id === user.id;
  return true; // heads, founders and Legion see the sales team's work
}

/** Can this person work the prospect (call, notes, status)? */
export function canWork(user: AuthUser, c: { owner_id: string | null; legion_owner_id?: string | null; stage?: string }) {
  if (user.role === "founder" || user.role === "sales_head") return true;
  if (user.role === "legion") return c.stage === "legion_meet_1" || c.stage === "legion_meet_2" || c.legion_owner_id === user.id;
  return c.owner_id === user.id;
}

export async function getContactRow(id: string, q?: Queryable) {
  const c = await db.maybe(`select ${CONTACT_SELECT} ${CONTACT_FROM} where c.id = $1`, [id], q);
  if (!c) throw notFound("Prospect not found");
  return c;
}

export interface ListFilters {
  q?: string;
  stage?: string;
  status?: string;
  ownerId?: string;
  campaign?: string;
  segment?: string;
  unassigned?: boolean;
  due?: "today" | "overdue";
  sort?: "recent" | "name" | "next_action" | "temperature";
  page: number;
  pageSize: number;
}

export async function listContacts(user: AuthUser, f: ListFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (user.role === "sales_rep") add("c.owner_id = ?", user.id);
  if (f.q) {
    params.push(`%${f.q.toLowerCase()}%`);
    const n = params.length;
    where.push(`(lower(c.full_name) like $${n} or lower(coalesce(co.name,'')) like $${n} or c.phone_key like $${n}
      or lower(coalesce(c.email,'')) like $${n} or lower(coalesce(c.city,'')) like $${n})`);
  }
  if (f.stage) add("c.stage = ?", f.stage);
  if (f.status) add("c.status = ?", f.status);
  if (f.ownerId) add("c.owner_id = ?", f.ownerId);
  if (f.campaign) add("c.campaign = ?", f.campaign);
  if (f.segment) add("c.segment = ?", f.segment);
  if (f.unassigned) where.push("c.owner_id is null");
  if (f.due === "today") where.push(`exists (select 1 from crm_tasks t where t.contact_id = c.id and t.status = 'open' and t.due_at < date_trunc('day', now()) + interval '1 day')`);
  if (f.due === "overdue") where.push(`exists (select 1 from crm_tasks t where t.contact_id = c.id and t.status = 'open' and t.due_at < now())`);

  const order = {
    recent: "c.updated_at desc",
    name: "c.full_name asc",
    next_action: "next_task_at asc nulls last, c.updated_at desc",
    temperature: "c.temperature desc nulls last, c.updated_at desc",
  }[f.sort ?? "recent"];
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const total = await db.one<{ n: number }>(`select count(*) as n ${CONTACT_FROM} ${w}`, params);
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const rows = await db.many(
    `select ${CONTACT_SELECT} ${CONTACT_FROM} ${w} order by ${order} limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { total: total.n, page: f.page, pageSize: f.pageSize, rows: rows.map(presentContact) };
}

export async function contactDetail(user: AuthUser, id: string) {
  const c = await getContactRow(id);
  if (!canView(user, c)) throw forbidden("This prospect belongs to someone else");
  const [calls, tasks, timeline, handoffs, meetings, assignments] = await Promise.all([
    db.many(
      `select k.id, k.call_code, k.status, k.outcome, k.notes, k.started_at, k.duration_sec, k.mode, k.recording_status,
         k.analysis_status, k.score, k.analysis->'summary' as summary, u.full_name as user_name
       from crm_calls k join crm_users u on u.id = k.user_id where k.contact_id = $1 order by k.started_at desc limit 50`,
      [id],
    ),
    db.many(
      `select t.*, u.full_name as assignee_name from crm_tasks t join crm_users u on u.id = t.assigned_to
       where t.contact_id = $1 order by (t.status = 'open') desc, t.due_at asc nulls last limit 50`,
      [id],
    ),
    db.many(
      `select a.*, u.full_name as user_name, u.avatar_hue from crm_activities a left join crm_users u on u.id = a.user_id
       where a.contact_id = $1 order by a.created_at desc limit 100`,
      [id],
    ),
    db.many(
      `select h.*, f.full_name as from_name, d.full_name as decided_by_name from crm_handoffs h
       left join crm_users f on f.id = h.from_user_id left join crm_users d on d.id = h.decided_by
       where h.contact_id = $1 order by h.created_at desc`,
      [id],
    ),
    db.many(
      `select m.*, l.full_name as legion_name from crm_meetings m left join crm_users l on l.id = m.legion_user_id
       where m.contact_id = $1 order by m.scheduled_at desc`,
      [id],
    ),
    db.many(
      `select a.*, u.full_name as user_name, p.full_name as previous_name, b.full_name as assigned_by_name
       from crm_assignments a join crm_users u on u.id = a.user_id
       left join crm_users p on p.id = a.previous_owner_id left join crm_users b on b.id = a.assigned_by
       where a.contact_id = $1 order by a.created_at desc`,
      [id],
    ),
  ]);
  const qualification = await getSetting("qualification");
  return {
    contact: presentContact(c),
    calls,
    tasks,
    timeline,
    handoffs,
    meetings,
    assignments,
    qualificationFields: qualification.fields,
    permissions: { canWork: canWork(user, c) },
  };
}

async function upsertCompany(q: Queryable, name: string | null | undefined, extra: { industry?: string | null; city?: string | null; website?: string | null } = {}) {
  const clean = name?.trim();
  if (!clean) return null;
  const key = companyKey(clean) || clean.toLowerCase();
  const row = await db.one<{ id: string }>(
    `insert into crm_companies (name, name_key, industry, city, website) values ($1, $2, $3, $4, $5)
     on conflict (name_key) do update set
       industry = coalesce(crm_companies.industry, excluded.industry),
       city = coalesce(crm_companies.city, excluded.city),
       website = coalesce(crm_companies.website, excluded.website)
     returning id`,
    [clean, key, extra.industry ?? null, extra.city ?? null, extra.website ?? null],
    q,
  );
  return row.id;
}

export interface ContactInput {
  full_name: string;
  company?: string | null;
  designation?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  email?: string | null;
  city?: string | null;
  industry?: string | null;
  website?: string | null;
  source?: string | null;
  campaign?: string | null;
  segment?: string | null;
  tags?: string[];
  notes?: string | null;
}

export async function createContact(user: AuthUser, input: ContactInput, ownerId?: string | null) {
  const key = phoneKey(input.phone);
  if (!key) throw badRequest("A valid phone number is needed to call this prospect");
  const dup = await db.maybe(`select id, full_name from crm_contacts where phone_key = $1`, [key]);
  if (dup) throw badRequest(`That number already belongs to ${dup.full_name}`, { duplicateId: dup.id });
  const owner = user.role === "sales_rep" ? user.id : ownerId ?? null;
  const id = await db.tx(async (q) => {
    const companyId = await upsertCompany(q, input.company, input);
    const row = await db.one<{ id: string }>(
      `insert into crm_contacts (company_id, full_name, designation, phone, phone_key, alt_phone, email, email_key, city,
         source, campaign, segment, tags, notes, owner_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14,$15,$16) returning id`,
      [
        companyId, input.full_name.trim(), input.designation ?? null, input.phone ?? null, key, input.alt_phone ?? null,
        input.email ?? null, emailKey(input.email), input.city ?? null, input.source ?? "Manual entry",
        input.campaign ?? null, input.segment ?? null, input.tags ?? [], input.notes ?? null, owner, user.id,
      ],
      q,
    );
    if (owner) {
      await q.query(`insert into crm_assignments (contact_id, user_id, assigned_by, kind) values ($1, $2, $3, 'manual')`, [row.id, owner, user.id]);
    }
    await activity(row.id, user.id, "created", "Prospect created", null, {}, q);
    return row.id;
  });
  return getContactRow(id);
}

export interface ImportRequest {
  fileName?: string;
  campaign?: string | null;
  segment?: string | null;
  source?: string | null;
  rows: ContactInput[];
}

/**
 * Import the contact database: validate, de-duplicate (against the database
 * and within the file, by phone and then email) and store. Rows that fail are
 * reported back with the reason, never silently dropped.
 */
export async function importContacts(user: AuthUser, req: ImportRequest) {
  if (!req.rows.length) throw badRequest("The file has no rows");
  if (req.rows.length > 20000) throw badRequest("Import at most 20,000 rows at a time");

  const issues: { row: number; reason: string; name?: string }[] = [];
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  const valid: (ContactInput & { phone_key: string; email_key: string | null; row: number })[] = [];

  req.rows.forEach((r, i) => {
    const row = i + 2; // header is row 1 in a spreadsheet
    const name = r.full_name?.trim();
    if (!name) return issues.push({ row, reason: "Missing name" });
    const pk = phoneKey(r.phone);
    if (!pk) return issues.push({ row, name, reason: r.phone ? `Invalid phone "${r.phone}"` : "Missing phone" });
    const ek = emailKey(r.email);
    if (seenPhones.has(pk)) return issues.push({ row, name, reason: "Duplicate phone within the file" });
    if (ek && seenEmails.has(ek)) return issues.push({ row, name, reason: "Duplicate email within the file" });
    seenPhones.add(pk);
    if (ek) seenEmails.add(ek);
    valid.push({ ...r, full_name: name, phone_key: pk, email_key: ek, row });
  });

  // Existing numbers/emails in the database.
  const existingPhones = new Set(
    (await db.many<{ phone_key: string }>(`select phone_key from crm_contacts where phone_key = any($1::text[])`, [valid.map((v) => v.phone_key)])).map((r) => r.phone_key),
  );
  const emails = valid.map((v) => v.email_key).filter(Boolean) as string[];
  const existingEmails = new Set(
    emails.length
      ? (await db.many<{ email_key: string }>(`select email_key from crm_contacts where email_key = any($1::text[])`, [emails])).map((r) => r.email_key)
      : [],
  );
  const fresh = valid.filter((v) => {
    if (existingPhones.has(v.phone_key)) {
      issues.push({ row: v.row, name: v.full_name, reason: "Already in the CRM (same phone)" });
      return false;
    }
    if (v.email_key && existingEmails.has(v.email_key)) {
      issues.push({ row: v.row, name: v.full_name, reason: "Already in the CRM (same email)" });
      return false;
    }
    return true;
  });

  const duplicateCount = issues.filter((i) => i.reason.includes("Duplicate") || i.reason.includes("Already")).length;
  const invalidCount = issues.length - duplicateCount;

  const batchId = await db.tx(async (q) => {
    const batch = await db.one<{ id: string }>(
      `insert into crm_import_batches (file_name, uploaded_by, campaign, segment, source, total_rows, created_count,
         duplicate_count, invalid_count, report)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning id`,
      [
        req.fileName ?? null, user.id, req.campaign ?? null, req.segment ?? null, req.source ?? null, req.rows.length,
        fresh.length, duplicateCount, invalidCount, json({ issues: issues.slice(0, 500) }),
      ],
      q,
    );
    const companyIds = new Map<string, string | null>();
    for (const r of fresh) {
      const cname = r.company?.trim() ?? "";
      if (!companyIds.has(cname)) companyIds.set(cname, await upsertCompany(q, cname, r));
      await q.query(
        `insert into crm_contacts (company_id, full_name, designation, phone, phone_key, alt_phone, email, email_key, city,
           source, campaign, segment, tags, notes, import_batch_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14,$15,$16)
         on conflict (phone_key) where phone_key is not null do nothing`,
        [
          companyIds.get(cname) ?? null, r.full_name, r.designation ?? null, r.phone ?? null, r.phone_key, r.alt_phone ?? null,
          r.email ?? null, r.email_key, r.city ?? null, r.source ?? req.source ?? "Import", r.campaign ?? req.campaign ?? null,
          r.segment ?? req.segment ?? null, r.tags ?? [], r.notes ?? null, batch.id, user.id,
        ],
      );
    }
    await audit({ id: user.id, label: user.full_name }, "contacts.import", "import_batch", batch.id, {
      file: req.fileName, created: fresh.length, duplicates: duplicateCount, invalid: invalidCount,
    }, q);
    return batch.id;
  });

  return {
    batchId,
    total: req.rows.length,
    created: fresh.length,
    duplicates: duplicateCount,
    invalid: invalidCount,
    issues: issues.slice(0, 200),
  };
}

export async function updateContact(user: AuthUser, id: string, patch: Partial<ContactInput> & {
  do_not_contact?: boolean; is_invalid?: boolean; qualification?: Record<string, unknown>;
}) {
  const c = await getContactRow(id);
  if (!canWork(user, c)) throw forbidden();
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown, cast = "") => {
    params.push(v);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (patch.full_name !== undefined) set("full_name", patch.full_name.trim());
  if (patch.designation !== undefined) set("designation", patch.designation);
  if (patch.email !== undefined) {
    set("email", patch.email);
    set("email_key", emailKey(patch.email));
  }
  if (patch.phone !== undefined) {
    const key = phoneKey(patch.phone);
    if (!key) throw badRequest("That phone number doesn't look right");
    set("phone", patch.phone);
    set("phone_key", key);
  }
  if (patch.alt_phone !== undefined) set("alt_phone", patch.alt_phone);
  if (patch.city !== undefined) set("city", patch.city);
  if (patch.campaign !== undefined) set("campaign", patch.campaign);
  if (patch.segment !== undefined) set("segment", patch.segment);
  if (patch.tags !== undefined) set("tags", patch.tags, "::text[]");
  if (patch.notes !== undefined) set("notes", patch.notes);
  if (patch.do_not_contact !== undefined) set("do_not_contact", patch.do_not_contact);
  if (patch.is_invalid !== undefined) set("is_invalid", patch.is_invalid);
  if (patch.qualification !== undefined) set("qualification", json({ ...(c.qualification ?? {}), ...patch.qualification }), "::jsonb");
  if (patch.company !== undefined) {
    const companyId = await db.tx((q) => upsertCompany(q, patch.company));
    set("company_id", companyId);
  }
  if (!sets.length) return getContactRow(id);
  await db.query(`update crm_contacts set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
  if (patch.qualification) {
    await activity(id, user.id, "qualification", "Qualification checklist updated", null, { qualification: patch.qualification });
  }
  if (patch.do_not_contact) await activity(id, user.id, "dnc", "Marked do-not-contact");
  const fresh = await getContactRow(id);
  broadcast({ type: "contact.updated", data: { id } });
  return presentContact(fresh);
}

export async function changeStatus(user: AuthUser, id: string, status: Status, note?: string | null) {
  const c = await getContactRow(id);
  if (!canWork(user, c)) throw forbidden();
  const allowed = MANUAL_TRANSITIONS[c.status] ?? [];
  if (!allowed.includes(status)) {
    throw badRequest(`Can't move from ${label(c.status)} to ${label(status)} by hand`);
  }
  if (c.status === "disqualified" && user.role === "sales_rep") throw forbidden("Ask a sales head to reopen this prospect");
  if (status === "disqualified" && !note?.trim()) throw badRequest("Say why this prospect is disqualified");
  if (status === "qualified") await assertQualified(c);
  const stage: Stage = status === "qualified" ? "qualified" : c.stage === "qualified" ? "prospect" : c.stage;
  await db.query(`update crm_contacts set status = $2, stage = $3, updated_at = now() where id = $1`, [id, status, stage]);
  await activity(id, user.id, "status", `Status: ${label(c.status)} → ${label(status)}`, note ?? null, { from: c.status, to: status });
  if (stage !== c.stage) await activity(id, user.id, "stage", `Moved to ${label(stage)}`, null, { from: c.stage, to: stage });
  broadcast({ type: "contact.updated", data: { id } });
  return presentContact(await getContactRow(id));
}

async function assertQualified(c: any) {
  const q = await getSetting("qualification");
  const missing = q.fields.filter((f) => f.required && !c.qualification?.[f.key]);
  if (missing.length) {
    throw badRequest(`Still missing: ${missing.map((m) => m.label).join(", ")}`, { missing: missing.map((m) => m.key) });
  }
}

/** Kanban drag between milestones, with the same rules as the buttons. */
export async function moveStage(user: AuthUser, id: string, stage: Stage, note?: string | null) {
  const c = await getContactRow(id);
  if (c.stage === stage) return presentContact(c);
  if (stage === "qualified") {
    if (!canWork(user, c)) throw forbidden();
    if (["legion_meet_1", "legion_meet_2"].includes(c.stage) && user.role !== "founder") {
      throw forbidden("Only founders can pull a prospect back from Legion");
    }
    return changeStatusTo(user, c, "qualified", "qualified", note);
  }
  if (stage === "prospect") {
    if (user.role === "sales_rep" && c.owner_id !== user.id) throw forbidden();
    if (["legion_meet_1", "legion_meet_2"].includes(c.stage) && user.role !== "founder") {
      throw forbidden("Only founders can pull a prospect back from Legion");
    }
    return changeStatusTo(user, c, "follow_up", "prospect", note);
  }
  // Legion stages.
  if (user.role !== "legion" && user.role !== "founder") throw forbidden("Legion stages are moved by the Legion team");
  if (c.stage === "prospect" && user.role !== "founder") throw badRequest("Qualify and hand off the prospect first");
  const handoff = await db.maybe(`select id, status from crm_handoffs where contact_id = $1 order by created_at desc limit 1`, [id]);
  if (!handoff || handoff.status !== "accepted") {
    if (user.role !== "founder") throw badRequest("Accept the handoff before moving it into Legion meetings");
    await db.query(
      `insert into crm_handoffs (contact_id, from_user_id, status, note, decided_by, decided_at)
       values ($1, $2, 'accepted', 'Moved by a founder from the board', $3, now())`,
      [id, c.owner_id, user.id],
    );
  }
  return changeStatusTo(user, c, "handed_off", stage, note, user.role === "legion" ? user.id : c.legion_owner_id);
}

async function changeStatusTo(user: AuthUser, c: any, status: Status, stage: Stage, note?: string | null, legionOwner?: string | null) {
  if (status === "qualified") await assertQualified(c);
  await db.query(
    `update crm_contacts set status = $2, stage = $3, legion_owner_id = coalesce($4, legion_owner_id), updated_at = now() where id = $1`,
    [c.id, status, stage, legionOwner ?? null],
  );
  await activity(c.id, user.id, "stage", `Moved to ${label(stage)}`, note ?? null, { from: c.stage, to: stage });
  if (status === "qualified" && c.owner_id) {
    await notifyRoles(["sales_head"], "qualified", `${c.full_name} is qualified`, `${c.company_name ?? ""} — ready for handoff`, `/sales/contacts/${c.id}`);
  }
  broadcast({ type: "contact.updated", data: { id: c.id } });
  return presentContact(await getContactRow(c.id));
}

/** Submit a qualified prospect to the Legion team (proposal: handoff decision). */
export async function submitHandoff(user: AuthUser, id: string, note: string | null, toUserId?: string | null) {
  const c = await getContactRow(id);
  if (!canWork(user, c)) throw forbidden();
  if (!["qualified", "returned", "qualification_review"].includes(c.status)) throw badRequest("Qualify the prospect before handing it off");
  await assertQualified(c);
  const qualification = await getSetting("qualification");
  await db.tx(async (q) => {
    await q.query(
      `insert into crm_handoffs (contact_id, from_user_id, to_user_id, status, note, checklist)
       values ($1, $2, $3, 'pending', $4, $5::jsonb)`,
      [id, user.id, toUserId ?? null, note, json(Object.fromEntries(qualification.fields.map((f) => [f.label, Boolean(c.qualification?.[f.key])])))],
    );
    await q.query(`update crm_contacts set status = 'handoff_pending', stage = 'qualified', updated_at = now() where id = $1`, [id]);
    await activity(id, user.id, "handoff", "Handed off to Legion", note, {}, q);
  });
  if (toUserId) await notify(toUserId, "handoff", `New handoff: ${c.full_name}`, note ?? c.company_name, `/legion/handoffs`);
  else await notifyRoles(["legion"], "handoff", `New handoff: ${c.full_name}`, note ?? c.company_name, `/legion/handoffs`);
  broadcast({ type: "contact.updated", data: { id } });
  return getContactRow(id);
}

export async function decideHandoff(user: AuthUser, handoffId: string, decision: "accept" | "return", reason?: string | null, legionUserId?: string | null) {
  if (user.role !== "legion" && user.role !== "founder") throw forbidden("Only the Legion team decides handoffs");
  const h = await db.maybe(`select * from crm_handoffs where id = $1`, [handoffId]);
  if (!h) throw notFound("Handoff not found");
  if (h.status !== "pending") throw badRequest("This handoff was already decided");
  if (decision === "return" && !reason?.trim()) throw badRequest("Give the salesperson a reason");
  const c = await getContactRow(h.contact_id);
  const owner = legionUserId ?? (user.role === "legion" ? user.id : null);
  await db.tx(async (q) => {
    await q.query(
      `update crm_handoffs set status = $2, return_reason = $3, decided_by = $4, decided_at = now(), to_user_id = coalesce(to_user_id, $5) where id = $1`,
      [handoffId, decision === "accept" ? "accepted" : "returned", reason ?? null, user.id, owner],
    );
    if (decision === "accept") {
      await q.query(`update crm_contacts set status = 'handed_off', legion_owner_id = $2, updated_at = now() where id = $1`, [c.id, owner]);
      await activity(c.id, user.id, "handoff", "Legion accepted the handoff", reason ?? null, {}, q);
    } else {
      await q.query(`update crm_contacts set status = 'returned', stage = 'prospect', updated_at = now() where id = $1`, [c.id]);
      await activity(c.id, user.id, "handoff", "Returned by Legion", reason ?? null, {}, q);
    }
  });
  if (h.from_user_id) {
    await notify(
      h.from_user_id,
      "handoff",
      decision === "accept" ? `Legion accepted ${c.full_name} 🎉` : `${c.full_name} was returned`,
      decision === "accept" ? "Nice work — it's in Legion's hands now." : reason,
      `/sales/contacts/${c.id}`,
    );
  }
  broadcast({ type: "contact.updated", data: { id: c.id } });
  return getContactRow(c.id);
}

export async function closeContact(user: AuthUser, id: string, outcome: "won" | "lost", note?: string | null) {
  if (user.role !== "legion" && user.role !== "founder") throw forbidden();
  const c = await getContactRow(id);
  await db.query(`update crm_contacts set status = $2, updated_at = now() where id = $1`, [id, outcome === "won" ? "closed_won" : "closed_lost"]);
  await activity(id, user.id, "closed", outcome === "won" ? "Closed — won 🏆" : "Closed — lost", note ?? null);
  for (const uid of [c.owner_id, c.legion_owner_id].filter(Boolean) as string[]) {
    if (uid !== user.id) await notify(uid, "closed", outcome === "won" ? `${c.full_name} closed — won! 🏆` : `${c.full_name} closed — lost`, note, `/sales/contacts/${id}`);
  }
  broadcast({ type: "contact.updated", data: { id } });
  return getContactRow(id);
}

export async function addNote(user: AuthUser, id: string, body: string) {
  const c = await getContactRow(id);
  if (!canView(user, c)) throw forbidden();
  return activity(id, user.id, "note", "Note", body);
}

export async function facets(user: AuthUser) {
  const scope = user.role === "sales_rep" ? "where owner_id = $1" : "";
  const params = user.role === "sales_rep" ? [user.id] : [];
  const [campaigns, segments, sources, stages, statuses] = await Promise.all(
    ["campaign", "segment", "source", "stage", "status"].map((col) =>
      db.many(`select ${col} as value, count(*)::int as count from crm_contacts ${scope} group by ${col} order by count desc`, params),
    ),
  );
  return { campaigns, segments, sources, stages, statuses };
}

const LABELS: Record<string, string> = {
  new: "New", outreach: "Outreach", follow_up: "Follow-up", qualification_review: "Qualification review",
  qualified: "Qualified", handoff_pending: "Handoff pending", handed_off: "With Legion", returned: "Returned",
  closed_won: "Won", closed_lost: "Lost", disqualified: "Disqualified", prospect: "Prospect",
  legion_meet_1: "Legion Meet 1", legion_meet_2: "Legion Meet 2",
};
export const label = (s: string) => LABELS[s] ?? s;
