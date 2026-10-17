import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  AlarmClock, ArrowRight, Building2, Clock, Flame, Lightbulb, MapPin, MessageSquareQuote, Phone, SkipForward, Sparkles, Trophy, Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useCall } from "../../components/call";
import { celebrate } from "../../components/motion";
import { Avatar, Badge, Button, Card, Empty, Kbd, Progress, Skeleton } from "../../components/ui";
import { WhatsAppButton } from "../../components/whatsapp";
import { api } from "../../lib/api";
import { ago, cn, fmtTime, label, phone } from "../../lib/format";

interface Item {
  id: string;
  reason: "follow_up" | "fresh" | "quiet";
  task_title: string | null;
  due_at: string | null;
  full_name: string;
  designation: string | null;
  city: string | null;
  phone_key: string | null;
  temperature: number | null;
  status: string;
  call_count: number;
  last_contacted_at: string | null;
  company_name: string | null;
  last_outcome: string | null;
  last_note: string | null;
  ai_next: string | null;
  ai_line: string | null;
}

const REASON: Record<Item["reason"], { label: string; tone: "danger" | "brand" | "warning"; icon: typeof AlarmClock }> = {
  follow_up: { label: "Follow-up due", tone: "danger", icon: AlarmClock },
  fresh: { label: "Fresh prospect", tone: "brand", icon: Sparkles },
  quiet: { label: "Gone quiet", tone: "warning", icon: Clock },
};

/**
 * Call Sprint — a power-dialler: the queue for right now, one prospect at a
 * time with everything worth knowing before dialling. Call → wrap up → the
 * next one is already on screen. Space calls, S skips.
 */
