/** Bibliography auditor: extracts citations + references from a paper and cross-checks them. */

import {
  crossrefByDoi,
  crossrefSearch,
  extractDoi,
  formatCitation,
  pubmedSearch,
  titleSimilarity,
  type CitationStyle,
  type WorkMetadata,
} from "./citations";
import { chatJson } from "./toolkit";

export interface ExtractedReference {
  /** Number in the reference list, when the paper uses a numeric style. */
  number?: number;
  raw: string;
  title?: string;
  firstAuthor?: string;
  year?: string;
  containerTitle?: string;
  doi?: string;
  pmid?: string;
  language?: string;
}

export interface ExtractedCitation {
  marker: string;
  /** Reference numbers or author-year keys the marker points at. */
  targets: string[];
  sentence: string;
  page?: number;
}

export interface ExtractionResult {
  detectedStyle: "numerica" | "autor-fecha" | "mixta" | "desconocida";
  documentLanguage: string;
  references: ExtractedReference[];
  citations: ExtractedCitation[];
  structureNotes: string[];
}

export type IssueSeverity = "critico" | "alto" | "medio" | "bajo" | "ok";

export interface AuditIssue {
  id: string;
  severity: IssueSeverity;
  category:
    | "cita_sin_referencia"
    | "referencia_sin_cita"
    | "metadato_incorrecto"
    | "no_localizada"
    | "retractada"
    | "formato"
    | "numeracion"
    | "contenido_no_sustentado";
  title: string;
  detail: string;
  reference?: string;
  suggestion?: string;
  evidenceUrl?: string;
}

export interface ReferenceCheck {
  reference: ExtractedReference;
  status: "verificada" | "parcial" | "no_encontrada";
  metadata?: WorkMetadata;
  similarity?: number;
  retracted: boolean;
  url?: string;
  problems: string[];
  formatted?: string;
}

export interface AuditReport {
  extraction: ExtractionResult;
  checks: ReferenceCheck[];
  issues: AuditIssue[];
  score: number;
  summary: string;
}

/** Step 1 — model extraction of the reference list and in-text markers. */
export async function extractBibliography(input: {
  text: string;
  signal?: AbortSignal;
}): Promise<ExtractionResult> {
  const trimmed = input.text.length > 120_000 ? `${input.text.slice(0, 60_000)}\n[...]\n${input.text.slice(-60_000)}` : input.text;

  return chatJson<ExtractionResult>(
    [
      {
        role: "system",
        content: `Eres un editor científico y bibliotecario biomédico. Analizas el texto completo de un artículo (en cualquier idioma) extraído de un PDF.
TAREA:
1. Localiza la lista de referencias / bibliografía y extrae cada entrada íntegra.
2. Localiza cada llamada de cita en el cuerpo del texto: numéricas ("[3]", "(3)", superíndices "3") o autor-fecha ("(García et al., 2019)").
3. Para cada llamada guarda la frase completa donde aparece (máx. 320 caracteres), porque servirá para comprobar si la fuente sustenta la afirmación.
PROHIBIDO: No incluyas razonamiento ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE JSON (sin texto antes ni después):
{"detectedStyle":"numerica|autor-fecha|mixta|desconocida","documentLanguage":"código ISO 639-1","references":[{"number":1,"raw":"entrada completa tal cual","title":"","firstAuthor":"apellido","year":"","containerTitle":"","doi":"","pmid":"","language":""}],"citations":[{"marker":"[3]","targets":["3"],"sentence":"","page":0}],"structureNotes":["observaciones sobre el formato de la bibliografía, mezclas de estilo, numeración desordenada, entradas incompletas"]}
Reglas: no inventes referencias; si la bibliografía está truncada, dilo en structureNotes. En "targets" usa el número como cadena para estilo numérico, o "Apellido AÑO" para autor-fecha. Máximo 120 referencias y 200 citas (prioriza las primeras).`,
      },
      { role: "user", content: trimmed },
    ],
    { temperature: 0.05, maxTokens: 24000, signal: input.signal },
  );
}

