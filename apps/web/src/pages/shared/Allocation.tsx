import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, History, Shuffle, Sparkles, UserCheck, Users, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { celebrate, Counter } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, CardHeader, Empty, Field, PageHeader, Select, Skeleton, Tabs } from "../../components/ui";
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
  const facets = useQuery({ queryKey: ["facets"], queryFn: () => api.get<any>("/contacts/facets") });
  const people = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: any[] }>("/users") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ settings: any }>("/settings") });
  const reps = (people.data?.users ?? []).filter((u) => u.status === "active" && ["sales_rep", "sales_head"].includes(u.role));
  const [campaign, setCampaign] = useState("");
  const [segment, setSegment] = useState("");
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

  const body = { campaign: campaign || null, segment: segment || null, userIds: selected, batchSize, maxActive };
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

  useEffect(() => setPreview(null), [campaign, segment, selected.join(","), batchSize, maxActive]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
      <Card>
        <CardHeader title="1 · Choose the pool" subtitle="Only open, unowned, callable prospects are eligible" icon={<Users className="size-4" />} />
        <div className="space-y-4 px-5 pb-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Campaign"><Select value={campaign} onChange={(e) => setCampaign(e.target.value)}><option value="">Any campaign</option>{(facets.data?.campaigns ?? []).filter((c: any) => c.value).map((c: any) => <option key={c.value} value={c.value}>{c.value}</option>)}</Select></Field>
            <Field label="Segment"><Select value={segment} onChange={(e) => setSegment(e.target.value)}><option value="">Any segment</option>{(facets.data?.segments ?? []).filter((c: any) => c.value).map((c: any) => <option key={c.value} value={c.value}>{c.value}</option>)}</Select></Field>
          </div>
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
            <p className="font-semibold text-fg">{b.assigned_count} prospects · by {b.initiated_by_name ?? "—"}</p>
            <p className="text-xs text-muted">{fmtDateTime(b.created_at)} · batch {b.settings?.batchSize} · max {b.settings?.maxActive}{b.settings?.campaign ? ` · ${b.settings.campaign}` : ""}{b.settings?.segment ? ` · ${b.settings.segment}` : ""}</p>
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
