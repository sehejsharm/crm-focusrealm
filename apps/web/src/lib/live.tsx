import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/toast";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Notification } from "./types";

/**
 * Live updates: notifications, dial requests, call progress and analysis
 * results. The tab polls /api/events with a cursor — every ~2.5 s normally,
 * every second while a call is live or the Phone Link is open, and slowly
 * when the tab is hidden. Works the same on Vercel and on a single server.
 */

type Handler = (data: any) => void;
const Ctx = createContext<{ on: (type: string, fn: Handler) => () => void; connected: boolean; setFast: (key: string, on: boolean) => void }>({
  on: () => () => {},
  connected: false,
  setFast: () => {},
});

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const handlers = useRef(new Map<string, Set<Handler>>());
  const fast = useRef(new Set<string>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user || user.must_change_password) return;
    let cursor: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const dispatch = (type: string, data: any) => {
      if (type === "notification") {
        qc.invalidateQueries({ queryKey: ["notifications"] });
        const n = data as Notification;
        if (!location.pathname.startsWith("/phone")) {
          toast({ kind: n.kind === "coaching" ? "ai" : "notify", title: n.title, body: n.body, action: n.link ? { label: "Open", onClick: () => navigate(n.link!) } : undefined });
        }
      }
      if (type === "call.updated" || type === "analysis.ready") {
        qc.invalidateQueries({ queryKey: ["calls"] });
        qc.invalidateQueries({ queryKey: ["call"] });
        qc.invalidateQueries({ queryKey: ["dash"] });
      }
      if (type === "contact.updated") {
        qc.invalidateQueries({ queryKey: ["contact", data?.id] });
        qc.invalidateQueries({ queryKey: ["board"] });
      }
      if (type === "activity") qc.invalidateQueries({ queryKey: ["team"] });
      if (type === "report.ready") qc.invalidateQueries({ queryKey: ["reports"] });
      handlers.current.get(type)?.forEach((fn) => fn(data));
    };

    const poll = async () => {
      try {
        const r = await api.get<{ cursor: number; events: { id: number; type: string; data: any }[] }>(`/events${cursor != null ? `?after=${cursor}` : ""}`);
        cursor = r.cursor;
        setConnected(true);
        for (const e of r.events) dispatch(e.type, e.data);
      } catch {
        setConnected(false);
      }
      if (stopped) return;
      const delay = document.hidden ? 15_000 : fast.current.size ? 1_000 : 2_500;
      timer = setTimeout(poll, delay);
    };
    const wake = () => {
      if (!document.hidden && timer) {
        clearTimeout(timer);
        poll();
      }
    };
    poll();
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      setConnected(false);
    };
  }, [user?.id, user?.must_change_password]); // eslint-disable-line react-hooks/exhaustive-deps

  const on = (type: string, fn: Handler) => {
    if (!handlers.current.has(type)) handlers.current.set(type, new Set());
    handlers.current.get(type)!.add(fn);
    return () => void handlers.current.get(type)?.delete(fn);
  };
  const setFast = (key: string, isOn: boolean) => {
    if (isOn) fast.current.add(key);
    else fast.current.delete(key);
  };

  return <Ctx.Provider value={{ on, connected, setFast }}>{children}</Ctx.Provider>;
}

export function useLive(type: string, fn: Handler) {
  const { on } = useContext(Ctx);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => on(type, (d) => ref.current(d)), [type]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Poll every second while this component is mounted (calls, Phone Link). */
export function useFastLive(key: string, enabled = true) {
  const { setFast } = useContext(Ctx);
  useEffect(() => {
    setFast(key, enabled);
    return () => setFast(key, false);
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const useLiveStatus = () => useContext(Ctx).connected;
