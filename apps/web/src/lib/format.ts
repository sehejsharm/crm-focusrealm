import clsx, { type ClassValue } from "clsx";

export const cn = (...v: ClassValue[]) => clsx(v);

export const STAGES = [
  { key: "prospect", label: "Prospect", hint: "Identified and available for outreach" },
  { key: "qualified", label: "Qualified", hint: "Qualification criteria met" },
  { key: "legion_meet_1", label: "Legion Meet 1", hint: "First meeting stage" },
  { key: "legion_meet_2", label: "Legion Meet 2", hint: "Second meeting stage" },
  { key: "legion_meet_3", label: "Legion Meet 3", hint: "Third meeting stage" },
] as const;

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  outreach: "Outreach",
  follow_up: "Follow-up",
  qualification_review: "Qualification review",
  qualified: "Qualified",
  handoff_pending: "Handoff pending",
  handed_off: "With Legion",
  returned: "Returned",
  closed_won: "Won",
  closed_lost: "Lost",
  disqualified: "Disqualified",
};

export const STATUS_TONE: Record<string, Tone> = {
  new: "brand",
  outreach: "info",
  follow_up: "warning",
  qualification_review: "violet",
  qualified: "success",
  handoff_pending: "violet",
  handed_off: "brand",
  returned: "danger",
  closed_won: "success",
  closed_lost: "neutral",
  disqualified: "neutral",
};

export const OUTCOMES = [
  { key: "meeting_booked", label: "Meeting booked", emoji: "🚀", tone: "success" },
  { key: "interested", label: "Interested", emoji: "🔥", tone: "success" },
  { key: "follow_up_agreed", label: "Follow-up agreed", emoji: "🤝", tone: "brand" },
  { key: "callback_requested", label: "Call back later", emoji: "⏰", tone: "info" },
  { key: "not_interested", label: "Not interested", emoji: "🙅", tone: "neutral" },
  { key: "no_answer", label: "No answer", emoji: "📵", tone: "neutral" },
  { key: "busy", label: "Busy", emoji: "⛔", tone: "warning" },
  { key: "switched_off", label: "Switched off", emoji: "🔌", tone: "neutral" },
  { key: "wrong_number", label: "Wrong number", emoji: "❌", tone: "danger" },
  { key: "do_not_call", label: "Do not call", emoji: "🚫", tone: "danger" },
] as const;

export const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));
export const OUTCOME_TONE: Record<string, Tone> = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.tone as Tone]));
export const CONNECTED = ["meeting_booked", "interested", "follow_up_agreed", "callback_requested", "not_interested", "do_not_call"];

export const ROLE_LABEL: Record<string, string> = {
  founder: "Founder",
  sales_head: "Sales Head",
  sales_rep: "Sales Team",
  legion: "Legion",
};

export const SKILL_LABEL: Record<string, string> = {
  opening: "Opening",
  rapport: "Rapport",
  discovery: "Discovery",
  active_listening: "Listening",
  value_proposition: "Value pitch",
  objection_handling: "Objections",
  closing: "Closing",
  tone_confidence: "Confidence",
  clarity_pace: "Clarity & pace",
  professionalism: "Professionalism",
};

export type Tone = "brand" | "success" | "warning" | "danger" | "info" | "neutral" | "violet";

export function label(s: string | null | undefined) {
  if (!s) return "—";
  return STATUS_LABEL[s] ?? OUTCOME_LABEL[s] ?? STAGES.find((x) => x.key === s)?.label ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const TZ = "Asia/Kolkata";

export function fmtDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...opts }).format(new Date(d));
}

export function fmtTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

export function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

export function ago(d: string | Date | null | undefined) {
  if (!d) return "never";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  const fut = s < 0;
  const a = Math.abs(s);
  const v =
    a < 45 ? "just now" : a < 3600 ? `${Math.round(a / 60)}m` : a < 86400 ? `${Math.round(a / 3600)}h` : a < 86400 * 30 ? `${Math.round(a / 86400)}d` : fmtDate(d);
  if (v === "just now" || v.includes(" ")) return v;
  return fut ? `in ${v}` : `${v} ago`;
}

export function duration(sec: number | null | undefined) {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function minutes(sec: number | null | undefined) {
  if (!sec) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function phone(key: string | null | undefined) {
  if (!key) return "—";
  if (key.startsWith("91") && key.length === 12) return `+91 ${key.slice(2, 7)} ${key.slice(7)}`;
  return `+${key}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function scoreTone(score: number | null | undefined, max = 100): Tone {
  if (score == null) return "neutral";
  const p = (score / max) * 100;
  return p >= 75 ? "success" : p >= 60 ? "brand" : p >= 45 ? "warning" : "danger";
}

export const TONE_TEXT: Record<Tone, string> = {
  brand: "text-accent-soft-fg",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-muted",
  violet: "text-violet-600 dark:text-violet-300",
};

export const TONE_HEX: Record<Tone, string> = {
  brand: "#1a6ae0",
  success: "#0f9d6b",
  warning: "#c27a06",
  danger: "#d93a4a",
  info: "#0e8ac7",
  neutral: "#8492a7",
  violet: "#7c5cff",
};

export function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** A datetime-local value for "tomorrow 11:00" etc., in the browser's time. */
export function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
