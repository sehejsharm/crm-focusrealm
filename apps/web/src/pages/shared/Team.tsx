import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, CalendarDays, Clock, PhoneCall, Rocket, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AreaChart, Stat } from "../../components/charts";
import { Avatar, Badge, Card, CardHeader, PageHeader, Progress, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, cn, minutes, scoreTone, todayISO } from "../../lib/format";
import { Grade } from "./Reports";

/** Live view of the sales team's work — for sales heads, founders and Legion. */
export default function Team() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayISO());
  const q = useQuery({ queryKey: ["team", date], queryFn: () => api.get<any>(`/dashboard/team?date=${date}`), refetchInterval: 30_000 });
  const d = q.data;
  const base = `/${user?.portal}`;
  const online = (t: string | null) => Boolean(t && Date.now() - new Date(t).getTime() < 10 * 60_000);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Team pulse"
        title="Sales team, live"
        subtitle="Who's calling, who's connecting, who needs help — updated as it happens."
        actions={<div className="flex h-10 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3 shadow-xs"><CalendarDays className="size-4 text-muted" /><input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="bg-transparent text-sm text-fg outline-none" /></div>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Team calls" value={d?.totals.calls} icon={<PhoneCall className="size-4" />} spark={(d?.series ?? []).map((s: any) => s.calls)} />
        <Stat label="Connected" value={d?.totals.connected} icon={<Activity className="size-4" />} foot={d ? `${d.totals.calls ? Math.round((d.totals.connected / d.totals.calls) * 100) : 0}% connect rate` : undefined} delay={0.05} />
        <Stat label="Talk time" value={d ? Math.round(d.totals.talk_sec / 60) : null} suffix=" min" icon={<Clock className="size-4" />} delay={0.1} />
        <Stat label="Meetings booked" value={d?.totals.meetings} icon={<Rocket className="size-4" />} accent delay={0.15} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Leaderboard" subtitle="Ranked by calls today" icon={<Trophy className="size-4" />} />
          <div className="overflow-x-auto px-2 pb-3">
            {q.isLoading && <Skeleton className="m-3 h-64" />}
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted"><tr><th className="px-3 py-2 font-semibold">Salesperson</th><th className="px-3 py-2 font-semibold">Calls vs target</th><th className="px-3 py-2 text-center font-semibold">Connected</th><th className="px-3 py-2 text-center font-semibold">Meetings</th><th className="px-3 py-2 text-center font-semibold">AI score</th><th className="px-3 py-2 text-center font-semibold">Overdue</th><th className="px-3 py-2 text-center font-semibold">Report</th></tr></thead>
              <tbody>
                {d?.people.map((p: any, i: number) => (
                  <motion.tr key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="border-t border-line hover:bg-surface-hover">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="w-5 text-center text-sm">{["🥇", "🥈", "🥉"][i] ?? <span className="text-subtle">{i + 1}</span>}</span>
                        <Avatar name={p.full_name} hue={p.avatar_hue} size={34} online={online(p.last_active_at)} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-fg">{p.full_name}</p>
                          <p className="truncate text-[11px] text-muted">{p.last_call_at ? `last call ${ago(p.last_call_at)}` : "no calls yet"} · {p.active_prospects} active{p.source === "hr" ? " · via HR" : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><div className="w-36"><div className="mb-1 flex justify-between text-xs"><b className="text-fg">{p.calls}</b><span className="text-muted">/ {p.daily_call_target}</span></div><Progress value={p.calls} max={p.daily_call_target} tone={p.calls >= p.daily_call_target ? "success" : "brand"} /></div></td>
                    <td className="px-3 py-2.5 text-center font-semibold text-fg">{p.connected}<span className="block text-[11px] font-normal text-muted">{minutes(p.talk_sec)}</span></td>
                    <td className="px-3 py-2.5 text-center text-base font-bold text-fg">{p.meetings || "—"}</td>
                    <td className="px-3 py-2.5 text-center">{p.avg_score != null ? <Badge tone={scoreTone(p.avg_score)}>{p.avg_score}</Badge> : <span className="text-subtle">—</span>}</td>
                    <td className="px-3 py-2.5 text-center">{p.overdue ? <Badge tone="danger">{p.overdue}</Badge> : <span className="text-subtle">0</span>}</td>
                    <td className="px-3 py-2.5 text-center">{p.report_id ? <Link to={`${base}/reports/${p.report_id}`} className="inline-block"><Grade grade={p.report_grade} size={30} /></Link> : <span className="text-xs text-subtle">tonight</span>}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card delay={0.1}>
          <CardHeader title="Live activity" subtitle="Everything the team does, as it happens" icon={<Users className="size-4" />} />
          <div className="max-h-[560px] space-y-0.5 overflow-y-auto px-3 pb-4">
            {d?.feed.map((a: any, i: number) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }} className="flex gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover">
                <Avatar name={a.user_name ?? "System"} hue={a.avatar_hue} size={28} />
                <div className="min-w-0 flex-1 text-[13px]">
                  <p className="text-fg"><b>{a.user_name?.split(" ")[0] ?? "System"}</b> <span className="text-muted">·</span> {a.contact_id ? <Link to={`${base}/contacts/${a.contact_id}`} className="hover:text-accent">{a.title}</Link> : a.title}</p>
                  <p className="text-[11px] text-subtle">{a.contact_name ? `${a.contact_name} · ` : ""}{ago(a.created_at)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      </div>

      <Card delay={0.15}>
        <CardHeader title="Team trend · 14 days" icon={<Activity className="size-4" />} />
        <div className={cn("px-4 pb-4")}>
          {d ? <AreaChart data={d.series} series={[{ key: "calls", label: "Calls", color: "var(--series-1)" }, { key: "connected", label: "Connected", color: "var(--series-2)" }]} /> : <Skeleton className="h-56" />}
        </div>
      </Card>
    </div>
  );
}
