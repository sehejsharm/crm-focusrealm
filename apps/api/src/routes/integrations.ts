import express, { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { HttpError } from "../lib/http.js";
import { todayLocal } from "../lib/time.js";
import { handleProviderWebhook } from "../services/calls.js";
import { background } from "../lib/bus.js";
import { handleHrEvent, verifySignature } from "../services/hr.js";
import { drain } from "../services/jobs.js";
import { maybeRunDailyReports, runMaintenance } from "../services/scheduler.js";

/**
 * Machine-to-machine endpoints. None of these use the session cookie: each
 * one authenticates its caller its own way (HMAC, token, bearer secret).
 */
export const integrations = Router();

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// HR console → CRM. The signature covers the raw body, so read it raw.
integrations.post("/integrations/hr/events", express.raw({ type: "*/*", limit: "256kb" }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  verifySignature(raw, req.header("x-fr-timestamp"), req.header("x-fr-signature"));
  res.json(await handleHrEvent(raw));
});

// Telephony provider callbacks (status + recording URL).
integrations.post(
  "/webhooks/telephony/:provider",
  express.urlencoded({ extended: false, limit: "256kb" }),
  express.json({ limit: "256kb" }),
  async (req, res) => {
    const token = String(req.query.token ?? "");
    if (!env.telephonyWebhookToken || !safeEqual(token, env.telephonyWebhookToken)) throw new HttpError(401, "Bad token");
    const provider = req.params.provider;
    if (provider !== "exotel" && provider !== "twilio") throw new HttpError(404, "Unknown provider");
    await handleProviderWebhook(provider, String(req.query.call ?? ""), req.body ?? {});
    // Twilio expects TwiML or an empty 200; Exotel accepts any 200.
    res.type(provider === "twilio" ? "text/xml" : "json").send(provider === "twilio" ? "<Response/>" : { ok: true });
  },
);

// Scheduled work for serverless hosting (Vercel Cron sends a GET with
// "Authorization: Bearer $CRON_SECRET") or any external scheduler.
function requireCron(req: express.Request) {
  const h = req.header("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(h, `Bearer ${env.cronSecret}`)) throw new HttpError(401, "Bad cron secret");
}

/**
 * Works through queued jobs for most of this invocation's time budget. If
 * work remains (a big end-of-day run), hands off to a fresh invocation so
 * nothing is cut off by the function time limit.
 */
async function drainWithHandoff(budgetMs = 240_000) {
  const until = Date.now() + budgetMs;
  let ran = 0;
  let remaining = 0;
  while (Date.now() < until) {
    const r = await drain({ budgetMs: until - Date.now(), concurrency: 4 });
    ran += r.ran;
    remaining = r.remaining;
    if (!remaining) break;
    await new Promise((res) => setTimeout(res, 5000)); // deferred report jobs wake up shortly
  }
  if (remaining && env.serverless && env.cronSecret) {
    background(
      fetch(`${env.appUrl}/api/cron/drain`, { method: "POST", headers: { Authorization: `Bearer ${env.cronSecret}` } }).catch(() => {}),
    );
  }
  return { ran, remaining };
}

const cron = Router();
cron.all("/daily-reports", async (req, res) => {
  requireCron(req);
  // Vercel Cron fires at the time in vercel.json; ignore the clock check there.
  const date = typeof req.body?.date === "string" ? req.body.date : typeof req.query.date === "string" ? req.query.date : null;
  const started = date ? await (await import("../services/reports.js")).runDailyReports(date) : await maybeRunDailyReports({ ignoreTime: true });
  const work = env.serverless ? await drainWithHandoff() : null;
  res.json({ started, work, today: todayLocal() });
});

cron.all("/maintenance", async (req, res) => {
  requireCron(req);
  const out = await runMaintenance();
  const work = env.serverless ? await drainWithHandoff(120_000) : null;
  res.json({ ...out, work });
});

cron.all("/drain", async (req, res) => {
  requireCron(req);
  res.json(await drainWithHandoff());
});

integrations.use("/cron", express.json(), cron);
