import { db, json } from "../db/index.js";
import type { AuthUser } from "../lib/auth.js";
import { badRequest, forbidden, HttpError, notFound } from "../lib/http.js";
import { formatPhone } from "../lib/phone.js";
import { publish, broadcast } from "../lib/bus.js";
import { activity, audit, notify } from "../lib/record.js";
import { renderScript, scriptFor } from "../seed/scripts.js";
import { canWork, getContactRow } from "./contacts.js";
import { enqueue } from "./jobs.js";
import { getSetting } from "./settings.js";
import { recordingKey, storage } from "./storage.js";
import { activeProvider, providers } from "./telephony/index.js";
import { createTask } from "./tasks.js";

/**
 * The calling workflow (proposal §8, with the founders' sales journey):
 *
 *  1. Rep presses Call → a unique call ID is created and linked to the
 *     prospect, contact and salesperson.
 *  2. The number reaches the rep's phone — rung by the telephony bridge, or
 *     pushed to their Phone Link screen — and the call is recorded.
 *  3. The recording is stored privately and transcribed.
 *  4. At the end of the day every recording is analysed by AI and rolled up
 *     into one report per salesperson, emailed to the leadership.
 */

export const OUTCOMES = [
  "no_answer", "busy", "switched_off", "wrong_number", "not_interested", "callback_requested",
  "follow_up_agreed", "interested", "meeting_booked", "do_not_call",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes where a conversation actually happened. */
export const CONNECTED: Outcome[] = ["not_interested", "callback_requested", "follow_up_agreed", "interested", "meeting_booked", "do_not_call"];

export const CALL_SELECT = `k.*, c.full_name as contact_name, c.phone_key as contact_phone, c.stage as contact_stage, c.status as contact_status,
  co.name as company_name, u.full_name as user_name, u.avatar_hue as user_hue, u.employee_code as user_code`;
export const CALL_FROM = `from crm_calls k join crm_contacts c on c.id = k.contact_id left join crm_companies co on co.id = c.company_id
  join crm_users u on u.id = k.user_id`;

async function nextCallCode() {
  const r = await db.one<{ n: number }>("select nextval('crm_call_seq') as n");
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `FRC-${ymd}-${String(r.n).padStart(5, "0")}`;
}

export async function getCall(id: string) {
  const k = await db.maybe(`select ${CALL_SELECT} ${CALL_FROM} where k.id = $1`, [id]);
  if (!k) throw notFound("Call not found");
  return { ...k, contact_phone_display: formatPhone(k.contact_phone) };
}

function canSeeCall(user: AuthUser, call: { user_id: string }) {
  if (user.role === "sales_rep") return call.user_id === user.id;
  return true;
}

export async function startCall(user: AuthUser, contactId: string, opts: { mode?: "phone_link" | "bridge" | "demo" } = {}) {
  const c = await getContactRow(contactId);
  if (!canWork(user, c)) throw forbidden("You can only call your own prospects");
  if (c.do_not_contact) throw badRequest(`${c.full_name} is marked do-not-contact`);
  if (!c.phone_key) throw badRequest("This prospect has no valid phone number");

  const t = await getSetting("telephony");
  let mode = opts.mode ?? t.mode;
  const provider = activeProvider();
  if (mode === "bridge" && !provider) {
    throw badRequest("Bridge calling needs a telephony provider. Add Exotel or Twilio credentials, or switch to Phone Link in Settings.");
  }
  if (mode === "bridge" && !user.phone) throw badRequest("Add your phone number to your profile so the call can ring you");

  // One live call per person at a time.
  const live = await db.maybe(
    `select id, call_code from crm_calls where user_id = $1 and status in ('initiated','ringing','in_progress') and started_at > now() - interval '2 hours'`,
    [user.id],
  );
  if (live) {
    await db.query(`update crm_calls set status = 'cancelled', ended_at = now() where id = $1 and outcome is null and status = 'initiated'`, [live.id]);
  }

  const code = await nextCallCode();
  const call = await db.one(
    `insert into crm_calls (call_code, contact_id, user_id, mode, provider, phone_dialed, status, consent_notice, recording_status)
     values ($1,$2,$3,$4,$5,$6,'initiated',$7,$8) returning id`,
    [code, c.id, user.id, mode, mode === "bridge" ? provider!.name : mode === "demo" ? "demo" : "device", c.phone_key, t.consentNotice, mode === "demo" ? "none" : "awaiting"],
  );
  await db.query(
    `update crm_contacts set call_count = call_count + 1, last_contacted_at = now(),
       status = case when status in ('new','returned') then 'outreach' else status end, updated_at = now()
     where id = $1`,
    [c.id],
  );
  await activity(c.id, user.id, "call", `Call started (${code})`, null, { callId: call.id, mode });

  if (mode === "bridge") {
    try {
      const r = await provider!.bridge({
        callId: call.id,
        repPhoneKey: user.phone!.replace(/\D/g, "").length === 10 ? `91${user.phone!.replace(/\D/g, "")}` : user.phone!.replace(/\D/g, ""),
        prospectPhoneKey: c.phone_key,
        consentText: t.consentNotice ? t.consentText : null,
      });
      await db.query(`update crm_calls set provider_ref = $2, status = $3 where id = $1`, [call.id, r.providerRef, r.status]);
    } catch (e) {
      await db.query(`update crm_calls set status = 'failed', ended_at = now(), notes = $2 where id = $1`, [call.id, (e as Error).message]);
      throw new HttpError(502, (e as Error).message);
    }
  }

  const full = await getCall(call.id);
  if (mode === "phone_link") {
    // The number appears on the rep's phone (Phone Link screen) to dial.
    publish(user.id, {
      type: "dial",
      data: {
        callId: full.id,
        callCode: full.call_code,
        phone: full.contact_phone_display,
        tel: `tel:+${c.phone_key}`,
        name: c.full_name,
        company: c.company_name,
        consentText: t.consentNotice ? t.consentText : null,
      },
    });
  }
  if (mode === "demo") simulateDemoCall(full.id, user.id);
  return full;
}

/** Demo mode: walk the call through ringing → connected so the UI animates. */
function simulateDemoCall(callId: string, userId: string) {
  setTimeout(async () => {
    await db.query(`update crm_calls set status = 'ringing' where id = $1 and status = 'initiated'`, [callId]);
    publish(userId, { type: "call.updated", data: { id: callId, status: "ringing" } });
  }, 900);
  setTimeout(async () => {
    const r = await db.query(`update crm_calls set status = 'in_progress', answered_at = now() where id = $1 and status = 'ringing'`, [callId]);
    if (r.rowCount) publish(userId, { type: "call.updated", data: { id: callId, status: "in_progress" } });
  }, 3200);
}

/** Status pings from the Phone Link screen or the desktop call panel. */
export async function updateCallStatus(user: AuthUser, id: string, status: "ringing" | "in_progress" | "completed" | "cancelled") {
  const call = await getCall(id);
  if (call.user_id !== user.id) throw forbidden();
  if (["completed", "failed", "cancelled"].includes(call.status) && status !== "completed") return call;
  const sets = ["status = $2"];
  if (status === "in_progress") sets.push("answered_at = coalesce(answered_at, now())");
  if (status === "completed" || status === "cancelled") {
    sets.push("ended_at = coalesce(ended_at, now())");
    sets.push("duration_sec = coalesce(duration_sec, greatest(0, extract(epoch from (now() - coalesce(answered_at, started_at)))::int))");
  }
  await db.query(`update crm_calls set ${sets.join(", ")}, updated_at = now() where id = $1`, [id, status]);
  const fresh = await getCall(id);
  publish(user.id, { type: "call.updated", data: { id, status: fresh.status, duration_sec: fresh.duration_sec } });
  return fresh;
}

export interface OutcomeInput {
  outcome: Outcome;
  notes?: string | null;
  durationSec?: number | null;
  next?: { kind: "follow_up" | "call" | "meeting"; dueAt: string; reason?: string | null } | null;
  qualification?: Record<string, boolean>;
}

/** Save the call outcome and notes; update the prospect accordingly. */
export async function logOutcome(user: AuthUser, id: string, input: OutcomeInput) {
  const call = await getCall(id);
  if (call.user_id !== user.id && user.role !== "founder" && user.role !== "sales_head") throw forbidden();
  const connected = CONNECTED.includes(input.outcome);
  const finalStatus = connected ? "completed" : input.outcome === "busy" ? "busy" : input.outcome === "no_answer" || input.outcome === "switched_off" ? "no_answer" : "completed";

  await db.query(
    `update crm_calls set outcome = $2, notes = $3, status = $4, ended_at = coalesce(ended_at, now()),
       duration_sec = coalesce($5, duration_sec, greatest(0, extract(epoch from (now() - coalesce(answered_at, started_at)))::int)),
       recording_status = case when $6 and recording_status = 'awaiting' then 'unavailable' else recording_status end,
       updated_at = now()
     where id = $1`,
    [id, input.outcome, input.notes ?? null, finalStatus, input.durationSec ?? null, !connected],
  );

  // Move the prospect along (outcomes are stored separately from status — §5).
  const contactStatus: Record<string, string | null> = {
    callback_requested: "follow_up",
    follow_up_agreed: "follow_up",
    interested: "qualification_review",
    meeting_booked: "qualification_review",
  };
  const nextStatus = contactStatus[input.outcome];
  await db.query(
    `update crm_contacts set last_call_outcome = $2,
       status = case when $3::text is not null and status in ('new','outreach','follow_up','returned') then $3::text else status end,
       is_invalid = case when $2 = 'wrong_number' then true else is_invalid end,
       do_not_contact = case when $2 = 'do_not_call' then true else do_not_contact end,
       qualification = qualification || $4::jsonb,
       updated_at = now()
     where id = $1`,
    [call.contact_id, input.outcome, nextStatus ?? null, json(input.qualification ?? {})],
  );
  await activity(call.contact_id, user.id, "call", `Call ${call.call_code}: ${input.outcome.replace(/_/g, " ")}`, input.notes ?? null, {
    callId: id,
    outcome: input.outcome,
  });

  if (input.next?.dueAt) {
    await createTask(user, {
      contactId: call.contact_id,
      kind: input.next.kind === "meeting" ? "meeting" : "follow_up",
      title: input.next.kind === "meeting" ? `Meeting with ${call.contact_name}` : `Follow up with ${call.contact_name}`,
      reason: input.next.reason ?? input.notes ?? null,
      dueAt: input.next.dueAt,
      reminderMinutes: 15,
    });
  }

  // Demo mode has no audio: synthesise a matching conversation so the AI
  // pipeline has a transcript to analyse.
  if (call.mode === "demo" && connected) {
    const script = scriptFor(input.outcome, Math.floor(Math.random() * 10));
    if (script) {
      const { utterances, duration } = renderScript(script, {
        rep: call.user_name,
        prospect: call.contact_name,
        company: call.company_name ?? "your company",
        city: "Delhi",
      });
      await db.query(
        `update crm_calls set transcript = $2::jsonb, transcript_status = 'done', duration_sec = $3, recording_status = 'unavailable' where id = $1`,
        [id, json({ provider: "demo", utterances, roles: { A: "rep", B: "prospect" } }), duration],
      );
      await queueAnalysisIfImmediate(id);
    }
  }

  const fresh = await getCall(id);
  broadcast({ type: "call.updated", data: { id, status: fresh.status, outcome: fresh.outcome, user_id: fresh.user_id } });
  return fresh;
}

function assertCanAttach(user: AuthUser, call: { user_id: string }) {
  if (call.user_id !== user.id && user.role !== "founder" && user.role !== "sales_head") throw forbidden();
}

function audioMime(mime: string) {
  if (!mime.startsWith("audio/") && !mime.startsWith("video/") && mime !== "application/octet-stream") {
    throw badRequest("That doesn't look like an audio recording");
  }
  return mime === "application/octet-stream" ? "audio/mpeg" : mime;
}

async function recordingStored(user: AuthUser, id: string, key: string, mime: string, size: number) {
  await db.query(
    `update crm_calls set recording_status = 'uploaded', recording_path = $2, recording_mime = $3, recording_bytes = $4,
       transcript_status = 'queued', updated_at = now() where id = $1`,
    [id, key, mime, size],
  );
  await enqueue("call.transcribe", { callId: id }, { dedupeKey: `transcribe:${id}` });
  await audit({ id: user.id, label: user.full_name }, "call.recording_uploaded", "call", id, { bytes: size, mime });
  return getCall(id);
}

/** A recording uploaded through the API (self-hosted, local storage). */
export async function attachRecording(user: AuthUser, id: string, file: { buffer: Buffer; mimetype: string; size: number }) {
  const call = await getCall(id);
  assertCanAttach(user, call);
  if (file.size < 1000) throw badRequest("The recording file is empty");
  const mime = audioMime(file.mimetype);
  const key = recordingKey(call.call_code, mime);
  try {
    await storage.put(key, file.buffer, mime);
  } catch (e) {
    await db.query(`update crm_calls set recording_status = 'failed' where id = $1`, [id]);
    throw new HttpError(502, `Couldn't store the recording: ${(e as Error).message}`);
  }
  return recordingStored(user, id, key, mime, file.size);
}

/**
 * Where the browser should send a recording. With Supabase Storage it goes
 * straight there through a one-time signed URL — no size limit from the API
 * (Vercel functions accept at most 4.5 MB per request). Otherwise it's
 * posted to the API.
 */
export async function recordingUploadTarget(user: AuthUser, id: string, mimeIn: string) {
  const call = await getCall(id);
  assertCanAttach(user, call);
  const mime = audioMime(mimeIn || "audio/mpeg");
  if (!storage.direct) return { mode: "api" as const, url: `/api/calls/${id}/recording` };
  const key = recordingKey(call.call_code, mime);
  try {
    return { mode: "direct" as const, url: await storage.uploadUrl(key), key, mime };
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
}

export async function completeRecordingUpload(user: AuthUser, id: string, input: { key: string; mime: string }) {
  const call = await getCall(id);
  assertCanAttach(user, call);
  if (!input.key.includes(call.call_code)) throw badRequest("That upload doesn't belong to this call");
  const info = await storage.info(input.key);
  if (!info) throw badRequest("The upload didn't arrive — try again");
  return recordingStored(user, id, input.key, audioMime(input.mime), info.size ?? 0);
}

/** Telephony webhook: status changes and the finished recording. */
export async function handleProviderWebhook(providerName: "exotel" | "twilio", callId: string, body: Record<string, any>) {
  const provider = providers[providerName];
  const ev = provider.parseWebhook(body);
  const call = await db.maybe(`select id, user_id, status, contact_id from crm_calls where id = $1`, [callId]);
  if (!call) throw notFound("Unknown call");
  if (ev.status) {
    const sets = ["status = $2"];
    if (ev.status === "in_progress") sets.push("answered_at = coalesce(answered_at, now())");
    if (["completed", "failed", "no_answer", "busy"].includes(ev.status)) sets.push("ended_at = coalesce(ended_at, now())");
    await db.query(`update crm_calls set ${sets.join(", ")}, duration_sec = coalesce($3, duration_sec), updated_at = now() where id = $1`, [
      callId, ev.status, ev.durationSec ?? null,
    ]);
    publish(call.user_id, { type: "call.updated", data: { id: callId, status: ev.status, duration_sec: ev.durationSec } });
  }
  if (ev.recordingUrl) {
    await db.query(`update crm_calls set recording_source_url = $2, recording_status = 'awaiting' where id = $1`, [callId, ev.recordingUrl]);
    await enqueue("recording.fetch", { callId, url: ev.recordingUrl, provider: providerName }, { dedupeKey: `fetch:${callId}` });
  }
  return { ok: true };
}

export async function fetchProviderRecording(p: { callId: string; url: string; provider: "exotel" | "twilio" }) {
  const call = await getCall(p.callId);
  const { data, mime } = await providers[p.provider].fetchRecording(p.url);
  const key = recordingKey(call.call_code, mime);
  await storage.put(key, data, mime);
  await db.query(
    `update crm_calls set recording_status = 'uploaded', recording_path = $2, recording_mime = $3, recording_bytes = $4,
       transcript_status = 'queued' where id = $1`,
    [p.callId, key, mime, data.length],
  );
  await enqueue("call.transcribe", { callId: p.callId }, { dedupeKey: `transcribe:${p.callId}` });
}

export async function queueAnalysisIfImmediate(callId: string, force = false) {
  const r = await getSetting("reports");
  if (force || r.analysisMode === "immediate") {
    await db.query(`update crm_calls set analysis_status = 'queued' where id = $1`, [callId]);
    await enqueue("call.analyze", { callId }, { dedupeKey: `analyze:${callId}` });
  }
}

export async function listCalls(user: AuthUser, f: { userId?: string; contactId?: string; from?: string; to?: string; outcome?: string; analysis?: string; page: number; pageSize: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (user.role === "sales_rep") add("k.user_id = ?", user.id);
  else if (f.userId) add("k.user_id = ?", f.userId);
  if (f.contactId) add("k.contact_id = ?", f.contactId);
  if (f.from) add("k.started_at >= ?", f.from);
  if (f.to) add("k.started_at < ?", f.to);
  if (f.outcome) add("k.outcome = ?", f.outcome);
  if (f.analysis) add("k.analysis_status = ?", f.analysis);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const total = await db.one<{ n: number }>(`select count(*) as n ${CALL_FROM} ${w}`, params);
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const rows = await db.many(
    `select k.id, k.call_code, k.contact_id, k.user_id, k.mode, k.status, k.outcome, k.notes, k.started_at, k.duration_sec,
       k.recording_status, k.transcript_status, k.analysis_status, k.score, k.analysis->>'summary' as summary,
       k.analysis->'prospect'->>'temperature' as temperature,
       c.full_name as contact_name, co.name as company_name, u.full_name as user_name, u.avatar_hue as user_hue
     ${CALL_FROM} ${w} order by k.started_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { total: total.n, rows };
}

export async function callDetail(user: AuthUser, id: string) {
  const call = await getCall(id);
  if (!canSeeCall(user, call)) throw forbidden();
  const insights = await db.many(`select * from crm_call_insights where call_id = $1 order by kind, created_at`, [id]);
  return { call, insights };
}

async function assertCanPlay(user: AuthUser, call: any) {
  // Playback permission: the caller, sales heads, founders; Legion only for
  // prospects that reached them.
  const contact = await getContactRow(call.contact_id);
  const allowed =
    call.user_id === user.id || user.role === "founder" || user.role === "sales_head" ||
    (user.role === "legion" && ["qualified", "legion_meet_1", "legion_meet_2"].includes(contact.stage));
  if (!allowed) throw forbidden("You can't play this recording");
  if (!call.recording_path) throw notFound("No recording for this call");
}

/** A URL the player can use: a 10-minute signed link, or the API stream. */
export async function recordingPlaybackUrl(user: AuthUser, id: string) {
  const call = await getCall(id);
  await assertCanPlay(user, call);
  await audit({ id: user.id, label: user.full_name }, "call.recording_played", "call", id);
  const signed = await storage.signedUrl(call.recording_path, 600);
  return { url: signed ?? `/api/calls/${id}/recording`, mime: call.recording_mime ?? "audio/mpeg" };
}

export async function streamRecording(user: AuthUser, id: string) {
  const call = await getCall(id);
  await assertCanPlay(user, call);
  const obj = await storage.get(call.recording_path, call.recording_mime ?? "audio/mpeg");
  if (!obj) throw notFound("Recording file is missing");
  return obj;
}

export async function reviewCall(user: AuthUser, id: string, review: { verdict: "confirmed" | "corrected"; note?: string | null }) {
  if (user.role !== "founder" && user.role !== "sales_head") throw forbidden();
  await db.query(
    `update crm_calls set review = $2::jsonb, analysis_status = case when analysis_status = 'needs_review' then 'done' else analysis_status end where id = $1`,
    [id, json({ ...review, by: user.full_name, at: new Date().toISOString() })],
  );
  const call = await getCall(id);
  await notify(call.user_id, "review", `Your call ${call.call_code} was reviewed`, review.note ?? null, `/sales/calls/${id}`);
  return call;
}
