import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  AudioLines, BellRing, BrainCircuit, CalendarCheck, Check, ChevronLeft, ChevronRight, EllipsisVertical, FileAudio, Handshake,
  Inbox, LayoutDashboard, ListChecks, Mic, Phone, PhoneCall, Share, Smartphone, Sparkles, SquarePlus, Target, Undo2, Upload, Users, X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn } from "../lib/format";
import type { User } from "../lib/types";
import { BrandTile } from "./brand";
import { celebrate, PulseRings, Waveform } from "./motion";
import { useScrollLock } from "./ui";

/**
 * The onboarding guide for the sales team and Legion. It opens by itself on
 * each of a person's first 12 sign-ins and can't be skipped: it closes only
 * from its last screen, where "Don't show this again" turns it off for good.
 * Anyone can replay it from the user menu ("How to use the CRM").
 */

type Os = "ios" | "android";
type Track = "sales" | "legion";

const OPEN_EVENT = "fr:open-guide";
/** Open the guide on demand (closable, unlike the automatic one). */
export function openGuide() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function detectOs(): Os {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "android";
}

export function GuideGate() {
  const { user } = useAuth();
  const loc = useLocation();
  const [manual, setManual] = useState(false);
  useEffect(() => {
    const fn = () => setManual(true);
    window.addEventListener(OPEN_EVENT, fn);
    return () => window.removeEventListener(OPEN_EVENT, fn);
  }, []);
  if (!user || user.must_change_password || loc.pathname.startsWith("/welcome")) return null;
  const auto = Boolean(user.guide?.show);
  if (!auto && !manual) return null;
  return <Guide user={user} mandatory={auto} onClose={() => setManual(false)} />;
}

interface Step {
  id: string;
  title: string;
  subtitle: string;
  visual: (os: Os) => ReactNode;
  body: (os: Os) => ReactNode;
  perOs?: boolean;
}

