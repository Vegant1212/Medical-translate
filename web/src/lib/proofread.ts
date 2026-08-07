/**
 * Proofreading module — double-check of spelling, abbreviations and acronyms.
 *
 * Given a medical text (optionally with its translation), the model:
 *  1. Detects orthographic / typographic errors (including medical-specific
 *     orthotipography: units, decimals, drug names, eponyms).
 *  2. Scans every abbreviation, acronym and contraction, verifies that it
 *     is used correctly in context, flags dangerous look-alikes (ISMP
 *     "Do Not Use" list) and checks that the expansion matches.
 *  3. Returns a structured report with suggested corrections.
 */

import { chatJson, searchMedical, type WebSource } from "./toolkit";
import { DOMAINS, REGISTERS, localeDescriptor, type MedicalDomain, type RegisterLevel } from "./languages";

export type IssueSeverity = "critico" | "alto" | "medio" | "bajo" | "informativo";

export type IssueCategory =
  | "ortografia"
  | "tipografia"
  | "abreviatura"
  | "sigla"
  | "acronimo"
  | "contraccion"
  | "eponimo"
  | "farmaco"
  | "unidad"
  | "ortotipografia"
  | "estilo";

export interface ProofIssue {
  /** Original text fragment where the issue was found. */
  excerpt: string;
  /** What is wrong (short description in the user's language). */
  problem: string;
  /** Suggested fix or correct form. */
  suggestion: string;
  /** Why this is flagged — brief clinical / linguistic rationale. */
  rationale: string;
  severity: IssueSeverity;
  category: IssueCategory;
  /** Approximate 0-based character offset in the source text (-1 if unknown). */
  offset: number;
}

export interface AbbreviationCheck {
  /** The abbreviation / acronym as it appears in the text. */
  token: string;
  /** Expansion used in the text (empty if never expanded). */
  expansionInText: string;
  /** Correct expansion for the context. */
  correctExpansion: string;
  /** Whether the usage in context is correct. */
  isCorrect: boolean;
  /** Whether this token appears in the ISMP "Do Not Use" or look-alike list. */
  isDangerous: boolean;
  /** Alternative readings if ambiguous. */
  alternatives: string[];
  /** Recommended normalised code (CIE-11, SNOMED, ATC, MeSH…). */
  normalizedCode?: string;
  note: string;
}

export interface ProofreadResult {
  issues: ProofIssue[];
  abbreviations: AbbreviationCheck[];
  summary: string;
  /** Overall quality score 0–100. */
  score: number;
  /** Human-readable list of global recommendations. */
  recommendations: string[];
  detectedLanguage: string;
}

export interface ProofreadOptions {
  text: string;
  /** Optional translation to cross-check against the source. */
  translation?: string;
  sourceLanguage: string | "auto";
  targetLanguage?: string;
  sourceVariant?: string;
  targetVariant?: string;
  register: RegisterLevel;
  domain: MedicalDomain;
  signal?: AbortSignal;
}

const PROOF_ROLE = `Eres un corrector médico experto y terminólogo clínico con dominio de la ortotipografía médica en español, inglés, portugués y francés.
Conoces la lista ISMP "Do Not Use" de abreviaturas peligrosas, las normas de la AMA Manual of Style (11.ª ed.), los requisitos de la ICH E3 y la ortotipografía de unidades SI.
Reglas:
- Detecta errores de ortografía, tipografía y ortotipografía médica (separadores decimales, espacios en unidades, mayúsculas en fármacos, epónimos).
- Verifica cada abreviatura, sigla, acrónimo y contracción: ¿está bien usada en contexto? ¿Está bien expandida? ¿Es peligrosa?
- Marca las abreviaturas de la lista ISMP "Do Not Use" (p. ej. U, IU, QD, QOD, MS, MSO4, MgSO4, cc, µg) como peligrosas.
- Si se proporciona una traducción, coteja que las abreviaturas y los términos clave coinciden entre origen y destino.
- No inventes errores. Si el texto es correcto, devuelve listas vacías y un score alto.`;

