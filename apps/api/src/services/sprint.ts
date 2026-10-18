import { db } from "../db/index.js";
import type { AuthUser } from "../lib/auth.js";
import { dayBounds, todayLocal } from "../lib/time.js";

/**
 * Call Sprint: the salesperson's calling queue for right now, most urgent
 * first — follow-ups that are due (overdue first), then fresh prospects
 * never called, then warm leads that have gone quiet. Each item carries the
 * context worth glancing at before dialling: why now, the last outcome and
 * note, and the AI's suggested next step from the last analysed call.
 */
export async function sprintQueue(user: AuthUser) {
  const { to } = dayBounds(todayLocal());
  const context = `
    c.id, c.full_name, c.designation, c.city, c.phone_key, c.temperature, c.status, c.stage, c.call_count, c.last_contacted_at,
    co.name as company_name,
    (select k.outcome from crm_calls k where k.contact_id = c.id and k.outcome is not null order by k.started_at desc limit 1) as last_outcome,
    (select a.body from crm_activities a where a.contact_id = c.id and a.kind = 'note' order by a.created_at desc limit 1) as last_note,
    (select k.analysis->'next_action'->>'action' from crm_calls k where k.contact_id = c.id and k.analysis is not null order by k.started_at desc limit 1) as ai_next,
    (select k.analysis->'improvements'->0->>'example_line' from crm_calls k where k.contact_id = c.id and k.analysis is not null order by k.started_at desc limit 1) as ai_line`;
  const callable = `c.do_not_contact = false and c.is_invalid = false and c.phone_key is not null`;

  const [due, fresh, quiet] = await Promise.all([
    db.many(
      `select 'follow_up' as reason, t.id as task_id, coalesce(nullif(t.reason, ''), t.title) as task_title, t.due_at, ${context}
       from crm_tasks t join crm_contacts c on c.id = t.contact_id left join crm_companies co on co.id = c.company_id
       where t.assigned_to = $1 and t.status = 'open' and t.due_at < $2 and ${callable}
       order by t.due_at limit 40`,
      [user.id, to],
    ),
    db.many(
      `select 'fresh' as reason, null as task_id, null as task_title, null as due_at, ${context}
       from crm_contacts c left join crm_companies co on co.id = c.company_id
       where c.owner_id = $1 and c.status in ('new','returned') and c.call_count = 0 and ${callable}
       order by c.status = 'returned' desc, c.created_at limit 40`,
      [user.id],
    ),
    db.many(
      `select 'quiet' as reason, null as task_id, null as task_title, null as due_at, ${context}
       from crm_contacts c left join crm_companies co on co.id = c.company_id
       where c.owner_id = $1 and c.status in ('outreach','follow_up') and ${callable}
         and (c.last_contacted_at is null or c.last_contacted_at < now() - interval '2 days')
         and not exists (select 1 from crm_tasks t where t.contact_id = c.id and t.status = 'open')
       order by c.temperature desc nulls last, c.last_contacted_at nulls first limit 20`,
      [user.id],
    ),
  ]);
  // One entry per prospect, in priority order.
  const seen = new Set<string>();
  const queue = [...due, ...fresh, ...quiet].filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  return { queue, counts: { follow_up: due.length, fresh: fresh.length, quiet: quiet.length } };
}