/** Step 2 — verify one reference against Crossref / PubMed. */
export async function checkReference(
  reference: ExtractedReference,
  options: { style: CitationStyle; locale: string; signal?: AbortSignal },
): Promise<ReferenceCheck> {
  const problems: string[] = [];
  const doi = reference.doi?.trim() || extractDoi(reference.raw);

  if (doi) {
    const item = await crossrefByDoi(doi, options.signal).catch(() => undefined);
    if (item) {
      const realTitle = item.title?.[0] ?? "";
      const similarity = reference.title ? titleSimilarity(reference.title, realTitle) : 1;
      const year =
        item.issued?.["date-parts"]?.[0]?.[0] ??
        item["published-print"]?.["date-parts"]?.[0]?.[0] ??
        item["published-online"]?.["date-parts"]?.[0]?.[0];
      const retracted = (item["update-to"] ?? []).some((update) =>
        (update.type ?? "").toLowerCase().includes("retraction"),
      );

      if (similarity < 0.55 && reference.title) {
        problems.push(`El DOI apunta a otro trabajo: «${realTitle}».`);
      }
      if (reference.year && year && String(year) !== reference.year) {
        problems.push(`Año citado ${reference.year} ≠ año real ${year}.`);
      }
      const realJournal = item["container-title"]?.[0];
      if (
        reference.containerTitle &&
        realJournal &&
        titleSimilarity(reference.containerTitle, realJournal) < 0.35
      ) {
        problems.push(`Revista citada «${reference.containerTitle}» ≠ «${realJournal}».`);
      }

      const metadata: WorkMetadata = {
        type: "article",
        title: realTitle,
        authors: (item.author ?? []).map((author) => ({
          family: author.family ?? author.name ?? "",
          given: author.given,
        })),
        containerTitle: realJournal,
        containerAbbrev: item["short-container-title"]?.[0],
        year: year ? String(year) : reference.year,
        volume: item.volume,
        issue: item.issue,
        pages: item.page,
        doi: item.DOI,
        pmid: reference.pmid,
        abstract: item.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 700),
      };

      return {
        reference,
        status: problems.length === 0 ? "verificada" : "parcial",
        metadata,
        similarity: Number(similarity.toFixed(2)),
        retracted,
        url: `https://doi.org/${item.DOI ?? doi}`,
        problems,
        formatted: formatCitation(metadata, options.style, {
          locale: options.locale,
          index: reference.number,
        }),
      };
    }
    problems.push(`El DOI ${doi} no existe en Crossref (posible error de transcripción).`);
  }

  const query = [reference.title, reference.firstAuthor, reference.containerTitle, reference.year]
    .filter(Boolean)
    .join(" ");
  const candidates = query ? await crossrefSearch(query, options.signal).catch(() => []) : [];
  let best: { similarity: number; index: number } | undefined;
  candidates.forEach((candidate, index) => {
    const similarity = titleSimilarity(reference.title ?? reference.raw, candidate.title?.[0] ?? "");
    if (!best || similarity > best.similarity) best = { similarity, index };
  });

  if (best && best.similarity >= 0.55) {
    const item = candidates[best.index];
    const year =
      item.issued?.["date-parts"]?.[0]?.[0] ??
      item["published-print"]?.["date-parts"]?.[0]?.[0] ??
      item["published-online"]?.["date-parts"]?.[0]?.[0];
    if (reference.year && year && String(year) !== reference.year) {
      problems.push(`Año citado ${reference.year} ≠ año indexado ${year}.`);
    }
    if (!reference.doi && item.DOI) {
      problems.push(`Falta el DOI en la referencia: ${item.DOI}.`);
    }
    const metadata: WorkMetadata = {
      type: "article",
      title: item.title?.[0] ?? reference.title ?? "",
      authors: (item.author ?? []).map((author) => ({
        family: author.family ?? author.name ?? "",
        given: author.given,
      })),
      containerTitle: item["container-title"]?.[0],
      containerAbbrev: item["short-container-title"]?.[0],
      year: year ? String(year) : reference.year,
      volume: item.volume,
      issue: item.issue,
      pages: item.page,
      doi: item.DOI,
      pmid: reference.pmid,
      abstract: item.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 700),
    };
    const retracted = (item["update-to"] ?? []).some((update) =>
      (update.type ?? "").toLowerCase().includes("retraction"),
    );
    return {
      reference,
      status: best.similarity >= 0.82 && problems.length === 0 ? "verificada" : "parcial",
      metadata,
      similarity: Number(best.similarity.toFixed(2)),
      retracted,
      url: metadata.doi ? `https://doi.org/${metadata.doi}` : undefined,
      problems,
      formatted: formatCitation(metadata, options.style, {
        locale: options.locale,
        index: reference.number,
      }),
    };
  }

  const pubmed = query ? await pubmedSearch(query, options.signal) : [];
  const hit = pubmed.find((entry) => titleSimilarity(reference.title ?? reference.raw, entry.title) >= 0.6);
  if (hit) {
    problems.push("Localizada en PubMed pero sin registro Crossref: verifica el DOI.");
    return {
      reference,
      status: "parcial",
      similarity: Number(titleSimilarity(reference.title ?? "", hit.title).toFixed(2)),
      retracted: false,
      url: `https://pubmed.ncbi.nlm.nih.gov/${hit.pmid}/`,
      problems,
    };
  }

  problems.push("No se ha localizado el estudio en Crossref ni en PubMed.");
  return { reference, status: "no_encontrada", retracted: false, problems };
}

