import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Mic, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { AUDIO_ACCEPT, AUDIO_FORMATS, AUDIO_MAX_MB } from "../lib/audio";
import { cn } from "../lib/format";
import { uploadRecording } from "../lib/recording";
import { useToast } from "./toast";
import { Progress } from "./ui";

/** The formats strip shown wherever a recording can be uploaded. */
export function AudioFormats({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {AUDIO_FORMATS.map((f) => (
        <span key={f.label} className="rounded-lg bg-sunken px-2 py-0.5 font-mono text-[11px] font-semibold text-muted ring-1 ring-line">{f.label}</span>
      ))}
      <span className="text-[11px] text-subtle">· up to {AUDIO_MAX_MB} MB</span>
    </div>
  );
}

/**
 * Drop (or pick) the recording for one call. Uploads straight to storage,
 * then the CRM transcribes and analyses it.
 */
export function RecordingDrop({ callId, compact, onDone }: { callId: string; compact?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const send = async (file: File) => {
    setPct(1);
    try {
      await uploadRecording(callId, file, setPct);
      setDone(true);
      toast({ kind: "success", title: "Recording uploaded", body: "It'll be transcribed and analysed by the AI." });
      qc.invalidateQueries({ queryKey: ["recordings"] });
      qc.invalidateQueries({ queryKey: ["call", callId] });
      qc.invalidateQueries({ queryKey: ["calls"] });
      onDone?.();
    } catch (e) {
      toast({ kind: "error", title: "Upload failed", body: (e as Error).message });
    } finally {
      setPct(null);
    }
  };

  if (done) {
    return (
      <motion.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-1.5 text-sm font-semibold text-success">
        <CheckCircle2 className="size-4" /> Uploaded
      </motion.span>
    );
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f && pct == null) send(f); }}
      className={cn(
        "relative rounded-2xl border-2 border-dashed transition",
        compact ? "px-3 py-2" : "px-5 py-6 text-center",
        drag ? "border-brand-500 bg-accent-soft" : "border-line-strong hover:border-brand-400",
      )}
    >
      <input ref={input} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) send(f); }} />
      <AnimatePresence mode="wait">
        {pct != null ? (
          <motion.div key="up" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cn("space-y-1.5", compact ? "w-40" : "mx-auto max-w-xs")}>
            <p className="text-xs font-semibold text-muted">Uploading… {pct}%</p>
            <Progress value={pct} height={6} />
          </motion.div>
        ) : compact ? (
          <motion.button key="pick" type="button" onClick={() => input.current?.click()} className="flex items-center gap-2 text-sm font-semibold text-accent">
            <UploadCloud className="size-4" /> Drop or choose file
          </motion.button>
        ) : (
          <motion.div key="pick-big" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <button type="button" onClick={() => input.current?.click()} className="mx-auto grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-brand">
              <Mic className="size-6" />
            </button>
            <p className="mt-3 text-sm font-bold text-fg">Drop the call recording here, or <button type="button" onClick={() => input.current?.click()} className="text-accent hover:underline">choose a file</button></p>
            <AudioFormats className="mt-2 justify-center" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
