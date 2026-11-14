import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Meta, User } from "./types";

interface AuthState {
  user: User | null;
  meta: Meta | undefined;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ user: null, meta: undefined, loading: true, setUser: () => {}, logout: async () => {} });

declare global {
  interface Window {
    /** Set by public/boot.js: the sign-in check, started before the app loaded. */
    __frEarlyMe?: Promise<{ user: User | null } | undefined>;
  }
}

const PORTAL_KEY = "fr-portal";

/**
 * Remembers which portal this browser last used (just the word "sales",
 * "legion" or "founder"), so next time the right first page can start
 * downloading before the sign-in check has even come back.
 */
function rememberPortal(user: User | null) {
  try {
    if (user) localStorage.setItem(PORTAL_KEY, user.portal);
    else localStorage.removeItem(PORTAL_KEY);
  } catch {
    /* private mode: nothing to remember, nothing breaks */
  }
}

export function lastPortal(): string | null {
  try {
    return localStorage.getItem(PORTAL_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      // public/boot.js already asked while this code was downloading. Use that
      // answer once; if it failed for any reason, ask again here.
      const early = window.__frEarlyMe;
      window.__frEarlyMe = undefined;
      const head = early ? await early : undefined;
      if (head) {
        rememberPortal(head.user);
        return head.user;
      }
      try {
        const user = (await api.get<{ user: User }>("/auth/me")).user;
        rememberPortal(user);
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/auth/meta"), staleTime: 60_000 });

  const value: AuthState = {
    user: me.data ?? null,
    meta: meta.data,
    loading: me.isLoading,
    setUser: (u) => {
      rememberPortal(u);
      qc.setQueryData(["me"], u);
    },
    logout: async () => {
      await api.post("/auth/logout").catch(() => {});
      // Drop everything cached for the previous person, but keep the "me"
      // query object alive so the app sees the sign-out immediately.
      qc.removeQueries({ predicate: (q) => !["me", "meta"].includes(String(q.queryKey[0])) });
      rememberPortal(null);
      qc.setQueryData(["me"], null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function useIsManager() {
  const { user } = useAuth();
  return user?.role === "founder" || user?.role === "sales_head";
}
