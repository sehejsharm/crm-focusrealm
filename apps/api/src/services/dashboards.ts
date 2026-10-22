import { db } from "../db/index.js";
import type { AuthUser } from "../lib/auth.js";
import { addDays, dayBounds, todayLocal } from "../lib/time.js";
import { ACTIVE_STATUSES } from "./allocation.js";
import { CONNECTED } from "./calls.js";
import { STALE_SQL } from "./contacts.js";
import { getSetting } from "./settings.js";

const connectedList = `(${CONNECTED.map((c) => `'${c}'`).join(",")})`;

/** The salesperson's "My Day". */
export async function repDashboard(user: AuthUser) {
  const today = todayLocal();
  const { from, to } = dayBounds(today);
  const weekStart = dayBounds(addDays(today, -6)).from;
  const [kpi, tasks, fresh, recent, coaching, trend, streak, rank] = await Promise.all([
    db.one(
      `select
         count(*) filter (where started_at >= $2) as calls_today,
         count(*) filter (where started_at >= $2 and outcome in ${connectedList}) as connected_today,
         coalesce(sum(duration_sec) filter (where started_at >= $2 and outcome in ${connectedList}), 0) as talk_today,
         count(*) filter (where started_at >= $2 and outcome = 'meeting_booked') as meetings_today,
         round(avg(score) filter (where started_at >= $4 and score is not null)) as avg_score_week
       from crm_calls where user_id = $1 and started_at >= $4 and started_at < $3`,
      [user.id, from, to, weekStart],
    ),
    db.many(
      `select t.*, c.full_name as contact_name, c.phone_key as contact_phone, co.name as company_name
       from crm_tasks t left join crm_contacts c on c.id = t.contact_id left join crm_companies co on co.id = c.company_id
       where t.assigned_to = $1 and t.status = 'open' and (t.due_at is null or t.due_at < $2)
       order by t.due_at asc nulls last limit 30`,
      [user.id, to],
    ),
    db.many(
      `select c.id, c.full_name, c.designation, c.city, c.segment, c.campaign, c.phone_key, c.temperature, c.status, co.name as company_name, c.created_at
       from crm_contacts c left join crm_companies co on co.id = c.company_id
       where c.owner_id = $1 and c.status in ('new','returned') order by c.updated_at desc limit 12`,
      [user.id],
    ),
    db.many(
      `select k.id, k.call_code, k.outcome, k.started_at, k.duration_sec, k.score, k.analysis_status, c.full_name as contact_name, co.name as company_name
       from crm_calls k join crm_contacts c on c.id = k.contact_id left join crm_companies co on co.id = c.company_id
       where k.user_id = $1 order by k.started_at desc limit 8`,
      [user.id],
    ),
    db.maybe(
      `select k.id, k.call_code, k.score, k.analysis->'improvements'->0 as tip, k.analysis->'strengths'->0 as strength, c.full_name as contact_name
       from crm_calls k join crm_contacts c on c.id = k.contact_id
       where k.user_id = $1 and k.analysis is not null order by k.analyzed_at desc nulls last limit 1`,
      [user.id],
    ),
    dailySeries(user.id, 14),
    db.one(
      `select count(*) as active, count(*) filter (where stage = 'qualified') as qualified,
         count(*) filter (where stage in ('legion_meet_1','legion_meet_2','legion_meet_3')) as with_legion
       from crm_contacts where owner_id = $1 and status not in ('closed_lost','disqualified')`,
      [user.id],
    ),
    db.many(
      `select u.id, u.full_name, u.avatar_hue, count(k.id)::int as calls,
         count(k.id) filter (where k.outcome = 'meeting_booked')::int as meetings, round(avg(k.score))::int as avg_score
       from crm_users u left join crm_calls k on k.user_id = u.id and k.started_at >= $1
       where u.role in ('sales_rep','sales_head') and u.status = 'active'
       group by u.id order by meetings desc, calls desc limit 10`,
      [weekStart],
    ),
  ]);
  return { today, target: user.daily_call_target, kpi, tasks, fresh, recent, coaching, trend, pipeline: streak, leaderboard: rank };
}

