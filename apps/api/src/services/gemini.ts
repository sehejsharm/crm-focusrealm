import { z } from "zod";
import { env } from "../env.js";

/**
 * Google Gemini, the free-tier alternative to Claude for call analysis,
 * daily reports and (when there's no Deepgram key) transcription. Gemini
 * returns JSON constrained to the same schemas Claude uses, and the result
 * is validated with zod before the CRM trusts it.
 *
 * Note for founders: on Google's free (unpaid) tier, Google may use what is
 * sent — here, call recordings and transcripts — to improve its products,
 * and people may review it. Turning on billing for the Google project makes
 * it a paid service, which Google does not train on.
 */

const BASE = "https://generativelanguage.googleapis.com";

export class GeminiError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message);
  }
}

export const geminiConfigured = () => Boolean(env.geminiApiKey);

function jsonSchema(schema: z.ZodType) {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

async function call(path: string, init: RequestInit & { timeoutMs?: number }) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "x-goog-api-key": env.geminiApiKey, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(init.timeoutMs ?? 5 * 60_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 400);
    // 429 (free-tier quota) and 5xx are worth retrying later; bad requests,
    // a wrong key or an unknown model are not.
    const permanent = [400, 401, 403, 404].includes(res.status);
    throw new GeminiError(`Gemini ${res.status}: ${text}`, permanent);
  }
  return res;
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } } | { file_data: { mime_type: string; file_uri: string } };

/** One request whose answer must match `schema`. Retries once if the JSON doesn't validate. */
export async function geminiJson<T>(schema: z.ZodType<T>, system: string, parts: Part[], opts: { temperature?: number } = {}): Promise<T> {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema(schema),
      temperature: opts.temperature ?? 0.2,
    },
  };
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call(`/v1beta/models/${encodeURIComponent(env.geminiModel)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = (await res.json()) as any;
    const cand = out.candidates?.[0];
    if (!cand) throw new GeminiError(`Gemini returned no answer${out.promptFeedback?.blockReason ? ` (blocked: ${out.promptFeedback.blockReason})` : ""}`, true);
    if (cand.finishReason && !["STOP", "MAX_TOKENS"].includes(cand.finishReason)) {
      throw new GeminiError(`Gemini stopped early: ${cand.finishReason}`, cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT");
    }
    const text = (cand.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    try {
      return schema.parse(JSON.parse(text));
    } catch (e) {
      lastError = (e as Error).message.slice(0, 200);
    }
  }
  throw new GeminiError(`Gemini's answer didn't match the expected shape: ${lastError}`, false);
}

/** Inline audio is fine up to ~15 MB; larger files go through the Files API. */
const INLINE_LIMIT = 15 * 1024 * 1024;

/** Gemini's names for the formats phones record in. */
export function geminiAudioMime(mime: string) {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "audio/mp3";
  if (m.includes("wav")) return "audio/wav";
  if (m.includes("flac")) return "audio/flac";
  if (m.includes("ogg") || m.includes("opus")) return "audio/ogg";
  if (m.includes("aiff")) return "audio/aiff";
  if (m.includes("m4a") || m.includes("mp4") || m.includes("aac")) return "audio/aac";
  return m;
}

export async function audioPart(data: Buffer, mime: string): Promise<Part> {
  const mt = geminiAudioMime(mime);
  if (data.length <= INLINE_LIMIT) return { inline_data: { mime_type: mt, data: data.toString("base64") } };
  // Resumable upload: start, then send the bytes and finalise in one go.
  const start = await call(`/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.length),
      "X-Goog-Upload-Header-Content-Type": mt,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "call-recording" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new GeminiError("Gemini didn't return an upload URL", false);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Length": String(data.length) },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!up.ok) throw new GeminiError(`Gemini upload failed: ${up.status}`, false);
  let file = ((await up.json()) as any).file;
  for (let i = 0; i < 30 && file?.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    file = (await (await call(`/v1beta/${file.name}`, { method: "GET" })).json()) as any;
  }
  if (!file?.uri || file.state === "FAILED") throw new GeminiError("Gemini couldn't process the recording", true);
  return { file_data: { mime_type: file.mimeType ?? mt, file_uri: file.uri } };
}