function registerInstruction(register: RegisterLevel): string {
  return REGISTERS.find((item) => item.id === register)?.instruction ?? "";
}

function domainInstruction(domain: MedicalDomain): string {
  return DOMAINS.find((item) => item.id === domain)?.instruction ?? "";
}

/** Runs the proofreading model call and optional web verification in parallel. */
export async function proofreadMedicalText(options: ProofreadOptions): Promise<ProofreadResult> {
  const sourceDescriptor =
    options.sourceLanguage === "auto"
      ? "detecta automáticamente el idioma"
      : localeDescriptor(options.sourceLanguage, options.sourceVariant);

  const targetBlock = options.translation
    ? `\nTRADUCCIÓN A COTEJAR (en ${localeDescriptor(options.targetLanguage ?? "", options.targetVariant)}):\n${options.translation}\n\nCoteja que cada abreviatura y término clave del origen tenga su equivalente correcto en la traducción. Marca discrepancias como issues de categoría "abreviatura" o "sigla" con severity "alto".`
    : "";

  const system = `${PROOF_ROLE}

TAREA: revisar un texto médico y devolver un informe estructurado de corrección.
Idioma del texto: ${sourceDescriptor}.
REGISTRO: ${registerInstruction(options.register)}
${domainInstruction(options.domain)}
${targetBlock}

PROHIBIDO: No incluyas razonamiento ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto antes ni después) con esta forma:
{
  "issues": [{
    "excerpt": "fragmento exacto del texto original (máx. 120 caracteres)",
    "problem": "descripción breve del error",
    "suggestion": "corrección propuesta",
    "rationale": "por qué es un error (norma, ISMP, AMA Manual of Style, etc.)",
    "severity": "critico|alto|medio|bajo|informativo",
    "category": "ortografia|tipografia|abreviatura|sigla|acronimo|contraccion|eponimo|farmaco|unidad|ortotipografia|estilo",
    "offset": 0
  }],
  "abbreviations": [{
    "token": "abreviatura tal como aparece",
    "expansionInText": "expansión usada en el texto (vacío si no se expandió)",
    "correctExpansion": "expansión correcta para el contexto",
    "isCorrect": true,
    "isDangerous": false,
    "alternatives": ["otras lecturas plausibles"],
    "normalizedCode": "código normalizado si existe",
    "note": "nota breve sobre su uso o riesgo"
  }],
  "summary": "resumen ejecutivo del estado del texto (máx. 300 caracteres)",
  "score": 85,
  "recommendations": ["recomendaciones globales accionables"],
  "detectedLanguage": "código ISO 639-1"
}
Ordena "issues" por aparición. "score" es un entero 0–100 que refleja la calidad ortotípica y terminológica global. No añadas texto fuera del JSON.`;

  const result = await chatJson<ProofreadResult>(
    [
      { role: "system", content: system },
      { role: "user", content: options.text },
    ],
    { temperature: 0.15, maxTokens: 12000, signal: options.signal },
  );

  // Sanitise
  return {
    issues: Array.isArray(result.issues) ? result.issues : [],
    abbreviations: Array.isArray(result.abbreviations) ? result.abbreviations : [],
    summary: result.summary ?? "Sin resumen.",
    score: typeof result.score === "number" ? Math.max(0, Math.min(100, Math.round(result.score))) : 0,
    recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
    detectedLanguage: result.detectedLanguage ?? "",
  };
}

export interface AbbreviationVerification {
  token: string;
  status: "confirmado" | "parcial" | "discrepancia" | "sin_datos";
  verdict: string;
  sources: WebSource[];
}

