import { api } from "./api";
import type { Call } from "./types";

/**
 * Uploads a call recording. With Supabase Storage the file goes straight to
 * storage through a one-time signed URL (no size limit from the API — Vercel
 * functions cap request bodies at 4.5 MB); otherwise it's posted to the API.
 */
export async function uploadRecording(callId: string, file: File, onProgress?: (pct: number) => void): Promise<Call> {
  const mime = file.type || "audio/mpeg";
  const target = await api.post<{ mode: "direct" | "api"; url: string; key?: string; mime?: string }>(`/calls/${callId}/recording/upload-url`, { mime });
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
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 95));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.send(file);
  });
  const r = await api.post<{ call: Call }>(`/calls/${callId}/recording/complete`, { key: target.key, mime: target.mime ?? mime });
  onProgress?.(100);
  return r.call;
}
