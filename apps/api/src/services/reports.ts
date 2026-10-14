import { db, json } from "../db/index.js";
import { env } from "../env.js";
import { publish } from "../lib/bus.js";
import { audit, notify } from "../lib/record.js";
import { dayBounds, formatDuration, todayLocal } from "../lib/time.js";
import { analyzeCall, FRAMEWORKS, synthesiseDailyReport, type CallAnalysis, type DailyReport } from "./analysis.js";
import { CONNECTED } from "./calls.js";
import { sendMail } from "./email.js";
import { DeferJob, enqueue } from "./jobs.js";
import { getSetting } from "./settings.js";
import { transcribeCall, transcriptionConfigured } from "./transcription.js";

/**
 * The end-of-day run (the founders' sales journey):
 *  1. Every recording a salesperson made today is transcribed and analysed.
 *  2. One report per salesperson is written from those analyses + metrics.
 *  3. Each report is emailed to the sales heads, the CEO and COO (founders)
 *     and anyone else the founders have added as a recipient.
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
export async function buildReport(userId: string, date: string, opts: { email?: boolean; queuedAt?: string } = {}) {
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
    if (opts.email !== false) await enqueue("report.email", { reportId: row.id }, { dedupeKey: `email:${row.id}` });
    return row.id as string;
  } catch (e) {
    await db.query(`update crm_daily_reports set status = 'failed', error = $3, updated_at = now() where user_id = $1 and report_date = $2`, [
      userId, date, (e as Error).message.slice(0, 1000),
    ]);
    throw e;
  }
}

/** Everyone a report goes to: founders + sales heads + the founders' list (+ the rep, if enabled). */
export async function reportRecipients(repUserId?: string) {
  const s = await getSetting("reports");
  const people = await db.many<{ email: string; role: string }>(
    `select email, role from crm_users where status = 'active' and email is not null and email <> ''
       and ((role = 'founder' and $1) or (role = 'sales_head' and $2) or (id = $3 and $4))`,
    [s.includeFounders, s.includeSalesHeads, repUserId ?? null, s.sendRepCopy],
  );
  const extra = await db.many<{ email: string }>(`select email from crm_report_recipients where active`);
  const all = [...people.map((p) => p.email), ...extra.map((e) => e.email)];
  return [...new Map(all.map((e) => [e.toLowerCase(), e])).values()];
}

export async function emailReport(reportId: string) {
  const r = await db.maybe(
    `select r.*, u.full_name, u.employee_code, u.title from crm_daily_reports r join crm_users u on u.id = r.user_id where r.id = $1`,
    [reportId],
  );
  if (!r || !r.report) return;
  const to = await reportRecipients(r.user_id);
  if (!to.length) {
    await db.query(`update crm_daily_reports set error = 'No recipients configured' where id = $1`, [reportId]);
    return;
  }
  const html = renderReportEmail(r);
  const res = await sendMail({
    to,
    subject: `Daily sales report · ${r.full_name} · ${r.report_date} · ${r.report.grade}`,
    html,
    text: `${r.report.headline}\n\n${r.report.executive_summary}\n\nOpen the full report: ${env.appUrl}/founder/reports/${r.id}`,
  });
  await db.query(
    `update crm_daily_reports set status = 'emailed', emailed_to = $2::text[], emailed_at = now(),
       error = $3 where id = $1`,
    [reportId, to, res.delivered ? null : `SMTP not configured — saved to outbox (${res.file})`],
  );
  await audit(null, "report.emailed", "daily_report", reportId, { to, via: res.via });
}

/** Queue every salesperson's report for a date (the scheduler calls this). */
export async function runDailyReports(date = todayLocal(), opts: { userIds?: string[]; email?: boolean } = {}) {
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
    await enqueue("report.build", { userId: p.id, date, email: opts.email !== false, queuedAt }, {
      dedupeKey: `report:${p.id}:${date}`,
      runAt: new Date(Date.now() + 3000),
    });
  }
  return { date, queued: people.length, analyses };
}

// --------------------------------------------------------------- the email

const esc = (s: unknown) =>
  String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

function bar(value: number, max = 10) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = pct >= 70 ? "#0f9d6b" : pct >= 50 ? "#1a6ae0" : pct >= 35 ? "#c27a06" : "#d93a4a";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
    <td style="background:#eef2f8;border-radius:6px;height:8px;padding:0"><div style="width:${pct}%;height:8px;border-radius:6px;background:${color}"></div></td>
  </tr></table>`;
}

function list(items: string[] | undefined, color = "#1a6ae0") {
  if (!items?.length) return `<p style="margin:0;color:#8492a7;font-size:14px">—</p>`;
  return items.map((i) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#0a1426"><span style="color:${color};font-weight:700">●</span>&nbsp; ${esc(i)}</p>`).join("");
}

function section(title: string, body: string) {
  return `<tr><td style="padding:22px 32px 4px"><p style="margin:0 0 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#1655c0">${esc(title)}</p>${body}</td></tr>`;
}

