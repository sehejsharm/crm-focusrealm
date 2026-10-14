import { db, json, type Queryable } from "../db/index.js";
import { broadcast, publish } from "./bus.js";

/** Append to the audit trail. Never throws — auditing must not break an action. */
export async function audit(
  actor: { id?: string | null; label?: string } | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta: Record<string, unknown> = {},
  q?: Queryable,
) {
  try {
    await (q ?? db).query(
      `insert into crm_audit_log (actor_id, actor_label, action, entity, entity_id, meta)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [actor?.id ?? null, actor?.label ?? null, action, entity, entityId, json(meta)],
    );
  } catch (e) {
    console.error("[audit] failed", e);
  }
}

/** Add an entry to a prospect's timeline (and the team's live feed). */
export async function activity(
  contactId: string | null,
  userId: string | null,
  kind: string,
  title: string,
  body?: string | null,
  meta: Record<string, unknown> = {},
  q?: Queryable,
) {
  const row = await db.one(
    `insert into crm_activities (contact_id, user_id, kind, title, body, meta)
     values ($1, $2, $3, $4, $5, $6::jsonb) returning *`,
    [contactId, userId, kind, title, body ?? null, json(meta)],
    q,
  );
  if (!q) broadcast({ type: "activity", data: row });
  return row;
}

/** In-app notification, pushed live to the person's open screens. */
export async function notify(
  userId: string,
  kind: string,
  title: string,
  body?: string | null,
  link?: string | null,
  q?: Queryable,
) {
  const row = await db.one(
    `insert into crm_notifications (user_id, kind, title, body, link) values ($1, $2, $3, $4, $5) returning *`,
    [userId, kind, title, body ?? null, link ?? null],
    q,
  );
  publish(userId, { type: "notification", data: row });
  return row;
}

/** Notify every active person with one of the given roles. */
export async function notifyRoles(
  roles: string[],
  kind: string,
  title: string,
  body?: string | null,
  link?: string | null,
) {
  const people = await db.many<{ id: string }>(
    `select id from crm_users where status = 'active' and role = any($1::text[])`,
    [roles],
  );
  await Promise.all(people.map((p) => notify(p.id, kind, title, body, link)));
}
