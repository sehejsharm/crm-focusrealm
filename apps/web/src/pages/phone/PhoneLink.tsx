import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CheckCircle2, Mic, Phone, PhoneCall, ShieldCheck, Upload, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BrandTile } from "../../components/brand";
import { Aurora, celebrate, PulseRings } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Progress } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, cn, OUTCOMES } from "../../lib/format";
import { useFastLive, useLive, useLiveStatus } from "../../lib/live";
import { uploadRecording } from "../../lib/recording";

interface Dial {
  callId: string;
  callCode: string;
  phone: string;
  tel: string;
  name: string;
  company: string | null;
  consentText: string | null;
}

/**
 * Phone Link — open /phone on the salesperson's mobile. When they press
 * Call in the CRM, the number appears here: tap to dial on the phone's own
 * SIM, then attach the recording from the phone's call recorder.
 */
export default function PhoneLink() {
  const { user, meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const live = useLiveStatus();
  useFastLive("phone");
  const [dial, setDial] = useState<Dial | null>(null);
  const [stage, setStage] = useState<"ready" | "incoming" | "dialled" | "wrap">("ready");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachFor, setAttachFor] = useState<string | null>(null);

  const awaiting = useQuery({ queryKey: ["awaiting"], queryFn: () => api.get<{ calls: any[] }>("/calls/awaiting-recording"), refetchInterval: 30_000 });

  // A call started before this screen was opened.
  useEffect(() => {
    api.get<{ call: any }>("/calls/live").then((r) => {
      if (r.call && r.call.mode === "phone_link" && r.call.status === "initiated") {
        setDial({ callId: r.call.id, callCode: r.call.call_code, phone: `+${r.call.phone_dialed}`, tel: `tel:+${r.call.phone_dialed}`, name: r.call.contact_name, company: r.call.company_name, consentText: null });
        setStage("incoming");
      }
    }).catch(() => {});
  }, []);

  useLive("dial", (d: Dial) => {
    setDial(d);
    setStage("incoming");
    setOutcome(null);
    if ("vibrate" in navigator) navigator.vibrate?.([120, 80, 120]);
  });

  // Coming back to the screen after dialling → wrap up.
  useEffect(() => {
    const fn = () => {
      if (!document.hidden && stage === "dialled") setStage("wrap");
    };
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, [stage]);

  const startDial = () => {
    if (!dial) return;
    api.post(`/calls/${dial.callId}/status`, { status: "in_progress" }).catch(() => {});
    setStage("dialled");
  };

  const finish = async (file?: File | null) => {
    if (!dial) return;
    try {
      await api.post(`/calls/${dial.callId}/status`, { status: "completed" }).catch(() => {});
      if (outcome) await api.post(`/calls/${dial.callId}/outcome`, { outcome });
      if (file) await uploadRecording(dial.callId, file, setProgress);
      if (outcome === "meeting_booked" || outcome === "interested") celebrate();
      toast({ kind: "success", title: file ? "Recording uploaded" : "Call saved", body: file ? "It's analysed in tonight's report." : "Attach the recording any time below." });
      setDial(null);
      setStage("ready");
      setProgress(null);
      qc.invalidateQueries({ queryKey: ["awaiting"] });
    } catch (e) {
      toast({ kind: "error", title: "Upload failed", body: (e as Error).message });
      setProgress(null);
    }
  };

  const attachLater = async (callId: string, file: File) => {
    try {
      setAttachFor(callId);
      await uploadRecording(callId, file, setProgress);
      toast({ kind: "success", title: "Recording attached" });
      qc.invalidateQueries({ queryKey: ["awaiting"] });
    } catch (e) {
      toast({ kind: "error", title: "Upload failed", body: (e as Error).message });
    } finally {
      setAttachFor(null);
      setProgress(null);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-b from-[#061a42] via-[#0b2a66] to-[#1655c0] text-white">
      <Aurora intensity={0.8} />
      <header className="relative flex items-center justify-between p-4">
        <Link to="/" className="flex items-center gap-2 text-sm text-white/70"><ArrowLeft className="size-4" /> CRM</Link>
        <div className="flex items-center gap-2"><BrandTile size={30} /><span className="text-sm font-bold">Phone Link</span></div>
        <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", live ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10 text-white/60")}><Wifi className="size-3.5" />{live ? "Linked" : "…"}</span>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center px-6 pb-8 text-center">
        <AnimatePresence mode="wait">
          {stage === "ready" && (
            <motion.div key="ready" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex flex-col items-center">
              <div className="relative grid size-44 place-items-center">
                <PulseRings color="bg-sky/20" count={4} />
                <span className="relative grid size-24 place-items-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur"><Phone className="size-10" /></span>
              </div>
              <h1 className="mt-6 text-2xl font-bold">Ready, {user?.full_name.split(" ")[0]}</h1>
              <p className="mt-2 max-w-xs text-sm text-white/70">Press <b>Call</b> on any prospect in the CRM on your laptop. The number appears here instantly — tap to dial.</p>
              {meta?.telephonyMode !== "phone_link" && <p className="mt-3 max-w-xs rounded-xl bg-white/10 px-3 py-2 text-xs text-white/70">Calling mode is <b>{meta?.telephonyMode}</b> — ask a founder to switch to Phone Link in Settings to use this screen.</p>}
            </motion.div>
          )}

          {stage === "incoming" && dial && (
            <motion.div key="incoming" initial={{ opacity: 0, y: 60, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -40 }} transition={{ type: "spring", stiffness: 260, damping: 22 }} className="flex w-full max-w-sm flex-col items-center">
              <p className="text-xs font-bold tracking-[0.2em] text-sky uppercase">Call from your CRM</p>
              <h1 className="mt-3 text-3xl font-bold">{dial.name}</h1>
              {dial.company && <p className="text-white/70">{dial.company}</p>}
              <motion.p initial={{ letterSpacing: "0.4em", opacity: 0 }} animate={{ letterSpacing: "0.06em", opacity: 1 }} transition={{ duration: 0.8 }} className="mt-4 font-mono text-3xl font-bold">{dial.phone}</motion.p>
              <p className="mt-1 font-mono text-[11px] text-white/50">{dial.callCode}</p>
              {dial.consentText && <p className="mt-5 flex items-start gap-2 rounded-2xl bg-white/10 px-4 py-3 text-left text-xs text-white/80"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky" />Say: “{dial.consentText}”</p>}
              <a href={dial.tel} onClick={startDial} className="relative mt-8 grid size-24 place-items-center">
                <PulseRings color="bg-emerald-400/30" />
                <motion.span animate={{ rotate: [0, -12, 12, -8, 8, 0] }} transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 0.8 }} className="relative grid size-20 place-items-center rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_15px_40px_-10px_rgba(16,185,129,0.9)]">
                  <PhoneCall className="size-9" />
                </motion.span>
              </a>
              <p className="mt-3 text-sm font-semibold">Tap to call</p>
              <button onClick={() => setStage("wrap")} className="mt-6 text-xs text-white/60 underline">I dialled it another way</button>
            </motion.div>
          )}

          {stage === "dialled" && dial && (
            <motion.div key="dialled" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center">
              <div className="relative grid size-32 place-items-center"><PulseRings color="bg-emerald-400/25" /><span className="relative grid size-20 place-items-center rounded-full bg-emerald-500"><PhoneCall className="size-9" /></span></div>
              <h1 className="mt-6 text-2xl font-bold">On the call with {dial.name.split(" ")[0]}</h1>
              <p className="mt-2 text-sm text-white/70">Come back here when you hang up.</p>
              <button onClick={() => setStage("wrap")} className="mt-6 rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold">Call ended</button>
            </motion.div>
          )}

          {stage === "wrap" && dial && (
            <motion.div key="wrap" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full max-w-sm text-left">
              <h1 className="text-center text-2xl font-bold">How did it go?</h1>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {OUTCOMES.slice(0, 8).map((o) => (
                  <button key={o.key} onClick={() => setOutcome(o.key)} className={cn("rounded-2xl px-3 py-3 text-left text-sm font-semibold transition", outcome === o.key ? "bg-white text-brand-800 shadow-lg" : "bg-white/10 text-white")}>
                    <span className="mr-1.5">{o.emoji}</span>{o.label}
                  </button>
                ))}
              </div>
              <div className="mt-5 rounded-2xl bg-white/10 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold"><Mic className="size-4" /> Attach the recording</p>
                <p className="mt-1 text-xs text-white/65">Pick the file from your phone's call recordings. You can also add notes later on your laptop.</p>
                <input ref={fileRef} type="file" accept="audio/*,.m4a,.amr,.mp3,.wav,.ogg,.aac,.3gp" className="hidden" onChange={(e) => e.target.files?.[0] && finish(e.target.files[0])} />
                {progress != null ? <Progress value={progress} className="mt-3 bg-white/10" /> : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-bold text-brand-800"><Upload className="size-4" /> Recording</button>
                    <button onClick={() => finish(null)} className="rounded-xl bg-white/15 py-3 text-sm font-semibold">Save without</button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {(awaiting.data?.calls ?? []).length > 0 && stage === "ready" && (
        <section className="relative mx-4 mb-6 rounded-3xl bg-white/10 p-4 backdrop-blur">
          <p className="mb-2 text-xs font-bold tracking-wide text-white/70 uppercase">Recordings still to attach</p>
          <div className="space-y-2">
            {awaiting.data!.calls.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/10 px-3 py-2.5">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.contact_name}</span><span className="text-[11px] text-white/60">{c.call_code} · {ago(c.started_at)}</span></span>
                {attachFor === c.id ? <span className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <span className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-brand-800"><Upload className="size-3.5" />Attach</span>}
                <input type="file" accept="audio/*,.m4a,.amr,.mp3,.wav,.ogg,.aac,.3gp" className="hidden" onChange={(e) => e.target.files?.[0] && attachLater(c.id, e.target.files[0])} />
              </label>
            ))}
          </div>
        </section>
      )}
      <p className="relative pb-4 text-center text-[11px] text-white/40"><CheckCircle2 className="mr-1 inline size-3" />Add to Home Screen for one-tap access</p>
    </div>
  );
}
