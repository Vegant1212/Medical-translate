/** Language + regional-variant registry. New languages are added by extending CATALOG. */

export interface LanguageVariant {
  /** BCP-47-ish code, e.g. "es-MX". */
  code: string;
  /** Country / region label shown in the UI. */
  label: string;
  /** Short note about local medical usage. */
  note?: string;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  /** Two-letter region indicator rendered as a flag emoji. */
  flag: string;
  /** True for the four launch languages that are always available. */
  core: boolean;
  variants: LanguageVariant[];
}

export const CATALOG: Language[] = [
  {
    code: "es",
    name: "Español",
    nativeName: "Español",
    flag: "🇪🇸",
    core: true,
    variants: [
      { code: "es-ES", label: "España", note: "Terminología de la AEMPS y el Diccionario de términos médicos de la RANM." },
      { code: "es-MX", label: "México", note: "Nomenclatura de la NOM y del IMSS." },
      { code: "es-AR", label: "Argentina", note: "Uso rioplatense; ANMAT." },
      { code: "es-CO", label: "Colombia", note: "INVIMA; lenguaje del SGSSS." },
      { code: "es-CL", label: "Chile", note: "ISP; GES/AUGE." },
      { code: "es-PE", label: "Perú", note: "DIGEMID; MINSA." },
      { code: "es-419", label: "Latinoamérica (neutro)", note: "Español neutro sin marcas locales." },
    ],
  },
  {
    code: "en",
    name: "Inglés",
    nativeName: "English",
    flag: "🇬🇧",
    core: true,
    variants: [
      { code: "en-US", label: "Estados Unidos", note: "Ortografía US, unidades convencionales, CPT/ICD-10-CM." },
      { code: "en-GB", label: "Reino Unido", note: "Ortografía UK, NICE, BNF, unidades SI." },
      { code: "en-AU", label: "Australia", note: "TGA; ortografía UK." },
      { code: "en-IN", label: "India", note: "Inglés médico indio; CDSCO." },
    ],
  },
  {
    code: "pt",
    name: "Portugués",
    nativeName: "Português",
    flag: "🇵🇹",
    core: true,
    variants: [
      { code: "pt-BR", label: "Brasil", note: "ANVISA, SUS, DeCS en portugués de Brasil." },
      { code: "pt-PT", label: "Portugal", note: "INFARMED; ortografía europea." },
    ],
  },
  {
    code: "fr",
    name: "Francés",
    nativeName: "Français",
    flag: "🇫🇷",
    core: true,
    variants: [
      { code: "fr-FR", label: "Francia", note: "ANSM, HAS, Vidal." },
      { code: "fr-CA", label: "Canadá (Québec)", note: "Terminología de l'OQLF y Santé Canada." },
      { code: "fr-BE", label: "Bélgica", note: "AFMPS." },
      { code: "fr-CH", label: "Suiza", note: "Swissmedic." },
    ],
  },
  {
    code: "de",
    name: "Alemán",
    nativeName: "Deutsch",
    flag: "🇩🇪",
    core: false,
    variants: [
      { code: "de-DE", label: "Alemania", note: "BfArM; ICD-10-GM." },
      { code: "de-AT", label: "Austria" },
      { code: "de-CH", label: "Suiza" },
    ],
  },
  {
    code: "it",
    name: "Italiano",
    nativeName: "Italiano",
    flag: "🇮🇹",
    core: false,
    variants: [{ code: "it-IT", label: "Italia", note: "AIFA." }],
  },
  {
    code: "ca",
    name: "Catalán",
    nativeName: "Català",
    flag: "🏴",
    core: false,
    variants: [{ code: "ca-ES", label: "Cataluña", note: "TERMCAT." }],
  },
  {
    code: "nl",
    name: "Neerlandés",
    nativeName: "Nederlands",
    flag: "🇳🇱",
    core: false,
    variants: [{ code: "nl-NL", label: "Países Bajos" }],
  },
  {
    code: "zh",
    name: "Chino",
    nativeName: "中文",
    flag: "🇨🇳",
    core: false,
    variants: [
      { code: "zh-CN", label: "China (simplificado)" },
      { code: "zh-TW", label: "Taiwán (tradicional)" },
    ],
  },
  {
    code: "ar",
    name: "Árabe",
    nativeName: "العربية",
    flag: "🇸🇦",
    core: false,
    variants: [{ code: "ar-SA", label: "Golfo / estándar moderno" }],
  },
  {
    code: "ru",
    name: "Ruso",
    nativeName: "Русский",
    flag: "🇷🇺",
    core: false,
    variants: [{ code: "ru-RU", label: "Rusia" }],
  },
  {
    code: "ja",
    name: "Japonés",
    nativeName: "日本語",
    flag: "🇯🇵",
    core: false,
    variants: [{ code: "ja-JP", label: "Japón", note: "PMDA." }],
  },
  {
    code: "hi",
    name: "Hindi",
    nativeName: "हिन्दी",
    flag: "🇮🇳",
    core: false,
    variants: [{ code: "hi-IN", label: "India" }],
  },
  {
    code: "tr",
    name: "Turco",
    nativeName: "Türkçe",
    flag: "🇹🇷",
    core: false,
    variants: [{ code: "tr-TR", label: "Turquía" }],
  },
];

