import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Activity, AlarmClock, BrainCircuit, CheckCircle2, Cpu, Crown, FileWarning, Handshake, Inbox, Lightbulb, Mail, MessageSquareWarning,
  Mic, Phone, PhoneCall, Rocket, ShieldAlert, Target, Trophy, UserX, XCircle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AreaChart, BarList, Funnel, Stat } from "../../components/charts";
import { Agenda, AttentionList, LiveFloor, type AttentionItem } from "../../components/dashboard";
import { Aurora, Counter } from "../../components/motion";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, cn, label, scoreTone } from "../../lib/format";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Change vs the previous 30 days, as a trend chip (null when there's no baseline). */
function trend(now: number | undefined, before: number | undefined, goodWhenUp = true) {
  if (now == null || !before) return null;
  const v = Math.round(((now - before) / before) * 100);
  return { value: v, good: goodWhenUp ? v >= 0 : v <= 0 };
}

export default function Command() {
  const { user, meta } = useAuth();
  const q = useQuery({ queryKey: ["dash", "founder"], queryFn: () => api.get<any>("/dashboard/founder"), refetchInterval: 60_000 });
  const team = useQuery({ queryKey: ["team", "today"], queryFn: () => api.get<any>("/dashboard/team"), refetchInterval: 20_000 });
  const d = q.data;
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const stage = (k: string) => d?.funnel.find((f: any) => f.stage === k)?.count ?? 0;
  const won = d?.statusCounts.find((s: any) => s.status === "closed_won")?.count ?? 0;
  const r = d?.rates ?? {};
  const p = d?.prevRates ?? {};
  const fc = d?.followUpCompliance ?? { done: 0, missed: 0 };
  const people = team.data?.people ?? [];
  const reps = people.filter((x: any) => x.role === "sales_rep");
  const onCall = people.filter((x: any) => x.on_call).length;
  const target = reps.reduce((a: number, x: any) => a + (x.daily_call_target ?? 0), 0);
  const callsToday = team.data?.totals.calls ?? 0;
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const a = d?.attention ?? {};

  const attention: AttentionItem[] = d
    ? [
        { key: "handoffs", count: d.handoffsPending, title: "handoffs waiting for Legion", one: "handoff waiting for Legion", body: "Qualified prospects the sales team handed over", to: "/founder/legion", icon: <Inbox className="size-4" />, tone: "brand" },
        { key: "overdue", count: d.overdue, title: "overdue follow-ups", one: "overdue follow-up", body: "Promised call-backs that slipped — escalated to sales heads", to: "/founder/tasks", icon: <AlarmClock className="size-4" />, tone: "danger" },
        { key: "reviews", count: a.reviews ?? 0, title: "calls need a human review", one: "call needs a human review", body: "The AI wasn't sure about these analyses", to: "/founder/calls?analysis=needs_review", icon: <ShieldAlert className="size-4" />, tone: "warning" },
        { key: "recordings", count: a.missing_recordings ?? 0, title: "connected calls missing a recording", one: "connected call missing a recording", body: "Last 7 days — no recording means no AI coaching", to: "/founder/calls?recording=missing", icon: <Mic className="size-4" />, tone: "warning" },
        {
          key: "unassigned", count: !a.autoTopUp && reps.length ? d.unassigned : 0, title: "prospects not allocated", one: "prospect not allocated",
          body: "The morning top-up is off — allocate now or switch it on", to: "/founder/allocation", icon: <UserX className="size-4" />, tone: "brand",
        },
        { key: "stale", count: d.stale, title: "stale leads", one: "stale lead", body: `No touch and nothing scheduled in ${d.staleDays}+ days`, to: "/founder/database?filter=stale", icon: <AlarmClock className="size-4" />, tone: "warning" },
        { key: "reports", count: a.failed_reports ?? 0, title: "daily reports couldn't be written", one: "daily report couldn't be written", body: "Open Daily Reports to rebuild them", to: "/founder/reports", icon: <FileWarning className="size-4" />, tone: "danger" },
        { key: "jobs", count: a.failed_jobs ?? 0, title: "background jobs failed", one: "background job failed", body: "Retry them from Settings → System", to: "/founder/settings?tab=system", icon: <Cpu className="size-4" />, tone: "danger" },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ today, live */}
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="noise relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#061a42] via-[#0d3482] to-brand-600 p-6 text-white shadow-lg sm:p-8">
        <Aurora intensity={0.8} />
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-20" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-sky uppercase"><Crown className="size-4" /> Command center</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{greeting}, {user?.full_name.split(" ")[0]}.</h1>
            <p className="mt-2 text-white/70">
              {new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(now)} ·{" "}
              <span className="font-mono tabular-nums">{new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" }).format(now)}</span> IST
            </p>
          </div>
          <div className="flex items-center gap-4">
            <TargetRing value={callsToday} target={target} />
            <div className="grid grid-cols-3 gap-2.5">
              {[
                ["On a call", onCall, <Phone key="i" className="size-4" />],
                ["Calls today", callsToday, <PhoneCall key="i" className="size-4" />],
                ["Meetings today", team.data?.totals.meetings ?? 0, <Rocket key="i" className="size-4" />],
              ].map(([l, v, icon]) => (
                <div key={l as string} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                  <p className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-white/70">{icon}{l}</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums"><Counter value={v as number} /></p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="relative mt-6">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] text-white/60 uppercase">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>
            Live floor
          </p>
          {team.data ? <LiveFloor people={people} base="/founder" dark /> : <Skeleton className="h-16 bg-white/10" />}
        </div>
      </motion.section>

      {/* ------------------------------------------------ attention + KPIs */}
      <div className="grid gap-5 xl:grid-cols-[1fr_1.35fr]">
        {d ? <AttentionList items={attention} /> : <Skeleton className="h-80" />}
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Calls · 30 days" value={r.calls} icon={<PhoneCall className="size-4" />} spark={(d?.series ?? []).map((s: any) => s.calls)} trend={trend(r.calls, p.calls)} />
          <Stat label="Meetings booked · 30d" value={r.meetings} icon={<Rocket className="size-4" />} accent delay={0.05} spark={(d?.series ?? []).map((s: any) => s.meetings)} trend={trend(r.meetings, p.meetings)} />
          <Stat label="Connect rate" value={pct(r.connected, r.calls)} suffix="%" icon={<Activity className="size-4" />} foot={`${r.connected ?? 0} conversations${p.calls ? ` · was ${pct(p.connected, p.calls)}%` : ""}`} delay={0.1} />
          <Stat label="Decision-maker reach" value={pct(r.decision_maker_reached, r.analysed)} suffix="%" icon={<Target className="size-4" />} foot={`of ${r.analysed ?? 0} analysed calls`} delay={0.15} />
          <Stat label="Follow-up compliance" value={pct(fc.done, fc.done + fc.missed)} suffix="%" icon={<CheckCircle2 className="size-4" />} foot={`${fc.missed} missed in 30 days`} delay={0.2} />
          <Stat label="Unassigned prospects" value={d?.unassigned} icon={<UserX className="size-4" />} foot={<Link to="/founder/allocation" className="font-semibold text-accent hover:underline">{a.autoTopUp ? "Morning top-up on →" : "Allocate →"}</Link>} delay={0.25} />
        </div>
      </div>

      {/* ------------------------------------------------ pipeline */}
      <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Funnel" subtitle="Where prospects are now · step-to-step conversion on the right" icon={<Target className="size-4" />} action={<Link to="/founder/pipeline" className="text-xs font-semibold text-accent hover:underline">Pipeline →</Link>} />
          <div className="px-5 pb-6">
            {d ? (
              <Funnel steps={[
                { label: "Prospect", value: stage("prospect"), hint: "in outreach" },
                { label: "Qualified", value: stage("qualified") + stage("legion_meet_1") + stage("legion_meet_2") },
                { label: "Legion Meet 1", value: stage("legion_meet_1") + stage("legion_meet_2") },
                { label: "Legion Meet 2", value: stage("legion_meet_2") },
                { label: "Won", value: won },
              ]} />
            ) : <Skeleton className="h-64" />}
          </div>
        </Card>
        <Card delay={0.05}>
          <CardHeader title="Calls & conversations · 30 days" icon={<Activity className="size-4" />} />
          <div className="px-4 pb-4">
            {d ? <AreaChart data={d.series} series={[{ key: "calls", label: "Calls", color: "var(--series-1)" }, { key: "connected", label: "Connected", color: "var(--series-2)" }]} /> : <Skeleton className="h-56" />}
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------ people + agenda */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Leaderboard · 30 days" subtitle="Ranked by prospects qualified, then calls" icon={<Trophy className="size-4" />} action={<Link to="/founder/team" className="text-xs font-semibold text-accent hover:underline">Team pulse →</Link>} />
          <div className="space-y-1 px-3 pb-4">
            {[...(d?.byRep ?? [])]
              .filter((x: any) => x.calls > 0 || x.owned > 0)
              .sort((x: any, y: any) => y.qualified_plus - x.qualified_plus || y.calls - x.calls)
              .map((x: any, i: number, all: any[]) => {
                const maxCalls = Math.max(1, ...all.map((z: any) => z.calls));
                return (
                  <motion.div key={x.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover">
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-black", i === 0 ? "bg-amber-400 text-white" : i === 1 ? "bg-slate-300 text-slate-700" : i === 2 ? "bg-orange-300 text-orange-900" : "bg-sunken text-muted")}>{i + 1}</span>
                    <Avatar name={x.full_name} hue={x.avatar_hue} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-fg">{x.full_name}</p>
                        <p className="shrink-0 text-xs text-muted tabular-nums"><b className="text-fg">{x.qualified_plus}</b> qualified · {pct(x.connected, x.calls)}% connect</p>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                          <motion.div initial={{ width: 0 }} animate={{ width: `${(x.calls / maxCalls) * 100}%` }} transition={{ duration: 0.9, delay: 0.1 + i * 0.04 }} className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" />
                        </div>
                        <span className="w-16 shrink-0 text-right text-[11px] text-muted tabular-nums">{x.calls} calls</span>
                      </div>
                    </div>
                    <span className="w-10 shrink-0 text-right">{x.avg_score != null ? <Badge tone={scoreTone(x.avg_score)}>{x.avg_score}</Badge> : <span className="text-xs text-subtle">—</span>}</span>
                  </motion.div>
                );
              })}
            {d && !(d.byRep ?? []).some((x: any) => x.calls > 0 || x.owned > 0) && <p className="px-2 py-6 text-center text-sm text-muted">No calls yet in the last 30 days.</p>}
          </div>
        </Card>
        <Agenda meetings={d?.meetingsUpcoming ?? []} base="/founder" limit={7} />
      </div>

      {/* ------------------------------------------------ intelligence */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Qualified by campaign" icon={<Target className="size-4" />} />
          <div className="px-5 pb-5"><BarList items={(d?.byCampaign ?? []).map((c: any) => ({ key: c.name, label: c.name, value: c.qualified_plus, sub: `of ${c.total.toLocaleString("en-IN")}` }))} /></div>
        </Card>
        <Card delay={0.05}>
          <CardHeader title="Top objections · 30 days" icon={<MessageSquareWarning className="size-4" />} action={<Link to="/founder/intelligence" className="text-xs font-semibold text-accent hover:underline">Intelligence →</Link>} />
          <div className="px-5 pb-5"><BarList items={(d?.objectionTrend ?? []).map((o: any) => ({ key: o.category, label: label(o.category), value: o.count, sub: `${pct(o.handled_well, o.count)}% handled well` }))} /></div>
        </Card>
        <Card delay={0.1}>
          <CardHeader title="What prospects are asking for" icon={<Lightbulb className="size-4" />} />
          <div className="max-h-72 space-y-2 overflow-y-auto px-5 pb-5">
            {(d?.productFeedback ?? []).length === 0 && <p className="py-4 text-sm text-muted">Product requests and pain points from analysed calls appear here.</p>}
            {(d?.productFeedback ?? []).slice(0, 12).map((f: any, i: number) => (
              <Link key={i} to={`/founder/calls/${f.call_id}`} className="block rounded-xl border border-line p-2.5 text-[13px] transition hover:border-brand-300">
                <Badge tone={f.kind === "product_request" ? "brand" : "violet"}>{f.kind === "product_request" ? "Request" : "Pain"}</Badge>
                <p className="mt-1 text-fg">“{f.text}”</p>
                <p className="mt-0.5 text-[11px] text-subtle">{f.company_name ?? f.contact_name} · {f.user_name} · {ago(f.created_at)}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------ system, compact */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 shadow-xs">
        <span className="mr-1 flex items-center gap-1.5 text-xs font-bold tracking-wide text-muted uppercase"><Cpu className="size-3.5" /> System</span>
        <Health ok={meta?.aiConfigured} label={meta?.aiConfigured ? `AI: ${meta.aiProvider === "gemini" ? "Gemini" : "Claude"}` : "AI: demo analysis"} icon={<BrainCircuit className="size-3.5" />} />
        <Health ok={meta?.transcriptionConfigured} label={meta?.transcriptionConfigured ? "Transcription on" : "Transcription off"} icon={<Activity className="size-3.5" />} />
        <Health ok={meta?.telephonyMode !== "demo" && (meta?.telephonyMode !== "bridge" || meta?.bridgeReady)} label={meta?.telephonyMode === "bridge" ? "Bridge calling" : meta?.telephonyMode === "demo" ? "Calling: demo" : "Phone Link calling"} icon={<Phone className="size-3.5" />} />
        <Health ok={!(d?.jobs ?? []).some((j: any) => j.status === "failed")} label={`${(d?.jobs ?? []).filter((j: any) => j.status === "queued").reduce((n: number, j: any) => n + j.count, 0)} jobs queued`} icon={<Handshake className="size-3.5" />} />
        <Health ok label={meta?.emailConfigured ? "Alert emails on" : "Alerts in-app"} icon={<Mail className="size-3.5" />} />
        <Link to="/founder/settings?tab=system" className="ml-auto text-xs font-semibold text-accent hover:underline">Details →</Link>
      </div>
    </div>
  );
}

function Health({ ok, label: l, icon }: { ok: boolean | undefined; label: string; icon: ReactNode }) {
  return (
    <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
      {icon}{l}{ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
    </span>
  );
}


/** Today's team calls against the sum of everyone's daily target. */
function TargetRing({ value, target }: { value: number; target: number }) {
  const size = 104, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = Math.min(1, value / Math.max(1, target));
  return (
    <div className="relative grid shrink-0 place-items-center rounded-full bg-white/10 ring-1 ring-white/15" style={{ width: size + 12, height: size + 12 }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p >= 1 ? "#34d399" : "#7cc0fa"} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - p) }} transition={{ duration: 1.4, delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <div>
          <p className="text-2xl font-bold tabular-nums">{pct(value, target)}%</p>
          <p className="text-[10px] text-white/70">of {target} calls</p>
        </div>
      </div>
    </div>
  );
}
