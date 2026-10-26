import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Repeat, Shuffle, UploadCloud, Wand2 } from "lucide-react";
import { useCallback, useState } from "react";
import { celebrate, Counter } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Field, Input, Modal, Progress, Select, Switch } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { cn } from "../../lib/format";
import { readXlsx } from "../../lib/xlsx";

/**
 * Import the contact database from Excel (.xlsx) or CSV (Google Sheets:
 * File → Download → .xlsx or .csv).
 * Columns are matched automatically and can be corrected; rows go up in
 * chunks so very large files work on serverless hosting too. The server
 * validates and de-duplicates (by phone, then email) and reports every
 * skipped row with its reason.
 */

const FIELDS = [
  { key: "full_name", label: "Name", required: true, guess: ["name", "full name", "contact", "contact name", "person"] },
  { key: "phone", label: "Phone", required: true, guess: ["phone", "mobile", "number", "contact number", "phone number", "mobile number", "whatsapp"] },
  { key: "company", label: "Company", guess: ["company", "organisation", "organization", "business", "firm", "account"] },
  { key: "designation", label: "Designation", guess: ["designation", "title", "role", "position", "job title"] },
  { key: "email", label: "Email", guess: ["email", "e-mail", "mail", "email id"] },
  { key: "city", label: "City", guess: ["city", "location", "town", "area"] },
  { key: "industry", label: "Industry", guess: ["industry", "sector", "vertical"] },
  { key: "segment", label: "Segment", guess: ["segment", "category", "type"] },
  { key: "campaign", label: "Campaign", guess: ["campaign", "list"] },
  { key: "source", label: "Source", guess: ["source", "lead source", "channel"] },
  { key: "alt_phone", label: "Alt. phone", guess: ["alternate", "alt phone", "landline", "phone 2"] },
  { key: "website", label: "Website", guess: ["website", "url", "site", "domain"] },
  { key: "notes", label: "Notes", guess: ["notes", "remarks", "comment", "comments"] },
] as const;

type Mapping = Record<string, string>;

