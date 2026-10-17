import { z } from "zod";
import { db, json } from "../db/index.js";
import { env } from "../env.js";
import { audioPart, geminiConfigured, geminiJson } from "./gemini.js";
import { storage } from "./storage.js";
import { queueAnalysisIfImmediate } from "./calls.js";

/**
 * Speech-to-text with speaker labels and timestamps (proposal §8.5).
 * Deepgram is used because it handles Indian English and Hindi–English
 * code-switching ("Hinglish") in one pass with diarisation. Which speaker is
 * the salesperson is decided later by the analyser, from what was said.
 * Without a Deepgram key, Gemini transcribes instead (one free key for both
 * transcription and analysis), with approximate timestamps.
 */

export interface TranscriptUtterance {
  speaker: string;
  role?: "rep" | "prospect";
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface Transcript {
  provider: string;
  language?: string;
  utterances: TranscriptUtterance[];
  roles?: Record<string, "rep" | "prospect">;
}

export const transcriptionConfigured = () => Boolean(env.deepgramApiKey) || (env.aiProvider === "gemini" && geminiConfigured());

const GeminiTranscript = z.object({
  language: z.string().describe("Main language(s), e.g. 'English' or 'Hindi-English mix'"),
  utterances: z
    .array(
      z.object({
        speaker: z.enum(["A", "B", "C"]).describe("A = whoever speaks first, B = the other person, C = anyone else"),
        start: z.number().describe("Start time in seconds from the beginning of the recording"),
        end: z.number().describe("End time in seconds"),
        text: z.string().describe("Exactly what was said, in the original language (Hindi in Devanagari or romanised as spoken)"),
      }),
    )
    .describe("Every turn of the conversation, in order"),
});

async function geminiTranscribe(audio: Buffer, mime: string): Promise<Transcript> {
  const out = await geminiJson(
    GeminiTranscript,
    "You transcribe recorded sales phone calls between a salesperson and a prospect, often in Indian English, Hindi or a mix. Transcribe every word faithfully — don't summarise, translate or correct. Split by speaker turn and label the speakers consistently.",
    [await audioPart(audio, mime), { text: "Transcribe this call recording." }],
    { temperature: 0 },
  );
  return {
    provider: `gemini:${env.geminiModel}`,
    language: out.language,
    utterances: out.utterances
      .filter((u) => u.text.trim())
      .map((u) => ({ speaker: u.speaker, start: +Math.max(0, u.start).toFixed(2), end: +Math.max(u.start, u.end).toFixed(2), text: u.text.trim() })),
  };
}

async function deepgram(audio: Buffer | { url: string }, mime: string): Promise<Transcript> {
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", env.deepgramModel);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("diarize", "true");
  url.searchParams.set("utterances", "true");
  url.searchParams.set("language", env.deepgramLanguage);
  // Deepgram can fetch the file itself from a signed URL, so the audio never
  // has to pass through our (possibly serverless) function.
  const byUrl = !Buffer.isBuffer(audio);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${env.deepgramApiKey}`, "Content-Type": byUrl ? "application/json" : mime },
    body: byUrl ? JSON.stringify({ url: (audio as { url: string }).url }) : new Uint8Array(audio as Buffer),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as any;
  const utterances: TranscriptUtterance[] = (body.results?.utterances ?? []).map((u: any) => ({
    speaker: String.fromCharCode(65 + Number(u.speaker ?? 0)), // 0 → "A"
    start: +Number(u.start).toFixed(2),
    end: +Number(u.end).toFixed(2),
    text: String(u.transcript ?? "").trim(),
    confidence: u.confidence,
  }));
  if (!utterances.length) {
    const text = body.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    if (text) utterances.push({ speaker: "A", start: 0, end: Number(body.metadata?.duration ?? 0), text });
  }
  return {
    provider: `deepgram:${env.deepgramModel}`,
    language: body.results?.channels?.[0]?.detected_language,
    utterances,
  };
}

export async function transcribeCall(callId: string) {
  const call = await db.maybe(`select id, call_code, recording_path, recording_mime, transcript_status, analysis_status from crm_calls where id = $1`, [callId]);
  if (!call?.recording_path) return;
  if (!transcriptionConfigured()) {
    await db.query(`update crm_calls set transcript_status = 'skipped', analysis_status = case when analysis_status = 'queued' then 'none' else analysis_status end where id = $1`, [callId]);
    return;
  }
  await db.query(`update crm_calls set transcript_status = 'processing' where id = $1`, [callId]);
  const mime = call.recording_mime ?? "audio/mpeg";
  // Deepgram fetches the file itself from a signed URL; Gemini gets the bytes.
  const signed = env.deepgramApiKey ? await storage.signedUrl(call.recording_path, 1800) : null;
  const audio = signed ? { url: signed } : await storage.read(call.recording_path);
  if (!audio) throw new Error(`Recording ${call.recording_path} is missing from storage`);
  try {
    const transcript = env.deepgramApiKey ? await deepgram(audio, mime) : await geminiTranscribe(audio as Buffer, mime);
    const duration = transcript.utterances.at(-1)?.end;
    await db.query(
      `update crm_calls set transcript = $2::jsonb, transcript_status = 'done',
         duration_sec = coalesce(duration_sec, $3) where id = $1`,
      [callId, json(transcript), duration ? Math.round(duration) : null],
    );
  } catch (e) {
    await db.query(`update crm_calls set transcript_status = 'failed' where id = $1`, [callId]);
    throw e;
  }
  // Analyse now if the founders chose "immediate", or if the end-of-day run
  // is already waiting on this call.
  await queueAnalysisIfImmediate(callId, call.analysis_status === "queued");
}
