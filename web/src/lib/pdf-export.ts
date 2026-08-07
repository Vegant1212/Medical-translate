/**
 * PDF export utility for MedLingua.
 * Generates a clean, professionally styled PDF from translation results
 * using jsPDF — no external dependency beyond the already-instated jspdf.
 */

import { jsPDF } from "jspdf";
import type { TranslationResult } from "./medical";
import { languageLabel } from "./languages";

interface PdfExportOptions {
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  targetVariant?: string;
  result: TranslationResult;
  register?: string;
  domain?: string;
}

const PAGE_MARGIN = 56; // ~0.78in
const CONTENT_WIDTH = (doc: jsPDF) => doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
const PAGE_HEIGHT = (doc: jsPDF) => doc.internal.pageSize.getHeight();

// Clinical-ink palette in RGB (matching the web theme)
const INK_BG: [number, number, number] = [13, 18, 24]; // hsl(205 35% 5%)
const INK_SURFACE: [number, number, number] = [20, 27, 36]; // hsl(205 32% 8%)
const TEAL: [number, number, number] = [42, 196, 153]; // hsl(164 66% 50%)
const TEAL_DIM: [number, number, number] = [30, 140, 110];
const WHITE: [number, number, number] = [236, 242, 243]; // hsl(195 25% 93%)
const MUTED: [number, number, number] = [120, 130, 140];
const BORDER: [number, number, number] = [40, 50, 62];
const WARN: [number, number, number] = [230, 167, 51];
const BAD: [number, number, number] = [218, 62, 62];
const INFO: [number, number, number] = [80, 157, 214];

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return [255, 255, 255];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

/** Splits text into lines that fit within maxWidth. */
function wrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    const wrapped = doc.splitTextToSize(paragraph, maxWidth);
    for (const line of wrapped) {
      lines.push(line);
    }
  }
  return lines;
}

/** Draws a filled rect with rounded corners. */
function roundRect(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: [number, number, number],
) {
  doc.setFillColor(...color);
  doc.roundedRect(x, y, w, h, r, r, "F");
}

/** Draws a horizontal hairline. */
function hairline(doc: jsPDF, y: number, color: [number, number, number] = BORDER) {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.5);
  doc.line(PAGE_MARGIN, y, doc.internal.pageSize.getWidth() - PAGE_MARGIN, y);
}

/** Ensures there's enough space for `needed` points, adding a new page if not. */
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_HEIGHT(doc) - PAGE_MARGIN) {
    doc.addPage();
    return PAGE_MARGIN;
  }
  return y;
}

/** Draws a small pill-shaped tag. */
function tag(
  doc: jsPDF,
  x: number,
  y: number,
  text: string,
  bg: [number, number, number],
  fg: [number, number, number],
) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const w = doc.getTextWidth(text) + 10;
  roundRect(doc, x, y, w, 12, 3, bg);
  doc.setTextColor(...fg);
  doc.text(text.toUpperCase(), x + 5, y + 8);
  return w;
}

/**
 * Generates a styled PDF Blob from a translation result.
 * The PDF uses a dark "clinical ink" background matching the web theme.
 */
