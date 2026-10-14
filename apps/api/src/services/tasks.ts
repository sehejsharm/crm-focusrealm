import { db } from "../db/index.js";
import type { AuthUser } from "../lib/auth.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { activity, audit, notify } from "../lib/record.js";
import { canWork, getContactRow, label } from "./contacts.js";

/**
 * Follow-ups and tasks — proposal §9C. A prospect has at most one open
 * follow-up (a database rule); scheduling another reschedules the existing one.
 */

export interface TaskInput {
  contactId?: string | null;
  assignedTo?: string | null;
  kind: "call" | "follow_up" | "meeting" | "email" | "whatsapp" | "review" | "custom";
  title: string;
  reason?: string | null;
  dueAt?: string | null;
  reminderMinutes?: number | null;
  priority?: "low" | "normal" | "high" | "urgent";
}

const TASK_SELECT = `t.*, u.full_name as assignee_name, u.avatar_hue as assignee_hue, b.full_name as created_by_name,
  c.full_name as contact_name, c.phone_key as contact_phone, co.name as company_name, c.stage as contact_stage`;
const TASK_FROM = `from crm_tasks t join crm_users u on u.id = t.assigned_to left join crm_users b on b.id = t.created_by
  left join crm_contacts c on c.id = t.contact_id left join crm_companies co on co.id = c.company_id`;

