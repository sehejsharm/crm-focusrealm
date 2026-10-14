import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ScrollText, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, Badge, Card, Empty, Input, PageHeader, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";

/** Who did what, when — allocations, reassignments, logins, settings, HR events, recordings played. */
export default function Audit() {
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDeb(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const log = useQuery({ queryKey: ["audit", deb], queryFn: () => api.get<{ entries: any[] }>(`/audit${deb ? `?q=${encodeURIComponent(deb)}` : ""}`) });
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Audit log" subtitle="Every sensitive action is recorded here and can't be edited." />
      <div className="mb-4 max-w-md"><Input icon={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action or person…" /></div>
      <Card className="overflow-hidden" spotlight={false}>
        {log.isLoading ? <Skeleton className="m-4 h-64" /> : !log.data?.entries.length ? <Empty icon={<ScrollText className="size-6" />} title="Nothing logged yet" /> : (
          <div className="divide-y divide-line">
            {log.data.entries.map((e, i) => (
              <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 20) * 0.015 }} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Avatar name={e.actor_name ?? e.actor_label ?? "System"} size={30} />
                <span className="w-40 shrink-0 font-semibold text-fg">{e.actor_name ?? e.actor_label ?? "System"}</span>
                <Badge tone={e.action.startsWith("hr.") ? "brand" : e.action.includes("reassign") || e.action.includes("reset") ? "warning" : "neutral"}>{e.action}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{e.entity}{e.entity_id ? `:${String(e.entity_id).slice(0, 8)}` : ""} {Object.keys(e.meta ?? {}).length ? JSON.stringify(e.meta).slice(0, 120) : ""}</span>
                <span className="text-xs text-subtle">{fmtDateTime(e.created_at)}</span>
              </motion.div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
