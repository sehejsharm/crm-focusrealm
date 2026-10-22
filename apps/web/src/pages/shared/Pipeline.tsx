import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { CalendarClock, GripVertical, KanbanSquare, Swords } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { celebrate } from "../../components/motion";
import { useToast } from "../../components/toast";
import { Avatar, Badge, Empty, PageHeader, Skeleton, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { cn, fmtDateTime, label, STAGES, STATUS_TONE } from "../../lib/format";
import type { Contact } from "../../lib/types";
import { Temperature } from "./Prospects";

const COLUMN_STYLE: Record<string, string> = {
  prospect: "from-sky/40 to-brand-300/30",
  qualified: "from-brand-400/40 to-brand-500/30",
  legion_meet_1: "from-brand-500/40 to-brand-700/30",
  legion_meet_2: "from-brand-700/40 to-brand-900/30",
  legion_meet_3: "from-brand-800/40 to-brand-950/30",
};

/**
 * The main Kanban board: the four business milestones from the proposal.
 * Individual statuses move underneath; dragging a card applies the same
 * rules as the buttons on the prospect page (qualification checklist,
 * Legion acceptance), enforced by the server.
 */
export default function Pipeline() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<"mine" | "all">(user?.role === "sales_rep" ? "mine" : "all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const base = `/${user?.portal}`;

  const board = useQuery({ queryKey: ["board", scope], queryFn: () => api.get<{ rows: Contact[] }>(`/contacts/board${scope === "mine" ? "?mine=1" : ""}`) });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) => api.post(`/contacts/${id}/stage`, { stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["board", scope] });
      const prev = qc.getQueryData<{ rows: Contact[] }>(["board", scope]);
      qc.setQueryData<{ rows: Contact[] }>(["board", scope], (d) => d && { rows: d.rows.map((r) => (r.id === id ? { ...r, stage: stage as Contact["stage"] } : r)) });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["board", scope], ctx.prev);
      toast({ kind: "error", title: "Can't move that yet", body: (e as Error).message });
    },
    onSuccess: (_d, v) => {
      if (v.stage.startsWith("legion")) celebrate();
      toast({ kind: "success", title: `Moved to ${label(v.stage)}` });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["board"] }),
  });

  const rows = board.data?.rows ?? [];
  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="The board"
        subtitle="Prospect → Qualified → Legion Meet 1 → Legion Meet 2. Drag a card to move it — the rules still apply."
        actions={user?.role !== "sales_rep" && <Tabs value={scope} onChange={setScope} items={[{ value: "all", label: "Whole team" }, { value: "mine", label: "Mine" }]} />}
      />
      {board.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-5">{STAGES.map((s) => <Skeleton key={s.key} className="h-96" />)}</div>
      ) : (
        <LayoutGroup>
          <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
            {STAGES.map((stage, ci) => {
              const cards = rows.filter((r) => r.stage === stage.key);
              const active = over === stage.key && dragId;
              return (
                <motion.section
                  key={stage.key}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: ci * 0.08, ease: [0.16, 1, 0.3, 1], duration: 0.6 }}
                  onDragOver={(e) => { e.preventDefault(); setOver(stage.key); }}
                  onDragLeave={() => setOver((o) => (o === stage.key ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    setOver(null);
                    setDragId(null);
                    const card = rows.find((r) => r.id === id);
                    if (card && card.stage !== stage.key) move.mutate({ id, stage: stage.key });
                  }}
                  className={cn(
                    "relative flex w-[82vw] max-w-sm shrink-0 snap-start flex-col rounded-3xl border bg-sunken/60 transition-all sm:w-80 lg:w-auto lg:max-w-none",
                    active ? "border-brand-400 bg-accent-soft/60 shadow-brand" : "border-line",
                  )}
                >
                  <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-3xl bg-gradient-to-b opacity-60", COLUMN_STYLE[stage.key])} />
                  <header className="relative flex items-center justify-between px-4 pt-4 pb-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-bold text-fg">
                        {stage.key.startsWith("legion") && <Swords className="size-4 text-accent" />}
                        {stage.label}
                      </p>
                      <p className="text-[11px] text-muted">{stage.hint}</p>
                    </div>
                    <motion.span key={cards.length} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="grid min-w-8 place-items-center rounded-xl bg-surface px-2 py-1 text-sm font-bold text-fg shadow-xs ring-1 ring-line">
                      {cards.length}
                    </motion.span>
                  </header>
                  <div className="relative flex max-h-[68vh] min-h-48 flex-col gap-2 overflow-y-auto px-3 pb-3">
                    <AnimatePresence>
                      {active && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 64 }} exit={{ opacity: 0, height: 0 }} className="grid shrink-0 place-items-center rounded-2xl border-2 border-dashed border-brand-400 text-xs font-semibold text-accent">
                          Drop to move to {stage.label}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {cards.length === 0 && !active && <Empty className="py-8" icon={<KanbanSquare className="size-5" />} title="Empty" />}
                    {cards.slice(0, 150).map((c) => (
                      <motion.div
                        layout
                        layoutId={c.id}
                        key={c.id}
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                        className={cn("group relative", dragId === c.id && "opacity-40")}
                      >
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", c.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragId(c.id);
                          }}
                          onDragEnd={() => { setDragId(null); setOver(null); }}
                          className="cursor-grab rounded-2xl border border-line bg-surface p-3 shadow-xs transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md active:cursor-grabbing"
                        >
                          <div className="flex items-start gap-2">
                            <GripVertical className="mt-0.5 size-4 shrink-0 text-subtle opacity-0 transition group-hover:opacity-100" />
                            <Link to={`${base}/contacts/${c.id}`} className="min-w-0 flex-1" draggable={false}>
                              <p className="truncate text-sm font-semibold text-fg hover:text-accent">{c.full_name}</p>
                              <p className="truncate text-xs text-muted">{c.company_name ?? "—"}</p>
                            </Link>
                            {c.owner_name && <Avatar name={c.owner_name} hue={c.owner_hue} size={24} />}
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pl-6">
                            <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{label(c.status)}</Badge>
                            <Temperature value={c.temperature} />
                          </div>
                          {c.meeting_at && (
                            <p className="mt-2 flex items-center gap-1.5 pl-6 text-[11px] font-semibold text-accent"><CalendarClock className="size-3.5" /> {fmtDateTime(c.meeting_at)}</p>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    {cards.length > 150 && <p className="py-2 text-center text-xs text-muted">+{cards.length - 150} more — filter in the database</p>}
                  </div>
                </motion.section>
              );
            })}
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}