export async function createTask(user: AuthUser, input: TaskInput) {
  let assignee = input.assignedTo ?? user.id;
  if (assignee !== user.id && user.role === "sales_rep") throw forbidden("You can only create tasks for yourself");
  if (assignee !== user.id && user.role === "legion") {
    const target = await db.maybe(`select role from crm_users where id = $1`, [assignee]);
    if (target?.role !== "legion") throw forbidden("Legion can assign tasks within Legion");
  }
  const target = await db.maybe(`select id, full_name, status from crm_users where id = $1`, [assignee]);
  if (!target || target.status !== "active") throw badRequest("Assign the task to an active teammate");

  let contact: any = null;
  if (input.contactId) {
    contact = await getContactRow(input.contactId);
    if (!canWork(user, contact) && user.role !== "founder") throw forbidden();
    if (!input.assignedTo && contact.owner_id && user.role !== "sales_rep") assignee = contact.owner_id;
  }
  const due = input.dueAt ? new Date(input.dueAt) : null;
  if (due && Number.isNaN(due.getTime())) throw badRequest("That due date isn't valid");
  const reminder = due && input.reminderMinutes != null ? new Date(due.getTime() - input.reminderMinutes * 60_000) : null;

  // One open follow-up per prospect: reschedule instead of duplicating.
  if (input.kind === "follow_up" && input.contactId) {
    const existing = await db.maybe(`select id from crm_tasks where contact_id = $1 and kind = 'follow_up' and status = 'open'`, [input.contactId]);
    if (existing) {
      await db.query(
        `update crm_tasks set title = $2, reason = $3, due_at = $4, reminder_at = $5, reminded_at = null, priority = $6,
           assigned_to = $7, updated_at = now() where id = $1`,
        [existing.id, input.title, input.reason ?? null, due, reminder, input.priority ?? "normal", assignee],
      );
      await afterSchedule(user, input.contactId, due, `Follow-up rescheduled`, input.reason);
      return getTask(existing.id);
    }
  }

  const row = await db.one(
    `insert into crm_tasks (contact_id, assigned_to, created_by, kind, title, reason, due_at, reminder_at, priority)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [input.contactId ?? null, assignee, user.id, input.kind, input.title, input.reason ?? null, due, reminder, input.priority ?? "normal"],
  );
  if (input.contactId) await afterSchedule(user, input.contactId, due, `${input.kind === "follow_up" ? "Follow-up" : "Task"} scheduled`, input.reason, contact);
  if (assignee !== user.id) {
    await notify(assignee, "task", `New task from ${user.full_name}`, input.title, input.contactId ? `/sales/contacts/${input.contactId}` : "/tasks");
    await audit({ id: user.id, label: user.full_name }, "task.assign", "task", row.id, { assignee, title: input.title });
  }
  return getTask(row.id);
}

async function afterSchedule(user: AuthUser, contactId: string, due: Date | null, title: string, reason?: string | null, contact?: any) {
  const c = contact ?? (await getContactRow(contactId));
  await db.query(
    `update crm_contacts set next_action_at = $2,
       status = case when status in ('new','outreach','returned') then 'follow_up' else status end, updated_at = now()
     where id = $1`,
    [contactId, due],
  );
  await activity(contactId, user.id, "task", title, reason ?? null, { dueAt: due, previousStatus: label(c.status) });
}

export async function getTask(id: string) {
  const t = await db.maybe(`select ${TASK_SELECT} ${TASK_FROM} where t.id = $1`, [id]);
  if (!t) throw notFound("Task not found");
  return t;
}

export async function listTasks(user: AuthUser, f: { scope: "mine" | "team" | "created"; status?: string; userId?: string; from?: string; to?: string; contactId?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.scope === "mine" || user.role === "sales_rep") add("t.assigned_to = ?", user.id);
  else if (f.scope === "created") add("t.created_by = ?", user.id);
  if (f.userId && user.role !== "sales_rep") add("t.assigned_to = ?", f.userId);
  if (f.status === "overdue") where.push("t.status = 'open' and t.due_at < now()");
  else if (f.status) add("t.status = ?", f.status);
  if (f.from) add("t.due_at >= ?", f.from);
  if (f.to) add("t.due_at < ?", f.to);
  if (f.contactId) add("t.contact_id = ?", f.contactId);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  return db.many(`select ${TASK_SELECT} ${TASK_FROM} ${w} order by (t.status = 'open') desc, t.due_at asc nulls last limit 500`, params);
}

export async function updateTask(user: AuthUser, id: string, patch: { status?: "open" | "done" | "missed" | "cancelled"; dueAt?: string | null; title?: string; reason?: string | null; priority?: string }) {
  const t = await getTask(id);
  const mine = t.assigned_to === user.id || t.created_by === user.id;
  if (!mine && user.role !== "founder" && user.role !== "sales_head") throw forbidden();
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.status) {
    set("status", patch.status);
    if (patch.status === "done") sets.push("completed_at = now()");
  }
  if (patch.dueAt !== undefined) {
    set("due_at", patch.dueAt ? new Date(patch.dueAt) : null);
    sets.push("reminded_at = null");
    if (patch.dueAt) set("reminder_at", new Date(new Date(patch.dueAt).getTime() - 15 * 60_000));
  }
  if (patch.title) set("title", patch.title);
  if (patch.reason !== undefined) set("reason", patch.reason);
  if (patch.priority) set("priority", patch.priority);
  if (!sets.length) return t;
  await db.query(`update crm_tasks set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
  if (t.contact_id && patch.status) {
    await activity(t.contact_id, user.id, "task", `Task ${patch.status === "done" ? "completed" : patch.status}: ${t.title}`);
  }
  if (t.contact_id && patch.status && patch.status !== "open") {
    const next = await db.maybe(`select min(due_at) as d from crm_tasks where contact_id = $1 and status = 'open'`, [t.contact_id]);
    await db.query(`update crm_contacts set next_action_at = $2 where id = $1`, [t.contact_id, next?.d ?? null]);
  }
  return getTask(id);
}

/** Minute-by-minute housekeeping: reminders due now. */
export async function sendDueReminders() {
  const due = await db.many(
    `update crm_tasks t set reminded_at = now() from crm_users u
     where u.id = t.assigned_to and t.status = 'open' and t.reminder_at is not null and t.reminder_at <= now() and t.reminded_at is null
     returning t.id, t.assigned_to, t.title, t.contact_id, t.due_at`,
  );
  for (const t of due) {
    await notify(t.assigned_to, "reminder", `⏰ ${t.title}`, t.due_at ? `Due ${new Date(t.due_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}` : null, t.contact_id ? `/sales/contacts/${t.contact_id}` : "/sales/follow-ups");
  }
  return due.length;
}

/**
 * Overdue work: open tasks more than a day past due are marked missed and
 * escalated to the sales heads (proposal: "overdue alerts and manager escalation").
 */
export async function escalateOverdue() {
  const rows = await db.many(
    `update crm_tasks set status = 'missed', escalated_at = now(), updated_at = now()
     where status = 'open' and due_at < now() - interval '24 hours' and escalated_at is null
     returning id, assigned_to, title, contact_id`,
  );
  if (!rows.length) return 0;
  const heads = await db.many<{ id: string }>(`select id from crm_users where role in ('sales_head') and status = 'active'`);
  const byUser = new Map<string, number>();
  for (const r of rows) byUser.set(r.assigned_to, (byUser.get(r.assigned_to) ?? 0) + 1);
  for (const [uid, n] of byUser) {
    const u = await db.maybe(`select full_name from crm_users where id = $1`, [uid]);
    await notify(uid, "overdue", `${n} follow-up${n > 1 ? "s" : ""} missed`, "They were more than a day overdue and have been flagged to your sales head.", "/sales/follow-ups");
    for (const h of heads) if (h.id !== uid) await notify(h.id, "escalation", `${u?.full_name ?? "Someone"} missed ${n} follow-up${n > 1 ? "s" : ""}`, null, "/sales/team");
  }
  return rows.length;
}
