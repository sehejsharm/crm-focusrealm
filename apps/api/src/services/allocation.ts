import { randomInt } from "node:crypto";
import { db, json } from "../db/index.js";
import type { AuthUser } from "../lib/auth.js";
import { badRequest, notFound } from "../lib/http.js";
import { activity, audit, notify } from "../lib/record.js";
import { getSetting } from "./settings.js";

/**
 * Prospect allocation — proposal §4. The rules run here on the server and in
 * the database, never in the browser, so nobody can exceed a limit by
 * changing the page.
 */

export interface PlanInput {
  prospects: { id: string; segment: string | null }[];
  people: { id: string; currentActive: number }[];
  batchSize: number;
  maxActive: number;
  random?: (n: number) => number;
}

export interface Plan {
  assignments: { contactId: string; userId: string }[];
  perUser: Record<string, { quota: number; assigned: number; currentActive: number }>;
  unassigned: string[];
}

function shuffle<T>(arr: T[], rnd: (n: number) => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pure planning step, unit-tested on its own:
 *  1. Each person's quota = min(batch size, max active − current active), never below zero.
 *  2. Prospects are grouped by segment and shuffled within each group, then
 *     the groups are interleaved, so everyone gets a comparable mix.
 *  3. Each prospect goes to the eligible person with the fewest assigned so
 *     far in this batch; ties go to whoever has fewest from that segment,
 *     then the lighter book, then chance. Nobody is favoured for being first
 *     in the list, and everyone gets a mix of segments.
 */
export function planAllocation(input: PlanInput): Plan {
  const rnd = input.random ?? ((n: number) => randomInt(n));
  const perUser: Plan["perUser"] = {};
  for (const p of input.people) {
    const capacity = Math.max(0, input.maxActive - p.currentActive);
    perUser[p.id] = { quota: Math.min(input.batchSize, capacity), assigned: 0, currentActive: p.currentActive };
  }

  const groups = new Map<string, string[]>();
  for (const p of input.prospects) {
    const key = p.segment ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p.id);
  }
  const shuffled = shuffle([...groups.values()], rnd).map((g) => shuffle(g, rnd));
  const order: string[] = [];
  for (let i = 0; order.length < input.prospects.length; i++) {
    for (const g of shuffled) if (i < g.length) order.push(g[i]);
  }

  const segmentOf = new Map(input.prospects.map((p) => [p.id, p.segment ?? ""]));
  const segCount = new Map<string, number>(); // `${userId}|${segment}` → count
  const assignments: Plan["assignments"] = [];
  const unassigned: string[] = [];
  for (const contactId of order) {
    const open = input.people.filter((p) => perUser[p.id].assigned < perUser[p.id].quota);
    if (!open.length) {
      unassigned.push(contactId);
      continue;
    }
    const seg = segmentOf.get(contactId) ?? "";
    const ranked = open
      .map((p) => ({ p, r: rnd(1_000_000) }))
      .sort(
        (a, b) =>
          // 1. least loaded in this batch
          perUser[a.p.id].assigned - perUser[b.p.id].assigned ||
          // 2. fewest from this segment so far, so everyone gets a mix
          (segCount.get(`${a.p.id}|${seg}`) ?? 0) - (segCount.get(`${b.p.id}|${seg}`) ?? 0) ||
          // 3. lightest overall book
          perUser[a.p.id].currentActive - perUser[b.p.id].currentActive ||
          // 4. random — nobody is favoured for being first in the list
          a.r - b.r,
      );
    const pick = ranked[0].p;
    perUser[pick.id].assigned++;
    segCount.set(`${pick.id}|${seg}`, (segCount.get(`${pick.id}|${seg}`) ?? 0) + 1);
    assignments.push({ contactId, userId: pick.id });
  }
  return { assignments, perUser, unassigned };
}

export interface AllocationRequest {
  campaign?: string | null;
  segment?: string | null;
  source?: string | null;
  userIds: string[];
  batchSize?: number;
  maxActive?: number;
}

/** Active = owned and still being worked (not closed, disqualified or with Legion). */
const ACTIVE_STATUSES = `('new','outreach','follow_up','qualification_review','qualified','returned')`;

