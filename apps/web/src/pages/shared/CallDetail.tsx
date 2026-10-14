import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft, ArrowRight, Bot, BrainCircuit, CheckCircle2, CircleAlert, Clock, Ear, Lightbulb, MessageSquareQuote, Mic, Pause, Play,
  RefreshCw, ShieldAlert, Sparkles, Target, ThumbsUp, TrendingUp, UserRound, Wand2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BarList, Radar, ScoreRing } from "../../components/charts";
import { Waveform } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, CardHeader, Empty, Input, Skeleton, Stagger, staggerItem, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth, useIsManager } from "../../lib/auth";
import { cn, duration, fmtDateTime, label, OUTCOME_TONE, SKILL_LABEL } from "../../lib/format";
import type { Call, CallAnalysis } from "../../lib/types";

const SENTIMENT = ["very_negative", "negative", "neutral", "positive", "very_positive"];
const SENT_EMOJI: Record<string, string> = { very_negative: "😠", negative: "🙁", neutral: "😐", positive: "🙂", very_positive: "🤩" };
const HANDLING_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { well: "success", partially: "warning", poorly: "danger", not_addressed: "danger" };

export default function CallDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const manager = useIsManager();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"coaching" | "frameworks" | "prospect" | "transcript">("coaching");
  const q = useQuery({ queryKey: ["call", id], queryFn: () => api.get<{ call: Call; insights: any[] }>(`/calls/${id}`) });
  const reanalyse = useMutation({ mutationFn: () => api.post(`/calls/${id}/analyze`), onSuccess: () => { toast({ kind: "ai", title: "Re-analysis queued", body: "It'll refresh here when ready." }); qc.invalidateQueries({ queryKey: ["call", id] }); } });
  const review = useMutation({ mutationFn: () => api.post(`/calls/${id}/review`, { verdict: "confirmed" }), onSuccess: () => { toast({ kind: "success", title: "Marked as reviewed" }); qc.invalidateQueries({ queryKey: ["call", id] }); } });

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-96" /></div>;
  if (q.error || !q.data) return <Empty icon={<Mic className="size-6" />} title="Can't open this call" body={(q.error as Error)?.message} />;
  const k = q.data.call;
  const a = k.analysis as CallAnalysis | null;
  const base = `/${user?.portal}`;

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" /> Back</button>

      <Card className="overflow-hidden" spotlight={false}>
        <div className="noise relative overflow-hidden bg-gradient-to-br from-[#0b2a66] via-brand-800 to-brand-600 p-5 text-white sm:p-6">
          <div className="pointer-events-none absolute -top-24 -right-10 size-72 rounded-full bg-sky/25 blur-3xl" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-xs tracking-wider text-white/60">{k.call_code}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                <Link to={`${base}/contacts/${k.contact_id}`} className="hover:underline">{k.contact_name}</Link>
                <span className="font-normal text-white/60"> · {k.company_name ?? "—"}</span>
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/80">
                <span className="flex items-center gap-1.5"><Avatar name={k.user_name} size={22} /> {k.user_name}</span>
                <span>· {fmtDateTime(k.started_at)}</span>
                <span className="flex items-center gap-1"><Clock className="size-3.5" /> {duration(k.duration_sec)}</span>
                {k.outcome && <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold">{label(k.outcome)}</span>}
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs">{k.mode === "bridge" ? "Bridge · auto-recorded" : k.mode === "phone_link" ? "Phone Link" : k.mode === "demo" ? "Demo call" : k.mode}</span>
              </div>
            </div>
            {a && (
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-white p-1.5 shadow-lg dark:bg-surface">
                  <ScoreRing value={a.overall_score} size={112} label="call score" />
                </div>
              </div>
            )}
          </div>
          {k.recording_status === "uploaded" && <RecordingPlayer callId={k.id} />}
        </div>
        {a ? (
          <div className="space-y-3 p-5 sm:p-6">
            <p className="text-[15px] leading-relaxed text-fg">{a.summary}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand"><BrainCircuit className="size-3" />{k.analysis_model === "demo-heuristic" ? "Demo analysis (add an AI key for real analysis)" : `Analysed by ${k.analysis_model}`}</Badge>
              <Badge tone="neutral">{a.language}</Badge>
              <Badge tone="neutral">{label(a.call_type)}</Badge>
              <Badge tone={a.confidence >= 0.7 ? "success" : a.confidence >= 0.55 ? "warning" : "danger"}>Confidence {Math.round(a.confidence * 100)}%</Badge>
              {manager && <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={reanalyse.isPending} onClick={() => reanalyse.mutate()}>Re-analyse</Button>}
            </div>
            {k.analysis_status === "needs_review" && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/60 bg-warning-soft p-3.5">
                <ShieldAlert className="size-5 text-warning" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-fg">Marked for human review</p>
                  <p className="text-muted">{a.review_reasons?.join(" · ") || "The AI wasn't fully confident in this analysis."}</p>
                </div>
                {manager && <Button size="sm" variant="secondary" loading={review.isPending} onClick={() => review.mutate()}>Looks right</Button>}
              </motion.div>
            )}
            {k.review && <p className="text-xs text-success">✓ Reviewed by {k.review.by}</p>}
          </div>
        ) : (
          <NoAnalysis call={k} />
        )}
      </Card>

      {a && (
        <>
          <Tabs value={tab} onChange={setTab} items={[
            { value: "coaching", label: "🎯 Coaching" },
            { value: "frameworks", label: "🧭 Frameworks & skills" },
            { value: "prospect", label: "🧑‍💼 Prospect response" },
            { value: "transcript", label: "💬 Transcript" },
          ]} />
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}>
              {tab === "coaching" && <Coaching a={a} />}
              {tab === "frameworks" && <Frameworks a={a} />}
              {tab === "prospect" && <Prospect a={a} />}
              {tab === "transcript" && <Transcript call={k} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
      {!a && k.transcript?.utterances?.length ? <Transcript call={k} /> : null}
    </div>
  );
}

