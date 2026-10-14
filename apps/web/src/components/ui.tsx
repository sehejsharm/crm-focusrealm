import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { Loader2, X } from "lucide-react";
import {
  forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { cn, initials, type Tone } from "../lib/format";

// ------------------------------------------------------------------ Button

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "soft" | "success";
const BTN: Record<BtnVariant, string> = {
  primary:
    "bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-brand ring-1 ring-inset ring-white/15 hover:from-brand-500 hover:to-brand-600",
  secondary: "bg-surface text-fg ring-1 ring-inset ring-line-strong shadow-xs hover:bg-surface-hover",
  ghost: "text-muted hover:bg-surface-hover hover:text-fg",
  danger: "bg-danger text-white shadow-sm hover:brightness-110",
  soft: "bg-accent-soft text-accent-soft-fg hover:brightness-[0.97] dark:hover:brightness-125",
  success: "bg-gradient-to-b from-emerald-500 to-emerald-700 text-white shadow-sm ring-1 ring-inset ring-white/15",
};
const BTN_SIZE = { xs: "h-7 px-2.5 text-xs gap-1.5 rounded-lg", sm: "h-8.5 px-3 text-[13px] gap-1.5 rounded-xl", md: "h-10 px-4 text-sm gap-2 rounded-xl", lg: "h-12 px-5 text-[15px] gap-2.5 rounded-2xl" };

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: BtnVariant;
  size?: keyof typeof BTN_SIZE;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: disabled || loading ? 1 : 0.96 }}
      whileHover={{ y: disabled || loading ? 0 : -1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      disabled={disabled || loading}
      className={cn(
        "group relative inline-flex select-none items-center justify-center overflow-hidden font-semibold whitespace-nowrap transition-[background,box-shadow,color] duration-200 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-55",
        BTN[variant],
        BTN_SIZE[size],
        className,
      )}
      {...rest}
    >
      {variant === "primary" && (
        <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/25 opacity-0 transition-all duration-700 group-hover:left-[130%] group-hover:opacity-100" />
      )}
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </motion.button>
  );
});

