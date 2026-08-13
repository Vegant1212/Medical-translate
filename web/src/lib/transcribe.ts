/**
 * Audio/video transcription, subtitle generation, and translation pipeline.
 * Uses Vercel AI Gateway speech-to-text through the Rork Toolkit proxy,
 * then translates transcript segments via the medical translation engine.
 */

import { chat, chatJson, MEDICAL_MODEL } from "./toolkit";
import { DOMAINS, REGISTERS, localeDescriptor, type MedicalDomain, type RegisterLevel } from "./languages";

const TOOLKIT_URL: string =
  ((import.meta.env.EXPO_PUBLIC_TOOLKIT_URL as string | undefined) ?? "https://toolkit.rork.com").replace(/\/$/, "");

export const TRANSCRIPTION_MODEL = "xai/grok-stt" as const;
export const TRANSCRIPTION_FALLBACK = "openai/gpt-4o-mini-transcribe" as const;

/** Accepted video/audio extensions for the drop zone. */
export const VIDEO_EXTENSIONS = ".mp4,.webm,.mov,.avi,.mkv,.m4a,.mp3,.wav,.ogg,.aac,.flac,.opus";

/** Max file size: 100 MB for video/audio (we only need the audio track). */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export interface TranscriptSegment {
  /** Sequence index. */
  index: number;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** Transcript text. */
  text: string;
}

export interface TranscriptionResult {
  /** Full transcript text. */
  text: string;
  /** Detected language (ISO 639-1). */
  language: string;
  /** Total audio duration in seconds. */
  duration: number;
  /** Segmented transcript with timestamps. */
  segments: TranscriptSegment[];
}

interface GatewayTranscriptionResponse {
  text?: string;
  language?: string;
  durationInSeconds?: number;
  segments?: Array<{
    text?: string;
    start?: number;
    end?: number;
    id?: number;
  }>;
}

interface ScribeWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

interface ScribeSegment {
  text: string;
  start: number;
  end: number;
}

interface ScribeResponse {
  text?: string;
  language_code?: string;
  words?: ScribeWord[];
  segments?: ScribeSegment[];
  audio_duration_secs?: number;
}

/** Reads a File into a base64 string without the data-URI prefix. */
export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo de audio."));
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts the audio track from a video/audio File using the browser's
 * MediaRecorder + HTMLMediaElement pipeline. Returns a WebM/Opus blob.
 */
export async function extractAudioFromFile(
  file: File,
  onProgress?: (currentTime: number, totalTime: number) => void,
): Promise<{ blob: Blob; mediaType: string }> {
  // If already a pure audio format, use it directly.
  const name = file.name.toLowerCase();
  const audioExtensions = [".mp3", ".wav", ".ogg", ".aac", ".flac", ".opus", ".m4a"];
  if (audioExtensions.some((ext) => name.endsWith(ext))) {
    const mediaType = file.type || guessAudioMime(name);
    onProgress?.(1, 1);
    return { blob: file, mediaType: mediaType || "audio/mpeg" };
  }

  // For video files, decode via an <audio> element and re-encode with MediaRecorder.
  const url = URL.createObjectURL(file);
  try {
    const audioEl = new Audio();
    audioEl.src = url;
    audioEl.crossOrigin = "anonymous";
    // Browsers block audible autoplay once the original file-picker gesture has
    // finished. Muted playback is allowed and the MediaElementSource still
    // supplies the audio samples to the recorder without playing them aloud.
    audioEl.muted = true;
    audioEl.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      audioEl.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audioEl.addEventListener("error", () => reject(new Error("No se pudo cargar el archivo de audio/vídeo.")), {
        once: true,
      });
    });

    // Use Web Audio API to capture and re-encode
    const AudioCtxClass: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtxClass();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume().catch(() => undefined);
    }
    const source = audioCtx.createMediaElementSource(audioEl);

    // Create a MediaStreamDestination to capture audio
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);

    // Pick the best supported mime type
    const mimeType = pickRecorderMime();
    const recorder = new MediaRecorder(dest.stream, { mimeType });
    const chunks: Blob[] = [];

    const recordingDone = new Promise<Blob>((resolve) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        resolve(new Blob(chunks, { type: mimeType }));
      });
    });

    recorder.start(1000);
    const reportProgress = (): void => {
      if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        onProgress?.(audioEl.currentTime, audioEl.duration);
      }
    };
    audioEl.addEventListener("timeupdate", reportProgress);
    reportProgress();
    try {
      await audioEl.play();
    } catch (error) {
      recorder.stop();
      await audioCtx.close();
      throw new Error(
        "El navegador bloqueó la extracción automática del audio. Pulsa nuevamente el archivo para autorizar el procesamiento.",
        { cause: error },
      );
    }

    // Wait for playback to finish
    await new Promise<void>((resolve) => {
      audioEl.addEventListener("ended", () => resolve(), { once: true });
    });

    recorder.stop();
    const blob = await recordingDone;
    onProgress?.(audioEl.duration || 1, audioEl.duration || 1);
    audioEl.removeEventListener("timeupdate", reportProgress);
    audioCtx.close();

    return { blob, mediaType: mimeType };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pickRecorderMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "audio/webm";
}