/** Step 3 — cross-match in-text citations with the reference list. */
export function crossMatch(extraction: ExtractionResult): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const numeric = extraction.detectedStyle !== "autor-fecha";
  const referenceKeys = new Set<string>();

  extraction.references.forEach((reference, index) => {
    if (typeof reference.number === "number") referenceKeys.add(String(reference.number));
    else referenceKeys.add(String(index + 1));
    if (reference.firstAuthor && reference.year) {
      referenceKeys.add(`${reference.firstAuthor.toLowerCase()} ${reference.year}`);
    }
  });

  const usedKeys = new Set<string>();

  extraction.citations.forEach((citation, index) => {
    for (const target of citation.targets) {
      const key = numeric ? target.trim() : target.trim().toLowerCase();
      const authorYear = key.replace(/[(),]/g, "").trim();
      const matched = referenceKeys.has(key) || referenceKeys.has(authorYear);
      if (matched) {
        usedKeys.add(key);
        usedKeys.add(authorYear);
        continue;
      }
      issues.push({
        id: `orphan-${index}-${target}`,
        severity: "critico",
        category: "cita_sin_referencia",
        title: `Cita «${citation.marker}» sin entrada en la bibliografía`,
        detail: citation.sentence
          ? `Aparece en: “${citation.sentence.slice(0, 220)}”`
          : "La llamada de cita no tiene correspondencia en la lista de referencias.",
        suggestion: "Añade la referencia completa o corrige el número/autor de la llamada.",
      });
    }
  });

  extraction.references.forEach((reference, index) => {
    const number = typeof reference.number === "number" ? String(reference.number) : String(index + 1);
    const authorYear =
      reference.firstAuthor && reference.year ? `${reference.firstAuthor.toLowerCase()} ${reference.year}` : "";
    if (usedKeys.has(number) || (authorYear && usedKeys.has(authorYear))) return;
    issues.push({
      id: `unused-${index}`,
      severity: "medio",
      category: "referencia_sin_cita",
      title: `Referencia ${number} no citada en el texto`,
      detail: reference.raw.slice(0, 220),
      reference: reference.raw,
      suggestion: "Cítala en el cuerpo del texto o elimínala de la bibliografía.",
    });
  });

  if (numeric) {
    const numbers = extraction.references
      .map((reference, index) => reference.number ?? index + 1)
      .sort((a, b) => a - b);
    for (let index = 0; index < numbers.length; index += 1) {
      if (numbers[index] !== index + 1) {
        issues.push({
          id: `numbering-${index}`,
          severity: "alto",
          category: "numeracion",
          title: "Numeración de la bibliografía inconsistente",
          detail: `Se esperaba la referencia ${index + 1} y se encontró ${numbers[index]}. Hay saltos o duplicados.`,
          suggestion: "Renumera la lista de forma consecutiva según el orden de aparición.",
        });
        break;
      }
    }
  }

  for (const note of extraction.structureNotes ?? []) {
    issues.push({
      id: `structure-${note.slice(0, 12)}`,
      severity: "bajo",
      category: "formato",
      title: "Observación de formato",
      detail: note,
    });
  }

  return issues;
}

