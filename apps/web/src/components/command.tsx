import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Building2, CornerDownLeft, Phone, Search, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn, label } from "../lib/format";
import { Kbd } from "./ui";

interface NavItem {
  to: string;
  label: string;
}

/** ⌘K — jump to any prospect, teammate, call or page. */
export function CommandPalette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: NavItem[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const base = `/${user?.portal ?? "sales"}`;

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const search = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<{ contacts: any[]; people: any[]; calls: any[] }>(`/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length >= 2,
    staleTime: 10_000,
  });

  const items = useMemo(() => {
    const pages = nav.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())).map((n) => ({ kind: "page" as const, id: n.to, title: n.label, sub: "Go to page", to: n.to }));
    const d = search.data;
    const contacts = (d?.contacts ?? []).map((c) => ({ kind: "contact" as const, id: c.id, title: c.full_name, sub: `${c.company_name ?? "—"} · ${label(c.status)}`, to: `${base}/contacts/${c.id}` }));
    const people = (d?.people ?? []).map((p) => ({ kind: "person" as const, id: p.id, title: p.full_name, sub: `${p.employee_code} · ${label(p.role)}`, to: `${base}/team` }));
    const calls = (d?.calls ?? []).map((c) => ({ kind: "call" as const, id: c.id, title: c.call_code, sub: c.contact_name, to: `${base}/calls/${c.id}` }));
    return [...contacts, ...calls, ...people, ...pages].slice(0, 14);
  }, [q, search.data, nav, base]);

  useEffect(() => setSel(0), [q]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const ICON = { page: ArrowRight, contact: Building2, person: User, call: Phone };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-[rgba(10,20,38,0.4)] backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-line bg-surface shadow-lg"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-5 text-accent" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                  if (e.key === "Enter" && items[sel]) go(items[sel].to);
                  if (e.key === "Escape") onClose();
                }}
                placeholder="Search prospects, companies, call IDs, teammates…"
                className="h-14 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
              />
              <Kbd>esc</Kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">{q.length < 2 ? "Type to search everything" : search.isFetching ? "Searching…" : "Nothing found"}</p>}
              {items.map((it, i) => {
                const Icon = ICON[it.kind];
                return (
                  <motion.button
                    key={`${it.kind}-${it.id}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.015 }}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(it.to)}
                    className={cn("relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", sel === i ? "text-fg" : "text-muted")}
                  >
                    {sel === i && <motion.span layoutId="cmd-sel" className="absolute inset-0 rounded-xl bg-accent-soft" transition={{ type: "spring", stiffness: 600, damping: 40 }} />}
                    <span className={cn("relative grid size-8 place-items-center rounded-lg", sel === i ? "bg-brand-600 text-white" : "bg-sunken")}>
                      <Icon className="size-4" />
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">{it.title}</span>
                      <span className="block truncate text-xs text-muted">{it.sub}</span>
                    </span>
                    {sel === i && <CornerDownLeft className="relative size-4 text-accent" />}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
