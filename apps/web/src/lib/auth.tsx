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

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: User }>("/auth/me")).user;
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
    setUser: (u) => qc.setQueryData(["me"], u),
    logout: async () => {
      await api.post("/auth/logout").catch(() => {});
      // Drop everything cached for the previous person, but keep the "me"
      // query object alive so the app sees the sign-out immediately.
      qc.removeQueries({ predicate: (q) => !["me", "meta"].includes(String(q.queryKey[0])) });
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