function guessAudioMime(name: string): string {
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".opus")) return "audio/opus";
  if (name.endsWith(".m4a")) return "audio/mp4";
  return "audio/mpeg";
}

/** Transcribes audio via Vercel AI Gateway speech-to-text through the Toolkit proxy. */
async function transcribeWithGateway(
  audioBase64: string,
  mediaType: string,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const response = await fetch(`${TOOLKIT_URL}/v2/vercel/v4/ai/transcription-model`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ai-model-id": TRANSCRIPTION_MODEL,
      "ai-gateway-protocol-version": "0.0.1",
    },
    signal,
    body: JSON.stringify({ audio: audioBase64, mediaType }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("gateway transcription failed", response.status, detail.slice(0, 300));
    throw new Error(
      response.status === 429
        ? "El servicio de transcripción está saturado. Inténtalo de nuevo en unos segundos."
        : "No se pudo transcribir el audio. Revisa el archivo e inténtalo de nuevo.",
    );
  }

  const data = (await response.json()) as GatewayTranscriptionResponse;
  const segments: TranscriptSegment[] = (data.segments ?? [])
    .filter((seg) => typeof seg.text === "string" && seg.text!.trim().length > 0)
    .map((seg, index) => ({
      index,
      start: seg.start ?? 0,
      end: seg.end ?? 0,
      text: seg.text!.trim(),
    }));

  return {
    text: data.text ?? segments.map((s) => s.text).join(" "),
    language: data.language ?? "unknown",
    duration: data.durationInSeconds ?? segments[segments.length - 1]?.end ?? 0,
    segments,
  };
}

/** Transcribes audio via ElevenLabs Scribe through the Toolkit proxy (fallback with word timestamps). */
async function transcribeWithScribe(
  audioBlob: Blob,
  signal?: AbortSignal,
  onUploadProgress?: (loaded: number, total: number) => void,
): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append("model_id", "scribe_v2");
  formData.append("diarize", "true");
  formData.append("file", audioBlob, audioBlob instanceof File ? audioBlob.name : "audio.webm");

  // XMLHttpRequest is used here because fetch does not expose upload progress.
  // This is especially important for large video files, where an indeterminate
  // loader otherwise looks frozen while the browser is still uploading.
  const data = await new Promise<ScribeResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = (): void => xhr.abort();
    xhr.open("POST", `${TOOLKIT_URL}/v2/elevenlabs/v1/speech-to-text`);
    xhr.upload.addEventListener("progress", (event) => {
      onUploadProgress?.(event.loaded, event.lengthComputable ? event.total : audioBlob.size);
    });
    xhr.addEventListener("load", () => {
      signal?.removeEventListener("abort", abort);
      if (xhr.status < 200 || xhr.status >= 300) {
        console.error("scribe transcription failed", xhr.status, xhr.responseText.slice(0, 300));
        reject(new Error("No se pudo transcribir el archivo. Inténtalo de nuevo."));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as ScribeResponse);
      } catch {
        reject(new Error("El servicio devolvió una respuesta inválida al transcribir."));
      }
    });
    xhr.addEventListener("error", () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error("Se interrumpió la subida del archivo. Revisa tu conexión e inténtalo de nuevo."));
    });
    xhr.addEventListener("abort", () => {
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("La transcripción fue cancelada.", "AbortError"));
    });
    if (signal?.aborted) {
      reject(new DOMException("La transcripción fue cancelada.", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(formData);
  });

  // Build segments from word-level timestamps, grouping into ~5s windows
  const words = data.words ?? [];
  const segments: TranscriptSegment[] = [];
  if (words.length > 0) {
    let currentText: string[] = [];
    let segStart = words[0]?.start ?? 0;
    let segEnd = segStart;

    for (const word of words) {
      currentText.push(word.text);
      segEnd = word.end;
      // Start a new segment every ~5 seconds or at sentence boundaries
      if (segEnd - segStart >= 5 || word.text.match(/[.!?]$/)) {
        if (currentText.length > 0) {
          segments.push({
            index: segments.length,
            start: segStart,
            end: segEnd,
            text: currentText.join(" ").trim(),
          });
        }
        currentText = [];
        segStart = word.end;
      }
    }
    if (currentText.length > 0) {
      segments.push({
        index: segments.length,
        start: segStart,
        end: segEnd,
        text: currentText.join(" ").trim(),
      });
    }
  } else if (data.segments) {
    for (const [i, seg] of data.segments.entries()) {
      segments.push({ index: i, start: seg.start, end: seg.end, text: seg.text.trim() });
    }
  }

  return {
    text: data.text ?? segments.map((s) => s.text).join(" "),
    language: data.language_code ?? "unknown",
    duration: data.audio_duration_secs ?? segments[segments.length - 1]?.end ?? 0,
    segments,
  };
}

