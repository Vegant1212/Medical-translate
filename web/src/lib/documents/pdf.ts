/** PDF text extraction (pdf.js) and in-place translation overlay (pdf-lib). */

import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import { findTabularRows, isNearTabularRow } from "./pdf-geometry";
import { isTranslatable, type DocSegment, type LineBox, type ParsedDocument, type PdfBlock } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

interface RawLine {
  page: number;
  x: number;
  y: number;
  right: number;
  fontSize: number;
  bold: boolean;
  text: string;
}

function isBoldFont(fontName: string): boolean {
  return /bold|black|heavy|semibold|demi/i.test(fontName);
}

/** Extracts paragraph-level segments plus the line geometry needed to rewrite the PDF. */
export async function parsePdf(file: File): Promise<ParsedDocument> {
  const bytes = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  const warnings: string[] = [];
  const pageMidpoints = new Map<number, number>();
  const parsePage = async (pageNumber: number): Promise<RawLine[]> => {
    const page = await doc.getPage(pageNumber);
    const pageMidpoint = page.getViewport({ scale: 1 }).width / 2;
    pageMidpoints.set(pageNumber, pageMidpoint);
    const content = await page.getTextContent();
    const items = (content.items as unknown[]).filter((item): item is RawItem => {
      const candidate = item as Partial<RawItem>;
      return typeof candidate.str === "string" && Array.isArray(candidate.transform);
    });

    const pageLines: RawLine[] = [];
    // Index nearby baselines instead of scanning every previous line. This
    // keeps extraction fast on dense scientific PDFs with thousands of items.
    const linesByBaseline = new Map<number, RawLine[]>();
    for (const item of items) {
      if (item.str.trim().length === 0) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      const fontSize = Math.abs(item.transform[3] ?? item.height ?? 10) || 10;
      const bold = isBoldFont(item.fontName ?? "");
      const baseline = Math.round(y);
      const candidates = [baseline - 2, baseline - 1, baseline, baseline + 1, baseline + 2]
        .flatMap((key) => linesByBaseline.get(key) ?? []);
      const existing = candidates.find(
        (line) => {
          const gap = x - line.right;
          return Math.abs(line.y - y) <= Math.max(1.6, fontSize * 0.32) &&
            Math.abs(line.fontSize - fontSize) < 2.5 &&
            (line.x < pageMidpoint) === (x < pageMidpoint) &&
            gap >= -fontSize * 0.5 &&
            gap <= Math.max(10, fontSize * 1.35);
        },
      );
      if (existing) {
        const gap = x - existing.right;
        const needsSpace = gap > fontSize * 0.18 && !/\s$/.test(existing.text) && !/^\s/.test(item.str);
        existing.text += `${needsSpace ? " " : ""}${item.str}`;
        existing.right = Math.max(existing.right, x + item.width);
        existing.x = Math.min(existing.x, x);
        existing.bold = existing.bold || bold;
      } else {
        const line = {
          page: pageNumber,
          x,
          y,
          right: x + item.width,
          fontSize,
          bold,
          text: item.str,
        };
        pageLines.push(line);
        const bucket = linesByBaseline.get(baseline) ?? [];
        bucket.push(line);
        linesByBaseline.set(baseline, bucket);
      }
    }

    pageLines.sort((a, b) => (Math.abs(a.y - b.y) > 1.5 ? b.y - a.y : a.x - b.x));
    page.cleanup();
    return pageLines;
  };

  const allLines: RawLine[] = [];
  // A small concurrency window speeds up long PDFs without exhausting memory.
  for (let firstPage = 1; firstPage <= doc.numPages; firstPage += 4) {
    const pageNumbers = Array.from(
      { length: Math.min(4, doc.numPages - firstPage + 1) },
      (_, index) => firstPage + index,
    );
    const pageResults = await Promise.all(pageNumbers.map(parsePage));
    for (const pageLines of pageResults) allLines.push(...pageLines);
  }

  if (allLines.length === 0) {
    warnings.push(
      "No se detectó texto seleccionable: el PDF parece escaneado (imagen). Necesita OCR antes de poder traducirse.",
    );
  }

  // Group consecutive lines into paragraph blocks.
  const segments: DocSegment[] = [];
  const blocks: PdfBlock[] = [];
  let blockIndex = 0;

  const addBlock = (lines: RawLine[]): void => {
    const text = lines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;
    const id = `p${blockIndex}`;
    blockIndex += 1;
    segments.push({
      id,
      text,
      translatable: isTranslatable(text),
      page: lines[0]?.page,
      container: `Página ${lines[0]?.page ?? 1}`,
      fontSize: lines[0]?.fontSize,
    });
    blocks.push({
      id,
      lines: lines.map<LineBox>((line) => ({
        page: line.page,
        x: line.x,
        y: line.y,
        width: Math.max(line.right - line.x, 4),
        fontSize: line.fontSize,
        bold: line.bold,
      })),
    });
  };

  // Build paragraphs by spatial adjacency instead of source-array order.
  // This prevents equally high lines in separate newspaper-style columns
  // from being interleaved or merged into one translation box.
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const pending = allLines
      .filter((line) => line.page === pageNumber)
      .sort((a, b) => (Math.abs(a.y - b.y) > 1.5 ? b.y - a.y : a.x - b.x));
    const pageMidpoint = pageMidpoints.get(pageNumber) ?? pending.reduce((right, line) => Math.max(right, line.right), 0) / 2;
    const tabularRows = findTabularRows(pending, pageMidpoint);
    const belongsToTable = (line: RawLine): boolean => isNearTabularRow(line, pageMidpoint, tabularRows);
    while (pending.length > 0) {
      const first = pending.shift();
      if (!first) break;
      const paragraph = [first];
      let cursor = first;
      // A table row must remain an independent segment. Joining vertically
      // adjacent cell labels into a paragraph destroys their row alignment
      // when the translated labels are longer than the source language.
      if (belongsToTable(first)) {
        addBlock(paragraph);
        continue;
      }
      while (true) {
        const candidates = pending
          .map((line, index) => ({ line, index, verticalGap: cursor.y - line.y }))
          .filter(({ line, verticalGap }) =>
            verticalGap > 0 &&
            verticalGap < cursor.fontSize * 2.1 &&
            Math.abs(cursor.fontSize - line.fontSize) < 1.2 &&
            Math.abs(cursor.x - line.x) < Math.max(24, cursor.fontSize * 2),
          )
          .sort((a, b) => a.verticalGap - b.verticalGap || Math.abs(cursor.x - a.line.x) - Math.abs(cursor.x - b.line.x));
        const next = candidates[0];
        if (!next || belongsToTable(next.line)) break;
        paragraph.push(next.line);
        pending.splice(next.index, 1);
        cursor = next.line;
      }
      addBlock(paragraph);
    }
  }

  return {
    kind: "pdf",
    fileName: file.name,
    bytes,
    segments,
    pageCount: doc.numPages,
    warnings,
    blocks,
  };
}

