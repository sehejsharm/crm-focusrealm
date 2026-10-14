import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Check, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BrandTile } from "../components/brand";
import { Aurora, celebrate } from "../components/motion";
import { Button, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn } from "../lib/format";
import type { User } from "../lib/types";

/** First sign-in: choose your own password (the HR console's one is temporary). */
export default function Welcome() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const rules = [
    { ok: next.length >= 10, label: "At least 10 characters" },
    { ok: /[A-Za-z]/.test(next) && /\d/.test(next), label: "Letters and numbers" },
    { ok: next.length > 0 && next === again, label: "Both entries match" },
  ];
  const save = useMutation({
    mutationFn: () => api.post<{ user: User }>("/auth/change-password", { current, next }),
    onSuccess: (r) => {
      celebrate();
      setUser(r.user);
      navigate(`/${r.user.portal}`, { replace: true });
    },
  });
  if (!user) return null;
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-bg p-5">
      <Aurora intensity={0.5} />
      <div className="pointer-events-none absolute inset-0 grid-bg grid-fade" />
      <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 22 }} className="relative w-full max-w-md rounded-3xl border border-line bg-surface p-8 shadow-lg">
        <BrandTile size={52} animated />
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-fg">Welcome to the team, {user.full_name.split(" ")[0]} 👋</h1>
        <p className="mt-1 text-sm text-muted">Your login <b className="text-fg">{user.employee_code}</b> came from the HR console with a temporary password. Choose your own to continue.</p>
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="Temporary password"><Input icon={<KeyRound className="size-4" />} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New password"><Input icon={<ShieldCheck className="size-4" />} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="New password again"><Input icon={<ShieldCheck className="size-4" />} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></Field>
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r.label} className={cn("flex items-center gap-2 text-[13px] transition-colors", r.ok ? "text-success" : "text-muted")}>
                <motion.span animate={{ scale: r.ok ? [1, 1.3, 1] : 1 }} className={cn("grid size-4.5 place-items-center rounded-full", r.ok ? "bg-success text-white" : "bg-sunken ring-1 ring-line")}>
                  {r.ok && <Check className="size-3" />}
                </motion.span>
                {r.label}
              </li>
            ))}
          </ul>
          {save.error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">{(save.error as Error).message}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!rules.every((r) => r.ok) || !current} loading={save.isPending}>Set password & enter</Button>
          <button type="button" onClick={() => logout().then(() => navigate("/login"))} className="w-full text-center text-xs font-semibold text-muted hover:text-fg">Sign out</button>
        </form>
      </motion.div>
    </div>
  );
}
