import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Copy, KeyRound, Link2, MoreHorizontal, Plus, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Button, Card, Field, Input, Modal, PageHeader, Popover, Select, Skeleton, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, ROLE_LABEL } from "../../lib/format";

const ROLE_TONE = { founder: "violet", sales_head: "brand", sales_rep: "info", legion: "success" } as const;

export default function People() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [filter, setFilter] = useState<"all" | "sales" | "legion" | "founder">("all");
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ loginId: string; temporaryPassword: string; name: string } | null>(null);
  const q = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: any[] }>("/users") });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: any) => api.patch(`/users/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); toast({ kind: "success", title: "Saved" }); },
    onError: (e) => toast({ kind: "error", title: "Couldn't save", body: (e as Error).message }),
  });
  const reset = useMutation({
    mutationFn: (u: any) => api.post<{ loginId: string; temporaryPassword: string }>(`/users/${u.id}/reset-password`).then((r) => ({ ...r, name: u.full_name })),
    onSuccess: (r) => setSecret(r),
  });
  const rows = (q.data?.users ?? []).filter((u) => filter === "all" || (filter === "sales" ? ["sales_rep", "sales_head"].includes(u.role) : u.role === filter));

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="People & access"
        subtitle="Sales team members arrive automatically from the HR console. Add founders (with their Workspace FR number) and Legion (they get an LG ID) here."
        actions={<Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Add person</Button>}
      />
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex items-start gap-3 rounded-2xl border border-brand-200 bg-accent-soft p-4 text-sm dark:border-brand-900">
        <Link2 className="mt-0.5 size-5 shrink-0 text-accent" />
        <p className="text-fg"><b>Connected to the HR console.</b> When someone joins the sales department in HR, they get a CRM login here (employee ID + one-time password, shown once in HR). Offboarding in HR locks them out of the CRM on every device; their prospects are flagged for review.</p>
      </motion.div>
      <Tabs className="mb-4" value={filter} onChange={setFilter} items={[{ value: "all", label: "Everyone", count: q.data?.users.length }, { value: "sales", label: "Sales team" }, { value: "legion", label: "Legion" }, { value: "founder", label: "Founders" }]} />
      <Card className="overflow-hidden" spotlight={false}>
        {q.isLoading ? <Skeleton className="m-4 h-64" /> : (
          <div className="divide-y divide-line">
            {rows.map((u, i) => (
              <motion.div key={u.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Avatar name={u.full_name} hue={u.avatar_hue} size={40} online={u.last_active_at ? Date.now() - new Date(u.last_active_at).getTime() < 10 * 60_000 : false} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-fg">{u.full_name} {u.id === user?.id && <span className="text-xs text-muted">(you)</span>}</p>
                  <p className="truncate text-xs text-muted">{u.employee_code} · {u.title ?? ROLE_LABEL[u.role]}{u.email ? ` · ${u.email}` : ""}{u.phone ? ` · ${u.phone}` : ""}</p>
                </div>
                <Badge tone={ROLE_TONE[u.role as keyof typeof ROLE_TONE]}>{ROLE_LABEL[u.role]}</Badge>
                {u.from_hr && <Badge tone="brand"><Link2 className="size-3" />HR</Badge>}
                {u.status !== "active" && <Badge tone="danger">{u.status}</Badge>}
                {u.must_change_password && <Badge tone="warning">awaiting first login</Badge>}
                <span className="hidden w-28 text-right text-xs text-muted md:block">{u.last_login_at ? `seen ${ago(u.last_active_at ?? u.last_login_at)}` : "never signed in"}</span>
                {["sales_rep", "sales_head"].includes(u.role) && <span className="hidden w-24 text-right text-xs text-muted lg:block">{u.active_prospects} prospects</span>}
                <RowMenu
                  u={u}
                  self={u.id === user?.id}
                  onRole={(role) => patch.mutate({ id: u.id, role })}
                  onStatus={(status) => patch.mutate({ id: u.id, status })}
                  onTarget={(daily_call_target) => patch.mutate({ id: u.id, daily_call_target })}
                  onReset={() => reset.mutate(u)}
                />
              </motion.div>
            ))}
          </div>
        )}
      </Card>
      <AddPerson open={adding} onClose={() => setAdding(false)} onCreated={(r) => setSecret(r)} />
      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="Temporary password — shown once" icon={<KeyRound className="size-5" />} footer={<Button variant="primary" onClick={() => setSecret(null)}>I've handed it over</Button>}>
        {secret && (
          <div className="space-y-4">
            <p className="text-sm text-muted">Give these to <b className="text-fg">{secret.name}</b> in person. They'll choose their own password on first sign-in. This password isn't stored anywhere you can see again.</p>
            <SecretRow label="Login ID" value={secret.loginId} />
            <SecretRow label="Temporary password" value={secret.temporaryPassword} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function SecretRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-sunken p-4">
      <div><p className="text-xs font-semibold text-muted">{label}</p><p className="font-mono text-lg font-bold tracking-wide text-fg">{value}</p></div>
      <Button size="sm" icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(value); toast({ kind: "success", title: "Copied" }); }}>Copy</Button>
    </motion.div>
  );
}

function RowMenu({ u, self, onRole, onStatus, onTarget, onReset }: { u: any; self: boolean; onRole: (r: string) => void; onStatus: (s: string) => void; onTarget: (n: number) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(String(u.daily_call_target ?? 40));
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded-xl p-2 text-muted hover:bg-surface-hover hover:text-fg" aria-label="Actions"><MoreHorizontal className="size-4" /></button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-64 space-y-3 p-3">
        {!self && (
          <Field label="Role">
            <Select value={u.role} onChange={(e) => { onRole(e.target.value); setOpen(false); }}>
              <option value="sales_rep">Sales team member</option>
              <option value="sales_head">Sales head</option>
              <option value="legion">Legion</option>
              <option value="founder">Founder</option>
            </Select>
          </Field>
        )}
        {["sales_rep", "sales_head"].includes(u.role) && (
          <Field label="Daily call target">
            <div className="flex gap-2"><Input value={target} onChange={(e) => setTarget(e.target.value)} type="number" min={1} /><Button size="sm" onClick={() => { onTarget(Number(target)); setOpen(false); }}>Save</Button></div>
          </Field>
        )}
        <div className="flex flex-col gap-1.5">
          <Button size="sm" icon={<KeyRound className="size-4" />} onClick={() => { onReset(); setOpen(false); }}>Reset password</Button>
          {!self && (u.status === "active"
            ? <Button size="sm" variant="danger" onClick={() => { onStatus("inactive"); setOpen(false); }}>Deactivate (signs out everywhere)</Button>
            : <Button size="sm" variant="soft" icon={<ShieldCheck className="size-4" />} onClick={() => { onStatus("active"); setOpen(false); }}>Reactivate</Button>)}
        </div>
      </Popover>
    </div>
  );
}

function AddPerson({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: { loginId: string; temporaryPassword: string; name: string }) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ full_name: "", employee_code: "", email: "", phone: "", role: "legion", title: "" });
  const legion = f.role === "legion";
  const save = useMutation({
    mutationFn: () => api.post<{ user: any; temporaryPassword: string }>("/users", { ...f, employee_code: f.employee_code || null, email: f.email || null, phone: f.phone || null, title: f.title || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
      onCreated({ loginId: r.user.employee_code, temporaryPassword: r.temporaryPassword, name: r.user.full_name });
      setF({ full_name: "", employee_code: "", email: "", phone: "", role: "legion", title: "" });
    },
    onError: (e) => toast({ kind: "error", title: "Couldn't add", body: (e as Error).message }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Add a person" subtitle="Sales team members normally arrive from the HR console." icon={<Plus className="size-5" />} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.full_name || (!legion && !f.employee_code)} onClick={() => save.mutate()}>Create login</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="legion">Legion</option><option value="sales_head">Sales head</option><option value="sales_rep">Sales team member</option><option value="founder">Founder (CEO/COO…)</option></Select></Field>
        <Field label="Full name"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label={legion ? "Login ID (optional)" : "FR number"} hint={legion ? "Legion aren't on Workspace — leave empty to get the next LG ID" : "Their Focus Realm Workspace ID — it's their login"}>
          <Input value={f.employee_code} onChange={(e) => setF({ ...f, employee_code: e.target.value.toUpperCase() })} placeholder={legion ? "LG-0001 (automatic)" : "FR-0050"} />
        </Field>
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Chief Operating Officer" /></Field>
        <Field label="Email" hint="Founders & sales heads receive daily reports here"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      <AnimatePresence>{f.role === "founder" && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 text-xs text-warning">Founders see and control everything.</motion.p>}</AnimatePresence>
    </Modal>
  );
}
