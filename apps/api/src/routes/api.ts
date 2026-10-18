import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db/index.js";
import { hashPassword, isManager, nextLoginId, requireRole, temporaryPassword, USER_COLUMNS } from "../lib/auth.js";
import { badRequest, forbidden, notFound, parse, zId, zIsoDate, zPage } from "../lib/http.js";
import { phoneKey } from "../lib/phone.js";
import { activity, audit } from "../lib/record.js";
import { todayLocal } from "../lib/time.js";
import { inactivityFlags, previewAllocation, reassignContact, runAllocation } from "../services/allocation.js";
import {
  attachRecording, recordingsInbox, callDetail, completeRecordingUpload, listCalls, logOutcome, OUTCOMES, recordingPlaybackUrl, recordingUploadTarget,
  reviewCall, startCall, streamRecording, updateCallStatus,
} from "../services/calls.js";
import {
  addNote, canView, changeStatus, closeContact, contactDetail, createContact, decideHandoff, facets, getContactRow, importContacts, listContacts,
  moveStage, STAGES, STATUSES, submitHandoff, updateContact,
} from "../services/contacts.js";
import { founderDashboard, legionDashboard, objectionInsights, repDashboard, teamDashboard } from "../services/dashboards.js";
import { enqueue, jobStats, retryFailed } from "../services/jobs.js";
import { listMeetings, scheduleMeeting, updateMeeting } from "../services/meetings.js";
import { buildReport, runDailyReports } from "../services/reports.js";
import { getAllSettings, getSetting, putSetting, settingSchemas, type SettingKey } from "../services/settings.js";
import { hrStatus } from "../services/hr.js";
import { sprintQueue } from "../services/sprint.js";
import { createTask, listTasks, updateTask } from "../services/tasks.js";

export const api = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
const manager = requireRole("founder", "sales_head");
const founder = requireRole("founder");

// ------------------------------------------------------------------ people

api.get("/users", async (req, res) => {
  const role = typeof req.query.role === "string" ? req.query.role : null;
  const rows = await db.many(
    `select ${USER_COLUMNS}, last_login_at, last_active_at, created_at, hr_external_id is not null as from_hr, max_active_prospects,
       (select count(*) from crm_contacts c where c.owner_id = u.id and c.status not in ('closed_won','closed_lost','disqualified','handed_off'))::int as active_prospects
     from crm_users u where ($1::text is null or role = $1) order by status, role, full_name`,
    [role],
  );
  res.json({ users: req.user!.role === "sales_rep" ? rows.filter((r) => r.status === "active").map(({ email, phone, ...r }) => r) : rows });
});

api.post("/users", founder, async (req, res) => {
  const body = parse(
    z.object({
      full_name: z.string().min(2),
      // Founders, sales heads and the sales team: their FR number from
      // Workspace. Legion are never on Workspace: left empty, they get LG-####.
      employee_code: z.string().trim().max(20).optional().nullable(),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      role: z.enum(["founder", "sales_head", "sales_rep", "legion"]),
      title: z.string().optional().nullable(),
      daily_call_target: z.number().int().min(1).max(500).optional(),
    }),
    req.body,
  );
  let code = body.employee_code?.toUpperCase() ?? "";
  if (!code) {
    if (body.role !== "legion") throw badRequest("Enter their FR number from Focus Realm Workspace — it's their login");
    code = await nextLoginId("LG");
  } else if (code.length < 2) {
    throw badRequest("That login ID is too short");
  }
  if (await db.maybe(`select 1 from crm_users where upper(employee_code) = $1`, [code])) {
    throw badRequest(`${code} is already someone's login`);
  }
  const pw = temporaryPassword();
  const pk = phoneKey(body.phone);
  const u = await db.one(
    `insert into crm_users (employee_code, email, full_name, phone, role, title, password_hash, must_change_password, source, daily_call_target, avatar_hue)
     values ($1, $2, $3, $4, $5, $6, $7, true, 'manual', $8, $9) returning ${USER_COLUMNS}`,
    [code, body.email ?? null, body.full_name, pk ? `+${pk}` : null, body.role, body.title ?? null, await hashPassword(pw), body.daily_call_target ?? 40, 190 + Math.floor(Math.random() * 50)],
  );
  await audit({ id: req.user!.id, label: req.user!.full_name }, "user.create", "user", u.id, { role: body.role });
  res.json({ user: u, loginId: u.employee_code, temporaryPassword: pw });
});