export function IconButton({ className, label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn("relative grid size-9 place-items-center rounded-xl text-muted transition hover:bg-surface-hover hover:text-fg focus-visible:ring-focus active:scale-95", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// -------------------------------------------------------------------- Card

/** Card with a cursor-following spotlight and a soft entrance. */
export function Card({
  className,
  children,
  spotlight = true,
  delay = 0,
  hover = false,
  ...rest
}: HTMLMotionProps<"div"> & { spotlight?: boolean; delay?: number; hover?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={hover ? { y: -3 } : undefined}
      onMouseMove={(e) => {
        if (!spotlight || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
        ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      className={cn(
        "group/card relative rounded-2xl border border-line bg-surface shadow-sm",
        hover && "transition-shadow hover:shadow-md",
        className,
      )}
      {...rest}
    >
      {spotlight && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
          style={{ background: "radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), var(--spot), transparent 45%)" }}
        />
      )}
      {children as ReactNode}
    </motion.div>
  );
}

export function CardHeader({ title, subtitle, action, icon, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("relative flex items-start justify-between gap-3 px-5 pt-4.5 pb-3", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-fg">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-fg">{title}</h3>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------- Badge

const BADGE: Record<Tone, string> = {
  brand: "bg-accent-soft text-accent-soft-fg",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-sunken text-muted ring-1 ring-inset ring-line",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
};

export function Badge({ tone = "neutral", dot, children, className, pulse }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string; pulse?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap", BADGE[tone], className)}>
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ Inputs

const FIELD = "w-full rounded-xl border border-line-strong bg-surface px-3.5 text-sm text-fg placeholder:text-subtle shadow-xs outline-none transition focus:border-brand-500 focus:ring-focus disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function Input({ className, icon, ...rest }, ref) {
  if (!icon) return <input ref={ref} className={cn(FIELD, "h-10", className)} {...rest} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle">{icon}</span>
      <input ref={ref} className={cn(FIELD, "h-10 pl-9.5", className)} {...rest} />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(FIELD, "min-h-24 py-2.5 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(FIELD, "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238492a7' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-fg">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:ring-focus disabled:opacity-50", checked ? "bg-brand-600" : "bg-line-strong")}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 32 }} className={cn("size-5 rounded-full bg-white shadow-sm", checked && "ml-auto")} />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="group flex w-full items-start gap-3 rounded-xl p-2 text-left transition hover:bg-surface-hover">
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition", checked ? "border-brand-600 bg-brand-600" : "border-line-strong bg-surface")}>
        <motion.svg viewBox="0 0 16 16" className="size-3.5 text-white" initial={false} animate={{ opacity: checked ? 1 : 0, scale: checked ? 1 : 0.4 }}>
          <motion.path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" initial={false} animate={{ pathLength: checked ? 1 : 0 }} transition={{ duration: 0.25 }} />
        </motion.svg>
      </span>
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </button>
  );
}

// -------------------------------------------------------------------- Tabs

export function Tabs<T extends string>({ value, onChange, items, className, size = "md" }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string; size?: "sm" | "md" }) {
  const id = useId();
  return (
    <div className={cn("scroll-x-fade -mx-1 overflow-x-auto px-1", className)}>
      <div className="inline-flex gap-1 rounded-xl border border-line bg-sunken p-1">
        {items.map((it) => (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cn("relative rounded-lg font-semibold whitespace-nowrap transition-colors", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]", value === it.value ? "text-fg" : "text-muted hover:text-fg")}
          >
            {value === it.value && (
              <motion.span layoutId={`tab-${id}`} className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-line" transition={{ type: "spring", stiffness: 500, damping: 36 }} />
            )}
            <span className="relative flex items-center gap-1.5">
              {it.label}
              {it.count != null && <span className={cn("rounded-md px-1.5 text-[11px]", value === it.value ? "bg-accent-soft text-accent-soft-fg" : "bg-line/70 text-muted")}>{it.count}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Avatar

export function Avatar({ name, hue = 214, size = 36, online, className }: { name: string; hue?: number | null; size?: number; online?: boolean; className?: string }) {
  const h = hue ?? 214;
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full font-bold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${h} 90% 64%), hsl(${h + 14} 78% 42%))` }}
      title={name}
    >
      {initials(name)}
      {online != null && (
        <span className={cn("absolute right-0 bottom-0 rounded-full ring-2 ring-surface", online ? "bg-emerald-500" : "bg-line-strong")} style={{ width: size * 0.28, height: size * 0.28 }} />
      )}
    </span>
  );
}

// ---------------------------------------------------------------- Skeleton

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-xl", className)} />;
}

export function Empty({ icon, title, body, action, className }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }} className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent-soft-fg shadow-sm">
        {icon}
      </motion.div>
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

// ------------------------------------------------------------ Modal/Drawer

export function Modal({ open, onClose, title, subtitle, children, footer, size = "md", icon }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl"; icon?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);
  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-[rgba(10,20,38,0.45)] backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn("relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-lg sm:rounded-3xl", width)}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-brand-500/10 to-transparent" />
            <div className="relative flex items-start gap-3 px-6 pt-5 pb-3">
              {icon && <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-brand">{icon}</span>}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold tracking-tight text-fg">{title}</h2>
                {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
              </div>
              <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
                <X className="size-4.5" />
              </IconButton>
            </div>
            <div className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
            {footer && <div className="relative flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sunken/60 px-6 py-3.5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-[rgba(10,20,38,0.35)] backdrop-blur-[2px]" onClick={onClose} />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
            className="absolute top-0 right-0 flex h-full w-full flex-col border-l border-line bg-surface shadow-lg"
            style={{ maxWidth: width }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-base font-bold text-fg">{title}</h2>
              <IconButton label="Close" onClick={onClose}>
                <X className="size-4.5" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ------------------------------------------------------------------- Misc

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-muted shadow-xs">{children}</kbd>;
}

export function Progress({ value, max = 100, tone = "brand", className, height = 6 }: { value: number; max?: number; tone?: Tone; className?: string; height?: number }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const color = { brand: "from-brand-400 to-brand-600", success: "from-emerald-400 to-emerald-600", warning: "from-amber-400 to-amber-600", danger: "from-rose-400 to-rose-600", info: "from-sky-400 to-sky-600", neutral: "from-slate-300 to-slate-400", violet: "from-violet-400 to-violet-600" }[tone];
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line", className)} style={{ height }}>
      <motion.div className={cn("h-full rounded-full bg-gradient-to-r", color)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  const words = typeof title === "string" ? title.split(" ") : null;
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            {eyebrow}
          </motion.p>
        )}
        <h1 className="text-[26px] leading-tight font-bold tracking-tight text-fg sm:text-[30px]">
          {words
            ? words.map((w, i) => (
                <motion.span key={i} className="mr-[0.25em] inline-block" initial={{ opacity: 0, y: 14, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.04 * i, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
                  {w}
                </motion.span>
              ))
            : title}
        </h1>
        {subtitle && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-1 text-sm text-muted">
            {subtitle}
          </motion.p>
        )}
      </div>
      {actions && (
        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }} className="flex flex-wrap items-center gap-2">
          {actions}
        </motion.div>
      )}
    </div>
  );
}

export function Stagger({ children, className, delay = 0.05 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: delay } } }}>
      {children}
    </motion.div>
  );
}

export const staggerItem = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

export function Popover({ open, onClose, children, className, align = "right" }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", fn));
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fn);
      document.removeEventListener("keydown", esc);
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 500, damping: 34 }}
          className={cn("absolute top-full z-50 mt-2 origin-top rounded-2xl border border-line bg-surface shadow-lg", align === "right" ? "right-0" : "left-0", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
