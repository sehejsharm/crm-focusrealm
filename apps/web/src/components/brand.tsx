import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "../lib/format";

/**
 * The Focus Realm monogram: a sky-blue F interlocked with a royal-blue R —
 * the same mark as the HR console and Workspace, drawn inline so it is crisp
 * at every size. Never recolour or distort it; the gradient stops are the
 * logo itself.
 *
 * `animated` assembles the mark piece by piece (used on sign-in and loaders).
 */
export function BrandMark({
  size = 32,
  className,
  variant = "color",
  animated = false,
  loop = false,
}: {
  size?: number;
  className?: string;
  variant?: "color" | "inverse";
  animated?: boolean;
  loop?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const f = `fr-f-${id}`;
  const r = `fr-r-${id}`;
  const inverse = variant === "inverse";
  const spring = { type: "spring" as const, stiffness: 260, damping: 22 };
  const rep = loop ? { repeat: Infinity, repeatType: "reverse" as const, repeatDelay: 1.4 } : {};

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Focus Realm" className={cn("shrink-0 overflow-visible", className)}>
      <defs>
        <linearGradient id={f} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={inverse ? "#ffffff" : "#7cc0fa"} />
          <stop offset="100%" stopColor={inverse ? "#dcebfe" : "#3b8ef5"} />
        </linearGradient>
        <linearGradient id={r} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={inverse ? "#eaf3ff" : "#2f86f0"} />
          <stop offset="100%" stopColor={inverse ? "#bfdcfe" : "#1655c0"} />
        </linearGradient>
      </defs>
      <g fill={`url(#${f})`}>
        <motion.rect
          x="12" y="8" width="5" height="48"
          initial={animated ? { scaleY: 0, originY: 1 } : false}
          animate={{ scaleY: 1 }}
          transition={{ ...spring, delay: 0.05, ...rep }}
          style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
        />
        <motion.rect
          x="12" y="8" width="29" height="5"
          initial={animated ? { scaleX: 0 } : false}
          animate={{ scaleX: 1 }}
          transition={{ ...spring, delay: 0.25, ...rep }}
          style={{ transformBox: "fill-box", transformOrigin: "left" }}
        />
        <motion.rect
          x="12" y="27.5" width="18" height="5"
          initial={animated ? { scaleX: 0 } : false}
          animate={{ scaleX: 1 }}
          transition={{ ...spring, delay: 0.4, ...rep }}
          style={{ transformBox: "fill-box", transformOrigin: "left" }}
        />
      </g>
      <motion.g
        fill={`url(#${r})`}
        initial={animated ? { opacity: 0, x: 10, scale: 0.85 } : false}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ ...spring, delay: 0.55, ...rep }}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      >
        <path fillRule="evenodd" d="M26 56 V27.5 H40.5 A10 10 0 0 1 40.5 47.5 H31 V56 Z M31 32.5 V42.5 H40.5 A5 5 0 0 0 40.5 32.5 Z" />
        <path d="M35 47.5 H41 L52 56 H45.2 Z" />
      </motion.g>
    </svg>
  );
}

/** The mark inside a white rounded tile (works on any background, both themes). */
export function BrandTile({ size = 40, animated = false, className }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center rounded-[28%] bg-white shadow-sm ring-1 ring-brand-100 dark:ring-white/10", className)}
      style={{ width: size, height: size }}
    >
      <BrandMark size={size * 0.72} animated={animated} />
    </span>
  );
}

export function Wordmark({ sub = "Sales CRM", className }: { sub?: string; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandTile size={34} />
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight text-fg">Focus Realm</span>
        <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-accent">{sub}</span>
      </span>
    </span>
  );
}

/** Full-screen loader: the mark assembles itself over a soft pulse. */
export function BrandLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg">
      <div className="flex flex-col items-center gap-5">
        <div className="relative grid place-items-center">
          <span className="absolute size-24 rounded-full bg-brand-400/20 animate-pulse-ring" />
          <span className="absolute size-24 rounded-full bg-brand-400/20 animate-pulse-ring [animation-delay:0.7s]" />
          <BrandTile size={72} animated />
        </div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="text-sm font-medium text-muted">
          {label}…
        </motion.p>
      </div>
    </div>
  );
}