api.patch("/users/:id", manager, async (req, res) => {
  const id = parse(zId, req.params.id);
  const body = parse(
    z.object({
      role: z.enum(["founder", "sales_head", "sales_rep", "legion"]).optional(),
      status: z.enum(["active", "inactive"]).optional(),
      title: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      daily_call_target: z.number().int().min(1).max(500).optional(),
      max_active_prospects: z.number().int().min(1).max(2000).optional(),
    }),
    req.body,
  );
  if (req.user!.role !== "founder" && (body.role || body.status)) throw forbidden("Only founders change roles or access");
  if (id === req.user!.id && (body.role || body.status)) throw badRequest("You can't change your own role or access");
  const u = await db.maybe(
    `update crm_users set role = coalesce($2, role), status = coalesce($3, status), title = coalesce($4, title), phone = coalesce($5, phone),
       email = coalesce($6, email), daily_call_target = coalesce($7, daily_call_target), max_active_prospects = coalesce($8, max_active_prospects),
       token_version = token_version + case when $3 = 'inactive' then 1 else 0 end, updated_at = now()
     where id = $1 returning ${USER_COLUMNS}`,
    [id, body.role ?? null, body.status ?? null, body.title ?? null, body.phone ?? null, body.email ?? null, body.daily_call_target ?? null, body.max_active_prospects ?? null],
  );
  if (!u) throw notFound("Person not found");
  await audit({ id: req.user!.id, label: req.user!.full_name }, "user.update", "user", id, body);
  res.json({ user: u });
});

api.post("/users/:id/reset-password", founder, async (req, res) => {
  const id = parse(zId, req.params.id);
  const pw = temporaryPassword();
  const u = await db.maybe(
    `update crm_users set password_hash = $2, must_change_password = true, token_version = token_version + 1 where id = $1 returning employee_code`,
    [id, await hashPassword(pw)],
  );
  if (!u) throw notFound("Person not found");
  await audit({ id: req.user!.id, label: req.user!.full_name }, "user.reset_password", "user", id);
  res.json({ loginId: u.employee_code, temporaryPassword: pw });
});

// ---------------------------------------------------------------- contacts

api.get("/contacts", async (req, res) => {
  const f = parse(
    zPage.extend({
      q: z.string().optional(),
      stage: z.enum(STAGES).optional(),
      status: z.enum(STATUSES).optional(),
      ownerId: zId.optional(),
      campaign: z.string().optional(),
      segment: z.string().optional(),
      unassigned: z.coerce.boolean().optional(),
      due: z.enum(["today", "overdue", "stale"]).optional(),
      sort: z.enum(["recent", "name", "next_action", "temperature"]).optional(),
    }),
    req.query,
  );
  res.json(await listContacts(req.user!, f));
});

api.get("/contacts/facets", async (req, res) => res.json(await facets(req.user!)));

api.get("/contacts/board", async (req, res) => {
  const mine = req.user!.role === "sales_rep" || req.query.mine === "1";
  const rows = await db.many(
    `select c.id, c.full_name, c.designation, c.stage, c.status, c.temperature, c.segment, c.campaign, c.last_call_outcome,
       c.last_contacted_at, c.next_action_at, c.owner_id, c.legion_owner_id, co.name as company_name, o.full_name as owner_name, o.avatar_hue as owner_hue,
       (select m.scheduled_at from crm_meetings m where m.contact_id = c.id and m.status = 'scheduled' order by m.scheduled_at limit 1) as meeting_at
     from crm_contacts c left join crm_companies co on co.id = c.company_id left join crm_users o on o.id = c.owner_id
     where c.status not in ('disqualified','closed_lost') and ($1::uuid is null or c.owner_id = $1 or c.legion_owner_id = $1)
       and (c.stage <> 'prospect' or c.owner_id is not null)
     order by c.updated_at desc limit 600`,
    [mine ? req.user!.id : null],
  );
  res.json({ rows });
});

