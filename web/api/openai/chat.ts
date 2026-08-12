import type { IncomingMessage, ServerResponse } from "node:http";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface RequestBody {
  messages?: ChatMessage[];
  max_tokens?: number;
}

interface OpenAIResponse {
  error?: { message?: string };
  output_text?: string;
  output?: { content?: { type?: string; text?: string }[] }[];
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = Buffer.from(chunk);
    size += part.byteLength;
    if (size > 1_000_000) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as RequestBody;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    send(response, 405, { error: { message: "Método no permitido." } });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!apiKey || !supabaseUrl || !publishableKey) {
    send(response, 500, { error: { message: "El servicio aún no está configurado." } });
    return;
  }
  if (!token) {
    send(response, 401, { error: { message: "Inicia sesión para continuar." } });
    return;
  }

  try {
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
    });
    if (!authResponse.ok) {
      send(response, 401, { error: { message: "La sesión no es válida." } });
      return;
    }

    const body = await readJson(request);
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
      send(response, 400, { error: { message: "La solicitud de traducción no es válida." } });
      return;
    }
    if (messages.some((message) => !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length > 250_000)) {
      send(response, 400, { error: { message: "El contenido excede los límites permitidos." } });
      return;
    }

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        input: messages,
        max_output_tokens: Math.min(Math.max(body.max_tokens ?? 8000, 256), 16_000),
        reasoning: { effort: "low" },
        text: { verbosity: "low" },
      }),
    });
    const data = (await upstream.json()) as OpenAIResponse;
    if (!upstream.ok) {
      console.error("OpenAI request failed", upstream.status, data.error?.message);
      send(response, upstream.status === 429 ? 429 : 502, { error: { message: "No se pudo completar la traducción." } });
      return;
    }

    const content = data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
    send(response, 200, { choices: [{ message: { content } }] });
  } catch (error) {
    console.error("Private OpenAI endpoint failed", error);
    send(response, error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? 413 : 500, {
      error: { message: "No se pudo conectar con el servicio de traducción." },
    });
  }
}
