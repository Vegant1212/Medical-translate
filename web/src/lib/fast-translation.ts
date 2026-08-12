const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/$/, "");
const PROTECTED_TOKEN = /https?:\/\/[^\s)\]}]+|\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+|\d+(?:[.,]\d+)?/gi;
// Keep documents below the Gateway's request-rate ceiling. The previous
// 12-row batches made a 321-segment PDF require about 27 requests and the
// free route started returning 503 halfway through. These limits cut that to
// roughly 14 requests while staying well below the API's payload ceiling.
const MAX_BATCH_SEGMENTS = 24;
const MAX_BATCH_CHARS = 16_000;
const MAX_BATCH_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BUILT_IN_TRANSLATOR_LANGUAGES = new Set([
  "ar", "bg", "bn", "cs", "da", "de", "el", "en", "es", "fi", "fr", "hi", "hr", "hu",
  "id", "it", "iw", "ja", "kn", "ko", "lt", "mr", "nl", "no", "pl", "pt", "ro", "ru",
  "sk", "sl", "sv", "ta", "te", "th", "tr", "uk", "vi", "zh", "zh-Hant",
]);

interface BuiltInTranslatorInstance {
  translate: (text: string) => Promise<string>;
  destroy?: () => void;
}

interface BuiltInTranslatorApi {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
  create: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<BuiltInTranslatorInstance>;
}

export function hasBuiltInDocumentTranslator(): boolean {
  return typeof (globalThis as typeof globalThis & { Translator?: BuiltInTranslatorApi }).Translator !== "undefined";
}

const FREE_MODEL_LANGUAGES = new Set(["en", "es", "fr", "pt"]);

export function hasFreeDocumentTranslator(sourceLanguage: string | "auto", targetLanguage: string): boolean {
  if (hasBuiltInDocumentTranslator()) return true;
  if (sourceLanguage === "auto" || typeof Worker === "undefined") return false;
  const source = browserLanguageCode(sourceLanguage);
  const target = browserLanguageCode(targetLanguage);
  return source !== target && FREE_MODEL_LANGUAGES.has(source) && FREE_MODEL_LANGUAGES.has(target);
}

class TranslationBatchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TranslationBatchError";
  }
}

function isProviderUnavailable(error: unknown): boolean {
  return error instanceof TranslationBatchError && error.status !== undefined && RETRYABLE_STATUS.has(error.status);
}

function letterCode(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function protectTokens(text: string): { text: string; restore: (translation: string) => string } {
  const values: { marker: string; value: string }[] = [];
  const masked = text.replace(PROTECTED_TOKEN, (value) => {
    const marker = `ZXQ${letterCode(values.length)}QXZ`;
    values.push({ marker, value });
    return marker;
  });
  return {
    text: masked,
    restore: (translation) => values.reduce(
      // SentencePiece models can render an unknown marker as "ZXQ A QXZ".
      // Match optional separators between its characters so the original
      // number, dose, DOI or URL is always restored byte-for-byte.
      (result, item) => result.replace(
        new RegExp(item.marker.split("").join("[\\s._-]*"), "gi"),
        item.value,
      ),
      translation,
    ),
  };
}

function browserLanguageCode(value: string): string {
  const normalized = value.trim();
  if (/^zh-(?:tw|hk|hant)/i.test(normalized)) return "zh-Hant";
  const base = normalized.split("-")[0]?.toLowerCase() ?? "";
  return base === "he" ? "iw" : base;
}

async function createBuiltInTranslator(input: {
  sourceLanguage: string | "auto";
  targetLanguage: string;
}): Promise<BuiltInTranslatorInstance | undefined> {
  if (input.sourceLanguage === "auto") return undefined;
  const sourceLanguage = browserLanguageCode(input.sourceLanguage);
  const targetLanguage = browserLanguageCode(input.targetLanguage);
  if (
    sourceLanguage === targetLanguage
    || !BUILT_IN_TRANSLATOR_LANGUAGES.has(sourceLanguage)
    || !BUILT_IN_TRANSLATOR_LANGUAGES.has(targetLanguage)
  ) return undefined;

  const translatorApi = (globalThis as typeof globalThis & { Translator?: BuiltInTranslatorApi }).Translator;
  if (!translatorApi) return undefined;
  try {
    const availability = await translatorApi.availability({ sourceLanguage, targetLanguage });
    if (availability === "unavailable") return undefined;
    return await translatorApi.create({ sourceLanguage, targetLanguage });
  } catch (error) {
    console.warn("built-in browser translator unavailable", error);
    return undefined;
  }
}

async function translateWithFreeBrowserModel(input: {
  segments: { id: string; text: string }[];
  sourceLanguage: string | "auto";
  targetLanguage: string;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  onProgress?: (translations: Record<string, string>) => void;
}): Promise<Record<string, string> | undefined> {
  if (!hasFreeDocumentTranslator(input.sourceLanguage, input.targetLanguage)) {
    return undefined;
  }
  const sourceLanguage = browserLanguageCode(input.sourceLanguage);
  const targetLanguage = browserLanguageCode(input.targetLanguage);
  const protectedSegments = input.segments.map((segment) => {
    const protectedItem = protectTokens(segment.text);
    return { id: segment.id, text: protectedItem.text, restore: protectedItem.restore };
  });
  const restorers = new Map(protectedSegments.map((segment) => [segment.id, segment.restore]));
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const worker = new Worker("/local-translator.worker.js", { type: "module" });

  return new Promise<Record<string, string>>((resolve, reject) => {
    const output: Record<string, string> = {};
    const cleanup = () => {
      input.signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("La traducción fue cancelada.", "AbortError"));
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "El motor local no pudo cargarse."));
    };
    worker.onmessage = (event: MessageEvent<{
      type: "status" | "translation" | "complete" | "error";
      requestId: string;
      id?: string;
      text?: string;
      message?: string;
    }>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.type === "status" && message.message) {
        input.onStatus?.(message.message);
      } else if (message.type === "translation" && message.id && message.text) {
        const translated = restorers.get(message.id)?.(message.text) ?? message.text;
        output[message.id] = translated;
        input.onProgress?.({ [message.id]: translated });
      } else if (message.type === "complete") {
        cleanup();
        resolve(output);
      } else if (message.type === "error") {
        cleanup();
        reject(new Error(message.message || "El motor local no pudo completar la traducción."));
      }
    };
    input.onStatus?.("Preparando motor local sin costo…");
    worker.postMessage({
      type: "translate",
      requestId,
      sourceLanguage,
      targetLanguage,
      segments: protectedSegments.map(({ id, text }) => ({ id, text })),
    });
  });
}

