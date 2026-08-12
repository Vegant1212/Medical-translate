/**
 * Thin client for the Rork Toolkit proxy (AI chat completions + Exa web search).
 * Browser builds get delegated auth injected by the runtime, so no key is sent here.
 */

const LEGACY_TOOLKIT_URL = (import.meta.env.EXPO_PUBLIC_TOOLKIT_URL as string | undefined)?.replace(/\/$/, "");
const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/$/, "");

const CHAT_URL = LEGACY_TOOLKIT_URL
  ? `${LEGACY_TOOLKIT_URL}/v2/vercel/v1/chat/completions`
  : `${API_BASE_URL}/api/chat`;

const TOOLKIT_URL = LEGACY_TOOLKIT_URL ?? "https://toolkit.rork.com";

/** Model used for every medical language task. */
export const MEDICAL_MODEL = "alibaba/qwen3.7-flash" as const;
export const FAST_TRANSLATION_MODEL = "xai/grok-4.1-fast-non-reasoning" as const;
export const CLINICAL_REVIEW_MODEL = "openai/gpt-5.4-nano" as const;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  /** Network attempts before returning control to the caller. */
  attempts?: number;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

const CHAT_TIMEOUT_MS = 35_000;

function requestSignal(parent?: AbortSignal): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timeoutReached = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timeoutReached = true;
    controller.abort(new DOMException("La petición tardó demasiado", "TimeoutError"));
  }, CHAT_TIMEOUT_MS);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    cleanup: () => {
      globalThis.clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

/** Sends a chat completion request through the proxy and returns the raw text. */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const maxAttempts = Math.max(1, Math.min(options.attempts ?? 3, 3));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const attemptSignal = requestSignal(options.signal);
    let response: Response;
    try {
      response = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: attemptSignal.signal,
        body: JSON.stringify({
          model: options.model ?? MEDICAL_MODEL,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 8000,
        }),
      });
    } catch (error) {
      const timedOut = attemptSignal.timedOut();
      attemptSignal.cleanup();
      if (options.signal?.aborted) throw error;
      if (timedOut && attempt < maxAttempts - 1) {
        console.warn(`toolkit chat timed out (attempt ${attempt + 1}/${maxAttempts}), retrying…`);
        continue;
      }
      throw new Error(timedOut
        ? "El servicio de IA tardó demasiado en responder. Inténtalo nuevamente."
        : "No se pudo conectar con el servicio de IA.");
    }
    attemptSignal.cleanup();

    if (response.ok) {
      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("La IA devolvió una respuesta vacía.");
      return content;
    }

    const retryable = response.status === 429 || response.status >= 500;
    const detail = await response.text().catch(() => "");
    console.error("toolkit chat failed", response.status, detail.slice(0, 400));
    if (retryable && attempt < maxAttempts - 1) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 900 * (attempt + 1)));
      continue;
    }
    throw new Error(
      response.status === 429
        ? "El servicio de IA está saturado. Espera unos segundos e inténtalo de nuevo."
        : "No se pudo completar la petición de IA. Revisa tu conexión e inténtalo de nuevo.",
    );
  }
  throw new Error("No se pudo completar la petición de IA después de varios intentos.");
}

/**
 * Recovers a truncated JSON array by finding the last complete top-level object
 * and closing the array. Returns undefined if no complete object is found.
 */
function recoverTruncatedArray(partial: string): string | undefined {
  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteEnd = -1;

  for (let i = 0; i < partial.length; i += 1) {
    const char = partial[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\" && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) lastCompleteEnd = i;
    }
  }

  if (lastCompleteEnd < 0) return undefined;
  const prefix = partial.slice(0, lastCompleteEnd + 1).replace(/,\s*$/, "");
  return `${prefix}]`;
}

/**
 * Scans `text` starting at `startIdx` (position of the opening bracket) and returns
 * the index of the matching closing bracket. Uses proper string/escape tracking so
 * brackets inside string literals or nested structures are handled correctly.
 * Returns -1 if no match is found (e.g. truncated output).
 */
