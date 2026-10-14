import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  BrainCircuit, CheckCircle2, ClipboardCheck, Cpu, Link2, Mail, Phone, Plus, RotateCcw, Shuffle, Smartphone, Trash2, X, Zap,
} from "lucide-react";
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Skeleton, Switch, Tabs, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, cn, ROLE_LABEL } from "../../lib/format";

type Section = "reports" | "calling" | "hr" | "allocation" | "qualification" | "system";

export default function Settings() {
  const [section, setSection] = useState<Section>("reports");
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ settings: any }>("/settings") });
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Settings" subtitle="Founders control how the CRM behaves. Every change is written to the audit log." />
      <Tabs className="mb-5" value={section} onChange={setSection} items={[
        { value: "reports", label: "📧 Daily reports" },
        { value: "calling", label: "📞 Calling & recording" },
        { value: "hr", label: "🔗 HR console" },
        { value: "allocation", label: "🔀 Allocation" },
        { value: "qualification", label: "✅ Qualification" },
        { value: "system", label: "⚙️ System" },
      ]} />
      {!q.data ? <Skeleton className="h-96" /> : (
        <AnimatePresence mode="wait">
          <motion.div key={section} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {section === "reports" && <ReportsSettings value={q.data.settings.reports} />}
            {section === "calling" && <CallingSettings value={q.data.settings.telephony} />}
            {section === "hr" && <HrSettings value={q.data.settings.hr} />}
            {section === "allocation" && <AllocationSettings value={q.data.settings.allocation} />}
            {section === "qualification" && <QualificationSettings value={q.data.settings.qualification} />}
            {section === "system" && <SystemSettings />}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function useSave(key: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (value: any) => api.put(`/settings/${key}`, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
      toast({ kind: "success", title: "Settings saved" });
    },
    onError: (e) => toast({ kind: "error", title: "Couldn't save", body: (e as Error).message }),
  });
}

function Row({ title, body, children }: { title: string; body?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line px-5 py-4 first:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl"><p className="text-sm font-semibold text-fg">{title}</p>{body && <p className="mt-0.5 text-xs text-muted">{body}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ReportsSettings({ value }: { value: any }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = useSave("reports");
  const set = (k: string, x: any) => setV((o: any) => ({ ...o, [k]: x }));
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
      <Card spotlight={false}>
        <CardHeader title="End-of-day run" subtitle="Analyse every recording, write one report per salesperson, email it" icon={<BrainCircuit className="size-4" />} />
        <Row title="Daily reports" body="Turn the automatic evening run on or off."><Switch checked={v.enabled} onChange={(x) => set("enabled", x)} /></Row>
        <Row title="Run time (IST)" body="When the analysis and emails start. On Vercel, the cron in vercel.json also triggers at 20:00 IST."><Input type="time" value={v.time} onChange={(e) => set("time", e.target.value)} className="w-32" /></Row>
        <Row title="When to analyse calls" body="End of day matches your journey: all of the day's recordings are analysed together in the evening. Immediate also gives reps coaching minutes after each call.">
          <Select value={v.analysisMode} onChange={(e) => set("analysisMode", e.target.value)} className="w-44"><option value="end_of_day">End of day</option><option value="immediate">Immediately + end of day</option></Select>
        </Row>
        <Row title="Skip days with no calls" body="No empty reports on holidays."><Switch checked={v.skipEmptyDays} onChange={(x) => set("skipEmptyDays", x)} /></Row>
        <CardHeader title="Who receives every report" icon={<Mail className="size-4" />} />
        <Row title="Founders (CEO, COO…)" body="Every active founder with an email address."><Switch checked={v.includeFounders} onChange={(x) => set("includeFounders", x)} /></Row>
        <Row title="Sales heads" body="Every active sales head."><Switch checked={v.includeSalesHeads} onChange={(x) => set("includeSalesHeads", x)} /></Row>
        <Row title="The salesperson themself" body="Each person also gets their own report."><Switch checked={v.sendRepCopy} onChange={(x) => set("sendRepCopy", x)} /></Row>
        <div className="border-t border-line px-5 py-4"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(v)}>Save report settings</Button></div>
      </Card>
      <Recipients />
    </div>
  );
}

