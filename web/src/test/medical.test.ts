import { describe, expect, it } from "vitest";

import { findMissingNumericValues, isDocumentTranslationComplete, normalizeTranslationResult, preservesDocumentTokens } from "@/lib/medical";

describe("normalizeTranslationResult", () => {
  it("normalizes optional collections and confidence", () => {
    const result = normalizeTranslationResult({
      translation: "Acute myocardial infarction",
      detectedLanguage: "es",
      terms: [
        {
          source: "IAM",
          target: "AMI",
          type: "sigla",
          expansionSource: "infarto agudo de miocardio",
          expansionTarget: "acute myocardial infarction",
          definition: "Acute myocardial necrosis caused by ischemia.",
          confidence: 2,
        },
      ],
    });

    expect(result.notes).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.terms[0].confidence).toBe(0);
  });

  it("rejects an empty translation", () => {
    expect(() => normalizeTranslationResult({ translation: "" })).toThrow(/formato inválido/);
  });
});

describe("findMissingNumericValues", () => {
  it("accepts localized decimal punctuation", () => {
    expect(findMissingNumericValues("Troponina 3,2 ng/mL", "Troponin 3.2 ng/mL")).toEqual([]);
  });

  it("reports omitted clinical values", () => {
    expect(findMissingNumericValues("TA 168/96, AAS 300 mg", "BP 168/96, aspirin given")).toEqual(["300"]);
  });

  it("detects a missing duplicate value", () => {
    expect(findMissingNumericValues("5 mg ahora y 5 mg después", "5 mg now and later")).toEqual(["5"]);
  });
});

describe("preservesDocumentTokens", () => {
  it("accepts untouched doses, citations, DOI and URLs", () => {
    const source = "Dose 5.2 mg [12]. DOI 10.1000/xyz123 https://example.org/a";
    const translation = "Dosis 5.2 mg [12]. DOI 10.1000/xyz123 https://example.org/a";
    expect(preservesDocumentTokens(source, translation)).toBe(true);
  });

  it("rejects reformatted or invented numeric values", () => {
    expect(preservesDocumentTokens("Dose 5.2 mg [12]", "Dosis 5,2 mg [12]")).toBe(false);
    expect(preservesDocumentTokens("Dose 5.2 mg [12]", "Dosis 5.2 mg [13]")).toBe(false);
    expect(preservesDocumentTokens("Dose 5.2 mg", "Dosis 5.2 mg por 2 días")).toBe(false);
  });
});

describe("isDocumentTranslationComplete", () => {
  it("rejects unchanged source prose", () => {
    const source = "The patients in the study were treated with the same protocol.";
    expect(isDocumentTranslationComplete(source, source, "en", "es")).toBe(false);
  });

  it("rejects a passage that remains predominantly in the source language", () => {
    expect(isDocumentTranslationComplete(
      "The results of the study were reported for the patients.",
      "The results of the study fueron reportados para the patients.",
      "en",
      "es",
    )).toBe(false);
  });

  it("accepts translated clinical prose", () => {
    expect(isDocumentTranslationComplete(
      "The results of the study were reported for the patients.",
      "Se informaron los resultados del estudio para los pacientes.",
      "en",
      "es",
    )).toBe(true);
  });

  it("accepts unchanged author and institution names", () => {
    expect(isDocumentTranslationComplete(
      "John Smith, Maria Rossi, University Medical Center, Boston",
      "John Smith, Maria Rossi, University Medical Center, Boston",
      "en",
      "es",
    )).toBe(true);
  });

  it("rejects unchanged short section headings", () => {
    expect(isDocumentTranslationComplete(
      "MATERIALS AND METHODS",
      "MATERIALS AND METHODS",
      "en",
      "es",
    )).toBe(false);
  });

  it("rejects short mixed-language residue", () => {
    expect(isDocumentTranslationComplete(
      "Background and methods of the study",
      "Antecedentes and methods del estudio",
      "en",
      "es",
    )).toBe(false);
  });

  it("rejects a pathologically duplicated translation", () => {
    const source = "The patients received basiliximab after renal transplantation and were followed for twelve months.";
    const duplicated = "Los pacientes recibieron basiliximab después del trasplante renal y fueron seguidos durante doce meses. ".repeat(4);
    expect(isDocumentTranslationComplete(source, duplicated, "en", "es")).toBe(false);
  });

  it("rejects an expanded answer for a short scientific heading", () => {
    expect(isDocumentTranslationComplete(
      "INTRODUCTION",
      "INTRODUCCIÓN GENERAL AL ESTUDIO CLÍNICO Y SUS PRINCIPALES OBJETIVOS",
      "en",
      "es",
    )).toBe(false);
  });
});
