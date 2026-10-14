import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, CalendarCheck, Handshake, Inbox, PhoneCall, Rocket, Swords, Trophy, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Stat } from "../../components/charts";
import { Aurora, Counter } from "../../components/motion";
import { Avatar, Badge, Card, CardHeader, Empty, Progress, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, fmtDateTime, scoreTone } from "../../lib/format";
import { HandoffCard } from "./Handoffs";

/** Legion HQ: the inbox, the meetings, and a live window into the sales team's work. */
export default function LegionHome() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["dash", "legion"], queryFn: () => api.get<any>("/dashboard/legion"), refetchInterval: 30_000 });
  const d = q.data;
  const base = `/${user?.portal}`;
  const stage = (k: string) => d?.pipeline.find((p: any) => p.stage === k)?.count ?? 0;
  return (
    <div className="space-y-6">
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="noise relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#071630] via-[#0b2a66] to-brand-700 p-6 text-white shadow-lg sm:p-8">
        <Aurora intensity={0.6} />
        <motion.div className="pointer-events-none absolute -right-10 -bottom-16 opacity-10" animate={{ rotate: [0, 8, 0] }} transition={{ duration: 8, repeat: Infinity }}>
          <Swords className="size-72" />
        </motion.div>
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-sky uppercase"><Swords className="size-4" /> Legion HQ</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Turn qualified into closed.</h1>
          <p className="mt-2 max-w-xl text-white/70">Handoffs from the sales team, your Legion meetings, and everything the sales floor is doing — live.</p>
          <div className="mt-6 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Waiting handoffs", d?.handoffs.length ?? 0],
              ["Qualified", stage("qualified")],
              ["In Meet 1", stage("legion_meet_1")],
              ["In Meet 2", stage("legion_meet_2")],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                <p className="text-[11px] text-white/70">{l}</p>
                <p className="mt-0.5 text-3xl font-bold"><Counter value={v as number} /></p>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Won by you" value={d?.mine.won} icon={<Trophy className="size-4" />} accent />
        <Stat label="Open with you" value={d?.mine.open} icon={<Swords className="size-4" />} delay={0.05} />
        <Stat label="Sales calls today" value={d?.team.totals.calls} icon={<PhoneCall className="size-4" />} delay={0.1} spark={(d?.team.series ?? []).map((s: any) => s.calls)} />
        <Stat label="Meetings booked today" value={d?.team.totals.meetings} icon={<Rocket className="size-4" />} delay={0.15} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg"><Inbox className="size-5 text-accent" /> Handoff inbox</h2>
            <Link to={`${base === "/founder" ? "/legion" : base}/handoffs`} className="text-xs font-semibold text-accent hover:underline">{base === "/legion" ? "Open inbox →" : ""}</Link>
          </div>
          {q.isLoading ? <Skeleton className="h-48" /> : !d?.handoffs.length ? (
            <Card><Empty icon={<Handshake className="size-6" />} title="No handoffs waiting" body="The sales team's qualified prospects arrive here." /></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">{d.handoffs.slice(0, 6).map((h: any, i: number) => <HandoffCard key={h.id} h={h} i={i} compact />)}</div>
          )}
        </div>
        <Card delay={0.1}>
          <CardHeader title="Upcoming Legion meetings" icon={<CalendarCheck className="size-4" />} action={base === "/legion" && <Link to="/legion/meetings" className="text-xs font-semibold text-accent hover:underline">All →</Link>} />
          <div className="relative space-y-1 px-3 pb-4">
            {(d?.meetings ?? []).length === 0 && <p className="px-2 py-4 text-sm text-muted">Nothing booked yet.</p>}
            {(d?.meetings ?? []).map((m: any, i: number) => (
              <motion.div key={m.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                <Link to={`${base}/contacts/${m.contact_id}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-hover">
                  <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-[11px] font-black text-white">{m.stage === "legion_meet_1" ? "M1" : "M2"}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-fg">{m.contact_name}</p><p className="truncate text-xs text-muted">{m.company_name} · {fmtDateTime(m.scheduled_at)}</p></div>
                  <Badge tone="neutral">{m.sales_name?.split(" ")[0]}</Badge>
                </Link>
              </motion.div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Sales team today" subtitle="Who's feeding the Legion pipeline" icon={<Users className="size-4" />} action={<Link to={`${base}/team`} className="text-xs font-semibold text-accent hover:underline">Team pulse →</Link>} />
          <div className="space-y-1 px-3 pb-4">
            {(d?.team.people ?? []).map((p: any, i: number) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <Avatar name={p.full_name} hue={p.avatar_hue} size={32} online={p.last_active_at ? Date.now() - new Date(p.last_active_at).getTime() < 600_000 : false} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between text-sm"><span className="truncate font-semibold text-fg">{p.full_name}</span><span className="text-xs text-muted">{p.calls}/{p.daily_call_target} calls · {p.meetings} 🚀</span></div>
                  <Progress value={p.calls} max={p.daily_call_target} className="mt-1" height={5} />
                </div>
                {p.avg_score != null && <Badge tone={scoreTone(p.avg_score)}>{p.avg_score}</Badge>}
              </motion.div>
            ))}
          </div>
        </Card>
        <Card delay={0.1}>
          <CardHeader title="Live from the floor" icon={<Activity className="size-4" />} />
          <div className="max-h-[420px] space-y-0.5 overflow-y-auto px-3 pb-4">
            {(d?.team.feed ?? []).slice(0, 30).map((a: any) => (
              <div key={a.id} className="flex gap-3 rounded-xl px-2 py-2 text-[13px] hover:bg-surface-hover">
                <Avatar name={a.user_name ?? "System"} hue={a.avatar_hue} size={26} />
                <div className="min-w-0 flex-1"><p className="text-fg"><b>{a.user_name?.split(" ")[0] ?? "System"}</b> · {a.title}</p><p className="text-[11px] text-subtle">{a.contact_name ? `${a.contact_name} · ` : ""}{ago(a.created_at)}</p></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