async function eligiblePool(req: AllocationRequest) {
  const where = [
    "c.owner_id is null",
    "c.do_not_contact = false",
    "c.is_invalid = false",
    "c.stage = 'prospect'",
    `c.status in ('new','returned')`,
    "c.phone_key is not null",
  ];
  const params: unknown[] = [];
  if (req.campaign) {
    params.push(req.campaign);
    where.push(`c.campaign = $${params.length}`);
  }
  if (req.segment) {
    params.push(req.segment);
    where.push(`c.segment = $${params.length}`);
  }
  if (req.source) {
    params.push(req.source);
    where.push(`c.source = $${params.length}`);
  }
  const pool = await db.many<{ id: string; segment: string | null }>(
    `select c.id, c.segment from crm_contacts c where ${where.join(" and ")} order by c.created_at limit 5000`,
    params,
  );

  // Why the rest of the segment was left out — shown to the manager.
  const scope = params.length ? where.slice(6).join(" and ") : "true";
  const excluded = await db.one(
    `select
       count(*) filter (where c.do_not_contact) as do_not_contact,
       count(*) filter (where c.is_invalid and not c.do_not_contact) as invalid,
       count(*) filter (where c.phone_key is null and not c.is_invalid and not c.do_not_contact) as no_phone,
       count(*) filter (where c.owner_id is not null and not c.do_not_contact and not c.is_invalid) as already_owned,
       count(*) filter (where c.owner_id is null and (c.stage <> 'prospect' or c.status not in ('new','returned'))
                         and not c.do_not_contact and not c.is_invalid) as not_open
     from crm_contacts c where ${scope}`,
    params,
  );
  return { pool, excluded };
}

async function eligiblePeople(userIds: string[]) {
  if (!userIds.length) throw badRequest("Pick at least one salesperson");
  const people = await db.many<{ id: string; full_name: string; status: string; role: string; current_active: number }>(
    `select u.id, u.full_name, u.status, u.role,
       (select count(*) from crm_contacts c where c.owner_id = u.id and c.status in ${ACTIVE_STATUSES}) as current_active
     from crm_users u where u.id = any($1::uuid[])`,
    [userIds],
  );
  const bad = people.filter((p) => p.status !== "active" || !["sales_rep", "sales_head"].includes(p.role));
  if (people.length !== userIds.length || bad.length) {
    throw badRequest("Only active salespeople can receive prospects");
  }
  return people;
}

export async function previewAllocation(req: AllocationRequest) {
  const s = await getSetting("allocation");
  const batchSize = req.batchSize ?? s.batchSize;
  const maxActive = req.maxActive ?? s.maxActive;
  const people = await eligiblePeople(req.userIds);
  const { pool, excluded } = await eligiblePool(req);
  const plan = planAllocation({
    prospects: pool,
    people: people.map((p) => ({ id: p.id, currentActive: p.current_active })),
    batchSize,
    maxActive,
  });
  return {
    batchSize,
    maxActive,
    poolSize: pool.length,
    willAssign: plan.assignments.length,
    leftUnassigned: plan.unassigned.length,
    excluded,
    people: people.map((p) => ({
      id: p.id,
      name: p.full_name,
      currentActive: p.current_active,
      quota: plan.perUser[p.id].quota,
      assigned: plan.perUser[p.id].assigned,
    })),
    plan,
  };
}

