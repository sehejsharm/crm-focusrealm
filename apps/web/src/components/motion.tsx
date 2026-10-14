import { animate, motion, useInView, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/format";

/** Number that counts up when it scrolls into view and eases to new values. */
export function Counter({ value, decimals = 0, prefix = "", suffix = "", className, duration = 1.2 }: { value: number | null | undefined; decimals?: number; prefix?: string; suffix?: string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const from = useRef(0);
  useEffect(() => {
    if (!inView || !ref.current || value == null) return;
    const el = ref.current;
    const ctrl = animate(from.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = `${prefix}${v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
      },
    });
    from.current = value;
    return () => ctrl.stop();
  }, [inView, value, decimals, prefix, suffix, duration]);
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {value == null ? "—" : `${prefix}0${suffix}`}
    </span>
  );
}

/** Slow-drifting aurora blobs in brand blues. */
export function Aurora({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div className="absolute -top-1/3 -left-1/4 h-[70%] w-[70%] rounded-full bg-brand-400/30 blur-[100px] animate-aurora dark:bg-brand-500/25" style={{ opacity: intensity }} />
      <div className="absolute top-1/4 -right-1/4 h-[60%] w-[60%] rounded-full bg-sky/40 blur-[110px] animate-aurora [animation-delay:-6s] dark:bg-brand-700/30" style={{ opacity: intensity }} />
      <div className="absolute -bottom-1/3 left-1/4 h-[60%] w-[60%] rounded-full bg-brand-600/25 blur-[120px] animate-aurora [animation-delay:-11s] dark:bg-brand-800/40" style={{ opacity: intensity }} />
    </div>
  );
}

/** Interactive particle constellation drawn on a canvas; links glow near the cursor. */
export function Constellation({ className, density = 0.00009 }: { className?: string; density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const mouse = { x: -9999, y: -9999 };
    let pts: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(24, Math.min(140, Math.round(w * h * density)));
      pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35, r: Math.random() * 1.6 + 0.6 }));
    };
    const dark = () => document.documentElement.classList.contains("dark");
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      const c = dark() ? "140,192,251" : "26,106,224";
      for (const p of pts) {
        if (!reduce) { p.x += p.vx; p.y += p.vy; }
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dm = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        if (dm < 140) { p.x += (p.x - mouse.x) * 0.012; p.y += (p.y - mouse.y) * 0.012; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c},${dm < 160 ? 0.9 : 0.45})`;
        ctx.fill();
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 120) {
          const near = Math.hypot((a.x + b.x) / 2 - mouse.x, (a.y + b.y) / 2 - mouse.y) < 170;
          ctx.strokeStyle = `rgba(${c},${(1 - d / 120) * (near ? 0.55 : 0.16)})`;
          ctx.lineWidth = near ? 1.1 : 0.7;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    };
    resize();
    tick();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
    };
  }, [density]);
  return <canvas ref={ref} className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} aria-hidden />;
}

/** 3D tilt that follows the cursor, with a glare. */
export function Tilt({ children, className, max = 9 }: { children: ReactNode; className?: string; max?: number }) {
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rx = useSpring(useTransform(y, [0, 1], [max, -max]), { stiffness: 220, damping: 20 });
  const ry = useSpring(useTransform(x, [0, 1], [-max, max]), { stiffness: 220, damping: 20 });
  const glare = useTransform([x, y] as any, ([gx, gy]: number[]) => `radial-gradient(circle at ${gx * 100}% ${gy * 100}%, rgba(255,255,255,0.35), transparent 55%)`);
  return (
    <motion.div
      className={cn("relative [transform-style:preserve-3d]", className)}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width);
        y.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        x.set(0.5);
        y.set(0.5);
      }}
    >
      {children}
      <motion.div className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-overlay" style={{ background: glare }} />
    </motion.div>
  );
}

/** Concentric pulsing rings (calls, live indicators). */
export function PulseRings({ className, count = 3, color = "bg-brand-500/25" }: { className?: string; count?: number; color?: string }) {
  return (
    <span className={cn("pointer-events-none absolute inset-0 grid place-items-center", className)} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <motion.span
          key={i}
          className={cn("absolute size-full rounded-full", color)}
          initial={{ scale: 0.8, opacity: 0.7 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ duration: 2.4, repeat: Infinity, delay: (i * 2.4) / count, ease: "easeOut" }}
        />
      ))}
    </span>
  );
}

