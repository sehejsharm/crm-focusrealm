import { motion } from "motion/react";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn, fmtDate, scoreTone, TONE_HEX } from "../lib/format";
import { Counter } from "./motion";

/**
 * Hand-built SVG charts. Brand blue only: one hue for single series, two
 * validated steps of it (--series-1/--series-2) when two series share a plot.
 * Every plot animates in (lines draw, bars grow) and has a hover tooltip.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

function niceMax(v: number) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function smooth(points: [number, number][]) {
  if (points.length < 2) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

// ------------------------------------------------------------- Area chart

export interface Series {
  key: string;
  label: string;
  color: string; // CSS color or var(--series-n)
}

export function AreaChart({ data, series, xKey = "day", height = 220, className, formatX = (v: string) => fmtDate(v) }: {
  data: Record<string, any>[];
  series: Series[];
  xKey?: string;
  height?: number;
  className?: string;
  formatX?: (v: string) => string;
}) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const every = Math.ceil(data.length / 6);

  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = data.map((d, i) => [x(i), y(Number(d[s.key]) || 0)] as [number, number]);
        const line = smooth(pts);
        const area = `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
        return { s, line, area, last: pts.at(-1) };
      }),
    [data, series, max], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 px-1 text-xs text-muted">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-3.5 rounded-full" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={series.map((s) => s.label).join(" and ") + " over time"}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="fill-subtle text-[10px]">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          i % every === 0 || i === data.length - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-subtle text-[10px]">
              {formatX(d[xKey])}
            </text>
          ) : null,
        )}
        {paths.map(({ s, area }) => (
          <motion.path key={`a-${s.key}`} d={area} fill={`url(#${id}-${s.key})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.4 }} />
        ))}
        {paths.map(({ s, line }, i) => (
          <motion.path key={`l-${s.key}`} d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: EASE, delay: i * 0.15 }} />
        ))}
        {paths.map(({ s, last }, i) =>
          last ? (
            <motion.circle key={`e-${s.key}`} cx={last[0]} cy={last[1]} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2}
              initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.3 + i * 0.15, type: "spring" }} />
          ) : null,
        )}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--line-strong)" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(Number(data[hover][s.key]) || 0)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover != null && data[hover] && (
        <div
          className="pointer-events-none absolute top-6 z-10 min-w-32 -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-md"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <p className="mb-1 font-semibold text-fg">{formatX(data[hover][xKey])}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-4 text-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-semibold text-fg tabular-nums">{data[hover][s.key] ?? "—"}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- Sparkline

export function Sparkline({ values, className, height = 36, color = "var(--series-1)" }: { values: number[]; className?: string; height?: number; color?: string }) {
  const id = useId().replace(/:/g, "");
  const W = 120;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i * W) / Math.max(1, values.length - 1), height - 3 - (v / max) * (height - 6)] as [number, number]);
  const line = smooth(pts);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className={cn("h-9 w-full overflow-visible", className)} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {pts.length > 1 && <motion.path d={`${line} L${W},${height} L0,${height} Z`} fill={`url(#${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} />}
      <motion.path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: EASE }} />
    </svg>
  );
}

// ----------------------------------------------------------- Column chart

export function Columns({ data, valueKey, labelKey, height = 140, format = (v: any) => String(v), highlightLast = true }: {
  data: Record<string, any>[]; valueKey: string; labelKey: string; height?: number; format?: (v: any) => string; highlightLast?: boolean;
}) {
  const max = niceMax(Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0)));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="relative">
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {data.map((d, i) => {
          const v = Number(d[valueKey]) || 0;
          return (
            <div key={i} className="group relative flex h-full flex-1 items-end justify-center" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <motion.div
                className={cn("w-full max-w-6 rounded-t-[4px]", highlightLast && i === data.length - 1 ? "bg-brand-600 dark:bg-brand-400" : "bg-brand-300 group-hover:bg-brand-500 dark:bg-brand-700 dark:group-hover:bg-brand-500")}
                initial={{ height: 0 }}
                animate={{ height: `${(v / max) * 100}%` }}
                transition={{ duration: 0.8, delay: i * 0.025, ease: EASE }}
                style={{ minHeight: v ? 3 : 0 }}
              />
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] whitespace-nowrap shadow-md">
                  <span className="font-semibold text-fg">{format(v)}</span> <span className="text-muted">· {d[labelKey]}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------- Horizontal bar list

export function BarList({ items, max: forcedMax, format = (v: number) => String(v), tone = "brand" }: {
  items: { label: ReactNode; value: number; sub?: ReactNode; key?: string }[];
  max?: number;
  format?: (v: number) => string;
  tone?: "brand" | "status";
}) {
  const max = forcedMax ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => {
        const pct = (it.value / max) * 100;
        const color = tone === "status" ? TONE_HEX[scoreTone(it.value, max)] : undefined;
        return (
          <div key={it.key ?? i} className="group" title={`${format(it.value)}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate font-medium text-fg">{it.label}</span>
              <span className="shrink-0 font-semibold text-fg tabular-nums">
                {format(it.value)} {it.sub && <span className="ml-1 font-normal text-muted">{it.sub}</span>}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken">
              <motion.div
                className={cn("h-full rounded-full", !color && "bg-gradient-to-r from-brand-400 to-brand-600")}
                style={color ? { background: color } : undefined}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, delay: 0.05 * i, ease: EASE }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- Score ring

export function ScoreRing({ value, max = 100, size = 120, stroke = 10, label, sub, className }: {
  value: number | null | undefined; max?: number; size?: number; stroke?: number; label?: ReactNode; sub?: ReactNode; className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const tone = scoreTone(value, max);
  const color = TONE_HEX[tone];
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.65} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.5, ease: EASE, delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-bold tracking-tight text-fg" style={{ fontSize: size * 0.27 }}>
            {value == null ? "—" : <Counter value={value} decimals={max <= 10 ? 1 : 0} />}
          </div>
          {label && <div className="-mt-0.5 text-[11px] font-medium text-muted">{label}</div>}
          {sub}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Radar

export function Radar({ items, max = 10, size = 300 }: { items: { label: string; value: number }[]; max?: number; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 46;
  const n = items.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * R * (v / max), cy + Math.sin(a) * R * (v / max)] as [number, number];
  };
  const poly = items.map((it, i) => pt(i, Math.max(0, it.value)).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[340px] overflow-visible" role="img" aria-label="Sales framework scores">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={items.map((_, i) => pt(i, max * f).join(",")).join(" ")} fill="none" stroke="var(--chart-grid)" strokeWidth={1} />
      ))}
      {items.map((_, i) => {
        const [x, y] = pt(i, max);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--chart-grid)" strokeWidth={1} />;
      })}
      <motion.polygon
        points={poly}
        fill="var(--series-1)"
        fillOpacity={0.16}
        stroke="var(--series-1)"
        strokeWidth={2}
        strokeLinejoin="round"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: EASE }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      {items.map((it, i) => {
        const [x, y] = pt(i, Math.max(0, it.value));
        const [lx, ly] = pt(i, max * 1.2);
        return (
          <g key={it.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <motion.circle cx={x} cy={y} r={hover === i ? 6 : 4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 + i * 0.05 }} />
            <circle cx={x} cy={y} r={14} fill="transparent" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className={cn("text-[10.5px] font-semibold", hover === i ? "fill-fg" : "fill-muted")}>
              {it.label}
            </text>
            {hover === i && (
              <text x={lx} y={ly + 13} textAnchor="middle" className="fill-fg text-[11px] font-bold">
                {it.value.toFixed(1)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ----------------------------------------------------------------- Funnel

export function Funnel({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  const shades = ["#7cc0fa", "#5aa7f8", "#2f86f0", "#1a6ae0", "#1655c0", "#18479b"];
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const pct = Math.max(6, (s.value / max) * 100);
        const conv = i > 0 && steps[i - 1].value ? Math.round((s.value / steps[i - 1].value) * 100) : null;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right">
              <p className="text-[13px] font-semibold text-fg">{s.label}</p>
              {s.hint && <p className="text-[11px] text-muted">{s.hint}</p>}
            </div>
            <div className="relative h-10 flex-1">
              <motion.div
                className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
                style={{ background: shades[Math.min(i + 1, shades.length - 1)], minWidth: 44 }}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: `${pct}%`, opacity: 1 }}
                transition={{ duration: 0.9, delay: i * 0.12, ease: EASE }}
              >
                <Counter value={s.value} />
              </motion.div>
            </div>
            <div className="w-14 shrink-0 text-xs font-semibold text-muted tabular-nums">{conv != null ? `${conv}%` : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------- Stat / KPI card

export function Stat({ label, value, suffix, prefix, decimals, icon, trend, foot, spark, delay = 0, accent = false }: {
  label: string; value: number | null | undefined; suffix?: string; prefix?: string; decimals?: number; icon?: ReactNode;
  trend?: { value: number; good?: boolean } | null; foot?: ReactNode; spark?: number[]; delay?: number; accent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
      whileHover={{ y: -3 }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md",
        accent ? "border-transparent bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 text-white" : "border-line bg-surface",
      )}
    >
      {accent && <div className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-white/15 blur-2xl transition-transform duration-700 group-hover:scale-125" />}
      <div className="relative flex items-center justify-between">
        <p className={cn("text-[12.5px] font-semibold", accent ? "text-white/80" : "text-muted")}>{label}</p>
        {icon && <span className={cn("grid size-8 place-items-center rounded-xl transition-transform group-hover:scale-110 group-hover:rotate-6", accent ? "bg-white/15 text-white" : "bg-accent-soft text-accent-soft-fg")}>{icon}</span>}
      </div>
      <div className="relative mt-2 flex items-end gap-2">
        <span className={cn("text-[28px] leading-none font-bold tracking-tight", accent ? "text-white" : "text-fg")}>
          <Counter value={value} suffix={suffix} prefix={prefix} decimals={decimals} />
        </span>
        {trend && (
          <span className={cn("mb-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold", accent ? "bg-white/15 text-white" : trend.good ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            {trend.value > 0 ? "▲" : trend.value < 0 ? "▼" : "•"} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      {spark && spark.length > 1 && <Sparkline values={spark} className="mt-2" color={accent ? "#ffffff" : "var(--series-1)"} />}
      {foot && <div className={cn("relative mt-2 text-xs", accent ? "text-white/75" : "text-muted")}>{foot}</div>}
    </motion.div>
  );
}