const LATIN_FALLBACKS: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": ",",
  "\u201C": '"',
  "\u201D": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u2026": "...",
  "\u00A0": " ",
  "\u2022": "-",
  "\u2265": ">=",
  "\u2264": "<=",
  "\u00B5": "u",
  "\u03BC": "u",
  "\u2192": "->",
  "\u2009": " ",
  "\u202F": " ",
};

/** Makes text safe for the WinAnsi standard fonts used in the overlay. */
export function sanitizeForWinAnsi(value: string): { text: string; dropped: boolean } {
  let dropped = false;
  const mapped = value.replace(/[\u2018\u2019\u201A\u201C\u201D\u2013\u2014\u2212\u2026\u00A0\u2022\u2265\u2264\u00B5\u03BC\u2192\u2009\u202F]/g, (char) => LATIN_FALLBACKS[char] ?? char);
  // Control characters are intentional here: tabs and line breaks are valid text.
  // eslint-disable-next-line no-control-regex
  const safe = mapped.replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2030\u2039\u203A\u20AC\u2122]/g, () => {
    dropped = true;
    return "";
  });
  return { text: safe, dropped };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || line.length === 0) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface PositionedTextLine {
  text: string;
  x: number;
  y: number;
}

function wrapIntoOriginalLines(
  text: string,
  font: PDFFont,
  size: number,
  slots: LineBox[],
): PositionedTextLine[] | undefined {
  const words = text.split(/\s+/).filter(Boolean);
  const positioned: PositionedTextLine[] = [];
  let wordIndex = 0;
  for (const slot of slots) {
    if (wordIndex >= words.length) break;
    let line = "";
    while (wordIndex < words.length) {
      const candidate = line ? `${line} ${words[wordIndex]}` : words[wordIndex];
      if (font.widthOfTextAtSize(candidate, size) <= Math.max(4, slot.width)) {
        line = candidate;
        wordIndex += 1;
      } else {
        break;
      }
    }
    if (!line) return undefined;
    positioned.push({ text: line, x: slot.x, y: slot.y });
  }
  return wordIndex === words.length ? positioned : undefined;
}

