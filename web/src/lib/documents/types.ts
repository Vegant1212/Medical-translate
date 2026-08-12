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
  /** Segments that must remain byte-for-byte unchanged in the rebuilt document. */
  protectedReason?: "bibliography";
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

const BIBLIOGRAPHY_HEADING = /^(references|bibliography|works cited|literature cited|referencias|bibliograf[ií]a|literatura citada|r[eé]f[eé]rences|r[eé]f[eé]rences bibliographiques)$/iu;
const DOI_OR_PMID = /(?:doi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/|pmid\s*:\s*)\S+/iu;
const NUMBERED_REFERENCE = /^\s*(?:\[\d{1,4}\]|\d{1,4}[.)])\s+\p{Lu}[\p{L}'’-]+/u;
const AUTHOR_YEAR_REFERENCE = /^\s*\p{Lu}[\p{L}'’-]+(?:\s+(?:et\s+al\.|and|y|&)|,).{0,180}\b(?:19|20)\d{2}\b/u;
const JOURNAL_REFERENCE = /\b(?:19|20)\d{2}\s*;\s*\d+(?:\([^)]*\))?\s*:\s*\d+/u;

/** Conservative detector: false negatives are safer than translating ordinary prose as a citation. */
export function isBibliographicReference(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (BIBLIOGRAPHY_HEADING.test(normalized)) return true;
  return (
    DOI_OR_PMID.test(normalized) ||
    NUMBERED_REFERENCE.test(normalized) ||
    AUTHOR_YEAR_REFERENCE.test(normalized) ||
    JOURNAL_REFERENCE.test(normalized)
  );
}

/** Marks the bibliography heading and every following segment as immutable. */
export function protectBibliographySegments(segments: DocSegment[]): DocSegment[] {
  let inBibliography = false;
  return segments.map((segment) => {
    const normalized = segment.text.replace(/\s+/g, " ").trim();
    if (BIBLIOGRAPHY_HEADING.test(normalized)) inBibliography = true;
    const protectedReason = inBibliography || isBibliographicReference(normalized) ? "bibliography" : undefined;
    return protectedReason ? { ...segment, protectedReason } : segment;
  });
}
