import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bell, CheckCircle2, Info, Sparkles, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/format";

type Kind = "success" | "error" | "info" | "ai" | "notify";
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  body?: string | null;
  action?: { label: string; onClick: () => void };
}

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info, ai: Sparkles, notify: Bell };
const TONE = {
  success: "text-success bg-success-soft",
  error: "text-danger bg-danger-soft",
  info: "text-accent-soft-fg bg-accent-soft",
  ai: "text-white bg-gradient-to-br from-brand-500 to-brand-800",
  notify: "text-accent-soft-fg bg-accent-soft",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const id = useRef(0);
  const dismiss = (tid: number) => setToasts((t) => t.filter((x) => x.id !== tid));
  const push = useCallback((t: Omit<Toast, "id">) => {
    const tid = ++id.current;
    setToasts((all) => [...all.slice(-3), { ...t, id: tid }]);
    setTimeout(() => dismiss(tid), t.kind === "error" ? 7000 : 5000);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 24, scale: 0.92, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: 60, scale: 0.95, transition: { duration: 0.2 } }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className="glass pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-line p-3.5 shadow-lg"
              >
                <div className="flex items-start gap-3">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", TONE[t.kind])}>
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-semibold text-fg">{t.title}</p>
                    {t.body && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{t.body}</p>}
                    {t.action && (
                      <button
                        onClick={() => {
                          t.action!.onClick();
                          dismiss(t.id);
                        }}
                        className="mt-2 text-[13px] font-semibold text-accent hover:underline"
                      >
                        {t.action.label} →
                      </button>
                    )}
                  </div>
                  <button onClick={() => dismiss(t.id)} className="rounded-lg p-1 text-subtle hover:bg-surface-hover hover:text-fg" aria-label="Dismiss">
                    <X className="size-4" />
                  </button>
                </div>
                <motion.div
                  className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-brand-400 to-brand-700"
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: t.kind === "error" ? 7 : 5, ease: "linear" }}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
