import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud, Wand2 } from "lucide-react";
import { useCallback, useState } from "react";
import { celebrate, Counter } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Badge, Button, Field, Input, Modal, Progress, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/format";

/**
 * Import the contact database from a CSV (export Excel/Google Sheets as CSV).
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
  const [result, setResult] = useState<{ total: number; created: number; duplicates: number; invalid: number; issues: { row: number; reason: string; name?: string }[] } | null>(null);

  const reset = () => {
    setFile(null);
    setRows([]);
    setHeaders([]);
    setMap({});
    setProgress(null);
    setResult(null);
  };

  const load = useCallback((f: File) => {
    setFile(f);
    setResult(null);
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
    const total = { total: 0, created: 0, duplicates: 0, invalid: 0, issues: [] as { row: number; reason: string; name?: string }[] };
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
      subtitle="CSV from Excel or Google Sheets · duplicates and invalid numbers are caught automatically"
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
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
            <motion.div animate={{ y: drag ? -8 : [0, -6, 0] }} transition={{ duration: drag ? 0.2 : 2.6, repeat: drag ? 0 : Infinity }} className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-brand">
              <UploadCloud className="size-8" />
            </motion.div>
            <p className="mt-4 text-base font-bold text-fg">Drop your CSV here, or click to choose</p>
            <p className="mt-1 text-sm text-muted">Needs at least a name and a phone column. Excel? File → Save As → CSV.</p>
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
              <p className="text-sm text-muted">Ready to allocate to the sales team.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Rows read", result.total, "brand"],
                ["Duplicates skipped", result.duplicates, "warning"],
                ["Invalid skipped", result.invalid, "danger"],
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
