import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, ChevronRight, Handshake, Inbox, Swords, Trophy, Users } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Agenda, LiveFloor } from "../../components/dashboard";
import { Aurora, Counter } from "../../components/motion";
import { Avatar, Card, CardHeader, Empty, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, cn } from "../../lib/format";
import { HandoffCard } from "./Handoffs";

/** Legion HQ: the pipeline at a glance, the inbox, the week's meetings and the sales floor, live. */
export default function LegionHome() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["dash", "legion"], queryFn: () => api.get<any>("/dashboard/legion"), refetchInterval: 20_000 });
  const d = q.data;
  const base = `/${user?.portal}`;
  const isLegion = user?.role === "legion";
  const stage = (k: string) => d?.pipeline.find((p: any) => p.stage === k)?.count ?? 0;
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const meetingsToday = (d?.meetings ?? []).filter((m: any) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(m.scheduled_at)) === todayKey).length;
  const track = [
    { label: "Handoffs waiting", value: d?.handoffs.length ?? 0, to: isLegion ? "/legion/handoffs" : undefined, hot: (d?.handoffs.length ?? 0) > 0 },
    { label: "Qualified", value: stage("qualified") },
    { label: "Legion Meet 1", value: stage("legion_meet_1") },
    { label: "Legion Meet 2", value: stage("legion_meet_2") },
    { label: "Won · 30 days", value: d?.won.month ?? 0, win: true },
  ];

  return (
    <div className="space-y-6">
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="noise relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#071630] via-[#0b2a66] to-brand-700 p-6 text-white shadow-lg sm:p-8">
        <Aurora intensity={0.6} />
        <motion.div className="pointer-events-none absolute -right-10 -bottom-16 opacity-10" animate={{ rotate: [0, 8, 0] }} transition={{ duration: 8, repeat: Infinity }}>
          <Swords className="size-72" />
        </motion.div>
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-sky uppercase"><Swords className="size-4" /> Legion HQ</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Turn qualified into closed.</h1>
            <p className="mt-2 max-w-xl text-white/70">
              {meetingsToday ? `${meetingsToday} Legion meeting${meetingsToday === 1 ? "" : "s"} today` : "No Legion meetings today"} · {d?.team.totals.calls ?? 0} sales calls so far
            </p>
          </div>
          {isLegion && d && (
            <div className="flex gap-2.5">
              <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15"><p className="flex items-center gap-1.5 text-[11px] text-white/70"><Trophy className="size-3.5" /> Won by you</p><p className="mt-0.5 text-2xl font-bold"><Counter value={d.mine.won} /></p></div>
              <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15"><p className="flex items-center gap-1.5 text-[11px] text-white/70"><Swords className="size-3.5" /> Open with you</p><p className="mt-0.5 text-2xl font-bold"><Counter value={d.mine.open} /></p></div>
            </div>
          )}
        </div>

        {/* the pipeline as one track */}
        <div className="relative mt-6 flex items-stretch gap-1.5 overflow-x-auto pb-1">
          {track.map((t, i) => {
            const body = (
              <div className={cn(
                "h-full min-w-32 rounded-2xl px-4 py-3 ring-1 backdrop-blur transition",
                t.win ? "bg-emerald-400/20 ring-emerald-300/40" : t.hot ? "bg-white/15 ring-2 ring-amber-300" : "bg-white/10 ring-white/15",
                t.to && "hover:bg-white/20",
              )}>
                <p className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-white/70">{t.hot && <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />}{t.label}</p>
                <p className="mt-0.5 text-3xl font-bold tabular-nums"><Counter value={t.value} /></p>
              </div>
            );
            return (
              <Fragment key={t.label}>
                {i > 0 && <ChevronRight className="size-5 shrink-0 self-center text-white/40" />}
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.07 }} className="flex-1">
                  {t.to ? <Link to={t.to} className="block h-full">{body}</Link> : body}
                </motion.div>
              </Fragment>
            );
          })}
        </div>
      </motion.section>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold text-fg"><Inbox className="size-5 text-accent" /> Handoff inbox {d?.handoffs.length ? <span className="rounded-full bg-amber-400 px-2 text-xs font-black text-white">{d.handoffs.length}</span> : null}</h2>
            {isLegion && <Link to="/legion/handoffs" className="text-xs font-semibold text-accent hover:underline">Open inbox →</Link>}
          </div>
          {q.isLoading ? <Skeleton className="h-48" /> : !d?.handoffs.length ? (
            <Card><Empty icon={<Handshake className="size-6" />} title="No handoffs waiting" body="The sales team's qualified prospects arrive here." /></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">{d.handoffs.slice(0, 6).map((h: any, i: number) => <HandoffCard key={h.id} h={h} i={i} compact />)}</div>
          )}
        </div>
        <Agenda meetings={d?.meetings ?? []} base={base} limit={10} title="Meetings this week" who="sales" />
      </div>

      <Card>
        <CardHeader title="The sales floor, live" subtitle="Who's on a call, and how today's calling is going" icon={<Users className="size-4" />} action={<Link to={`${base}/team`} className="text-xs font-semibold text-accent hover:underline">Team pulse →</Link>} />
        <div className="px-5 pb-5">{d ? <LiveFloor people={d.team.people} base={base} /> : <Skeleton className="h-20" />}</div>
      </Card>

      <Card>
        <CardHeader title="Live from the floor" subtitle="Calls, outcomes and handoffs as they happen" icon={<Activity className="size-4" />} />
        <div className="grid max-h-[420px] gap-x-4 overflow-y-auto px-3 pb-4 md:grid-cols-2">
          {(d?.team.feed ?? []).filter((a: any) => !String(a.title).startsWith("Call started")).slice(0, 30).map((a: any) => (
            <div key={a.id} className="flex gap-3 rounded-xl px-2 py-2 text-[13px] hover:bg-surface-hover">
              <Avatar name={a.user_name ?? "System"} hue={a.avatar_hue} size={26} />
              <div className="min-w-0 flex-1"><p className="truncate text-fg"><b>{a.user_name?.split(" ")[0] ?? "System"}</b> · {a.title}</p><p className="text-[11px] text-subtle">{a.contact_name ? `${a.contact_name} · ` : ""}{ago(a.created_at)}</p></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
