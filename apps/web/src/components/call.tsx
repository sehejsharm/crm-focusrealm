import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarClock, Check, ChevronDown, Mic, Phone, PhoneCall, PhoneForwarded, PhoneOff, Smartphone, Sparkles, Upload, X,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn, duration, localInput, OUTCOMES, phone as fmtPhone } from "../lib/format";
import { useFastLive, useLive } from "../lib/live";
import { uploadRecording } from "../lib/recording";
import type { Call } from "../lib/types";
import { celebrate, PulseRings, Waveform } from "./motion";
import { useToast } from "./toast";
import { Avatar, Button, Checkbox, Field, Modal, Progress, Textarea } from "./ui";

/**
 * The calling experience, available everywhere:
 *   Call → (rings your phone / sends the number to your Phone Link / demo) →
 *   live dock with timer → wrap-up: outcome, notes, next step, recording.
 */

interface CallTarget {
  id: string;
  full_name: string;
  company_name?: string | null;
  phone_key?: string | null;
}

interface Ctx {
  start: (contact: CallTarget) => Promise<void>;
  active: Call | null;
}

const CallCtx = createContext<Ctx>({ start: async () => {}, active: null });
export const useCall = () => useContext(CallCtx);

export function CallProvider({ children }: { children: ReactNode }) {
  const { meta } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [active, setActive] = useState<Call | null>(null);
  const [target, setTarget] = useState<CallTarget | null>(null);
  const [wrapUp, setWrapUp] = useState<Call | null>(null);
  const [minimised, setMinimised] = useState(false);
  useFastLive("call", Boolean(active));

  const start = async (contact: CallTarget) => {
    if (active) {
      toast({ kind: "info", title: "Finish your current call first" });
      setMinimised(false);
      return;
    }
    try {
      const r = await api.post<{ call: Call }>("/calls", { contactId: contact.id });
      setTarget(contact);
      setActive(r.call);
      setMinimised(false);
    } catch (e) {
      toast({ kind: "error", title: "Couldn't start the call", body: (e as Error).message });
    }
  };

  useLive("call.updated", (d: { id: string; status?: string; duration_sec?: number; outcome?: string }) => {
    // Logged from the Phone Link: close the dock here too.
    if (d.outcome && active?.id === d.id) {
      setActive(null);
      toast({ kind: "success", title: "Call logged from your phone" });
      qc.invalidateQueries({ queryKey: ["dash"] });
      return;
    }
    setActive((c) => (c && c.id === d.id && d.status ? { ...c, status: d.status, duration_sec: d.duration_sec ?? c.duration_sec } : c));
  });

  const end = async () => {
    if (!active) return;
    const r = await api.post<{ call: Call }>(`/calls/${active.id}/status`, { status: "completed" }).catch(() => null);
    setWrapUp(r?.call ?? active);
    setActive(null);
  };

  const cancel = async () => {
    if (!active) return;
    await api.post(`/calls/${active.id}/status`, { status: "cancelled" }).catch(() => {});
    setActive(null);
    qc.invalidateQueries({ queryKey: ["dash"] });
  };

  return (
    <CallCtx.Provider value={{ start, active }}>
      {children}
      <AnimatePresence>
        {active && target && (
          <CallDock key={active.id} call={active} target={target} mode={active.mode} minimised={minimised} setMinimised={setMinimised} onEnd={end} onCancel={cancel} telephony={meta?.telephonyMode} />
        )}
      </AnimatePresence>
      <WrapUp call={wrapUp} target={target} onClose={() => setWrapUp(null)} />
    </CallCtx.Provider>
  );
}

function useTimer(running: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return s;
}

