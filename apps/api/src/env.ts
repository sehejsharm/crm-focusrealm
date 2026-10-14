import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Every setting the API reads from the environment, in one place. Anything
 * optional degrades gracefully: no Anthropic key means demo call analysis, no
 * SMTP means emails land in ./outbox, no DATABASE_URL means an embedded
 * Postgres (PGlite) in ./.data — fine for a laptop, never for production.
 */

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Walks up from the working directory to the repo root (where supabase/ lives). */
function findRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, "supabase", "migrations"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const root = findRoot();
const isProd = str("NODE_ENV") === "production";
/** Running as a Vercel serverless function (no long-lived process). */
const serverless = Boolean(process.env.VERCEL);

export const env = {
  isProd,
  serverless,
  root,
  port: num("PORT", 4000),
  /** Public address of the CRM, used in emails, login links and webhooks. */
  appUrl: str("APP_URL", process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:5173").replace(/\/$/, ""),
  /** Where the API itself is reachable from the outside (telephony webhooks). */
  publicApiUrl: str("PUBLIC_API_URL", str("APP_URL", process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:4000")).replace(/\/$/, ""),

  jwtSecret: str("JWT_SECRET", isProd ? "" : "dev-only-secret-change-me-dev-only-secret"),
  cookieSecure: bool("COOKIE_SECURE", isProd),

  databaseUrl: str("DATABASE_URL"),
  databaseSsl: bool("DATABASE_SSL", true),
  pgliteDir: str("PGLITE_DIR", path.join(root, ".data", "pglite")),
  migrationsDir: str("MIGRATIONS_DIR", path.join(root, "supabase", "migrations")),

  /** Seeds demo people, prospects, calls and reports on an empty database. */
  seedDemo: bool("SEED_DEMO", !isProd),
  /** Shows the one-click demo logins on the sign-in page. */
  demoLogins: bool("DEMO_LOGINS", !isProd),

  // Recordings: "local" (./.data/recordings) or "supabase" (private bucket).
  storageDriver: str("STORAGE_DRIVER", str("SUPABASE_URL") ? "supabase" : "local") as "local" | "supabase",
  localStorageDir: str("LOCAL_STORAGE_DIR", path.join(root, ".data", "recordings")),
  supabaseUrl: str("SUPABASE_URL").replace(/\/$/, ""),
  supabaseServiceRoleKey: str("SUPABASE_SERVICE_ROLE_KEY"),
  recordingsBucket: str("SUPABASE_RECORDINGS_BUCKET", "crm-call-recordings"),

  // Call intelligence.
  anthropicConfigured: Boolean(str("ANTHROPIC_API_KEY") || str("ANTHROPIC_AUTH_TOKEN")),
  aiModel: str("AI_MODEL", "claude-opus-5-5"),
  aiEffort: str("AI_EFFORT", "high") as "low" | "medium" | "high" | "xhigh" | "max",
  deepgramApiKey: str("DEEPGRAM_API_KEY"),
  deepgramModel: str("DEEPGRAM_MODEL", "nova-3"),
  deepgramLanguage: str("DEEPGRAM_LANGUAGE", "multi"),

  // Telephony. Mode is a setting founders choose in the app; these are the
  // provider credentials it needs.
  telephonyProvider: str("TELEPHONY_PROVIDER", "") as "" | "exotel" | "twilio",
  telephonyWebhookToken: str("TELEPHONY_WEBHOOK_TOKEN", isProd ? "" : "dev-webhook-token"),
  exotel: {
    sid: str("EXOTEL_SID"),
    apiKey: str("EXOTEL_API_KEY"),
    apiToken: str("EXOTEL_API_TOKEN"),
    subdomain: str("EXOTEL_SUBDOMAIN", "api.exotel.com"),
    callerId: str("EXOTEL_CALLER_ID"),
  },
  twilio: {
    accountSid: str("TWILIO_ACCOUNT_SID"),
    authToken: str("TWILIO_AUTH_TOKEN"),
    callerId: str("TWILIO_CALLER_ID"),
  },

  // Email.
  smtp: {
    host: str("SMTP_HOST"),
    port: num("SMTP_PORT", 465),
    secure: bool("SMTP_SECURE", true),
    user: str("SMTP_USER"),
    pass: str("SMTP_PASS"),
  },
  mailFrom: str("MAIL_FROM", "Focus Realm CRM <crm@focusrealm.com>"),
  outboxDir: str("OUTBOX_DIR", path.join(root, ".data", "outbox")),

  // HR console integration. The same value as CRM secret on the HR side.
  hrWebhookSecret: str("HR_WEBHOOK_SECRET"),

  /** Bearer token for /api/cron/* when an external scheduler drives the jobs. */
  cronSecret: str("CRON_SECRET"),
  /** Set to false when an external scheduler calls /api/cron/* instead. */
  inProcessScheduler: bool("IN_PROCESS_SCHEDULER", !serverless),

  timezone: str("CRM_TIMEZONE", "Asia/Kolkata"),
};

export function assertProductionConfig() {
  if (!env.isProd && !env.serverless) return;
  const missing: string[] = [];
  if (!env.jwtSecret || env.jwtSecret.length < 32) missing.push("JWT_SECRET (32+ chars)");
  // Serverless file systems are temporary: the embedded database can't be used there.
  if (!env.databaseUrl) missing.push("DATABASE_URL (Supabase Postgres connection string)");
  if (env.storageDriver === "supabase" && !env.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(`Refusing to start in production without: ${missing.join(", ")}`);
  }
}