function NoAnalysis({ call }: { call: Call }) {
  const msg =
    call.analysis_status === "queued" || call.analysis_status === "processing"
      ? "Queued — analysed in the end-of-day run (or shortly, if immediate analysis is on)."
      : call.transcript_status === "skipped"
        ? "Recording stored, but transcription isn't configured yet (add a Deepgram key)."
        : call.recording_status === "awaiting"
          ? "Waiting for the recording to be attached."
          : call.recording_status === "unavailable" || call.recording_status === "none"
            ? "No recording for this call, so there's nothing to analyse."
            : "Transcribing…";
  return (
    <div className="flex items-center gap-3 p-5 text-sm text-muted">
      <motion.span animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 2, repeat: Infinity }} className="grid size-10 place-items-center rounded-2xl bg-accent-soft text-accent-soft-fg"><Bot className="size-5" /></motion.span>
      {msg}
    </div>
  );
}

function RecordingPlayer({ callId }: { callId: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct] = useState(0);
  const toast = useToast();
  const toggle = async () => {
    try {
      if (!src) {
        const r = await api.get<{ url: string }>(`/calls/${callId}/recording-url`);
        setSrc(r.url);
        setTimeout(() => ref.current?.play(), 50);
        return;
      }
      if (ref.current?.paused) ref.current.play();
      else ref.current?.pause();
    } catch (e) {
      toast({ kind: "error", title: "Can't play the recording", body: (e as Error).message });
    }
  };
  return (
    <div className="relative mt-5 flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur">
      <motion.button whileTap={{ scale: 0.9 }} onClick={toggle} className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-brand-700 shadow-lg" aria-label={playing ? "Pause" : "Play recording"}>
        {playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
      </motion.button>
      <div className="min-w-0 flex-1">
        <Waveform active={playing} bars={60} className="h-8" />
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-white transition-[width]" style={{ width: `${pct}%` }} /></div>
      </div>
      {src && (
        <audio
          ref={ref}
          src={src}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setPct((e.currentTarget.currentTime / (e.currentTarget.duration || 1)) * 100)}
        />
      )}
    </div>
  );
}

