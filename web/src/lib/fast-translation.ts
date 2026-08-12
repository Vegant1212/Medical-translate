const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/$/, "");
const PROTECTED_TOKEN = /https?:\/\/[^\s)\]}]+|\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+|\d+(?:[.,]\d+)?/gi;
const MAX_BATCH_SEGMENTS = 12;
const MAX_BATCH_CHARS = 9_000;
const MAX_BATCH_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

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
      (result, item) => result.replace(new RegExp(item.marker, "gi"), item.value),
      translation,
    ),
  };
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
      if (input.signal?.aborted || attempt === MAX_BATCH_ATTEMPTS - 1) throw error;
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
      throw new Error(data.error?.message ?? "No se pudo completar la traducción rápida.");
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
  onProgress?: (translations: Record<string, string>) => void;
}): Promise<Record<string, string>> {
  const batches: { id: string; text: string }[][] = [];
  let current: { id: string; text: string }[] = [];
  let chars = 0;
  for (const segment of input.segments) {
    if (current.length >= MAX_BATCH_SEGMENTS || (current.length > 0 && chars + segment.text.length > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += segment.text.length;
  }
  if (current.length > 0) batches.push(current);

  const output: Record<string, string> = {};
  const queue = [...batches];
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
      // A smaller payload is more likely to pass a congested free-tier route.
      // Preserve progress by trying both halves before surfacing a final error.
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