/** Cross-checks a single abbreviation against trusted medical portals. */
export async function verifyAbbreviation(
  token: string,
  expansion: string,
  domain: MedicalDomain,
  signal?: AbortSignal,
): Promise<AbbreviationVerification> {
  const queries = [
    `${token} abbreviation medical "${expansion}"`,
    `"${token}" medical abbreviation meaning`,
  ];

  const batches = await Promise.all(
    queries.map((query) =>
      searchMedical(query, { numResults: 4, signal }).catch((error: unknown) => {
        console.error("abbrev verification search failed", error);
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
      token,
      status: "sin_datos",
      verdict: "No se obtuvieron resultados en los portales científicos.",
      sources: [],
    };
  }

  const corpus = sources
    .map((source, index) => `[${index + 1}] ${source.title} — ${source.domain}\n${source.snippet}`)
    .join("\n\n");

  const judged = await chatJson<{ status: AbbreviationVerification["status"]; verdict: string }>(
    [
      {
        role: "system",
        content: `${PROOF_ROLE}

TAREA: verificar si la expansión "${expansion}" es correcta para la abreviatura "${token}" según la evidencia aportada.
${domainInstruction(domain)}
PROHIBIDO: No incluyas razonamiento ni texto fuera del JSON.
Devuelve EXCLUSIVAMENTE JSON (sin texto antes ni después):
{"status":"confirmado|parcial|discrepancia|sin_datos","verdict":"veredicto breve (máx. 300 caracteres)"}`,
      },
      {
        role: "user",
        content: `Abreviatura: ${token}\nExpansión propuesta: ${expansion}\n\nEVIDENCIA:\n${corpus}`,
      },
    ],
    { temperature: 0.1, maxTokens: 1500, signal },
  );

  return { token, status: judged.status, verdict: judged.verdict, sources };
}

/** Generates a downloadable markdown report from a proofread result. */
export function buildProofreadReport(
  result: ProofreadResult,
  sourceText: string,
  options: { sourceLanguage?: string; targetLanguage?: string } = {},
): string {
  const lines: string[] = [];
  lines.push("# Informe de corrección médica — MedLingua");
  lines.push("");
  lines.push(`**Idioma detectado:** ${result.detectedLanguage || "N/D"}`);
  if (options.sourceLanguage) lines.push(`**Idioma de origen:** ${options.sourceLanguage}`);
  if (options.targetLanguage) lines.push(`**Idioma de destino:** ${options.targetLanguage}`);
  lines.push(`**Puntuación global:** ${result.score}/100`);
  lines.push("");
  lines.push("## Resumen");
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  if (result.recommendations.length > 0) {
    lines.push("## Recomendaciones globales");
    lines.push("");
    for (const rec of result.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push("");
  }

  if (result.issues.length > 0) {
    lines.push("## Problemas detectados");
    lines.push("");
    lines.push("| # | Severidad | Categoría | Fragmento | Problema | Sugerencia |");
    lines.push("|---|-----------|-----------|-----------|----------|------------|");
    result.issues.forEach((issue, index) => {
      const excerpt = issue.excerpt.replace(/\|/g, "\\|").slice(0, 80);
      const problem = issue.problem.replace(/\|/g, "\\|");
      const suggestion = issue.suggestion.replace(/\|/g, "\\|");
      lines.push(
        `| ${index + 1} | ${issue.severity} | ${issue.category} | ${excerpt} | ${problem} | ${suggestion} |`,
      );
    });
    lines.push("");
  }

  if (result.abbreviations.length > 0) {
    lines.push("## Verificación de abreviaturas y siglas");
    lines.push("");
    lines.push("| Token | Expansión en texto | Expansión correcta | ¿Correcto? | ¿Peligrosa? | Nota |");
    lines.push("|-------|--------------------|--------------------|------------|-------------|------|");
    for (const abbr of result.abbreviations) {
      const note = abbr.note.replace(/\|/g, "\\|");
      lines.push(
        `| ${abbr.token} | ${abbr.expansionInText.replace(/\|/g, "\\|")} | ${abbr.correctExpansion.replace(/\|/g, "\\|")} | ${abbr.isCorrect ? "Sí" : "No"} | ${abbr.isDangerous ? "Sí" : "No"} | ${note} |`,
      );
    }
    lines.push("");
  }

  if (result.issues.length === 0 && result.abbreviations.length === 0) {
    lines.push("## Sin incidencias");
    lines.push("");
    lines.push("No se detectaron errores ortográficos, tipográficos ni de abreviaturas.");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("### Texto revisado");
  lines.push("");
  lines.push("```");
  lines.push(sourceText);
  lines.push("```");

  return lines.join("\n");
}
