import { z } from "zod";
import { db, json } from "../db/index.js";

/**
 * Business settings the founders control from the Founder portal. Each key
 * has a schema and a default; what's stored is merged over the default, so a
 * new field added here never breaks an older stored value.
 */

export const settingSchemas = {
  allocation: z.object({
    /** Prospects handed to each salesperson per batch (proposal: 5–10). */
    batchSize: z.number().int().min(1).max(100),
    /** Ceiling on a salesperson's active prospects. */
    maxActive: z.number().int().min(1).max(1000),
    /** Days without activity before a rep's prospects are flagged for review. */
    inactivityDays: z.number().int().min(1).max(60),
    /** Days a prospect may sit with no next action before it counts as stale. */
    staleDays: z.number().int().min(1).max(60),
    /** Who may reassign: founders always; sales heads when true. */
    headsCanReassign: z.boolean(),
    /** Auto top-up: every morning (Mon–Sat) each active salesperson gets up to
     *  batchSize new prospects from the unassigned pool, never above maxActive. */
    autoEnabled: z.boolean(),
    /** Local time the morning top-up runs, HH:MM. */
    autoTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  reports: z.object({
    enabled: z.boolean(),
    /** Local time the end-of-day run starts, HH:MM. */
    time: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string(),
    /** "end_of_day": analyse all of the day's recordings in the evening run.
     *  "immediate": analyse each recording as soon as it arrives, too. */
    analysisMode: z.enum(["end_of_day", "immediate"]),
    /** Skip weekends (no report when nobody called). */
    skipEmptyDays: z.boolean(),
  }),
  telephony: z.object({
    /**
     * phone_link — the Call button pushes the number to the rep's phone (the
     *   Phone Link screen), which dials it; the recording is uploaded after.
     * bridge — a telephony provider (Exotel/Twilio) rings the rep's phone,
     *   connects the prospect and records both sides automatically.
     * demo — simulated calls, for trying the CRM out.
     */
    mode: z.enum(["phone_link", "bridge", "demo"]),
    /** Play/announce a recording notice at the start of each call. */
    consentNotice: z.boolean(),
    consentText: z.string().max(500),
    /** Days recordings are kept before deletion (0 = keep). */
    retentionDays: z.number().int().min(0).max(3650),
  }),
  hr: z.object({
    /** HR roles/departments that get a CRM login, matched case-insensitively. */
    crmDepartments: z.array(z.string()).max(50),
    /** Title keywords that make someone a sales head instead of a salesperson. */
    headKeywords: z.array(z.string()).max(20),
  }),
  whatsapp: z.object({
    /** One-tap WhatsApp messages. Placeholders: {first_name} {name} {company} {my_name} {my_first_name}. */
    templates: z.array(z.object({ key: z.string().max(40), label: z.string().min(1).max(60), text: z.string().min(1).max(1000) })).max(12),
  }),
  qualification: z.object({
    /** The checklist a prospect must satisfy before it can be handed to Legion. */
    fields: z
      .array(z.object({ key: z.string(), label: z.string(), required: z.boolean() }))
      .max(20),
  }),
};

export type SettingKey = keyof typeof settingSchemas;
export type Settings = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> };

export const defaults: Settings = {
  allocation: { batchSize: 10, maxActive: 60, inactivityDays: 3, staleDays: 7, headsCanReassign: true, autoEnabled: false, autoTime: "09:30" },
  reports: {
    enabled: true,
    time: "20:00",
    timezone: "Asia/Kolkata",
    analysisMode: "end_of_day",
    skipEmptyDays: true,
  },
  telephony: {
    mode: "phone_link",
    consentNotice: true,
    consentText: "This call may be recorded for quality and training purposes.",
    retentionDays: 180,
  },
  hr: {
    crmDepartments: ["sales", "business development", "business-development", "bd", "inside sales"],
    headKeywords: ["head", "lead", "manager", "vp", "director"],
  },
  whatsapp: {
    templates: [
      { key: "intro", label: "After a good call", text: "Hi {first_name}, this is {my_first_name} from Focus Realm. Thanks for your time just now! As discussed, here's a quick overview of how we help businesses like {company}. When suits you for a short meeting with our team?" },
      { key: "missed", label: "Couldn't reach them", text: "Hi {first_name}, this is {my_first_name} from Focus Realm. I tried calling you just now — when would be a good time for a quick 5-minute chat?" },
      { key: "meeting", label: "Meeting reminder", text: "Hi {first_name}, a quick reminder about your meeting with the Focus Realm team. Looking forward to it! — {my_first_name}" },
    ],
  },
  qualification: {
    fields: [
      { key: "decision_maker", label: "Decision-maker identified", required: true },
      { key: "need", label: "Clear need or pain point", required: true },
      { key: "interest", label: "Agreed to a Legion meeting", required: true },
      { key: "budget", label: "Budget indicated", required: false },
      { key: "timeline", label: "Timeline known", required: false },
    ],
  },
};

const cache = new Map<SettingKey, { value: unknown; at: number }>();

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.value as Settings[K];
  const row = await db.maybe<{ value: unknown }>("select value from crm_settings where key = $1", [key]);
  const merged = { ...defaults[key], ...((row?.value as object) ?? {}) };
  const parsed = settingSchemas[key].safeParse(merged);
  const value = (parsed.success ? parsed.data : defaults[key]) as Settings[K];
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function getAllSettings(): Promise<Settings> {
  const out = {} as Record<SettingKey, unknown>;
  for (const key of Object.keys(settingSchemas) as SettingKey[]) out[key] = await getSetting(key);
  return out as Settings;
}

export async function putSetting<K extends SettingKey>(key: K, value: unknown, userId: string | null) {
  const current = await getSetting(key);
  const next = settingSchemas[key].parse({ ...current, ...(value as object) });
  await db.query(
    `insert into crm_settings (key, value, updated_by, updated_at) values ($1, $2::jsonb, $3, now())
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, json(next), userId],
  );
  cache.delete(key);
  return next as Settings[K];
}
