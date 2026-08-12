const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const DEFAULT_MODEL = "alibaba/qwen3.7-flash";
const ALLOWED_MODELS = new Set([
  DEFAULT_MODEL,
  "xai/grok-4.1-fast-non-reasoning",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
]);
const MAX_INPUT_CHARS = 220_000;
const MAX_OUTPUT_TOKENS = 16_000;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatRequest {
  model?: string;
  messages?: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

function send(response: { status: (code: number) => { json: (body: unknown) => void } }, status: number, body: unknown) {
  response.status(status).json(body);
}

export default async function handler(
  request: { method?: string; body?: ChatRequest },
  response: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<void> {
  if (request.method !== "POST") {
    send(response, 405, { error: { message: "Method not allowed" } });
    return;
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) {
    send(response, 503, { error: { message: "AI Gateway is not configured" } });
    return;
  }

  const body = request.body;
  const model = body?.model ?? DEFAULT_MODEL;
  const messages = body?.messages;
  if (!ALLOWED_MODELS.has(model) || !Array.isArray(messages) || messages.length === 0 || messages.length > 12) {
    send(response, 400, { error: { message: "Invalid chat request" } });
    return;
  }

  const validMessages = messages.every(
    (message) =>
      message &&
      (message.role === "system" || message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string",
  );
  const inputChars = messages.reduce((total, message) => total + (message.content?.length ?? 0), 0);
  if (!validMessages || inputChars > MAX_INPUT_CHARS) {
    send(response, 413, { error: { message: "Chat request is too large" } });
    return;
  }

  try {
    const gatewayController = new AbortController();
    const gatewayTimeout = setTimeout(() => gatewayController.abort(), 40_000);
    const gatewayResponse = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: gatewayController.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature:
          typeof body?.temperature === "number"
            ? Math.max(0, Math.min(1, body.temperature))
            : 0.2,
        max_tokens:
          typeof body?.max_tokens === "number"
            ? Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Math.floor(body.max_tokens)))
            : 8_000,
        stream: false,
      }),
    });
    clearTimeout(gatewayTimeout);

    const payload = await gatewayResponse.json().catch(() => ({ error: { message: "Invalid gateway response" } }));
    send(response, gatewayResponse.status, payload);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    if (!timedOut) console.error("AI Gateway request failed", error instanceof Error ? error.message : "unknown error");
    send(response, timedOut ? 504 : 502, { error: { message: timedOut ? "AI provider timed out" : "AI provider unavailable" } });
  }
}
