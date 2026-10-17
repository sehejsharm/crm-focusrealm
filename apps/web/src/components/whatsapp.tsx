import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { MessageCircle, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn } from "../lib/format";
import { useToast } from "./toast";


interface Template { key: string; label: string; text: string }

export function fillTemplate(text: string, v: { name: string; company?: string | null; me: string }) {
  const first = (s: string) => s.trim().split(/\s+/)[0] ?? s;
  return text
    .replaceAll("{first_name}", first(v.name))
    .replaceAll("{name}", v.name)
    .replaceAll("{company}", v.company || "your business")
    .replaceAll("{my_first_name}", first(v.me))
    .replaceAll("{my_name}", v.me);
}

/**
 * One-tap WhatsApp: pick a template (filled with the prospect's name and
 * company), WhatsApp opens with the message ready to send, and the CRM puts
 * it on the prospect's timeline.
 */
export function WhatsAppButton({ contact, size = "md", className }: {
  contact: { id: string; full_name: string; phone_key?: string | null; company_name?: string | null; do_not_contact?: boolean };
  size?: "sm" | "md";
  className?: string;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  // The menu floats above the page (cards clip their overflow), placed by the button.
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(window.innerWidth * 0.92, 360);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(r.bottom + 340 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const t = useQuery({ queryKey: ["whatsapp-templates"], queryFn: () => api.get<{ templates: Template[] }>("/whatsapp/templates"), staleTime: 5 * 60_000, enabled: open });
  if (!contact.phone_key || contact.do_not_contact) return null;

  const send = (label: string | null, text: string) => {
    window.open(`https://wa.me/${contact.phone_key}${text ? `?text=${encodeURIComponent(text)}` : ""}`, "_blank", "noopener");
    setOpen(false);
    api.post(`/contacts/${contact.id}/whatsapp`, { label, text })
      .then(() => qc.invalidateQueries({ queryKey: ["contact", contact.id] }))
      .catch(() => toast({ kind: "error", title: "Opened WhatsApp, but couldn't log it on the timeline" }));
  };
  const vars = { name: contact.full_name, company: contact.company_name, me: user?.full_name ?? "" };

  return (
    <div className={className}>
      <button
        ref={btn}
        type="button"
        onClick={() => { place(); setOpen((o) => !o); }}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-95",
          size === "sm" ? "size-9" : "h-10 px-3.5 text-sm",
        )}
        aria-label="Send a WhatsApp message"
        title="WhatsApp"
      >
        <MessageCircle className="size-4" />
        {size === "md" && "WhatsApp"}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                style={pos}
                className="fixed z-[61] w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
              >
                <div className="border-b border-line px-4 py-3">
                  <p className="text-sm font-bold text-fg">WhatsApp {contact.full_name.split(" ")[0]}</p>
                  <p className="text-xs text-muted">Pick a message — it opens in WhatsApp, ready to send.</p>
                </div>
                <div className="max-h-[50vh] space-y-1 overflow-y-auto p-1.5">
                  {t.isLoading && <p className="px-3 py-4 text-sm text-muted">Loading…</p>}
                  {(t.data?.templates ?? []).map((tpl) => {
                    const text = fillTemplate(tpl.text, vars);
                    return (
                      <button key={tpl.key} onClick={() => send(tpl.label, text)} className="block w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-hover">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg"><Send className="size-3.5 text-[#25D366]" /> {tpl.label}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{text}</span>
                      </button>
                    );
                  })}
                  <button onClick={() => send(null, "")} className="block w-full rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-accent transition hover:bg-surface-hover">Blank message →</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