/** Calls & connects per day for the last N days (sparklines and trend charts). */
export async function dailySeries(userId: string | null, days: number) {
  const today = todayLocal();
  const start = dayBounds(addDays(today, -(days - 1))).from;
  const rows = await db.many(
    `select to_char(started_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, count(*)::int as calls,
       count(*) filter (where outcome in ${connectedList})::int as connected,
       count(*) filter (where outcome = 'meeting_booked')::int as meetings,
       round(avg(score))::int as score
     from crm_calls where started_at >= $1 and ($2::uuid is null or user_id = $2) group by 1 order by 1`,
    [start, userId],
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, -(days - 1) + i);
    return byDay.get(day) ?? { day, calls: 0, connected: 0, meetings: 0, score: null };
  });
}

/** Team pulse for sales heads, founders and Legion: everyone's day at a glance. */
export async function teamDashboard(date = todayLocal()) {
  const { from, to } = dayBounds(date);
  const people = await db.many(
    `select u.id, u.full_name, u.employee_code, u.role, u.title, u.avatar_hue, u.daily_call_target, u.last_active_at, u.status, u.source,
       count(k.id)::int as calls,
       count(k.id) filter (where k.outcome in ${connectedList})::int as connected,
       coalesce(sum(k.duration_sec) filter (where k.outcome in ${connectedList}), 0)::int as talk_sec,
       count(k.id) filter (where k.outcome = 'meeting_booked')::int as meetings,
       round(avg(k.score))::int as avg_score,
       max(k.started_at) as last_call_at,
       (select count(*) from crm_contacts c where c.owner_id = u.id and c.status in ${ACTIVE_STATUSES})::int as active_prospects,
       (select count(*) from crm_tasks t where t.assigned_to = u.id and t.status = 'open' and t.due_at < now())::int as overdue,
       (select r.id from crm_daily_reports r where r.user_id = u.id and r.report_date = $3) as report_id,
       (select r.report->>'grade' from crm_daily_reports r where r.user_id = u.id and r.report_date = $3) as report_grade,
       exists (select 1 from crm_calls l where l.user_id = u.id and l.status in ('initiated','ringing','in_progress')
               and l.outcome is null and l.started_at > now() - interval '30 minutes') as on_call
     from crm_users u left join crm_calls k on k.user_id = u.id and k.started_at >= $1 and k.started_at < $2
     where u.role in ('sales_rep','sales_head') and u.status = 'active'
     group by u.id order by calls desc, u.full_name`,
    [from, to, date],
  );
  const totals = people.reduce(
    (a, p) => ({ calls: a.calls + p.calls, connected: a.connected + p.connected, meetings: a.meetings + p.meetings, talk_sec: a.talk_sec + p.talk_sec }),
    { calls: 0, connected: 0, meetings: 0, talk_sec: 0 },
  );
  const feed = await db.many(
    `select a.id, a.kind, a.title, a.body, a.created_at, a.contact_id, u.full_name as user_name, u.avatar_hue, c.full_name as contact_name
     from crm_activities a left join crm_users u on u.id = a.user_id left join crm_contacts c on c.id = a.contact_id
     order by a.created_at desc limit 40`,
  );
  return { date, people, totals, feed, series: await dailySeries(null, 14) };
}