/** A ready-to-fill template with every column the CRM understands. Opens in Excel. */
export function downloadTemplate() {
  const header = FIELDS.map((f) => f.label);
  const examples = [
    ["Rahul Sharma", "+91 98765 43210", "Sharma Textiles", "Owner", "rahul@sharmatextiles.in", "Surat", "Textiles", "SME", "Q4 Distributors", "Trade fair", "", "sharmatextiles.in", "Met at the Surat expo"],
    ["Priya Nair", "9876501234", "Nair Logistics", "Operations Head", "priya@nairlogistics.com", "Kochi", "Logistics", "Mid-market", "Q4 Distributors", "LinkedIn", "0484 2345678", "", ""],
  ];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [header, ...examples].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "focus-realm-contacts-template.csv" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const CHUNK = 1500;

function autoMap(headers: string[]): Mapping {
  const m: Mapping = {};
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  for (const f of FIELDS) {
    const hit = headers.find((h) => f.guess.some((g) => norm(h) === g)) ?? headers.find((h) => f.guess.some((g) => norm(h).includes(g)));
    if (hit && !Object.values(m).includes(hit)) m[f.key] = hit;
  }
  return m;
}

export function ImportWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Mapping>({});
  const [campaign, setCampaign] = useState("");
  const [segment, setSegment] = useState("");
  const [source, setSource] = useState("Database import");
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ total: number; created: number; duplicates: number; invalid: number; withoutPhone: number; issues: { row: number; reason: string; name?: string }[] } | null>(null);

  const reset = () => {
    setFile(null);
    setRows([]);
    setHeaders([]);
    setMap({});
    setProgress(null);
    setResult(null);
  };

  const load = useCallback((f: File) => {
    const name = f.name.toLowerCase();
    if (name.endsWith(".xls")) {
      toast({ kind: "error", title: "Old Excel format", body: "Open it in Excel and save as .xlsx (or .csv), then import that." });
      return;
    }
    setFile(f);
    setResult(null);
    if (name.endsWith(".xlsx")) {
      readXlsx(f)
        .then(({ headers: hs, rows: rs }) => {
          setHeaders(hs);
          setRows(rs);
          setMap(autoMap(hs));
        })
        .catch((e) => {
          setFile(null);
          toast({ kind: "error", title: "Couldn't read that Excel file", body: (e as Error).message });
        });
      return;
    }
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        setHeaders(hs);
        setRows(res.data);
        setMap(autoMap(hs));
      },
      error: (err) => toast({ kind: "error", title: "Couldn't read that file", body: err.message }),
    });
  }, [toast]);

  const ready = map.full_name && map.phone && rows.length > 0;

  const run = async () => {
    const mapped = rows.map((r) => {
      const o: Record<string, string | null> = {};
      for (const f of FIELDS) if (map[f.key]) o[f.key] = (r[map[f.key]] ?? "").toString().trim() || null;
      return { ...o, full_name: o.full_name ?? "" };
    });
    const total = { total: 0, created: 0, duplicates: 0, invalid: 0, withoutPhone: 0, issues: [] as { row: number; reason: string; name?: string }[] };
    setProgress(0);
    try {
      for (let i = 0; i < mapped.length; i += CHUNK) {
        const part = mapped.slice(i, i + CHUNK);
        const parts = Math.ceil(mapped.length / CHUNK);
        const r = await api.post<typeof total>("/imports", {
          fileName: parts > 1 ? `${file?.name} (part ${i / CHUNK + 1}/${parts})` : file?.name,
          campaign: campaign || null,
          segment: segment || null,
          source: source || null,
          rows: part,
        });
        total.total += r.total;
        total.created += r.created;
        total.duplicates += r.duplicates;
        total.withoutPhone += r.withoutPhone ?? 0;
        total.invalid += r.invalid;
        total.issues.push(...r.issues.map((x) => ({ ...x, row: x.row + i })));
        setProgress(Math.round(((i + part.length) / mapped.length) * 100));
      }
      setResult(total);
      if (total.created) celebrate();
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["facets"] });
    } catch (e) {
      toast({ kind: "error", title: "Import stopped", body: (e as Error).message });
      setProgress(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        setTimeout(reset, 300);
      }}
      size="xl"
      icon={<FileSpreadsheet className="size-5" />}
      title="Import your contact database"
      subtitle="Excel (.xlsx) or CSV · duplicates and invalid numbers are caught automatically"
      footer={
        result ? (
          <Button variant="primary" onClick={() => { onClose(); setTimeout(reset, 300); }}>Done</Button>
        ) : (
          <>
            {file && <Button variant="ghost" onClick={reset}>Choose another file</Button>}
            <Button variant="primary" disabled={!ready || progress != null} loading={progress != null && !result} onClick={run} icon={<UploadCloud className="size-4" />}>
              Import {rows.length ? rows.length.toLocaleString("en-IN") : ""} rows
            </Button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait">
        {!file && (
          <motion.label
            key="drop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) load(f);
            }}
            className={cn("relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed px-6 py-16 text-center transition", drag ? "border-brand-500 bg-accent-soft" : "border-line-strong bg-sunken/60 hover:border-brand-400")}
          >
            <input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
            <motion.div animate={{ y: drag ? -8 : [0, -6, 0] }} transition={{ duration: drag ? 0.2 : 2.6, repeat: drag ? 0 : Infinity }} className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-brand">
              <UploadCloud className="size-8" />
            </motion.div>
            <p className="mt-4 text-base font-bold text-fg">Drop your Excel or CSV file here, or click to choose</p>
            <p className="mt-1 text-sm text-muted">Needs at least a name and a phone column — any column names work, they're matched automatically.</p>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadTemplate(); }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-1.5 text-xs font-semibold text-accent shadow-xs ring-1 ring-line hover:ring-brand-300"
            >
              <Download className="size-3.5" /> Download the template
            </button>
          </motion.label>
        )}

        {file && !result && (
          <motion.div key="map" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-sunken/60 p-3">
              <FileSpreadsheet className="size-5 text-accent" />
              <span className="text-sm font-semibold text-fg">{file.name}</span>
              <Badge tone="brand">{rows.length.toLocaleString("en-IN")} rows</Badge>
              <Badge tone="neutral">{headers.length} columns</Badge>
              <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-accent"><Wand2 className="size-3.5" /> Columns matched automatically</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f, i) => (
                <motion.div key={f.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                  <Field label={`${f.label}${"required" in f && f.required ? " *" : ""}`}>
                    <Select value={map[f.key] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value }))} className={cn("required" in f && f.required && !map[f.key] && "border-danger")}>
                      <option value="">— not in file —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </Field>
                </motion.div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Campaign" hint="Applied where the file has none"><Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. Q4 Distributors — NCR" /></Field>
              <Field label="Segment"><Input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="e.g. Healthcare" /></Field>
              <Field label="Source"><Input value={source} onChange={(e) => setSource(e.target.value)} /></Field>
            </div>

            <div>
              <p className="mb-2 text-[13px] font-semibold text-fg">Preview</p>
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-sunken text-muted">
                    <tr>{FIELDS.filter((f) => map[f.key]).map((f) => <th key={f.key} className="px-3 py-2 font-semibold whitespace-nowrap">{f.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {FIELDS.filter((f) => map[f.key]).map((f) => <td key={f.key} className="max-w-48 truncate px-3 py-2 text-fg">{r[map[f.key]]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {progress != null && (
              <div>
                <div className="mb-1 flex justify-between text-xs font-semibold text-muted"><span>Importing & de-duplicating…</span><span>{progress}%</span></div>
                <Progress value={progress} height={8} />
              </div>
            )}
          </motion.div>
        )}

        {result && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="space-y-5">
            <div className="flex flex-col items-center py-4 text-center">
              <motion.div initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="grid size-16 place-items-center rounded-full bg-success text-white shadow-lg">
                <CheckCircle2 className="size-9" />
              </motion.div>
              <p className="mt-3 text-xl font-bold text-fg"><Counter value={result.created} /> prospects added</p>
              <p className="text-sm text-muted">{result.created ? `Now hand them to the sales team.${result.withoutPhone ? ` ${result.withoutPhone.toLocaleString()} have no valid number yet — find them under Prospects and add one before calling.` : ""}` : "Nothing new — every row was already in the CRM or couldn't be used."}</p>
            </div>
            <AllocateNow />
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Rows read", result.total, "brand"],
                ["Duplicates skipped", result.duplicates, "warning"],
                result.invalid ? ["Empty rows skipped", result.invalid, "danger"] : ["Added without a number", result.withoutPhone, "warning"],
              ].map(([l, v, t]) => (
                <div key={l as string} className="rounded-2xl border border-line bg-surface p-4 text-center">
                  <p className={cn("text-2xl font-bold", t === "warning" ? "text-warning" : t === "danger" ? "text-danger" : "text-fg")}><Counter value={v as number} /></p>
                  <p className="text-xs text-muted">{l}</p>
                </div>
              ))}
            </div>
            {result.issues.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg"><AlertTriangle className="size-4 text-warning" /> Skipped rows</p>
                <div className="max-h-56 overflow-y-auto rounded-2xl border border-line">
                  {result.issues.map((x, i) => (
                    <div key={i} className="flex gap-3 border-b border-line px-3 py-2 text-xs last:border-0">
                      <span className="w-14 shrink-0 font-mono text-muted">Row {x.row}</span>
                      <span className="min-w-0 flex-1 truncate text-fg">{x.name ?? "—"}</span>
                      <span className="text-muted">{x.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

/**
 * Right after an import: fill everyone's book now, and keep topping them up
 * every morning from what's left — so a big list (thousands of leads) flows
 * to the team at a pace they can actually call.
 */
function AllocateNow() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const founder = user?.role === "founder";
  const o = useQuery({
    queryKey: ["allocation-overview"],
    queryFn: () => api.get<{ pool: number; room: number; people: { id: string; full_name: string; avatar_hue: number; active: number }[]; settings: { maxActive: number; batchSize: number; autoEnabled: boolean; autoTime: string } }>("/allocation/overview"),
  });
  const [done, setDone] = useState<number | null>(null);
  const run = useMutation({
    mutationFn: () => api.post<{ assigned: number }>("/allocation/run", { userIds: o.data!.people.map((p) => p.id), batchSize: Math.min(100, o.data!.settings.maxActive) }),
    onSuccess: (r) => { setDone(r.assigned); if (r.assigned) celebrate(); qc.invalidateQueries(); },
    onError: (e) => toast({ kind: "error", title: "Couldn't allocate", body: (e as Error).message }),
  });
  const auto = useMutation({
    mutationFn: (on: boolean) => api.put("/settings/allocation", { autoEnabled: on }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["allocation-overview"] }); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => toast({ kind: "error", title: "Couldn't change it", body: (e as Error).message }),
  });
  if (!o.data) return null;
  const d = o.data;
  const now = Math.min(d.pool, d.room);
  return (
    <div className="space-y-3 rounded-2xl border border-brand-200 bg-accent-soft/40 p-4 dark:border-brand-900">
      <div className="flex items-center gap-2">
        <Shuffle className="size-4 text-accent" />
        <p className="text-sm font-bold text-fg">Allocate to the sales team</p>
        <span className="ml-auto flex -space-x-2">{d.people.slice(0, 6).map((p) => <Avatar key={p.id} name={p.full_name} hue={p.avatar_hue} size={26} className="ring-2 ring-surface" />)}</span>
      </div>
      {d.people.length === 0 ? (
        <p className="text-sm text-muted">No active salespeople yet — they arrive from the HR console. The prospects wait safely in the database until then.</p>
      ) : done != null ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="size-4" /> {done.toLocaleString("en-IN")} prospects allocated — everyone has been notified.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            <b className="text-fg">{d.pool.toLocaleString("en-IN")}</b> unassigned prospects · <b className="text-fg">{d.people.length}</b> salespeople with room for <b className="text-fg">{d.room.toLocaleString("en-IN")}</b> right now (max {d.settings.maxActive} active each). Fair, randomised split; nobody goes over their limit.
          </p>
          {now ? (
            <Button variant="primary" icon={<Shuffle className="size-4" />} loading={run.isPending} onClick={() => run.mutate()}>
              Allocate {now.toLocaleString("en-IN")} now
            </Button>
          ) : (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-fg">
              Everyone already has {d.settings.maxActive} active prospects, the most allowed. Switch on the morning top-up below so new ones flow in as they work through their lists
              {founder ? <> — or <a href="/founder/settings?tab=allocation" className="font-semibold text-accent hover:underline">raise the limit</a>.</> : "."}
            </p>
          )}
        </>
      )}
      <div className="flex items-start gap-3 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-line">
        <Repeat className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">Top everyone up every morning</p>
          <p className="text-xs text-muted">At {d.settings.autoTime}, Mon–Sat, each salesperson gets up to {d.settings.batchSize} new prospects from what's left{founder ? "" : " (founders can switch this on)"}.</p>
        </div>
        <Switch checked={d.settings.autoEnabled} disabled={!founder || auto.isPending} onChange={(v) => auto.mutate(v)} label="Morning top-up" />
      </div>
    </div>
  );
}
