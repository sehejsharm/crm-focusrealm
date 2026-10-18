import { api } from "./api";
import { audioProblem, audioTypeOf } from "./audio";
import type { Call } from "./types";

/**
 * Uploads a call recording. With cloud storage (Cloudflare R2 or Supabase)
 * the file goes straight to storage through a short-lived signed URL (no size
 * limit from the API — Vercel functions cap request bodies at 4.5 MB);
 * otherwise it's posted to the API.
 */
export async function uploadRecording(callId: string, file: File, onProgress?: (pct: number) => void): Promise<Call> {
  const problem = audioProblem(file);
  if (problem) throw new Error(problem);
  const mime = audioTypeOf(file) ?? "audio/mpeg";
  const target = await api.post<{ mode: "direct" | "api"; url: string; headers?: Record<string, string>; key?: string; mime?: string }>(`/calls/${callId}/recording/upload-url`, { mime });
  if (target.mode === "api") {
    const form = new FormData();
    form.append("file", file);
    onProgress?.(50);
    const r = await api.upload<{ call: Call }>(`/calls/${callId}/recording`, form);
    onProgress?.(100);
    return r.call;
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.url);
    xhr.setRequestHeader("Content-Type", target.mime ?? mime);
    for (const [name, value] of Object.entries(target.headers ?? {})) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 95));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.send(file);
  });
  const r = await api.post<{ call: Call }>(`/calls/${callId}/recording/complete`, { key: target.key, mime: target.mime ?? mime });
  onProgress?.(100);
  return r.call;
}
