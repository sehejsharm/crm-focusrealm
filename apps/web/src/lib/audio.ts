/**
 * Call-recording formats the CRM accepts — what phone call recorders,
 * WhatsApp/voice apps and laptops produce. Browsers often leave a file's
 * type empty (or vague) for .m4a/.amr/.3gp, so it's worked out from the
 * extension too.
 */
export const AUDIO_FORMATS = [
  { label: "MP3", exts: ["mp3"], mime: "audio/mpeg" },
  { label: "M4A", exts: ["m4a", "mp4"], mime: "audio/mp4" },
  { label: "WAV", exts: ["wav"], mime: "audio/wav" },
  { label: "AAC", exts: ["aac"], mime: "audio/aac" },
  { label: "OGG / Opus", exts: ["ogg", "oga", "opus"], mime: "audio/ogg" },
  { label: "AMR", exts: ["amr"], mime: "audio/amr" },
  { label: "3GP", exts: ["3gp", "3gpp"], mime: "audio/3gpp" },
  { label: "WebM", exts: ["webm"], mime: "audio/webm" },
  { label: "FLAC", exts: ["flac"], mime: "audio/flac" },
] as const;

export const AUDIO_ACCEPT = ["audio/*", ...AUDIO_FORMATS.flatMap((f) => f.exts.map((e) => `.${e}`))].join(",");
export const AUDIO_MAX_MB = 150;

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

/** The file's audio type, or null when it isn't a recording we can take. */
export function audioTypeOf(file: File): string | null {
  const byExt = AUDIO_FORMATS.find((f) => (f.exts as readonly string[]).includes(ext(file.name)));
  if (byExt) return byExt.mime;
  if (file.type.startsWith("audio/")) return file.type;
  return null;
}

/** A human reason the file can't be uploaded, or null when it's fine. */
export function audioProblem(file: File): string | null {
  if (!audioTypeOf(file)) return `${file.name} isn't an audio recording. Use ${AUDIO_FORMATS.map((f) => f.label).join(", ")}.`;
  if (file.size < 1000) return `${file.name} is empty.`;
  if (file.size > AUDIO_MAX_MB * 1024 * 1024) return `${file.name} is over ${AUDIO_MAX_MB} MB.`;
  return null;
}
