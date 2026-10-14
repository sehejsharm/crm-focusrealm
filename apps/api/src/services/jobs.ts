import { db, json } from "../db/index.js";
import { env } from "../env.js";
import { background } from "../lib/bus.js";

/**
 * Durable background jobs (proposal: "background processing queue, retries
 * and failure monitoring"). Jobs live in crm_jobs, so a restart never loses
 * one; failures retry with exponential backoff, then park as 'failed' where
 * the Founder portal shows them.
 */

type Handler = (payload: any, job: { id: string; attempts: number }) => Promise<void>;
const handlers = new Map<string, Handler>();

/** Thrown by a handler that isn't ready yet: re-queue without using up an attempt. */
export class DeferJob extends Error {
  constructor(public seconds = 30) {
    super("deferred");
  }
}

export function registerJob(kind: string, handler: Handler) {
  handlers.set(kind, handler);
}

export async function enqueue(
  kind: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
) {
  const row = await db.maybe<{ id: string }>(
    `insert into crm_jobs (kind, payload, run_at, dedupe_key, max_attempts) values ($1, $2::jsonb, $3, $4, $5)
     on conflict (dedupe_key) where dedupe_key is not null and status in ('queued','running') do nothing
     returning id`,
    [kind, json(payload), opts.runAt ?? new Date(), opts.dedupeKey ?? null, opts.maxAttempts ?? 5],
  );
  kick();
  return row?.id ?? null;
}

let running = 0;
let timer: NodeJS.Timeout | null = null;
let stopped = false;
let concurrency = 1;

async function claim() {
  return db.maybe(
    `update crm_jobs set status = 'running', locked_at = now(), attempts = attempts + 1
     where id = (select id from crm_jobs where status = 'queued' and run_at <= now() order by run_at limit 1 for update skip locked)
     returning id, kind, payload, attempts, max_attempts`,
  );
}

async function runOne(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const handler = handlers.get(job.kind);
  try {
    if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
    await handler(job.payload, { id: job.id, attempts: job.attempts });
    await db.query(`update crm_jobs set status = 'done', finished_at = now(), last_error = null where id = $1`, [job.id]);
  } catch (e) {
    if (e instanceof DeferJob) {
      await db.query(
        `update crm_jobs set status = 'queued', attempts = attempts - 1, run_at = now() + make_interval(secs => $2::int) where id = $1`,
        [job.id, e.seconds],
      );
      return true;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const final = job.attempts >= job.max_attempts;
    const backoffSec = Math.min(3600, 20 * 2 ** (job.attempts - 1));
    await db.query(
      `update crm_jobs set status = $2, last_error = $3, run_at = now() + make_interval(secs => $4::int),
         finished_at = case when $2 = 'failed' then now() else null end where id = $1`,
      [job.id, final ? "failed" : "queued", msg.slice(0, 2000), backoffSec],
    );
    console.error(`[jobs] ${job.kind} attempt ${job.attempts} failed${final ? " (giving up)" : ""}:`, msg);
  }
  return true;
}

async function tick() {
  if (stopped) return;
  while (running < concurrency) {
    running++;
    const did = await runOne()
      .catch((e) => {
        console.error("[jobs] worker error", e);
        return false;
      })
      .finally(() => running--);
    if (!did) break;
  }
}

export function kick() {
  if (env.serverless) {
    // No worker process on serverless: run the job after the response,
    // inside the same invocation.
    background(drain({ budgetMs: 240_000, concurrency: 4 }));
    return;
  }
  if (!stopped && timer) setImmediate(() => void tick());
}

let draining: Promise<{ ran: number; remaining: number }> | null = null;

/**
 * Runs due jobs until none are left or the time budget is spent. Used on
 * serverless (after a response, and by the cron endpoints). Returns how many
 * due jobs are still waiting, so a cron can hand off to a fresh invocation.
 */
export function drain(opts: { budgetMs: number; concurrency: number }) {
  if (draining) return draining;
  draining = (async () => {
    // A serverless invocation can be cut off mid-job; reclaim abandoned ones.
    await db.query(`update crm_jobs set status = 'queued' where status = 'running' and locked_at < now() - interval '10 minutes'`);
    const until = Date.now() + opts.budgetMs;
    let ran = 0;
    const worker = async () => {
      while (Date.now() < until) {
        const did = await runOne().catch((e) => {
          console.error("[jobs] drain error", e);
          return false;
        });
        if (!did) break;
        ran++;
      }
    };
    await Promise.all(Array.from({ length: opts.concurrency }, worker));
    const left = await db.one<{ n: number }>(`select count(*)::int as n from crm_jobs where status = 'queued' and run_at <= now() + interval '45 seconds'`);
    return { ran, remaining: left.n };
  })().finally(() => {
    draining = null;
  });
  return draining;
}

export function startWorker(opts: { concurrency?: number } = {}) {
  concurrency = opts.concurrency ?? 1;
  stopped = false;
  // Jobs abandoned mid-run by a crash go back on the queue.
  db.query(`update crm_jobs set status = 'queued' where status = 'running' and locked_at < now() - interval '10 minutes'`).catch(() => {});
  timer = setInterval(() => void tick(), 2000);
  void tick();
}

export function stopWorker() {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}

export async function jobStats() {
  return db.many(
    `select kind, status, count(*)::int as count, max(last_error) filter (where status = 'failed') as sample_error
     from crm_jobs where created_at > now() - interval '7 days' group by kind, status order by kind, status`,
  );
}

export async function retryFailed(kind?: string) {
  const r = await db.query(
    `update crm_jobs set status = 'queued', attempts = 0, run_at = now(), last_error = null
     where status = 'failed' and ($1::text is null or kind = $1)`,
    [kind ?? null],
  );
  kick();
  return r.rowCount;
}