export async function runAllocation(actor: AuthUser, req: AllocationRequest) {
  const preview = await previewAllocation(req);
  const settings = { ...req, batchSize: preview.batchSize, maxActive: preview.maxActive };

  const result = await db.tx(async (q) => {
    const batch = await db.one<{ id: string }>(
      `insert into crm_allocation_batches (initiated_by, settings, settings_version) values ($1, $2::jsonb, 1) returning id`,
      [actor.id, json(settings)],
      q,
    );
    const done: { contactId: string; userId: string }[] = [];
    let lostRace = 0;
    for (const a of preview.plan.assignments) {
      // Claim safely: re-check eligibility at write time.
      const claimed = await q.query(
        `update crm_contacts set owner_id = $2, status = case when status = 'returned' then 'new' else status end,
           updated_at = now()
         where id = $1 and owner_id is null and do_not_contact = false and is_invalid = false
         returning id`,
        [a.contactId, a.userId],
      );
      if (!claimed.rowCount) {
        lostRace++;
        continue;
      }
      await q.query(
        `insert into crm_assignments (contact_id, user_id, batch_id, assigned_by, kind) values ($1, $2, $3, $4, 'allocation')`,
        [a.contactId, a.userId, batch.id, actor.id],
      );
      await activity(a.contactId, actor.id, "assignment", "Assigned in allocation batch", null, { userId: a.userId, batchId: batch.id }, q);
      done.push(a);
    }
    const perUser: Record<string, number> = {};
    for (const a of done) perUser[a.userId] = (perUser[a.userId] ?? 0) + 1;
    const summary = {
      assigned: done.length,
      perUser,
      leftUnassigned: preview.leftUnassigned + lostRace,
      excluded: preview.excluded,
      capacity: preview.people.map((p) => ({ id: p.id, name: p.name, quota: p.quota, currentActive: p.currentActive })),
    };
    await q.query(`update crm_allocation_batches set assigned_count = $2, summary = $3::jsonb where id = $1`, [
      batch.id,
      done.length,
      json(summary),
    ]);
    await audit({ id: actor.id, label: actor.full_name }, "allocation.run", "allocation_batch", batch.id, { settings, summary }, q);
    return { batchId: batch.id, ...summary };
  });

  // Notify after the transaction succeeds (proposal §4.2.8).
  for (const [userId, n] of Object.entries(result.perUser)) {
    await notify(userId, "allocation", `${n} new prospect${n === 1 ? "" : "s"} assigned to you`, "They're waiting in My Day. Go get them.", "/sales/prospects?filter=new");
  }
  return result;
}

/** Manual reassignment. A reason is required; history is preserved. */
export async function reassignContact(actor: AuthUser, contactId: string, toUserId: string, reason: string) {
  const s = await getSetting("allocation");
  if (actor.role === "sales_head" && !s.headsCanReassign) throw badRequest("Sales heads can't reassign right now");
  if (!reason.trim()) throw badRequest("Give a reason for the reassignment");
  const target = await db.maybe(`select id, full_name, status, role from crm_users where id = $1`, [toUserId]);
  if (!target || target.status !== "active" || !["sales_rep", "sales_head"].includes(target.role)) {
    throw badRequest("Reassign to an active salesperson");
  }
  return db.tx(async (q) => {
    const c = await db.maybe(`select id, owner_id, full_name from crm_contacts where id = $1 for update`, [contactId], q);
    if (!c) throw notFound("Prospect not found");
    if (c.owner_id === toUserId) throw badRequest("They already own this prospect");
    await q.query(`update crm_assignments set active = false, ended_at = now() where contact_id = $1 and active`, [contactId]);
    await q.query(
      `insert into crm_assignments (contact_id, user_id, assigned_by, previous_owner_id, kind, reason)
       values ($1, $2, $3, $4, $5, $6)`,
      [contactId, toUserId, actor.id, c.owner_id, c.owner_id ? "reassignment" : "manual", reason],
    );
    await q.query(`update crm_contacts set owner_id = $2, updated_at = now() where id = $1`, [contactId, toUserId]);
    await activity(contactId, actor.id, "assignment", `Reassigned to ${target.full_name}`, reason, { from: c.owner_id, to: toUserId }, q);
    await audit({ id: actor.id, label: actor.full_name }, "contact.reassign", "contact", contactId, { from: c.owner_id, to: toUserId, reason }, q);
    return { ok: true, contactName: c.full_name, toName: target.full_name };
  }).then(async (r) => {
    await notify(toUserId, "allocation", `${r.contactName} was assigned to you`, reason, `/sales/contacts/${contactId}`);
    return r;
  });
}

/**
 * Prospects whose owner is inactive, offboarded, or has made no call for the
 * configured number of days. Flagged for a manager — never auto-reassigned.
 */
export async function inactivityFlags() {
  const s = await getSetting("allocation");
  return db.many(
    `select u.id, u.full_name, u.status, u.employee_code,
       (select max(started_at) from crm_calls k where k.user_id = u.id) as last_call_at,
       count(c.id)::int as active_prospects
     from crm_users u
     join crm_contacts c on c.owner_id = u.id and c.status in ${ACTIVE_STATUSES}
     where u.role in ('sales_rep','sales_head')
     group by u.id
     having u.status <> 'active'
        or coalesce((select max(started_at) from crm_calls k where k.user_id = u.id), u.created_at) < now() - make_interval(days => $1::int)
     order by active_prospects desc`,
    [s.inactivityDays],
  );
}

export { ACTIVE_STATUSES };