export interface OverlayOptions {
  /** Draw the translation over the original text (keeps images, tables and layout). */
  translations: Record<string, string>;
  sourceTexts: Record<string, string>;
  blocks: PdfBlock[];
  bytes: ArrayBuffer;
}

/** Replaces text over the original PDF pages, preserving images, tables and page geometry. */
export async function buildTranslatedPdf(options: OverlayOptions): Promise<{ blob: Blob; warnings: string[] }> {
  const warnings: string[] = [];
  const missing = options.blocks.filter((block) => !options.translations[block.id]?.trim());
  if (missing.length > 0) {
    throw new Error(`Faltan ${missing.length} segmentos por traducir. Completa la traducción antes de descargar el PDF.`);
  }

  const pdf = await PDFDocument.load(options.bytes.slice(0), { ignoreEncryption: true });
  const pages = pdf.getPages();
  // Scientific journals commonly use Times-like faces. Times Roman preserves
  // the source document's metrics much more closely than the previous Helvetica overlay.
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  let droppedGlyphs = false;
  const overflowed: string[] = [];
  const prepared: {
    block: PdfBlock;
    pageIndex: number;
    font: PDFFont;
    size: number;
    lines: PositionedTextLine[];
  }[] = [];

  for (const block of options.blocks) {
    const raw = options.translations[block.id];
    if (!raw || block.lines.length === 0) continue;
    // Names, affiliations and bibliography entries that intentionally remain
    // unchanged must stay as original PDF operators, fonts and spacing.
    if (raw === options.sourceTexts[block.id]) continue;
    const sanitized = sanitizeForWinAnsi(raw);
    if (sanitized.dropped) droppedGlyphs = true;
    const text = sanitized.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const sourcePageNumber = block.lines[0]?.page ?? 1;
    const page = pages[sourcePageNumber - 1];
    if (!page) continue;
    const minX = Math.min(...block.lines.map((line) => line.x));
    const maxX = Math.max(...block.lines.map((line) => line.x + line.width));
    const minBaseline = Math.min(...block.lines.map((line) => line.y));
    const maxBaseline = Math.max(...block.lines.map((line) => line.y));
    const originalSize = Math.max(6, block.lines[0]?.fontSize ?? 10);
    const boxTop = maxBaseline + originalSize * 0.9;
    const boxBottom = minBaseline - originalSize * 0.35;
    const boxWidth = Math.max(8, maxX - minX);
    const boxHeight = Math.max(originalSize * 1.25, boxTop - boxBottom);
    const font = block.lines.some((line) => line.bold) ? bold : regular;

    const pageMidpoint = page.getWidth() / 2;
    const hasCellPeer = block.lines.some((line) => options.blocks.some((otherBlock) =>
      otherBlock.id !== block.id && otherBlock.lines.some((other) => {
        if (other.page !== line.page || Math.abs(other.y - line.y) > Math.max(1.6, line.fontSize * 0.25)) return false;
        if ((other.x < pageMidpoint) !== (line.x < pageMidpoint)) return false;
        const gap = Math.max(other.x - (line.x + line.width), line.x - (other.x + other.width));
        return gap > -1;
      }),
    ));

    let size = Math.min(originalSize, 14);
    let positioned: PositionedTextLine[] | undefined;
    if (hasCellPeer) {
      const slots = [...block.lines].sort((a, b) => b.y - a.y || a.x - b.x);
      positioned = wrapIntoOriginalLines(text, font, size, slots);
      while (size > 2.8 && !positioned) {
        size -= 0.25;
        positioned = wrapIntoOriginalLines(text, font, size, slots);
      }
    } else {
      let wrapped = wrapText(text, font, size, boxWidth);
      const fits = () => wrapped.length * size * 1.04 <= boxHeight && wrapped.every((line) => font.widthOfTextAtSize(line, size) <= boxWidth + 0.5);
      while (size > 2.8 && !fits()) {
        size -= 0.25;
        wrapped = wrapText(text, font, size, boxWidth);
      }
      if (fits()) {
        let y = boxTop - size;
        positioned = wrapped.map((lineText) => {
          const line = { text: lineText, x: minX, y };
          y -= size * 1.04;
          return line;
        });
      }
    }
    if (!positioned) {
      overflowed.push(block.id);
      continue;
    }
    prepared.push({ block, pageIndex: sourcePageNumber - 1, font, size, lines: positioned });
  }

  // Erase every replaced source line before drawing any translation. This
  // prevents a later white rectangle from covering text already reconstructed
  // in a neighboring table cell.
  for (const item of prepared) {
    const page = pages[item.pageIndex];
    if (!page) continue;
    for (const line of item.block.lines) {
      page.drawRectangle({
        x: line.x - 0.8,
        y: line.y - line.fontSize * 0.3,
        width: line.width + 1.6,
        height: line.fontSize * 1.2,
        color: rgb(1, 1, 1),
      });
    }
  }
  for (const item of prepared) {
    const page = pages[item.pageIndex];
    if (!page) continue;
    for (const line of item.lines) {
      // Every table-cell translation stays inside the exact width and baseline
      // of its source row, so it cannot spill into numeric columns.
      page.drawText(line.text, { x: line.x, y: line.y, size: item.size, font: item.font, color: rgb(0.04, 0.05, 0.07) });
    }
  }

  if (overflowed.length > 0) {
    throw new Error(`No es posible acomodar completos ${overflowed.length} bloques dentro del formato original (${overflowed.slice(0, 8).join(", ")}). Descarga Word para conservar todo el texto sin recortes.`);
  }

  if (droppedGlyphs) {
    warnings.push(
      "Algunos caracteres no compatibles con las fuentes estándar del PDF se han sustituido o eliminado (alfabetos no latinos requieren exportar a Word).",
    );
  }
  warnings.unshift("La traducción se superpuso sobre las páginas originales para conservar imágenes, tablas y composición.");

  const output = await pdf.save();
  const buffer = new ArrayBuffer(output.byteLength);
  new Uint8Array(buffer).set(output);
  return { blob: new Blob([buffer], { type: "application/pdf" }), warnings };
}

/** Full plain-text extraction, used by the bibliography auditor. */
export async function extractPdfText(file: File): Promise<{ text: string; pageCount: number; pages: string[] }> {
  const bytes = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items as unknown[];
    let lastY: number | undefined;
    let buffer = "";
    for (const raw of items) {
      const item = raw as Partial<RawItem>;
      if (typeof item.str !== "string" || !Array.isArray(item.transform)) continue;
      const y = item.transform[5] ?? 0;
      if (lastY !== undefined && Math.abs(lastY - y) > 2.5) buffer += "\n";
      buffer += item.str;
      lastY = y;
    }
    pages.push(buffer);
    page.cleanup();
  }

  return { text: pages.join("\n\n"), pageCount: doc.numPages, pages };
}