/** Step 4 — does the cited source actually support the sentence citing it? */
export async function checkClaimSupport(input: {
  pairs: { marker: string; sentence: string; referenceTitle: string; abstract?: string }[];
  language: string;
  signal?: AbortSignal;
}): Promise<{ marker: string; verdict: "sustentado" | "dudoso" | "no_sustentado"; reason: string }[]> {
  if (input.pairs.length === 0) return [];
  return chatJson<{ marker: string; verdict: "sustentado" | "dudoso" | "no_sustentado"; reason: string }[]>(
    [
      {
        role: "system",
        content: `Eres revisor por pares de una revista biomédica. Para cada par (frase citante, fuente citada) juzga si la fuente puede sustentar razonablemente la afirmación.
El idioma de la frase y el de la fuente pueden ser distintos: compara el contenido, no el idioma.
Sé prudente: marca "no_sustentado" solo si el tema de la fuente es claramente ajeno a la afirmación; "dudoso" si el vínculo es débil o no verificable con los metadatos disponibles.
Responde en ${input.language}.
PROHIBIDO: No incluyas razonamiento ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE JSON (sin texto antes ni después): [{"marker":"","verdict":"sustentado|dudoso|no_sustentado","reason":"máx. 220 caracteres"}]`,
      },
      {
        role: "user",
        content: JSON.stringify(input.pairs.slice(0, 25)),
      },
    ],
    { temperature: 0.1, maxTokens: 6000, signal: input.signal },
  );
}

/** Turns the raw findings into a 0-100 integrity score. */
export function scoreAudit(issues: AuditIssue[], checks: ReferenceCheck[]): number {
  let penalty = 0;
  for (const issue of issues) {
    if (issue.severity === "critico") penalty += 8;
    else if (issue.severity === "alto") penalty += 5;
    else if (issue.severity === "medio") penalty += 2.5;
    else if (issue.severity === "bajo") penalty += 0.8;
  }
  for (const check of checks) {
    if (check.status === "no_encontrada") penalty += 6;
    else if (check.status === "parcial") penalty += 2;
    if (check.retracted) penalty += 12;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

/** Markdown report for download. */
export function buildReportMarkdown(report: AuditReport, fileName: string, style: CitationStyle): string {
  const lines: string[] = [];
  lines.push(`# Informe de auditoría bibliográfica`);
  lines.push("");
  lines.push(`**Documento:** ${fileName}`);
  lines.push(`**Fecha:** ${new Date().toLocaleString()}`);
  lines.push(`**Estilo evaluado:** ${style.toUpperCase()}`);
  lines.push(`**Índice de integridad:** ${report.score}/100`);
  lines.push(`**Referencias analizadas:** ${report.checks.length} · **Citas en texto:** ${report.extraction.citations.length}`);
  lines.push("");
  lines.push(`## Resumen`);
  lines.push(report.summary || "—");
  lines.push("");
  lines.push(`## Incidencias (${report.issues.length})`);
  if (report.issues.length === 0) lines.push("Sin incidencias detectadas.");
  for (const issue of report.issues) {
    lines.push(`- **[${issue.severity.toUpperCase()}] ${issue.title}** — ${issue.detail}${issue.suggestion ? ` _Sugerencia:_ ${issue.suggestion}` : ""}`);
  }
  lines.push("");
  lines.push(`## Verificación de referencias`);
  report.checks.forEach((check, index) => {
    const number = check.reference.number ?? index + 1;
    lines.push(`### ${number}. ${check.reference.title ?? check.reference.raw.slice(0, 90)}`);
    lines.push(`- Estado: ${check.status}${check.retracted ? " · ⚠️ RETRACTADA" : ""}`);
    if (check.similarity !== undefined) lines.push(`- Coincidencia de título: ${Math.round(check.similarity * 100)}%`);
    if (check.url) lines.push(`- Fuente: ${check.url}`);
    for (const problem of check.problems) lines.push(`- Problema: ${problem}`);
    if (check.formatted) lines.push(`- Corregida (${style.toUpperCase()}): ${check.formatted}`);
    lines.push("");
  });
  return lines.join("\n");
}
