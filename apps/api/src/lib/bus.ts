import { waitUntil } from "@vercel/functions";
import { db, json } from "../db/index.js";

/**
 * Live events — a dial request on someone's phone, a finished analysis, a
 * new notification. Each one is written to crm_events and picked up by the
 * open screens, which poll /api/events every couple of seconds. Polling a
 * table works identically on one long-running server and on serverless
 * hosting such as Vercel, where nothing can hold a connection open.
 */
export interface LiveEvent {
  type:
    | "notification"
    | "dial"
    | "call.updated"
    | "analysis.ready"
    | "contact.updated"
    | "report.ready"
    | "activity";
  data: unknown;
}

/** Keeps a background write alive after the response on serverless. */
export function background(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("[background]", e));
  try {
    waitUntil(safe);
  } catch {
    /* not on Vercel: the promise simply runs to completion */
  }
  return safe;
}

function persist(userId: string | null, event: LiveEvent) {
  return background(
    db.query(`insert into crm_events (user_id, type, data) values ($1, $2, $3::jsonb)`, [userId, event.type, json(event.data)]),
  );
}

/** Send to one person (all their open tabs and their phone). */
export function publish(userId: string, event: LiveEvent) {
  return persist(userId, event);
}

/** Send to everyone signed in (team-wide live feed). */
export function broadcast(event: LiveEvent) {
  return persist(null, event);
}

/** Events for one person after a cursor. Salespeople only see their own team-feed items. */
export async function eventsSince(user: { id: string; role: string }, after: number | null) {
  if (after == null) {
    const r = await db.one<{ id: number | null }>(`select max(id) as id from crm_events`);
    return { cursor: Number(r.id ?? 0), events: [] as { id: number; type: string; data: any }[] };
  }
  const rows = await db.many<{ id: number; type: string; data: any; user_id: string | null }>(
    `select id, type, data, user_id from crm_events
     where id > $1 and (user_id = $2 or user_id is null) and created_at > now() - interval '1 day'
     order by id limit 200`,
    [after, user.id],
  );
  const events = rows.filter((e) => {
    if (e.user_id || user.role !== "sales_rep") return true;
    const owner = (e.data as { user_id?: string } | null)?.user_id;
    return (e.type === "activity" || e.type === "call.updated") ? owner === user.id : e.type === "contact.updated";
  });
  return { cursor: rows.length ? Number(rows[rows.length - 1].id) : after, events };
}

export async function pruneEvents() {
  const r = await db.query(`delete from crm_events where created_at < now() - interval '2 days'`);
  return r.rowCount;
}