function Guide({ user, mandatory, onClose }: { user: User; mandatory: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const [track, setTrack] = useState<Track>(user.role === "legion" ? "legion" : "sales");
  const [os, setOs] = useState<Os>(detectOs);
  const [i, setI] = useState(0);
  const [never, setNever] = useState(false);
  const [saving, setSaving] = useState(false);
  useScrollLock(true);

  const steps = buildSteps(track, user);
  const step = steps[i];
  const last = i === steps.length - 1;

  const finish = async () => {
    setSaving(true);
    try {
      const r = await api.post<{ user: User }>("/auth/guide", { neverAgain: never });
      setUser(r.user);
      qc.setQueryData(["me"], r.user);
    } catch {
      // Still let them in; it'll simply show again next time.
    }
    setSaving(false);
    onClose();
  };
  const next = () => (last ? finish() : setI((x) => Math.min(x + 1, steps.length - 1)));
  const back = () => setI((x) => Math.max(0, x - 1));

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
      if (e.key === "Escape" && !mandatory) onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  });
  useEffect(() => {
    if (last) setTimeout(() => celebrate(), 250);
  }, [last]);

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-slate-950/55 backdrop-blur-sm md:items-center md:p-6" role="dialog" aria-modal="true" aria-label="How to use the Focus Realm CRM">
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className="relative flex h-full w-full flex-col overflow-hidden bg-surface md:h-auto md:max-h-[min(760px,92dvh)] md:max-w-[960px] md:flex-row md:rounded-3xl md:border md:border-line md:shadow-2xl"
      >
        {/* Visual demo */}
        <div className="relative flex h-[38dvh] min-h-[230px] shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-950 pt-[env(safe-area-inset-top)] md:h-auto md:min-h-[560px] md:w-[44%]">
          <div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-sky/30 blur-3xl" />
          <div className="pointer-events-none absolute -right-20 -bottom-28 size-80 rounded-full bg-brand-400/30 blur-3xl" />
          <AnimatePresence mode="wait">
            <motion.div key={`${step.id}-${os}-${track}`} initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -8 }} transition={{ duration: 0.35 }} className="relative">
              {step.visual(os)}
            </motion.div>
          </AnimatePresence>
          {!mandatory && (
            <button onClick={onClose} aria-label="Close the guide" className="absolute top-[max(12px,env(safe-area-inset-top))] right-3 grid size-9 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 md:hidden">
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Words */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-3 px-5 pt-4 md:px-7 md:pt-6">
            <div className="flex flex-1 gap-1">
              {steps.map((s, k) => (
                <button key={s.id} onClick={() => k <= i && setI(k)} aria-label={`Step ${k + 1}: ${s.title}`} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <motion.span className="block h-full rounded-full bg-brand-600" initial={false} animate={{ width: k <= i ? "100%" : "0%" }} transition={{ duration: 0.4 }} />
                </button>
              ))}
            </div>
            <span className="text-xs font-semibold text-muted tabular-nums">{i + 1}/{steps.length}</span>
            {!mandatory && (
              <button onClick={onClose} aria-label="Close the guide" className="hidden size-8 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-fg md:grid">
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4 md:px-7">
            {user.role === "founder" && i === 0 && (
              <div className="mb-3 inline-flex gap-1 rounded-xl border border-line bg-sunken p-1 text-xs font-semibold">
                {(["sales", "legion"] as Track[]).map((t) => (
                  <button key={t} onClick={() => setTrack(t)} className={cn("rounded-lg px-3 py-1.5 transition", track === t ? "bg-surface text-fg shadow-xs" : "text-muted")}>
                    {t === "sales" ? "Sales team's guide" : "Legion's guide"}
                  </button>
                ))}
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div key={`${step.id}-${track}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25 }}>
                <p className="text-[11px] font-bold tracking-[0.18em] text-accent uppercase">{step.subtitle}</p>
                <h2 className="mt-1 text-[22px] leading-tight font-bold tracking-tight text-fg md:text-[26px]">{step.title}</h2>
                {step.perOs && <OsTabs os={os} setOs={setOs} />}
                <div className="mt-3 text-[14.5px] leading-relaxed text-fg/90">{step.body(os)}</div>
                {last && (
                  <button type="button" onClick={() => setNever((n) => !n)} className="mt-5 flex w-full items-start gap-3 rounded-2xl border border-line bg-sunken/60 p-3.5 text-left transition hover:border-line-strong">
                    <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition", never ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong bg-surface")}>{never && <Check className="size-3.5" />}</span>
                    <span>
                      <span className="block text-sm font-semibold text-fg">Don't show this again</span>
                      <span className="block text-xs text-muted">
                        Otherwise it opens each time you sign in, for your first {user.guide?.limit ?? 12} sign-ins
                        {user.guide && mandatory ? ` (this is sign-in ${user.guide.signIn} of ${user.guide.limit})` : ""}. You can replay it any time from your profile menu → How to use the CRM.
                      </span>
                    </span>
                  </button>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-3 border-t border-line px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] md:px-7 md:pb-5">
            <button onClick={back} disabled={i === 0} className="flex h-12 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-0">
              <ChevronLeft className="size-4" /> Back
            </button>
            <motion.button whileTap={{ scale: 0.97 }} onClick={next} disabled={saving} className="ml-auto flex h-12 min-w-[150px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-5 text-[15px] font-bold text-white shadow-brand disabled:opacity-70">
              {last ? (saving ? "Saving…" : "Start using the CRM") : "Next"}
              {!last && <ChevronRight className="size-4" />}
              {last && !saving && <Check className="size-4" />}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function OsTabs({ os, setOs }: { os: Os; setOs: (o: Os) => void }) {
  return (
    <div className="mt-3 inline-flex gap-1 rounded-xl border border-line bg-sunken p-1">
      {(["android", "ios"] as Os[]).map((o) => (
        <button key={o} onClick={() => setOs(o)} className={cn("relative rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition", os === o ? "text-fg" : "text-muted hover:text-fg")}>
          {os === o && <motion.span layoutId="os-tab" className="absolute inset-0 rounded-lg bg-surface shadow-xs" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
          <span className="relative">{o === "ios" ? "iPhone" : "Android"}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ steps

function buildSteps(track: Track, user: User): Step[] {
  const first = user.full_name.split(" ")[0];
  const host = window.location.host;
  const welcome: Step = {
    id: "welcome",
    subtitle: track === "sales" ? "Sales team · 2-minute guide" : "Legion · 2-minute guide",
    title: `Welcome to Focus Realm CRM, ${first}`,
    visual: () => <WelcomeScene />,
    body: () => (
      <>
        <p>Before you start, here's how to set up your phone and how your day works in the CRM:</p>
        <Steps items={[
          "Put the CRM on your phone's home screen",
          "Turn on your phone's call recorder",
          "Upload each call's recording",
          track === "sales" ? "Your day: prospects, calls, follow-ups, handing over to Legion, and your nightly AI report" : "Your day: the handoff inbox, Legion meetings and the sales team's work",
        ]} />
      </>
    ),
  };
  const home: Step = {
    id: "home",
    perOs: true,
    subtitle: "Step 1 · Your phone",
    title: "Put the CRM on your home screen",
    visual: (os) => <PhoneFrame os={os}>{os === "ios" ? <IosHomeScene /> : <AndroidHomeScene />}</PhoneFrame>,
    body: (os) =>
      os === "ios" ? (
        <>
          <Steps items={[
            <>Open <b>{host}</b> in <b>Safari</b> and sign in.</>,
            <>Tap the <b>Share</b> button <Share className="inline size-4 -translate-y-0.5 text-accent" /> at the bottom of the screen.</>,
            <>Scroll down, tap <b>Add to Home Screen</b> <SquarePlus className="inline size-4 -translate-y-0.5 text-accent" />, then <b>Add</b>.</>,
            <>Open the CRM from the new <b>Focus Realm</b> icon. It opens full screen, like an app.</>,
          ]} />
          <Tip>Using Chrome on iPhone? Tap the Share icon in the address bar, then Add to Home Screen.</Tip>
        </>
      ) : (
        <>
          <Steps items={[
            <>Open <b>{host}</b> in <b>Chrome</b> and sign in.</>,
            <>Tap the <b>⋮</b> menu at the top right.</>,
            <>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Add</b> / <b>Install</b>.</>,
            <>Open the CRM from the new <b>Focus Realm</b> icon. It opens full screen, like an app.</>,
          ]} />
          <Tip>Samsung Internet: tap ☰ → Add page to → Home screen.</Tip>
        </>
      ),
  };
  const recorder: Step = {
    id: "recorder",
    perOs: true,
    subtitle: "Step 2 · Record every call",
    title: "Which call recorder to use",
    visual: (os) => <PhoneFrame os={os} dark>{os === "ios" ? <IosRecorderScene /> : <AndroidRecorderScene />}</PhoneFrame>,
    body: (os) =>
      os === "ios" ? (
        <>
          <p>Use the iPhone's <b>built-in call recording</b> (iOS 18.1 or later, iPhone XS or newer). No app to download.</p>
          <Steps items={[
            <>If you don't see it, update your iPhone: <b>Settings → General → Software Update</b>.</>,
            <>During the call, tap the <b>record button</b> <AudioLines className="inline size-4 -translate-y-0.5 text-accent" /> at the <b>top left</b> of the call screen. Both of you hear a short notice that the call is recorded.</>,
            <>Hang up (or tap stop). The recording is saved in the <b>Notes</b> app, in the <b>Call Recordings</b> folder.</>,
          ]} />
          <Tip>iPhone can't record automatically, so tap record on <b>every</b> call.</Tip>
          <Fallback title="Older iPhone without the record button?">
            iPhones older than the XS, or ones that can't update to iOS 18.1, can't record calls, and Apple doesn't allow any free app to.
            The free way: put the call on <b>speaker</b> and record it with the free recorder on a second phone or your laptop
            (<b>Voice Memos</b> on iPhone or Mac, <b>Sound Recorder</b> on Windows, <b>Recorder</b> on Android). Then upload that file.
          </Fallback>
        </>
      ) : (
        <>
          <p>Use your phone's <b>own Phone app recorder</b> and set it to record automatically. Recorder apps from the Play Store don't work on most new Android phones.</p>
          <Steps items={[
            <><b>Google Phone app</b> (Pixel, Motorola, Nokia and many others): ⋮ → Settings → <b>Call recording</b> → Numbers not in your contacts → <b>Always record</b>.</>,
            <><b>Samsung</b>: Phone → ⋮ → Settings → <b>Record calls</b> → turn on <b>Auto record calls</b>.</>,
            <><b>Xiaomi / Redmi / POCO</b>: Phone → Settings → <b>Call recording</b> → Record calls automatically.</>,
            <><b>OnePlus / OPPO / realme / vivo</b>: Phone → Settings → <b>Call recording</b> → Auto-record.</>,
          ]} />
          <Tip>Menu names differ a little between phones. If you can't find it, search "call recording" in the Phone app's settings.</Tip>
          <Fallback title="Older phone without a built-in recorder?">
            Install the free <b>Cube ACR</b> app (Cube Call Recorder) from the Play Store, allow what it asks for, and turn on its
            <b> App Connector</b> when prompted. Make one test call and play it back: if only your voice is recorded, use the free
            <b> ACR Phone</b> app (by NLL) instead. It replaces your dialer and records both sides on more phones.
          </Fallback>
        </>
      ),
  };
  const upload: Step = {
    id: "upload",
    perOs: true,
    subtitle: "Step 3 · After each call",
    title: "Upload the recording",
    visual: (os) => <PhoneFrame os={os}><UploadScene os={os} /></PhoneFrame>,
    body: (os) => (
      <>
        <Steps items={[
          <>When the call ends, tap <b>End call</b> in the CRM. The wrap-up opens.</>,
          <>Pick the <b>outcome</b> and the <b>next step</b>.</>,
          <>Tap <b>Attach the call recording</b> and choose the file{os === "ios" ? "" : " from your phone's recordings"}. Then <b>Save call</b>.</>,
          track === "sales"
            ? <>Forgot one? <b>Upload Recordings</b> in the menu lists every call that's still missing its recording.</>
            : <>Forgot one? Open <b>Phone Link</b> from your profile menu. It lists <b>Recordings still to attach</b>.</>,
        ]} />
        {os === "ios" ? (
          <Tip><b>Finding the file on iPhone:</b> Notes → Call Recordings → open the call → tap the recording → <b>•••</b> → <b>Save Audio to Files</b>. Then pick it from Files in the CRM.</Tip>
        ) : (
          <Tip><b>Finding the file on Android:</b> it's in Files → <b>Recordings</b> (or <b>Call recordings</b>). Google Phone: Recents → tap the call → the recording → Share / Save.</Tip>
        )}
        <p className="mt-3 text-sm text-muted">Every night the AI transcribes each recording (Hindi, English or both) and scores the call.</p>
      </>
    ),
  };
  const salesFlow: Step = {
    id: "flow",
    subtitle: "Step 4 · Your day",
    title: "How the CRM works for you",
    visual: () => <FlowScene items={SALES_FLOW} />,
    body: () => <FlowList items={SALES_FLOW} />,
  };
  const legionFlow: Step = {
    id: "flow",
    subtitle: "Step 4 · Your day",
    title: "How the CRM works for Legion",
    visual: () => <FlowScene items={LEGION_FLOW} />,
    body: () => <FlowList items={LEGION_FLOW} />,
  };
  const done: Step = {
    id: "done",
    subtitle: "All set",
    title: "You're ready to go",
    visual: () => <DoneScene />,
    body: () => (
      <Steps items={[
        "Home-screen icon added",
        "Call recorder switched on",
        "Recording attached after every call",
        track === "sales" ? "Start each morning on My Day" : "Check your Handoff Inbox every morning",
      ]} done />
    ),
  };
  return [welcome, home, recorder, upload, track === "sales" ? salesFlow : legionFlow, done];
}

type FlowItem = { icon: ReactNode; title: string; body: string };
const SALES_FLOW: FlowItem[] = [
  { icon: <Target className="size-5" />, title: "My Day", body: "Your target, follow-ups due today and fresh prospects. Start here every morning." },
  { icon: <PhoneCall className="size-5" />, title: "Call", body: "Tap the green Call button. On your phone it dials straight away; on a laptop the number pops up on your phone's Phone Link screen." },
  { icon: <ListChecks className="size-5" />, title: "Record and log", body: "Record the call, then log the outcome and the next step, and tick what you confirmed. Promising calls need a next step." },
  { icon: <BellRing className="size-5" />, title: "Follow-ups", body: "The CRM reminds you when each follow-up is due. Overdue ones are flagged to your sales head." },
  { icon: <Handshake className="size-5" />, title: "Qualified → Legion", body: "When the checklist is complete, hand the prospect to Legion. They accept it, or return it to you with a reason." },
  { icon: <BrainCircuit className="size-5" />, title: "Nightly AI report", body: "Every night the AI reviews each recording: how you spoke, objections, how the prospect responded. Your report and AI Coaching are ready by morning." },
];
const LEGION_FLOW: FlowItem[] = [
  { icon: <LayoutDashboard className="size-5" />, title: "Legion HQ", body: "Today's meetings, new handoffs and the pipeline at a glance." },
  { icon: <Inbox className="size-5" />, title: "Handoff Inbox", body: "Qualified prospects from the sales team land here, with their checklist, notes and call history." },
  { icon: <Undo2 className="size-5" />, title: "Accept or return", body: "Accept to take the prospect on, or return it to the salesperson with a clear reason." },
  { icon: <CalendarCheck className="size-5" />, title: "Legion Meet 1 → 2 → 3", body: "Schedule each meeting, then log its outcome to move the prospect along the pipeline." },
  { icon: <Phone className="size-5" />, title: "Call when needed", body: "Call from the prospect's page. Record the call and attach the recording, just like the sales team." },
  { icon: <Users className="size-5" />, title: "The sales team's work", body: "Sales Team Work, Calls and Daily Reports show what the team is doing and how the calls went." },
];

// ------------------------------------------------------------- text bits

function Steps({ items, done }: { items: ReactNode[]; done?: boolean }) {
  return (
    <ol className="mt-3 space-y-2.5">
      {items.map((it, k) => (
        <motion.li key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + k * 0.07 }} className="flex gap-3">
          <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-success text-white" : "bg-accent-soft text-accent-soft-fg")}>
            {done ? <Check className="size-3.5" /> : k + 1}
          </span>
          <span className="min-w-0">{it}</span>
        </motion.li>
      ))}
    </ol>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-4 flex gap-2 rounded-2xl bg-sunken/80 p-3 text-[13px] text-muted">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
      <span>{children}</span>
    </motion.p>
  );
}

function Fallback({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-3 rounded-2xl border border-warning/40 bg-warning-soft/50 p-3 text-[13px] text-fg/85">
      <p className="mb-1 flex items-center gap-1.5 font-semibold text-fg"><Smartphone className="size-4 text-warning" /> {title}</p>
      <p>{children}</p>
    </motion.div>
  );
}

function FlowList({ items }: { items: FlowItem[] }) {
  return (
    <ol className="mt-1 space-y-2">
      {items.map((it, k) => (
        <motion.li key={it.title} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + k * 0.07 }} className="flex gap-3 rounded-2xl border border-line p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-fg">{it.icon}</span>
          <span>
            <span className="block text-sm font-bold text-fg">{k + 1}. {it.title}</span>
            <span className="block text-[13px] text-muted">{it.body}</span>
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------ animations

/** Cycles through phases with the given durations (ms), looping. */
function usePhase(durations: number[]) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setP((x) => (x + 1) % durations.length), durations[p]);
    return () => clearTimeout(t);
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  return p;
}

function PhoneFrame({ os, dark, children }: { os: Os; dark?: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      <div className={cn("relative aspect-[9/19] w-[128px] overflow-hidden border-[5px] border-slate-900 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] sm:w-[150px] md:w-[200px] md:border-[7px]", os === "ios" ? "rounded-[26px] md:rounded-[34px]" : "rounded-[20px] md:rounded-[26px]", dark ? "bg-slate-900" : "bg-white")}>
        {os === "ios" ? (
          <div className="absolute top-1.5 left-1/2 z-20 h-3 w-12 -translate-x-1/2 rounded-full bg-slate-900 md:h-4 md:w-16" />
        ) : (
          <div className="absolute top-1.5 left-1/2 z-20 size-2.5 -translate-x-1/2 rounded-full bg-slate-900 md:size-3" />
        )}
        <div className="absolute inset-0 text-[6.5px] text-slate-800 md:text-[9px]">{children}</div>
      </div>
    </div>
  );
}

/** A fingertip that glides to (x%, y%) and taps. */
function Finger({ x, y, show = true, tapKey }: { x: number; y: number; show?: boolean; tapKey: string | number }) {
  return (
    <motion.div className="pointer-events-none absolute z-30" initial={false} animate={{ left: `${x}%`, top: `${y}%`, opacity: show ? 1 : 0 }} transition={{ type: "spring", stiffness: 120, damping: 18 }} style={{ translateX: "-50%", translateY: "-50%" }}>
      <motion.span key={tapKey} className="absolute top-1/2 left-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky md:size-9" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: [0.4, 1.4], opacity: [0, 0.9, 0] }} transition={{ delay: 0.75, duration: 0.6 }} />
      <motion.span key={`${tapKey}-dot`} className="block size-4 rounded-full bg-white/90 shadow-[0_0_0_4px_rgba(124,192,250,0.45)] md:size-5" animate={{ scale: [1, 1, 0.75, 1] }} transition={{ delay: 0.5, duration: 0.5, times: [0, 0.5, 0.75, 1] }} />
    </motion.div>
  );
}

function Highlight({ on, children, className }: { on: boolean; children: ReactNode; className?: string }) {
  return (
    <motion.div className={cn("flex items-center gap-1.5 rounded-md px-2 py-1.5", className)} animate={{ backgroundColor: on ? "rgba(26,106,224,0.14)" : "rgba(0,0,0,0)" }} transition={{ delay: on ? 0.9 : 0 }}>
      {children}
    </motion.div>
  );
}

function HomeGrid({ caption }: { caption: string }) {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-sky-300 via-brand-500 to-indigo-700 p-[10%] pt-[22%]">
      <div className="grid grid-cols-4 gap-[9%]">
        {Array.from({ length: 11 }).map((_, k) => (
          <div key={k} className="aspect-square rounded-[22%] bg-white/30" />
        ))}
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.3 }} className="relative aspect-square">
          <div className="absolute inset-0 overflow-hidden rounded-[22%] bg-white shadow-lg ring-2 ring-white">
            <img src="/apple-touch-icon.png" alt="" className="size-full object-cover" />
          </div>
          <motion.span className="absolute inset-0 rounded-[22%] ring-2 ring-white" animate={{ scale: [1, 1.6], opacity: [0.8, 0] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.8 }} />
          <span className="absolute -bottom-[70%] left-1/2 -translate-x-1/2 text-[0.9em] font-semibold whitespace-nowrap text-white">Focus Realm</span>
        </motion.div>
      </div>
      <p className="absolute right-0 bottom-[8%] left-0 text-center text-[1.05em] font-semibold text-white">{caption}</p>
    </div>
  );
}

function PageMock() {
  return (
    <div className="absolute inset-0 bg-slate-50 px-[8%] pt-[24%]">
      <div className="flex items-center gap-1.5">
        <div className="w-[18%] aspect-square overflow-hidden rounded-md"><img src="/apple-touch-icon.png" alt="" className="size-full object-cover" /></div>
        <div className="space-y-1"><div className="h-1.5 w-12 rounded bg-slate-800 md:w-16" /><div className="h-1 w-8 rounded bg-brand-500" /></div>
      </div>
      <div className="mt-[12%] space-y-1.5">
        <div className="h-8 rounded-lg bg-gradient-to-r from-brand-500 to-brand-700 md:h-12" />
        <div className="h-5 rounded-lg bg-white shadow-sm md:h-7" />
        <div className="h-5 rounded-lg bg-white shadow-sm md:h-7" />
        <div className="h-5 rounded-lg bg-white shadow-sm md:h-7" />
      </div>
    </div>
  );
}

function IosHomeScene() {
  const p = usePhase([1900, 2300, 2600]);
  return (
    <>
      <PageMock />
      {p < 2 && (
        <div className="absolute right-0 bottom-0 left-0 flex h-[11%] items-center justify-around border-t border-slate-200 bg-white/95 px-[6%] text-slate-500">
          <ChevronLeft className="size-[1.4em]" /><ChevronRight className="size-[1.4em]" />
          <Share className={cn("size-[1.5em]", p === 0 && "text-brand-600")} />
          <div className="size-[1.2em] rounded-sm border border-current" /><div className="size-[1.2em] rounded-sm border border-current" />
        </div>
      )}
      <AnimatePresence>
        {p === 1 && (
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 220, damping: 26 }} className="absolute right-0 bottom-0 left-0 h-[62%] rounded-t-[10%] bg-slate-100 p-[6%] shadow-2xl">
            <div className="flex items-center gap-1.5 border-b border-slate-200 pb-[5%]">
              <div className="w-[14%] aspect-square overflow-hidden rounded-md"><img src="/apple-touch-icon.png" alt="" className="size-full" /></div>
              <span className="font-semibold">Focus Realm CRM</span>
            </div>
            <div className="mt-[4%] space-y-0.5 rounded-lg bg-white">
              <Highlight on={false}>Copy</Highlight>
              <Highlight on={false}>Add to Reading List</Highlight>
              <Highlight on className="font-semibold text-brand-700">Add to Home Screen <SquarePlus className="ml-auto size-[1.3em]" /></Highlight>
              <Highlight on={false}>Find on Page</Highlight>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {p === 2 && <HomeGrid caption="Tap it to open the CRM" />}
      <Finger x={p === 0 ? 50 : 50} y={p === 0 ? 94 : 74} show={p < 2} tapKey={p} />
    </>
  );
}

function AndroidHomeScene() {
  const p = usePhase([1800, 2100, 2000, 2500]);
  return (
    <>
      <PageMock />
      {p < 3 && (
        <div className="absolute top-0 right-0 left-0 flex h-[13%] items-end gap-1 bg-white px-[5%] pb-[2%] shadow-sm">
          <div className="h-[55%] flex-1 rounded-full bg-slate-100 px-2 text-[0.85em] leading-[2.2] text-slate-500">focus-realm…</div>
          <EllipsisVertical className={cn("size-[1.5em]", p === 0 ? "text-brand-600" : "text-slate-600")} />
        </div>
      )}
      <AnimatePresence>
        {p === 1 && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ transformOrigin: "top right" }} className="absolute top-[9%] right-[3%] w-[66%] space-y-0.5 rounded-lg bg-white p-1 shadow-xl ring-1 ring-black/5">
            <Highlight on={false}>New tab</Highlight>
            <Highlight on={false}>History</Highlight>
            <Highlight on={false}>Downloads</Highlight>
            <Highlight on className="font-semibold text-brand-700">Add to Home screen</Highlight>
            <Highlight on={false}>Settings</Highlight>
          </motion.div>
        )}
        {p === 2 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-black/40">
            <motion.div initial={{ scale: 0.85 }} animate={{ scale: 1 }} className="w-[82%] rounded-xl bg-white p-[7%] shadow-2xl">
              <p className="font-semibold">Add to Home screen</p>
              <div className="mt-[8%] flex items-center gap-1.5">
                <div className="w-[22%] aspect-square overflow-hidden rounded-md"><img src="/apple-touch-icon.png" alt="" className="size-full" /></div>
                <span className="border-b border-brand-500 pb-0.5">Focus Realm</span>
              </div>
              <div className="mt-[10%] flex justify-end gap-3 font-semibold text-brand-600"><span>Cancel</span><motion.span animate={{ scale: [1, 1, 0.9, 1] }} transition={{ delay: 0.8, duration: 0.4 }}>Add</motion.span></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {p === 3 && <HomeGrid caption="Tap it to open the CRM" />}
      <Finger x={p === 0 ? 91 : p === 1 ? 70 : 80} y={p === 0 ? 9 : p === 1 ? 37 : 60} show={p < 3} tapKey={p} />
    </>
  );
}

function CallScreen({ recording, children }: { recording?: boolean; children?: ReactNode }) {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-slate-700 to-slate-950 px-[8%] pt-[24%] text-white">
      <p className="text-center text-[1.5em] font-semibold">Prospect</p>
      <p className="text-center text-[0.95em] text-white/60">{recording ? "Recording…" : "00:07"}</p>
      {children}
      <div className="mt-[18%] grid grid-cols-3 gap-[12%] px-[4%]">
        {Array.from({ length: 6 }).map((_, k) => <div key={k} className="aspect-square rounded-full bg-white/15" />)}
      </div>
      <div className="mx-auto mt-[16%] grid w-[24%] aspect-square place-items-center rounded-full bg-rose-500"><Phone className="size-[45%] rotate-[135deg]" /></div>
    </div>
  );
}

function IosRecorderScene() {
  const p = usePhase([2000, 2600, 2400]);
  return (
    <>
      {p < 2 ? (
        <CallScreen recording={p === 1}>
          <motion.div className="absolute top-[9%] left-[7%] grid w-[15%] aspect-square place-items-center rounded-full" animate={{ backgroundColor: p === 1 ? "#f43f5e" : "rgba(255,255,255,0.18)" }}>
            <AudioLines className="size-[55%]" />
          </motion.div>
          {p === 1 && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-[8%] flex flex-col items-center rounded-xl bg-white/10 py-[5%]">
              <span className="flex items-center gap-1 font-semibold"><span className="size-1.5 animate-pulse rounded-full bg-rose-500" /> Recording</span>
              <Waveform bars={18} className="mt-1 h-4 md:h-6" />
              <span className="mt-1 text-[0.8em] text-white/60">Both sides hear a short notice</span>
            </motion.div>
          )}
        </CallScreen>
      ) : (
        <div className="absolute inset-0 bg-amber-50 px-[7%] pt-[22%]">
          <p className="text-[0.85em] font-semibold text-amber-600">‹ Folders</p>
          <p className="mt-1 text-[1.6em] font-bold">Call Recordings</p>
          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="mt-[8%] flex items-center gap-1.5 rounded-lg bg-white p-[5%] shadow-sm ring-2 ring-amber-400">
            <FileAudio className="size-[1.8em] text-amber-500" />
            <span><span className="block font-semibold">Call with +91 98200…</span><span className="block text-slate-500">Today · 3:24</span></span>
          </motion.div>
          <div className="mt-[4%] h-[8%] rounded-lg bg-white/70" />
          <div className="mt-[4%] h-[8%] rounded-lg bg-white/70" />
          <p className="absolute right-0 bottom-[8%] left-0 text-center font-semibold text-amber-700">Saved in Notes</p>
        </div>
      )}
      <Finger x={14} y={13} show={p === 0} tapKey={p} />
    </>
  );
}

function AndroidRecorderScene() {
  const p = usePhase([1900, 2500, 2400]);
  return (
    <>
      {p === 0 && (
        <div className="absolute inset-0 bg-white px-[7%] pt-[22%]">
          <p className="text-[1.6em] font-bold">Settings</p>
          <div className="mt-[8%] space-y-1">
            <Highlight on={false}>Display options</Highlight>
            <Highlight on={false}>Caller ID &amp; spam</Highlight>
            <Highlight on className="font-semibold text-brand-700"><Mic className="size-[1.3em]" /> Call recording</Highlight>
            <Highlight on={false}>Blocked numbers</Highlight>
            <Highlight on={false}>Voicemail</Highlight>
          </div>
        </div>
      )}
      {p === 1 && (
        <div className="absolute inset-0 bg-white px-[7%] pt-[22%]">
          <p className="text-[1.5em] font-bold">Call recording</p>
          <p className="mt-[6%] font-semibold text-slate-500">Always record</p>
          <div className="mt-[3%] flex items-center justify-between rounded-lg bg-slate-50 p-[5%]">
            <span>Numbers not in your contacts</span>
            <motion.span className="flex h-[2em] w-[3.6em] shrink-0 items-center rounded-full p-[0.2em]" initial={{ backgroundColor: "#cbd5e1" }} animate={{ backgroundColor: "#1a6ae0" }} transition={{ delay: 1 }}>
              <motion.span className="size-[1.6em] rounded-full bg-white shadow" initial={{ x: 0 }} animate={{ x: "1.6em" }} transition={{ delay: 1, type: "spring", stiffness: 400, damping: 25 }} />
            </motion.span>
          </div>
          <div className="mt-[3%] flex items-center justify-between rounded-lg bg-slate-50 p-[5%] text-slate-400"><span>Selected numbers</span><span className="h-[2em] w-[3.6em] shrink-0 rounded-full bg-slate-200" /></div>
        </div>
      )}
      {p === 2 && (
        <CallScreen recording>
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto mt-[6%] flex w-fit items-center gap-1 rounded-full bg-rose-500/90 px-2 py-0.5 font-semibold">
            <span className="size-1.5 animate-pulse rounded-full bg-white" /> Recording automatically
          </motion.div>
        </CallScreen>
      )}
      <Finger x={p === 0 ? 50 : 84} y={p === 0 ? 47 : 27} show={p < 2} tapKey={p} />
    </>
  );
}

function UploadScene({ os }: { os: Os }) {
  const p = usePhase([2000, 2200, 2800]);
  const file = os === "ios" ? "Call with +91 98200….m4a" : "Call_+919820012345.m4a";
  return (
    <>
      <div className="absolute inset-0 bg-slate-50 px-[6%] pt-[20%]">
        <p className="text-[1.25em] font-bold">How did it go?</p>
        <div className="mt-[5%] flex flex-wrap gap-1">
          <span className="rounded-full bg-brand-600 px-1.5 py-0.5 font-semibold text-white">Interested</span>
          <span className="rounded-full bg-white px-1.5 py-0.5 ring-1 ring-slate-200">Call back</span>
          <span className="rounded-full bg-white px-1.5 py-0.5 ring-1 ring-slate-200">No answer</span>
        </div>
        <div className="mt-[5%] rounded-lg bg-white p-[5%] ring-1 ring-slate-200">Next step · <b>Tomorrow 11 AM</b></div>
        <motion.div className="mt-[5%] rounded-lg border border-dashed p-[6%]" animate={{ borderColor: p === 2 ? "#10b981" : "#1a6ae0", backgroundColor: p === 2 ? "rgba(16,185,129,0.08)" : "rgba(26,106,224,0.06)" }}>
          {p < 2 ? (
            <span className="flex items-center gap-1 font-semibold text-brand-700"><Mic className="size-[1.4em]" /> Attach the call recording</span>
          ) : (
            <div>
              <span className="flex items-center gap-1 font-semibold text-emerald-700"><FileAudio className="size-[1.3em]" /> <span className="truncate">{file}</span></span>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-emerald-100"><motion.div className="h-full bg-emerald-500" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 1.3 }} /></div>
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }} className="mt-1 flex items-center gap-1 text-emerald-700"><Check className="size-[1.2em]" /> Uploaded · analysed tonight</motion.span>
            </div>
          )}
        </motion.div>
        <div className="mt-[6%] rounded-lg bg-gradient-to-r from-brand-500 to-brand-700 py-[4%] text-center font-bold text-white">Save call</div>
      </div>
      <AnimatePresence>
        {p === 1 && (
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 220, damping: 26 }} className="absolute right-0 bottom-0 left-0 h-[55%] rounded-t-[10%] bg-white p-[6%] shadow-[0_-10px_30px_rgba(0,0,0,0.2)]">
            <p className="font-bold">{os === "ios" ? "Files" : "Recordings"}</p>
            <div className="mt-[5%] space-y-0.5">
              <Highlight on className="font-semibold text-brand-700"><FileAudio className="size-[1.3em] shrink-0" /><span className="truncate">{file}</span></Highlight>
              <Highlight on={false}><FileAudio className="size-[1.3em] shrink-0 text-slate-400" /><span className="truncate">Call_+919811….m4a</span></Highlight>
              <Highlight on={false}><FileAudio className="size-[1.3em] shrink-0 text-slate-400" /><span className="truncate">Voice memo.m4a</span></Highlight>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Finger x={p === 0 ? 45 : 45} y={p === 0 ? 62 : 63} show={p < 2} tapKey={p} />
    </>
  );
}

function WelcomeScene() {
  const icons = [<Smartphone key="a" className="size-5" />, <Mic key="b" className="size-5" />, <Upload key="c" className="size-5" />, <Target key="d" className="size-5" />];
  return (
    <div className="relative grid size-[220px] place-items-center md:size-[300px]">
      <PulseRings color="bg-white/15" />
      <motion.div className="absolute inset-0" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 22, ease: "linear" }}>
        {icons.map((ic, k) => {
          const a = (k / icons.length) * Math.PI * 2;
          return (
            <motion.span key={k} className="absolute grid size-11 place-items-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur md:size-12" style={{ left: `calc(50% + ${Math.cos(a) * 42}% - 22px)`, top: `calc(50% + ${Math.sin(a) * 42}% - 22px)` }} animate={{ rotate: -360 }} transition={{ repeat: Infinity, duration: 22, ease: "linear" }}>
              {ic}
            </motion.span>
          );
        })}
      </motion.div>
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 14 }} className="rounded-3xl bg-white p-3 shadow-2xl">
        <BrandTile size={72} animated />
      </motion.div>
    </div>
  );
}

function FlowScene({ items }: { items: FlowItem[] }) {
  const p = usePhase(items.map(() => 2300));
  const it = items[p];
  return (
    <div className="flex w-[240px] flex-col items-center text-center text-white md:w-[300px]">
      <div className="relative grid size-24 place-items-center md:size-32">
        <PulseRings color="bg-white/15" count={2} />
        <AnimatePresence mode="wait">
          <motion.span key={p} initial={{ scale: 0.4, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 16 }} className="grid size-16 place-items-center rounded-3xl bg-white text-brand-700 shadow-2xl md:size-20 [&_svg]:size-8 md:[&_svg]:size-10">
            {it.icon}
          </motion.span>
        </AnimatePresence>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={p} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="mt-3">
          <p className="text-lg font-bold md:text-xl">{p + 1}. {it.title}</p>
          <p className="mt-1 hidden text-[13px] text-white/75 md:block">{it.body}</p>
        </motion.div>
      </AnimatePresence>
      <div className="mt-4 flex gap-1.5">
        {items.map((_, k) => <motion.span key={k} className="h-1.5 rounded-full bg-white" animate={{ width: k === p ? 22 : 6, opacity: k === p ? 1 : 0.4 }} />)}
      </div>
    </div>
  );
}

function DoneScene() {
  return (
    <div className="relative grid size-[200px] place-items-center md:size-[260px]">
      <PulseRings color="bg-emerald-300/25" />
      <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 220, damping: 13 }} className="grid size-24 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-2xl md:size-28">
        <Check className="size-12 md:size-14" />
      </motion.div>
    </div>
  );
}
