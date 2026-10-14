import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft, Ban, Bot, Building2, CalendarClock, CalendarPlus, Check, CheckCircle2, Copy, Handshake, History, Mail, MapPin,
  MessageSquare, Phone, PhoneCall, Send, Shuffle, Sparkles, Swords, Trophy, UserRound, XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CallButton } from "../../components/call";
import { ScoreRing } from "../../components/charts";
import { celebrate } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, Empty, Field, Input, Modal, Select, Skeleton, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth, useIsManager } from "../../lib/auth";
import { ago, cn, duration, fmtDateTime, label, localInput, OUTCOME_TONE, scoreTone, STAGES, STATUS_TONE } from "../../lib/format";
import type { Contact } from "../../lib/types";
import { Temperature } from "./Prospects";

const FLOW = [
  { key: "new", label: "Prospect" },
  { key: "outreach", label: "Outreach" },
  { key: "follow_up", label: "Follow-up" },
  { key: "qualification_review", label: "Qualification review" },
  { key: "qualified", label: "Qualified" },
  { key: "handoff_pending", label: "Handoff" },
];

const KIND_ICON: Record<string, typeof Phone> = {
  call: PhoneCall, note: MessageSquare, status: History, stage: Swords, assignment: Shuffle, task: CalendarClock,
  handoff: Handshake, meeting: CalendarPlus, ai: Sparkles, created: UserRound, qualification: CheckCircle2, closed: Trophy, dnc: Ban,
};

