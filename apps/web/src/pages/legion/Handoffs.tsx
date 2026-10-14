import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, CheckCircle2, Handshake, Inbox, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { celebrate } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, Empty, Field, Modal, PageHeader, Select, Skeleton, Tabs, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago } from "../../lib/format";
import { Temperature } from "../shared/Prospects";

/** Qualified prospects handed over by the sales team: accept or return with a reason. */
export default function Handoffs() {
  const [status, setStatus] = useState<"pending" | "accepted" | "returned">("pending");
  const q = useQuery({ queryKey: ["handoffs", status], queryFn: () => api.get<{ handoffs: any[] }>(`/handoffs?status=${status}`) });
  return (
    <div>
      <PageHeader eyebrow="Legion" title="Handoff inbox" subtitle="Accept a qualified prospect into Legion Meet 1, or send it back to the salesperson with a reason." actions={<Tabs value={status} onChange={setStatus} items={[{ value: "pending", label: "Waiting" }, { value: "accepted", label: "Accepted" }, { value: "returned", label: "Returned" }]} />} />
      {q.isLoading ? <Skeleton className="h-64" /> : !q.data?.handoffs.length ? (
        <Card><Empty icon={<Inbox className="size-6" />} title={status === "pending" ? "Inbox zero 🎯" : "Nothing here"} body={status === "pending" ? "New handoffs land here the moment a salesperson submits one." : undefined} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AnimatePresence>
            {q.data.handoffs.map((h, i) => <HandoffCard key={h.id} h={h} i={i} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export function HandoffCard({ h, i, compact }: { h: any; i: number; compact?: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [owner, setOwner] = useState("");
  const legion = useQuery({ queryKey: ["users", "legion"], queryFn: () => api.get<{ users: any[] }>("/users?role=legion"), enabled: h.status === "pending" });
  const decide = useMutation({
    mutationFn: (decision: "accept" | "return") => api.post(`/handoffs/${h.id}/decision`, { decision, reason: decision === "return" ? reason : null, legionUserId: owner || null }),
    onSuccess: (_d, decision) => {
      if (decision === "accept") celebrate();
      toast({ kind: decision === "accept" ? "success" : "info", title: decision === "accept" ? `${h.contact_name} accepted — book Legion Meet 1` : "Returned to the salesperson" });
      setReturning(false);
      qc.invalidateQueries({ queryKey: ["handoffs"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
    },
    onError: (e) => toast({ kind: "error", title: "Couldn't do that", body: (e as Error).message }),
  });
  const base = `/${user?.portal}`;
  const checks = Object.entries(h.checklist ?? {});
  return (
    <motion.div layout initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 80 }} transition={{ delay: i * 0.05 }}>
      <Card className="h-full overflow-hidden" spotlight>
        <div className="relative p-5">
          <div className="flex items-start gap-3">
            <span className="relative grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-brand">
              {h.status === "pending" && <span className="absolute -top-1 -right-1 size-3 animate-ping rounded-full bg-sky" />}
              <Handshake className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Link to={`${base}/contacts/${h.contact_id}`} className="block truncate text-base font-bold text-fg hover:text-accent">{h.contact_name}</Link>
              <p className="truncate text-sm text-muted">{h.designation ? `${h.designation} · ` : ""}{h.company_name ?? "—"}</p>
            </div>
            <Temperature value={h.temperature} />
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted"><Avatar name={h.from_name ?? "?"} hue={h.from_hue} size={20} /> from <b className="text-fg">{h.from_name}</b> · {ago(h.created_at)}</div>
          {h.note && <p className="mt-3 rounded-xl bg-sunken/70 p-3 text-sm text-fg">“{h.note}”</p>}
          {!compact && h.last_summary && <p className="mt-3 flex gap-2 text-[13px] text-muted"><Bot className="mt-0.5 size-4 shrink-0 text-accent" />{h.last_summary}</p>}
          {!compact && checks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">{checks.map(([k, v]) => <Badge key={k} tone={v ? "success" : "neutral"}>{v ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}{k}</Badge>)}</div>
          )}
          {h.status === "returned" && h.return_reason && <p className="mt-3 text-sm text-danger">Returned: {h.return_reason}</p>}
          {h.status === "pending" && (user?.role === "legion" || user?.role === "founder") && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {user.role === "founder" && (
                <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-8.5 w-auto text-[13px]">
                  <option value="">Assign to Legion…</option>
                  {(legion.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </Select>
              )}
              <Button size="sm" variant="success" icon={<Check className="size-4" />} loading={decide.isPending && decide.variables === "accept"} onClick={() => decide.mutate("accept")}>Accept</Button>
              <Button size="sm" icon={<Undo2 className="size-4" />} onClick={() => setReturning(true)}>Return</Button>
            </div>
          )}
        </div>
      </Card>
      <Modal open={returning} onClose={() => setReturning(false)} title={`Return ${h.contact_name}`} subtitle="The salesperson sees your reason and keeps working the prospect." icon={<Undo2 className="size-5" />} footer={<><Button variant="ghost" onClick={() => setReturning(false)}>Cancel</Button><Button variant="primary" disabled={reason.trim().length < 3} loading={decide.isPending} onClick={() => decide.mutate("return")}>Return with reason</Button></>}>
        <Field label="Why?"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Decision-maker not confirmed — please get the MD on a call first" /></Field>
      </Modal>
    </motion.div>
  );
}
