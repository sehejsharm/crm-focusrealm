import { motion } from "motion/react";
import { ArrowRight, CalendarCheck, CheckCircle2, Phone, Rocket } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn, fmtTime } from "../lib/format";
import { Avatar, Card, CardHeader, Empty } from "./ui";

export interface FloorPerson {
  id: string;
  full_name: string;
  avatar_hue: number;
  role: string;
  calls: number;
  connected: number;
  meetings: number;
  daily_call_target: number;
  on_call: boolean;
  last_call_at: string | null;
  report_grade: string | null;
  report_id: string | null;
}

/**
 * The sales floor right now: one tile per salesperson — on a call (pulsing),
 * calls against today's target, conversations and meetings booked.
 */
export function LiveFloor({ people, base, dark }: { people: FloorPerson[]; base: string; dark?: boolean }) {
  const reps = people.filter((p) => p.role === "sales_rep" || p.calls > 0);
  if (!reps.length) return <p className={cn("text-sm", dark ? "text-white/70" : "text-muted")}>No salespeople yet — they arrive from the HR console.</p>;
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {reps.map((p, i) => {
        const pct = Math.min(100, Math.round((p.calls / Math.max(1, p.daily_call_target)) * 100));
        const idle = !p.on_call && (!p.last_call_at || Date.now() - new Date(p.last_call_at).getTime() > 90 * 60_000);
        return (
          <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Link
              to={`${base}/team`}
              className={cn(
                "flex items-center gap-3 rounded-2xl p-3 transition",
                dark ? "bg-white/10 ring-1 ring-white/15 hover:bg-white/15" : "bg-surface ring-1 ring-line hover:ring-brand-300",
              )}
            >
              <span className="relative">
                {p.on_call && <span className="absolute -inset-1 animate-ping rounded-full bg-emerald-400/40" />}
                <Avatar name={p.full_name} hue={p.avatar_hue} size={38} className={cn("relative", p.on_call && "ring-2 ring-emerald-400")} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("flex items-center gap-1.5 truncate text-[13px] font-semibold", dark ? "text-white" : "text-fg")}>
                  {p.full_name.split(" ")[0]}
                  {p.on_call ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-400/20 px-1.5 py-px text-[10px] font-bold text-emerald-500"><Phone className="size-2.5" /> on a call</span>
                  ) : idle ? (
                    <span className={cn("text-[10px] font-semibold", dark ? "text-white/50" : "text-subtle")}>idle</span>
                  ) : null}
                </span>
                <span className={cn("mt-1 block h-1.5 overflow-hidden rounded-full", dark ? "bg-white/15" : "bg-sunken")}>
                  <motion.span
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 1, delay: 0.2 + i * 0.04 }}
                    className={cn("block h-full rounded-full", pct >= 100 ? "bg-emerald-400" : dark ? "bg-sky" : "bg-brand-500")}
                  />
                </span>
                <span className={cn("mt-1 flex items-center gap-2 text-[11px] tabular-nums", dark ? "text-white/70" : "text-muted")}>
                  {p.calls}/{p.daily_call_target} calls · {p.connected} talks
                  {p.meetings > 0 && <span className="flex items-center gap-0.5 font-bold text-emerald-500"><Rocket className="size-3" />{p.meetings}</span>}
                </span>
              </span>
              {p.report_grade && <span className={cn("rounded-lg px-1.5 py-0.5 text-[11px] font-black", dark ? "bg-white/15 text-white" : "bg-accent-soft text-accent-soft-fg")}>{p.report_grade}</span>}
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Upcoming meetings grouped by day, so a busy week reads like a calendar. */
export function Agenda({
  meetings, base, limit = 8, title = "Upcoming Legion meetings", who,
}: {
  meetings: { id: string; stage: string; scheduled_at: string; contact_name: string; company_name: string | null; contact_id?: string; legion_name?: string | null; sales_name?: string | null }[];
  base: string;
  limit?: number;
  title?: string;
  who?: "legion" | "sales";
}) {
  const upcoming = meetings.filter((m) => new Date(m.scheduled_at).getTime() > Date.now() - 2 * 3600_000).slice(0, limit);
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));
  const today = dayKey(new Date().toISOString());
  const tomorrow = dayKey(new Date(Date.now() + 86400_000).toISOString());
  const groups = new Map<string, typeof upcoming>();
  for (const m of upcoming) groups.set(dayKey(m.scheduled_at), [...(groups.get(dayKey(m.scheduled_at)) ?? []), m]);
  const dayLabel = (k: string) =>
    k === today ? "Today" : k === tomorrow ? "Tomorrow" : new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${k}T12:00:00+05:30`));
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={meetings.length > upcoming.length ? `Next ${upcoming.length} of ${meetings.length}` : undefined}
        icon={<CalendarCheck className="size-4" />}
        action={<Link to={base === "/legion" ? "/legion/meetings" : `${base}/pipeline`} className="text-xs font-semibold text-accent hover:underline">All →</Link>}
      />
      {upcoming.length === 0 ? (
        <Empty icon={<CalendarCheck className="size-6" />} title="Nothing scheduled" body="New Legion meetings appear here as the sales team books them." />
      ) : (
        <div className="space-y-4 px-5 pb-5">
          {[...groups.entries()].map(([k, list]) => (
            <div key={k}>
              <p className={cn("mb-1.5 text-[11px] font-bold tracking-wide uppercase", k === today ? "text-accent" : "text-subtle")}>{dayLabel(k)}</p>
              <div className="relative space-y-1 border-l-2 border-line pl-3">
                {list.map((m) => (
                  <Link key={m.id} to={m.contact_id ? `${base}/contacts/${m.contact_id}` : base === "/legion" ? "/legion/meetings" : `${base}/pipeline`} className="group relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-surface-hover">
                    <span className="absolute top-1/2 -left-[19px] size-2.5 -translate-y-1/2 rounded-full border-2 border-surface bg-brand-500" />
                    <span className="w-16 shrink-0 text-xs font-bold text-fg tabular-nums">{fmtTime(m.scheduled_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg group-hover:text-accent">{m.contact_name}</span>
                      <span className="block truncate text-xs text-muted">{m.company_name ?? "—"}{who === "sales" && m.sales_name ? ` · booked by ${m.sales_name.split(" ")[0]}` : m.legion_name ? ` · ${m.legion_name.split(" ")[0]}` : ""}</span>
                    </span>
                    <span className="rounded-lg bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent-soft-fg">{m.stage === "legion_meet_3" ? "Meet 3" : m.stage === "legion_meet_2" ? "Meet 2" : "Meet 1"}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export interface AttentionItem {
  key: string;
  count: number;
  title: string;
  /** Wording when there's exactly one. */
  one?: string;
  body: string;
  to: string;
  icon: ReactNode;
  tone?: "danger" | "warning" | "brand";
}

/** Things that need a decision today, most urgent first. Hidden when zero. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  const open = items.filter((i) => i.count > 0);
  return (
    <Card className="h-full">
      <CardHeader title="Needs your attention" subtitle={open.length ? `${open.length} thing${open.length === 1 ? "" : "s"} to look at` : "Nothing waiting on you"} icon={<CheckCircle2 className="size-4" />} />
      {open.length === 0 ? (
        <Empty icon={<CheckCircle2 className="size-6" />} title="All clear" body="No handoffs, reviews or stuck work waiting." />
      ) : (
        <div className="space-y-1.5 px-3 pb-4">
          {open.map((i, n) => (
            <motion.div key={i.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: n * 0.04 }}>
              <Link to={i.to} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-surface-hover">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-xl",
                    i.tone === "danger" ? "bg-danger-soft text-danger" : i.tone === "warning" ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent-soft-fg",
                  )}
                >
                  {i.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg"><span className="tabular-nums">{i.count.toLocaleString("en-IN")}</span> {i.count === 1 && i.one ? i.one : i.title}</span>
                  <span className="block truncate text-xs text-muted">{i.body}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-accent" />
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </Card>
  );
}