export function translationToPdf(options: PdfExportOptions): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cw = CONTENT_WIDTH(doc);

  // Paint dark background on every page we create
  const paintBackground = () => {
    doc.setFillColor(...INK_BG);
    doc.rect(0, 0, pageW, pageH, "F");
    // Subtle radial glow at top-left
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
    doc.setGState(doc.GState({ opacity: 0.04 }));
    doc.circle(60, 40, 180, "F");
    doc.setGState(doc.GState({ opacity: 1 }));
  };

  paintBackground();

  // ── Header ──
  let y = PAGE_MARGIN;

  // Logo dot + brand
  doc.setFillColor(...TEAL);
  doc.circle(PAGE_MARGIN + 4, y + 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text("MedLingua", PAGE_MARGIN + 16, y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("TRADUCCIÓN CLÍNICA", pageW - PAGE_MARGIN - doc.getTextWidth("TRADUCCIÓN CLÍNICA"), y + 7);

  y += 18;
  hairline(doc, y, BORDER);
  y += 22;

  // ── Title ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...WHITE);
  const titleLines = doc.splitTextToSize(
    `Traducción · ${languageLabel(options.targetLanguage)}${options.targetVariant ? ` (${options.targetVariant})` : ""}`,
    cw,
  );
  for (const line of titleLines) {
    y = ensureSpace(doc, y, 24);
    doc.text(line, PAGE_MARGIN, y);
    y += 22;
  }
  y += 4;

  // ── Metadata row ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);

  const metaParts = [
    `Origen: ${options.sourceLanguage === "auto" ? "Auto-detectado" : languageLabel(options.sourceLanguage)}`,
    `Destino: ${languageLabel(options.targetLanguage)}`,
    ...(options.register ? [`Registro: ${options.register}`] : []),
    ...(options.domain ? [`Ámbito: ${options.domain}`] : []),
  ];
  const metaText = metaParts.join("  ·  ");
  y = ensureSpace(doc, y, 14);
  doc.text(metaText, PAGE_MARGIN, y);
  y += 6;

  if (options.result.detectedLanguage && options.sourceLanguage === "auto") {
    y = ensureSpace(doc, y, 12);
    doc.setTextColor(...TEAL_DIM);
    doc.setFontSize(7);
    doc.text(`Idioma detectado: ${languageLabel(options.result.detectedLanguage)}`, PAGE_MARGIN, y);
    y += 10;
  }

  y += 8;
  hairline(doc, y, BORDER);
  y += 18;

  // ── Translation ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TEAL);
  doc.text("TRADUCCIÓN", PAGE_MARGIN, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...WHITE);
  const translationLines = wrapText(doc, options.result.translation, cw);
  for (const line of translationLines) {
    y = ensureSpace(doc, y, 16);
    doc.text(line, PAGE_MARGIN, y);
    y += 15;
  }

  // ── Back-translation ──
  if (options.result.backTranslation) {
    y += 14;
    y = ensureSpace(doc, y, 30);
    roundRect(doc, PAGE_MARGIN, y - 4, cw, 0, 6, INK_SURFACE); // bg will resize
    const btLines = wrapText(doc, options.result.backTranslation, cw - 24);
    let btY = y + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...TEAL_DIM);
    doc.text("RETROTRADUCCIÓN DE CONTROL", PAGE_MARGIN + 12, btY);
    btY += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    for (const line of btLines) {
      btY = ensureSpace(doc, btY, 14) + 0;
      doc.text(line, PAGE_MARGIN + 12, btY);
      btY += 13;
    }
    // Draw the box around it now that we know the height
    const boxH = btY - y + 4;
    roundRect(doc, PAGE_MARGIN, y - 4, cw, boxH, 6, INK_SURFACE);
    // Redraw text on top (since the rect covers it)
    doc.setGState(doc.GState({ opacity: 0 }));
    // Actually jsPDF draws rect underneath if we redraw — let's just re-set text
    doc.setGState(doc.GState({ opacity: 1 }));
    // Re-draw text on top
    let redrawY = y + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...TEAL_DIM);
    doc.text("RETROTRADUCCIÓN DE CONTROL", PAGE_MARGIN + 12, redrawY);
    redrawY += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    for (const line of btLines) {
      if (redrawY > pageH - PAGE_MARGIN) {
        doc.addPage();
        paintBackground();
        redrawY = PAGE_MARGIN;
      }
      doc.text(line, PAGE_MARGIN + 12, redrawY);
      redrawY += 13;
    }
    y = btY + 8;
  }

  // ── Warnings ──
  if (options.result.warnings?.length > 0) {
    y += 10;
    y = ensureSpace(doc, y, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...WARN);
    doc.text("⚠  ADVERTENCIAS DE SEGURIDAD", PAGE_MARGIN, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const warning of options.result.warnings) {
      const wLines = wrapText(doc, `•  ${warning}`, cw - 16);
      for (const line of wLines) {
        y = ensureSpace(doc, y, 14);
        doc.setTextColor(...WARN);
        doc.text(line, PAGE_MARGIN + 8, y);
        y += 13;
      }
    }
  }

  // ── Notes ──
  if (options.result.notes?.length > 0) {
    y += 12;
    y = ensureSpace(doc, y, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INFO);
    doc.text("NOTAS DEL TRADUCTOR", PAGE_MARGIN, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const note of options.result.notes) {
      const nLines = wrapText(doc, `•  ${note}`, cw - 16);
      for (const line of nLines) {
        y = ensureSpace(doc, y, 14);
        doc.setTextColor(...MUTED);
        doc.text(line, PAGE_MARGIN + 8, y);
        y += 13;
      }
    }
  }

  // ── Glossary table ──
  if (options.result.terms?.length > 0) {
    y += 16;
    y = ensureSpace(doc, y, 30);
    hairline(doc, y, BORDER);
    y += 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...TEAL);
    doc.text(`GLOSARIO DETECTADO · ${options.result.terms.length}`, PAGE_MARGIN, y);
    y += 16;

    const colSource = cw * 0.22;
    const colTarget = cw * 0.22;
    const colType = cw * 0.12;
    const colDef = cw * 0.44;

    // Header row
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "bold");
    doc.text("ORIGEN", PAGE_MARGIN, y);
    doc.text("DESTINO", PAGE_MARGIN + colSource, y);
    doc.text("TIPO", PAGE_MARGIN + colSource + colTarget, y);
    doc.text("DEFINICIÓN", PAGE_MARGIN + colSource + colTarget + colType, y);
    y += 6;
    hairline(doc, y, [30, 38, 48]);
    y += 10;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    for (const term of options.result.terms) {
      const defLines = wrapText(doc, term.definition ?? "", colDef - 8);
      const rowH = Math.max(14, defLines.length * 11 + 4);
      y = ensureSpace(doc, y, rowH + 4);

      // Alternating row bg
      const idx = options.result.terms.indexOf(term);
      if (idx % 2 === 0) {
        doc.setFillColor(...INK_SURFACE);
        doc.setGState(doc.GState({ opacity: 0.5 }));
        doc.rect(PAGE_MARGIN, y - 8, cw, rowH, "F");
        doc.setGState(doc.GState({ opacity: 1 }));
      }

      doc.setTextColor(...TEAL);
      doc.text(term.source.slice(0, 24), PAGE_MARGIN, y);
      doc.setTextColor(...WHITE);
      doc.text(term.target.slice(0, 24), PAGE_MARGIN + colSource, y);
      doc.setTextColor(...MUTED);
      doc.text(term.type.slice(0, 14), PAGE_MARGIN + colSource + colTarget, y);

      doc.setTextColor(...MUTED);
      for (let i = 0; i < Math.min(defLines.length, 3); i++) {
        doc.text(defLines[i], PAGE_MARGIN + colSource + colTarget + colType, y + i * 10);
      }

      y += rowH;
    }
  }

  // ── Footer on every page ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const fy = pageH - 24;
    hairline(doc, fy - 6, BORDER);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text("MedLingua · traducción clínica asistida por IA", PAGE_MARGIN, fy);
    doc.text(
      `${i} / ${pageCount}`,
      pageW - PAGE_MARGIN - doc.getTextWidth(`${i} / ${pageCount}`),
      fy,
    );
  }

  return doc.output("blob");
}

