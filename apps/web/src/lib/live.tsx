import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/toast";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Notification } from "./types";

/**
 * Live updates: notifications, dial requests, call progress and analysis
 * results. The tab polls /api/events with a cursor, which works the same on
 * Vercel and on a single server. Every poll is a request the server has to
 * answer (and a hosting plan counts them), so how often depends on what is
 * going on:
 *
 *   a call is being placed, or the phone is waiting to dial    2 to 5 s
 *   someone is using the page                                  10 s
 *   the page is open but untouched for a minute                30 s
 *   untouched for five minutes                                 60 s
 *   the tab is in the background                               3 min
 *
 * Coming back to the tab, or touching the page after a pause, checks at once,
 * and nothing is missed in between: the cursor picks up where it left off.
 */
const PACE = { using: 10_000, open: 30_000, away: 60_000, hidden: 180_000 };
const QUIET_AFTER = 60_000;
const AWAY_AFTER = 5 * 60_000;
/** A burst of events for the same screen becomes one refresh. */
const REFRESH_GAP = 8_000;

type Handler = (data: any) => void;
interface LiveCtx {
  on: (type: string, fn: Handler) => () => void;
  connected: boolean;
  setPace: (key: string, ms: number | null) => void;
  checkNow: () => void;
}
const Ctx = createContext<LiveCtx>({ on: () => () => {}, connected: false, setPace: () => {}, checkNow: () => {} });

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const handlers = useRef(new Map<string, Set<Handler>>());
  const paces = useRef(new Map<string, number>());
  const check = useRef<(minGap: number) => void>(() => {});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user || user.must_change_password) return;
    let cursor: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let polling = false;
    let lastPoll = 0;
    let lastInput = Date.now();

    const refreshedAt = new Map<string, number>();
    const queued = new Map<string, ReturnType<typeof setTimeout>>();
    const refresh = (key: string) => {
      const run = () => {
        queued.delete(key);
        refreshedAt.set(key, Date.now());
        qc.invalidateQueries({ queryKey: [key] });
      };
      const wait = REFRESH_GAP - (Date.now() - (refreshedAt.get(key) ?? 0));
      if (wait <= 0) run();
      else if (!queued.has(key)) queued.set(key, setTimeout(run, wait));
    };

    const dispatch = (type: string, data: any) => {
      if (type === "notification") {
        qc.invalidateQueries({ queryKey: ["notifications"] });
        const n = data as Notification;
        if (!location.pathname.startsWith("/phone")) {
          toast({ kind: n.kind === "coaching" ? "ai" : "notify", title: n.title, body: n.body, action: n.link ? { label: "Open", onClick: () => navigate(n.link!) } : undefined });
        }
      }
      if (type === "call.updated" || type === "analysis.ready") {
        qc.invalidateQueries({ queryKey: ["call"] });
        refresh("calls");
        refresh("recordings");
        refresh("dash");
      }
      if (type === "contact.updated") {
        qc.invalidateQueries({ queryKey: ["contact", data?.id] });
        refresh("board");
      }
      if (type === "activity") refresh("team");
      if (type === "report.ready") refresh("reports");
      handlers.current.get(type)?.forEach((fn) => fn(data));
    };

    const pace = () => {
      if (document.hidden) return PACE.hidden;
      if (paces.current.size) return Math.min(...paces.current.values());
      const quiet = Date.now() - lastInput;
      return quiet < QUIET_AFTER ? PACE.using : quiet < AWAY_AFTER ? PACE.open : PACE.away;
    };
    const schedule = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, pace());
    };
    const poll = async () => {
      if (polling || stopped) return;
      polling = true;
      lastPoll = Date.now();
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        const r = await api.get<{ cursor: number; events: { id: number; type: string; data: any }[] }>(`/events${cursor != null ? `?after=${cursor}` : ""}`);
        cursor = r.cursor;
        setConnected(true);
        for (const e of r.events) dispatch(e.type, e.data);
      } catch {
        setConnected(false);
      }
      polling = false;
      schedule();
    };
    /** Check now unless a check has just happened; then fall in with the current pace. */
    check.current = (minGap) => {
      if (stopped || polling) return;
      if (Date.now() - lastPoll >= minGap) void poll();
      else schedule();
    };

    const onInput = () => {
      const wasQuiet = Date.now() - lastInput >= QUIET_AFTER;
      lastInput = Date.now();
      if (wasQuiet) check.current(PACE.using);
    };
    const onVisibility = () => (document.hidden ? schedule() : check.current(1_000));
    const inputs = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const type of inputs) window.addEventListener(type, onInput, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    void poll();

    return () => {
      stopped = true;
      check.current = () => {};
      if (timer) clearTimeout(timer);
      for (const t of queued.values()) clearTimeout(t);
      for (const type of inputs) window.removeEventListener(type, onInput);
      document.removeEventListener("visibilitychange", onVisibility);
      setConnected(false);
    };
  }, [user?.id, user?.must_change_password]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useRef<Pick<LiveCtx, "on" | "setPace" | "checkNow">>({
    on: (type, fn) => {
      if (!handlers.current.has(type)) handlers.current.set(type, new Set());
      handlers.current.get(type)!.add(fn);
      return () => void handlers.current.get(type)?.delete(fn);
    },
    setPace: (key, ms) => {
      if (ms == null) {
        paces.current.delete(key);
        return;
      }
      const quicker = ms < (paces.current.get(key) ?? Infinity);
      paces.current.set(key, ms);
      // Something just became urgent: don't wait out the slow timer.
      if (quicker) check.current(1_000);
    },
    checkNow: () => check.current(1_000),
  }).current;

  const ctx = useMemo(() => ({ ...value, connected }), [value, connected]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useLive(type: string, fn: Handler) {
  const { on } = useContext(Ctx);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => on(type, (d) => ref.current(d)), [type]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Poll quickly while this component needs it (a live call, the Phone Link waiting to dial). */
export function useFastLive(key: string, enabled = true, everyMs = 2_000) {
  const { setPace } = useContext(Ctx);
  useEffect(() => setPace(key, enabled ? everyMs : null), [key, enabled, everyMs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setPace(key, null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Check for live events right now (for example when the phone screen is tapped). */
export const useLiveCheck = () => useContext(Ctx).checkNow;

export const useLiveStatus = () => useContext(Ctx).connected;
