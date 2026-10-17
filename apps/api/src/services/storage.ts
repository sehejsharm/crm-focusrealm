import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { AwsClient } from "aws4fetch";
import { env } from "../env.js";

/**
 * Private storage for call recordings. Recordings never sit anywhere public:
 * locally they live in ./.data/recordings; in production in a private
 * Cloudflare R2 bucket (or, alternatively, a private Supabase Storage bucket)
 * reached only with server-side keys. Playback and uploads go through
 * short-lived signed URLs handed out after a permission check.
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
    return { url: `${env.supabaseUrl}/storage/v1${body.url}`, headers: { "x-upsert": "true" } as Record<string, string> };
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

/**
 * Cloudflare R2 through its S3-compatible API, signed with SigV4 (aws4fetch).
 * The bucket stays private: the access key lives only on the server, and the
 * browser gets presigned URLs that expire.
 */
let r2Client: AwsClient | null = null;

const r2 = {
  client() {
    r2Client ??= new AwsClient({
      accessKeyId: env.r2.accessKeyId,
      secretAccessKey: env.r2.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    return r2Client;
  },
  url(key: string) {
    const path = safeKey(key).split("/").map(encodeURIComponent).join("/");
    return `${env.r2.endpoint}/${encodeURIComponent(env.r2.bucket)}/${path}`;
  },
  async fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    if (code === "NoSuchBucket") throw new Error(`R2 bucket "${env.r2.bucket}" doesn't exist — create it in Cloudflare → R2, or set R2_BUCKET`);
    throw new Error(`R2 ${what} failed: ${res.status}${code ? ` ${code}` : ""}`);
  },
  /** A presigned URL; the browser (or Deepgram) uses it without any key. */
  async presign(key: string, method: "GET" | "PUT", expiresIn: number) {
    const url = new URL(this.url(key));
    url.searchParams.set("X-Amz-Expires", String(Math.min(Math.max(Math.round(expiresIn), 1), 604_800)));
    const signed = await this.client().sign(url.toString(), { method, aws: { signQuery: true } });
    return signed.url;
  },
  /** One hour to upload: long recordings on a slow mobile connection take a while. */
  async uploadUrl(key: string) {
    return { url: await this.presign(key, "PUT", 3600), headers: {} as Record<string, string> };
  },
  async signedUrl(key: string, expiresIn: number) {
    return this.presign(key, "GET", expiresIn);
  },
  async info(key: string): Promise<{ size: number | null } | null> {
    const res = await this.client().fetch(this.url(key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) return this.fail(res, "lookup");
    return { size: Number(res.headers.get("content-length")) || null };
  },
  async put(key: string, data: Buffer, mime: string) {
    const res = await this.client().fetch(this.url(key), {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: new Uint8Array(data),
    });
    if (!res.ok) return this.fail(res, "upload");
  },
  async get(key: string, mime: string): Promise<StoredObject | null> {
    const res = await this.client().fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok || !res.body) return this.fail(res, "read");
    return {
      stream: Readable.fromWeb(res.body as any),
      size: Number(res.headers.get("content-length")) || null,
      mime: res.headers.get("content-type") ?? mime,
    };
  },
  async read(key: string): Promise<Buffer | null> {
    const res = await this.client().fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) return this.fail(res, "read");
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(key: string) {
    const res = await this.client().fetch(this.url(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) return this.fail(res, "delete");
  },
};

/** The remote drivers, for one-off copies between them (scripts/copy-recordings-to-r2). */
export const remoteStores = { r2, supabase };

const driver = env.storageDriver === "r2" ? r2 : env.storageDriver === "supabase" ? supabase : local;

function requireConfigured() {
  if (env.storageDriver === "r2" && (!env.r2.endpoint || !env.r2.accessKeyId || !env.r2.secretAccessKey)) {
    throw new Error("Recording storage isn't configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY");
  }
  if (env.storageDriver === "supabase" && (!env.supabaseUrl || !env.supabaseServiceRoleKey)) {
    throw new Error("Recording storage isn't configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  if (env.storageDriver === "local" && env.serverless) {
    throw new Error("Recordings need cloud storage on serverless hosting: set the Cloudflare R2 variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }
}

const remote = env.storageDriver === "r2" ? r2 : env.storageDriver === "supabase" ? supabase : null;

export const storage = {
  put: (key: string, data: Buffer, mime: string) => (requireConfigured(), driver.put(key, data, mime)),
  get: (key: string, mime = "audio/mpeg") => driver.get(key, mime),
  read: (key: string) => driver.read(key),
  remove: (key: string) => driver.remove(key),
  kind: env.storageDriver,
  /** Direct browser uploads exist with cloud storage (R2 or Supabase). */
  direct: remote !== null,
  /** Where the browser PUTs the file, and any extra headers it must send. */
  uploadUrl: (key: string) => {
    requireConfigured();
    if (!remote) throw new Error("Direct uploads need cloud storage");
    return remote.uploadUrl(key);
  },
  signedUrl: (key: string, expiresIn = 600) => (remote ? remote.signedUrl(key, expiresIn) : Promise.resolve(null)),
  info: (key: string) => (remote ? remote.info(key) : local.read(key).then((b) => (b ? { size: b.length } : null))),
};

/** The origin browsers load recordings from and upload them to (for the CSP). */
export function storageOrigin(): string | null {
  const base = env.storageDriver === "r2" ? env.r2.endpoint : env.storageDriver === "supabase" ? env.supabaseUrl : "";
  try {
    return base ? new URL(base).origin : null;
  } catch {
    return null;
  }
}

export function recordingKey(callCode: string, mime: string) {
  const ext = mime.includes("wav") ? "wav" : mime.includes("ogg") || mime.includes("opus") ? "ogg" : mime.includes("webm") ? "webm"
    : mime.includes("3gp") ? "3gp" : mime.includes("flac") ? "flac" : mime.includes("amr") ? "amr"
    : mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a" : "mp3";
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${callCode}.${ext}`;
}