/** Founder command centre: funnel, conversion, bottlenecks, intelligence. */
export async function founderDashboard() {
  const today = todayLocal();
  const monthStart = dayBounds(addDays(today, -29)).from;
  const [funnel, statusCounts, byCampaign, bySegment, byRep, overdue, unassigned, objectionTrend, productFeedback, frameworkAvg, rates, jobs, meetingsUpcoming, handoffsPending] = await Promise.all([
    db.many(`select stage, count(*)::int as count from crm_contacts where status not in ('disqualified') group by stage`),
    db.many(`select status, count(*)::int as count from crm_contacts group by status`),
    db.many(
      `select coalesce(nullif(campaign, ''), 'No campaign') as name, count(*)::int as total,
         count(*) filter (where stage <> 'prospect')::int as qualified_plus,
         count(*) filter (where stage in ('legion_meet_1','legion_meet_2','legion_meet_3'))::int as legion,
         count(*) filter (where status = 'closed_won')::int as won
       from crm_contacts group by 1 order by total desc limit 12`,
    ),
    db.many(
      `select coalesce(segment, '—') as name, count(*)::int as total,
         count(*) filter (where stage <> 'prospect')::int as qualified_plus,
         count(*) filter (where status = 'closed_won')::int as won
       from crm_contacts group by 1 order by total desc limit 12`,
    ),
    db.many(
      `select u.id, u.full_name, u.avatar_hue,
         (select count(*) from crm_calls k where k.user_id = u.id and k.started_at >= $1)::int as calls,
         (select count(*) from crm_calls k where k.user_id = u.id and k.started_at >= $1 and k.outcome in ${connectedList})::int as connected,
         (select round(avg(score)) from crm_calls k where k.user_id = u.id and k.started_at >= $1)::int as avg_score,
         (select count(*) from crm_contacts c where c.owner_id = u.id and c.stage <> 'prospect')::int as qualified_plus,
         (select count(*) from crm_contacts c where c.owner_id = u.id)::int as owned
       from crm_users u where u.role in ('sales_rep','sales_head') and u.status = 'active' order by calls desc`,
      [monthStart],
    ),
    db.one(`select count(*)::int as n from crm_tasks where status = 'open' and due_at < now()`),
    db.one(`select count(*)::int as n from crm_contacts where owner_id is null and stage = 'prospect' and not do_not_contact and not is_invalid`),
    db.many(
      `select category, count(*)::int as count, count(*) filter (where handled = 'well')::int as handled_well
       from crm_call_insights where kind = 'objection' and created_at >= $1 group by category order by count desc`,
      [monthStart],
    ),
    db.many(
      `select i.text, i.kind, i.created_at, c.full_name as contact_name, co.name as company_name, u.full_name as user_name, i.call_id
       from crm_call_insights i left join crm_contacts c on c.id = i.contact_id left join crm_companies co on co.id = c.company_id
       left join crm_users u on u.id = i.user_id
       where i.kind in ('product_request','pain_point') and i.created_at >= $1 order by i.created_at desc limit 30`,
      [monthStart],
    ),
    db.many(
      `select f->>'framework' as framework, round(avg((f->>'score')::numeric), 1) as score, count(*)::int as n
       from crm_calls k, jsonb_array_elements(k.analysis->'frameworks') f
       where k.analysis is not null and k.started_at >= $1 group by 1 order by 2 desc`,
      [monthStart],
    ),
    db.one(
      `select count(*)::int as calls,
         count(*) filter (where outcome in ${connectedList})::int as connected,
         count(*) filter (where analysis->'prospect'->>'decision_maker' = 'yes')::int as decision_maker_reached,
         count(*) filter (where analysis is not null)::int as analysed,
         count(*) filter (where outcome = 'meeting_booked')::int as meetings
       from crm_calls where started_at >= $1`,
      [monthStart],
    ),
    db.many(`select kind, status, count(*)::int as count from crm_jobs where status in ('queued','failed','running') group by kind, status`),
    db.many(
      `select m.id, m.stage, m.scheduled_at, m.contact_id, c.full_name as contact_name, co.name as company_name, l.full_name as legion_name
       from crm_meetings m join crm_contacts c on c.id = m.contact_id left join crm_companies co on co.id = c.company_id
       left join crm_users l on l.id = m.legion_user_id where m.status = 'scheduled' and m.scheduled_at >= now() order by m.scheduled_at limit 30`,
    ),
    db.one(`select count(*)::int as n from crm_handoffs where status = 'pending'`),
  ]);
  const { staleDays, autoEnabled } = await getSetting("allocation");
  // The same 30 days before, for the trend arrows.
  const prevRates = await db.one(
    `select count(*)::int as calls, count(*) filter (where outcome in ${connectedList})::int as connected,
       count(*) filter (where outcome = 'meeting_booked')::int as meetings,
       count(*) filter (where analysis->'prospect'->>'decision_maker' = 'yes')::int as decision_maker_reached,
       count(*) filter (where analysis is not null)::int as analysed
     from crm_calls where started_at >= $1 and started_at < $2`,
    [new Date(monthStart.getTime() - 30 * 86400_000), monthStart],
  );
  // What a founder should look at today, in one place.
  const attention = await db.one(
    `select
       (select count(*) from crm_calls where analysis_status = 'needs_review')::int as reviews,
       (select count(*) from crm_calls where mode <> 'demo' and recording_status in ('none','awaiting','failed')
          and outcome in ${connectedList} and started_at > now() - interval '7 days')::int as missing_recordings,
       (select count(*) from crm_daily_reports where status = 'failed' and report_date >= current_date - 2)::int as failed_reports,
       (select count(*) from crm_jobs where status = 'failed')::int as failed_jobs`,
  );
  const stale = await db.one<{ n: number }>(`select count(*)::int as n from crm_contacts c where ${STALE_SQL.replace("$STALE", "$1")}`, [staleDays]);
  const followUpCompliance = await db.one(
    `select count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'missed')::int as missed
     from crm_tasks where due_at >= $1 and due_at < now()`,
    [monthStart],
  );
  return {
    funnel, statusCounts, byCampaign, bySegment, byRep, overdue: overdue.n, unassigned: unassigned.n,
    objectionTrend, productFeedback, frameworkAvg, rates, followUpCompliance, jobs, meetingsUpcoming,
    handoffsPending: handoffsPending.n, stale: stale.n, staleDays, series: await dailySeries(null, 30),
    prevRates, attention: { ...attention, autoTopUp: autoEnabled },
  };
}

