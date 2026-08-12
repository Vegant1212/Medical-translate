const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/$/, "");
const PROTECTED_TOKEN = /https?:\/\/[^\s)\]}]+|\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+|\d+(?:[.,]\d+)?/gi;

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
  const timeout = window.setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    window.clearTimeout(timeout);
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${API_BASE_URL}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: input.signal,
      body: JSON.stringify({
        ...input,
        texts: protectedTexts.map(({ id, text }) => ({ id, text })),
      }),
    });
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
    if (response.status !== 429 || attempt === 2) {
      throw new Error(data.error?.message ?? "No se pudo completar la traducción rápida.");
    }

    // Vercel may omit Retry-After. Back off progressively so the free-tier
    // window can reopen instead of abandoning the entire document.
    const retrySeconds = Number.isFinite(data.error?.retryAfter)
      ? Math.max(5, data.error!.retryAfter!)
      : 5 * (attempt + 1);
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
    if (current.length >= 50 || (current.length > 0 && chars + segment.text.length > 40_000)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += segment.text.length;
  }
  if (current.length > 0) batches.push(current);

  const output: Record<string, string> = {};
  for (const texts of batches) {
      const translations = await translateBatch({
        texts,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        targetVariant: input.targetVariant,
        signal: input.signal,
      });
      for (const item of translations) {
        if (item.id && item.text?.trim()) output[item.id] = item.text;
      }
      input.onProgress?.(Object.fromEntries(
        translations.filter((item) => item.id && item.text?.trim()).map((item) => [item.id, item.text]),
      ));
  }
  return output;
}