function CallDock({ call, target, mode, minimised, setMinimised, onEnd, onCancel }: {
  call: Call; target: CallTarget; mode: string; minimised: boolean; setMinimised: (v: boolean) => void; onEnd: () => void; onCancel: () => void; telephony?: string;
}) {
  const live = call.status === "in_progress";
  const secs = useTimer(live);
  const stateLabel =
    call.status === "initiated"
      ? mode === "phone_link" ? "Sent to your phone" : mode === "bridge" ? "Ringing your phone…" : "Dialling…"
      : call.status === "ringing" ? "Ringing…" : live ? "Connected" : call.status === "completed" ? "Call ended" : call.status.replace("_", " ");

  if (minimised) {
    return (
      <motion.button
        initial={{ opacity: 0, y: 30, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 30 }}
        onClick={() => setMinimised(false)}
        className="fixed right-4 bottom-4 z-[90] flex items-center gap-3 rounded-full bg-gradient-to-r from-brand-600 to-brand-800 py-2 pr-5 pl-2 text-white shadow-brand"
      >
        <span className="relative grid size-10 place-items-center rounded-full bg-white/15">
          <PulseRings color="bg-white/25" />
          <PhoneCall className="relative size-4.5" />
        </span>
        <span className="text-left text-sm">
          <span className="block font-semibold">{target.full_name}</span>
          <span className="block text-xs text-white/75 tabular-nums">{live ? duration(secs) : stateLabel}</span>
        </span>
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 60, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 60, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#0b2a66] via-brand-800 to-brand-950 text-white shadow-[0_30px_80px_-20px_rgba(10,30,80,0.7)] sm:right-6 sm:bottom-6 sm:left-auto sm:mx-0 sm:w-[400px]"
    >
      <div className="pointer-events-none absolute -top-24 -right-20 size-64 rounded-full bg-brand-400/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-sky/20 blur-3xl" />
      <div className="relative flex items-center justify-between px-5 pt-4">
        <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-white/70 uppercase">
          <span className="relative flex size-2">
            <span className={cn("absolute inline-flex size-full rounded-full opacity-75", live ? "animate-ping bg-emerald-400" : "animate-ping bg-sky")} />
            <span className={cn("relative inline-flex size-2 rounded-full", live ? "bg-emerald-400" : "bg-sky")} />
          </span>
          {call.call_code}
        </span>
        <button onClick={() => setMinimised(true)} className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Minimise">
          <ChevronDown className="size-4" />
        </button>
      </div>

      <div className="relative flex flex-col items-center px-6 pt-4 pb-6 text-center">
        <div className="relative mb-4 grid size-24 place-items-center">
          <PulseRings color={live ? "bg-emerald-400/25" : "bg-sky/25"} />
          <div className="relative">
            <Avatar name={target.full_name} size={84} hue={210} className="ring-4 ring-white/15" />
          </div>
        </div>
        <h3 className="text-xl font-bold tracking-tight">{target.full_name}</h3>
        <p className="text-sm text-white/65">{target.company_name ?? ""}</p>
        <p className="mt-1 font-mono text-sm tracking-wider text-white/80">{fmtPhone(target.phone_key ?? call.contact_phone_display ?? null)}</p>

        <AnimatePresence mode="wait">
          <motion.div key={call.status} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mt-4 flex flex-col items-center">
            {mode === "phone_link" && call.status === "initiated" ? <SentToPhone /> : <Waveform active={live} bars={34} className="h-12" />}
            <p className="mt-2 text-sm font-semibold">
              {stateLabel}
              {live && <span className="ml-2 font-mono tabular-nums text-white/80">{duration(secs)}</span>}
            </p>
            {mode === "phone_link" && call.status === "initiated" && (
              <p className="mt-1 max-w-xs text-xs text-white/60">Open <b>Phone Link</b> on your phone and tap the number. Recording is attached after the call.</p>
            )}
            {mode === "demo" && <p className="mt-1 text-[11px] text-white/50">Demo mode — no real call is placed</p>}
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 flex items-center gap-4">
          {!live && call.status !== "completed" && (
            <Button variant="ghost" className="text-white/75 hover:bg-white/10 hover:text-white" onClick={onCancel} icon={<X className="size-4" />}>
              Cancel
            </Button>
          )}
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            onClick={onEnd}
            className="grid size-16 place-items-center rounded-full bg-gradient-to-b from-rose-500 to-rose-600 shadow-[0_10px_30px_-8px_rgba(244,63,94,0.8)]"
            aria-label="End call and log outcome"
          >
            <PhoneOff className="size-6" />
          </motion.button>
        </div>
        <p className="mt-2 text-[11px] text-white/50">End the call to log the outcome</p>
      </div>
    </motion.div>
  );
}

/** Number flying from laptop to phone. */
function SentToPhone() {
  return (
    <div className="relative flex h-14 w-48 items-center justify-between">
      <span className="grid size-10 place-items-center rounded-xl bg-white/10"><PhoneForwarded className="size-5" /></span>
      <div className="relative h-px flex-1 overflow-hidden bg-white/15">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-sky" initial={{ left: "-5%" }} animate={{ left: "105%" }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.45, ease: "easeInOut" }} />
        ))}
      </div>
      <motion.span animate={{ rotate: [0, -10, 10, -6, 6, 0] }} transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 1 }} className="grid size-10 place-items-center rounded-xl bg-white text-brand-700">
        <Smartphone className="size-5" />
      </motion.span>
    </div>
  );
}

// ------------------------------------------------------------------ wrap-up

const QUICK = [
  { label: "In 2 hours", at: () => new Date(Date.now() + 2 * 3600_000) },
  { label: "Tomorrow 11 AM", at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); return d; } },
  { label: "In 2 days", at: () => { const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(11, 0, 0, 0); return d; } },
  { label: "Next week", at: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(11, 0, 0, 0); return d; } },
];