export default function Sprint() {
  const qc = useQueryClient();
  const { start, busy } = useCall();
  const q = useQuery({ queryKey: ["sprint"], queryFn: () => api.get<{ queue: Item[]; counts: Record<string, number> }>("/sprint"), staleTime: Infinity, refetchOnWindowFocus: false });
  const queue = q.data?.queue ?? [];
  const [index, setIndex] = useState(0);
  const [called, setCalled] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [startedAt] = useState(Date.now());
  const [tick, setTick] = useState(0);
  const calling = useRef(false);
  const current = queue[index];
  const done = q.data && index >= queue.length;

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // When the call we started is wrapped up, move on to the next prospect.
  useEffect(() => {
    if (calling.current && !busy) {
      calling.current = false;
      setCalled((n) => n + 1);
      setIndex((i) => i + 1);
      qc.invalidateQueries({ queryKey: ["dash"] });
    }
  }, [busy, qc]);

  useEffect(() => {
    if (done && called > 0) celebrate();
  }, [done, called]);

  const call = async () => {
    if (!current || busy) return;
    calling.current = true;
    await start(current);
  };
  const skip = () => {
    if (!current || busy) return;
    setSkipped((n) => n + 1);
    setIndex((i) => i + 1);
  };

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.metaKey || e.ctrlKey) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); call(); }
      if (e.key.toLowerCase() === "s") skip();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  });

  const elapsed = useMemo(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, [tick, startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  if (!queue.length) {
    return (
      <Card className="mx-auto max-w-xl">
        <Empty icon={<Trophy className="size-6" />} title="Nothing to call right now" body="No follow-ups due, no fresh prospects and nobody's gone quiet. New prospects arrive with the morning top-up." action={<Link to="/sales"><Button>Back to My Day</Button></Link>} />
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* progress */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="flex items-center gap-2 text-lg font-bold text-fg"><Zap className="size-5 text-amber-500" /> Call Sprint</p>
          <span className="text-sm text-muted"><b className="text-fg tabular-nums">{Math.min(index + 1, queue.length)}</b> of {queue.length}</span>
          <span className="text-sm text-muted"><b className="text-fg tabular-nums">{called}</b> called · {skipped} skipped</span>
          <span className="ml-auto font-mono text-sm text-muted tabular-nums">{elapsed}</span>
        </div>
        <Progress value={index} max={queue.length} height={8} className="mt-3" />
        <p className="mt-2 text-xs text-muted">{q.data!.counts.follow_up} follow-ups due · {q.data!.counts.fresh} fresh · {q.data!.counts.quiet} gone quiet</p>
      </motion.div>

      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
            <Card className="p-8 text-center">
              <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="mx-auto grid size-16 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg"><Trophy className="size-8" /></motion.div>
              <p className="mt-4 text-2xl font-bold text-fg">Sprint done!</p>
              <p className="mt-1 text-muted">{called} calls in {elapsed}{skipped ? ` · ${skipped} skipped` : ""}. Don't forget the recordings.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Link to="/sales/recordings"><Button variant="primary">Upload recordings</Button></Link>
                <Button onClick={() => { setIndex(0); setCalled(0); setSkipped(0); q.refetch(); }}>Start another sprint</Button>
                <Link to="/sales"><Button variant="ghost">My Day</Button></Link>
              </div>
            </Card>
          </motion.div>
        ) : current ? (
          <motion.div key={current.id} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
            <ProspectCard item={current} onCall={call} onSkip={skip} busy={busy} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!done && queue.length > index + 1 && (
        <div>
          <p className="mb-2 text-xs font-bold tracking-wide text-subtle uppercase">Up next</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {queue.slice(index + 1, index + 5).map((x) => {
              const R = REASON[x.reason];
              return (
                <div key={x.id} className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3 py-2.5">
                  <Avatar name={x.full_name} size={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-fg">{x.full_name}</span>
                    <span className="flex items-center gap-1 truncate text-[11px] text-muted"><R.icon className="size-3" />{R.label}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ProspectCard({ item: x, onCall, onSkip, busy }: { item: Item; onCall: () => void; onSkip: () => void; busy: boolean }) {
  const R = REASON[x.reason];
  const overdue = x.due_at && new Date(x.due_at).getTime() < Date.now();
  return (
    <Card className="p-0" spotlight={false}>
      <div className="relative rounded-t-[inherit] bg-gradient-to-br from-brand-50 via-surface to-surface p-6 sm:p-8 dark:from-brand-950/50">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar name={x.full_name} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={R.tone}><R.icon className="mr-1 inline size-3" />{x.reason === "follow_up" && x.due_at ? `${overdue ? "Overdue" : "Due"} · ${fmtTime(x.due_at)}` : x.reason === "quiet" && x.last_contacted_at ? `Quiet since ${ago(x.last_contacted_at)}` : R.label}</Badge>
              {x.temperature != null && <Badge tone={x.temperature >= 70 ? "danger" : x.temperature >= 40 ? "warning" : "neutral"}><Flame className="mr-1 inline size-3" />{x.temperature}°</Badge>}
              {x.call_count > 0 && <Badge tone="neutral">{x.call_count} call{x.call_count === 1 ? "" : "s"} so far</Badge>}
            </div>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-fg">{x.full_name}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {(x.designation || x.company_name) && <span className="flex items-center gap-1.5"><Building2 className="size-4" />{x.designation ? `${x.designation} at ` : ""}<b className="text-fg">{x.company_name ?? "—"}</b></span>}
              {x.city && <span className="flex items-center gap-1.5"><MapPin className="size-4" />{x.city}</span>}
              <span className="font-mono text-fg">{phone(x.phone_key)}</span>
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {x.task_title && <Context icon={<AlarmClock className="size-4" />} title="Why now">{x.task_title}</Context>}
          {(x.last_outcome || x.last_note) && (
            <Context icon={<MessageSquareQuote className="size-4" />} title="Last time">
              {x.last_outcome && <b className="text-fg">{label(x.last_outcome)}. </b>}{x.last_note ?? ""}
            </Context>
          )}
          {x.ai_next && <Context icon={<Sparkles className="size-4" />} title="AI's next step" ai>{x.ai_next}</Context>}
          {x.ai_line && <Context icon={<Lightbulb className="size-4" />} title="Try saying" ai><i>“{x.ai_line.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")}”</i></Context>}
          {x.reason === "fresh" && !x.task_title && <Context icon={<Sparkles className="size-4" />} title="First call">Open with permission, ask about their current process before pitching, and aim to book a short Legion meeting.</Context>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-b-[inherit] border-t border-line bg-surface px-6 py-4 sm:px-8">
        <Button size="lg" variant="success" icon={<Phone className="size-5" />} className="min-w-48 shadow-[0_10px_24px_-10px_rgba(16,185,129,0.7)]" disabled={busy} onClick={onCall}>
          {busy ? "On the call…" : "Call"} <Kbd>Space</Kbd>
        </Button>
        <WhatsAppButton contact={x} />
        <Button variant="ghost" icon={<SkipForward className="size-4" />} disabled={busy} onClick={onSkip}>Skip <Kbd>S</Kbd></Button>
        <Link to={`/sales/contacts/${x.id}`} target="_blank" className="ml-auto flex items-center gap-1 text-sm font-semibold text-accent hover:underline">Full profile <ArrowRight className="size-4" /></Link>
      </div>
    </Card>
  );
}

function Context({ icon, title, children, ai }: { icon: React.ReactNode; title: string; children: React.ReactNode; ai?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-3.5", ai ? "border-brand-200 bg-accent-soft/50 dark:border-brand-900" : "border-line bg-surface")}>
      <p className={cn("flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase", ai ? "text-accent" : "text-subtle")}>{icon}{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}
