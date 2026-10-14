import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CalendarCheck, CalendarX, CheckCircle2, MapPin, UserX } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { celebrate } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Skeleton, Tabs, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtDate, fmtTime, label } from "../../lib/format";

/** Legion Meet 1 & 2 — the agenda and their outcomes. */
export default function Meetings() {
  const { user } = useAuth();
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  const [mine, setMine] = useState(user?.role === "legion");
  const now = new Date().toISOString();
  const q = useQuery({
    queryKey: ["meetings", view, mine],
    queryFn: () => api.get<{ meetings: any[] }>(`/meetings?${view === "upcoming" ? `from=${encodeURIComponent(new Date(Date.now() - 3 * 3600_000).toISOString())}` : `to=${encodeURIComponent(now)}`}${mine ? "&mine=1" : ""}`),
  });
  const groups = new Map<string, any[]>();
  for (const m of view === "past" ? [...(q.data?.meetings ?? [])].reverse() : q.data?.meetings ?? []) {
    const k = fmtDate(m.scheduled_at, { weekday: "long", day: "numeric", month: "long" });
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }
  return (
    <div>
      <PageHeader eyebrow="Legion" title="Legion meetings" subtitle="Meet 1 and Meet 2 for every handed-off prospect." actions={<><Tabs value={view} onChange={setView} items={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]} />{user?.role === "legion" && <Tabs value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} items={[{ value: "mine", label: "Mine" }, { value: "all", label: "Team" }]} />}</>} />
      {q.isLoading ? <Skeleton className="h-64" /> : groups.size === 0 ? <Card><Empty icon={<CalendarCheck className="size-6" />} title="No meetings" body="Book Legion Meet 1 from an accepted handoff." /></Card> : (
        <div className="space-y-6">
          {[...groups.entries()].map(([day, ms], gi) => (
            <motion.section key={day} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * 0.06 }}>
              <h2 className="mb-2 text-xs font-bold tracking-[0.12em] text-muted uppercase">{day}</h2>
              <div className="space-y-2">{ms.map((m) => <MeetingRow key={m.id} m={m} />)}</div>
            </motion.section>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingRow({ m }: { m: any }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [closing, setClosing] = useState<null | "completed" | "no_show" | "cancelled">(null);
  const [outcome, setOutcome] = useState("");
  const update = useMutation({
    mutationFn: () => api.patch(`/meetings/${m.id}`, { status: closing, outcome: outcome || null }),
    onSuccess: () => {
      if (closing === "completed") celebrate();
      toast({ kind: "success", title: "Meeting updated" });
      setClosing(null);
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
  const base = `/${user?.portal}`;
  return (
    <Card className="flex flex-wrap items-center gap-4 p-4" hover>
      <div className="w-16 text-center">
        <p className="text-lg font-bold text-fg">{fmtTime(m.scheduled_at)}</p>
        <p className="text-[11px] text-muted">{m.duration_min} min</p>
      </div>
      <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 text-xs font-black text-white shadow-brand">{m.stage === "legion_meet_1" ? "M1" : "M2"}</span>
      <div className="min-w-0 flex-1">
        <Link to={`${base}/contacts/${m.contact_id}`} className="block truncate font-semibold text-fg hover:text-accent">{m.contact_name} <span className="font-normal text-muted">· {m.company_name}</span></Link>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">{label(m.stage)} · {m.legion_name ?? "Legion"} · from {m.sales_name ?? "—"}{m.location && <span className="flex items-center gap-1"><MapPin className="size-3" />{m.location}</span>}</p>
        {m.outcome && <p className="mt-1 text-xs text-fg">{m.outcome}</p>}
      </div>
      <Badge tone={m.status === "completed" ? "success" : m.status === "scheduled" ? "brand" : "neutral"}>{m.status.replace("_", " ")}</Badge>
      {m.status === "scheduled" && (user?.role === "legion" || user?.role === "founder") && (
        <div className="flex gap-1.5">
          <Button size="sm" variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => setClosing("completed")}>Held</Button>
          <Button size="sm" icon={<UserX className="size-4" />} onClick={() => setClosing("no_show")}>No-show</Button>
          <Button size="sm" variant="ghost" icon={<CalendarX className="size-4" />} onClick={() => setClosing("cancelled")} />
        </div>
      )}
      <Modal open={Boolean(closing)} onClose={() => setClosing(null)} title={closing === "completed" ? "How did the meeting go?" : closing === "no_show" ? "Mark as no-show" : "Cancel meeting"} footer={<><Button variant="ghost" onClick={() => setClosing(null)}>Back</Button><Button variant="primary" loading={update.isPending} onClick={() => update.mutate()}>Save</Button></>}>
        <Field label="Outcome / notes"><Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={closing === "completed" ? "e.g. Wants proposal for phase 1; book Meet 2 with MD next week" : ""} /></Field>
      </Modal>
    </Card>
  );
}
