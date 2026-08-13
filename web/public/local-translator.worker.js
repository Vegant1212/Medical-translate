// Runs the free translation model outside React's main thread so the page
// remains responsive while the model is downloaded and while it translates.
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const DIRECT_MODELS = new Map([
  ["en:es", { model: "Xenova/opus-mt-en-es" }],
  ["es:en", { model: "Xenova/opus-mt-es-en" }],
  ["en:fr", { model: "Xenova/opus-mt-en-fr" }],
  ["fr:en", { model: "Xenova/opus-mt-fr-en" }],
  ["en:pt", { model: "Xenova/opus-mt-en-ROMANCE", prefix: ">>por<< " }],
  ["pt:en", { model: "Xenova/opus-mt-ROMANCE-en" }],
]);

const pipelinePromises = new Map();

function routeFor(sourceLanguage, targetLanguage) {
  const direct = DIRECT_MODELS.get(`${sourceLanguage}:${targetLanguage}`);
  if (direct) return [direct];
  const toEnglish = DIRECT_MODELS.get(`${sourceLanguage}:en`);
  const fromEnglish = DIRECT_MODELS.get(`en:${targetLanguage}`);
  return toEnglish && fromEnglish ? [toEnglish, fromEnglish] : undefined;
}

function modelChunks(text, limit = 1_200) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf(": "));
    const whitespace = window.lastIndexOf(" ");
    const cut = sentenceEnd >= Math.floor(limit * 0.55) ? sentenceEnd + 1 : whitespace >= Math.floor(limit * 0.55) ? whitespace : limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function resultTexts(result) {
  if (!Array.isArray(result)) return [String(result?.translation_text ?? "")];
  return result.map((item) => String((Array.isArray(item) ? item[0] : item)?.translation_text ?? ""));
}

async function getTranslator(model, requestId) {
  if (!pipelinePromises.has(model)) {
    let lastPercent = -1;
    pipelinePromises.set(model, pipeline("translation", model, {
      dtype: "q8",
      progress_callback: (event) => {
        if (event?.status !== "progress" || !Number.isFinite(event.progress)) return;
        const percent = Math.max(0, Math.min(100, Math.round(event.progress)));
        if (percent === lastPercent) return;
        lastPercent = percent;
        self.postMessage({
          type: "status",
          requestId,
          message: `Descargando motor local… ${percent}%`,
        });
      },
    }));
  }
  return pipelinePromises.get(model);
}

self.onmessage = async (event) => {
  const { type, requestId, sourceLanguage, targetLanguage, segments } = event.data ?? {};
  if (type !== "translate") return;
  try {
    const route = routeFor(sourceLanguage, targetLanguage);
    if (!route) throw new Error("Esta combinación de idiomas aún no tiene un modelo local.");
    let rows = segments.map((segment) => ({ ...segment }));

    for (let routeIndex = 0; routeIndex < route.length; routeIndex += 1) {
      const step = route[routeIndex];
      self.postMessage({
        type: "status",
        requestId,
        message: routeIndex === 0 ? "Preparando motor local sin costo…" : "Completando el cambio de idioma…",
      });
      const translator = await getTranslator(step.model, requestId);
      const pieces = rows.flatMap((row) => modelChunks(row.text).map((text, chunkIndex, chunks) => ({
        id: row.id,
        text: `${step.prefix ?? ""}${text}`,
        chunkIndex,
        chunkCount: chunks.length,
      })));
      const translatedById = new Map(rows.map((row) => [row.id, []]));
      const completedPieces = new Map();
      for (let batchStart = 0; batchStart < pieces.length; batchStart += 6) {
        const batch = pieces.slice(batchStart, batchStart + 6);
        const result = await translator(batch.map((piece) => piece.text), {
            max_new_tokens: 512,
            num_beams: 1,
          });
        const texts = resultTexts(result);
        if (texts.length !== batch.length) throw new Error("El motor local devolvió un lote incompleto.");
        for (let index = 0; index < batch.length; index += 1) {
          const piece = batch[index];
          const translated = texts[index].trim();
          if (!translated) throw new Error(`El motor local no devolvió el segmento ${piece.id}.`);
          translatedById.get(piece.id)[piece.chunkIndex] = translated;
          const done = (completedPieces.get(piece.id) ?? 0) + 1;
          completedPieces.set(piece.id, done);
          if (done === piece.chunkCount && routeIndex === route.length - 1) {
            self.postMessage({
              type: "translation",
              requestId,
              id: piece.id,
              text: translatedById.get(piece.id).join(" "),
            });
          }
        }
      }
      rows = rows.map((row) => ({ id: row.id, text: translatedById.get(row.id).join(" ") }));
    }
    self.postMessage({ type: "complete", requestId });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : "El motor local no pudo iniciar.",
    });
  }
};