/** Animated voice waveform bars. */
export function Waveform({ active = true, bars = 28, className }: { active?: boolean; bars?: number; className?: string }) {
  return (
    <div className={cn("flex h-10 items-center gap-[3px]", className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-gradient-to-t from-brand-600 to-sky"
          animate={active ? { height: [`${20 + ((i * 37) % 60)}%`, `${30 + ((i * 53) % 70)}%`, `${15 + ((i * 29) % 50)}%`] } : { height: "12%" }}
          transition={{ duration: 0.9 + (i % 5) * 0.12, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/** Text that types itself out. */
export function Typewriter({ words, className }: { words: string[]; className?: string }) {
  const [i, setI] = useState(0);
  const [text, setText] = useState("");
  const [del, setDel] = useState(false);
  useEffect(() => {
    const word = words[i % words.length];
    const t = setTimeout(
      () => {
        if (!del) {
          const next = word.slice(0, text.length + 1);
          setText(next);
          if (next === word) setTimeout(() => setDel(true), 1400);
        } else {
          const next = word.slice(0, text.length - 1);
          setText(next);
          if (!next) {
            setDel(false);
            setI((x) => x + 1);
          }
        }
      },
      del ? 35 : 70,
    );
    return () => clearTimeout(t);
  }, [text, del, i, words]);
  return (
    <span className={className}>
      {text}
      <motion.span className="ml-0.5 inline-block w-[2px] bg-current align-middle" style={{ height: "0.9em" }} animate={{ opacity: [1, 0] }} transition={{ duration: 0.7, repeat: Infinity }} />
    </span>
  );
}

/** Confetti burst — for meetings booked, wins and qualified prospects. */
let fire: ((x?: number, y?: number) => void) | null = null;
export function celebrate(x?: number, y?: number) {
  fire?.(x, y);
}

export function ConfettiHost() {
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  useEffect(() => {
    fire = (x, y) => {
      const id = Date.now() + Math.random();
      setBursts((b) => [...b, { id, x: x ?? window.innerWidth / 2, y: y ?? window.innerHeight / 3 }]);
      setTimeout(() => setBursts((b) => b.filter((z) => z.id !== id)), 2200);
    };
    return () => {
      fire = null;
    };
  }, []);
  const colors = ["#1a6ae0", "#5aa7f8", "#7cc0fa", "#ffffff", "#0f9d6b", "#f0a72e", "#1655c0"];
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[120] overflow-hidden">
      {bursts.map((b) =>
        Array.from({ length: 70 }).map((_, i) => {
          const angle = (Math.PI * 2 * i) / 70 + Math.random() * 0.3;
          const v = 180 + Math.random() * 320;
          return (
            <motion.span
              key={`${b.id}-${i}`}
              className="absolute block rounded-[2px]"
              style={{ left: b.x, top: b.y, width: 6 + Math.random() * 6, height: 8 + Math.random() * 8, background: colors[i % colors.length], boxShadow: "0 0 0 0.5px rgba(10,20,38,0.08)" }}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
              animate={{ x: Math.cos(angle) * v, y: [0, Math.sin(angle) * v - 120, Math.sin(angle) * v + 420], opacity: [1, 1, 0], rotate: Math.random() * 720 - 360 }}
              transition={{ duration: 1.8 + Math.random() * 0.5, ease: [0.16, 0.8, 0.4, 1] }}
            />
          );
        }),
      )}
    </div>,
    document.body,
  );
}

/** Thin animated light beam along the top edge of a container. */
export function Beam({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden", className)} aria-hidden>
      <div className="h-px w-1/3 bg-gradient-to-r from-transparent via-brand-400 to-transparent animate-beam" />
    </div>
  );
}

/** Magnetic hover: the element leans toward the cursor. */
export function Magnetic({ children, strength = 0.25, className }: { children: ReactNode; strength?: number; className?: string }) {
  const x = useSpring(0, { stiffness: 300, damping: 20 });
  const y = useSpring(0, { stiffness: 300, damping: 20 });
  return (
    <motion.div
      className={cn("inline-block", className)}
      style={{ x, y }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * strength);
        y.set((e.clientY - r.top - r.height / 2) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}
