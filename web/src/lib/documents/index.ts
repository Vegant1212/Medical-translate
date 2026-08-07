/** Entry point for document parsing + rebuilding across PDF / DOCX / PPTX. */

import { buildTranslatedOffice, parseOffice } from "./office";
import { buildTranslatedPdf, parsePdf } from "./pdf";
import { kindFromFile, type ParsedDocument } from "./types";

export * from "./types";
export { extractPdfText } from "./pdf";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Parses any supported document into translatable segments. */
export async function parseDocument(file: File): Promise<ParsedDocument> {
  const kind = kindFromFile(file);
  if (!kind) {
    throw new Error("Formato no admitido. Sube un archivo .pdf, .docx o .pptx.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("El archivo supera los 25 MB. Divídelo en partes más pequeñas.");
  }
  if (kind === "pdf") return parsePdf(file);
  return parseOffice(file, kind);
}

/** Rebuilds the document in its original format with the edited translations applied. */
export async function buildTranslatedDocument(
  document: ParsedDocument,
  translations: Record<string, string>,
): Promise<{ blob: Blob; warnings: string[]; fileName: string }> {
  const baseName = document.fileName.replace(/\.(pdf|docx|pptx)$/i, "");
  if (document.kind === "pdf") {
    const result = await buildTranslatedPdf({
      bytes: document.bytes,
      blocks: document.blocks ?? [],
      translations,
    });
    return { ...result, fileName: `${baseName}-traducido.pdf` };
  }
  const result = await buildTranslatedOffice({
    bytes: document.bytes,
    kind: document.kind,
    translations,
  });
  return { ...result, fileName: `${baseName}-traducido.${document.kind}` };
}

/** Groups segments into request-sized batches (by character budget). */
/** Groups segments into request-sized batches (by character budget). Smaller batches reduce the risk of model output truncation. */
export function batchSegments<T extends { text: string }>(segments: T[], budget = 1600): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const segment of segments) {
    const length = segment.text.length + 24;
    if (current.length > 0 && (size + length > budget || current.length >= 12)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