export default function ContactDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const manager = useIsManager();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/${user?.portal}`;
  const [note, setNote] = useState("");
  const [modal, setModal] = useState<null | "followup" | "status" | "handoff" | "reassign" | "meeting" | "close">(null);

  const q = useQuery({ queryKey: ["contact", id], queryFn: () => api.get<any>(`/contacts/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contact", id] });
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
  };
  const patch = useMutation({
    mutationFn: (body: any) => api.patch(`/contacts/${id}`, body),
    onSuccess: refresh,
    onError: (e) => toast({ kind: "error", title: "Couldn't save", body: (e as Error).message }),
  });
  const addNote = useMutation({
    mutationFn: () => api.post(`/contacts/${id}/notes`, { body: note }),
    onSuccess: () => { setNote(""); refresh(); },
  });
  const completeTask = useMutation({ mutationFn: (tid: string) => api.patch(`/tasks/${tid}`, { status: "done" }), onSuccess: refresh });

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-48" /><Skeleton className="h-96" /></div>;
  if (q.error) return <Empty icon={<UserRound className="size-6" />} title="Can't open this prospect" body={(q.error as Error).message} action={<Button onClick={() => navigate(-1)}>Go back</Button>} />;

  const d = q.data;
  const c: Contact = d.contact;
  const canWork = d.permissions.canWork;
  const lastAnalysis = d.calls.find((k: any) => k.score != null);
  const flowIdx = Math.max(0, FLOW.findIndex((f) => f.key === (c.status === "handed_off" ? "handoff_pending" : c.status === "returned" ? "outreach" : c.status)));
  const stageIdx = STAGES.findIndex((s) => s.key === c.stage);
  const pendingHandoff = d.handoffs.find((h: any) => h.status === "pending");
  const legionish = user?.role === "legion" || user?.role === "founder";

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" /> Back</button>

      {/* Header */}
      <Card className="overflow-hidden" spotlight={false}>
        <div className="relative bg-gradient-to-br from-brand-50 via-surface to-surface p-5 sm:p-6 dark:from-brand-950/40">
          <div className="pointer-events-none absolute -top-20 right-10 size-64 rounded-full bg-brand-400/15 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <motion.div initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>
                <Avatar name={c.full_name} hue={205} size={68} />
              </motion.div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight text-fg">{c.full_name}</h1>
                  <Badge tone={STATUS_TONE[c.status] ?? "neutral"} dot>{label(c.status)}</Badge>
                  {c.do_not_contact && <Badge tone="danger">Do not contact</Badge>}
                  {c.is_invalid && <Badge tone="warning">Invalid number</Badge>}
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted"><Building2 className="size-4" />{c.designation ? `${c.designation} at ` : ""}<b className="text-fg">{c.company_name ?? "—"}</b></p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  <InfoChip icon={<Phone className="size-4" />} text={c.phone_display ?? c.phone ?? "—"} copy={c.phone_display ?? undefined} />
                  {c.email && <InfoChip icon={<Mail className="size-4" />} text={c.email} copy={c.email} />}
                  {c.city && <InfoChip icon={<MapPin className="size-4" />} text={c.city} />}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.campaign && <Badge tone="brand">{c.campaign}</Badge>}
                  {c.segment && <Badge tone="neutral">{c.segment}</Badge>}
                  {c.source && <Badge tone="neutral">via {c.source}</Badge>}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row lg:flex-col lg:items-end">
              {canWork && !["legion"].includes(user?.role ?? "") && <CallButton size="lg" contact={c} label="Call now" className="min-w-44" />}
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {canWork && <Button size="sm" icon={<CalendarClock className="size-4" />} onClick={() => setModal("followup")}>Follow-up</Button>}
                {canWork && <Button size="sm" icon={<History className="size-4" />} onClick={() => setModal("status")}>Status</Button>}
                {canWork && ["qualified", "qualification_review", "returned"].includes(c.status) && !pendingHandoff && user?.role !== "legion" && (
                  <Button size="sm" variant="soft" icon={<Handshake className="size-4" />} onClick={() => setModal("handoff")}>Hand off to Legion</Button>
                )}
                {manager && <Button size="sm" icon={<Shuffle className="size-4" />} onClick={() => setModal("reassign")}>Reassign</Button>}
                {legionish && ["qualified", "legion_meet_1", "legion_meet_2"].includes(c.stage) && <Button size="sm" variant="soft" icon={<CalendarPlus className="size-4" />} onClick={() => setModal("meeting")}>Book Legion meeting</Button>}
                {legionish && ["legion_meet_1", "legion_meet_2"].includes(c.stage) && !c.status.startsWith("closed") && <Button size="sm" variant="success" icon={<Trophy className="size-4" />} onClick={() => setModal("close")}>Close</Button>}
              </div>
            </div>
          </div>

          {/* Milestones */}
          <div className="relative mt-6 grid grid-cols-4 gap-2">
            {STAGES.map((s, i) => (
              <div key={s.key} className="relative">
                <div className="h-2 overflow-hidden rounded-full bg-line/70">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" initial={{ width: 0 }} animate={{ width: i <= stageIdx ? "100%" : "0%" }} transition={{ duration: 0.6, delay: 0.2 + i * 0.18 }} />
                </div>
                <p className={cn("mt-1.5 text-[11px] font-semibold sm:text-xs", i <= stageIdx ? "text-accent" : "text-subtle")}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        {/* Individual status flow */}
        <div className="scroll-x-fade overflow-x-auto border-t border-line px-5 py-3.5">
          <div className="flex min-w-max items-center gap-1.5">
            {FLOW.map((f, i) => (
              <div key={f.key} className="flex items-center gap-1.5">
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                    i < flowIdx ? "bg-success-soft text-success" : i === flowIdx ? "bg-brand-600 text-white shadow-brand" : "bg-sunken text-subtle",
                  )}
                >
                  {i < flowIdx && <Check className="size-3.5" />}
                  {f.label}
                </motion.span>
                {i < FLOW.length - 1 && <span className={cn("h-px w-5", i < flowIdx ? "bg-success" : "bg-line-strong")} />}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        {/* Timeline */}
        <Card delay={0.05}>
          <CardHeader title="Timeline" subtitle="Every touch, newest first" icon={<History className="size-4" />} />
          <div className="px-5">
            <div className="flex gap-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team…" className="min-h-12" />
              <Button variant="primary" className="self-end" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()} icon={<Send className="size-4" />} />
            </div>
          </div>
          <div className="relative px-5 pt-5 pb-5">
            <div className="absolute top-5 bottom-5 left-[39px] w-px bg-gradient-to-b from-brand-300 via-line to-transparent" />
            <div className="space-y-4">
              {d.timeline.length === 0 && <p className="py-6 text-center text-sm text-muted">No activity yet — make the first call.</p>}
              {d.timeline.map((a: any, i: number) => {
                const Icon = KIND_ICON[a.kind] ?? History;
                return (
                  <motion.div key={a.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 15) * 0.04 }} className="relative flex gap-3">
                    <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-surface", a.kind === "ai" ? "bg-gradient-to-br from-brand-400 to-brand-700 text-white" : a.kind === "call" ? "bg-success-soft text-success" : "bg-accent-soft text-accent-soft-fg")}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-sm font-semibold text-fg">
                        {a.meta?.callId ? <Link to={`${base}/calls/${a.meta.callId}`} className="hover:text-accent">{a.title}</Link> : a.title}
                      </p>
                      {a.body && <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted">{a.body}</p>}
                      <p className="mt-0.5 text-[11px] text-subtle">{a.user_name ?? "System"} · {ago(a.created_at)}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          {/* AI snapshot */}
          <Card delay={0.1} className="overflow-hidden">
            <CardHeader title="AI snapshot" subtitle="From the latest analysed call" icon={<Bot className="size-4" />} />
            <div className="flex items-center gap-5 px-5 pb-5">
              <ScoreRing value={lastAnalysis?.score ?? null} size={96} label="last call" />
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-xs font-semibold text-muted">Lead temperature</p>
                  <Temperature value={c.temperature} />
                </div>
                {lastAnalysis?.summary && <p className="line-clamp-4 text-[13px] text-fg">{lastAnalysis.summary}</p>}
                {!lastAnalysis && <p className="text-sm text-muted">No analysed calls yet.</p>}
              </div>
            </div>
          </Card>

          {/* Qualification */}
          <Card delay={0.15}>
            <CardHeader title="Qualification checklist" subtitle="Required items must be ticked before handoff" icon={<CheckCircle2 className="size-4" />} />
            <div className="px-3 pb-4">
              {d.qualificationFields.map((f: any) => (
                <Checkbox
                  key={f.key}
                  checked={Boolean(c.qualification?.[f.key])}
                  onChange={(v) => canWork && patch.mutate({ qualification: { [f.key]: v } })}
                  label={<span>{f.label} {f.required && <span className="text-danger">*</span>}</span>}
                />
              ))}
            </div>
          </Card>

          {/* Open tasks */}
          <Card delay={0.2}>
            <CardHeader title="Follow-ups & tasks" icon={<CalendarClock className="size-4" />} action={canWork && <button onClick={() => setModal("followup")} className="text-xs font-semibold text-accent hover:underline">+ Schedule</button>} />
            <div className="space-y-1.5 px-3 pb-4">
              {d.tasks.length === 0 && <p className="px-2 py-3 text-sm text-muted">No follow-ups scheduled.</p>}
              {d.tasks.map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover">
                  <button disabled={t.status !== "open"} onClick={() => completeTask.mutate(t.id)} className={cn("grid size-5 shrink-0 place-items-center rounded-full border transition", t.status === "done" ? "border-success bg-success text-white" : t.status === "missed" ? "border-danger bg-danger-soft" : "border-line-strong hover:border-brand-500")} aria-label="Complete">
                    {t.status === "done" && <Check className="size-3" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", t.status === "done" ? "text-muted line-through" : "text-fg")}>{t.title}</p>
                    <p className={cn("text-xs", t.status === "open" && t.due_at && new Date(t.due_at) < new Date() ? "font-semibold text-danger" : "text-muted")}>{fmtDateTime(t.due_at)} · {t.assignee_name}</p>
                  </div>
                  {t.status !== "open" && <Badge tone={t.status === "done" ? "success" : "danger"}>{t.status}</Badge>}
                </div>
              ))}
            </div>
          </Card>

          {/* Calls */}
          <Card delay={0.25}>
            <CardHeader title="Calls" subtitle={`${d.calls.length} total`} icon={<PhoneCall className="size-4" />} />
            <div className="space-y-1 px-3 pb-4">
              {d.calls.slice(0, 12).map((k: any) => (
                <Link key={k.id} to={`${base}/calls/${k.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-surface-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-fg">{k.call_code}</span>
                    <span className="block text-xs text-muted">{fmtDateTime(k.started_at)} · {k.user_name} · {duration(k.duration_sec)}</span>
                  </span>
                  {k.outcome && <Badge tone={OUTCOME_TONE[k.outcome] ?? "neutral"}>{label(k.outcome)}</Badge>}
                  {k.score != null && <Badge tone={scoreTone(k.score)}>{k.score}</Badge>}
                </Link>
              ))}
              {d.calls.length === 0 && <p className="px-2 py-3 text-sm text-muted">Not called yet.</p>}
            </div>
          </Card>

          {/* Handoffs, meetings, ownership */}
          <Card delay={0.3}>
            <CardHeader title="Handoffs, meetings & ownership" icon={<Swords className="size-4" />} />
            <div className="space-y-3 px-5 pb-5 text-sm">
              {d.handoffs.map((h: any) => (
                <div key={h.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between"><span className="font-semibold text-fg">Handoff from {h.from_name ?? "—"}</span><Badge tone={h.status === "accepted" ? "success" : h.status === "returned" ? "danger" : "violet"}>{h.status}</Badge></div>
                  {h.note && <p className="mt-1 text-muted">{h.note}</p>}
                  {h.return_reason && <p className="mt-1 text-danger">Returned: {h.return_reason}</p>}
                  <p className="mt-1 text-[11px] text-subtle">{ago(h.created_at)}{h.decided_by_name ? ` · decided by ${h.decided_by_name}` : ""}</p>
                </div>
              ))}
              {d.meetings.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-line p-3">
                  <div><p className="font-semibold text-fg">{label(m.stage)}</p><p className="text-xs text-muted">{fmtDateTime(m.scheduled_at)} · {m.legion_name ?? "Legion"} · {m.location ?? ""}</p></div>
                  <Badge tone={m.status === "completed" ? "success" : m.status === "scheduled" ? "brand" : "neutral"}>{m.status.replace("_", " ")}</Badge>
                </div>
              ))}
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted">Ownership history</p>
                {d.assignments.map((a: any) => (
                  <p key={a.id} className="text-xs text-muted"><b className="text-fg">{a.user_name}</b> · {a.kind}{a.reason ? ` — ${a.reason}` : ""} · {ago(a.created_at)}{a.active ? " · current" : ""}</p>
                ))}
                {d.assignments.length === 0 && <p className="text-xs text-subtle">Never assigned.</p>}
              </div>
              {canWork && (
                <button onClick={() => patch.mutate({ do_not_contact: !c.do_not_contact })} className="flex items-center gap-1.5 text-xs font-semibold text-danger hover:underline">
                  <Ban className="size-3.5" /> {c.do_not_contact ? "Remove do-not-contact" : "Mark do-not-contact"}
                </button>
              )}
            </div>
          </Card>
        </div>
      </div>

      <FollowUpModal open={modal === "followup"} onClose={() => setModal(null)} contactId={c.id} name={c.full_name} onDone={refresh} />
      <StatusModal open={modal === "status"} onClose={() => setModal(null)} contact={c} onDone={refresh} />
      <HandoffModal open={modal === "handoff"} onClose={() => setModal(null)} contact={c} onDone={refresh} />
      <ReassignModal open={modal === "reassign"} onClose={() => setModal(null)} contact={c} onDone={refresh} />
      <MeetingModal open={modal === "meeting"} onClose={() => setModal(null)} contact={c} onDone={refresh} />
      <CloseModal open={modal === "close"} onClose={() => setModal(null)} contact={c} onDone={refresh} />
    </div>
  );
}

function InfoChip({ icon, text, copy }: { icon: ReactNode; text: string; copy?: string }) {
  const toast = useToast();
  return (
    <span className="group flex items-center gap-1.5 text-fg">
      <span className="text-muted">{icon}</span>
      {text}
      {copy && (
        <button onClick={() => { navigator.clipboard?.writeText(copy); toast({ kind: "success", title: "Copied" }); }} className="opacity-0 transition group-hover:opacity-100" aria-label="Copy">
          <Copy className="size-3.5 text-subtle hover:text-fg" />
        </button>
      )}
    </span>
  );
}

function useAction(onDone: () => void, onClose: () => void, success: string, party = false) {
  const toast = useToast();
  return {
    onSuccess: () => {
      if (party) celebrate();
      toast({ kind: "success", title: success });
      onDone();
      onClose();
    },
    onError: (e: unknown) => toast({ kind: "error", title: "Couldn't do that", body: (e as Error).message }),
  };
}

function FollowUpModal({ open, onClose, contactId, name, onDone }: { open: boolean; onClose: () => void; contactId: string; name: string; onDone: () => void }) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(11, 0, 0, 0);
  const [when, setWhen] = useState(localInput(tomorrow));
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState("follow_up");
  const m = useMutation({
    mutationFn: () => api.post("/tasks", { contactId, kind, title: `${kind === "meeting" ? "Meeting" : "Follow up"} with ${name}`, reason: reason || null, dueAt: new Date(when).toISOString(), reminderMinutes: 15 }),
    ...useAction(onDone, onClose, "Follow-up scheduled — you'll get a reminder"),
  });
  return (
    <Modal open={open} onClose={onClose} title="Schedule the next action" icon={<CalendarClock className="size-5" />} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Schedule</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="follow_up">Follow-up call</option><option value="meeting">Meeting</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></Select></Field>
        <Field label="When"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Reason" className="sm:col-span-2" hint="One open follow-up per prospect — scheduling again reschedules it."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Send pricing first, then call to walk through it" /></Field>
      </div>
    </Modal>
  );
}

function StatusModal({ open, onClose, contact, onDone }: { open: boolean; onClose: () => void; contact: Contact; onDone: () => void }) {
  const [status, setStatus] = useState("follow_up");
  const [note, setNote] = useState("");
  const m = useMutation({ mutationFn: () => api.post(`/contacts/${contact.id}/status`, { status, note: note || null }), ...useAction(onDone, onClose, "Status updated", status === "qualified") });
  return (
    <Modal open={open} onClose={onClose} title="Update status" subtitle={`Currently: ${label(contact.status)}`} icon={<History className="size-5" />} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Update</Button></>}>
      <div className="space-y-3">
        <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{["outreach", "follow_up", "qualification_review", "qualified", "disqualified"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
        <Field label="Note" hint={status === "disqualified" ? "Required: why is this prospect disqualified?" : undefined}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function HandoffModal({ open, onClose, contact, onDone }: { open: boolean; onClose: () => void; contact: Contact; onDone: () => void }) {
  const [note, setNote] = useState("");
  const m = useMutation({ mutationFn: () => api.post(`/contacts/${contact.id}/handoff`, { note: note || null }), ...useAction(onDone, onClose, "Handed off to Legion 🚀", true) });
  return (
    <Modal open={open} onClose={onClose} title="Hand off to the Legion team" subtitle="They'll accept it into a Legion meeting or return it with a reason." icon={<Handshake className="size-5" />} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Submit handoff</Button></>}>
      <Field label="Context for Legion" hint="What they need, who decides, what was promised."><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="MD Mr. Kapoor decides; wants order tracking + payment reminders; prefers Thursday afternoons" /></Field>
    </Modal>
  );
}

function ReassignModal({ open, onClose, contact, onDone }: { open: boolean; onClose: () => void; contact: Contact; onDone: () => void }) {
  const people = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: any[] }>("/users"), enabled: open });
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const m = useMutation({ mutationFn: () => api.post(`/contacts/${contact.id}/reassign`, { toUserId: to, reason }), ...useAction(onDone, onClose, "Reassigned") });
  return (
    <Modal open={open} onClose={onClose} title="Reassign prospect" subtitle={`Owner now: ${contact.owner_name ?? "nobody"}`} icon={<Shuffle className="size-5" />} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!to || reason.length < 3} loading={m.isPending} onClick={() => m.mutate()}>Reassign</Button></>}>
      <div className="space-y-3">
        <Field label="New owner"><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{(people.data?.users ?? []).filter((u) => u.status === "active" && ["sales_rep", "sales_head"].includes(u.role) && u.id !== contact.owner_id).map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.active_prospects} active)</option>)}</Select></Field>
        <Field label="Reason (required)" hint="Kept in the ownership history and audit log."><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner on leave; better segment fit" /></Field>
      </div>
    </Modal>
  );
}

function MeetingModal({ open, onClose, contact, onDone }: { open: boolean; onClose: () => void; contact: Contact; onDone: () => void }) {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(16, 0, 0, 0);
  const [stage, setStage] = useState(contact.stage === "legion_meet_1" ? "legion_meet_2" : "legion_meet_1");
  const [when, setWhen] = useState(localInput(d));
  const [location, setLocation] = useState("Google Meet");
  const [notes, setNotes] = useState("");
  const m = useMutation({ mutationFn: () => api.post("/meetings", { contactId: contact.id, stage, scheduledAt: new Date(when).toISOString(), location, notes: notes || null }), ...useAction(onDone, onClose, "Legion meeting booked", true) });
  return (
    <Modal open={open} onClose={onClose} title="Book a Legion meeting" icon={<CalendarPlus className="size-5" />} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Book meeting</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Meeting"><Select value={stage} onChange={(e) => setStage(e.target.value)}><option value="legion_meet_1">Legion Meet 1</option><option value="legion_meet_2">Legion Meet 2</option></Select></Field>
        <Field label="When"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label="Where" className="sm:col-span-2"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Agenda" className="sm:col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function CloseModal({ open, onClose, contact, onDone }: { open: boolean; onClose: () => void; contact: Contact; onDone: () => void }) {
  const [outcome, setOutcome] = useState<"won" | "lost">("won");
  const [note, setNote] = useState("");
  const m = useMutation({ mutationFn: () => api.post(`/contacts/${contact.id}/close`, { outcome, note: note || null }), ...useAction(onDone, onClose, outcome === "won" ? "Closed — won! 🏆" : "Closed — lost", outcome === "won") });
  return (
    <Modal open={open} onClose={onClose} title={`Close ${contact.full_name}`} icon={<Trophy className="size-5" />} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={outcome === "won" ? "success" : "danger"} loading={m.isPending} onClick={() => m.mutate()}>{outcome === "won" ? "Mark won" : "Mark lost"}</Button></>}>
      <div className="grid grid-cols-2 gap-2">
        {(["won", "lost"] as const).map((o) => (
          <button key={o} onClick={() => setOutcome(o)} className={cn("flex items-center justify-center gap-2 rounded-2xl border p-4 text-sm font-bold transition", outcome === o ? (o === "won" ? "border-success bg-success-soft text-success" : "border-danger bg-danger-soft text-danger") : "border-line text-muted")}>
            {o === "won" ? <Trophy className="size-5" /> : <XCircle className="size-5" />} {o === "won" ? "Won" : "Lost"}
          </button>
        ))}
      </div>
      <Field label="Note" className="mt-3"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

