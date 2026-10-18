import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { AudioLines, Bot, CheckCircle2, CircleDashed, FileAudio, Loader2, Mic, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { AudioFormats, RecordingDrop } from "../../components/recording";
import { Badge, Card, CardHeader, Empty, PageHeader, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { ago, cn, label } from "../../lib/format";

interface Inbox {
  waiting: { id: string; call_code: string; started_at: string; outcome: string | null; mode: string; duration_sec: number | null; recording_status: string; contact_name: string; company_name: string | null }[];
  recent: { id: string; call_code: string; started_at: string; recording_mime: string | null; recording_bytes: number | null; transcript_status: string; analysis_status: string; score: number | null; contact_name: string; company_name: string | null }[];
}

/**
 * Where salespeople attach call recordings: every call from the last two
 * weeks that's still missing one, with a drop zone each, and the progress of
 * recent uploads through transcription and AI analysis.
 */
export default function Recordings() {
  const q = useQuery({ queryKey: ["recordings"], queryFn: () => api.get<Inbox>("/calls/recordings"), refetchInterval: 15_000 });
  const waiting = q.data?.waiting ?? [];
  const recent = q.data?.recent ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Recordings"
        title="Upload call recordings"
        subtitle="Attach the recording for each call. The AI transcribes it (Hindi, English or both), analyses how the call went and adds it to tonight's report."
      />
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-xs">
        <FileAudio className="size-5 text-accent" />
        <span className="text-sm font-semibold text-fg">Accepted formats</span>
        <AudioFormats />
      </motion.div>

      <Card>
        <CardHeader title="Waiting for a recording" subtitle="Your calls from the last 14 days that connected but have no recording yet" icon={<Mic className="size-4" />} action={waiting.length ? <Badge tone="warning">{waiting.length}</Badge> : undefined} />
        {q.isLoading ? (
          <div className="space-y-2 px-5 pb-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : waiting.length === 0 ? (
          <Empty icon={<CheckCircle2 className="size-6" />} title="All caught up" body="Every connected call has its recording. Nice." />
        ) : (
          <div className="divide-y divide-line">
            {waiting.map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{c.contact_name}{c.company_name && <span className="font-normal text-muted"> · {c.company_name}</span>}</p>
                  <p className="text-xs text-muted">
                    <span className="font-mono">{c.call_code}</span> · {ago(c.started_at)}{c.outcome ? ` · ${label(c.outcome)}` : ""}
                    {c.recording_status === "failed" && <span className="ml-1 font-semibold text-danger">· last upload failed</span>}
                  </p>
                </div>
                <RecordingDrop callId={c.id} compact />
              </motion.div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent uploads" subtitle="Uploaded → transcribed → analysed" icon={<AudioLines className="size-4" />} />
        {recent.length === 0 ? (
          <Empty icon={<FileAudio className="size-6" />} title="No uploads yet" />
        ) : (
          <div className="divide-y divide-line">
            {recent.map((c) => (
              <Link key={c.id} to={`/sales/calls/${c.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface-hover">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{c.contact_name}</p>
                  <p className="text-xs text-muted"><span className="font-mono">{c.call_code}</span> · {ago(c.started_at)}{c.recording_bytes ? ` · ${(c.recording_bytes / 1024 / 1024).toFixed(1)} MB` : ""}</p>
                </div>
                <Pipeline transcript={c.transcript_status} analysis={c.analysis_status} score={c.score} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Step({ state, label: text, icon }: { state: "done" | "busy" | "todo" | "off"; label: string; icon: React.ReactNode }) {
  return (
    <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", state === "done" ? "bg-success-soft text-success" : state === "busy" ? "bg-accent-soft text-accent-soft-fg" : "bg-sunken text-subtle")}>
      {state === "busy" ? <Loader2 className="size-3 animate-spin" /> : state === "todo" || state === "off" ? <CircleDashed className="size-3" /> : icon}
      {text}
    </span>
  );
}

function Pipeline({ transcript, analysis, score }: { transcript: string; analysis: string; score: number | null }) {
  const t = transcript === "done" ? "done" : transcript === "processing" ? "busy" : transcript === "skipped" ? "off" : "todo";
  const a = analysis === "done" || analysis === "needs_review" ? "done" : analysis === "processing" ? "busy" : "todo";
  return (
    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
      <Step state="done" label="Uploaded" icon={<CheckCircle2 className="size-3" />} />
      <Step state={t} label={transcript === "skipped" ? "No transcription" : transcript === "failed" ? "Transcription failed" : "Transcribed"} icon={<Bot className="size-3" />} />
      <Step state={a} label={score != null ? `Score ${score}` : analysis === "queued" ? "Analysed tonight" : "Analysed"} icon={<Sparkles className="size-3" />} />
    </span>
  );
}
