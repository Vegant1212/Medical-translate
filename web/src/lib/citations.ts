/** Reference metadata, Crossref/PubMed lookup and deterministic APA / AMA / Vancouver formatting. */

import { chatJson, searchMedical, type WebSource } from "./toolkit";

export type CitationStyle = "apa" | "ama" | "vancouver";

export const CITATION_STYLES: { id: CitationStyle; label: string; hint: string }[] = [
  { id: "apa", label: "APA 7.ª", hint: "Autor-fecha, ciencias de la salud y sociales" },
  { id: "ama", label: "AMA 11.ª", hint: "Numérica, revistas médicas de EE. UU." },
  { id: "vancouver", label: "Vancouver", hint: "Numérica ICMJE, biomedicina" },
];

export interface Author {
  family: string;
  given?: string;
}

export interface WorkMetadata {
  type: "article" | "book" | "chapter" | "web" | "preprint" | "thesis" | "report" | "dataset";
  title: string;
  authors: Author[];
  groupAuthor?: string;
  containerTitle?: string;
  containerAbbrev?: string;
  publisher?: string;
  edition?: string;
  year?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  accessed?: string;
  language?: string;
  abstract?: string;
}

export interface VerifiedWork {
  metadata: WorkMetadata;
  /** Where the metadata was confirmed. */
  verification: {
    status: "verificada" | "parcial" | "no_encontrada";
    source: "crossref" | "pubmed" | "web" | "ninguna";
    matchedTitle?: string;
    titleSimilarity?: number;
    notes: string[];
    retracted?: boolean;
    url?: string;
  };
}

const DOI_PATTERN = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;

export function extractDoi(text: string): string | undefined {
  const match = text.match(DOI_PATTERN);
  return match?.[0]?.replace(/[.,;)\]]+$/, "");
}

export function extractPmid(text: string): string | undefined {
  const match = text.match(/\bPMID:?\s*(\d{6,9})\b/i);
  return match?.[1];
}

interface CrossrefAuthor {
  family?: string;
  given?: string;
  name?: string;
}

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  "container-title"?: string[];
  "short-container-title"?: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  URL?: string;
  type?: string;
  abstract?: string;
  language?: string;
  edition?: string;
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
  relation?: Record<string, unknown>;
  "update-to"?: { type?: string; DOI?: string; label?: string }[];
}

function crossrefYear(item: CrossrefItem): string | undefined {
  const parts =
    item.issued?.["date-parts"]?.[0] ??
    item["published-print"]?.["date-parts"]?.[0] ??
    item["published-online"]?.["date-parts"]?.[0];
  const year = parts?.[0];
  return typeof year === "number" ? String(year) : undefined;
}

function crossrefType(item: CrossrefItem): WorkMetadata["type"] {
  switch (item.type) {
    case "book":
    case "monograph":
      return "book";
    case "book-chapter":
      return "chapter";
    case "posted-content":
      return "preprint";
    case "dissertation":
      return "thesis";
    case "report":
      return "report";
    case "dataset":
      return "dataset";
    default:
      return "article";
  }
}

function toMetadata(item: CrossrefItem): WorkMetadata {
  return {
    type: crossrefType(item),
    title: (item.title?.[0] ?? "").replace(/\s+/g, " ").trim(),
    authors: (item.author ?? []).map((author) => ({
      family: author.family ?? author.name ?? "",
      given: author.given,
    })),
    containerTitle: item["container-title"]?.[0],
    containerAbbrev: item["short-container-title"]?.[0],
    publisher: item.publisher,
    edition: item.edition,
    year: crossrefYear(item),
    volume: item.volume,
    issue: item.issue,
    pages: item.page,
    doi: item.DOI,
    url: item.URL,
    language: item.language,
    abstract: item.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900),
  };
}

/** Fetches a work by DOI from the public Crossref REST API. */
export async function crossrefByDoi(doi: string, signal?: AbortSignal): Promise<CrossrefItem | undefined> {
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { signal });
  if (!response.ok) return undefined;
  const data = (await response.json()) as { message?: CrossrefItem };
  return data.message;
}

