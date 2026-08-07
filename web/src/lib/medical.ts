/** Medical language tasks: translation, terminology decoding, verification. */

import { chat, chatJson, searchMedical, type WebSource } from "./toolkit";
import { DOMAINS, REGISTERS, localeDescriptor, type MedicalDomain, type RegisterLevel } from "./languages";

export interface GlossaryEntry {
  source: string;
  target: string;
  type: "sigla" | "abreviatura" | "acronimo" | "contraccion" | "eponimo" | "farmaco" | "termino" | "unidad";
  expansionSource: string;
  expansionTarget: string;
  definition: string;
  countryNote?: string;
  confidence: number;
  ambiguity?: string[];
}

export interface TranslationResult {
  translation: string;
  detectedLanguage: string;
  terms: GlossaryEntry[];
  notes: string[];
  warnings: string[];
  backTranslation?: string;
}

export interface TranslateOptions {
  text: string;
  sourceLanguage: string | "auto";
  sourceVariant?: string;
  targetLanguage: string;
  targetVariant?: string;
  register: RegisterLevel;
  domain: MedicalDomain;
  keepOriginalAcronyms: boolean;
  expandAbbreviations: boolean;
  withBackTranslation: boolean;
  customGlossary: { source: string; target: string }[];
  signal?: AbortSignal;
}

const BASE_ROLE = `Eres un traductor médico certificado y terminólogo clínico con 25 años de experiencia en traducción biomédica (EMA/FDA), farmacovigilancia, historias clínicas, ensayos clínicos y medicina veterinaria.
Dominas la terminología normalizada: MeSH, DeCS, SNOMED CT, CIE-10/CIE-11, LOINC, MedDRA, DCI/INN, ATC, Nomina Anatomica y Nomina Anatomica Veterinaria.
Reglas inviolables:
- Nunca inventes datos. Nunca omitas cifras, dosis, unidades, vías de administración, intervalos de confianza ni valores p.
- Convierte unidades solo si el destino lo requiere y muestra siempre el valor original entre paréntesis.
- Resuelve las siglas por contexto; si una sigla es ambigua, elige la más probable y declara la ambigüedad.
- Respeta la ortotipografía médica del destino (decimales, separadores de miles, formato de fechas y unidades SI/convencionales).
- Conserva el formato del texto original: saltos de línea, viñetas, numeración, encabezados y marcadores.`;

function registerInstruction(register: RegisterLevel): string {
  return REGISTERS.find((item) => item.id === register)?.instruction ?? "";
}

function domainInstruction(domain: MedicalDomain): string {
  return DOMAINS.find((item) => item.id === domain)?.instruction ?? "";
}

