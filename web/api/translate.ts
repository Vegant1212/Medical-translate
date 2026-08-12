const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
// A low-cost, high-throughput model keeps complete documents inside Vercel's
// included monthly credit. Requests are deliberately serialized by the client
// because free-tier accounts have a much lower concurrency limit.
const FAST_MODEL = "openai/gpt-5.4-nano";
const MAX_TEXTS = 50;
const MAX_CHARS = 45_000;

interface TranslateRequest {
  texts?: { id: string; text: string }[];
  sourceLanguage?: string;
  targetLanguage?: string;
  targetVariant?: string;
}

function send(response: { status: (code: number) => { json: (body: unknown) => void } }, status: number, body: unknown) {
  response.status(status).json(body);
}

function parseTranslations(raw: string): { id: string; text: string }[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("El motor devolvió un formato inválido.");
  const value = JSON.parse(raw.slice(start, end + 1)) as { translations?: { id?: unknown; text?: unknown }[] };
  return (value.translations ?? []).flatMap((item) =>
    typeof item.id === "string" && typeof item.text === "string"
      ? [{ id: item.id, text: item.text }]
      : [],
  );
}

export default async function handler(
  request: { method?: string; body?: TranslateRequest },
  response: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  if (request.method !== "POST") {
    send(response, 405, { error: { message: "Method not allowed" } });
    return;
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) {
    send(response, 503, { error: { message: "AI Gateway no está configurado." } });
    return;
  }
  const texts = request.body?.texts;
  const targetLanguage = request.body?.targetLanguage;
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TEXTS || !targetLanguage) {
    send(response, 400, { error: { message: "Solicitud de traducción inválida." } });
    return;
  }
  if (texts.some((item) => typeof item?.id !== "string" || typeof item?.text !== "string") || texts.reduce((sum, item) => sum + item.text.length, 0) > MAX_CHARS) {
    send(response, 413, { error: { message: "El lote de traducción es demasiado grande." } });
    return;
  }

  const source = request.body?.sourceLanguage === "auto" || !request.body?.sourceLanguage
    ? "detecta automáticamente el idioma de origen"
    : `el idioma de origen es ${request.body.sourceLanguage}`;
  const target = request.body?.targetVariant
    ? `${targetLanguage} (${request.body.targetVariant})`
    : targetLanguage;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const gatewayResponse = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: FAST_MODEL,
        temperature: 0,
        max_tokens: Math.max(1200, Math.min(10_000, texts.reduce((sum, item) => sum + item.text.length, 0) * 2)),
        stream: false,
        messages: [
          {
            role: "system",
            content: `Eres un motor profesional de traducción médica. ${source}. Traduce a ${target}. Traduce absolutamente todo el contenido lingüístico, sin resumir ni omitir. Conserva literalmente cualquier marcador con forma ZXQ...QXZ: no lo traduzcas, separes ni modifiques. Conserva carácter por carácter números, dosis, unidades, DOI, URL, códigos y referencias. Mantén cada id y no unas segmentos. Devuelve exclusivamente JSON válido con esta forma: {"translations":[{"id":"id original","text":"traducción completa"}]}.`,
          },
          { role: "user", content: JSON.stringify(texts) },
        ],
      }),
    });
    clearTimeout(timeout);
    const payload = await gatewayResponse.json().catch(() => ({})) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!gatewayResponse.ok) {
      const retryAfter = gatewayResponse.headers.get("retry-after");
      send(response, gatewayResponse.status, {
        error: {
          message: payload.error?.message ?? "El motor rápido no está disponible.",
          retryAfter: retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
        },
      });
      return;
    }
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("El motor devolvió una respuesta vacía.");
    const translations = parseTranslations(content);
    if (translations.length === 0) throw new Error("El motor no devolvió traducciones.");
    send(response, 200, { translations });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    send(response, timedOut ? 504 : 502, {
      error: { message: timedOut ? "El lote tardó demasiado; vuelve a intentarlo." : error instanceof Error ? error.message : "Falló la traducción rápida." },
    });
  } finally {
    clearTimeout(timeout);
  }
}
