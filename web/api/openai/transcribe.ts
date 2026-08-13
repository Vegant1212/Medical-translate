import type { IncomingMessage, ServerResponse } from "node:http";
interface RequestBody { audio?: string; filename?: string; mediaType?: string }
function send(response: ServerResponse, status: number, body: unknown): void { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(body)); }
async function readJson(request: IncomingMessage): Promise<RequestBody> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const part = Buffer.from(chunk); size += part.byteLength; if (size > 4_000_000) throw new Error("PAYLOAD_TOO_LARGE"); chunks.push(part); } return JSON.parse(Buffer.concat(chunks).toString("utf8")) as RequestBody; }
export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") return send(response, 405, { error: { message: "Método no permitido." } });
  const apiKey = process.env.OPENAI_API_KEY; const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL; const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY; const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!apiKey || !supabaseUrl || !publishableKey) return send(response, 500, { error: { message: "El servicio no está configurado." } });
  if (!token) return send(response, 401, { error: { message: "Inicia sesión para continuar." } });
  try {
    const auth = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: publishableKey, Authorization: `Bearer ${token}` } });
    if (!auth.ok) return send(response, 401, { error: { message: "La sesión no es válida." } });
    const body = await readJson(request); if (!body.audio || body.audio.length > 3_800_000) return send(response, 413, { error: { message: "El audio es demasiado grande." } });
    const form = new FormData(); form.append("model", "gpt-4o-mini-transcribe"); form.append("response_format", "verbose_json"); form.append("timestamp_granularities[]", "segment"); form.append("file", new Blob([Buffer.from(body.audio, "base64")], { type: body.mediaType || "audio/mpeg" }), body.filename || "audio.mp3");
    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    const data = await upstream.json(); if (!upstream.ok) { console.error("OpenAI transcription failed", upstream.status); return send(response, upstream.status === 429 ? 429 : 502, { error: { message: "OpenAI no pudo transcribir el audio." } }); } send(response, 200, data);
  } catch (error) { console.error("Private transcription endpoint failed", error); send(response, error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? 413 : 500, { error: { message: "No se pudo procesar la transcripción." } }); }
}
