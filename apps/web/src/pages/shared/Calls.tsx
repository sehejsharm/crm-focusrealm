import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Bot, Download, PhoneCall } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Avatar, Badge, Button, Card, Empty, PageHeader, Select, Skeleton } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAuth, useIsManager } from "../../lib/auth";
import { duration, fmtDateTime, label, OUTCOME_TONE, OUTCOMES, scoreTone, todayISO } from "../../lib/format";
import type { Call } from "../../lib/types";

const ANALYSIS_TONE: Record<string, "success" | "warning" | "brand" | "neutral" | "danger" | "violet"> = {
  done: "success", needs_review: "warning", queued: "brand", processing: "violet", failed: "danger", none: "neutral",
};

export default function Calls() {
  const { user } = useAuth();
  const manager = useIsManager();
  const base = `/${user?.portal}`;
  const [params] = useSearchParams();
  const [outcome, setOutcome] = useState("");
  const [analysis, setAnalysis] = useState(params.get("analysis") ?? "");
  const [recording, setRecording] = useState(params.get("recording") ?? "");
  const [userId, setUserId] = useState("");
  const [day, setDay] = useState("");
  const [page, setPage] = useState(1);
  const people = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: any[] }>("/users"), enabled: user?.role !== "sales_rep" });
  const from = day ? new Date(`${day}T00:00:00+05:30`).toISOString() : undefined;
  const to = day ? new Date(new Date(`${day}T00:00:00+05:30`).getTime() + 86400_000).toISOString() : undefined;
  const q = useQuery({
    queryKey: ["calls", outcome, analysis, recording, userId, day, page],
    queryFn: () => api.get<{ total: number; rows: Call[] }>(`/calls${qs({ outcome, analysis, recording, userId, from, to, page, pageSize: 40 })}`),
    placeholderData: keepPreviousData,
  });
  const pages = Math.ceil((q.data?.total ?? 0) / 40);

  return (
    <div>
      <PageHeader
        eyebrow="Calls"
        title={user?.role === "sales_rep" ? "My calls" : "All calls"}
        subtitle={`${(q.data?.total ?? 0).toLocaleString("en-IN")} calls · every one with a unique call ID`}
        actions={manager && <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => window.location.assign(`/api/export/calls.csv${qs({ from: from ?? new Date(Date.now() - 30 * 86400_000).toISOString(), to })}`)}>Export CSV</Button>}
      />
      <Card className="mb-4 flex flex-wrap gap-2 p-3" spotlight={false}>
        <Select value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }} className="w-auto min-w-40">
          <option value="">All outcomes</option>
          {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.emoji} {o.label}</option>)}
        </Select>
        <Select value={analysis} onChange={(e) => { setAnalysis(e.target.value); setPage(1); }} className="w-auto min-w-40">
          <option value="">Any analysis state</option>
          <option value="done">Analysed</option>
          <option value="needs_review">Needs human review</option>
          <option value="queued">Queued for end of day</option>
          <option value="none">Not analysed</option>
        </Select>
        <Select value={recording} onChange={(e) => { setRecording(e.target.value); setPage(1); }} className="w-auto min-w-40">
          <option value="">Any recording</option>
          <option value="uploaded">Has a recording</option>
          <option value="missing">Connected, no recording</option>
        </Select>
        {user?.role !== "sales_rep" && (
          <Select value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} className="w-auto min-w-40">
            <option value="">Everyone</option>
            {(people.data?.users ?? []).filter((u) => ["sales_rep", "sales_head"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Select>
        )}
        <input type="date" value={day} max={todayISO()} onChange={(e) => { setDay(e.target.value); setPage(1); }} className="h-10 rounded-xl border border-line-strong bg-surface px-3 text-sm text-fg" />
        {(outcome || analysis || userId || day) && <Button variant="ghost" size="sm" className="h-10" onClick={() => { setOutcome(""); setAnalysis(""); setUserId(""); setDay(""); }}>Clear</Button>}
      </Card>

      <Card className="overflow-hidden" spotlight={false}>
        {q.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : !q.data?.rows.length ? (
          <Empty icon={<PhoneCall className="size-6" />} title="No calls here yet" body="Calls appear the moment someone presses Call." />
        ) : (
          <div className="divide-y divide-line">
            {q.data.rows.map((k, i) => (
              <motion.div key={k.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.015 }}>
                <Link to={`${base}/calls/${k.id}`} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-surface-hover">
                  <Avatar name={k.user_name} hue={k.user_hue} size={34} className="hidden sm:inline-grid" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg group-hover:text-accent">{k.contact_name} <span className="font-normal text-muted">· {k.company_name ?? "—"}</span></p>
                    <p className="truncate text-xs text-muted"><span className="font-mono">{k.call_code}</span> · {k.user_name} · {fmtDateTime(k.started_at)}</p>
                    {k.summary && <p className="mt-0.5 line-clamp-1 text-xs text-subtle">{k.summary}</p>}
                  </div>
                  <span className="hidden font-mono text-xs text-muted md:block">{duration(k.duration_sec)}</span>
                  {k.outcome && <Badge tone={OUTCOME_TONE[k.outcome] ?? "neutral"}>{label(k.outcome)}</Badge>}
                  <Badge tone={ANALYSIS_TONE[k.analysis_status] ?? "neutral"} className="hidden lg:inline-flex"><Bot className="size-3" />{k.analysis_status === "none" ? "—" : label(k.analysis_status)}</Badge>
                  <span className="w-11 text-right">{k.score != null && <Badge tone={scoreTone(k.score)}>{k.score}</Badge>}</span>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

