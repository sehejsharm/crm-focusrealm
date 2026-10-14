import { db } from "./db/index.js";
import { createApp, ensureReady } from "./app.js";
import { env } from "./env.js";
import { startWorker, stopWorker } from "./services/jobs.js";
import { startScheduler } from "./services/scheduler.js";

/** Long-running server: local development and self-hosting (Render, Railway, a VM…). */
async function main() {
  await ensureReady();
  const server = createApp().listen(env.port, () => {
    console.log(`[api] Focus Realm CRM listening on :${env.port} (${db.kind})`);
  });
  startWorker({ concurrency: db.kind === "postgres" ? 3 : 1 });
  startScheduler();

  const shutdown = async () => {
    stopWorker();
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
