import { env } from "../env.js";

/** Today's date (YYYY-MM-DD) in the CRM's business timezone (IST by default). */
export function todayLocal(d = new Date(), tz = env.timezone): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** UTC instants bounding a local calendar day — for "calls made today" queries. */
export function dayBounds(date: string, tz = env.timezone): { from: Date; to: Date } {
  // Find the offset of the timezone on that date by formatting noon UTC.
  const noon = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(noon);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const localNoonAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offsetMs = localNoonAsUtc - noon.getTime();
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - offsetMs);
  return { from, to: new Date(from.getTime() + 24 * 3600 * 1000) };
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
