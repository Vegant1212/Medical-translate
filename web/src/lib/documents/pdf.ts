/** PDF text extraction (pdf.js) and in-place translation overlay (pdf-lib). */

import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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
  const allLines: RawLine[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items as unknown[]).filter((item): item is RawItem => {
      const candidate = item as Partial<RawItem>;
      return typeof candidate.str === "string" && Array.isArray(candidate.transform);
    });

    const pageLines: RawLine[] = [];
    for (const item of items) {
      if (item.str.trim().length === 0) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      const fontSize = Math.abs(item.transform[3] ?? item.height ?? 10) || 10;
      const bold = isBoldFont(item.fontName ?? "");
      const existing = pageLines.find(
        (line) => Math.abs(line.y - y) <= Math.max(1.6, fontSize * 0.32) && Math.abs(line.fontSize - fontSize) < 2.5,
      );
      if (existing) {
        const gap = x - existing.right;
        const needsSpace = gap > fontSize * 0.18 && !/\s$/.test(existing.text) && !/^\s/.test(item.str);
        existing.text += `${needsSpace ? " " : ""}${item.str}`;
        existing.right = Math.max(existing.right, x + item.width);
        existing.x = Math.min(existing.x, x);
        existing.bold = existing.bold || bold;
      } else {
        pageLines.push({
          page: pageNumber,
          x,
          y,
          right: x + item.width,
          fontSize,
          bold,
          text: item.str,
        });
      }
    }

    pageLines.sort((a, b) => (Math.abs(a.y - b.y) > 1.5 ? b.y - a.y : a.x - b.x));
    allLines.push(...pageLines);
    page.cleanup();
  }

  if (allLines.length === 0) {
    warnings.push(
      "No se detectó texto seleccionable: el PDF parece escaneado (imagen). Necesita OCR antes de poder traducirse.",
    );
  }

  // Group consecutive lines into paragraph blocks.
  const segments: DocSegment[] = [];
  const blocks: PdfBlock[] = [];
  let current: { lines: RawLine[]; text: string } | undefined;
  let blockIndex = 0;

  const flush = (): void => {
    if (!current) return;
    const text = current.text.replace(/\s+/g, " ").trim();
    const id = `p${blockIndex}`;
    blockIndex += 1;
    if (isTranslatable(text)) {
      segments.push({
        id,
        text,
        page: current.lines[0]?.page,
        container: `Página ${current.lines[0]?.page ?? 1}`,
        fontSize: current.lines[0]?.fontSize,
      });
      blocks.push({
        id,
        lines: current.lines.map<LineBox>((line) => ({
          page: line.page,
          x: line.x,
          y: line.y,
          width: Math.max(line.right - line.x, 4),
          fontSize: line.fontSize,
          bold: line.bold,
        })),
      });
    }
    current = undefined;
  };

  for (let index = 0; index < allLines.length; index += 1) {
    const line = allLines[index];
    const previous = allLines[index - 1];
    const sameBlock: boolean =
      current !== undefined &&
      previous !== undefined &&
      previous.page === line.page &&
      Math.abs(previous.fontSize - line.fontSize) < 1.2 &&
      previous.y - line.y > 0 &&
      previous.y - line.y < line.fontSize * 2.1 &&
      Math.abs(previous.x - line.x) < Math.max(24, line.fontSize * 2);

    if (sameBlock && current) {
      current.lines.push(line);
      current.text += ` ${line.text}`;
    } else {
      flush();
      current = { lines: [line], text: line.text };
    }
  }
  flush();

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

export interface OverlayOptions {
  /** Draw the translation over the original text (keeps images, tables and layout). */
  translations: Record<string, string>;
  blocks: PdfBlock[];
  bytes: ArrayBuffer;
}

/** Writes translations back onto the original PDF, preserving every graphic element. */
export async function buildTranslatedPdf(options: OverlayOptions): Promise<{ blob: Blob; warnings: string[] }> {
  const warnings: string[] = [];
  const pdf = await PDFDocument.load(options.bytes.slice(0), { ignoreEncryption: true });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  let droppedGlyphs = false;

  for (const block of options.blocks) {
    const raw = options.translations[block.id];
    if (!raw || block.lines.length === 0) continue;
    const sanitized = sanitizeForWinAnsi(raw);
    if (sanitized.dropped) droppedGlyphs = true;
    const text = sanitized.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const pageIndex = (block.lines[0]?.page ?? 1) - 1;
    const page: PDFPage | undefined = pages[pageIndex];
    if (!page) continue;

    const font = block.lines[0].bold ? bold : regular;
    const baseSize = block.lines[0].fontSize;
    const left = Math.min(...block.lines.map((line) => line.x));
    const right = Math.max(...block.lines.map((line) => line.x + line.width));
    const maxWidth = Math.max(right - left, 30);
    const baselines = block.lines.map((line) => line.y);
    const leading =
      block.lines.length > 1
        ? Math.abs(baselines[0] - baselines[baselines.length - 1]) / (block.lines.length - 1)
        : baseSize * 1.18;

    // Clear the original text: one rectangle per original line.
    for (const line of block.lines) {
      page.drawRectangle({
        x: line.x - 1.2,
        y: line.y - line.fontSize * 0.28,
        width: line.width + 2.4,
        height: line.fontSize * 1.22,
        color: rgb(1, 1, 1),
      });
    }

    let size = baseSize;
    let wrapped = wrapText(text, font, size, maxWidth);
    const maxLines = block.lines.length;
    while (wrapped.length > maxLines && size > baseSize * 0.62) {
      size = Math.max(baseSize * 0.62, size - 0.4);
      wrapped = wrapText(text, font, size, maxWidth);
    }

    const startY = baselines[0];
    const effectiveLeading = wrapped.length > maxLines ? Math.max(size * 1.02, leading * (maxLines / wrapped.length)) : leading;

    wrapped.forEach((lineText, index) => {
      page.drawText(lineText, {
        x: block.lines[Math.min(index, block.lines.length - 1)].x,
        y: startY - effectiveLeading * index,
        size,
        font,
        color: rgb(0.06, 0.08, 0.1),
      });
    });
  }

  if (droppedGlyphs) {
    warnings.push(
      "Algunos caracteres no compatibles con las fuentes estándar del PDF se han sustituido o eliminado (alfabetos no latinos requieren exportar a Word).",
    );
  }

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
