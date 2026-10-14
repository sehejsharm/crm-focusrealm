import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { BrainCircuit, Lightbulb, MessageSquareWarning, Quote, Swords, Target } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BarList, Radar } from "../../components/charts";
import { Badge, Card, CardHeader, Empty, PageHeader, Skeleton, Tabs } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ago, label } from "../../lib/format";

/** Team-wide call intelligence: objections, frameworks, product feedback. */
export default function Intelligence() {
  const { user } = useAuth();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const base = `/${user?.portal}`;
  const ins = useQuery({ queryKey: ["insights", days], queryFn: () => api.get<any>(`/insights/objections?days=${days}`) });
  const dash = useQuery({ queryKey: ["dash", "founder"], queryFn: () => api.get<any>("/dashboard/founder") });
  const d = ins.data;
  const signals = (kind: string) => (d?.signals ?? []).filter((s: any) => s.kind === kind);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Call intelligence" title="What the calls are telling us" subtitle="Every analysed call feeds these trends — objections, framework mastery, and what prospects ask for." actions={<Tabs value={days} onChange={setDays} items={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Team framework mastery" subtitle="Average score across analysed calls · 30 days" icon={<Target className="size-4" />} />
          <div className="grid place-items-center px-4 pb-6">
            {dash.data?.frameworkAvg?.length ? <Radar items={dash.data.frameworkAvg.map((f: any) => ({ label: f.framework, value: Number(f.score) }))} /> : <Skeleton className="h-72 w-72 rounded-full" />}
          </div>
        </Card>
        <Card delay={0.05}>
          <CardHeader title="Objections by type" subtitle="Bar = how often · label = handled well" icon={<MessageSquareWarning className="size-4" />} />
          <div className="px-5 pb-5">
            {ins.isLoading ? <Skeleton className="h-64" /> : !d?.byCategory.length ? <Empty icon={<MessageSquareWarning className="size-6" />} title="No objections recorded yet" /> : (
              <BarList items={d.byCategory.map((c: any) => ({ key: c.category, label: label(c.category), value: c.count, sub: `${Math.round((c.well / Math.max(1, c.count)) * 100)}% handled well` }))} />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Objection playbook" subtitle="Real objections from calls, with the line that works better" icon={<Quote className="size-4" />} />
          <div className="max-h-[620px] space-y-2.5 overflow-y-auto px-5 pb-5">
            {(d?.examples ?? []).map((o: any, i: number) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }} className="rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="violet">{label(o.category)}</Badge>
                  <Badge tone={o.handled === "well" ? "success" : o.handled === "partially" ? "warning" : "danger"}>{o.handled ?? "—"}</Badge>
                  <span className="text-muted">{o.user_name} · {o.contact_name} · {ago(o.created_at)}</span>
                  <Link to={`${base}/calls/${o.call_id}`} className="ml-auto font-semibold text-accent hover:underline">Open call</Link>
                </div>
                <p className="mt-2 text-sm text-fg italic">“{o.text}”</p>
                {o.better_response && <p className="mt-1.5 text-sm text-accent-soft-fg">→ {o.better_response}</p>}
              </motion.div>
            ))}
          </div>
        </Card>
        <div className="space-y-5">
          <SignalCard title="Product requests" icon={<Lightbulb className="size-4" />} items={signals("product_request")} base={base} />
          <SignalCard title="Pain points we hear" icon={<BrainCircuit className="size-4" />} items={signals("pain_point")} base={base} />
          <SignalCard title="Competitors mentioned" icon={<Swords className="size-4" />} items={signals("competitor")} base={base} />
        </div>
      </div>
    </div>
  );
}

function SignalCard({ title, icon, items, base }: { title: string; icon: ReactNode; items: any[]; base: string }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={`${items.length} mentions`} icon={icon} />
      <div className="max-h-64 space-y-1 overflow-y-auto px-3 pb-4">
        {items.length === 0 && <p className="px-2 text-sm text-muted">None yet.</p>}
        {items.slice(0, 25).map((s, i) => (
          <Link key={i} to={`${base}/calls/${s.call_id}`} className="block rounded-xl px-2 py-1.5 text-sm text-fg hover:bg-surface-hover">“{s.text}” <span className="text-[11px] text-subtle">· {ago(s.created_at)}</span></Link>
        ))}
      </div>
    </Card>
  );
}