export function renderReportEmail(r: { id: string; full_name: string; employee_code: string; report_date: string; metrics: any; report: DailyReport; model?: string }) {
  const m = r.metrics;
  const rep = r.report;
  const kpi = (label: string, value: string) =>
    `<td width="25%" style="padding:6px"><div style="background:#f5f8fd;border:1px solid #e3e8f0;border-radius:14px;padding:14px 12px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#0a1426">${esc(value)}</div>
      <div style="font-size:11px;color:#4b5a72;margin-top:4px;text-transform:uppercase;letter-spacing:.06em">${esc(label)}</div></div></td>`;
  const frameworks = (rep.framework_breakdown ?? [])
    .map((f) => `<tr><td style="padding:6px 0;font-size:13px;color:#0a1426;width:120px">${esc(f.framework)}</td><td style="padding:6px 10px">${bar(f.score)}</td><td style="padding:6px 0;font-size:13px;font-weight:700;color:#0a1426;width:36px;text-align:right">${Number(f.score).toFixed(1)}</td></tr>
      <tr><td></td><td colspan="2" style="padding:0 10px 8px;font-size:12px;color:#4b5a72">${esc(f.comment)}</td></tr>`)
    .join("");
  const coaching = (rep.coaching_plan ?? [])
    .map((c) => `<div style="border:1px solid #dcebfe;background:#f5f9ff;border-radius:14px;padding:14px 16px;margin-bottom:10px">
      <div style="font-size:14px;font-weight:700;color:#0a1426">${esc(c.focus)}</div>
      <div style="font-size:13px;color:#4b5a72;margin-top:4px">${esc(c.drill)}</div>
      <div style="font-size:13px;color:#1655c0;margin-top:8px;font-style:italic">${esc(c.example_line)}</div></div>`)
    .join("");
  const objections = (rep.objection_summary ?? [])
    .map((o) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 10px;border-radius:999px;background:#eaf3ff;color:#1655c0;font-size:12px;font-weight:600">${esc(o.category.replace(/_/g, " "))} × ${o.count} · ${esc(o.handling)}</span>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(rep.headline)}</title></head>
<body style="margin:0;padding:0;background:#eef2f8;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(10,20,38,.08)">
  <tr><td style="background:linear-gradient(135deg,#0b2a66 0%,#1655c0 55%,#2f86f0 100%);background-color:#1655c0;padding:28px 32px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${env.appUrl}/brand/focus-realm-mark.png" width="40" height="40" alt="Focus Realm" style="display:block;border-radius:10px;background:#fff;padding:4px"></td>
      <td align="right" style="color:#cfe3ff;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Daily Sales Report<br><span style="color:#fff;font-weight:700">${esc(r.report_date)}</span></td>
    </tr></table>
    <p style="margin:22px 0 4px;color:#cfe3ff;font-size:13px">${esc(r.full_name)} · ${esc(r.employee_code)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="color:#ffffff;font-size:22px;font-weight:800;line-height:1.3">${esc(rep.headline)}</td>
      <td width="84" align="right" valign="top"><div style="width:72px;height:72px;border-radius:20px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);text-align:center">
        <div style="font-size:28px;font-weight:900;color:#fff;line-height:50px">${esc(rep.grade)}</div><div style="font-size:11px;color:#cfe3ff;margin-top:-10px">${rep.overall_score}/100</div></div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:18px 26px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    ${kpi("Calls", `${m.calls_total}/${m.target}`)}${kpi("Connected", `${m.connected} · ${m.connect_rate}%`)}${kpi("Talk time", m.talk_time)}${kpi("Meetings", String(m.meetings_booked))}
  </tr></table></td></tr>
  ${section("Executive summary", `<p style="margin:0;font-size:15px;line-height:1.6;color:#0a1426">${esc(rep.executive_summary)}</p>`)}
  <tr><td style="padding:12px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="50%" valign="top" style="padding-right:10px"><p style="margin:0 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#0f9d6b">Wins</p>${list(rep.wins, "#0f9d6b")}</td>
    <td width="50%" valign="top" style="padding-left:10px"><p style="margin:0 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#d93a4a">Concerns</p>${list(rep.concerns, "#d93a4a")}</td>
  </tr></table></td></tr>
  ${section("How they spoke", `<p style="margin:0;font-size:14px;line-height:1.6;color:#0a1426">${esc(rep.communication)}</p>`)}
  ${section("How they handled conversations", `<p style="margin:0;font-size:14px;line-height:1.6;color:#0a1426">${esc(rep.conversation_handling)}</p>`)}
  ${section("How prospects responded", `<p style="margin:0;font-size:14px;line-height:1.6;color:#0a1426">${esc(rep.prospect_response)}</p>`)}
  ${section("Sales frameworks", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${frameworks}</table>`)}
  ${objections ? section("Objections heard", objections) : ""}
  ${section("Best & toughest call", `<p style="margin:0 0 8px;font-size:14px;color:#0a1426"><b style="color:#0f9d6b">${esc(rep.best_call?.call_code)}</b> — ${esc(rep.best_call?.why)}</p><p style="margin:0;font-size:14px;color:#0a1426"><b style="color:#d93a4a">${esc(rep.toughest_call?.call_code)}</b> — ${esc(rep.toughest_call?.why)}</p>`)}
  ${section("Coaching plan for tomorrow", coaching || list([]))}
  ${rep.product_feedback?.length ? section("Product feedback from prospects", list(rep.product_feedback)) : ""}
  ${section("Actions for the sales head", list(rep.manager_actions))}
  <tr><td style="padding:24px 32px 30px" align="center">
    <a href="${env.appUrl}/founder/reports/${r.id}" style="display:inline-block;background:#1a6ae0;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:12px">Open the full report & recordings</a>
    <p style="margin:18px 0 0;font-size:11px;color:#8492a7">${m.analysed} of ${m.calls_total} calls analysed${r.model ? ` · ${esc(r.model === "demo-heuristic" ? "demo analysis (no AI key)" : r.model)}` : ""} · Focus Realm CRM</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}