/**
 * Full transcription pipeline: extracts audio, tries Gateway STT first,
 * falls back to ElevenLabs Scribe for word-level timestamps.
 */
export async function transcribeMedia(
  file: File,
  onProgress?: (stage: string, mediaProgress?: { current: number; total: number; unit: "seconds" | "bytes" }) => void,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("El archivo supera los 100 MB. Usa un fragmento más corto.");
  }

  const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name);

  // Upload video files directly. Browser-based audio extraction requires
  // real-time media playback and can hang because of autoplay/codec policies.
  if (isVideo) {
    onProgress?.("Subiendo video para transcripción…", { current: 0, total: file.size, unit: "bytes" });
    return transcribeWithScribe(file, signal, (loaded, total) => {
      onProgress?.("Subiendo video para transcripción…", {
        current: loaded,
        total: total || file.size,
        unit: "bytes",
      });
    });
  }

  onProgress?.("Preparando audio…");
  const { blob, mediaType } = await extractAudioFromFile(file, (currentTime, totalTime) => {
    onProgress?.("Preparando audio…", { current: currentTime, total: totalTime, unit: "seconds" });
  });

  // Gateway has a smaller payload limit, so for large audio use Scribe (multipart upload).
  const useScribe = blob.size > 20 * 1024 * 1024;

  if (!useScribe) {
    onProgress?.("Transcribiendo audio (AI Gateway)…");
    try {
      const audioBase64 = await fileToBase64(blob);
      return await transcribeWithGateway(audioBase64, mediaType, signal);
    } catch (error) {
      console.warn("gateway transcription failed, falling back to Scribe", error);
    }
  }

  onProgress?.("Subiendo audio para transcripción…", { current: 0, total: blob.size, unit: "bytes" });
  return await transcribeWithScribe(blob, signal, (loaded, total) => {
    onProgress?.("Subiendo audio para transcripción…", {
      current: loaded,
      total: total || blob.size,
      unit: "bytes",
    });
  });
}

export interface SubtitleSegment {
  index: number;
  start: number;
  end: number;
  original: string;
  translated: string;
  edited?: boolean;
}

