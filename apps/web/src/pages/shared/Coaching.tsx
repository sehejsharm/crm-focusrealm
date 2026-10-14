import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { FileText, LineChart, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { AreaChart } from "../../components/charts";
import { Card, CardHeader, Empty, PageHeader, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { Grade } from "./Reports";

/** The salesperson's own daily AI reports and their trend. */
export default function Coaching() {
  const reports = useQuery({ queryKey: ["reports", "mine"], queryFn: () => api.get<{ reports: any[] }>("/reports?limit=30") });
  const dash = useQuery({ queryKey: ["dash", "rep"], queryFn: () => api.get<any>("/dashboard/rep") });
  const rows = (reports.data?.reports ?? []).filter((r) => r.status !== "no_activity");
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="AI coaching" title="Your coaching" subtitle="Every evening the AI listens to all your calls and writes your report: how you spoke, how you handled each conversation, how prospects responded — and what to practise tomorrow." />
      <Card>
        <CardHeader title="Your last two weeks" subtitle="Calls and AI call score" icon={<LineChart className="size-4" />} />
        <div className="px-4 pb-4">
          {dash.data ? (
            <AreaChart data={dash.data.trend} series={[{ key: "calls", label: "Calls", color: "var(--series-1)" }, { key: "score", label: "Avg AI score", color: "var(--series-2)" }]} />
          ) : <Skeleton className="h-56" />}
        </div>
      </Card>
      {reports.isLoading ? <Skeleton className="h-64" /> : rows.length === 0 ? (
        <Card><Empty icon={<Sparkles className="size-6" />} title="Your first report arrives tonight" body="Make calls and attach recordings — the end-of-day run writes your report." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -3 }}>
              <Link to={`/sales/coaching/${r.id}`} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:shadow-md">
                <Grade grade={r.grade} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-muted">{fmtDate(r.report_date, { weekday: "long", day: "numeric", month: "short" })}</p>
                  <p className="line-clamp-2 text-sm font-semibold text-fg">{r.headline}</p>
                </div>
                <FileText className="size-4 text-subtle" />
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