/** Legion portal: their pipeline, meetings, inbox, and the sales team's work. */
export async function legionDashboard(user: AuthUser) {
  const [pipeline, handoffs, meetings, team, mine, won] = await Promise.all([
    db.many(`select stage, count(*)::int as count from crm_contacts where stage in ('qualified','legion_meet_1','legion_meet_2','legion_meet_3') and status not in ('closed_lost') group by stage`),
    db.many(
      `select h.*, c.full_name as contact_name, c.designation, c.temperature, co.name as company_name, f.full_name as from_name, f.avatar_hue as from_hue
       from crm_handoffs h join crm_contacts c on c.id = h.contact_id left join crm_companies co on co.id = c.company_id
       left join crm_users f on f.id = h.from_user_id where h.status = 'pending' order by h.created_at`,
    ),
    db.many(
      `select m.*, c.full_name as contact_name, co.name as company_name, s.full_name as sales_name
       from crm_meetings m join crm_contacts c on c.id = m.contact_id left join crm_companies co on co.id = c.company_id
       left join crm_users s on s.id = m.sales_user_id
       where m.status = 'scheduled' and m.scheduled_at >= now() - interval '2 hours' order by m.scheduled_at limit 40`,
    ),
    teamDashboard(),
    db.one(
      `select count(*) filter (where status = 'closed_won')::int as won, count(*) filter (where status = 'closed_lost')::int as lost,
         count(*) filter (where stage in ('legion_meet_1','legion_meet_2','legion_meet_3') and status = 'handed_off')::int as open
       from crm_contacts where legion_owner_id = $1`,
      [user.id],
    ),
    db.one(
      `select count(*) filter (where status = 'closed_won')::int as total,
         count(*) filter (where status = 'closed_won' and updated_at > now() - interval '30 days')::int as month
       from crm_contacts`,
    ),
  ]);
  return { pipeline, handoffs, meetings, team, mine, won };
}

export async function objectionInsights(days = 30) {
  const since = dayBounds(addDays(todayLocal(), -(days - 1))).from;
  const [byCategory, examples, byRep] = await Promise.all([
    db.many(
      `select category, count(*)::int as count,
         count(*) filter (where handled = 'well')::int as well,
         count(*) filter (where handled = 'partially')::int as partially,
         count(*) filter (where handled = 'poorly')::int as poorly
       from crm_call_insights where kind = 'objection' and created_at >= $1 group by category order by count desc`,
      [since],
    ),
    db.many(
      `select i.category, i.text, i.evidence as better_response, i.handled, i.call_id, u.full_name as user_name, c.full_name as contact_name, i.created_at
       from crm_call_insights i left join crm_users u on u.id = i.user_id left join crm_contacts c on c.id = i.contact_id
       where i.kind = 'objection' and i.created_at >= $1 order by i.created_at desc limit 60`,
      [since],
    ),
    db.many(
      `select u.full_name, i.category, count(*)::int as count, count(*) filter (where i.handled = 'well')::int as well
       from crm_call_insights i join crm_users u on u.id = i.user_id
       where i.kind = 'objection' and i.created_at >= $1 group by u.full_name, i.category order by u.full_name`,
      [since],
    ),
  ]);
  const signals = await db.many(
    `select kind, text, call_id, created_at from crm_call_insights where kind in ('product_request','pain_point','buying_signal','competitor')
     and created_at >= $1 order by created_at desc limit 80`,
    [since],
  );
  return { byCategory, examples, byRep, signals };
}
