import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Activity, AlarmClock, BrainCircuit, CalendarCheck, CheckCircle2, Cpu, Crown, Handshake, Inbox, Lightbulb, Mail, MessageSquareWarning,
  Phone, PhoneCall, Rocket, Target, UserX, Users, XCircle,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AreaChart, BarList, Funnel, Stat } from "../../components/charts";
import { Aurora, Counter } from "../../components/motion";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, cn, fmtDateTime, label, scoreTone } from "../../lib/format";

export default function Command() {
  const { user, meta } = useAuth();
  const q = useQuery({ queryKey: ["dash", "founder"], queryFn: () => api.get<any>("/dashboard/founder"), refetchInterval: 60_000 });
  const team = useQuery({ queryKey: ["team", "today"], queryFn: () => api.get<any>("/dashboard/team"), refetchInterval: 30_000 });
  const d = q.data;
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const stage = (k: string) => d?.funnel.find((f: any) => f.stage === k)?.count ?? 0;
  const won = d?.statusCounts.find((s: any) => s.status === "closed_won")?.count ?? 0;
  const r = d?.rates ?? {};
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const fc = d?.followUpCompliance ?? { done: 0, missed: 0 };
  const callingNow = (team.data?.people ?? []).filter((p: any) => p.last_call_at && Date.now() - new Date(p.last_call_at).getTime() < 20 * 60_000).length;

  return (
    <div className="space-y-6">
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="noise relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#061a42] via-[#0d3482] to-brand-600 p-6 text-white shadow-lg sm:p-8">
        <Aurora intensity={0.8} />
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-20" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-sky uppercase"><Crown className="size-4" /> Founder's command center</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Everything, at a glance, {user?.full_name.split(" ")[0]}.</h1>
            <p className="mt-2 text-white/70">
              {new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(now)} ·{" "}
              <span className="font-mono tabular-nums">{new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" }).format(now)}</span> IST
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Calling now", callingNow, <Phone key="i" className="size-4" />],
              ["Calls today", team.data?.totals.calls ?? 0, <PhoneCall key="i" className="size-4" />],
              ["Meetings today", team.data?.totals.meetings ?? 0, <Rocket key="i" className="size-4" />],
            ].map(([l, v, icon]) => (
              <div key={l as string} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
                <p className="flex items-center gap-1.5 text-[11px] text-white/70">{icon}{l}</p>
                <p className="mt-1 text-3xl font-bold"><Counter value={v as number} /></p>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Calls · 30 days" value={r.calls} icon={<PhoneCall className="size-4" />} spark={(d?.series ?? []).map((s: any) => s.calls)} />
        <Stat label="Connect rate" value={pct(r.connected, r.calls)} suffix="%" icon={<Activity className="size-4" />} foot={`${r.connected ?? 0} conversations`} delay={0.05} />
        <Stat label="Decision-maker reach" value={pct(r.decision_maker_reached, r.analysed)} suffix="%" icon={<Target className="size-4" />} foot={`of ${r.analysed ?? 0} analysed calls`} delay={0.1} />
        <Stat label="Meetings booked · 30d" value={r.meetings} icon={<Rocket className="size-4" />} accent delay={0.15} spark={(d?.series ?? []).map((s: any) => s.meetings)} />
        <Stat label="Follow-up compliance" value={pct(fc.done, fc.done + fc.missed)} suffix="%" icon={<CheckCircle2 className="size-4" />} foot={`${fc.missed} missed`} delay={0.2} />
        <Stat label="Overdue follow-ups" value={d?.overdue} icon={<AlarmClock className="size-4" />} foot={d ? `${d.stale} stale leads (no touch in ${d.staleDays}+ days)` : undefined} delay={0.25} />
        <Stat label="Unassigned prospects" value={d?.unassigned} icon={<UserX className="size-4" />} foot={<Link to="/founder/allocation" className="font-semibold text-accent hover:underline">Allocate →</Link>} delay={0.3} />
        <Stat label="Handoffs waiting" value={d?.handoffsPending} icon={<Inbox className="size-4" />} foot={<Link to="/founder/legion" className="font-semibold text-accent hover:underline">Legion →</Link>} delay={0.35} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader title="Funnel health" subtitle="Where prospects are right now · step-to-step conversion on the right" icon={<Target className="size-4" />} />
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

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Salesperson performance · 30 days" icon={<Users className="size-4" />} action={<Link to="/founder/team" className="text-xs font-semibold text-accent hover:underline">Team pulse →</Link>} />
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-muted"><tr><th className="px-3 py-2 font-semibold">Salesperson</th><th className="px-3 py-2 text-right font-semibold">Calls</th><th className="px-3 py-2 text-right font-semibold">Connect</th><th className="px-3 py-2 text-right font-semibold">Qualified+</th><th className="px-3 py-2 text-right font-semibold">Conversion</th><th className="px-3 py-2 text-right font-semibold">AI score</th></tr></thead>
              <tbody>
                {(d?.byRep ?? []).map((p: any, i: number) => (
                  <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }} className="border-t border-line">
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2.5 font-semibold text-fg"><Avatar name={p.full_name} hue={p.avatar_hue} size={28} />{p.full_name}</span></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg">{p.calls}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg">{pct(p.connected, p.calls)}%</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg">{p.qualified_plus}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg">{pct(p.qualified_plus, p.owned)}%</td>
                    <td className="px-3 py-2.5 text-right">{p.avg_score != null ? <Badge tone={scoreTone(p.avg_score)}>{p.avg_score}</Badge> : "—"}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card delay={0.05}>
          <CardHeader title="Upcoming Legion meetings" icon={<CalendarCheck className="size-4" />} />
          <div className="space-y-1 px-3 pb-4">
            {(d?.meetingsUpcoming ?? []).length === 0 && <p className="px-2 py-4 text-sm text-muted">None scheduled.</p>}
            {(d?.meetingsUpcoming ?? []).map((m: any) => (
              <div key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover">
                <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-[11px] font-bold text-accent-soft-fg">{m.stage === "legion_meet_1" ? "M1" : "M2"}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-fg">{m.contact_name}</p><p className="truncate text-xs text-muted">{m.company_name} · {fmtDateTime(m.scheduled_at)}</p></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Conversion by campaign" icon={<Target className="size-4" />} />
          <div className="px-5 pb-5"><BarList items={(d?.byCampaign ?? []).map((c: any) => ({ key: c.name, label: c.name, value: c.qualified_plus, sub: `of ${c.total}` }))} /></div>
        </Card>
        <Card delay={0.05}>
          <CardHeader title="Top objections · 30 days" icon={<MessageSquareWarning className="size-4" />} action={<Link to="/founder/intelligence" className="text-xs font-semibold text-accent hover:underline">Intelligence →</Link>} />
          <div className="px-5 pb-5"><BarList items={(d?.objectionTrend ?? []).map((o: any) => ({ key: o.category, label: label(o.category), value: o.count, sub: `${pct(o.handled_well, o.count)}% well` }))} /></div>
        </Card>
        <Card delay={0.1}>
          <CardHeader title="Product feedback from calls" icon={<Lightbulb className="size-4" />} />
          <div className="max-h-72 space-y-2 overflow-y-auto px-5 pb-5">
            {(d?.productFeedback ?? []).slice(0, 12).map((p: any, i: number) => (
              <Link key={i} to={`/founder/calls/${p.call_id}`} className="block rounded-xl border border-line p-2.5 text-[13px] transition hover:border-brand-300">
                <Badge tone={p.kind === "product_request" ? "brand" : "violet"}>{p.kind === "product_request" ? "Request" : "Pain"}</Badge>
                <p className="mt-1 text-fg">“{p.text}”</p>
                <p className="mt-0.5 text-[11px] text-subtle">{p.company_name ?? p.contact_name} · {p.user_name} · {ago(p.created_at)}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card delay={0.1}>
        <CardHeader title="System" subtitle="Integrations and the background queue" icon={<Cpu className="size-4" />} />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-5">
          <Health ok={meta?.aiConfigured} label="AI call analysis" good="Claude connected" bad="Demo analysis — add ANTHROPIC_API_KEY" icon={<BrainCircuit className="size-4" />} />
          <Health ok={meta?.transcriptionConfigured} label="Transcription" good="Deepgram connected" bad="Add DEEPGRAM_API_KEY" icon={<Activity className="size-4" />} />
          <Health ok={meta?.emailConfigured} label="Report emails" good="SMTP connected" bad="SMTP not set — saved to outbox" icon={<Mail className="size-4" />} />
          <Health ok={meta?.telephonyMode !== "demo" && (meta?.telephonyMode !== "bridge" || meta?.bridgeReady)} label="Calling" good={meta?.telephonyMode === "bridge" ? "Bridge calling (auto-record)" : "Phone Link"} bad={meta?.telephonyMode === "demo" ? "Demo mode" : "Bridge provider missing"} icon={<Phone className="size-4" />} />
          <Health ok={!(d?.jobs ?? []).some((j: any) => j.status === "failed")} label="Background jobs" good={`${(d?.jobs ?? []).filter((j: any) => j.status === "queued").reduce((a: number, j: any) => a + j.count, 0)} queued`} bad="Some jobs failed — see Settings" icon={<Handshake className="size-4" />} />
        </div>
      </Card>
    </div>
  );
}

function Health({ ok, label: l, good, bad, icon }: { ok: boolean | undefined; label: string; good: string; bad: string; icon: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border p-3.5", ok ? "border-emerald-200 bg-success-soft dark:border-emerald-900" : "border-amber-200 bg-warning-soft dark:border-amber-900")}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", ok ? "bg-success text-white" : "bg-warning text-white")}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-fg">{l}</p>
        <p className="flex items-center gap-1 text-xs text-muted">{ok ? <CheckCircle2 className="size-3 text-success" /> : <XCircle className="size-3 text-warning" />}{ok ? good : bad}</p>
      </div>
    </div>
  );
}