export const CORE_LANGUAGE_CODES: string[] = CATALOG.filter((language) => language.core).map(
  (language) => language.code,
);

/** Languages whose scripts are outside Latin-1 — relevant when rewriting PDFs in place. */
export const NON_LATIN_LANGUAGES: string[] = ["zh", "ar", "ru", "ja", "hi"];

export function getLanguage(code: string): Language | undefined {
  return CATALOG.find((language) => language.code === code);
}

export function languageLabel(code: string): string {
  return getLanguage(code)?.name ?? code;
}

export function variantLabel(languageCode: string, variantCode: string | undefined): string {
  if (!variantCode) return "Neutro";
  const variant = getLanguage(languageCode)?.variants.find((item) => item.code === variantCode);
  return variant?.label ?? variantCode;
}

/** Human-readable target descriptor used inside prompts, e.g. "Español (México, es-MX)". */
export function localeDescriptor(languageCode: string, variantCode?: string): string {
  const language = getLanguage(languageCode);
  if (!language) return languageCode;
  if (!variantCode) return `${language.name} (variante neutra, ${language.code})`;
  const variant = language.variants.find((item) => item.code === variantCode);
  if (!variant) return `${language.name} (${variantCode})`;
  return `${language.name} — uso de ${variant.label} (${variant.code})${variant.note ? `; ${variant.note}` : ""}`;
}

export type RegisterLevel = "paciente" | "divulgacion" | "clinico" | "cientifico";

export interface RegisterDefinition {
  id: RegisterLevel;
  label: string;
  short: string;
  instruction: string;
}

export const REGISTERS: RegisterDefinition[] = [
  {
    id: "paciente",
    label: "Paciente",
    short: "Lenguaje llano",
    instruction:
      "Lenguaje llano para pacientes y cuidadores (lectura ~6.º grado). Sustituye cada término técnico por su equivalente cotidiano y añade la forma técnica entre paréntesis solo la primera vez. Frases cortas. No pierdas ningún dato clínico, dosis ni cifra.",
  },
  {
    id: "divulgacion",
    label: "Divulgación",
    short: "Prensa / educación",
    instruction:
      "Registro de divulgación sanitaria: preciso pero accesible, apto para material educativo o prensa especializada. Explica brevemente los tecnicismos imprescindibles.",
  },
  {
    id: "clinico",
    label: "Clínico",
    short: "Historia / informes",
    instruction:
      "Registro clínico profesional propio de historias clínicas, informes de alta y notas de evolución. Mantén siglas de uso estándar en el idioma destino y la concisión telegráfica habitual.",
  },
  {
    id: "cientifico",
    label: "Científico",
    short: "Artículo / protocolo",
    instruction:
      "Registro científico-técnico de artículo indexado, protocolo de ensayo clínico o ficha técnica: terminología normalizada (MeSH/DeCS, SNOMED CT, DCI/INN, MedDRA), voz impersonal, precisión estadística absoluta.",
  },
];

export type MedicalDomain = "humana" | "veterinaria" | "ambas";

export const DOMAINS: { id: MedicalDomain; label: string; instruction: string }[] = [
  {
    id: "humana",
    label: "Medicina humana",
    instruction: "Dominio: medicina humana. Usa nomenclatura DCI/INN, MeSH/DeCS, CIE-11 y SNOMED CT.",
  },
  {
    id: "veterinaria",
    label: "Veterinaria",
    instruction:
      "Dominio: medicina veterinaria. Distingue especie, usa nomenclatura de Nomina Anatomica Veterinaria, terminología de la WOAH/OIE y dosis por especie; señala fármacos con uso off-label o prohibido en animales de producción.",
  },
  {
    id: "ambas",
    label: "Humana + veterinaria",
    instruction:
      "Dominio mixto (One Health): cubre medicina humana y veterinaria; cuando un término difiera entre ambas, indícalo explícitamente en las notas.",
  },
];