function Recipients() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["recipients"], queryFn: () => api.get<{ recipients: any[]; automatic: any[] }>("/settings/recipients") });
  const [f, setF] = useState({ name: "", email: "", label: "Board" });
  const add = useMutation({
    mutationFn: () => api.post("/settings/recipients", f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recipients"] }); qc.invalidateQueries({ queryKey: ["recipients-preview"] }); setF({ name: "", email: "", label: "Board" }); toast({ kind: "success", title: "Recipient added" }); },
    onError: (e) => toast({ kind: "error", title: "Couldn't add", body: (e as Error).message }),
  });
  const toggle = useMutation({ mutationFn: (r: any) => api.patch(`/settings/recipients/${r.id}`, { active: !r.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ["recipients"] }) });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/settings/recipients/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["recipients"] }) });
  return (
    <Card spotlight={false}>
      <CardHeader title="Report recipients" subtitle="Add anyone else who should get the daily reports" icon={<Mail className="size-4" />} />
      <div className="space-y-4 px-5 pb-5">
        <div>
          <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">Automatic (from roles)</p>
          <div className="space-y-1.5">
            {(q.data?.automatic ?? []).map((p) => (
              <div key={p.email ?? p.full_name} className="flex items-center gap-3 rounded-xl bg-sunken/70 px-3 py-2">
                <Avatar name={p.full_name} size={28} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg">{p.full_name}</span><span className="block truncate text-xs text-muted">{p.email ?? "no email — won't receive"}</span></span>
                <Badge tone="brand">{p.title ?? ROLE_LABEL[p.role]}</Badge>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">Added by founders</p>
          <AnimatePresence initial={false}>
            {(q.data?.recipients ?? []).map((r) => (
              <motion.div key={r.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-1.5 flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent-soft-fg"><Mail className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fg">{r.name} <Badge tone="neutral" className="ml-1">{r.label}</Badge></span><span className="block truncate text-xs text-muted">{r.email}</span></span>
                <Switch checked={r.active} onChange={() => toggle.mutate(r)} label="Active" />
                <button onClick={() => remove.mutate(r.id)} className="rounded-lg p-1.5 text-subtle hover:bg-danger-soft hover:text-danger" aria-label="Remove"><Trash2 className="size-4" /></button>
              </motion.div>
            ))}
          </AnimatePresence>
          {!q.data?.recipients.length && <p className="text-sm text-muted">Nobody added yet.</p>}
        </div>
        <div className="rounded-2xl border border-dashed border-line-strong p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_0.8fr]">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" />
            <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="email@company.com" type="email" />
            <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Label" />
          </div>
          <Button className="mt-2 w-full" variant="soft" icon={<Plus className="size-4" />} disabled={!f.name || !f.email} loading={add.isPending} onClick={() => add.mutate()}>Add recipient</Button>
        </div>
      </div>
    </Card>
  );
}

function CallingSettings({ value }: { value: any }) {
  const { meta } = useAuth();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = useSave("telephony");
  const modes = [
    { key: "phone_link", icon: <Smartphone className="size-5" />, title: "Phone Link", body: "Call pushes the number to the salesperson's phone (open /phone on it). They tap to dial on their own SIM and attach the recording from their phone's call recorder after the call. No telephony bill." },
    { key: "bridge", icon: <Phone className="size-5" />, title: "Bridge calling (recommended for recording)", body: "Exotel or Twilio rings the salesperson's phone first, then connects the prospect. Both sides are recorded automatically and land in the CRM — nothing for the rep to upload." },
    { key: "demo", icon: <Zap className="size-5" />, title: "Demo", body: "Simulated calls with sample conversations, for training and trying the CRM." },
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
      <Card spotlight={false}>
        <CardHeader title="How calls are placed" icon={<Phone className="size-4" />} />
        <div className="space-y-2.5 px-5 pb-5">
          {modes.map((m) => (
            <motion.button key={m.key} whileTap={{ scale: 0.99 }} onClick={() => setV({ ...v, mode: m.key })} className={cn("flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition", v.mode === m.key ? "border-brand-500 bg-accent-soft shadow-sm" : "border-line hover:border-line-strong")}>
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", v.mode === m.key ? "bg-brand-600 text-white" : "bg-sunken text-muted")}>{m.icon}</span>
              <span className="flex-1"><span className="flex items-center gap-2 text-sm font-bold text-fg">{m.title}{v.mode === m.key && <CheckCircle2 className="size-4 text-accent" />}</span><span className="mt-1 block text-[13px] text-muted">{m.body}</span>
                {m.key === "bridge" && <span className="mt-2 block"><Badge tone={meta?.bridgeReady ? "success" : "warning"}>{meta?.bridgeReady ? "Provider connected" : "Needs TELEPHONY_PROVIDER + Exotel/Twilio keys"}</Badge></span>}
              </span>
            </motion.button>
          ))}
        </div>
      </Card>
      <Card spotlight={false}>
        <CardHeader title="Recording notice & retention" icon={<ClipboardCheck className="size-4" />} />
        <Row title="Recording notice" body="Twilio bridge calls play it automatically; with Phone Link and Exotel it's shown to the salesperson to read out at the start."><Switch checked={v.consentNotice} onChange={(x) => setV({ ...v, consentNotice: x })} /></Row>
        <div className="border-t border-line px-5 py-4"><Field label="Notice text"><Textarea value={v.consentText} onChange={(e) => setV({ ...v, consentText: e.target.value })} className="min-h-16" /></Field></div>
        <Row title="Keep recordings for (days)" body="Older recordings are deleted nightly. 0 keeps them forever."><Input type="number" min={0} value={v.retentionDays} onChange={(e) => setV({ ...v, retentionDays: Number(e.target.value) })} className="w-28" /></Row>
        <div className="border-t border-line px-5 py-4"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(v)}>Save calling settings</Button></div>
      </Card>
    </div>
  );
}

function ChipEditor({ items, onChange, placeholder }: { items: string[]; onChange: (x: string[]) => void; placeholder: string }) {
  const [t, setT] = useState("");
  return (
    <div className="rounded-2xl border border-line-strong bg-surface p-2">
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {items.map((x) => (
            <motion.span key={x} layout initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex items-center gap-1 rounded-full bg-accent-soft py-1 pr-1 pl-3 text-xs font-semibold text-accent-soft-fg">
              {x}<button onClick={() => onChange(items.filter((i) => i !== x))} className="rounded-full p-0.5 hover:bg-white/50" aria-label={`Remove ${x}`}><X className="size-3" /></button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && t.trim()) { e.preventDefault(); onChange([...new Set([...items, t.trim().toLowerCase()])]); setT(""); } }} placeholder={placeholder} className="min-w-32 flex-1 bg-transparent px-2 py-1 text-sm text-fg outline-none" />
      </div>
    </div>
  );
}

function HrSettings({ value }: { value: any }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = useSave("hr");
  const status = useQuery({ queryKey: ["hr-status"], queryFn: () => api.get<any>("/integrations/hr/status") });
  const toast = useToast();
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card spotlight={false}>
        <CardHeader title="HR console connection" subtitle="Sales hires get a CRM login automatically" icon={<Link2 className="size-4" />} />
        <div className="space-y-4 px-5 pb-5">
          <div className={cn("flex items-center gap-3 rounded-2xl p-4", status.data?.configured ? "bg-success-soft" : "bg-warning-soft")}>
            <span className={cn("relative grid size-10 place-items-center rounded-xl text-white", status.data?.configured ? "bg-success" : "bg-warning")}>
              {status.data?.configured && <span className="absolute inset-0 animate-ping rounded-xl bg-success/40" />}
              <Link2 className="relative size-5" />
            </span>
            <div className="text-sm"><p className="font-semibold text-fg">{status.data?.configured ? "Connected" : "Not configured yet"}</p><p className="text-muted">{status.data?.configured ? `${status.data.provisioned} logins created from HR so far` : "Set HR_WEBHOOK_SECRET here and the same value as FOCUS_REALM_CRM_SECRET in the HR console."}</p></div>
          </div>
          <Field label="Endpoint for the HR console" hint="Signed with HMAC-SHA256 — the same scheme the HR console uses for the Workspace.">
            <div className="flex gap-2"><Input readOnly value={status.data?.endpoint ?? ""} className="font-mono text-xs" /><Button onClick={() => { navigator.clipboard?.writeText(status.data?.endpoint ?? ""); toast({ kind: "success", title: "Copied" }); }}>Copy</Button></div>
          </Field>
          <Field label="Departments / roles that get a CRM login" hint="Matched against the HR role's department and title. Press Enter to add.">
            <ChipEditor items={v.crmDepartments} onChange={(x) => setV({ ...v, crmDepartments: x })} placeholder="e.g. inside sales" />
          </Field>
          <Field label="Title keywords that make someone a sales head" hint="Everyone else from sales becomes a sales team member.">
            <ChipEditor items={v.headKeywords} onChange={(x) => setV({ ...v, headKeywords: x })} placeholder="e.g. lead" />
          </Field>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(v)}>Save HR settings</Button>
        </div>
      </Card>
      <Card spotlight={false}>
        <CardHeader title="Recent events from HR" icon={<RotateCcw className="size-4" />} />
        <div className="space-y-1.5 px-5 pb-5">
          {(status.data?.recent ?? []).length === 0 && <p className="text-sm text-muted">No events received yet.</p>}
          {(status.data?.recent ?? []).map((e: any) => (
            <div key={e.event_id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <Badge tone={e.result?.skipped ? "neutral" : e.type.includes("offboard") ? "danger" : "success"}>{e.type.replace("employee.", "")}</Badge>
              <span className="min-w-0 flex-1 truncate text-fg">{e.result?.user?.employeeCode ?? e.external_id}{e.result?.skipped ? ` — skipped (${e.result.reason?.replace(/_/g, " ")})` : ""}</span>
              <span className="text-xs text-subtle">{ago(e.received_at)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AllocationSettings({ value }: { value: any }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = useSave("allocation");
  const num = (k: string) => (e: ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  return (
    <Card spotlight={false} className="max-w-3xl">
      <CardHeader title="Allocation defaults" icon={<Shuffle className="size-4" />} />
      <Row title="Batch size per salesperson" body="Proposal default: 5–10."><Input type="number" min={1} value={v.batchSize} onChange={num("batchSize")} className="w-28" /></Row>
      <Row title="Maximum active prospects" body="Nobody is allocated above this."><Input type="number" min={1} value={v.maxActive} onChange={num("maxActive")} className="w-28" /></Row>
      <Row title="Inactivity threshold (days)" body="No calls for this long flags someone's prospects for review."><Input type="number" min={1} value={v.inactivityDays} onChange={num("inactivityDays")} className="w-28" /></Row>
      <Row title="Stale lead (days)" body="A prospect with no next action for this long counts as stale."><Input type="number" min={1} value={v.staleDays} onChange={num("staleDays")} className="w-28" /></Row>
      <Row title="Sales heads can reassign" body="Founders always can. A reason is always required."><Switch checked={v.headsCanReassign} onChange={(x) => setV({ ...v, headsCanReassign: x })} /></Row>
      <div className="border-t border-line px-5 py-4"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(v)}>Save allocation defaults</Button></div>
    </Card>
  );
}

function QualificationSettings({ value }: { value: any }) {
  const [fields, setFields] = useState<any[]>(value.fields);
  useEffect(() => setFields(value.fields), [value]);
  const save = useSave("qualification");
  return (
    <Card spotlight={false} className="max-w-3xl">
      <CardHeader title="Qualification checklist" subtitle="Required items must be ticked before a prospect can be handed to Legion" icon={<ClipboardCheck className="size-4" />} />
      <div className="space-y-2 px-5 pb-5">
        {fields.map((f, i) => (
          <motion.div key={f.key} layout className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
            <Input value={f.label} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-9" />
            <span className="flex items-center gap-2 text-xs font-semibold whitespace-nowrap text-muted">Required <Switch checked={f.required} onChange={(r) => setFields(fields.map((x, j) => (j === i ? { ...x, required: r } : x)))} /></span>
            <button onClick={() => setFields(fields.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-subtle hover:bg-danger-soft hover:text-danger" aria-label="Remove"><Trash2 className="size-4" /></button>
          </motion.div>
        ))}
        <Button variant="soft" icon={<Plus className="size-4" />} onClick={() => setFields([...fields, { key: `custom_${Date.now()}`, label: "New criterion", required: false }])}>Add criterion</Button>
        <div className="pt-2"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ fields })}>Save checklist</Button></div>
      </div>
    </Card>
  );
}

function SystemSettings() {
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.get<{ stats: any[]; failed: any[] }>("/jobs") });
  const retry = useMutation({ mutationFn: () => api.post<{ retried: number }>("/jobs/retry"), onSuccess: (r) => { toast({ kind: "success", title: `Retrying ${r.retried} jobs` }); qc.invalidateQueries({ queryKey: ["jobs"] }); } });
  const items = [
    ["AI analysis", meta?.aiConfigured ? "Claude (Anthropic API)" : "Demo heuristics — set ANTHROPIC_API_KEY", meta?.aiConfigured],
    ["Transcription", meta?.transcriptionConfigured ? "Deepgram (Hindi/English, diarised)" : "Set DEEPGRAM_API_KEY", meta?.transcriptionConfigured],
    ["Email", meta?.emailConfigured ? "SMTP" : "Outbox only — set SMTP_HOST/USER/PASS", meta?.emailConfigured],
    ["Recordings storage", meta?.storage === "supabase" ? "Supabase Storage (private bucket)" : "Local disk", meta?.storage === "supabase"],
    ["Database", meta?.database === "postgres" ? "Postgres (Supabase)" : "Embedded (development only)", meta?.database === "postgres"],
  ] as const;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card spotlight={false}>
        <CardHeader title="Integrations" icon={<Cpu className="size-4" />} />
        <div className="space-y-2 px-5 pb-5">
          {items.map(([l, d, ok]) => (
            <div key={l} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className={cn("size-2.5 rounded-full", ok ? "bg-success" : "bg-warning")} />
              <span className="w-36 text-sm font-semibold text-fg">{l}</span>
              <span className="text-sm text-muted">{d}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card spotlight={false}>
        <CardHeader title="Background jobs · 7 days" icon={<RotateCcw className="size-4" />} action={<Button size="sm" disabled={!jobs.data?.failed.length} loading={retry.isPending} onClick={() => retry.mutate()}>Retry failed</Button>} />
        <div className="px-5 pb-5">
          <div className="flex flex-wrap gap-1.5">{(jobs.data?.stats ?? []).map((s) => <Badge key={`${s.kind}-${s.status}`} tone={s.status === "failed" ? "danger" : s.status === "done" ? "success" : "brand"}>{s.kind} · {s.status} · {s.count}</Badge>)}</div>
          <div className="mt-3 space-y-1.5">{(jobs.data?.failed ?? []).map((j) => <p key={j.id} className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger"><b>{j.kind}</b> — {j.last_error}</p>)}</div>
        </div>
      </Card>
    </div>
  );
}
