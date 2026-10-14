import cron from "node-cron";
import { db, json } from "../db/index.js";
import { pruneEvents } from "../lib/bus.js";
import { drain } from "./jobs.js";
import { env } from "../env.js";
import { todayLocal } from "../lib/time.js";
import { runDailyReports } from "./reports.js";
import { getSetting } from "./settings.js";
import { storage } from "./storage.js";
import { escalateOverdue, sendDueReminders } from "./tasks.js";

/**
 * Time-based work: task reminders every minute, overdue escalation, the
 * end-of-day report run at the founders' chosen time (IST by default), and
 * recording retention. Runs in-process; set IN_PROCESS_SCHEDULER=false and
 * call /api/cron/* instead when an external scheduler is preferred.
 */

async function state(): Promise<{ lastReportDate?: string; lastRetention?: string }> {
  const r = await db.maybe(`select value from crm_settings where key = '_scheduler'`);
  return (r?.value as any) ?? {};
}

async function saveState(s: Record<string, unknown>) {
  await db.query(
    `insert into crm_settings (key, value) values ('_scheduler', $1::jsonb)
     on conflict (key) do update set value = crm_settings.value || excluded.value, updated_at = now()`,
    [json(s)],
  );
}

function localHHMM(tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

export async function maybeRunDailyReports(opts: { ignoreTime?: boolean } = {}) {
  const s = await getSetting("reports");
  if (!s.enabled) return null;
  const today = todayLocal(new Date(), s.timezone);
  const st = await state();
  if (st.lastReportDate === today) return null;
  if (!opts.ignoreTime && localHHMM(s.timezone) < s.time) return null;
  await saveState({ lastReportDate: today });
  console.log(`[scheduler] end-of-day run for ${today}`);
  return runDailyReports(today);
}

async function retention() {
  const t = await getSetting("telephony");
  if (!t.retentionDays) return 0;
  const old = await db.many(
    `select id, recording_path from crm_calls where recording_path is not null and started_at < now() - make_interval(days => $1::int) limit 500`,
    [t.retentionDays],
  );
  for (const c of old) {
    await storage.remove(c.recording_path).catch(() => {});
    await db.query(`update crm_calls set recording_path = null, recording_status = 'unavailable' where id = $1`, [c.id]);
  }
  return old.length;
}

export async function runMaintenance() {
  const reminders = await sendDueReminders();
  const escalated = await escalateOverdue();
  const report = await maybeRunDailyReports();
  const st = await state();
  let removed = 0;
  const today = todayLocal();
  if (st.lastRetention !== today) {
    removed = await retention();
    await pruneEvents();
    await saveState({ lastRetention: today });
  }
  return { reminders, escalated, report, recordingsRemoved: removed };
}

let lastNudge = 0;

/**
 * Serverless stand-in for the minute-by-minute clock: called (throttled to
 * once a minute per instance, and once a minute across instances) whenever
 * someone uses the CRM. Sends due reminders, runs the end-of-day reports if
 * their time has passed, and works through any queued jobs.
 */
export async function opportunisticMaintenance() {
  if (Date.now() - lastNudge < 60_000) return;
  lastNudge = Date.now();
  const claimed = await db.maybe(
    `insert into crm_settings (key, value) values ('_nudge', '{}'::jsonb)
     on conflict (key) do update set updated_at = now() where crm_settings.updated_at < now() - interval '60 seconds'
     returning key`,
  );
  if (!claimed) return;
  await sendDueReminders();
  await maybeRunDailyReports();
  await drain({ budgetMs: 120_000, concurrency: 3 });
}

export function startScheduler() {
  if (!env.inProcessScheduler) return;
  cron.schedule("* * * * *", () => {
    sendDueReminders().catch((e) => console.error("[scheduler] reminders", e));
    maybeRunDailyReports().catch((e) => console.error("[scheduler] daily reports", e));
  });
  cron.schedule("*/15 * * * *", () => {
    escalateOverdue().catch((e) => console.error("[scheduler] escalation", e));
  });
  cron.schedule("30 3 * * *", () => {
    retention().catch((e) => console.error("[scheduler] retention", e));
  }, { timezone: env.timezone });
}
