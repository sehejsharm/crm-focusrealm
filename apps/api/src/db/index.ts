import { attachDatabasePool } from "@vercel/functions";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { env } from "../env.js";

/**
 * One tiny interface over two drivers:
 *
 * - DATABASE_URL set → node-postgres against Supabase (or any Postgres).
 * - unset → PGlite, a real Postgres compiled to WebAssembly, persisted in
 *   ./.data/pglite. Same SQL, zero setup, single process. Development only.
 *
 * Everything else in the API talks to `db` and never knows which it got.
 */

export interface Result<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<Result<T>>;
}

interface Driver extends Queryable {
  kind: "postgres" | "pglite";
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// int8 (counts) and numeric come back as strings by default; the CRM's values
// all fit safely in a JS number. Dates stay plain 'YYYY-MM-DD' strings.
const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082;

const isReadOnly = (sql: string) => /^\s*(select|with)\b/i.test(sql) && !/\b(insert|update|delete|nextval|for\s+update)\b/i.test(sql);

function connectionDropped(e: unknown) {
  const err = e as { code?: string; message?: string };
  return (
    ["ECONNRESET", "EPIPE", "57P01", "08003", "08006"].includes(err?.code ?? "") ||
    /Connection terminated|connection error and is not queryable|socket hang up/i.test(err?.message ?? "")
  );
}

async function postgresDriver(): Promise<Driver> {
  pg.types.setTypeParser(INT8, (v) => Number(v));
  pg.types.setTypeParser(NUMERIC, (v) => Number(v));
  pg.types.setTypeParser(DATE, (v) => v);

  const needsSsl = env.databaseSsl && !/localhost|127\.0\.0\.1/.test(env.databaseUrl);
  // On serverless one instance serves several requests at once and a
  // dashboard runs a dozen queries together, so it keeps a handful of
  // connections. Use Supabase's pooler URL (port 6543): it shares a few real
  // Postgres connections between every instance.
  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
    max: env.serverless ? 6 : 10,
    // Long enough that the connection is still open for the next click or
    // live-update poll, so most requests skip the TLS + sign-in handshake.
    idleTimeoutMillis: env.serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  // The pooler may close an idle connection at any time. Without a listener
  // that 'error' event would take the whole process down.
  pool.on("error", (e) => console.error("[db] idle connection dropped:", e.message));
  // Vercel: keep the instance awake until idle connections have closed, so a
  // paused instance never wakes up holding dead sockets.
  if (env.serverless) {
    try {
      attachDatabasePool(pool);
    } catch {
      /* older runtime: the pool still works, just without that guarantee */
    }
  }

  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
  });

  // A pooled connection can die between requests. A read is safe to run again
  // on a fresh connection; a write is not (it may already have been applied).
  const pooled = wrap(pool);
  const direct: Queryable = {
    async query(sql, params) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await pooled.query(sql, params);
        } catch (e) {
          if (attempt >= 2 || !isReadOnly(sql) || !connectionDropped(e)) throw e;
        }
      }
    },
  };

  return {
    kind: "postgres",
    ...direct,
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(wrap(client));
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function pgliteDriver(): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  mkdirSync(env.pgliteDir, { recursive: true });
  const lite = new PGlite(env.pgliteDir, {
    parsers: {
      [INT8]: (v: string) => Number(v),
      [NUMERIC]: (v: string) => Number(v),
      [DATE]: (v: string) => v,
    },
  });
  await lite.waitReady;

  // PGlite is one connection: queue everything so a transaction never
  // interleaves with an unrelated statement.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  const run = async (q: { query: typeof lite.query }, sql: string, params?: unknown[]) => {
    const r = await q.query(sql, params as any[]);
    return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
  };

  return {
    kind: "pglite",
    query: (sql, params) => serial(() => run(lite, sql, params)),
    exec: (sql) => serial(async () => void (await lite.exec(sql))),
    tx: (fn) =>
      serial(() =>
        lite.transaction(async (t) => fn({ query: (sql, params) => run(t as any, sql, params) })),
      ),
    close: () => lite.close(),
  };
}

let driver: Driver | null = null;

export async function connect(): Promise<Driver> {
  if (driver) return driver;
  driver = env.databaseUrl ? await postgresDriver() : await pgliteDriver();
  return driver;
}

function d(): Driver {
  if (!driver) throw new Error("Database not connected — call connect() first");
  return driver;
}

export const db = {
  get kind() {
    return d().kind;
  },
  query<T = any>(sql: string, params?: unknown[]) {
    return d().query<T>(sql, params);
  },
  /** First row or null. */
  async maybe<T = any>(sql: string, params?: unknown[], q: Queryable = d()): Promise<T | null> {
    const r = await q.query<T>(sql, params);
    return r.rows[0] ?? null;
  },
  /** First row, or throws. */
  async one<T = any>(sql: string, params?: unknown[], q: Queryable = d()): Promise<T> {
    const r = await q.query<T>(sql, params);
    if (!r.rows[0]) throw new Error("Expected a row");
    return r.rows[0];
  },
  async many<T = any>(sql: string, params?: unknown[], q: Queryable = d()): Promise<T[]> {
    return (await q.query<T>(sql, params)).rows;
  },
  tx<T>(fn: (q: Queryable) => Promise<T>) {
    return d().tx(fn);
  },
  close() {
    return driver?.close();
  },
};

/** Applies every supabase/migrations/*.sql not yet applied, in name order. */
export async function migrate(): Promise<string[]> {
  const drv = d();
  await drv.exec(`create table if not exists crm_schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const done = new Set(
    (await drv.query<{ name: string }>("select name from crm_schema_migrations")).rows.map((r) => r.name),
  );
  const files = readdirSync(env.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(path.join(env.migrationsDir, file), "utf8");
    // Every statement is idempotent and the transaction holds an advisory
    // lock, so two cold-starting instances can't trip over each other.
    const lock = drv.kind === "postgres" ? "select pg_advisory_xact_lock(727274);\n" : "";
    await drv.exec(
      `begin;\n${lock}${sql}\ninsert into crm_schema_migrations (name) values ('${file.replace(/'/g, "''")}') on conflict (name) do nothing;\ncommit;`,
    );
    applied.push(file);
  }
  return applied;
}

/** jsonb parameter helper — always serialise explicitly and cast with ::jsonb. */
export const json = (v: unknown) => JSON.stringify(v ?? null);
