import { Router, type Response } from "express";
import { db } from "../db/index.js";
import { requireRole } from "../lib/auth.js";
import { formatPhone } from "../lib/phone.js";

/** CSV exports for founders and sales heads (opens straight in Excel / Sheets). */
export const exportsRouter = Router();
const manager = requireRole("founder", "sales_head");
const MAX_ROWS = 20000;

function cell(v: unknown) {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res: Response, name: string, header: string[], rows: unknown[][]) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  // BOM so Excel reads UTF-8 (names in Hindi etc.) correctly.
  res.send("﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"));
}

const stamp = () => new Date().toISOString().slice(0, 10);

exportsRouter.get("/export/prospects.csv", manager, async (_req, res) => {
  const rows = await db.many(
    `select c.full_name, c.designation, co.name as company, c.phone_key, c.email, c.city, c.campaign, c.segment, c.source,
       c.stage, c.status, c.temperature, c.last_call_outcome, c.last_contacted_at, c.call_count, c.next_action_at,
       o.full_name as owner, o.employee_code as owner_code, c.do_not_contact, c.created_at
     from crm_contacts c left join crm_companies co on co.id = c.company_id left join crm_users o on o.id = c.owner_id
     order by c.created_at limit ${MAX_ROWS}`,
  );
  sendCsv(
    res,
    `focus-realm-prospects-${stamp()}.csv`,
    ["Name", "Designation", "Company", "Phone", "Email", "City", "Campaign", "Segment", "Source", "Stage", "Status", "Temperature", "Last outcome", "Last contacted", "Calls", "Next action", "Owner", "Owner ID", "Do not contact", "Created"],
    rows.map((r) => [r.full_name, r.designation, r.company, formatPhone(r.phone_key), r.email, r.city, r.campaign, r.segment, r.source, r.stage, r.status, r.temperature, r.last_call_outcome, r.last_contacted_at, r.call_count, r.next_action_at, r.owner, r.owner_code, r.do_not_contact ? "yes" : "", r.created_at]),
  );
});

exportsRouter.get("/export/calls.csv", manager, async (req, res) => {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400_000);
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date();
  const rows = await db.many(
    `select k.call_code, k.started_at, u.full_name as rep, u.employee_code, c.full_name as prospect, co.name as company, k.mode, k.outcome,
       k.duration_sec, k.score, k.recording_status, k.analysis_status, k.analysis->>'summary' as summary, k.notes
     from crm_calls k join crm_users u on u.id = k.user_id join crm_contacts c on c.id = k.contact_id left join crm_companies co on co.id = c.company_id
     where k.started_at >= $1 and k.started_at < $2 order by k.started_at limit ${MAX_ROWS}`,
    [from, to],
  );
  sendCsv(
    res,
    `focus-realm-calls-${stamp()}.csv`,
    ["Call ID", "Started", "Salesperson", "Employee ID", "Prospect", "Company", "Mode", "Outcome", "Duration (s)", "AI score", "Recording", "Analysis", "AI summary", "Notes"],
    rows.map((r) => [r.call_code, r.started_at, r.rep, r.employee_code, r.prospect, r.company, r.mode, r.outcome, r.duration_sec, r.score, r.recording_status, r.analysis_status, r.summary, r.notes]),
  );
});

exportsRouter.get("/export/reports.csv", manager, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const rows = await db.many(
    `select r.report_date, u.full_name, u.employee_code, r.report->>'grade' as grade, (r.report->>'overall_score')::int as score,
       r.metrics, r.report->>'headline' as headline, r.report->>'executive_summary' as summary, r.emailed_at
     from crm_daily_reports r join crm_users u on u.id = r.user_id
     where r.report_date >= $1::date and r.report is not null order by r.report_date desc, u.full_name limit ${MAX_ROWS}`,
    [from],
  );
  sendCsv(
    res,
    `focus-realm-daily-reports-${stamp()}.csv`,
    ["Date", "Salesperson", "Employee ID", "Grade", "Score", "Calls", "Connected", "Connect %", "Talk time (min)", "Meetings booked", "Analysed calls", "Headline", "Summary", "Emailed"],
    rows.map((r) => [r.report_date, r.full_name, r.employee_code, r.grade, r.score, r.metrics?.calls_total, r.metrics?.connected, r.metrics?.connect_rate, Math.round((r.metrics?.talk_time_sec ?? 0) / 60), r.metrics?.meetings_booked, r.metrics?.analysed, r.headline, r.summary, r.emailed_at]),
  );
});