function Coaching({ a }: { a: CallAnalysis }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="What went well" icon={<ThumbsUp className="size-4" />} />
        <Stagger className="space-y-2 px-5 pb-5">
          {a.strengths.map((s, i) => (
            <motion.div key={i} variants={staggerItem} className="flex gap-3 rounded-2xl bg-success-soft p-3.5">
              <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-success" />
              <p className="text-sm text-fg">{s}</p>
            </motion.div>
          ))}
        </Stagger>
        <CardHeader title="Recommended next action" icon={<ArrowRight className="size-4" />} className="pt-0" />
        <div className="mx-5 mb-5 rounded-2xl border border-brand-200 bg-accent-soft p-4 dark:border-brand-900">
          <p className="text-sm font-semibold text-fg">{a.next_action.action}</p>
          <p className="mt-1 text-xs text-muted">Within {a.next_action.due_in_days === 0 ? "today" : `${a.next_action.due_in_days} day${a.next_action.due_in_days > 1 ? "s" : ""}`} · owner: {label(a.next_action.owner)}</p>
        </div>
      </Card>
      <Card delay={0.05}>
        <CardHeader title="Coaching for next time" subtitle="Highest-leverage changes, with lines to use" icon={<Lightbulb className="size-4" />} />
        <Stagger className="space-y-3 px-5 pb-5">
          {a.improvements.length === 0 && <p className="text-sm text-muted">Nothing major to fix on this call — keep doing what worked.</p>}
          {a.improvements.map((im, i) => (
            <motion.div key={i} variants={staggerItem} className="relative overflow-hidden rounded-2xl border border-line p-4">
              <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-brand-400 to-brand-700" />
              <p className="text-[11px] font-bold tracking-wide text-accent uppercase">{im.moment}</p>
              <p className="mt-1 text-sm font-semibold text-fg">{im.issue}</p>
              <p className="mt-1 text-sm text-muted">{im.suggestion}</p>
              <p className="mt-2 rounded-xl bg-sunken px-3 py-2 text-sm text-accent-soft-fg italic"><Wand2 className="mr-1.5 inline size-3.5" />{im.example_line}</p>
            </motion.div>
          ))}
        </Stagger>
      </Card>
      <Card className="lg:col-span-2" delay={0.1}>
        <CardHeader title="How you spoke" subtitle="Computed from the recording's timestamps" icon={<Ear className="size-4" />} />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
          <TalkRatio rep={a.computed?.rep_talk_pct ?? 50} />
          {[
            ["Questions asked", a.talk.questions_asked, "aim for 6+ on discovery calls"],
            ["Open questions", a.talk.open_questions, "how / what / why"],
            ["Filler words", a.talk.filler_words, "basically, actually, umm…"],
            ["Longest monologue", `${a.computed?.longest_monologue_sec ?? 0}s`, "keep under 60s"],
          ].map(([l, v, h], i) => (
            <motion.div key={l as string} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }} className="rounded-2xl border border-line bg-sunken/50 p-4">
              <p className="text-xs font-semibold text-muted">{l}</p>
              <p className="mt-1 text-2xl font-bold text-fg">{v}</p>
              <p className="text-[11px] text-subtle">{h}</p>
            </motion.div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function TalkRatio({ rep }: { rep: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-sunken/50 p-4">
      <svg viewBox="0 0 80 80" className="size-20 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--series-2)" strokeWidth="10" />
        <motion.circle cx="40" cy="40" r={r} fill="none" stroke="var(--series-1)" strokeWidth="10" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - rep / 100) }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
      </svg>
      <div className="text-xs">
        <p className="font-semibold text-muted">Talk ratio</p>
        <p className="mt-1 flex items-center gap-1.5 text-fg"><span className="size-2 rounded-full" style={{ background: "var(--series-1)" }} /> You {rep}%</p>
        <p className="flex items-center gap-1.5 text-fg"><span className="size-2 rounded-full" style={{ background: "var(--series-2)" }} /> Prospect {100 - rep}%</p>
        <p className="mt-1 text-[11px] text-subtle">{rep > 65 ? "Talk less, ask more" : rep < 35 ? "Guide the call more" : "Healthy balance"}</p>
      </div>
    </div>
  );
}

