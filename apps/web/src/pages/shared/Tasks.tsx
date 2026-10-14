import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { AlarmClock, CalendarClock, Check, ClipboardList, Flag, ListTodo, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CallButton } from "../../components/call";
import { celebrate } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Skeleton, Tabs, Textarea } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { cn, fmtDate, fmtTime, localInput } from "../../lib/format";
import type { Task } from "../../lib/types";

const PRIORITY_TONE = { low: "neutral", normal: "brand", high: "warning", urgent: "danger" } as const;

function bucket(t: Task) {
  if (!t.due_at) return "No date";
  const d = new Date(t.due_at);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (n: number) => new Date(startToday.getTime() + n * 86400_000);
  if (t.status === "open" && d < now) return "Overdue";
  if (d < day(1)) return "Today";
  if (d < day(2)) return "Tomorrow";
  if (d < day(7)) return "This week";
  return "Later";
}
const ORDER = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date"];

export default function Tasks({ mode }: { mode: "mine" | "team" }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "overdue" | "done" | "missed">("open");
  const [assignee, setAssignee] = useState("");
  const base = `/${user?.portal}`;
  const tasks = useQuery({
    queryKey: ["tasks", mode, status, assignee],
    queryFn: () => api.get<{ tasks: Task[] }>(`/tasks${qs({ scope: mode === "mine" ? "mine" : "team", status, userId: assignee })}`),
  });
  const people = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: any[] }>("/users"), enabled: mode === "team" });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; dueAt?: string }) => api.patch(`/tasks/${id}`, body),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dash"] });
      if (v.status === "done") toast({ kind: "success", title: "Done ✓" });
      if (v.dueAt) toast({ kind: "info", title: "Rescheduled" });
    },
  });
  const groups = useMemo(() => {
    const g = new Map<string, Task[]>();
    for (const t of tasks.data?.tasks ?? []) {
      const b = status === "open" || status === "overdue" ? bucket(t) : fmtDate(t.due_at, { day: "numeric", month: "short", year: "numeric" });
      if (!g.has(b)) g.set(b, []);
      g.get(b)!.push(t);
    }
    return [...g.entries()].sort((a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99));
  }, [tasks.data, status]);

  return (
    <div>
      <PageHeader
        eyebrow={mode === "mine" ? "Follow-ups" : "Tasks"}
        title={mode === "mine" ? "Follow-ups & reminders" : user?.role === "founder" ? "Assign tasks" : "Team tasks"}
        subtitle={mode === "mine" ? "Reminders pop up 15 minutes before each one. Missed ones escalate to your sales head after a day." : "Give anyone on the team a task — they're notified instantly."}
      />
      <div className={cn("grid gap-5", mode === "team" && "xl:grid-cols-[1fr_380px]")}>
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Tabs value={status} onChange={setStatus} items={[{ value: "open", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "done", label: "Done" }, { value: "missed", label: "Missed" }]} />
            {mode === "team" && (
              <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-9 w-auto min-w-40 text-[13px]">
                <option value="">Everyone</option>
                {(people.data?.users ?? []).filter((u) => u.status === "active").map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </Select>
            )}
          </div>
          {tasks.isLoading && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
          {!tasks.isLoading && groups.length === 0 && (
            <Card><Empty icon={<ClipboardList className="size-6" />} title={status === "open" ? "All clear" : "Nothing here"} body={status === "open" ? "No open follow-ups. Schedule one from any prospect after a call." : undefined} /></Card>
          )}
          <div className="space-y-5">
            {groups.map(([g, items], gi) => (
              <motion.section key={g} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * 0.06 }}>
                <h2 className={cn("mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.12em] uppercase", g === "Overdue" ? "text-danger" : "text-muted")}>
                  {g === "Overdue" ? <AlarmClock className="size-4" /> : <CalendarClock className="size-4" />} {g} <span className="rounded-md bg-sunken px-1.5 text-[11px] text-muted">{items.length}</span>
                </h2>
                <Card spotlight={false} className="divide-y divide-line overflow-hidden">
                  <AnimatePresence initial={false}>
                    {items.map((t) => (
                      <motion.div key={t.id} layout exit={{ opacity: 0, x: 40, height: 0 }} className="flex items-center gap-3 px-4 py-3">
                        <motion.button
                          whileTap={{ scale: 0.8 }}
                          disabled={t.status !== "open"}
                          onClick={(e) => { update.mutate({ id: t.id, status: "done" }); celebrate(e.clientX, e.clientY); }}
                          className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2 transition", t.status === "done" ? "border-success bg-success text-white" : "border-line-strong hover:border-success hover:bg-success-soft")}
                          aria-label="Mark done"
                        >
                          {t.status === "done" && <Check className="size-3.5" />}
                        </motion.button>
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm font-semibold", t.status === "done" ? "text-muted line-through" : "text-fg")}>
                            {t.contact_id ? <Link to={`${base}/contacts/${t.contact_id}`} className="hover:text-accent">{t.title}</Link> : t.title}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {t.due_at ? `${fmtDate(t.due_at, { weekday: "short", day: "numeric", month: "short" })} · ${fmtTime(t.due_at)}` : "No due date"}
                            {t.company_name ? ` · ${t.company_name}` : ""}{t.reason ? ` · ${t.reason}` : ""}
                          </p>
                        </div>
                        {mode === "team" && t.assignee_name && <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex"><Avatar name={t.assignee_name} hue={t.assignee_hue} size={22} />{t.assignee_name.split(" ")[0]}</span>}
                        {t.priority !== "normal" && <Badge tone={PRIORITY_TONE[t.priority]}><Flag className="size-3" />{t.priority}</Badge>}
                        {t.status === "open" && (
                          <Button size="xs" variant="ghost" onClick={() => {
                            const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0);
                            update.mutate({ id: t.id, dueAt: d.toISOString() });
                          }}>Tomorrow</Button>
                        )}
                        {t.contact_id && t.status === "open" && mode === "mine" && <CallButton size="sm" label="" contact={{ id: t.contact_id, full_name: t.contact_name ?? "", company_name: t.company_name, phone_key: t.contact_phone }} />}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </Card>
              </motion.section>
            ))}
          </div>
        </div>
        {mode === "team" && <AssignTask people={people.data?.users ?? []} />}
      </div>
    </div>
  );
}

function AssignTask({ people }: { people: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const d = new Date();
  d.setHours(d.getHours() + 3, 0, 0, 0);
  const [f, setF] = useState({ assignedTo: "", title: "", reason: "", dueAt: localInput(d), priority: "normal", kind: "custom" });
  const save = useMutation({
    mutationFn: () => api.post("/tasks", { ...f, reason: f.reason || null, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null, reminderMinutes: 30 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast({ kind: "success", title: "Task assigned", body: "They've been notified." });
      setF((x) => ({ ...x, title: "", reason: "" }));
    },
    onError: (e) => toast({ kind: "error", title: "Couldn't assign", body: (e as Error).message }),
  });
  const choices = people.filter((p) => p.status === "active" && (user?.role !== "legion" || p.role === "legion"));
  return (
    <Card className="h-fit xl:sticky xl:top-24" delay={0.1}>
      <CardHeader title="Assign a task" icon={<ListTodo className="size-4" />} />
      <div className="space-y-3 px-5 pb-5">
        <Field label="To"><Select value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}><option value="">Choose a teammate…</option>{choices.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.title ?? p.role}</option>)}</Select></Field>
        <Field label="Task"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Re-call every 'interested' lead from last week" /></Field>
        <Field label="Details"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="min-h-20" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due"><Input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
        </div>
        <Button variant="primary" className="w-full" disabled={!f.assignedTo || !f.title} loading={save.isPending} onClick={() => save.mutate()} icon={<Send className="size-4" />}>Assign task</Button>
      </div>
    </Card>
  );
}

