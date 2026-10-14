import { createApp } from "./app.js";

/**
 * Vercel serverless entry. api/index.mjs re-exports this; vercel.json routes
 * every /api/* request here. The Express app itself waits for the database
 * on each cold start (see ensureReady in app.ts).
 */
const app = createApp();
export default app;
