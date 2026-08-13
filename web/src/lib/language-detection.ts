import { CATALOG } from "@/lib/languages";

const SIGNALS: Record<string, string[]> = {
  es: [" el ", " la ", " los ", " las ", " de ", " del ", " que ", " con ", " para ", " paciente ", " tratamiento "],
  en: [" the ", " and ", " of ", " to ", " with ", " for ", " patient ", " treatment ", " disease ", " study "],
  pt: [" o ", " a ", " os ", " as ", " de ", " do ", " da ", " que ", " com ", " para ", " paciente ", " tratamento "],
  fr: [" le ", " la ", " les ", " des ", " du ", " de ", " et ", " avec ", " pour ", " patient ", " traitement "],
};

/** Fast, private, on-device hint for the language picker. The AI confirms it during translation. */
export function detectLanguageLocally(text: string): string | undefined {
  const normalized = ` ${text.toLocaleLowerCase().replace(/[^\p{L}]+/gu, " ")} `;
  if (normalized.trim().length < 18) return undefined;

  const scores = Object.entries(SIGNALS)
    .map(([code, words]) => ({
      code,
      score: words.reduce((total, word) => total + (normalized.split(word).length - 1), 0),
    }))
    .sort((a, b) => b.score - a.score);

  if (!scores[0] || scores[0].score < 2 || scores[0].score === scores[1]?.score) return undefined;
  return CATALOG.some((language) => language.code === scores[0].code) ? scores[0].code : undefined;
}