/** Translates a free-text passage and returns the terminology glossary detected on the way. */
export async function translateMedicalText(options: TranslateOptions): Promise<TranslationResult> {
  const sourceDescriptor =
    options.sourceLanguage === "auto"
      ? "detecta automáticamente el idioma de origen"
      : localeDescriptor(options.sourceLanguage, options.sourceVariant);

  const glossaryBlock =
    options.customGlossary.length > 0
      ? `\nGLOSARIO OBLIGATORIO DEL USUARIO (respétalo literalmente):\n${options.customGlossary
          .map((entry) => `- "${entry.source}" => "${entry.target}"`)
          .join("\n")}`
      : "";

  const system = `${BASE_ROLE}

TAREA: traducir de ${sourceDescriptor} a ${localeDescriptor(options.targetLanguage, options.targetVariant)}.
REGISTRO: ${registerInstruction(options.register)}
${domainInstruction(options.domain)}
${options.keepOriginalAcronyms ? "Al traducir una sigla, escribe la sigla del idioma destino y añade la original entre paréntesis la primera vez, p. ej. «AMI (IAM)»." : "Usa únicamente la sigla estándar del idioma destino."}
${options.expandAbbreviations ? "Expande toda abreviatura o contracción del original a su forma completa en el destino y añade la sigla entre paréntesis en su primera aparición." : "Mantén las abreviaturas como abreviaturas si son estándar en el destino."}${glossaryBlock}

PROHIBIDO: No incluyas razonamiento, pensamientos ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta forma:
{
  "translation": "texto traducido completo, conservando saltos de línea",
  "detectedLanguage": "código ISO 639-1 del original",
  "terms": [{
    "source": "término o sigla tal como aparece",
    "target": "equivalente en el idioma destino",
    "type": "sigla|abreviatura|acronimo|contraccion|eponimo|farmaco|termino|unidad",
    "expansionSource": "forma desarrollada en el idioma origen",
    "expansionTarget": "forma desarrollada en el idioma destino",
    "definition": "definición clínica breve (máx. 220 caracteres)",
    "countryNote": "diferencia de uso por país si existe, si no omitir",
    "confidence": 0.0,
    "ambiguity": ["otras lecturas posibles de la sigla"]
  }],
  "notes": ["decisiones de traducción relevantes"],
  "warnings": ["ambigüedades, siglas peligrosas (lista ISMP), riesgos de dosis o datos incompletos"]${
    options.withBackTranslation
      ? ',\n  "backTranslation": "retrotraducción literal al idioma de origen para control de calidad"'
      : ""
  }
}
Incluye en "terms" cada sigla, abreviatura, epónimo, fármaco y unidad relevante (máximo 24, ordenados por aparición). Tu respuesta debe ser solo el JSON, sin texto antes ni después.`;

  return chatJson<TranslationResult>(
    [
      { role: "system", content: system },
      { role: "user", content: options.text },
    ],
    { temperature: 0.15, maxTokens: 16000, signal: options.signal },
  );
}

export interface AbbreviationReading {
  expansion: string;
  translation: string;
  specialty: string;
  regions: string[];
  domain: "humana" | "veterinaria" | "ambas";
  definition: string;
  likelihood: number;
  riskFlag?: string;
  normalizedCode?: string;
}

export interface AbbreviationResult {
  query: string;
  normalized: string;
  kind: string;
  readings: AbbreviationReading[];
  contextualPick?: string;
  safetyNotes: string[];
  searchQueries: string[];
}

/** Decodes an abbreviation / acronym / contraction, ranking every plausible reading. */
export async function decodeAbbreviation(input: {
  query: string;
  context: string;
  sourceLanguage: string;
  targetLanguage: string;
  targetVariant?: string;
  country?: string;
  domain: MedicalDomain;
  signal?: AbortSignal;
}): Promise<AbbreviationResult> {
  const system = `${BASE_ROLE}

TAREA: descifrar una abreviatura, sigla, acrónimo, contracción o símbolo médico y ofrecer todas sus lecturas plausibles.
Idioma de la abreviatura: ${input.sourceLanguage === "auto" ? "detéctalo" : localeDescriptor(input.sourceLanguage)}.
Idioma de las explicaciones y equivalencias: ${localeDescriptor(input.targetLanguage, input.targetVariant)}.
${input.country ? `Prioriza el uso documentado en: ${input.country}.` : "Indica el país o región donde predomina cada lectura."}
${domainInstruction(input.domain)}
Marca en "riskFlag" las abreviaturas de la lista "Do Not Use" del ISMP o de alto riesgo de error de medicación.
En "normalizedCode" añade el código normalizado cuando exista (CIE-11, SNOMED CT, LOINC, ATC, MeSH/DeCS).
PROHIBIDO: No incluyas razonamiento ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE JSON (sin texto antes ni después):
{"query":"","normalized":"","kind":"sigla|abreviatura|acronimo|contraccion|simbolo|epónimo","readings":[{"expansion":"","translation":"","specialty":"","regions":[""],"domain":"humana|veterinaria|ambas","definition":"","likelihood":0.0,"riskFlag":"","normalizedCode":""}],"contextualPick":"lectura más probable según el contexto aportado","safetyNotes":[""],"searchQueries":["2-4 consultas de búsqueda idóneas para cotejar estas lecturas en portales científicos"]}
Ordena "readings" de mayor a menor "likelihood" (máx. 8).`;

  const user = input.context.trim()
    ? `Abreviatura: ${input.query}\n\nContexto en el que aparece:\n${input.context}`
    : `Abreviatura: ${input.query}\n\n(Sin contexto adicional.)`;

  return chatJson<AbbreviationResult>(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 6000, signal: input.signal },
  );
}