const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timeout = globalThis.setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    globalThis.clearTimeout(timeout);
    reject(new DOMException("La traducción fue cancelada.", "AbortError"));
  }, { once: true });
});

async function translateBatch(input: {
  texts: { id: string; text: string }[];
  sourceLanguage: string | "auto";
  targetLanguage: string;
  targetVariant?: string;
  signal?: AbortSignal;
}): Promise<{ id: string; text: string }[]> {
  const protectedTexts = input.texts.map((item) => {
    const protectedItem = protectTokens(item.text);
    return { id: item.id, text: protectedItem.text, restore: protectedItem.restore };
  });
  for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: input.signal,
        body: JSON.stringify({
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          targetVariant: input.targetVariant,
          texts: protectedTexts.map(({ id, text }) => ({ id, text })),
        }),
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (attempt === MAX_BATCH_ATTEMPTS - 1) {
        throw new TranslationBatchError("No se pudo conectar con OpenAI.", 503);
      }
      await wait(Math.min(12_000, 1_500 * 2 ** attempt), input.signal);
      continue;
    }
    const data = await response.json().catch(() => ({})) as {
      translations?: { id: string; text: string }[];
      error?: { message?: string; retryAfter?: number };
    };
    if (response.ok && Array.isArray(data.translations)) {
      const restorers = new Map(protectedTexts.map((item) => [item.id, item.restore]));
      return data.translations.map((item) => ({
        ...item,
        text: restorers.get(item.id)?.(item.text) ?? item.text,
      }));
    }
    if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_BATCH_ATTEMPTS - 1) {
      throw new TranslationBatchError(
        data.error?.message ?? "No se pudo completar la traducción rápida.",
        response.status,
      );
    }

    // Vercel may omit Retry-After for both rate limits and upstream 5xx
    // failures. Back off progressively instead of abandoning the document.
    const retrySeconds = Number.isFinite(data.error?.retryAfter)
      ? Math.max(2, data.error!.retryAfter!)
      : Math.min(12, 2 * 2 ** attempt);
    await wait(retrySeconds * 1000, input.signal);
  }
  throw new Error("No se pudo completar la traducción rápida.");
}

