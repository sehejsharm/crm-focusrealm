// Vercel serverless function: the whole CRM API (Express) under /api/*.
// The bundle is produced by `node apps/api/build.mjs`, which runs on
// `npm install` (postinstall) and again in the build command. Limits
// (maxDuration, included migration files) live in vercel.json.
export { default } from "../apps/api/dist/vercel.js";