api.post("/contacts", async (req, res) => {
  const body = parse(
    z.object({
      full_name: z.string().min(1).max(200),
      company: z.string().max(200).optional().nullable(),
      designation: z.string().max(200).optional().nullable(),
      phone: z.string().min(5).max(40),
      email: z.string().max(200).optional().nullable(),
      city: z.string().max(100).optional().nullable(),
      campaign: z.string().max(100).optional().nullable(),
      segment: z.string().max(100).optional().nullable(),
      source: z.string().max(100).optional().nullable(),
      notes: z.string().max(5000).optional().nullable(),
      ownerId: zId.optional().nullable(),
    }),
    req.body,
  );
  res.json({ contact: await createContact(req.user!, body, body.ownerId) });
});

const ImportRow = z.object({
  full_name: z.string().max(200).optional().default(""),
  company: z.string().max(200).optional().nullable(),
  designation: z.string().max(200).optional().nullable(),
  phone: z.string().max(60).optional().nullable(),
  alt_phone: z.string().max(60).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  industry: z.string().max(100).optional().nullable(),
  website: z.string().max(300).optional().nullable(),
  source: z.string().max(100).optional().nullable(),
  campaign: z.string().max(100).optional().nullable(),
  segment: z.string().max(100).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

api.post("/imports", manager, async (req, res) => {
  const body = parse(
    z.object({
      fileName: z.string().max(300).optional(),
      campaign: z.string().max(100).optional().nullable(),
      segment: z.string().max(100).optional().nullable(),
      source: z.string().max(100).optional().nullable(),
      rows: z.array(ImportRow).max(20000),
    }),
    req.body,
  );
  res.json(await importContacts(req.user!, body));
});

api.get("/imports", manager, async (_req, res) => {
  res.json({
    batches: await db.many(
      `select b.*, u.full_name as uploaded_by_name from crm_import_batches b left join crm_users u on u.id = b.uploaded_by order by b.created_at desc limit 50`,
    ),
  });
});

api.get("/contacts/:id", async (req, res) => res.json(await contactDetail(req.user!, parse(zId, req.params.id))));

api.patch("/contacts/:id", async (req, res) => {
  const body = parse(
    z.object({
      full_name: z.string().min(1).max(200).optional(),
      company: z.string().max(200).optional().nullable(),
      designation: z.string().max(200).optional().nullable(),
      phone: z.string().max(40).optional(),
      alt_phone: z.string().max(40).optional().nullable(),
      email: z.string().max(200).optional().nullable(),
      city: z.string().max(100).optional().nullable(),
      campaign: z.string().max(100).optional().nullable(),
      segment: z.string().max(100).optional().nullable(),
      tags: z.array(z.string().max(40)).max(30).optional(),
      notes: z.string().max(5000).optional().nullable(),
      do_not_contact: z.boolean().optional(),
      is_invalid: z.boolean().optional(),
      qualification: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
    }),
    req.body,
  );
  res.json({ contact: await updateContact(req.user!, parse(zId, req.params.id), body) });
});

api.post("/contacts/:id/status", async (req, res) => {
  const body = parse(z.object({ status: z.enum(STATUSES), note: z.string().max(2000).optional().nullable() }), req.body);
  res.json({ contact: await changeStatus(req.user!, parse(zId, req.params.id), body.status, body.note) });
});

api.post("/contacts/:id/stage", async (req, res) => {
  const body = parse(z.object({ stage: z.enum(STAGES), note: z.string().max(2000).optional().nullable() }), req.body);
  res.json({ contact: await moveStage(req.user!, parse(zId, req.params.id), body.stage, body.note) });
});

api.post("/contacts/:id/notes", async (req, res) => {
  const body = parse(z.object({ body: z.string().min(1).max(5000) }), req.body);
  res.json({ activity: await addNote(req.user!, parse(zId, req.params.id), body.body) });
});

api.get("/whatsapp/templates", async (_req, res) => res.json(await getSetting("whatsapp")));

/** A WhatsApp message was opened for this prospect: put it on the timeline. */
api.post("/contacts/:id/whatsapp", async (req, res) => {
  const body = parse(z.object({ label: z.string().max(60).optional().nullable(), text: z.string().max(1000) }), req.body);
  const id = parse(zId, req.params.id);
  const c = await getContactRow(id);
  if (!canView(req.user!, c)) throw forbidden();
  await db.query(`update crm_contacts set last_contacted_at = now(), updated_at = now() where id = $1`, [id]);
  res.json({ activity: await activity(id, req.user!.id, "whatsapp", body.label ? `WhatsApp: ${body.label}` : "WhatsApp message", body.text) });
});

api.post("/contacts/:id/reassign", manager, async (req, res) => {
  const body = parse(z.object({ toUserId: zId, reason: z.string().min(3).max(500) }), req.body);
  res.json(await reassignContact(req.user!, parse(zId, req.params.id), body.toUserId, body.reason));
});

api.post("/contacts/:id/handoff", async (req, res) => {
  const body = parse(z.object({ note: z.string().max(2000).optional().nullable(), toUserId: zId.optional().nullable() }), req.body);
  res.json({ contact: await submitHandoff(req.user!, parse(zId, req.params.id), body.note ?? null, body.toUserId) });
});

api.post("/contacts/:id/close", async (req, res) => {
  const body = parse(z.object({ outcome: z.enum(["won", "lost"]), note: z.string().max(2000).optional().nullable() }), req.body);
  res.json({ contact: await closeContact(req.user!, parse(zId, req.params.id), body.outcome, body.note) });
});

// -------------------------------------------------------------- allocation

const AllocationBody = z.object({
  campaign: z.string().optional().nullable(),
  segment: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  userIds: z.array(zId).min(1).max(200),
  batchSize: z.number().int().min(1).max(100).optional(),
  maxActive: z.number().int().min(1).max(2000).optional(),
});

api.post("/allocation/preview", manager, async (req, res) => {
  const { plan: _plan, ...rest } = await previewAllocation(parse(AllocationBody, req.body));
  res.json(rest);
});

api.post("/allocation/run", manager, async (req, res) => {
  res.json(await runAllocation(req.user!, parse(AllocationBody, req.body)));
});

api.get("/allocation/batches", manager, async (_req, res) => {
  res.json({
    batches: await db.many(
      `select b.*, u.full_name as initiated_by_name from crm_allocation_batches b left join crm_users u on u.id = b.initiated_by order by b.created_at desc limit 50`,
    ),
  });
});

api.get("/allocation/flags", manager, async (_req, res) => res.json({ flags: await inactivityFlags() }));

/** The unassigned pool and everyone's room — for "allocate now" after an import. */
api.get("/allocation/overview", manager, async (_req, res) => {
  const s = await getSetting("allocation");
  const pool = await db.one<{ n: number }>(
    `select count(*)::int as n from crm_contacts c where c.owner_id is null and c.do_not_contact = false and c.is_invalid = false
       and c.stage = 'prospect' and c.status in ('new','returned') and c.phone_key is not null`,
  );
  const people = await db.many(
    `select u.id, u.full_name, u.avatar_hue,
       (select count(*)::int from crm_contacts c where c.owner_id = u.id and c.status in ('new','outreach','follow_up','qualification_review','qualified','returned')) as active
     from crm_users u where u.status = 'active' and u.role = 'sales_rep' order by u.full_name`,
  );
  const room = people.reduce((n, p) => n + Math.max(0, s.maxActive - p.active), 0);
  res.json({ pool: pool.n, people, room, settings: s });
});

// ------------------------------------------------------------------- calls

api.post("/calls", async (req, res) => {
  const body = parse(z.object({ contactId: zId, mode: z.enum(["phone_link", "bridge", "demo"]).optional() }), req.body);
  res.json({ call: await startCall(req.user!, body.contactId, { mode: body.mode }) });
});

api.get("/calls", async (req, res) => {
  const f = parse(
    zPage.extend({
      userId: zId.optional(),
      contactId: zId.optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      outcome: z.string().optional(),
      analysis: z.string().optional(),
      recording: z.enum(["uploaded", "missing"]).optional(),
    }),
    req.query,
  );
  res.json(await listCalls(req.user!, f));
});

api.get("/calls/live", async (req, res) => {
  const call = await db.maybe(
    `select k.id, k.call_code, k.status, k.mode, k.started_at, k.phone_dialed, c.full_name as contact_name, co.name as company_name
     from crm_calls k join crm_contacts c on c.id = k.contact_id left join crm_companies co on co.id = c.company_id
     where k.user_id = $1 and k.outcome is null and k.status in ('initiated','ringing','in_progress') and k.started_at > now() - interval '30 minutes'
     order by k.started_at desc limit 1`,
    [req.user!.id],
  );
  res.json({ call });
});

api.get("/calls/recordings", async (req, res) => res.json(await recordingsInbox(req.user!)));

api.get("/calls/awaiting-recording", async (req, res) => {
  res.json({
    calls: await db.many(
      `select k.id, k.call_code, k.started_at, k.outcome, c.full_name as contact_name from crm_calls k join crm_contacts c on c.id = k.contact_id
       where k.user_id = $1 and k.mode = 'phone_link' and k.recording_status = 'awaiting' and k.started_at > now() - interval '2 days'
       order by k.started_at desc limit 20`,
      [req.user!.id],
    ),
  });
});

api.get("/calls/:id", async (req, res) => res.json(await callDetail(req.user!, parse(zId, req.params.id))));

api.post("/calls/:id/status", async (req, res) => {
  const body = parse(z.object({ status: z.enum(["ringing", "in_progress", "completed", "cancelled"]) }), req.body);
  res.json({ call: await updateCallStatus(req.user!, parse(zId, req.params.id), body.status) });
});

api.post("/calls/:id/outcome", async (req, res) => {
  const body = parse(
    z.object({
      outcome: z.enum(OUTCOMES),
      notes: z.string().max(5000).optional().nullable(),
      durationSec: z.number().int().min(0).max(4 * 3600).optional().nullable(),
      next: z.object({ kind: z.enum(["follow_up", "call", "meeting"]), dueAt: z.string(), reason: z.string().max(1000).optional().nullable() }).optional().nullable(),
      qualification: z.record(z.string(), z.boolean()).optional(),
    }),
    req.body,
  );
  res.json({ call: await logOutcome(req.user!, parse(zId, req.params.id), body) });
});

api.post("/calls/:id/recording", upload.single("file"), async (req, res) => {
  if (!req.file) throw badRequest("Attach the recording file");
  res.json({ call: await attachRecording(req.user!, parse(zId, req.params.id), req.file) });
});

api.post("/calls/:id/recording/upload-url", async (req, res) => {
  const body = parse(z.object({ mime: z.string().max(100).default("audio/mpeg") }), req.body);
  res.json(await recordingUploadTarget(req.user!, parse(zId, req.params.id), body.mime));
});

api.post("/calls/:id/recording/complete", async (req, res) => {
  const body = parse(z.object({ key: z.string().min(5).max(300), mime: z.string().max(100) }), req.body);
  res.json({ call: await completeRecordingUpload(req.user!, parse(zId, req.params.id), body) });
});

api.get("/calls/:id/recording-url", async (req, res) => {
  res.json(await recordingPlaybackUrl(req.user!, parse(zId, req.params.id)));
});

api.get("/calls/:id/recording", async (req, res) => {
  const obj = await streamRecording(req.user!, parse(zId, req.params.id));
  res.setHeader("Content-Type", obj.mime);
  if (obj.size) res.setHeader("Content-Length", String(obj.size));
  res.setHeader("Cache-Control", "private, no-store");
  obj.stream.pipe(res);
});

api.post("/calls/:id/analyze", manager, async (req, res) => {
  const id = parse(zId, req.params.id);
  await db.query(`update crm_calls set analysis_status = 'queued' where id = $1 and transcript_status = 'done'`, [id]);
  await enqueue("call.analyze", { callId: id }, { dedupeKey: `analyze:${id}` });
  res.json({ ok: true });
});

api.post("/calls/:id/review", manager, async (req, res) => {
  const body = parse(z.object({ verdict: z.enum(["confirmed", "corrected"]), note: z.string().max(2000).optional().nullable() }), req.body);
  res.json({ call: await reviewCall(req.user!, parse(zId, req.params.id), body) });
});

// ------------------------------------------------------------------- tasks

api.get("/tasks", async (req, res) => {
  const f = parse(
    z.object({
      scope: z.enum(["mine", "team", "created"]).default("mine"),
      status: z.string().optional(),
      userId: zId.optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      contactId: zId.optional(),
    }),
    req.query,
  );
  res.json({ tasks: await listTasks(req.user!, f) });
});

api.post("/tasks", async (req, res) => {
  const body = parse(
    z.object({
      contactId: zId.optional().nullable(),
      assignedTo: zId.optional().nullable(),
      kind: z.enum(["call", "follow_up", "meeting", "email", "whatsapp", "review", "custom"]),
      title: z.string().min(1).max(300),
      reason: z.string().max(2000).optional().nullable(),
      dueAt: z.string().optional().nullable(),
      reminderMinutes: z.number().int().min(0).max(10080).optional().nullable(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    }),
    req.body,
  );
  res.json({ task: await createTask(req.user!, body) });
});

api.patch("/tasks/:id", async (req, res) => {
  const body = parse(
    z.object({
      status: z.enum(["open", "done", "missed", "cancelled"]).optional(),
      dueAt: z.string().nullable().optional(),
      title: z.string().max(300).optional(),
      reason: z.string().max(2000).nullable().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    }),
    req.body,
  );
  res.json({ task: await updateTask(req.user!, parse(zId, req.params.id), body) });
});

// --------------------------------------------------------- handoffs/legion

api.get("/handoffs", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const rows = await db.many(
    `select h.*, c.full_name as contact_name, c.designation, c.temperature, c.qualification, co.name as company_name,
       f.full_name as from_name, f.avatar_hue as from_hue, d.full_name as decided_by_name,
       (select k.analysis->>'summary' from crm_calls k where k.contact_id = c.id and k.analysis is not null order by k.started_at desc limit 1) as last_summary
     from crm_handoffs h join crm_contacts c on c.id = h.contact_id left join crm_companies co on co.id = c.company_id
     left join crm_users f on f.id = h.from_user_id left join crm_users d on d.id = h.decided_by
     where ($1::text is null or h.status = $1) and ($2::uuid is null or h.from_user_id = $2)
     order by h.created_at desc limit 200`,
    [status, req.user!.role === "sales_rep" ? req.user!.id : null],
  );
  res.json({ handoffs: rows });
});

api.post("/handoffs/:id/decision", async (req, res) => {
  const body = parse(
    z.object({ decision: z.enum(["accept", "return"]), reason: z.string().max(2000).optional().nullable(), legionUserId: zId.optional().nullable() }),
    req.body,
  );
  res.json({ contact: await decideHandoff(req.user!, parse(zId, req.params.id), body.decision, body.reason, body.legionUserId) });
});

api.get("/meetings", async (req, res) => {
  const f = parse(z.object({ from: z.string().optional(), to: z.string().optional(), mine: z.coerce.boolean().optional(), status: z.string().optional() }), req.query);
  res.json({ meetings: await listMeetings(req.user!, f) });
});

api.post("/meetings", async (req, res) => {
  const body = parse(
    z.object({
      contactId: zId,
      stage: z.enum(["legion_meet_1", "legion_meet_2"]),
      scheduledAt: z.string(),
      durationMin: z.number().int().min(10).max(480).optional(),
      location: z.string().max(500).optional().nullable(),
      legionUserId: zId.optional().nullable(),
      notes: z.string().max(5000).optional().nullable(),
    }),
    req.body,
  );
  res.json({ meeting: await scheduleMeeting(req.user!, body) });
});

api.patch("/meetings/:id", async (req, res) => {
  const body = parse(
    z.object({
      status: z.enum(["scheduled", "completed", "no_show", "cancelled"]).optional(),
      outcome: z.string().max(2000).optional().nullable(),
      notes: z.string().max(5000).optional().nullable(),
      scheduledAt: z.string().optional(),
    }),
    req.body,
  );
  res.json({ meeting: await updateMeeting(req.user!, parse(zId, req.params.id), body) });
});

// -------------------------------------------------------------- dashboards

api.get("/dashboard/rep", async (req, res) => res.json(await repDashboard(req.user!)));
api.get("/sprint", async (req, res) => res.json(await sprintQueue(req.user!)));
api.get("/dashboard/team", async (req, res) => {
  if (req.user!.role === "sales_rep") throw forbidden();
  const date = typeof req.query.date === "string" ? parse(zIsoDate, req.query.date) : undefined;
  res.json(await teamDashboard(date));
});
api.get("/dashboard/founder", requireRole("founder", "sales_head"), async (_req, res) => res.json(await founderDashboard()));
api.get("/dashboard/legion", requireRole("legion", "founder"), async (req, res) => res.json(await legionDashboard(req.user!)));
api.get("/insights/objections", async (req, res) => {
  if (req.user!.role === "sales_rep") throw forbidden();
  res.json(await objectionInsights(Number(req.query.days) || 30));
});

// ----------------------------------------------------------------- reports

api.get("/reports", async (req, res) => {
  const f = parse(z.object({ date: zIsoDate.optional(), userId: zId.optional(), limit: z.coerce.number().int().min(1).max(200).default(60) }), req.query);
  const userId = req.user!.role === "sales_rep" ? req.user!.id : f.userId ?? null;
  const rows = await db.many(
    `select r.id, r.user_id, r.report_date, r.status, r.metrics, r.report->>'headline' as headline, r.report->>'grade' as grade,
       (r.report->>'overall_score')::int as overall_score, r.error, r.model, r.updated_at,
       u.full_name, u.avatar_hue, u.employee_code
     from crm_daily_reports r join crm_users u on u.id = r.user_id
     where ($1::date is null or r.report_date = $1) and ($2::uuid is null or r.user_id = $2)
     order by r.report_date desc, u.full_name limit $3`,
    [f.date ?? null, userId, f.limit],
  );
  res.json({ reports: rows });
});

api.get("/reports/:id", async (req, res) => {
  const r = await db.maybe(
    `select r.*, u.full_name, u.employee_code, u.avatar_hue, u.title from crm_daily_reports r join crm_users u on u.id = r.user_id where r.id = $1`,
    [parse(zId, req.params.id)],
  );
  if (!r) throw notFound("Report not found");
  if (req.user!.role === "sales_rep" && r.user_id !== req.user!.id) throw forbidden();
  res.json({ report: r });
});

api.post("/reports/run", manager, async (req, res) => {
  const body = parse(z.object({ date: zIsoDate.optional(), userIds: z.array(zId).optional() }), req.body ?? {});
  const out = await runDailyReports(body.date ?? todayLocal(), { userIds: body.userIds });
  await audit({ id: req.user!.id, label: req.user!.full_name }, "reports.run", "daily_report", null, out);
  res.json(out);
});

api.post("/reports/:id/rebuild", manager, async (req, res) => {
  const r = await db.maybe(`select user_id, report_date from crm_daily_reports where id = $1`, [parse(zId, req.params.id)]);
  if (!r) throw notFound("Report not found");
  const id = await buildReport(r.user_id, r.report_date);
  res.json({ id });
});

// ----------------------------------------------------- settings (founders)

api.get("/settings", manager, async (_req, res) => res.json({ settings: await getAllSettings() }));

api.put("/settings/:key", founder, async (req, res) => {
  const key = req.params.key as SettingKey;
  if (!(key in settingSchemas)) throw notFound("Unknown setting");
  const value = await putSetting(key, req.body, req.user!.id);
  await audit({ id: req.user!.id, label: req.user!.full_name }, "settings.update", "setting", key, value as any);
  res.json({ value });
});

api.get("/integrations/hr/status", founder, async (_req, res) => res.json(await hrStatus()));

api.get("/audit", founder, async (req, res) => {
  const q = typeof req.query.q === "string" ? `%${req.query.q.toLowerCase()}%` : null;
  res.json({
    entries: await db.many(
      `select a.*, u.full_name as actor_name from crm_audit_log a left join crm_users u on u.id = a.actor_id
       where ($1::text is null or lower(a.action) like $1 or lower(coalesce(a.actor_label, u.full_name, '')) like $1)
       order by a.created_at desc limit 300`,
      [q],
    ),
  });
});

api.get("/jobs", founder, async (_req, res) => {
  res.json({
    stats: await jobStats(),
    failed: await db.many(`select id, kind, payload, attempts, last_error, created_at from crm_jobs where status = 'failed' order by created_at desc limit 50`),
  });
});

api.post("/jobs/retry", founder, async (req, res) => {
  const kind = typeof req.body?.kind === "string" ? req.body.kind : undefined;
  res.json({ retried: await retryFailed(kind) });
});

// ----------------------------------------------------------- notifications

api.get("/notifications", async (req, res) => {
  const rows = await db.many(`select * from crm_notifications where user_id = $1 order by created_at desc limit 60`, [req.user!.id]);
  const unread = await db.one(`select count(*)::int as n from crm_notifications where user_id = $1 and read_at is null`, [req.user!.id]);
  res.json({ notifications: rows, unread: unread.n });
});

api.post("/notifications/read", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]).filter((x) => zId.safeParse(x).success) : null;
  await db.query(
    `update crm_notifications set read_at = now() where user_id = $1 and read_at is null and ($2::uuid[] is null or id = any($2::uuid[]))`,
    [req.user!.id, ids],
  );
  res.json({ ok: true });
});

api.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ contacts: [], people: [], calls: [] });
  const like = `%${q.toLowerCase()}%`;
  const mine = req.user!.role === "sales_rep" ? req.user!.id : null;
  const [contacts, people, calls] = await Promise.all([
    db.many(
      `select c.id, c.full_name, c.stage, c.status, co.name as company_name from crm_contacts c left join crm_companies co on co.id = c.company_id
       where ($2::uuid is null or c.owner_id = $2) and (lower(c.full_name) like $1 or lower(coalesce(co.name,'')) like $1 or c.phone_key like $1)
       order by c.updated_at desc limit 8`,
      [like, mine],
    ),
    isManager(req.user) || req.user!.role === "legion"
      ? db.many(`select id, full_name, role, employee_code, avatar_hue from crm_users where lower(full_name) like $1 or lower(employee_code) like $1 limit 5`, [like])
      : Promise.resolve([]),
    db.many(
      `select k.id, k.call_code, c.full_name as contact_name from crm_calls k join crm_contacts c on c.id = k.contact_id
       where ($2::uuid is null or k.user_id = $2) and lower(k.call_code) like $1 limit 5`,
      [like, mine],
    ),
  ]);
  res.json({ contacts, people, calls });
});
