import { db } from "../db/index.js";
import type { AuthUser } from "../lib/auth.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { broadcast } from "../lib/bus.js";
import { activity, notify } from "../lib/record.js";
import { getContactRow, label } from "./contacts.js";

/**
 * Legion meetings — the third and fourth columns of the main board. Booking a
 * meeting moves the prospect into that milestone.
 */

const MEETING_SELECT = `m.*, c.full_name as contact_name, c.phone_key as contact_phone, co.name as company_name, c.stage as contact_stage,
  l.full_name as legion_name, s.full_name as sales_name, c.status as contact_status`;
const MEETING_FROM = `from crm_meetings m join crm_contacts c on c.id = m.contact_id left join crm_companies co on co.id = c.company_id
  left join crm_users l on l.id = m.legion_user_id left join crm_users s on s.id = m.sales_user_id`;

export async function scheduleMeeting(user: AuthUser, input: {
  contactId: string; stage: "legion_meet_1" | "legion_meet_2" | "legion_meet_3"; scheduledAt: string; durationMin?: number;
  location?: string | null; legionUserId?: string | null; notes?: string | null;
}) {
  if (!["legion", "founder", "sales_head"].includes(user.role)) throw forbidden("Legion meetings are booked by the Legion team");
  const c = await getContactRow(input.contactId);
  const handoff = await db.maybe(`select status from crm_handoffs where contact_id = $1 order by created_at desc limit 1`, [c.id]);
  if (handoff?.status !== "accepted" && user.role === "legion") throw badRequest("Accept the handoff before booking a Legion meeting");
  // Meetings follow 1 → 2 → 3, except that founders and sales heads may book
  // any of them directly (prospects who come in through connections).
  const direct = user.role === "founder" || user.role === "sales_head";
  if (!direct && input.stage === "legion_meet_2" && !["legion_meet_1", "legion_meet_2", "legion_meet_3"].includes(c.stage)) {
    throw badRequest("Hold Legion Meet 1 first");
  }
  if (!direct && input.stage === "legion_meet_3" && !["legion_meet_2", "legion_meet_3"].includes(c.stage)) {
    throw badRequest("Hold Legion Meet 2 first");
  }
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) throw badRequest("Pick a valid date and time");
  const legionUser = input.legionUserId ?? (user.role === "legion" ? user.id : c.legion_owner_id);

  const row = await db.one(
    `insert into crm_meetings (contact_id, stage, scheduled_at, duration_min, location, legion_user_id, sales_user_id, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [c.id, input.stage, when, input.durationMin ?? 45, input.location ?? null, legionUser, c.owner_id, input.notes ?? null, user.id],
  );
  await db.query(
    `update crm_contacts set stage = $2, status = 'handed_off', legion_owner_id = coalesce(legion_owner_id, $3), next_action_at = $4, updated_at = now() where id = $1`,
    [c.id, input.stage, legionUser, when],
  );
  await activity(c.id, user.id, "meeting", `${label(input.stage)} booked`, input.notes ?? null, { scheduledAt: when, location: input.location });
  if (c.owner_id) {
    await notify(c.owner_id, "meeting", `${label(input.stage)} booked with ${c.full_name} 🚀`, when.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }), `/sales/contacts/${c.id}`);
  }
  broadcast({ type: "contact.updated", data: { id: c.id } });
  return getMeeting(row.id);
}

export async function getMeeting(id: string) {
  const m = await db.maybe(`select ${MEETING_SELECT} ${MEETING_FROM} where m.id = $1`, [id]);
  if (!m) throw notFound("Meeting not found");
  return m;
}

export async function listMeetings(user: AuthUser, f: { from?: string; to?: string; mine?: boolean; status?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (user.role === "sales_rep") add("m.sales_user_id = ?", user.id);
  else if (f.mine) add("m.legion_user_id = ?", user.id);
  if (f.from) add("m.scheduled_at >= ?", f.from);
  if (f.to) add("m.scheduled_at < ?", f.to);
  if (f.status) add("m.status = ?", f.status);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  return db.many(`select ${MEETING_SELECT} ${MEETING_FROM} ${w} order by m.scheduled_at asc limit 300`, params);
}

export async function updateMeeting(user: AuthUser, id: string, patch: { status?: "scheduled" | "completed" | "no_show" | "cancelled"; outcome?: string | null; notes?: string | null; scheduledAt?: string }) {
  if (user.role !== "legion" && user.role !== "founder") throw forbidden();
  const m = await getMeeting(id);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.status) set("status", patch.status);
  if (patch.outcome !== undefined) set("outcome", patch.outcome);
  if (patch.notes !== undefined) set("notes", patch.notes);
  if (patch.scheduledAt) set("scheduled_at", new Date(patch.scheduledAt));
  if (!sets.length) return m;
  await db.query(`update crm_meetings set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
  if (patch.status && patch.status !== m.status) {
    await activity(m.contact_id, user.id, "meeting", `${label(m.stage)}: ${patch.status.replace("_", " ")}`, patch.outcome ?? patch.notes ?? null);
    if (m.sales_user_id) await notify(m.sales_user_id, "meeting", `${label(m.stage)} with ${m.contact_name}: ${patch.status.replace("_", " ")}`, patch.outcome ?? null, `/sales/contacts/${m.contact_id}`);
  }
  return getMeeting(id);
}