export type VerificationStatus = "confirmado" | "parcial" | "discrepancia" | "sin_datos";

export interface VerificationResult {
  status: VerificationStatus;
  verdict: string;
  preferredForm?: string;
  evidence: { claim: string; source: string }[];
  sources: WebSource[];
}

/** Cross-checks a term/expansion against trusted medical portals and asks the model to judge. */
export async function verifyAgainstSources(input: {
  subject: string;
  claim: string;
  language: string;
  domain: MedicalDomain;
  extraQueries?: string[];
  signal?: AbortSignal;
}): Promise<VerificationResult> {
  const queries = [
    `${input.subject} ${input.claim} definición médica`.trim(),
    ...(input.extraQueries ?? []).slice(0, 2),
  ];

  const batches = await Promise.all(
    queries.map((query) =>
      searchMedical(query, { numResults: 5, signal: input.signal }).catch((error: unknown) => {
        console.error("verification search failed", error);
        return [] as WebSource[];
      }),
    ),
  );

  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const batch of batches) {
    for (const source of batch) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }

  if (sources.length === 0) {
    return {
      status: "sin_datos",
      verdict: "No se obtuvieron resultados en los portales científicos consultados.",
      evidence: [],
      sources: [],
    };
  }

  const corpus = sources
    .map((source, index) => `[${index + 1}] ${source.title} — ${source.domain}\n${source.snippet}`)
    .join("\n\n");

  const judged = await chatJson<Omit<VerificationResult, "sources">>(
    [
      {
        role: "system",
        content: `${BASE_ROLE}

TAREA: cotejar una afirmación terminológica contra extractos de portales científicos. Usa SOLO la evidencia aportada.
${domainInstruction(input.domain)}
PROHIBIDO: No incluyas razonamiento ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE JSON (sin texto antes ni después):
{"status":"confirmado|parcial|discrepancia|sin_datos","verdict":"veredicto en ${input.language} (máx. 400 caracteres)","preferredForm":"forma preferida o normalizada si la evidencia sugiere otra","evidence":[{"claim":"dato extraído","source":"dominio de la fuente"}]}`,
      },
      {
        role: "user",
        content: `Sujeto: ${input.subject}\nAfirmación a verificar: ${input.claim}\n\nEVIDENCIA:\n${corpus}`,
      },
    ],
    { temperature: 0.1, maxTokens: 2500, signal: input.signal },
  );

  return { ...judged, sources };
}

/**
 * Translates a single batch of segments via the model. Returns a map of id → translated text.
 * If the model returns fewer items than sent, missing ids are filled from the input as-is.
 */
