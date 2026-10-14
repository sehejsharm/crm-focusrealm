import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CalendarDays, Download, FileText, Mail, MailCheck, Play, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, Empty, PageHeader, Skeleton } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAuth, useIsManager } from "../../lib/auth";
import { cn, fmtDate, fmtTime, todayISO } from "../../lib/format";

export const GRADE_STYLE: Record<string, string> = {
  "A+": "from-emerald-400 to-emerald-600",
  A: "from-emerald-400 to-teal-600",
  "B+": "from-brand-400 to-brand-600",
  B: "from-brand-500 to-brand-700",
  C: "from-amber-400 to-amber-600",
  D: "from-rose-400 to-rose-600",
};

export function Grade({ grade, size = 48 }: { grade: string | null; size?: number }) {
  return (
    <motion.span
      initial={{ scale: 0, rotate: -30 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 15 }}
      className={cn("grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br font-black text-white shadow-md", GRADE_STYLE[grade ?? ""] ?? "from-slate-300 to-slate-400")}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {grade ?? "—"}
    </motion.span>
  );
}

/** Daily reports — one per salesperson per day, emailed to leadership. */
export default function Reports() {
  const { user } = useAuth();
  const manager = useIsManager();
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const base = `/${user?.portal}`;
  const reports = useQuery({ queryKey: ["reports", date], queryFn: () => api.get<{ reports: any[] }>(`/reports${qs({ date })}`) });
  const recipients = useQuery({ queryKey: ["recipients-preview"], queryFn: () => api.get<{ recipients: string[] }>("/reports/recipients/preview"), enabled: manager });
  const run = useMutation({
    mutationFn: () => api.post<{ queued: number; analyses: number }>("/reports/run", { date }),
    onSuccess: (r) => {
      toast({ kind: "ai", title: `Building ${r.queued} reports`, body: `${r.analyses} recordings queued for AI analysis first. They'll appear here and be emailed automatically.` });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["reports"] }), 4000);
    },
    onError: (e) => toast({ kind: "error", title: "Couldn't start the run", body: (e as Error).message }),
  });
  const rows = (reports.data?.reports ?? []).filter((r) => r.status !== "no_activity");

  return (
    <div>
      <PageHeader
        eyebrow="AI daily reports"
        title="Daily sales reports"
        subtitle="Every evening the AI analyses each salesperson's recordings and writes their report — emailed to the sales heads, CEO, COO and the founders' list."
        actions={
          <>
            <div className="flex h-10 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3 shadow-xs">
              <CalendarDays className="size-4 text-muted" />
              <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="bg-transparent text-sm text-fg outline-none" />
            </div>
            {manager && <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => window.location.assign("/api/export/reports.csv")}>Export</Button>}
            {manager && <Button variant="primary" icon={<Play className="size-4" />} loading={run.isPending} onClick={() => run.mutate()}>Run now</Button>}
          </>
        }
      />
      {manager && recipients.data && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-xs">
          <Mail className="size-4 text-accent" />
          <span className="font-semibold text-fg">Emailed to:</span>
          {recipients.data.recipients.map((r) => <Badge key={r} tone="brand">{r}</Badge>)}
          {user?.role === "founder" && <Link to="/founder/settings" className="ml-auto text-xs font-semibold text-accent hover:underline">Manage recipients →</Link>}
        </motion.div>
      )}
      {reports.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-52" />)}</div>
      ) : rows.length === 0 ? (
        <Card><Empty icon={<FileText className="size-6" />} title={`No reports for ${fmtDate(date, { day: "numeric", month: "long" })} yet`} body={`They're written automatically at the end of the day.${manager ? " Or press Run now." : ""}`} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.07, ease: [0.16, 1, 0.3, 1], duration: 0.6 }} whileHover={{ y: -4 }}>
              <Link to={`${base}/reports/${r.id}`} className="group block h-full overflow-hidden rounded-3xl border border-line bg-surface shadow-sm transition-shadow hover:shadow-lg">
                <div className="relative bg-gradient-to-br from-brand-50 to-surface p-5 dark:from-brand-950/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.full_name} hue={r.avatar_hue} size={40} />
                      <div>
                        <p className="font-bold text-fg">{r.full_name}</p>
                        <p className="text-xs text-muted">{r.employee_code} · {fmtDate(r.report_date, { weekday: "short", day: "numeric", month: "short" })}</p>
                      </div>
                    </div>
                    {r.status === "generating" || r.status === "pending" ? (
                      <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft"><span className="size-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" /></span>
                    ) : (
                      <Grade grade={r.grade} />
                    )}
                  </div>
                  <p className="mt-4 line-clamp-2 text-sm font-semibold text-fg group-hover:text-accent">{r.headline ?? (r.status === "failed" ? `Failed: ${r.error}` : "Writing the report…")}</p>
                </div>
                <div className="grid grid-cols-4 divide-x divide-line border-t border-line text-center">
                  {[["Calls", r.metrics?.calls_total], ["Connected", r.metrics?.connected], ["Meetings", r.metrics?.meetings_booked], ["Score", r.overall_score]].map(([l, v]) => (
                    <div key={l as string} className="py-3">
                      <p className="text-lg font-bold text-fg">{v ?? "—"}</p>
                      <p className="text-[10.5px] text-muted">{l}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 border-t border-line px-5 py-2.5 text-xs text-muted">
                  {r.emailed_at ? <><MailCheck className="size-3.5 text-success" /> Emailed {fmtTime(r.emailed_at)} to {r.emailed_to.length}</> : <><Users className="size-3.5" /> {r.status}</>}
                  {r.model === "demo-heuristic" && <Badge className="ml-auto" tone="neutral">demo AI</Badge>}
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
