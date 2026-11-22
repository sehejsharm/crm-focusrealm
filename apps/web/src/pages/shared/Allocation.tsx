import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Briefcase, Building2, Check, ChevronDown, Database, Filter, History, MapPin, Repeat, Search, Shuffle, SlidersHorizontal, Sparkles, UserCheck, Users, X, Zap } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { celebrate, Counter } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Skeleton, Switch, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, cn, fmtDateTime } from "../../lib/format";

interface Preview {
  batchSize: number;
  maxActive: number;
  poolSize: number;
  willAssign: number;
  leftUnassigned: number;
  excluded: Record<string, number>;
  people: { id: string; name: string; currentActive: number; quota: number; assigned: number }[];
}

/**
 * Prospect allocation (proposal §4): pick the segment and the salespeople,
 * preview a fair, capacity-aware split, then commit. The rules run on the
 * server; this screen only shows them.
 */
export default function Allocation() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"allocate" | "history" | "flags">((params.get("tab") as any) ?? "allocate");
  return (
    <div>
      <PageHeader eyebrow="Allocation" title="Allocate prospects" subtitle="Balanced, randomised distribution within each segment — capped by everyone's active-prospect limit." actions={<Tabs value={tab} onChange={setTab} items={[{ value: "allocate", label: "Allocate" }, { value: "history", label: "History" }, { value: "flags", label: "Needs review" }]} />} />
      <PoolBanner />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          {tab === "allocate" && <Allocate />}
          {tab === "history" && <BatchHistory />}
          {tab === "flags" && <Flags base={`/${user?.portal}`} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Allocate() {
  const qc = useQueryClient();
  const toast = useToast();
  const facets = useQuery({ queryKey: ["allocation-facets"], queryFn: () => api.get<PoolFacets>("/allocation/facets") });
  const people = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: any[] }>("/users") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ settings: any }>("/settings") });
  const reps = (people.data?.users ?? []).filter((u) => u.status === "active" && ["sales_rep", "sales_head"].includes(u.role));
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(10);
  const [maxActive, setMaxActive] = useState(60);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (settings.data) {
      setBatchSize(settings.data.settings.allocation.batchSize);
      setMaxActive(settings.data.settings.allocation.maxActive);
    }
  }, [settings.data]);
  useEffect(() => {
    if (reps.length && !selected.length) setSelected(reps.filter((r) => r.role === "sales_rep").map((r) => r.id));
  }, [reps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterBody = useMemo(() => toBody(filters), [filters]);
  const activeFilters = Object.keys(filterBody).length;
  const body = { ...filterBody, userIds: selected, batchSize, maxActive };
  // Live count of matching prospects while filters change (debounced).
  const [debounced, setDebounced] = useState(filterBody);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(filterBody), 350);
    return () => clearTimeout(t);
  }, [filterBody]);
  const matching = useQuery({ queryKey: ["allocation-count", debounced], queryFn: () => api.post<{ matching: number }>("/allocation/count", debounced), placeholderData: (p) => p });
  const doPreview = useMutation({ mutationFn: () => api.post<Preview>("/allocation/preview", body), onSuccess: (p) => { setPreview(p); setResult(null); }, onError: (e) => toast({ kind: "error", title: "Can't preview", body: (e as Error).message }) });
  const run = useMutation({
    mutationFn: () => api.post<any>("/allocation/run", body),
    onSuccess: (r) => {
      setResult(r);
      setPreview(null);
      if (r.assigned) celebrate();
      qc.invalidateQueries();
    },
    onError: (e) => toast({ kind: "error", title: "Allocation failed", body: (e as Error).message }),
  });

  useEffect(() => setPreview(null), [JSON.stringify(filterBody), selected.join(","), batchSize, maxActive]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
      <Card className="relative z-10">
        <CardHeader
          title="1 · Choose the pool"
          subtitle="Only open, unowned, callable prospects are eligible"
          icon={<Users className="size-4" />}
          action={
            <motion.span key={matching.data?.matching ?? -1} initial={{ scale: 0.85, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} className="whitespace-nowrap rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-soft-fg tabular-nums">
              {matching.data ? `${matching.data.matching.toLocaleString("en-IN")} match` : "…"}
            </motion.span>
          }
        />
        <div className="space-y-4 px-5 pb-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <MultiPick label="Location" icon={<MapPin className="size-4" />} placeholder="Any city" options={facets.data?.cities} value={filters.cities} onChange={(v) => set("cities", v)} />
            <MultiPick label="Industry" icon={<Building2 className="size-4" />} placeholder="Any industry" options={facets.data?.industries} value={filters.industries} onChange={(v) => set("industries", v)} />
          </div>
          <div>
            <Field label="Designation" hint="Any of these words, separated by commas">
              <Input icon={<Briefcase className="size-4" />} value={filters.designation} onChange={(e) => set("designation", e.target.value)} placeholder="e.g. owner, CEO, general manager" />
            </Field>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SENIORITY.map((w) => {
                const on = splitWords(filters.designation).includes(w.toLowerCase());
                return (
                  <motion.button key={w} type="button" whileTap={{ scale: 0.94 }} onClick={() => set("designation", toggleWord(filters.designation, w))}
                    className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold transition", on ? "border-brand-500 bg-accent-soft text-accent-soft-fg" : "border-line text-muted hover:border-line-strong hover:text-fg")}>
                    {on && <Check className="mr-1 inline size-3" />}{w}
                  </motion.button>
                );
              })}
            </div>
          </div>
          <Field label="Hotel / company name" hint="Contains any of these, separated by commas">
            <Input icon={<Search className="size-4" />} value={filters.company} onChange={(e) => set("company", e.target.value)} placeholder="e.g. Taj, Marriott, Radisson" />
          </Field>

          <div className="rounded-2xl border border-line">
            <button type="button" onClick={() => setMore((m) => !m)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-semibold text-fg">
              <SlidersHorizontal className="size-4 text-accent" /> More filters
              <span className="text-xs font-normal text-muted">campaign, segment, source, import file, date added…</span>
              <ChevronDown className={cn("ml-auto size-4 text-muted transition", more && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {more && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="space-y-3 border-t border-line p-3.5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Campaign"><Select value={filters.campaign} onChange={(e) => set("campaign", e.target.value)}><option value="">Any campaign</option>{(facets.data?.campaigns ?? []).map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}</Select></Field>
                      <Field label="Segment"><Select value={filters.segment} onChange={(e) => set("segment", e.target.value)}><option value="">Any segment</option>{(facets.data?.segments ?? []).map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}</Select></Field>
                      <MultiPick label="Source" placeholder="Any source" options={facets.data?.sources} value={filters.sources} onChange={(v) => set("sources", v)} />
                      <MultiPick label="Import file" placeholder="Any import" options={facets.data?.batches.map((b) => ({ value: b.value, label: `${b.label} · ${fmtDateTime(b.created_at)}`, count: b.count }))} value={filters.importBatchIds} onChange={(v) => set("importBatchIds", v)} />
                      <Field label="Added from"><Input type="date" value={filters.addedFrom} onChange={(e) => set("addedFrom", e.target.value)} /></Field>
                      <Field label="Added until"><Input type="date" value={filters.addedTo} onChange={(e) => set("addedTo", e.target.value)} /></Field>
                    </div>
                    <Field label="Leave out designations containing" hint="e.g. intern, assistant, trainee">
                      <Input value={filters.excludeDesignation} onChange={(e) => set("excludeDesignation", e.target.value)} placeholder="intern, assistant" />
                    </Field>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <ToggleRow label="Only with an email" checked={filters.hasEmail} onChange={(v) => set("hasEmail", v)} />
                      <ToggleRow label="Only never called" checked={filters.neverCalled} onChange={(v) => set("neverCalled", v)} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {activeFilters > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Filter className="size-3.5 text-accent" /> {activeFilters} filter{activeFilters === 1 ? "" : "s"} on
              <button type="button" onClick={() => setFilters(NO_FILTERS)} className="font-semibold text-accent hover:underline">Clear all</button>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Slider label="Batch size per person" value={batchSize} min={1} max={30} onChange={setBatchSize} hint="Proposal default: 5–10" />
            <Slider label="Max active prospects" value={maxActive} min={10} max={300} step={5} onChange={setMaxActive} hint="Nobody goes over this" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-fg">2 · Who receives prospects</p>
              <button onClick={() => setSelected(selected.length === reps.length ? [] : reps.map((r) => r.id))} className="text-xs font-semibold text-accent hover:underline">{selected.length === reps.length ? "Clear" : "Select all"}</button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {people.isLoading && <Skeleton className="h-16 sm:col-span-2" />}
              {reps.map((r) => {
                const on = selected.includes(r.id);
                return (
                  <motion.button key={r.id} whileTap={{ scale: 0.97 }} onClick={() => setSelected((s) => (on ? s.filter((x) => x !== r.id) : [...s, r.id]))} className={cn("flex items-center gap-3 rounded-2xl border p-3 text-left transition", on ? "border-brand-500 bg-accent-soft shadow-sm" : "border-line bg-surface hover:border-line-strong")}>
                    <Avatar name={r.full_name} hue={r.avatar_hue} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">{r.full_name}</span>
                      <span className="block text-xs text-muted">{r.active_prospects} active · room for {Math.max(0, maxActive - r.active_prospects)}</span>
                    </span>
                    <span className={cn("grid size-5 place-items-center rounded-full border transition", on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong")}>{on && <Check className="size-3" />}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
          <Button variant="primary" size="lg" className="w-full" icon={<Sparkles className="size-4" />} disabled={!selected.length} loading={doPreview.isPending} onClick={() => doPreview.mutate()}>Preview the split</Button>
        </div>
      </Card>

      <Card delay={0.05} className="relative overflow-hidden">
        <CardHeader title="3 · Preview & allocate" subtitle="Shuffled within each segment, least-loaded first" icon={<Shuffle className="size-4" />} />
        <div className="px-5 pb-5">
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-4 text-center">
                <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 240, damping: 14 }} className="mx-auto grid size-20 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg">
                  <Check className="size-10" />
                </motion.div>
                <p className="mt-4 text-3xl font-bold text-fg"><Counter value={result.assigned} /> prospects allocated</p>
                <p className="mt-1 text-sm text-muted">Everyone has been notified. {result.leftUnassigned ? `${result.leftUnassigned} left unassigned (capacity reached).` : ""}</p>
                <div className="mx-auto mt-5 max-w-sm space-y-2 text-left">
                  {result.capacity.map((p: any, i: number) => (
                    <motion.div key={p.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.06 }} className="flex items-center gap-3 rounded-xl bg-sunken px-3 py-2">
                      <Avatar name={p.name} size={28} />
                      <span className="flex-1 text-sm font-semibold text-fg">{p.name}</span>
                      <Badge tone="success">+{result.perUser[p.id] ?? 0}</Badge>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ) : preview ? (
              <motion.div key="preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="grid grid-cols-3 gap-3">
                  <Metric label="Eligible pool" value={preview.poolSize} />
                  <Metric label="Will assign" value={preview.willAssign} accent />
                  <Metric label="Left over" value={preview.leftUnassigned} />
                </div>
                <div className="mt-5 space-y-3">
                  {preview.people.map((p, i) => (
                    <motion.div key={p.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-semibold text-fg"><Avatar name={p.name} size={24} />{p.name}</span>
                        <span className="text-xs text-muted">{p.currentActive} active → <b className="text-fg">+{p.assigned}</b>{p.quota < preview.batchSize && <span className="text-warning"> (capacity {p.quota})</span>}</span>
                      </div>
                      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-sunken">
                        {Array.from({ length: preview.batchSize }).map((_, j) => (
                          <motion.span key={j} className={cn("flex-1", j < p.assigned ? "bg-gradient-to-r from-brand-400 to-brand-600" : j < p.quota ? "bg-brand-100 dark:bg-brand-950" : "bg-line/50")} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.2 + i * 0.07 + j * 0.03 }} />
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </div>
                <div className="mt-5 rounded-2xl bg-sunken/70 p-3.5 text-xs text-muted">
                  <p className="mb-1 font-semibold text-fg">Left out of the pool, and why</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(preview.excluded).map(([k, v]) => <Badge key={k} tone="neutral">{k.replace(/_/g, " ")}: {v}</Badge>)}
                  </div>
                </div>
                <Button variant="primary" size="lg" className="mt-5 w-full" icon={<Zap className="size-4" />} disabled={!preview.willAssign} loading={run.isPending} onClick={() => run.mutate()}>
                  Allocate {preview.willAssign} prospects
                </Button>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Empty icon={<Shuffle className="size-6" />} title="Preview to see the split" body="You'll see exactly who gets how many before anything is committed." />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>
    </div>
  );
}

type Opt = { value: string; label?: string; count: number };
interface PoolFacets {
  cities: Opt[];
  industries: Opt[];
  sources: Opt[];
  campaigns: Opt[];
  segments: Opt[];
  batches: { value: string; label: string; created_at: string; count: number }[];
  designations: Opt[];
}
interface Filters {
  campaign: string;
  segment: string;
  cities: string[];
  industries: string[];
  sources: string[];
  importBatchIds: string[];
  designation: string;
  excludeDesignation: string;
  company: string;
  hasEmail: boolean;
  neverCalled: boolean;
  addedFrom: string;
  addedTo: string;
}
const NO_FILTERS: Filters = {
  campaign: "", segment: "", cities: [], industries: [], sources: [], importBatchIds: [],
  designation: "", excludeDesignation: "", company: "", hasEmail: false, neverCalled: false, addedFrom: "", addedTo: "",
};
/** Only the filters that are actually set. */
function toBody(f: Filters) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v) ? v.length : typeof v === "string" ? v.trim() : v) out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}
const SENIORITY = ["Owner", "Founder", "CEO", "MD", "Director", "General Manager", "VP", "Head", "Manager", "Partner"];
const splitWords = (s: string) => s.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
function toggleWord(s: string, w: string) {
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  const i = parts.findIndex((x) => x.toLowerCase() === w.toLowerCase());
  if (i >= 0) parts.splice(i, 1);
  else parts.push(w);
  return parts.join(", ");
}
function describeFilters(s: any): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.campaign) out.push(s.campaign);
  if (s.segment) out.push(s.segment);
  if (s.cities?.length) out.push(s.cities.slice(0, 3).join(", ") + (s.cities.length > 3 ? ` +${s.cities.length - 3}` : ""));
  if (s.industries?.length) out.push(s.industries.join(", "));
  if (s.designation) out.push(`“${s.designation}”`);
  if (s.company) out.push(`company: ${s.company}`);
  if (s.neverCalled) out.push("never called");
  return out;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-sunken/70 px-3 py-2 text-sm text-fg">
      {label}
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** A searchable multi-select with counts, for long lists like cities. */
function MultiPick({ label, icon, placeholder, options, value, onChange }: { label: string; icon?: ReactNode; placeholder: string; options?: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  // On phones, don't pop the keyboard over the list the moment it opens.
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", fn);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fn);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const list = (options ?? []).filter((o) => (o.label ?? o.value).toLowerCase().includes(q.trim().toLowerCase()));
  const nameOf = (v: string) => options?.find((o) => o.value === v)?.label ?? v;
  const summary = value.length === 0 ? placeholder : value.length <= 2 ? value.map(nameOf).join(", ") : `${nameOf(value[0])} +${value.length - 1} more`;
  return (
    <div ref={ref} className="relative">
      <span className="mb-1.5 block text-[13px] font-semibold text-fg">{label}</span>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={cn("flex h-10 w-full items-center gap-2 rounded-xl border bg-surface px-3 text-left text-sm shadow-xs transition", open ? "border-brand-500 ring-focus" : "border-line-strong", value.length ? "text-fg" : "text-subtle")}>
        {icon && <span className="text-subtle">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {value.length > 0 && (
          <span role="button" tabIndex={-1} aria-label={`Clear ${label}`} onClick={(e) => { e.stopPropagation(); onChange([]); }} className="grid size-5 place-items-center rounded-full text-muted hover:bg-sunken hover:text-fg">
            <X className="size-3.5" />
          </span>
        )}
        <ChevronDown className={cn("size-4 text-muted transition", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            className="absolute top-full right-0 left-0 z-50 mt-1.5 min-w-60 origin-top rounded-2xl border border-line bg-surface p-2 shadow-lg">
            <Input autoFocus={!coarse} icon={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} className="h-9" />
            <div className="mt-1.5 max-h-64 overflow-y-auto">
              {!options && <p className="p-3 text-center text-xs text-muted">Loading…</p>}
              {options && list.length === 0 && <p className="p-3 text-center text-xs text-muted">{options.length ? "No match" : "Nothing in the pool has this yet"}</p>}
              {list.map((o) => {
                const on = value.includes(o.value);
                return (
                  <button key={o.value} type="button" onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-surface-hover", on && "bg-accent-soft/60")}>
                    <span className={cn("grid size-4 shrink-0 place-items-center rounded border transition", on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong")}>{on && <Check className="size-3" />}</span>
                    <span className="min-w-0 flex-1 truncate text-fg">{o.label ?? o.value}</span>
                    <span className="text-xs text-muted tabular-nums">{o.count.toLocaleString("en-IN")}</span>
                  </button>
                );
              })}
            </div>
            {value.length > 0 && (
              <div className="mt-1.5 flex items-center justify-between border-t border-line px-1 pt-1.5 text-xs">
                <span className="text-muted">{value.length} selected</span>
                <button type="button" onClick={() => onChange([])} className="font-semibold text-accent hover:underline">Clear</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, hint }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between"><span className="text-[13px] font-semibold text-fg">{label}</span><motion.span key={value} initial={{ scale: 1.3, color: "#1a6ae0" }} animate={{ scale: 1 }} className="text-lg font-bold text-fg tabular-nums">{value}</motion.span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#1a6ae0]" />
      {hint && <p className="text-[11px] text-subtle">{hint}</p>}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={cn("rounded-2xl p-3 text-center", accent ? "bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-brand" : "bg-sunken")}>
      <p className="text-2xl font-bold"><Counter value={value} /></p>
      <p className={cn("text-[11px]", accent ? "text-white/80" : "text-muted")}>{label}</p>
    </div>
  );
}

function BatchHistory() {
  const q = useQuery({ queryKey: ["batches"], queryFn: () => api.get<{ batches: any[] }>("/allocation/batches") });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (!q.data?.batches.length) return <Card><Empty icon={<History className="size-6" />} title="No allocation batches yet" /></Card>;
  return (
    <Card className="divide-y divide-line overflow-hidden" spotlight={false}>
      {q.data.batches.map((b, i) => (
        <motion.div key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-sm">
          <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent-soft-fg"><Shuffle className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-fg">{b.assigned_count} prospects · {b.initiated_by ? `by ${b.initiated_by_name ?? "—"}` : "morning top-up"}</p>
            <p className="text-xs text-muted">{fmtDateTime(b.created_at)} · batch {b.settings?.batchSize} · max {b.settings?.maxActive}{describeFilters(b.settings).map((d) => ` · ${d}`).join("")}</p>
          </div>
          <Badge tone="neutral">{Object.keys(b.summary?.perUser ?? {}).length} people</Badge>
        </motion.div>
      ))}
    </Card>
  );
}

function Flags({ base }: { base: string }) {
  const q = useQuery({ queryKey: ["flags"], queryFn: () => api.get<{ flags: any[] }>("/allocation/flags") });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (!q.data?.flags.length) return <Card><Empty icon={<UserCheck className="size-6" />} title="Nobody needs review" body="Prospects owned by inactive or idle salespeople show up here — never reassigned automatically." /></Card>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {q.data.flags.map((f, i) => (
        <motion.div key={f.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
          <Card className="flex items-center gap-4 p-4">
            <span className="grid size-11 place-items-center rounded-2xl bg-warning-soft text-warning"><AlertTriangle className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">{f.full_name} <span className="text-xs font-normal text-muted">{f.employee_code}</span></p>
              <p className="text-xs text-muted">{f.status !== "active" ? `Account ${f.status}` : `No calls since ${ago(f.last_call_at)}`} · {f.active_prospects} active prospects</p>
            </div>
            <Link to={`${base}/database?owner=${f.id}`} className="text-xs font-semibold text-accent hover:underline">Review →</Link>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

/** How much is waiting to be allocated, and whether the morning top-up is on. */
function PoolBanner() {
  const { user } = useAuth();
  const o = useQuery({ queryKey: ["allocation-overview"], queryFn: () => api.get<{ pool: number; room: number; settings: { autoEnabled: boolean; autoTime: string; batchSize: number } }>("/allocation/overview") });
  if (!o.data) return null;
  const d = o.data;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-xs">
      <span className="flex items-center gap-2"><Database className="size-4 text-accent" /><b className="text-fg">{d.pool.toLocaleString("en-IN")}</b><span className="text-muted">unassigned prospects</span></span>
      <span className="flex items-center gap-2"><Users className="size-4 text-accent" /><span className="text-muted">room for</span><b className="text-fg">{d.room.toLocaleString("en-IN")}</b><span className="text-muted">right now</span></span>
      <span className={cn("flex items-center gap-2", d.settings.autoEnabled ? "text-success" : "text-muted")}>
        <Repeat className="size-4" />
        {d.settings.autoEnabled ? `Morning top-up on · ${d.settings.batchSize} each at ${d.settings.autoTime}` : "Morning top-up off"}
      </span>
      {user?.role === "founder" && <Link to="/founder/settings?tab=allocation" className="ml-auto text-xs font-semibold text-accent hover:underline">Change →</Link>}
    </motion.div>
  );
}
