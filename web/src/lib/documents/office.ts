/**
 * Word (.docx) and PowerPoint (.pptx) in-place translation.
 *
 * Both formats are OOXML zips: we rewrite only the text nodes (<w:t> / <a:t>)
 * inside each paragraph and leave every style, image, table and layout part
 * untouched, so the downloaded file keeps the original design byte for byte.
 */

import JSZip from "jszip";

import { isTranslatable, type DocKind, type DocSegment, type ParsedDocument } from "./types";

interface XmlPart {
  path: string;
  label: string;
  /** 1-based slide number for pptx. */
  page?: number;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function slideNumber(path: string): number {
  const match = path.match(/(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

async function listParts(zip: JSZip, kind: DocKind): Promise<XmlPart[]> {
  const paths = Object.keys(zip.files);
  if (kind === "docx") {
    const parts: XmlPart[] = [];
    if (paths.includes("word/document.xml")) parts.push({ path: "word/document.xml", label: "Cuerpo" });
    for (const path of paths.filter((item) => /^word\/header\d*\.xml$/.test(item)).sort()) {
      parts.push({ path, label: `Encabezado ${slideNumber(path) || ""}`.trim() });
    }
    for (const path of paths.filter((item) => /^word\/footer\d*\.xml$/.test(item)).sort()) {
      parts.push({ path, label: `Pie ${slideNumber(path) || ""}`.trim() });
    }
    for (const path of ["word/footnotes.xml", "word/endnotes.xml"]) {
      if (paths.includes(path)) parts.push({ path, label: path.includes("foot") ? "Notas al pie" : "Notas finales" });
    }
    return parts;
  }

  const slides = paths
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .map<XmlPart>((path) => ({ path, label: `Diapositiva ${slideNumber(path)}`, page: slideNumber(path) }));
  const notes = paths
    .filter((path) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .map<XmlPart>((path) => ({
      path,
      label: `Diapositiva ${slideNumber(path)} · notas`,
      page: slideNumber(path),
    }));
  return [...slides, ...notes];
}

function paragraphTag(kind: DocKind): string {
  return kind === "docx" ? "w:p" : "a:p";
}

function textTag(kind: DocKind): string {
  return kind === "docx" ? "w:t" : "a:t";
}

/** Parses an OOXML document into paragraph segments in deterministic document order. */
export async function parseOffice(file: File, kind: DocKind): Promise<ParsedDocument> {
  const bytes = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes.slice(0));
  const parts = await listParts(zip, kind);
  const parser = new DOMParser();
  const segments: DocSegment[] = [];
  const warnings: string[] = [];

  for (const [partIndex, part] of parts.entries()) {
    const xml = await zip.file(part.path)?.async("string");
    if (!xml) continue;
    const dom = parser.parseFromString(xml, "application/xml");
    if (dom.getElementsByTagName("parsererror").length > 0) {
      warnings.push(`No se pudo leer la parte ${part.path}; se conservará sin traducir.`);
      continue;
    }
    const paragraphs = dom.getElementsByTagName(paragraphTag(kind));
    for (let index = 0; index < paragraphs.length; index += 1) {
      const nodes = paragraphs[index].getElementsByTagName(textTag(kind));
      let text = "";
      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        text += nodes[nodeIndex].textContent ?? "";
      }
      if (!isTranslatable(text)) continue;
      segments.push({
        id: `${partIndex}:${index}`,
        text,
        page: part.page,
        container: part.label,
      });
    }
  }

  if (segments.length === 0) {
    warnings.push("No se encontró texto editable en el documento.");
  }

  const pageCount = kind === "pptx" ? new Set(segments.map((segment) => segment.page ?? 0)).size : 1;

  return { kind, fileName: file.name, bytes, segments, pageCount, warnings };
}

/**
 * Rebuilds the original file with translated paragraphs.
 * The translation is placed in the paragraph's first run (inheriting its formatting)
 * and the remaining runs of that paragraph are emptied.
 */
export async function buildTranslatedOffice(input: {
  bytes: ArrayBuffer;
  kind: DocKind;
  translations: Record<string, string>;
}): Promise<{ blob: Blob; warnings: string[] }> {
  const zip = await JSZip.loadAsync(input.bytes.slice(0));
  const parts = await listParts(zip, input.kind);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const warnings: string[] = [];
  let replaced = 0;

  for (const [partIndex, part] of parts.entries()) {
    const xml = await zip.file(part.path)?.async("string");
    if (!xml) continue;
    const dom = parser.parseFromString(xml, "application/xml");
    if (dom.getElementsByTagName("parsererror").length > 0) continue;

    const paragraphs = dom.getElementsByTagName(paragraphTag(input.kind));
    let touched = false;

    for (let index = 0; index < paragraphs.length; index += 1) {
      const translation = input.translations[`${partIndex}:${index}`];
      if (typeof translation !== "string" || translation.length === 0) continue;
      const nodes = paragraphs[index].getElementsByTagName(textTag(input.kind));
      if (nodes.length === 0) continue;

      const first = nodes[0];
      first.textContent = translation;
      if (input.kind === "docx") {
        first.setAttribute("xml:space", "preserve");
      }
      for (let nodeIndex = 1; nodeIndex < nodes.length; nodeIndex += 1) {
        nodes[nodeIndex].textContent = "";
      }
      touched = true;
      replaced += 1;
    }

    if (touched) {
      zip.file(part.path, serializer.serializeToString(dom));
    }
  }

  if (replaced === 0) {
    warnings.push("No se aplicó ninguna traducción al documento.");
  }

  const mime = input.kind === "docx" ? DOCX_MIME : PPTX_MIME;
  const blob = await zip.generateAsync({ type: "blob", mimeType: mime, compression: "DEFLATE" });
  return { blob, warnings };
}
