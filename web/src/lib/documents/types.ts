export type DocKind = "pdf" | "docx" | "pptx";

export interface DocSegment {
  id: string;
  text: string;
  /** 1-based page (PDF) or slide (PPTX) number; undefined for flow documents. */
  page?: number;
  /** Where the segment lives, e.g. "Cuerpo", "Encabezado 1", "Diapositiva 3 · notas". */
  container: string;
  /** Approximate original font size, used to hint the model about length limits. */
  fontSize?: number;
}

export interface LineBox {
  page: number;
  x: number;
  /** Baseline Y in PDF user space. */
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
}

export interface PdfBlock {
  id: string;
  lines: LineBox[];
}

export interface ParsedDocument {
  kind: DocKind;
  fileName: string;
  bytes: ArrayBuffer;
  segments: DocSegment[];
  pageCount: number;
  warnings: string[];
  /** PDF-only geometry used to write the translation back in place. */
  blocks?: PdfBlock[];
}

export function kindFromFile(file: File): DocKind | undefined {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pptx")) return "pptx";
  return undefined;
}

export const ACCEPTED_EXTENSIONS = ".pdf,.docx,.pptx";

/** True when the segment carries no translatable prose (pure numbers, codes, symbols). */
export function isTranslatable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!/\p{L}/u.test(trimmed)) return false;
  if (/^[\d\s.,;:%/()+-]+$/.test(trimmed)) return false;
  return true;
}
