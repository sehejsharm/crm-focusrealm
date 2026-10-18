import { db, json } from "../db/index.js";
import { publish } from "../lib/bus.js";
import { notify, notifyRoles } from "../lib/record.js";
import { dayBounds, formatDuration, todayLocal } from "../lib/time.js";
import { analyzeCall, FRAMEWORKS, synthesiseDailyReport, type CallAnalysis, type DailyReport } from "./analysis.js";
import { CONNECTED } from "./calls.js";
import { DeferJob, enqueue } from "./jobs.js";
import { getSetting } from "./settings.js";
import { transcribeCall, transcriptionConfigured } from "./transcription.js";

/**
 * The end-of-day run (the founders' sales journey):
 *  1. Every recording a salesperson made today is transcribed and analysed.
 *  2. One report per salesperson is written from those analyses + metrics.
 *  3. Each report appears in Daily Reports for the founders, sales heads and
 *     Legion, who get an in-app notification when it's ready. Nothing is
 *     emailed.
 */

export async function computeMetrics(userId: string, date: string) {
  const { from, to } = dayBounds(date);
  const calls = await db.many(
    `select k.id, k.call_code, k.outcome, k.status, k.duration_sec, k.started_at, k.recording_status, k.transcript_status,
       k.analysis_status, k.score, k.analysis, c.full_name as contact, co.name as company
     from crm_calls k join crm_contacts c on c.id = k.contact_id left join crm_companies co on co.id = c.company_id
     where k.user_id = $1 and k.started_at >= $2 and k.started_at < $3 and k.status <> 'cancelled'
     order by k.started_at`,
    [userId, from, to],
  );
  const user = await db.one(`select full_name, daily_call_target, email from crm_users where id = $1`, [userId]);
  const [tasks, flow] = await Promise.all([
    db.one(
      `select
         count(*) filter (where status = 'done' and completed_at >= $2 and completed_at < $3) as done,
         count(*) filter (where status = 'missed' and due_at >= $2 and due_at < $3) as missed,
         count(*) filter (where created_at >= $2 and created_at < $3 and kind in ('follow_up','call')) as scheduled,
         count(*) filter (where status = 'open' and due_at < $3) as overdue
       from crm_tasks where assigned_to = $1`,
      [userId, from, to],
    ),
    db.one(
      `select
         count(*) filter (where a.kind = 'status' and a.meta->>'to' = 'qualified') as qualified,
         count(*) filter (where a.kind = 'handoff' and a.title like 'Handed off%') as handoffs
       from crm_activities a where a.user_id = $1 and a.created_at >= $2 and a.created_at < $3`,
      [userId, from, to],
    ),
  ]);

  const connected = calls.filter((c) => CONNECTED.includes(c.outcome));
  const outcomes: Record<string, number> = {};
  for (const c of calls) if (c.outcome) outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
  const talk = connected.reduce((s, c) => s + (c.duration_sec ?? 0), 0);
  const analysed = calls.filter((c) => c.analysis) as any[];
  const avgScore = analysed.length ? Math.round(analysed.reduce((s, c) => s + (c.score ?? 0), 0) / analysed.length) : null;
  const frameworkAvg = Object.fromEntries(
    FRAMEWORKS.map((f) => {
      const xs = analysed.map((c) => (c.analysis as CallAnalysis).frameworks?.find((x) => x.framework === f)?.score).filter((x): x is number => typeof x === "number");
      return [f, xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null];
    }),
  );
  const metrics = {
    date,
    target: user.daily_call_target,
    calls_total: calls.length,
    connected: connected.length,
    connect_rate: calls.length ? Math.round((connected.length / calls.length) * 100) : 0,
    unique_prospects: new Set(calls.map((c) => c.contact)).size,
    talk_time_sec: talk,
    talk_time: formatDuration(talk),
    avg_connected_duration_sec: connected.length ? Math.round(talk / connected.length) : 0,
    meetings_booked: outcomes.meeting_booked ?? 0,
    interested: outcomes.interested ?? 0,
    outcomes,
    first_call_at: calls[0]?.started_at ?? null,
    last_call_at: calls.at(-1)?.started_at ?? null,
    recordings: calls.filter((c) => c.recording_status === "uploaded" || c.transcript_status === "done").length,
    recordings_missing: connected.filter((c) => c.recording_status !== "uploaded" && c.transcript_status !== "done").length,
    analysed: analysed.length,
    avg_score: avgScore,
    framework_avg: frameworkAvg,
    follow_ups_scheduled: tasks.scheduled,
    follow_ups_done: tasks.done,
    follow_ups_missed: tasks.missed,
    overdue_open: tasks.overdue,
    qualified: flow.qualified,
    handoffs: flow.handoffs,
  };
  return { user, calls, metrics };
}

