import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { AlarmClock, ArrowRight, Flame, Medal, PhoneCall, PhoneIncoming, Rocket, Sparkles, Timer, Trophy, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CallButton } from "../../components/call";
import { ScoreRing, Stat } from "../../components/charts";
import { Aurora, Counter } from "../../components/motion";
import { Avatar, Badge, Card, CardHeader, Empty, Skeleton, Stagger, staggerItem } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, cn, duration, fmtTime, greeting, label, minutes, OUTCOME_TONE, scoreTone } from "../../lib/format";

export default function MyDay() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["dash", "rep"], queryFn: () => api.get<any>("/dashboard/rep"), refetchInterval: 60_000 });
  const d = q.data;
  const pct = d ? Math.min(100, Math.round((d.kpi.calls_today / Math.max(1, d.target)) * 100)) : 0;
  const spark = (key: string) => (d?.trend ?? []).map((t: any) => t[key] ?? 0);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="noise relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b2a66] via-brand-700 to-brand-500 p-6 text-white shadow-lg sm:p-8"
      >
        <Aurora intensity={0.7} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(255,255,255,0.18),transparent_45%)]" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-white/70">{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date())}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
              {greeting()}, {user?.full_name.split(" ")[0]} <motion.span className="inline-block" animate={{ rotate: [0, 18, -8, 18, 0] }} transition={{ duration: 1.6, delay: 0.6 }}>👋</motion.span>
            </h1>
            <p className="mt-2 max-w-lg text-white/75">
              {d ? (
                d.kpi.calls_today >= d.target ? "Target smashed. Every extra call now is pure upside. 🔥" : `${Math.max(0, d.target - d.kpi.calls_today)} calls to hit today's target — ${d.tasks.length} follow-up${d.tasks.length === 1 ? "" : "s"} waiting.`
              ) : "Loading your day…"}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <HeroChip icon={<PhoneCall className="size-3.5" />} label="Calls" value={d?.kpi.calls_today} />
              <HeroChip icon={<PhoneIncoming className="size-3.5" />} label="Connected" value={d?.kpi.connected_today} />
              <HeroChip icon={<Rocket className="size-3.5" />} label="Meetings" value={d?.kpi.meetings_today} />
            </div>
          </div>
          <div className="relative mx-auto md:mx-0">
            <div className="relative grid size-40 place-items-center">
              <svg viewBox="0 0 160 160" className="absolute inset-0 -rotate-90">
                <circle cx="80" cy="80" r="68" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="12" />
                <motion.circle cx="80" cy="80" r="68" fill="none" stroke="url(#heroRing)" strokeWidth="12" strokeLinecap="round" strokeDasharray={427} initial={{ strokeDashoffset: 427 }} animate={{ strokeDashoffset: 427 * (1 - pct / 100) }} transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }} />
                <defs>
                  <linearGradient id="heroRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#7cc0fa" /></linearGradient>
                </defs>
              </svg>
              <div className="text-center">
                <p className="text-4xl font-bold tracking-tight"><Counter value={d?.kpi.calls_today ?? 0} /></p>
                <p className="text-xs text-white/70">of {d?.target ?? "—"} calls</p>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Calls today" value={d?.kpi.calls_today} icon={<PhoneCall className="size-4" />} spark={spark("calls")} delay={0.05} />
        <Stat label="Talk time" value={d ? Math.round(d.kpi.talk_today / 60) : null} suffix=" min" icon={<Timer className="size-4" />} foot={d ? minutes(d.kpi.talk_today) + " on connected calls" : undefined} delay={0.1} />
        <Stat label="Meetings booked" value={d?.kpi.meetings_today} icon={<Rocket className="size-4" />} spark={spark("meetings")} delay={0.15} />
        <Stat label="AI call score · 7 days" value={d?.kpi.avg_score_week} suffix="/100" icon={<Sparkles className="size-4" />} accent delay={0.2} spark={spark("score")} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1.5fr_1fr]">
        {/* Up next */}
        <Card className="overflow-hidden" delay={0.1}>
          <CardHeader title="Up next" subtitle="Follow-ups due today and overdue" icon={<AlarmClock className="size-4" />} action={<Link to="/sales/follow-ups" className="text-xs font-semibold text-accent hover:underline">All follow-ups →</Link>} />
          <div className="px-3 pb-3">
            {q.isLoading && <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
            {d && d.tasks.length === 0 && <Empty icon={<Trophy className="size-6" />} title="Nothing due — you're ahead" body="Call fresh prospects below to fill tomorrow's pipeline." />}
            <Stagger className="space-y-1.5">
              {d?.tasks.map((t: any) => {
                const overdue = t.due_at && new Date(t.due_at) < new Date();
                return (
                  <motion.div key={t.id} variants={staggerItem} className="group flex items-center gap-3 rounded-2xl border border-transparent p-2.5 transition hover:border-line hover:bg-surface-hover">
                    <div className={cn("relative grid size-11 shrink-0 place-items-center rounded-xl text-xs font-bold", overdue ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-soft-fg")}>
                      {overdue && <span className="absolute inset-0 animate-ping rounded-xl bg-danger/20" />}
                      <span className="relative">{t.due_at ? fmtTime(t.due_at).replace(" ", "") : "—"}</span>
                    </div>
                    <Link to={t.contact_id ? `/sales/contacts/${t.contact_id}` : "/sales/follow-ups"} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">{t.contact_name ?? t.title}</p>
                      <p className="truncate text-xs text-muted">{t.company_name ?? ""}{t.reason ? ` · ${t.reason}` : ""}</p>
                    </Link>
                    {overdue && <Badge tone="danger" dot pulse>Overdue</Badge>}
                    {t.contact_id && <CallButton size="sm" contact={{ id: t.contact_id, full_name: t.contact_name, company_name: t.company_name, phone_key: t.contact_phone }} />}
                  </motion.div>
                );
              })}
            </Stagger>
          </div>
        </Card>

        {/* Coaching */}
        <Card className="relative overflow-hidden" delay={0.15}>
          <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-brand-400/15 blur-3xl" />
          <CardHeader title="Your latest coaching" subtitle="From the AI's analysis of your last call" icon={<Sparkles className="size-4" />} />
          {d?.coaching ? (
            <div className="px-5 pb-5">
              <div className="flex items-center gap-5">
                <ScoreRing value={d.coaching.score} size={104} label="call score" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-muted">{d.coaching.call_code} · {d.coaching.contact_name}</p>
                  {d.coaching.strength && <p className="mt-1.5 text-sm text-fg"><span className="font-semibold text-success">✓ </span>{d.coaching.strength}</p>}
                </div>
              </div>
              {d.coaching.tip && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-4 rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-surface p-4 dark:border-brand-900 dark:from-brand-950/50">
                  <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-accent-soft-fg uppercase"><Zap className="size-3.5" /> Try this next call</p>
                  <p className="mt-1.5 text-sm font-semibold text-fg">{d.coaching.tip.issue}</p>
                  <p className="mt-1 text-sm text-muted">{d.coaching.tip.suggestion}</p>
                  <p className="mt-2 text-sm text-accent-soft-fg italic">{d.coaching.tip.example_line}</p>
                </motion.div>
              )}
              <Link to={`/sales/calls/${d.coaching.id}`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Full breakdown <ArrowRight className="size-4" /></Link>
            </div>
          ) : (
            <Empty icon={<Sparkles className="size-6" />} title="No analysed calls yet" body="Make a call and attach the recording — your coaching lands here." />
          )}
        </Card>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        {/* Fresh prospects */}
        <Card className="xl:col-span-2" delay={0.2}>
          <CardHeader title="Fresh prospects" subtitle="Newly allocated to you — first call wins" icon={<Flame className="size-4" />} action={<Link to="/sales/prospects" className="text-xs font-semibold text-accent hover:underline">All prospects →</Link>} />
          <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
            {d?.fresh.length === 0 && <Empty className="sm:col-span-2" icon={<Flame className="size-6" />} title="No new prospects right now" body="Your sales head allocates fresh batches — they'll appear here instantly." />}
            {d?.fresh.map((c: any, i: number) => (
              <motion.div key={c.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25 + i * 0.04 }} whileHover={{ y: -2 }} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-xs">
                <Avatar name={c.full_name} hue={200 + (i * 7) % 40} size={38} />
                <Link to={`/sales/contacts/${c.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{c.full_name}</p>
                  <p className="truncate text-xs text-muted">{c.designation ? `${c.designation}, ` : ""}{c.company_name ?? c.city}</p>
                </Link>
                <CallButton size="sm" contact={c} label="" />
              </motion.div>
            ))}
          </div>
        </Card>

        {/* Leaderboard */}
        <Card delay={0.25}>
          <CardHeader title="This week's leaderboard" subtitle="Meetings booked, then calls" icon={<Medal className="size-4" />} />
          <div className="space-y-1 px-3 pb-4">
            {d?.leaderboard.map((p: any, i: number) => {
              const me = p.id === user?.id;
              const max = Math.max(1, ...d.leaderboard.map((x: any) => x.calls));
              return (
                <motion.div key={p.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }} className={cn("relative flex items-center gap-3 overflow-hidden rounded-xl px-2.5 py-2", me && "bg-accent-soft ring-1 ring-brand-200 dark:ring-brand-900")}>
                  <span className={cn("w-5 text-center text-sm font-bold", i < 3 ? "text-base" : "text-subtle")}>{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                  <Avatar name={p.full_name} hue={p.avatar_hue} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-fg">{p.full_name}{me && " (you)"}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" initial={{ width: 0 }} animate={{ width: `${(p.calls / max) * 100}%` }} transition={{ duration: 1, delay: 0.4 + i * 0.05 }} />
                    </div>
                  </div>
                  <span className="text-right text-xs leading-tight">
                    <span className="block font-bold text-fg">{p.meetings} 🚀</span>
                    <span className="text-muted">{p.calls} calls</span>
                  </span>
                </motion.div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Recent calls */}
      <Card delay={0.3}>
        <CardHeader title="Recent calls" icon={<PhoneCall className="size-4" />} action={<Link to="/sales/calls" className="text-xs font-semibold text-accent hover:underline">Call history →</Link>} />
        <div className="divide-y divide-line px-2 pb-2">
          {d?.recent.map((k: any, i: number) => (
            <motion.div key={k.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.03 }}>
              <Link to={`/sales/calls/${k.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-surface-hover">
                <span className="w-14 shrink-0 text-xs text-muted">{ago(k.started_at)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{k.contact_name} <span className="font-normal text-muted">· {k.company_name}</span></span>
                <Badge tone={OUTCOME_TONE[k.outcome] ?? "neutral"}>{label(k.outcome)}</Badge>
                <span className="hidden w-12 text-right font-mono text-xs text-muted sm:block">{duration(k.duration_sec)}</span>
                {k.score != null ? <Badge tone={scoreTone(k.score)} className="w-14 justify-center">{k.score}</Badge> : <span className="w-14" />}
              </Link>
            </motion.div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function HeroChip({ icon, label, value }: { icon: ReactNode; label: string; value: number | undefined }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-sm backdrop-blur">
      {icon}
      <span className="font-bold"><Counter value={value ?? 0} /></span>
      <span className="text-white/70">{label}</span>
    </span>
  );
}