function Frameworks({ a }: { a: CallAnalysis }) {
  const [open, setOpen] = useState<string | null>(a.frameworks[0]?.framework ?? null);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader title="Sales framework radar" subtitle="0–10 · hover a point" icon={<Target className="size-4" />} />
        <div className="grid place-items-center px-4 pb-6">
          <Radar items={a.frameworks.map((f) => ({ label: f.framework, value: f.score }))} />
        </div>
      </Card>
      <Card delay={0.05}>
        <CardHeader title="Framework by framework" subtitle="What you applied and the one move you missed" icon={<BrainCircuit className="size-4" />} />
        <div className="space-y-1.5 px-3 pb-4">
          {a.frameworks.map((f) => (
            <div key={f.framework} className="overflow-hidden rounded-2xl border border-line">
              <button onClick={() => setOpen(open === f.framework ? null : f.framework)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-hover">
                <span className="w-24 shrink-0 text-sm font-bold text-fg">{f.framework}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                  <motion.span className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" initial={{ width: 0 }} animate={{ width: `${f.score * 10}%` }} transition={{ duration: 0.9 }} />
                </span>
                <span className="w-8 text-right text-sm font-bold text-fg tabular-nums">{f.score.toFixed(1)}</span>
              </button>
              <AnimatePresence>
                {open === f.framework && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="grid gap-2 border-t border-line bg-sunken/40 p-3.5 text-sm sm:grid-cols-2">
                      <p><span className="font-semibold text-success">Applied: </span><span className="text-fg">{f.applied}</span></p>
                      <p><span className="font-semibold text-warning">Missed: </span><span className="text-fg">{f.missed}</span></p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </Card>
      <Card className="lg:col-span-2" delay={0.1}>
        <CardHeader title="Skills scorecard" icon={<TrendingUp className="size-4" />} />
        <div className="grid gap-x-10 gap-y-1 px-5 pb-5 md:grid-cols-2">
          <BarList tone="status" max={10} format={(v) => v.toFixed(1)} items={Object.entries(a.skills).slice(0, 5).map(([k, v]) => ({ key: k, label: SKILL_LABEL[k] ?? k, value: v }))} />
          <BarList tone="status" max={10} format={(v) => v.toFixed(1)} items={Object.entries(a.skills).slice(5).map(([k, v]) => ({ key: k, label: SKILL_LABEL[k] ?? k, value: v }))} />
        </div>
      </Card>
    </div>
  );
}

function Prospect({ a }: { a: CallAnalysis }) {
  const s0 = SENTIMENT.indexOf(a.prospect.sentiment_start);
  const s1 = SENTIMENT.indexOf(a.prospect.sentiment_end);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card>
        <CardHeader title="Sentiment journey" icon={<UserRound className="size-4" />} />
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between">
            <div className="text-center"><p className="text-4xl">{SENT_EMOJI[a.prospect.sentiment_start]}</p><p className="mt-1 text-xs text-muted">Start</p></div>
            <div className="relative mx-3 h-1 flex-1 rounded-full bg-sunken">
              <motion.div className={cn("absolute inset-y-0 left-0 rounded-full", s1 >= s0 ? "bg-gradient-to-r from-brand-400 to-emerald-500" : "bg-gradient-to-r from-brand-400 to-rose-500")} initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 1.2 }} />
              <motion.span className="absolute -top-2.5 text-lg" initial={{ left: "0%" }} animate={{ left: "92%" }} transition={{ duration: 1.2 }}>→</motion.span>
            </div>
            <div className="text-center"><p className="text-4xl">{SENT_EMOJI[a.prospect.sentiment_end]}</p><p className="mt-1 text-xs text-muted">End</p></div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Mini label="Interest" value={`${a.prospect.interest_level}/10`} />
            <Mini label="Temperature" value={`${a.prospect.temperature}/100`} />
            <Mini label="Decision-maker" value={label(a.prospect.decision_maker)} />
            <Mini label="Engagement" value={a.prospect.engagement.split(/[.—;]/)[0]} small />
          </div>
          <p className="mt-4 text-sm text-fg">{a.prospect.response_summary}</p>
        </div>
      </Card>
      <Card delay={0.05}>
        <CardHeader title="BANT evidence" icon={<CheckCircle2 className="size-4" />} />
        <div className="space-y-2 px-5 pb-5">
          {(["budget", "authority", "need", "timeline"] as const).map((k) => {
            const b = a.bant[k];
            const tone = b.status === "confirmed" ? "success" : b.status === "indicated" ? "brand" : b.status === "negative" ? "danger" : "neutral";
            return (
              <div key={k} className="rounded-2xl border border-line p-3">
                <div className="flex items-center justify-between"><p className="text-sm font-semibold text-fg capitalize">{k}</p><Badge tone={tone}>{b.status}</Badge></div>
                {b.evidence && <p className="mt-1 text-xs text-muted italic">“{b.evidence}”</p>}
              </div>
            );
          })}
        </div>
      </Card>
      <Card delay={0.1}>
        <CardHeader title="In their words" icon={<MessageSquareQuote className="size-4" />} />
        <div className="space-y-2 px-5 pb-5">
          {a.prospect.key_quotes.map((qt, i) => (
            <motion.blockquote key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="rounded-2xl border-l-4 border-brand-400 bg-sunken/60 px-3.5 py-2.5 text-sm text-fg italic">“{qt}”</motion.blockquote>
          ))}
          {!a.prospect.key_quotes.length && <p className="text-sm text-muted">No standout quotes.</p>}
        </div>
      </Card>
      <Card className="lg:col-span-2" delay={0.15}>
        <CardHeader title="Objections" subtitle="How each one was handled — and a better line" icon={<CircleAlert className="size-4" />} />
        <div className="space-y-2.5 px-5 pb-5">
          {a.objections.length === 0 && <p className="text-sm text-muted">No objections raised.</p>}
          {a.objections.map((o, i) => (
            <div key={i} className="rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="violet">{label(o.category)}</Badge><Badge tone={HANDLING_TONE[o.handling] ?? "neutral"}>Handled {label(o.handling).toLowerCase()}</Badge></div>
              <p className="mt-2 text-sm text-fg italic">“{o.quote}”</p>
              <p className="mt-2 text-sm text-accent-soft-fg"><Sparkles className="mr-1 inline size-3.5" />{o.better_response}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card delay={0.2}>
        <CardHeader title="Signals for the business" icon={<Lightbulb className="size-4" />} />
        <div className="space-y-4 px-5 pb-5 text-sm">
          <SignalList title="Pain points" items={a.pain_points} tone="danger" />
          <SignalList title="Product requests" items={a.product_requests} tone="brand" />
          <SignalList title="Buying signals" items={a.buying_signals} tone="success" />
          <SignalList title="Competitors" items={a.competitors} tone="warning" />
          <SignalList title="Risks" items={a.risks} tone="neutral" />
        </div>
      </Card>
    </div>
  );
}

function Mini({ label: l, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl bg-sunken/70 p-2.5">
      <p className="text-[11px] font-semibold text-muted">{l}</p>
      <p className={cn("font-bold text-fg", small ? "text-xs" : "text-base")}>{value}</p>
    </div>
  );
}

function SignalList({ title, items, tone }: { title: string; items: string[]; tone: "danger" | "brand" | "success" | "warning" | "neutral" }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-bold tracking-wide text-muted uppercase">{title}</p>
      <div className="flex flex-wrap gap-1.5">{items.map((x, i) => <Badge key={i} tone={tone} className="max-w-full whitespace-normal">{x}</Badge>)}</div>
    </div>
  );
}

function Transcript({ call }: { call: Call }) {
  const [find, setFind] = useState("");
  const roles = call.transcript?.roles ?? {};
  const utterances = call.transcript?.utterances ?? [];
  const shown = useMemo(() => (find ? utterances.filter((u) => u.text.toLowerCase().includes(find.toLowerCase())) : utterances), [find, utterances]);
  const stamp = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <Card>
      <CardHeader title="Transcript" subtitle={`${utterances.length} turns · speaker labels from diarisation`} icon={<Mic className="size-4" />} action={<div className="w-48"><Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in call…" className="h-8 text-xs" /></div>} />
      <div className="max-h-[70vh] space-y-2.5 overflow-y-auto px-5 pb-6">
        {shown.map((u, i) => {
          const rep = (u.role ?? roles[u.speaker]) === "rep";
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 8, x: rep ? 10 : -10 }} animate={{ opacity: 1, y: 0, x: 0 }} transition={{ delay: Math.min(i, 30) * 0.03 }} className={cn("flex gap-2", rep && "flex-row-reverse")}>
              <span className={cn("mt-1 grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold", rep ? "bg-brand-600 text-white" : "bg-sunken text-muted ring-1 ring-line")}>{rep ? "FR" : "P"}</span>
              <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm", rep ? "rounded-tr-md bg-gradient-to-br from-brand-500 to-brand-700 text-white" : "rounded-tl-md bg-sunken text-fg ring-1 ring-line")}>
                <p>{u.text}</p>
                <p className={cn("mt-1 font-mono text-[10px]", rep ? "text-white/60" : "text-subtle")}>{stamp(u.start)}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}