export function WrapUp({ call, target, onClose }: { call: Call | null; target: CallTarget | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [nextAt, setNextAt] = useState<string>("");
  const [qual, setQual] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (call) {
      setOutcome(null);
      setNotes("");
      setNextAt("");
      setQual({});
      setFile(null);
      setProgress(null);
    }
  }, [call?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsNext = outcome && ["follow_up_agreed", "callback_requested", "interested", "meeting_booked"].includes(outcome);
  const hot = outcome === "interested" || outcome === "meeting_booked";

  const save = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ call: Call }>(`/calls/${call!.id}/outcome`, {
        outcome,
        notes: notes || null,
        next: nextAt ? { kind: outcome === "meeting_booked" ? "meeting" : "follow_up", dueAt: new Date(nextAt).toISOString(), reason: notes || null } : null,
        qualification: hot ? qual : undefined,
      });
      if (file) await uploadRecording(call!.id, file, setProgress);
      return r.call;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      if (hot) celebrate();
      toast({
        kind: hot ? "success" : "info",
        title: hot ? `${target?.full_name ?? "Prospect"} is heating up 🔥` : "Call logged",
        body: file ? "Recording uploaded — it'll be transcribed and analysed." : call?.mode === "demo" ? "Demo transcript generated for the AI." : null,
      });
      onClose();
    },
    onError: (e) => toast({ kind: "error", title: "Couldn't save the call", body: (e as Error).message }),
  });

  return (
    <Modal
      open={Boolean(call)}
      onClose={onClose}
      size="lg"
      icon={<Sparkles className="size-5" />}
      title={`How did it go with ${target?.full_name?.split(" ")[0] ?? "them"}?`}
      subtitle={call ? `${call.call_code}${call.duration_sec ? ` · ${duration(call.duration_sec)}` : ""}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Later</Button>
          {needsNext && !nextAt && <span className="mr-auto text-xs font-medium text-warning">Pick when you'll follow up</span>}
          <Button variant="primary" disabled={!outcome || Boolean(needsNext && !nextAt)} loading={save.isPending} onClick={() => save.mutate()} icon={<Check className="size-4" />}>
            Save call
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-semibold text-fg">Outcome</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {OUTCOMES.map((o, i) => (
              <motion.button
                key={o.key}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.025 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setOutcome(o.key)}
                className={cn(
                  "relative flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[13px] font-semibold transition",
                  outcome === o.key ? "border-brand-500 bg-accent-soft text-accent-soft-fg shadow-sm" : "border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-hover",
                )}
              >
                <span className="text-base">{o.emoji}</span>
                {o.label}
                {outcome === o.key && <motion.span layoutId="outcome-check" className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full bg-brand-600 text-white"><Check className="size-3" /></motion.span>}
              </motion.button>
            ))}
          </div>
        </div>

        <Field label="Notes" hint="What did they say? What matters for the next call?">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Uses Excel for orders, MD decides above ₹5L, wants a demo Thursday" />
        </Field>

        <AnimatePresence>
          {needsNext && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg"><CalendarClock className="size-4 text-accent" /> Next action <span className="font-normal text-muted">— required, so no promising lead goes quiet</span></p>
              <div className="flex flex-wrap gap-2">
                {QUICK.map((q) => {
                  const v = localInput(q.at());
                  return (
                    <button key={q.label} type="button" onClick={() => setNextAt(v)} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition", nextAt === v ? "border-brand-500 bg-brand-600 text-white" : "border-line bg-surface text-muted hover:text-fg")}>
                      {q.label}
                    </button>
                  );
                })}
                <input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} className="h-8 rounded-full border border-line bg-surface px-3 text-xs text-fg" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {hot && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <p className="mb-1 text-[13px] font-semibold text-fg">What did you confirm?</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {[
                  ["decision_maker", "Spoke to the decision-maker"],
                  ["need", "Clear need or pain point"],
                  ["interest", "Agreed to a Legion meeting"],
                  ["budget", "Budget indicated"],
                  ["timeline", "Timeline known"],
                ].map(([k, l]) => (
                  <Checkbox key={k} checked={Boolean(qual[k])} onChange={(v) => setQual((q) => ({ ...q, [k]: v }))} label={l} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {call && call.mode !== "demo" && (
          <div className="rounded-2xl border border-dashed border-line-strong bg-sunken/60 p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-soft-fg"><Mic className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{file ? file.name : call.mode === "bridge" ? "Recorded automatically" : "Attach the call recording"}</p>
                <p className="text-xs text-muted">{call.mode === "bridge" ? "The provider sends the recording — nothing to do." : "From your phone's call recorder. It's analysed in the end-of-day report."}</p>
              </div>
              {call.mode !== "bridge" && (
                <>
                  <input ref={fileRef} type="file" accept="audio/*,.m4a,.amr,.mp3,.wav,.ogg,.aac" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <Button size="sm" variant="soft" icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
                    {file ? "Change" : "Choose"}
                  </Button>
                </>
              )}
            </div>
            {progress != null && <Progress value={progress} className="mt-3" />}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The big call button used across the CRM. */
export function CallButton({ contact, size = "md", className, label = "Call" }: { contact: CallTarget & { do_not_contact?: boolean }; size?: "sm" | "md" | "lg"; className?: string; label?: string }) {
  const { start, active } = useCall();
  const [busy, setBusy] = useState(false);
  const disabled = Boolean(contact.do_not_contact) || !contact.phone_key;
  return (
    <Button
      size={size}
      variant="success"
      className={cn("shadow-[0_10px_24px_-10px_rgba(16,185,129,0.7)]", className)}
      disabled={disabled || Boolean(active)}
      loading={busy}
      title={contact.do_not_contact ? "Do not contact" : undefined}
      icon={<Phone className="size-4" />}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        await start(contact);
        setBusy(false);
      }}
    >
      {label}
    </Button>
  );
}