function findMatchingBracket(text: string, startIdx: number): number {
  const openChar = text[startIdx];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i += 1) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\" && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === openChar) depth += 1;
    else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Extracts the first JSON object or array from a model response, tolerating
 * code fences, prose preambles, chain-of-thought reasoning, and truncation.
 *
 * The model sometimes emits reasoning text ("*Wait*, I'll just provide the JSON now…")
 * before or around the JSON payload. This function uses proper bracket-matching
 * (not naive lastIndexOf) to find the first syntactically complete JSON value.
 */
export function parseJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/```(?:json|JSON)?/g, "```")
    .trim();

  const fenced = cleaned.match(/```([\s\S]*?)```/);
  const candidates: string[] = [];
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(cleaned.replace(/```/g, "").trim());

  // Strategy 1: Use proper bracket-matching to find the first complete JSON value.
  for (const candidate of candidates) {
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    const end = findMatchingBracket(candidate, start);
    if (end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        /* try next candidate */
      }
    }
  }

  // Strategy 2: Try to recover a truncated JSON array by extracting complete objects.
  for (const candidate of candidates) {
    const start = candidate.indexOf("[");
    if (start < 0) continue;
    const recovered = recoverTruncatedArray(candidate.slice(start));
    if (recovered) {
      try {
        return JSON.parse(recovered) as T;
      } catch {
        /* keep trying */
      }
    }
  }

  // Strategy 3: Scan for individual complete JSON objects in prose-heavy output.
  for (const candidate of candidates) {
    let searchFrom = 0;
    while (true) {
      const objStart = candidate.indexOf("{", searchFrom);
      if (objStart < 0) break;
      const objEnd = findMatchingBracket(candidate, objStart);
      if (objEnd > objStart) {
        try {
          return JSON.parse(candidate.slice(objStart, objEnd + 1)) as T;
        } catch {
          /* try next object */
        }
        searchFrom = objEnd + 1;
      } else {
        break;
      }
    }
  }

  // Do not log model output: it can contain sensitive medical information.
  console.error("parseJson: unparseable model output");
  throw new Error("La IA devolvió un formato inesperado. Inténtalo de nuevo.");
}

/** Convenience: chat + JSON parse with automatic retry on parse failure. */
export async function chatJson<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
  const maxAttempts = 2;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = await chat(messages, options);
    try {
      return parseJson<T>(raw);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`chatJson parse failed (attempt ${attempt + 1}/${maxAttempts}), retrying…`);
    }
  }

  throw lastError ?? new Error("La IA devolvió un formato inesperado. Inténtalo de nuevo.");
}

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  domain: string;
}

interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
}

/** Curated, high-trust domains for cross-checking medical terminology and studies. */
export const MEDICAL_DOMAINS: string[] = [
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "who.int",
  "medlineplus.gov",
  "nih.gov",
  "cochranelibrary.com",
  "bmj.com",
  "nejm.org",
  "thelancet.com",
  "jamanetwork.com",
  "elsevier.es",
  "scielo.org",
  "msdmanuals.com",
  "merckvetmanual.com",
  "woah.org",
  "avma.org",
  "ema.europa.eu",
  "fda.gov",
  "aemps.gob.es",
  "ismp.org",
  "icd.who.int",
  "decs.bvsalud.org",
];

/** Runs a web search through the Exa proxy, optionally limited to trusted medical portals. */
export async function searchMedical(
  query: string,
  options: { numResults?: number; restrictToMedical?: boolean; signal?: AbortSignal } = {},
): Promise<WebSource[]> {
  const response = await fetch(`${TOOLKIT_URL}/v2/exa/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      query,
      numResults: options.numResults ?? 6,
      type: "auto",
      ...(options.restrictToMedical === false ? {} : { includeDomains: MEDICAL_DOMAINS }),
      contents: { text: { maxCharacters: 1200 } },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("exa search failed", response.status, detail.slice(0, 300));
    throw new Error("No se pudo consultar las fuentes científicas en este momento.");
  }

  const data = (await response.json()) as { results?: ExaResult[] };
  return (data.results ?? [])
    .filter((result): result is ExaResult & { url: string } => typeof result.url === "string")
    .map((result) => ({
      title: result.title?.trim() ?? result.url,
      url: result.url,
      snippet: (result.text ?? result.highlights?.join(" ") ?? "").replace(/\s+/g, " ").slice(0, 600),
      publishedDate: result.publishedDate,
      domain: safeDomain(result.url),
    }));
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
