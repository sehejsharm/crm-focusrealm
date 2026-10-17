import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import { connect, db, migrate } from "./db/index.js";
import { assertProductionConfig, env } from "./env.js";
import { loadUser, requireAuth } from "./lib/auth.js";
import { background } from "./lib/bus.js";
import { errorHandler } from "./lib/http.js";
import { api } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";
import { events } from "./routes/events.js";
import { exportsRouter } from "./routes/exports.js";
import { integrations } from "./routes/integrations.js";
import { emailNotification } from "./services/alerts.js";
import { analyzeCall } from "./services/analysis.js";
import { fetchProviderRecording } from "./services/calls.js";
import { registerJob } from "./services/jobs.js";
import { buildReport } from "./services/reports.js";
import { opportunisticMaintenance } from "./services/scheduler.js";
import { storageOrigin } from "./services/storage.js";
import { transcribeCall } from "./services/transcription.js";

let ready: Promise<void> | null = null;

/**
 * Connects, migrates, registers job handlers and (in demo setups) seeds.
 * Runs once per process — once per cold start on serverless.
 */
export function ensureReady() {
  ready ??= (async () => {
    assertProductionConfig();
    await connect();
    const applied = await migrate();
    if (applied.length) console.log(`[db] applied migrations: ${applied.join(", ")}`);
    if (env.seedDemo) {
      const n = await db.one<{ n: number }>("select count(*)::int as n from crm_users");
      if (n.n === 0) {
        const { seedDemo } = await import("./scripts/seed.js");
        await seedDemo();
      }
    }
    registerJob("recording.fetch", (p) => fetchProviderRecording(p));
    registerJob("call.transcribe", (p) => transcribeCall(p.callId));
    registerJob("call.analyze", async (p) => void (await analyzeCall(p.callId)));
    registerJob("report.build", async (p) => void (await buildReport(p.userId, p.date, { queuedAt: p.queuedAt })));
    // Reports are no longer emailed; drains any email jobs queued before that change.
    registerJob("report.email", async () => {});
    registerJob("notification.email", (p) => emailNotification(p.id));
  })().catch((e) => {
    ready = null; // let the next request retry instead of caching the failure
    throw e;
  });
  return ready;
}

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  const storageOrigins = [storageOrigin()].filter((o): o is string => Boolean(o));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:", ...storageOrigins],
          connectSrc: ["'self'", ...storageOrigins],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Nothing runs before the database is ready.
  app.use(async (_req, _res, next) => {
    try {
      await ensureReady();
      next();
    } catch (e) {
      next(e);
    }
  });

  // Machine-to-machine routes parse their own bodies (the HR signature needs the raw bytes).
  app.use("/api", integrations);

  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  app.use(loadUser);
  app.get("/api/health", async (_req, res) => {
    await db.query("select 1");
    res.json({ ok: true, database: db.kind, serverless: env.serverless });
  });
  app.use("/api/auth", authRouter);
  // On serverless there's no clock process: signed-in traffic nudges the
  // reminders and job queue along (throttled), alongside Vercel Cron.
  app.use("/api", (req, _res, next) => {
    if (req.user && env.serverless) background(opportunisticMaintenance());
    next();
  });
  app.use("/api", requireAuth, events, exportsRouter, api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // Self-hosted: the API also serves the built web app. (On Vercel the CDN does.)
  const web = path.join(env.root, "apps", "web", "dist");
  if (!env.serverless && existsSync(web)) {
    app.use(express.static(web, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(web, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