async function translateOneBatch(
  segments: { id: string; text: string }[],
  input: {
    targetLanguage: string;
    targetVariant?: string;
    sourceLanguage: string | "auto";
    register: RegisterLevel;
    domain: MedicalDomain;
    glossary: { source: string; target: string }[];
    signal?: AbortSignal;
  },
): Promise<Record<string, string>> {
  const system = `${BASE_ROLE}

TAREA: traducir los segmentos de un documento profesional a ${localeDescriptor(input.targetLanguage, input.targetVariant)}.
Origen: ${input.sourceLanguage === "auto" ? "detéctalo automáticamente" : localeDescriptor(input.sourceLanguage)}.
REGISTRO: ${registerInstruction(input.register)}
${domainInstruction(input.domain)}
${
  input.glossary.length > 0
    ? `GLOSARIO OBLIGATORIO:\n${input.glossary.map((entry) => `- "${entry.source}" => "${entry.target}"`).join("\n")}`
    : ""
}
REGLAS DE FORMATO CRÍTICAS:
- Traduce cada segmento por separado y devuelve exactamente el mismo "id".
- No fusiones ni dividas segmentos. No añadas comentarios.
- Conserva números, códigos, DOI, URLs, nombres propios, referencias tipo "(1)" o "[12]" y espacios inicial/final del segmento.
- Si un segmento no debe traducirse (número, código, símbolo, sigla ya válida), devuélvelo idéntico.
- Sé conciso: el texto traducido debe tener una longitud similar al original para no romper la maquetación.

PROHIBIDO: No incluyas razonamiento, pensamientos, explicaciones ni texto fuera del JSON.
Tu respuesta debe empezar con [ y terminar con ].
Devuelve EXCLUSIVAMENTE el array JSON, sin texto antes ni después: [{"id":"s1","t":"traducción"}]`;

  const result = await chatJson<{ id: string; t: string }[]>(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(segments.map((segment) => ({ id: segment.id, t: segment.text }))) },
    ],
    { temperature: 0.15, maxTokens: 16000, signal: input.signal },
  );

  const map: Record<string, string> = {};
  for (const item of Array.isArray(result) ? result : []) {
    if (typeof item?.id === "string" && typeof item?.t === "string") {
      map[item.id] = item.t;
    }
  }
  // Fill any missing ids with original text (e.g. numbers/codes that need no translation)
  for (const segment of segments) {
    if (!(segment.id in map)) {
      map[segment.id] = segment.text;
    }
  }
  return map;
}

/**
 * Batch-translates document segments while keeping terminology consistent.
 * If a batch fails to parse (model emits prose instead of JSON), it is recursively
 * split in half and retried. Single-segment batches that fail fall back to original text.
 */
export async function translateSegments(input: {
  segments: { id: string; text: string }[];
  targetLanguage: string;
  targetVariant?: string;
  sourceLanguage: string | "auto";
  register: RegisterLevel;
  domain: MedicalDomain;
  glossary: { source: string; target: string }[];
  signal?: AbortSignal;
}): Promise<Record<string, string>> {
  // Base case: single segment — try once, fall back to original on failure
  if (input.segments.length <= 1) {
    try {
      return await translateOneBatch(input.segments, input);
    } catch (error) {
      console.warn("translateSegments: single-segment fallback", error);
      const map: Record<string, string> = {};
      for (const segment of input.segments) {
        map[segment.id] = segment.text;
      }
      return map;
    }
  }

  // Try the full batch first
  try {
    return await translateOneBatch(input.segments, input);
  } catch (error) {
    console.warn(
      `translateSegments: batch of ${input.segments.length} failed, splitting in half`,
      error instanceof Error ? error.message : error,
    );
  }

  // Split in half and recurse
  const mid = Math.ceil(input.segments.length / 2);
  const left = input.segments.slice(0, mid);
  const right = input.segments.slice(mid);

  const [leftMap, rightMap] = await Promise.all([
    translateSegments({ ...input, segments: left }),
    translateSegments({ ...input, segments: right }),
  ]);

  return { ...leftMap, ...rightMap };
}

/** Rewrites a passage at a different complexity level within the same language. */
export async function adaptRegister(input: {
  text: string;
  language: string;
  variant?: string;
  from: RegisterLevel;
  to: RegisterLevel;
  domain: MedicalDomain;
  signal?: AbortSignal;
}): Promise<string> {
  const raw = await chat(
    [
      {
        role: "system",
        content: `${BASE_ROLE}

TAREA: reescribir un texto médico dentro del MISMO idioma (${localeDescriptor(input.language, input.variant)}), pasando del registro "${input.from}" al registro "${input.to}".
${registerInstruction(input.to)}
${domainInstruction(input.domain)}
Devuelve únicamente el texto reescrito, sin comentarios ni encabezados.`,
      },
      { role: "user", content: input.text },
    ],
    { temperature: 0.25, maxTokens: 8000, signal: input.signal },
  );
  return raw.trim();
}
