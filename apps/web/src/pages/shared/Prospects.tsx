import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Contact as ContactIcon, Plus, Search, UploadCloud, Users } from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CallButton } from "../../components/call";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Skeleton, Tabs } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAuth, useIsManager } from "../../lib/auth";
import { ago, cn, fmtDateTime, label, OUTCOME_TONE, STAGES, STATUS_LABEL, STATUS_TONE } from "../../lib/format";
import type { Contact } from "../../lib/types";
import { ImportWizard } from "./ImportWizard";

export function Temperature({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-subtle">—</span>;
  const color = value >= 70 ? "from-orange-400 to-rose-500" : value >= 45 ? "from-amber-300 to-orange-400" : "from-sky to-brand-500";
  return (
    <span className="flex items-center gap-2" title={`Lead temperature ${value}/100`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-sunken">
        <motion.span className={cn("block h-full rounded-full bg-gradient-to-r", color)} initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.9 }} />
      </span>
      <span className="text-xs font-semibold text-muted tabular-nums">{value}</span>
    </span>
  );
}

export default function Prospects({ scope }: { scope: "mine" | "all" }) {
  const { user } = useAuth();
  const manager = useIsManager();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState(params.get("filter") === "new" ? "new" : "");
  const [campaign, setCampaign] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<"all" | "due" | "hot" | "unassigned">("all");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(params.get("import") === "1");
  const [adding, setAdding] = useState(false);
  const base = `/${user?.portal}`;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, stage, status, campaign, ownerId, sort, view]);

  const facets = useQuery({ queryKey: ["facets"], queryFn: () => api.get<any>("/contacts/facets") });
  const people = useQuery({ queryKey: ["users", "sales"], queryFn: () => api.get<{ users: any[] }>("/users"), enabled: scope === "all" });
  const list = useQuery({
    queryKey: ["contacts", scope, debounced, stage, status, campaign, ownerId, sort, view, page],
    queryFn: () =>
      api.get<{ total: number; rows: Contact[] }>(
        `/contacts${qs({
          q: debounced, stage, status, campaign, ownerId, page, pageSize: 40,
          sort: view === "hot" ? "temperature" : view === "due" ? "next_action" : sort,
          due: view === "due" ? "today" : undefined,
          unassigned: view === "unassigned" || undefined,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.rows ?? [];
  const pages = Math.ceil((list.data?.total ?? 0) / 40);

  return (
    <div>
      <PageHeader
        eyebrow={scope === "all" ? "Database" : "Sales Team"}
        title={scope === "all" ? "Prospect database" : "My prospects"}
        subtitle={`${(list.data?.total ?? 0).toLocaleString("en-IN")} prospects${scope === "mine" ? " assigned to you" : ""}`}
        actions={
          <>
            {manager && scope === "all" && (
              <Button variant="soft" icon={<UploadCloud className="size-4" />} onClick={() => setImporting(true)}>Import CSV</Button>
            )}
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add prospect</Button>
          </>
        }
      />

      <Card className="mb-4 p-3" spotlight={false}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1"><Input icon={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, phone, email, city…" /></div>
          <div className="flex flex-wrap gap-2">
            <Select value={stage} onChange={(e) => setStage(e.target.value)} className="w-auto min-w-36">
              <option value="">All stages</option>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-40">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="w-auto min-w-40">
              <option value="">All campaigns</option>
              {(facets.data?.campaigns ?? []).filter((c: any) => c.value).map((c: any) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}
            </Select>
            {scope === "all" && (
              <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-auto min-w-40">
                <option value="">Any owner</option>
                {(people.data?.users ?? []).filter((u) => ["sales_rep", "sales_head"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </Select>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs
            size="sm"
            value={view}
            onChange={setView}
            items={[
              { value: "all", label: "Everything" },
              { value: "due", label: "Due today" },
              { value: "hot", label: "🔥 Hottest" },
              ...(scope === "all" ? [{ value: "unassigned" as const, label: "Unassigned" }] : []),
            ]}
          />
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="h-8 w-auto text-xs">
            <option value="recent">Recently updated</option>
            <option value="name">Name A–Z</option>
            <option value="next_action">Next action</option>
            <option value="temperature">Temperature</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden" spotlight={false}>
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : rows.length === 0 ? (
          <Empty icon={<ContactIcon className="size-6" />} title="No prospects match" body={scope === "mine" ? "New prospects appear here the moment your sales head allocates them." : "Try clearing a filter, or import your database."} />
        ) : (
          <>
            {/* desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-sunken/70 text-xs text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Prospect</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 font-semibold">Temperature</th>
                    <th className="px-3 py-3 font-semibold">Last call</th>
                    <th className="px-3 py-3 font-semibold">Next action</th>
                    {scope === "all" && <th className="px-3 py-3 font-semibold">Owner</th>}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {rows.map((c, i) => (
                      <motion.tr
                        key={c.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 20) * 0.015 }}
                        className="group border-b border-line last:border-0 hover:bg-surface-hover"
                      >
                        <td className="px-4 py-2.5">
                          <Link to={`${base}/contacts/${c.id}`} className="flex items-center gap-3">
                            <Avatar name={c.full_name} hue={200 + (c.full_name.length * 9) % 40} size={34} />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-fg group-hover:text-accent">{c.full_name}</span>
                              <span className="block truncate text-xs text-muted">{c.designation ? `${c.designation} · ` : ""}{c.company_name ?? "—"}{c.city ? ` · ${c.city}` : ""}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-start gap-1">
                            <Badge tone={STATUS_TONE[c.status] ?? "neutral"} dot>{label(c.status)}</Badge>
                            {c.stage !== "prospect" && <span className="text-[11px] font-semibold text-accent">{label(c.stage)}</span>}
                            {c.do_not_contact && <Badge tone="danger">DNC</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5"><Temperature value={c.temperature} /></td>
                        <td className="px-3 py-2.5">
                          {c.last_call_outcome ? (
                            <div><Badge tone={OUTCOME_TONE[c.last_call_outcome] ?? "neutral"}>{label(c.last_call_outcome)}</Badge><p className="mt-0.5 text-[11px] text-subtle">{ago(c.last_contacted_at)} · {c.call_count} calls</p></div>
                          ) : <span className="text-xs text-subtle">Never called</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {c.next_task_at ? (
                            <span className={cn("font-semibold", new Date(c.next_task_at) < new Date() ? "text-danger" : "text-fg")}>{fmtDateTime(c.next_task_at)}</span>
                          ) : <span className="text-subtle">—</span>}
                        </td>
                        {scope === "all" && (
                          <td className="px-3 py-2.5">
                            {c.owner_name ? <span className="flex items-center gap-2 text-xs font-medium text-fg"><Avatar name={c.owner_name} hue={c.owner_hue} size={22} />{c.owner_name.split(" ")[0]}</span> : <Badge tone="warning">Unassigned</Badge>}
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-right">
                          {(scope === "mine" || c.owner_id === user?.id || manager) && <CallButton size="sm" contact={c} />}
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
            {/* mobile cards */}
            <div className="divide-y divide-line md:hidden">
              {rows.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3">
                  <Link to={`${base}/contacts/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={c.full_name} size={38} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-fg">{c.full_name}</span>
                      <span className="block truncate text-xs text-muted">{c.company_name ?? "—"}</span>
                      <span className="mt-1 flex gap-1"><Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{label(c.status)}</Badge></span>
                    </span>
                  </Link>
                  <CallButton size="sm" contact={c} label="" />
                </div>
              ))}
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
                <span className="text-muted">Page {page} of {pages}</span>
                <div className="flex gap-2">
                  <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <ImportWizard open={importing} onClose={() => { setImporting(false); if (params.get("import")) setParams({}); }} />
      <AddProspect open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddProspect({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ full_name: "", company: "", designation: "", phone: "", email: "", city: "", campaign: "", segment: "" });
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api.post("/contacts", { ...f, email: f.email || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast({ kind: "success", title: `${f.full_name} added` });
      setF({ full_name: "", company: "", designation: "", phone: "", email: "", city: "", campaign: "", segment: "" });
      onClose();
    },
    onError: (e) => toast({ kind: "error", title: "Couldn't add", body: (e as Error).message }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Add a prospect" icon={<Users className="size-5" />} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.full_name || !f.phone} onClick={() => save.mutate()}>Add prospect</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name *"><Input value={f.full_name} onChange={set("full_name")} autoFocus /></Field>
        <Field label="Phone *"><Input value={f.phone} onChange={set("phone")} placeholder="+91 98765 43210" /></Field>
        <Field label="Company"><Input value={f.company} onChange={set("company")} /></Field>
        <Field label="Designation"><Input value={f.designation} onChange={set("designation")} /></Field>
        <Field label="Email"><Input value={f.email} onChange={set("email")} type="email" /></Field>
        <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="Campaign"><Input value={f.campaign} onChange={set("campaign")} /></Field>
        <Field label="Segment"><Input value={f.segment} onChange={set("segment")} /></Field>
      </div>
    </Modal>
  );
}