/** Builds (or rebuilds) one salesperson's report for a day. */
export async function buildReport(userId: string, date: string, opts: { queuedAt?: string } = {}) {
  // Queued by the end-of-day run: wait (up to 40 minutes) for that day's
  // transcriptions and analyses, which run in parallel as their own jobs.
  if (opts.queuedAt && Date.now() - Date.parse(opts.queuedAt) < 40 * 60_000) {
    const { from, to } = dayBounds(date);
    const busy = await db.one<{ n: number }>(
      `select count(*)::int as n from crm_calls where user_id = $1 and started_at >= $2 and started_at < $3
         and (transcript_status in ('queued','processing') or analysis_status in ('queued','processing'))`,
      [userId, from, to],
    );
    if (busy.n > 0) throw new DeferJob(20);
  }
  await db.query(
    `insert into crm_daily_reports (user_id, report_date, status) values ($1, $2, 'generating')
     on conflict (user_id, report_date) do update set status = 'generating', error = null, updated_at = now()`,
    [userId, date],
  );
  try {
    // 1. Make sure every recording from the day is transcribed and analysed.
    const { from, to } = dayBounds(date);
    const pending = await db.many(
      `select id, recording_status, transcript_status, analysis_status from crm_calls
       where user_id = $1 and started_at >= $2 and started_at < $3`,
      [userId, from, to],
    );
    for (const c of pending) {
      if (c.recording_status === "uploaded" && ["queued", "none", "failed"].includes(c.transcript_status) && transcriptionConfigured()) {
        await transcribeCall(c.id).catch((e) => console.error("[reports] transcription failed", e.message));
      }
    }
    const toAnalyse = await db.many(
      `select id from crm_calls where user_id = $1 and started_at >= $2 and started_at < $3
         and transcript_status = 'done' and analysis_status in ('none','queued','failed')`,
      [userId, from, to],
    );
    for (const c of toAnalyse) await analyzeCall(c.id, { notify: false });

    // 2. Metrics + the AI-written report.
    const { user, calls, metrics } = await computeMetrics(userId, date);
    const settings = await getSetting("reports");
    if (!calls.length && settings.skipEmptyDays) {
      await db.query(
        `update crm_daily_reports set status = 'no_activity', metrics = $3::jsonb, updated_at = now() where user_id = $1 and report_date = $2`,
        [userId, date, json(metrics)],
      );
      return null;
    }
    const { report, model } = await synthesiseDailyReport({
      repName: user.full_name,
      date,
      metrics,
      calls: calls.map((c) => ({ call_code: c.call_code, outcome: c.outcome, duration_sec: c.duration_sec, contact: c.contact, company: c.company, analysis: c.analysis })),
    });
    const row = await db.one(
      `update crm_daily_reports set status = 'ready', metrics = $3::jsonb, report = $4::jsonb, model = $5, updated_at = now()
       where user_id = $1 and report_date = $2 returning id`,
      [userId, date, json(metrics), json(report), model],
    );
    publish(userId, { type: "report.ready", data: { id: row.id, date } });
    await notify(userId, "report", `Your daily report for ${date} is ready`, report.headline, `/sales/coaching`);
    await notifyRoles(["founder", "sales_head", "legion"], "report", `${user.full_name}'s daily report · ${report.grade}`, report.headline, `/founder/reports/${row.id}`, [userId]);
    return row.id as string;
  } catch (e) {
    await db.query(`update crm_daily_reports set status = 'failed', error = $3, updated_at = now() where user_id = $1 and report_date = $2`, [
      userId, date, (e as Error).message.slice(0, 1000),
    ]);
    throw e;
  }
}

/** Queue every salesperson's report for a date (the scheduler calls this). */
export async function runDailyReports(date = todayLocal(), opts: { userIds?: string[] } = {}) {
  const { from, to } = dayBounds(date);
  const people = await db.many<{ id: string }>(
    `select u.id from crm_users u where u.role in ('sales_rep','sales_head')
       and (u.status = 'active' or exists (select 1 from crm_calls k where k.user_id = u.id and k.started_at >= $1 and k.started_at < $2))
       and ($3::uuid[] is null or u.id = any($3::uuid[]))`,
    [from, to, opts.userIds?.length ? opts.userIds : null],
  );
  // 1. Every recording of the day gets transcribed and analysed — in
  //    parallel, as separate jobs.
  const ids = people.map((p) => p.id);
  let analyses = 0;
  if (ids.length) {
    const toTranscribe = await db.many<{ id: string }>(
      `select id from crm_calls where user_id = any($1::uuid[]) and started_at >= $2 and started_at < $3
         and recording_status = 'uploaded' and transcript_status in ('none','queued','failed')`,
      [ids, from, to],
    );
    for (const c of toTranscribe) {
      await db.query(`update crm_calls set transcript_status = 'queued', analysis_status = 'queued' where id = $1`, [c.id]);
      await enqueue("call.transcribe", { callId: c.id }, { dedupeKey: `transcribe:${c.id}` });
    }
    const toAnalyse = await db.many<{ id: string }>(
      `update crm_calls set analysis_status = 'queued'
       where user_id = any($1::uuid[]) and started_at >= $2 and started_at < $3
         and transcript_status = 'done' and analysis_status in ('none','failed')
       returning id`,
      [ids, from, to],
    );
    for (const c of toAnalyse) await enqueue("call.analyze", { callId: c.id }, { dedupeKey: `analyze:${c.id}` });
    analyses = toAnalyse.length + toTranscribe.length;
  }
  // 2. One report per salesperson, written once their calls are analysed.
  const queuedAt = new Date().toISOString();
  for (const p of people) {
    await enqueue("report.build", { userId: p.id, date, queuedAt }, {
      dedupeKey: `report:${p.id}:${date}`,
      runAt: new Date(Date.now() + 3000),
    });
  }
  return { date, queued: people.length, analyses };
}
