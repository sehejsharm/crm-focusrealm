import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft, Briefcase, Dumbbell, Ear, FileText, Frown, Lightbulb, MessageCircle, Printer, RefreshCw, Smile, Sparkles, Target, ThumbsDown, ThumbsUp, Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BarList, Stat } from "../../components/charts";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, CardHeader, Empty, Skeleton, Stagger, staggerItem, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth, useIsManager } from "../../lib/auth";
import { fmtDate, fmtDateTime, label, minutes } from "../../lib/format";
import type { DailyReport } from "../../lib/types";
import { Grade } from "./Reports";

export default function ReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const manager = useIsManager();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["report", id], queryFn: () => api.get<{ report: any }>(`/reports/${id}`) });
  const calls = useQuery({
    queryKey: ["report-calls", id],
    queryFn: () => api.get<{ rows: any[] }>(`/calls?userId=${q.data!.report.user_id}&from=${encodeURIComponent(new Date(`${q.data!.report.report_date}T00:00:00+05:30`).toISOString())}&to=${encodeURIComponent(new Date(new Date(`${q.data!.report.report_date}T00:00:00+05:30`).getTime() + 86400_000).toISOString())}&pageSize=100`),
    enabled: Boolean(q.data?.report),
  });
  const rebuild = useMutation({ mutationFn: () => api.post(`/reports/${id}/rebuild`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["report", id] }); toast({ kind: "ai", title: "Report rebuilt" }); } });

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-48" /><Skeleton className="h-96" /></div>;
  const r = q.data?.report;
  if (!r) return <Empty icon={<FileText className="size-6" />} title="Report not found" />;
  const rep: DailyReport | null = r.report;
  const m = r.metrics ?? {};
  const base = `/${user?.portal}`;
  const codeToId = new Map((calls.data?.rows ?? []).map((c) => [c.call_code, c.id]));
  const callLink = (code: string) => (codeToId.get(code) ? <Link className="font-mono font-bold text-accent hover:underline" to={`${base}/calls/${codeToId.get(code)}`}>{code}</Link> : <span className="font-mono font-bold">{code}</span>);

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" /> Back</button>
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="noise relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b2a66] via-brand-700 to-brand-500 p-6 text-white shadow-lg sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-16 size-80 rounded-full bg-sky/25 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Avatar name={r.full_name} hue={r.avatar_hue} size={44} className="ring-2 ring-white/30" />
              <div>
                <p className="font-bold">{r.full_name} <span className="font-normal text-white/60">· {r.employee_code}</span></p>
                <p className="text-sm text-white/70">Daily report · {fmtDate(r.report_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
              </div>
            </div>
            <h1 className="mt-5 max-w-3xl text-2xl leading-snug font-bold tracking-tight sm:text-3xl">{rep?.headline ?? "Report not ready"}</h1>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {r.updated_at && rep && <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1"><FileText className="size-3.5" /> Written {fmtDateTime(r.updated_at)}</span>}
              <span className="rounded-full bg-white/10 px-3 py-1">{r.model === "demo-heuristic" ? "Demo analysis" : r.model === "metrics-only" ? "Metrics only" : `AI: ${r.model}`}</span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Grade grade={rep?.grade ?? null} size={92} />
            <p className="text-sm font-semibold text-white/80">{rep?.overall_score ?? "—"}/100</p>
          </div>
        </div>
      </motion.section>

      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print / save PDF</Button>
        {manager && <Button size="sm" icon={<RefreshCw className="size-4" />} loading={rebuild.isPending} onClick={() => rebuild.mutate()}>Rebuild</Button>}
      </div>

      <AnimatePresence mode="wait">
        {!rep ? (
          <Card><Empty icon={<Sparkles className="size-6" />} title="This report is still being written" /></Card>
        ) : (
          <motion.div key="report" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Calls" value={m.calls_total} foot={`target ${m.target}`} delay={0} />
              <Stat label="Connected" value={m.connected} foot={`${m.connect_rate}% connect rate`} delay={0.05} />
              <Stat label="Talk time" value={Math.round((m.talk_time_sec ?? 0) / 60)} suffix=" min" foot={minutes(m.talk_time_sec)} delay={0.1} />
              <Stat label="Meetings booked" value={m.meetings_booked} delay={0.15} />
              <Stat label="Analysed calls" value={m.analysed} foot={`avg score ${m.avg_score ?? "—"}`} accent delay={0.2} />
            </div>

            <Card>
              <CardHeader title="Executive summary" icon={<Briefcase className="size-4" />} />
              <p className="px-5 pb-5 text-[15px] leading-relaxed text-fg">{rep.executive_summary}</p>
            </Card>

            <div className="grid gap-5 md:grid-cols-2">
              <ListCard title="Wins" icon={<ThumbsUp className="size-4" />} items={rep.wins} tone="success" />
              <ListCard title="Concerns" icon={<ThumbsDown className="size-4" />} items={rep.concerns} tone="danger" />
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <TextCard title="How they spoke" icon={<MessageCircle className="size-4" />} text={rep.communication} />
              <TextCard title="How they handled conversations" icon={<Target className="size-4" />} text={rep.conversation_handling} />
              <TextCard title="How prospects responded" icon={<Ear className="size-4" />} text={rep.prospect_response} />
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
              <Card>
                <CardHeader title="Sales frameworks today" subtitle="Average across analysed calls (0–10)" icon={<Target className="size-4" />} />
                <div className="px-5 pb-5">
                  <BarList tone="status" max={10} format={(v) => v.toFixed(1)} items={(rep.framework_breakdown ?? []).map((f) => ({ key: f.framework, label: f.framework, value: Number(f.score) || 0, sub: undefined }))} />
                  <div className="mt-4 space-y-1.5">{(rep.framework_breakdown ?? []).slice(0, 4).map((f) => <p key={f.framework} className="text-xs text-muted"><b className="text-fg">{f.framework}:</b> {f.comment}</p>)}</div>
                </div>
              </Card>
              <div className="space-y-5">
                <Card>
                  <CardHeader title="Best & toughest call" icon={<Sparkles className="size-4" />} />
                  <div className="space-y-3 px-5 pb-5 text-sm">
                    <div className="flex gap-3 rounded-2xl bg-success-soft p-3.5"><Smile className="size-5 shrink-0 text-success" /><p className="text-fg">{callLink(rep.best_call.call_code)} — {rep.best_call.why}</p></div>
                    <div className="flex gap-3 rounded-2xl bg-danger-soft p-3.5"><Frown className="size-5 shrink-0 text-danger" /><p className="text-fg">{callLink(rep.toughest_call.call_code)} — {rep.toughest_call.why}</p></div>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Objections heard" icon={<MessageCircle className="size-4" />} />
                  <div className="flex flex-wrap gap-2 px-5 pb-5">
                    {(rep.objection_summary ?? []).length === 0 && <p className="text-sm text-muted">None recorded.</p>}
                    {(rep.objection_summary ?? []).map((o) => <Badge key={o.category} tone="violet" className="py-1">{label(o.category)} × {o.count} · {o.handling}</Badge>)}
                  </div>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader title="Coaching plan for tomorrow" icon={<Dumbbell className="size-4" />} />
              <Stagger className="grid gap-3 px-5 pb-5 md:grid-cols-3">
                {(rep.coaching_plan ?? []).map((c, i) => (
                  <motion.div key={i} variants={staggerItem} className="relative overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-surface p-4 dark:border-brand-900 dark:from-brand-950/40">
                    <span className="absolute -top-3 -right-1 text-6xl font-black text-brand-500/10">{i + 1}</span>
                    <p className="text-sm font-bold text-fg">{c.focus}</p>
                    <p className="mt-1 text-sm text-muted">{c.drill}</p>
                    <p className="mt-2 text-sm text-accent-soft-fg italic">{c.example_line}</p>
                  </motion.div>
                ))}
              </Stagger>
            </Card>

            <div className="grid gap-5 md:grid-cols-3">
              <ListCard title="Product feedback" icon={<Lightbulb className="size-4" />} items={rep.product_feedback} tone="brand" />
              <ListCard title="For the sales head" icon={<Users className="size-4" />} items={rep.manager_actions} tone="brand" />
              <ListCard title="Tomorrow's targets" icon={<Target className="size-4" />} items={rep.tomorrow_targets} tone="success" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ListCard({ title, icon, items, tone }: { title: string; icon: ReactNode; items: string[]; tone: "success" | "danger" | "brand" }) {
  const dot = { success: "bg-success", danger: "bg-danger", brand: "bg-brand-500" }[tone];
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      <Stagger className="space-y-2 px-5 pb-5">
        {(items ?? []).length === 0 && <p className="text-sm text-muted">—</p>}
        {(items ?? []).map((x, i) => (
          <motion.p key={i} variants={staggerItem} className="flex gap-2.5 text-sm text-fg"><span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot}`} />{x}</motion.p>
        ))}
      </Stagger>
    </Card>
  );
}

function TextCard({ title, icon, text }: { title: string; icon: ReactNode; text: string }) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      <p className="px-5 pb-5 text-sm leading-relaxed text-fg">{text}</p>
    </Card>
  );
}
