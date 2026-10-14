import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "../env.js";

/**
 * Private storage for call recordings. Recordings never sit anywhere public:
 * locally they live in ./.data/recordings, in production in a private
 * Supabase Storage bucket reached only with the service-role key, and every
 * playback streams through an API route that checks permissions first.
 */

export interface StoredObject {
  stream: Readable;
  size: number | null;
  mime: string;
}

function safeKey(key: string) {
  if (key.includes("..") || key.startsWith("/")) throw new Error("Bad storage key");
  return key;
}

const local = {
  async put(key: string, data: Buffer, _mime: string) {
    const file = path.join(env.localStorageDir, safeKey(key));
    mkdirSync(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },
  async get(key: string, mime: string): Promise<StoredObject | null> {
    const file = path.join(env.localStorageDir, safeKey(key));
    if (!existsSync(file)) return null;
    const s = await stat(file);
    return { stream: createReadStream(file), size: s.size, mime };
  },
  async read(key: string): Promise<Buffer | null> {
    const file = path.join(env.localStorageDir, safeKey(key));
    return existsSync(file) ? readFile(file) : null;
  },
  async remove(key: string) {
    const file = path.join(env.localStorageDir, safeKey(key));
    if (existsSync(file)) await unlink(file);
  },
};

let bucketReady = false;

const supabase = {
  async ensureBucket() {
    if (bucketReady) return;
    const res = await fetch(`${env.supabaseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: env.recordingsBucket, name: env.recordingsBucket, public: false }),
    });
    // 200 created, or 400/409 "already exists" — either way it's there.
    if (res.ok || res.status === 400 || res.status === 409) bucketReady = true;
  },
  /** A one-time URL the browser uploads straight to (bypasses the API's body limit). */
  async uploadUrl(key: string) {
    await this.ensureBucket();
    const res = await fetch(`${env.supabaseUrl}/storage/v1/object/upload/sign/${env.recordingsBucket}/${safeKey(key)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", "x-upsert": "true" }),
      body: "{}",
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
    if (!res.ok || !body.url) throw new Error(`Couldn't create an upload URL: ${body.message ?? res.status}`);
    return `${env.supabaseUrl}/storage/v1${body.url}`;
  },
  /** A short-lived URL to play or transcribe a private recording. */
  async signedUrl(key: string, expiresIn: number) {
    const res = await fetch(`${env.supabaseUrl}/storage/v1/object/sign/${env.recordingsBucket}/${safeKey(key)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn }),
    });
    const body = (await res.json().catch(() => ({}))) as { signedURL?: string; signedUrl?: string };
    const path = body.signedURL ?? body.signedUrl;
    if (!res.ok || !path) return null;
    return `${env.supabaseUrl}/storage/v1${path}`;
  },
  async info(key: string): Promise<{ size: number | null } | null> {
    const res = await fetch(`${env.supabaseUrl}/storage/v1/object/info/authenticated/${env.recordingsBucket}/${safeKey(key)}`, { headers: this.headers() });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { size?: number; metadata?: { size?: number } };
      return { size: body.size ?? body.metadata?.size ?? null };
    }
    // Older Storage versions: fall back to a HEAD on the object itself.
    const head = await fetch(this.url(key), { method: "HEAD", headers: this.headers() });
    return head.ok ? { size: Number(head.headers.get("content-length")) || null } : null;
  },
  url(key: string) {
    return `${env.supabaseUrl}/storage/v1/object/${env.recordingsBucket}/${safeKey(key)}`;
  },
  headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${env.supabaseServiceRoleKey}`, apikey: env.supabaseServiceRoleKey, ...extra };
  },
  async put(key: string, data: Buffer, mime: string) {
    await this.ensureBucket();
    const res = await fetch(this.url(key), {
      method: "POST",
      headers: this.headers({ "Content-Type": mime, "x-upsert": "true" }),
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
  },
  async get(key: string, mime: string): Promise<StoredObject | null> {
    const res = await fetch(this.url(key), { headers: this.headers() });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok || !res.body) throw new Error(`Storage read failed: ${res.status}`);
    return {
      stream: Readable.fromWeb(res.body as any),
      size: Number(res.headers.get("content-length")) || null,
      mime: res.headers.get("content-type") ?? mime,
    };
  },
  async read(key: string): Promise<Buffer | null> {
    const res = await fetch(this.url(key), { headers: this.headers() });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(key: string) {
    await fetch(`${env.supabaseUrl}/storage/v1/object/${env.recordingsBucket}`, {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: [safeKey(key)] }),
    });
  },
};

const driver = env.storageDriver === "supabase" ? supabase : local;

function requireConfigured() {
  if (env.storageDriver === "supabase" && (!env.supabaseUrl || !env.supabaseServiceRoleKey)) {
    throw new Error("Recording storage isn't configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  if (env.storageDriver === "local" && env.serverless) {
    throw new Error("Recordings need Supabase Storage on serverless hosting: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
}

export const storage = {
  put: (key: string, data: Buffer, mime: string) => (requireConfigured(), driver.put(key, data, mime)),
  get: (key: string, mime = "audio/mpeg") => driver.get(key, mime),
  read: (key: string) => driver.read(key),
  remove: (key: string) => driver.remove(key),
  kind: env.storageDriver,
  /** Direct browser uploads exist only with Supabase Storage. */
  direct: env.storageDriver === "supabase",
  uploadUrl: (key: string) => (requireConfigured(), supabase.uploadUrl(key)),
  signedUrl: (key: string, expiresIn = 600) => (env.storageDriver === "supabase" ? supabase.signedUrl(key, expiresIn) : Promise.resolve(null)),
  info: (key: string) => (env.storageDriver === "supabase" ? supabase.info(key) : local.read(key).then((b) => (b ? { size: b.length } : null))),
};

export function recordingKey(callCode: string, mime: string) {
  const ext = mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : mime.includes("webm") ? "webm" : mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a" : mime.includes("amr") ? "amr" : "mp3";
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${callCode}.${ext}`;
}