/** Formats seconds as SRT timestamp: HH:MM:SS,mmm */
export function formatSrtTime(seconds: number): string {
  const ms = Math.floor((seconds % 1) * 1000);
  const totalSeconds = Math.floor(seconds);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/** Formats seconds as VTT timestamp: HH:MM:SS.mmm */
export function formatVttTime(seconds: number): string {
  const ms = Math.floor((seconds % 1) * 1000);
  const totalSeconds = Math.floor(seconds);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** Builds an SRT subtitle file from translated segments. */
export function buildSrt(segments: SubtitleSegment[]): string {
  return segments
    .map((seg) => {
      return `${seg.index + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.translated}`;
    })
    .join("\n\n");
}

/** Builds a WebVTT subtitle file from translated segments. */
export function buildVtt(segments: SubtitleSegment[]): string {
  const body = segments
    .map((seg) => {
      return `${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${seg.translated}`;
    })
    .join("\n\n");
  return `WEBVTT\n\n${body}`;
}

/** Builds a bilingual subtitle file (original + translation) for SRT. */
export function buildBilingualSrt(segments: SubtitleSegment[]): string {
  return segments
    .map((seg) => {
      return `${seg.index + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.original}\n${seg.translated}`;
    })
    .join("\n\n");
}

export interface TranslateSubtitleOptions {
  segments: TranscriptSegment[];
  targetLanguage: string;
  targetVariant?: string;
  sourceLanguage: string | "auto";
  register: RegisterLevel;
  domain: MedicalDomain;
  glossary: { source: string; target: string }[];
  signal?: AbortSignal;
}

const BASE_ROLE = `Eres un traductor médico certificado especializado en contenido audiovisual sanitario: conferencias, clases magistrales, vídeos para pacientes, documentales médicos y presentaciones clínicas.
Dominas MeSH, DeCS, SNOMED CT, CIE-11, DCI/INN y terminología veterinaria (WOAH/OIE).
Reglas inviolables:
- Conserva cifras, dosis, unidades, vías y valores exactos.
- Mantén la concisión: el texto traducido debe caber en un subtítulo (máx. 2 líneas, ~42 caracteres por línea).
- No inventes datos ni omitas información clínica.
- Usa la sigla estándar del idioma destino; añade la original entre paréntesis solo la primera vez.`;

function registerInstruction(register: RegisterLevel): string {
  return REGISTERS.find((item) => item.id === register)?.instruction ?? "";
}

function domainInstruction(domain: MedicalDomain): string {
  return DOMAINS.find((item) => item.id === domain)?.instruction ?? "";
}

/** Translates transcript segments in batches, preserving timing IDs. */
export async function translateSubtitles(
  options: TranslateSubtitleOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string>> {
  const glossaryBlock =
    options.glossary.length > 0
      ? `\nGLOSARIO OBLIGATORIO:\n${options.glossary.map((g) => `- "${g.source}" => "${g.target}"`).join("\n")}`
      : "";

  const system = `${BASE_ROLE}

TAREA: traducir los segmentos de una transcripción de vídeo médico a ${localeDescriptor(options.targetLanguage, options.targetVariant)}.
Origen: ${options.sourceLanguage === "auto" ? "detéctalo automáticamente" : localeDescriptor(options.sourceLanguage)}.
REGISTRO: ${registerInstruction(options.register)}
${domainInstruction(options.domain)}${glossaryBlock}

REGLAS CRÍTICAS:
- Traduce cada segmento por separado, devuelve exactamente el mismo "id".
- Sé conciso: máximo 84 caracteres por segmento (para subtítulos).
- No fusiones ni dividas segmentos.
- Si un segmento es solo ruido, música o ininteligible, devuélvelo idéntico.
Devuelve EXCLUSIVAMENTE un array JSON: [{"id":"s0","t":"traducción"}]`;

  const map: Record<string, string> = {};
  const batchSize = 12;
  const batches: TranscriptSegment[][] = [];
  for (let i = 0; i < options.segments.length; i += batchSize) {
    batches.push(options.segments.slice(i, i + batchSize));
  }

  let done = 0;
  const total = options.segments.length;

  for (const batch of batches) {
    const result = await chatJson<{ id: string; t: string }[]>(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify(
            batch.map((seg) => ({ id: `s${seg.index}`, t: seg.text })),
          ),
        },
      ],
      { temperature: 0.15, maxTokens: 8000, signal: options.signal },
    );

    for (const item of Array.isArray(result) ? result : []) {
      if (typeof item?.id === "string" && typeof item?.t === "string") {
        map[item.id] = item.t;
      }
    }
    done += batch.length;
    onProgress?.(done, total);
  }

  return map;
}

/** Generates a medical summary / key points from a transcript using the chat model. */
export async function summarizeTranscript(
  text: string,
  language: string,
  domain: MedicalDomain,
  signal?: AbortSignal,
): Promise<string> {
  const system = `${BASE_ROLE}

TAREA: resume un vídeo médico transcripto en ${language === "auto" ? "el idioma detectado" : localeDescriptor(language)}.
${domainInstruction(domain)}
Extrae los puntos clave, hallazgos clínicos, dosis mencionadas, nombres de fármacos y conclusiones.
Devuelve un resumen estructurado en texto plano (máx. 600 palabras), sin JSON.`;

  const result = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: text.slice(0, 12000) },
    ],
    { temperature: 0.2, maxTokens: 4000, model: MEDICAL_MODEL, signal },
  );
  return result.trim();
}

/** Detects the medical specialty from a transcript. */
export async function detectSpecialty(text: string, signal?: AbortSignal): Promise<string> {
  const system = `${BASE_ROLE}

TAREA: identifica la especialidad médica principal del siguiente contenido.
Devuelve únicamente el nombre de la especialidad (máx. 60 caracteres), sin JSON ni explicación.`;

  const result = await chat(
    [
      { role: "system", content: system },
      { role: "user", content: text.slice(0, 3000) },
    ],
    { temperature: 0.1, maxTokens: 100, model: MEDICAL_MODEL, signal },
  );
  return result.trim();
}