export async function translateFastSegments(input: {
  segments: { id: string; text: string }[];
  sourceLanguage: string | "auto";
  targetLanguage: string;
  targetVariant?: string;
  signal?: AbortSignal;
  requireLocal?: boolean;
  onStatus?: (message: string) => void;
  onProgress?: (translations: Record<string, string>) => void;
}): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  let remainingSegments = input.segments;

  // Chrome desktop ships an on-device translation engine. Prefer it because
  // it has no per-document request quota, keeps medical text on the device,
  // and lets the optional clinical review remain a separate AI step.
  const localTranslator = await createBuiltInTranslator(input);
  if (localTranslator) {
    input.onStatus?.("Traduciendo con el motor incluido en Chrome…");
    const deferred: { id: string; text: string }[] = [];
    try {
      for (const segment of input.segments) {
        if (input.signal?.aborted) throw new DOMException("La traducción fue cancelada.", "AbortError");
        const protectedItem = protectTokens(segment.text);
        try {
          const translated = protectedItem.restore(await localTranslator.translate(protectedItem.text));
          if (translated.trim()) {
            output[segment.id] = translated;
            input.onProgress?.({ [segment.id]: translated });
          } else {
            deferred.push(segment);
          }
        } catch (error) {
          if (input.signal?.aborted) throw error;
          deferred.push(segment);
        }
      }
    } finally {
      localTranslator.destroy?.();
    }
    if (deferred.length === 0) return output;
    if (input.requireLocal) {
      throw new Error(`El traductor local dejó ${deferred.length} segmentos pendientes. El avance quedó guardado; pulsa Completar pendientes para reintentarlos.`);
    }
    remainingSegments = deferred;
  }

  if (!localTranslator) {
    try {
      const freeTranslations = await translateWithFreeBrowserModel({
        segments: remainingSegments,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        signal: input.signal,
        onStatus: input.onStatus,
        onProgress: input.onProgress,
      });
      if (freeTranslations) return { ...output, ...freeTranslations };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (input.requireLocal) {
        throw new Error(`No se pudo iniciar el motor local sin costo. ${error instanceof Error ? error.message : "Revisa la conexión para descargarlo por primera vez."}`);
      }
      console.warn("free browser translation unavailable", error);
    }
  }
  if (input.requireLocal) {
    throw new Error("La traducción local sin costo está disponible para español, inglés, francés y portugués. Selecciona el idioma de origen detectado para continuar.");
  }

  const batches: { id: string; text: string }[][] = [];
  let current: { id: string; text: string }[] = [];
  let chars = 0;
  for (const segment of remainingSegments) {
    if (current.length >= MAX_BATCH_SEGMENTS || (current.length > 0 && chars + segment.text.length > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += segment.text.length;
  }
  if (current.length > 0) batches.push(current);

  const queue = [...batches];
  let consecutiveProviderFailures = 0;
  while (queue.length > 0) {
    const texts = queue.shift()!;
    let translations: { id: string; text: string }[];
    try {
      translations = await translateBatch({
          texts,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          targetVariant: input.targetVariant,
          signal: input.signal,
        });
    } catch (error) {
      // A 429/5xx means the provider is unavailable, not that the payload is
      // too large. Splitting it created a retry storm and made recovery less
      // likely. Stop after two failed batches and preserve all completed work.
      if (isProviderUnavailable(error)) {
        consecutiveProviderFailures += 1;
        if (consecutiveProviderFailures >= 2) {
          throw new Error("OpenAI no está disponible temporalmente. El avance quedó guardado; usa Completar pendientes cuando el servicio se restablezca.");
        }
        queue.push(texts);
        await wait(12_000, input.signal);
        continue;
      }

      // Only malformed or incomplete model output benefits from a smaller
      // payload. Preserve progress by trying both halves.
      if (texts.length > 1) {
        const middle = Math.ceil(texts.length / 2);
        queue.unshift(texts.slice(0, middle), texts.slice(middle));
        continue;
      }
      // One difficult row must not cancel the remaining document. Documents
      // performs additional residual passes, so leave this id pending there.
      console.warn("single translation segment deferred", texts[0]?.id, error);
      continue;
    }
    consecutiveProviderFailures = 0;

    const requestedIds = new Set(texts.map((item) => item.id));
    const partial: Record<string, string> = {};
    for (const item of translations) {
      if (requestedIds.has(item.id) && item.text?.trim()) {
        output[item.id] = item.text;
        partial[item.id] = item.text;
      }
    }
    if (Object.keys(partial).length > 0) input.onProgress?.(partial);

    // Successful HTTP responses can still contain truncated JSON or omit an
    // item. Requeue only missing rows, in smaller groups, until every id has a
    // translation or the service returns a real terminal error.
    const missing = texts.filter((item) => !partial[item.id]);
    if (missing.length > 0) {
      if (missing.length === texts.length && texts.length === 1) {
        console.warn("single translation segment omitted", texts[0]?.id);
        continue;
      }
      const middle = Math.max(1, Math.ceil(missing.length / 2));
      queue.unshift(...(missing.length > 1 ? [missing.slice(0, middle), missing.slice(middle)] : [missing]).filter((batch) => batch.length > 0));
    }
  }
  return output;
}