/** Searches Crossref by bibliographic string (title + authors + journal). */
export async function crossrefSearch(query: string, signal?: AbortSignal): Promise<CrossrefItem[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query.slice(0, 500));
  url.searchParams.set("rows", "5");
  url.searchParams.set("select", "DOI,title,author,container-title,short-container-title,volume,issue,page,issued,published-print,published-online,type,publisher,URL,abstract,language,update-to");
  const response = await fetch(url.toString(), { signal });
  if (!response.ok) return [];
  const data = (await response.json()) as { message?: { items?: CrossrefItem[] } };
  return data.message?.items ?? [];
}

/** Best-effort PubMed lookup (used when Crossref has no record, e.g. older indexed papers). */
export async function pubmedSearch(query: string, signal?: AbortSignal): Promise<{ pmid: string; title: string }[]> {
  try {
    const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", "3");
    searchUrl.searchParams.set("term", query.slice(0, 300));
    const searchResponse = await fetch(searchUrl.toString(), { signal });
    if (!searchResponse.ok) return [];
    const searchData = (await searchResponse.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.searchParams.set("db", "pubmed");
    summaryUrl.searchParams.set("retmode", "json");
    summaryUrl.searchParams.set("id", ids.join(","));
    const summaryResponse = await fetch(summaryUrl.toString(), { signal });
    if (!summaryResponse.ok) return ids.map((pmid) => ({ pmid, title: "" }));
    const summaryData = (await summaryResponse.json()) as {
      result?: Record<string, { title?: string; uid?: string }>;
    };
    return ids.map((pmid) => ({ pmid, title: summaryData.result?.[pmid]?.title ?? "" }));
  } catch (error) {
    console.error("pubmed lookup failed", error);
    return [];
  }
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-overlap similarity (0-1) — good enough to detect mismatched reference titles. */
export function titleSimilarity(a: string, b: string): number {
  const left = new Set(normalizeTitle(a).split(" ").filter((word) => word.length > 3));
  const right = new Set(normalizeTitle(b).split(" ").filter((word) => word.length > 3));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function retractionFrom(item: CrossrefItem | undefined): boolean {
  const updates = item?.["update-to"] ?? [];
  return updates.some((update) => (update.type ?? "").toLowerCase().includes("retraction"));
}

/** Parses a free-text reference (any language) into structured metadata via the model. */
export async function parseReference(input: { raw: string; signal?: AbortSignal }): Promise<WorkMetadata> {
  return chatJson<WorkMetadata>(
    [
      {
        role: "system",
        content: `Eres un bibliotecario biomédico experto en metadatos CSL-JSON. Extrae los metadatos de la referencia o del fragmento de estudio que te den, en cualquier idioma y en cualquier estilo (APA, AMA, Vancouver, Harvard o texto libre).
PROHIBIDO: No incluyas razonamiento ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE JSON (sin texto antes ni después):
{"type":"article|book|chapter|web|preprint|thesis|report|dataset","title":"","authors":[{"family":"","given":""}],"groupAuthor":"","containerTitle":"","containerAbbrev":"","publisher":"","edition":"","year":"","volume":"","issue":"","pages":"","doi":"","pmid":"","url":"","language":""}
Reglas: no inventes datos ausentes (deja la cadena vacía u omite el campo). "given" con los nombres completos si constan. Conserva la mayúscula original del título. "pages" con el rango tal como aparece (p. ej. "1245-1253").`,
      },
      { role: "user", content: input.raw },
    ],
    { temperature: 0.05, maxTokens: 2000, signal: input.signal },
  );
}

/**
 * Extracts bibliographic metadata from the full text of a scientific article
 * (e.g. extracted from a PDF, Word or PowerPoint file).
 * Focuses on the title page / header region where authors, journal, year,
 * volume, issue, pages and DOI typically appear.
 */
export async function extractArticleMetadata(input: {
  text: string;
  fileName?: string;
  signal?: AbortSignal;
}): Promise<WorkMetadata> {
  const header = input.text.slice(0, 6000);
  const tail = input.text.length > 6000 ? `\n…[texto truncado, ${input.text.length} caracteres totales]` : "";
  const fileHint = input.fileName ? `\nNombre del archivo: ${input.fileName}` : "";

  return chatJson<WorkMetadata>(
    [
      {
        role: "system",
        content: `Eres un bibliotecano biomédico experto en metadatos CSL-JSON. Se te entrega el texto extraído de un artículo científico completo (de un PDF, Word o PowerPoint). Tu tarea es identificar los metadatos bibliográficos del estudio: título, autores, revista, año, volumen, número, páginas, DOI, PMID, tipo de documento e idioma.

Busca en el texto:
- El título (suele estar al principio, en fuente mayor).
- Los autores y sus afiliaciones.
- El nombre de la revista (container-title) y su abreviatura si aparece.
- Año, volumen, issue/número, páginas.
- DOI (formato 10.xxxx/yyyy) o PMID si aparecen en el texto.
- El tipo de documento: article, book, chapter, preprint, thesis, report, dataset, web.

PROHIBIDO: No incluyas razonamiento ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE JSON (sin texto antes ni después):
{"type":"article|book|chapter|web|preprint|thesis|report|dataset","title":"","authors":[{"family":"","given":""}],"groupAuthor":"","containerTitle":"","containerAbbrev":"","publisher":"","edition":"","year":"","volume":"","issue":"","pages":"","doi":"","pmid":"","url":"","language":""}
Reglas inviolables:
- No inventes datos que no aparezcan en el texto. Deja la cadena vacía si un campo no se encuentra.
- "family" = apellidos, "given" = nombres de pila completos si constan.
- Conserva la mayúscula original del título.
- "pages" con el rango tal como aparece (p. ej. "1245-1253").
- Si el DOI aparece como URL (https://doi.org/10.xxxx/yyy), extrae solo la parte 10.xxxx/yyy.
- Si hay varios DOIs, usa el del artículo principal, no el de una referencia citada.`,
      },
      { role: "user", content: `${header}${tail}${fileHint}` },
    ],
    { temperature: 0.05, maxTokens: 2500, signal: input.signal },
  );
}

/** Verifies pre-parsed metadata against Crossref, PubMed and web sources. */
export async function resolveAndVerifyFromMetadata(input: {
  metadata: WorkMetadata;
  /** Raw text the metadata was extracted from (used for PMID fallback). */
  raw?: string;
  signal?: AbortSignal;
}): Promise<VerifiedWork & { webSources?: WebSource[] }> {
  const notes: string[] = [];
  const parsed = input.metadata;
  const doi = parsed.doi ?? (input.raw ? extractDoi(input.raw) : undefined);

  if (doi) {
    const item = await crossrefByDoi(doi, input.signal).catch((error: unknown) => {
      console.error("crossref doi lookup failed", error);
      return undefined;
    });
    if (item) {
      return {
        metadata: { ...toMetadata(item), pmid: parsed.pmid ?? (input.raw ? extractPmid(input.raw) : undefined) },
        verification: {
          status: "verificada",
          source: "crossref",
          matchedTitle: item.title?.[0],
          titleSimilarity: 1,
          notes: ["DOI resuelto correctamente en Crossref."],
          retracted: retractionFrom(item),
          url: `https://doi.org/${item.DOI ?? doi}`,
        },
      };
    }
    notes.push(`El DOI ${doi} no se resolvió en Crossref: puede estar mal transcrito o no registrado.`);
  }

  const query = [parsed.title, parsed.authors?.[0]?.family, parsed.containerTitle, parsed.year]
    .filter(Boolean)
    .join(" ");

  const candidates = await crossrefSearch(query, input.signal).catch((error: unknown) => {
    console.error("crossref search failed", error);
    return [] as CrossrefItem[];
  });

  let best: { item: CrossrefItem; score: number } | undefined;
  for (const candidate of candidates) {
    const score = titleSimilarity(parsed.title ?? "", candidate.title?.[0] ?? "");
    if (!best || score > best.score) best = { item: candidate, score };
  }

  if (best && best.score >= 0.55) {
    const merged = toMetadata(best.item);
    const yearMismatch = parsed.year && merged.year && parsed.year !== merged.year;
    if (yearMismatch) notes.push(`El año citado (${parsed.year}) no coincide con el registrado (${merged.year}).`);
    if (parsed.doi && merged.doi && parsed.doi.toLowerCase() !== merged.doi.toLowerCase()) {
      notes.push(`El DOI citado (${parsed.doi}) difiere del DOI real (${merged.doi}).`);
    }
    return {
      metadata: { ...merged, pmid: parsed.pmid ?? (input.raw ? extractPmid(input.raw) : undefined) },
      verification: {
        status: best.score >= 0.82 && !yearMismatch ? "verificada" : "parcial",
        source: "crossref",
        matchedTitle: best.item.title?.[0],
        titleSimilarity: Number(best.score.toFixed(2)),
        notes,
        retracted: retractionFrom(best.item),
        url: merged.doi ? `https://doi.org/${merged.doi}` : merged.url,
      },
    };
  }

  const pubmed = await pubmedSearch(query, input.signal);
  const pubmedHit = pubmed.find((hit) => titleSimilarity(parsed.title ?? "", hit.title) >= 0.6);
  if (pubmedHit) {
    notes.push("Registro localizado en PubMed pero no en Crossref (posible artículo sin DOI).");
    return {
      metadata: { ...parsed, pmid: pubmedHit.pmid },
      verification: {
        status: "parcial",
        source: "pubmed",
        matchedTitle: pubmedHit.title,
        titleSimilarity: Number(titleSimilarity(parsed.title ?? "", pubmedHit.title).toFixed(2)),
        notes,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pubmedHit.pmid}/`,
      },
    };
  }

  const webSources = await searchMedical(`${parsed.title ?? query}`, {
    numResults: 5,
    signal: input.signal,
  }).catch((error: unknown) => {
    console.error("web fallback search failed", error);
    return [] as WebSource[];
  });

  notes.push("No se encontró coincidencia en Crossref ni en PubMed. Revisa título, autores y año.");
  return {
    metadata: parsed,
    verification: {
      status: webSources.length > 0 ? "parcial" : "no_encontrada",
      source: webSources.length > 0 ? "web" : "ninguna",
      notes,
    },
    webSources,
  };
}

/** Resolves + validates a reference: DOI → Crossref, else bibliographic search, else PubMed/web. */
export async function resolveAndVerify(input: {
  raw: string;
  signal?: AbortSignal;
}): Promise<VerifiedWork & { webSources?: WebSource[] }> {
  const doi = extractDoi(input.raw);

  if (doi) {
    const item = await crossrefByDoi(doi, input.signal).catch((error: unknown) => {
      console.error("crossref doi lookup failed", error);
      return undefined;
    });
    if (item) {
      return {
        metadata: { ...toMetadata(item), pmid: extractPmid(input.raw) },
        verification: {
          status: "verificada",
          source: "crossref",
          matchedTitle: item.title?.[0],
          titleSimilarity: 1,
          notes: ["DOI resuelto correctamente en Crossref."],
          retracted: retractionFrom(item),
          url: `https://doi.org/${item.DOI ?? doi}`,
        },
      };
    }
  }

  const parsed = await parseReference({ raw: input.raw, signal: input.signal });
  return resolveAndVerifyFromMetadata({ metadata: parsed, raw: input.raw, signal: input.signal });
}

/**
 * Full pipeline: extracts text from an uploaded document (PDF/DOCX/PPTX),
 * extracts bibliographic metadata via the model, then verifies against
 * Crossref/PubMed/web — returning the citation-ready verified work.
 */
export async function resolveAndVerifyFromFile(input: {
  file: File;
  signal?: AbortSignal;
}): Promise<VerifiedWork & { webSources?: WebSource[]; extractedText: string }> {
  const { parseDocument } = await import("./documents");
  const doc = await parseDocument(input.file);
  const text = doc.segments.map((s) => s.text).join("\n");
  if (text.trim().length < 50) {
    throw new Error(
      "No se pudo extraer texto del archivo. Si es un PDF escaneado, necesita OCR (no disponible aquí). Sube un PDF con texto seleccionable, o un .docx/.pptx.",
    );
  }

  const metadata = await extractArticleMetadata({
    text,
    fileName: input.file.name,
    signal: input.signal,
  });

  if (!metadata.title?.trim()) {
    throw new Error("No se pudo identificar el título del estudio en el documento. Prueba a pegar la referencia manualmente.");
  }

  const verified = await resolveAndVerifyFromMetadata({
    metadata,
    raw: text,
    signal: input.signal,
  });

  return { ...verified, extractedText: text.slice(0, 2000) };
}

/* ------------------------------------------------------------------ */
/* Deterministic formatters                                            */
/* ------------------------------------------------------------------ */

function initials(given: string | undefined, options: { dotted: boolean }): string {
  if (!given) return "";
  const parts = given.split(/[\s.-]+/).filter(Boolean);
  return parts
    .map((part) => part[0]?.toUpperCase() ?? "")
    .filter(Boolean)
    .map((letter) => (options.dotted ? `${letter}.` : letter))
    .join(options.dotted ? " " : "");
}

function apaAuthors(authors: Author[], connector: string): string {
  const formatted = authors.map((author) => {
    const family = author.family.trim();
    const given = initials(author.given, { dotted: true });
    return given ? `${family}, ${given}` : family;
  });
  if (formatted.length === 0) return "";
  if (formatted.length === 1) return formatted[0];
  if (formatted.length <= 20) {
    return `${formatted.slice(0, -1).join(", ")}, ${connector} ${formatted[formatted.length - 1]}`;
  }
  return `${formatted.slice(0, 19).join(", ")}, ... ${formatted[formatted.length - 1]}`;
}

function numericAuthors(authors: Author[], max: number): string {
  const formatted = authors.map((author) => {
    const family = author.family.trim();
    const given = initials(author.given, { dotted: false });
    return given ? `${family} ${given}` : family;
  });
  if (formatted.length === 0) return "";
  if (formatted.length <= max) return formatted.join(", ");
  return `${formatted.slice(0, max).join(", ")}, et al`;
}

function sentenceCase(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "";
  const lower = trimmed.length > 8 && trimmed === trimmed.toUpperCase() ? trimmed.toLowerCase() : trimmed;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function stripTrailingDot(value: string): string {
  return value.replace(/\.\s*$/, "");
}

export interface FormatOptions {
  /** Language of connectors: APA uses "y" in Spanish, "&" in English, "e" in Portuguese, "et" in French. */
  locale: string;
  /** Index for numeric styles. */
  index?: number;
}

function apaConnector(locale: string): string {
  switch (locale) {
    case "es":
      return "y";
    case "pt":
      return "e";
    case "fr":
      return "et";
    default:
      return "&";
  }
}

function accessedLabel(locale: string): string {
  switch (locale) {
    case "es":
      return "Consultado el";
    case "pt":
      return "Acessado em";
    case "fr":
      return "Consulté le";
    default:
      return "Accessed";
  }
}

/** Formats metadata in the requested style. Returns plain text (no markup). */
export function formatCitation(work: WorkMetadata, style: CitationStyle, options: FormatOptions): string {
  const year = work.year ?? "s.f.";
  const doiUrl = work.doi ? `https://doi.org/${work.doi.replace(/^https?:\/\/doi\.org\//i, "")}` : undefined;
  const journal = work.containerTitle ?? "";
  const journalAbbrev = work.containerAbbrev ?? work.containerTitle ?? "";
  const authorList = work.authors.filter((author) => author.family.trim().length > 0);

  if (style === "apa") {
    const authors = authorList.length > 0 ? apaAuthors(authorList, apaConnector(options.locale)) : (work.groupAuthor ?? "");
    const head = authors ? `${stripTrailingDot(authors)}. ` : "";
    const title = sentenceCase(work.title);
    if (work.type === "book" || work.type === "report" || work.type === "thesis") {
      const edition = work.edition ? ` (${work.edition} ed.)` : "";
      return `${head}(${year}). ${title}${edition}. ${work.publisher ?? ""}${doiUrl ? `. ${doiUrl}` : work.url ? `. ${work.url}` : ""}`
        .replace(/\s+\./g, ".")
        .replace(/\.\.+/g, ".")
        .trim();
    }
    if (work.type === "web") {
      return `${head}(${year}). ${title}. ${journal || work.publisher || ""}. ${work.url ?? ""}`.replace(/\s+/g, " ").trim();
    }
    const volumePart = work.volume ? ` ${work.volume}${work.issue ? `(${work.issue})` : ""}` : "";
    const pagesPart = work.pages ? `, ${work.pages}` : "";
    return `${head}(${year}). ${title}. ${journal}${volumePart}${pagesPart}.${doiUrl ? ` ${doiUrl}` : work.url ? ` ${work.url}` : ""}`
      .replace(/\s+/g, " ")
      .trim();
  }

  const number = options.index ? `${options.index}. ` : "";

  if (style === "ama") {
    const authors = authorList.length > 0 ? numericAuthors(authorList, 6) : (work.groupAuthor ?? "");
    if (work.type === "book" || work.type === "report" || work.type === "thesis") {
      return `${number}${authors ? `${authors}. ` : ""}${stripTrailingDot(work.title)}. ${work.edition ? `${work.edition} ed. ` : ""}${work.publisher ?? ""}; ${year}.`
        .replace(/\s+/g, " ")
        .trim();
    }
    if (work.type === "web") {
      return `${number}${authors ? `${authors}. ` : ""}${stripTrailingDot(work.title)}. ${journal || work.publisher || ""}. ${work.url ?? ""}. ${accessedLabel(options.locale)} ${work.accessed ?? new Date().toISOString().slice(0, 10)}.`
        .replace(/\s+/g, " ")
        .trim();
    }
    const volumePart = work.volume ? `;${work.volume}${work.issue ? `(${work.issue})` : ""}` : "";
    const pagesPart = work.pages ? `:${work.pages}` : "";
    return `${number}${authors ? `${authors}. ` : ""}${stripTrailingDot(work.title)}. ${stripTrailingDot(journalAbbrev)}. ${year}${volumePart}${pagesPart}.${work.doi ? ` doi:${work.doi.replace(/^https?:\/\/doi\.org\//i, "")}` : ""}`
      .replace(/\s+/g, " ")
      .trim();
  }

  // Vancouver (ICMJE)
  const authors = authorList.length > 0 ? numericAuthors(authorList, 6) : (work.groupAuthor ?? "");
  if (work.type === "book" || work.type === "report" || work.type === "thesis") {
    return `${number}${authors ? `${authors}. ` : ""}${stripTrailingDot(work.title)}. ${work.edition ? `${work.edition} ed. ` : ""}${work.publisher ?? ""}; ${year}.`
      .replace(/\s+/g, " ")
      .trim();
  }
  if (work.type === "web") {
    return `${number}${authors ? `${authors}. ` : ""}${stripTrailingDot(work.title)} [Internet]. ${work.publisher ?? journal}; ${year} [${accessedLabel(options.locale).toLowerCase()} ${work.accessed ?? new Date().toISOString().slice(0, 10)}]. Available from: ${work.url ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
  }
  const volumePart = work.volume ? `;${work.volume}${work.issue ? `(${work.issue})` : ""}` : "";
  const pagesPart = work.pages ? `:${work.pages}` : "";
  return `${number}${authors ? `${authors}. ` : ""}${stripTrailingDot(work.title)}. ${stripTrailingDot(journalAbbrev)}. ${year}${volumePart}${pagesPart}.${work.doi ? ` doi: ${work.doi.replace(/^https?:\/\/doi\.org\//i, "")}` : ""}${work.pmid ? ` PMID: ${work.pmid}.` : ""}`
    .replace(/\s+/g, " ")
    .trim();
}

/** In-text citation marker for the style. */
export function formatInText(work: WorkMetadata, style: CitationStyle, index?: number): string {
  if (style === "apa") {
    const first = work.authors[0]?.family ?? work.groupAuthor ?? "Anónimo";
    if (work.authors.length === 1 || !work.authors[1]) return `(${first}, ${work.year ?? "s.f."})`;
    if (work.authors.length === 2) return `(${first} y ${work.authors[1].family}, ${work.year ?? "s.f."})`;
    return `(${first} et al., ${work.year ?? "s.f."})`;
  }
  return `[${index ?? 1}]`;
}
