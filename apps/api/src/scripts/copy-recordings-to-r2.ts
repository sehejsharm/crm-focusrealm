import { connect, db } from "../db/index.js";
import { env } from "../env.js";
import { remoteStores } from "../services/storage.js";

/**
 * One-off move of existing call recordings from Supabase Storage to
 * Cloudflare R2. Object keys stay the same, so nothing in the database
 * changes; recordings already in R2 are skipped, so it's safe to re-run.
 *
 *   DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
 *     npm run copy-recordings-to-r2
 *
 * Supabase keeps its copies; delete the old bucket yourself once the CRM
 * plays recordings from R2.
 */
const { r2, supabase } = remoteStores;

const missing = [
  ["DATABASE_URL", env.databaseUrl],
  ["SUPABASE_URL", env.supabaseUrl],
  ["SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceRoleKey],
  ["R2_ACCOUNT_ID (or R2_ENDPOINT)", env.r2.endpoint],
  ["R2_ACCESS_KEY_ID", env.r2.accessKeyId],
  ["R2_SECRET_ACCESS_KEY", env.r2.secretAccessKey],
].filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Set ${missing.join(", ")} first.`);
  process.exit(1);
}

await connect();
const rows = await db.many<{ recording_path: string; recording_mime: string | null }>(
  `select distinct on (recording_path) recording_path, recording_mime from crm_calls where recording_path is not null order by recording_path`,
);
console.log(`${rows.length} recordings to check (Supabase bucket "${env.recordingsBucket}" → R2 bucket "${env.r2.bucket}")`);

let copied = 0, skipped = 0, failed = 0;
for (const [i, r] of rows.entries()) {
  const tag = `[${i + 1}/${rows.length}] ${r.recording_path}`;
  try {
    if (await r2.info(r.recording_path)) {
      skipped++;
      continue;
    }
    const data = await supabase.read(r.recording_path);
    if (!data) {
      console.warn(`${tag} — not in Supabase, skipped`);
      failed++;
      continue;
    }
    await r2.put(r.recording_path, data, r.recording_mime ?? "audio/mpeg");
    copied++;
    console.log(`${tag} — copied (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
  } catch (e) {
    failed++;
    console.error(`${tag} — ${(e as Error).message}`);
  }
}
console.log(`Done: ${copied} copied, ${skipped} already in R2, ${failed} not copied.`);
await db.close();
process.exit(failed ? 1 : 0);