/** Generates a simple plain-text .txt blob from translation results. */
export function translationToTxt(options: PdfExportOptions): Blob {
  const parts: string[] = [
    `MedLingua · Traducción clínica`,
    `Origen: ${options.sourceLanguage === "auto" ? "Auto-detectado" : languageLabel(options.sourceLanguage)}`,
    `Destino: ${languageLabel(options.targetLanguage)}`,
    ...(options.register ? [`Registro: ${options.register}`] : []),
    ...(options.domain ? [`Ámbito: ${options.domain}`] : []),
    "",
    "─".repeat(60),
    "TRADUCCIÓN",
    "─".repeat(60),
    options.result.translation,
  ];

  if (options.result.backTranslation) {
    parts.push("", "─".repeat(60), "RETROTRADUCCIÓN DE CONTROL", "─".repeat(60), options.result.backTranslation);
  }

  if (options.result.warnings?.length > 0) {
    parts.push("", "─".repeat(60), "ADVERTENCIAS DE SEGURIDAD", "─".repeat(60));
    for (const w of options.result.warnings) parts.push(`• ${w}`);
  }

  if (options.result.notes?.length > 0) {
    parts.push("", "─".repeat(60), "NOTAS DEL TRADUCTOR", "─".repeat(60));
    for (const n of options.result.notes) parts.push(`• ${n}`);
  }

  if (options.result.terms?.length > 0) {
    parts.push("", "─".repeat(60), `GLOSARIO DETECTADO (${options.result.terms.length})`, "─".repeat(60));
    for (const t of options.result.terms) {
      parts.push(`  ${t.source} → ${t.target}  [${t.type}]`);
      if (t.expansionSource) parts.push(`    ${t.expansionSource}`);
      if (t.definition) parts.push(`    ${t.definition}`);
      if (t.countryNote) parts.push(`    Nota: ${t.countryNote}`);
      parts.push("");
    }
  }

  return new Blob([parts.join("\n")], { type: "text/plain;charset=utf-8" });
}

// Re-export hexToRgb for convenience
export { hexToRgb };
