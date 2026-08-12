/** Cliente del proxy privado de IA. La clave de OpenAI nunca llega al navegador. */

import { supabase } from "@/lib/supabase";

const TOOLKIT_URL: string =
  ((import.meta.env.EXPO_PUBLIC_TOOLKIT_URL as string | undefined) ?? "https://toolkit.rork.com").replace(/\/$/, "");

const OPENAI_CHAT_URL = "/api/openai/chat";

/** Model used for every medical language task. */
export const MEDICAL_MODEL = "openai/local-secure-proxy" as const;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** Sends a chat completion request through the proxy and returns the raw text. */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    throw new Error("Tu sesión venció. Inicia sesión de nuevo para continuar.");
  }

  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      "Content-Type": "application/json",
    },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model ?? MEDICAL_MODEL,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 8000,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("toolkit chat failed", response.status, detail.slice(0, 400));
    throw new Error(
      response.status === 429
        ? "El servicio de IA está saturado. Espera unos segundos e inténtalo de nuevo."
        : "No se pudo completar la petición de IA. Revisa tu conexión e inténtalo de nuevo.",
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("La IA devolvió una respuesta vacía.");
  }
  return content;
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
    const arrayStart = candidate.indexOf("[");
    const objectStart = candidate.indexOf("{");
    const start = arrayStart < 0 ? objectStart : objectStart < 0 ? arrayStart : Math.min(arrayStart, objectStart);
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

  console.error("parseJson: unparseable model output", raw.slice(0, 300));
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
