import assert from "node:assert/strict";
import { test } from "node:test";

process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "gemini-test";

const { z } = await import("zod");
const { geminiAudioMime, geminiJson, audioPart, GeminiError } = await import("../services/gemini.js");

const realFetch = globalThis.fetch;
function mockFetch(fn: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return fn(String(url), init);
  }) as typeof fetch;
  return calls;
}
const answer = (text: string, finishReason = "STOP") =>
  new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 });

test("geminiJson sends a JSON-schema request and validates the answer", async (t) => {
  t.after(() => (globalThis.fetch = realFetch));
  const calls = mockFetch(() => answer(JSON.stringify({ name: "Asha", score: 7 })));
  const out = await geminiJson(z.object({ name: z.string(), score: z.number() }), "sys", [{ text: "hi" }]);
  assert.deepEqual(out, { name: "Asha", score: 7 });
  assert.match(calls[0].url, /\/v1beta\/models\/gemini-test:generateContent$/);
  assert.equal((calls[0].init.headers as any)["x-goog-api-key"], "test-key");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.responseJsonSchema.$schema, undefined);
  assert.deepEqual(body.generationConfig.responseJsonSchema.required, ["name", "score"]);
  assert.equal(body.systemInstruction.parts[0].text, "sys");
});

test("geminiJson retries once when the JSON doesn't match, then gives up", async (t) => {
  t.after(() => (globalThis.fetch = realFetch));
  const calls = mockFetch(() => answer(JSON.stringify({ name: 3 })));
  await assert.rejects(geminiJson(z.object({ name: z.string() }), "s", [{ text: "x" }]), (e: any) => e instanceof GeminiError && !e.permanent);
  assert.equal(calls.length, 2);
});

test("quota errors are retryable, bad keys are permanent", async (t) => {
  t.after(() => (globalThis.fetch = realFetch));
  mockFetch(() => new Response("quota", { status: 429 }));
  await assert.rejects(geminiJson(z.object({}), "s", [{ text: "x" }]), (e: any) => e instanceof GeminiError && !e.permanent);
  mockFetch(() => new Response("bad key", { status: 403 }));
  await assert.rejects(geminiJson(z.object({}), "s", [{ text: "x" }]), (e: any) => e instanceof GeminiError && e.permanent);
});

test("small recordings go inline, with Gemini's audio type names", async () => {
  const part = (await audioPart(Buffer.from("abc"), "audio/x-m4a")) as any;
  assert.equal(part.inline_data.mime_type, "audio/aac");
  assert.equal(part.inline_data.data, Buffer.from("abc").toString("base64"));
  assert.equal(geminiAudioMime("audio/mpeg"), "audio/mp3");
  assert.equal(geminiAudioMime("audio/ogg; codecs=opus"), "audio/ogg");
  assert.equal(geminiAudioMime("audio/wav"), "audio/wav");
});
