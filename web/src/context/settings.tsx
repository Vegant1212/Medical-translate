import createContextHook from "@nkzw/create-context-hook";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CitationStyle } from "@/lib/citations";
import { CORE_LANGUAGE_CODES, type MedicalDomain, type RegisterLevel } from "@/lib/languages";

export interface GlossaryOverride {
  id: string;
  source: string;
  target: string;
  note?: string;
}

export interface SavedReference {
  id: string;
  createdAt: number;
  style: CitationStyle;
  text: string;
  doi?: string;
  status: string;
}

interface PersistedState {
  enabledLanguages: string[];
  sourceLanguage: string;
  targetLanguage: string;
  variants: Record<string, string>;
  register: RegisterLevel;
  domain: MedicalDomain;
  citationStyle: CitationStyle;
  glossary: GlossaryOverride[];
  references: SavedReference[];
}

const STORAGE_KEY = "medlingua.settings.v1";

const DEFAULT_STATE: PersistedState = {
  enabledLanguages: CORE_LANGUAGE_CODES,
  sourceLanguage: "auto",
  targetLanguage: "en",
  variants: { es: "es-419", en: "en-US", pt: "pt-BR", fr: "fr-FR" },
  register: "clinico",
  domain: "humana",
  citationStyle: "vancouver",
  glossary: [],
  references: [],
};

function loadState(): PersistedState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      enabledLanguages: Array.from(
        new Set([...CORE_LANGUAGE_CODES, ...(parsed.enabledLanguages ?? [])]),
      ),
      variants: { ...DEFAULT_STATE.variants, ...(parsed.variants ?? {}) },
      glossary: parsed.glossary ?? [],
      references: parsed.references ?? [],
    };
  } catch (error) {
    console.error("settings: could not restore state", error);
    return DEFAULT_STATE;
  }
}

export const [SettingsProvider, useSettings] = createContextHook(() => {
  const [state, setState] = useState<PersistedState>(loadState);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("settings: could not persist state", error);
    }
  }, [state]);

  const patch = useCallback((next: Partial<PersistedState>): void => {
    setState((previous) => ({ ...previous, ...next }));
  }, []);

  const setVariant = useCallback((language: string, variant: string): void => {
    setState((previous) => ({ ...previous, variants: { ...previous.variants, [language]: variant } }));
  }, []);

  const toggleLanguage = useCallback((code: string): void => {
    setState((previous) => {
      if (CORE_LANGUAGE_CODES.includes(code)) return previous;
      const enabled = previous.enabledLanguages.includes(code)
        ? previous.enabledLanguages.filter((item) => item !== code)
        : [...previous.enabledLanguages, code];
      return {
        ...previous,
        enabledLanguages: enabled,
        targetLanguage: enabled.includes(previous.targetLanguage) ? previous.targetLanguage : "en",
        sourceLanguage:
          previous.sourceLanguage === "auto" || enabled.includes(previous.sourceLanguage)
            ? previous.sourceLanguage
            : "auto",
      };
    });
  }, []);

  const swapLanguages = useCallback((): void => {
    setState((previous) => {
      if (previous.sourceLanguage === "auto") return previous;
      return {
        ...previous,
        sourceLanguage: previous.targetLanguage,
        targetLanguage: previous.sourceLanguage,
      };
    });
  }, []);

  const addGlossaryEntry = useCallback((entry: Omit<GlossaryOverride, "id">): void => {
    setState((previous) => ({
      ...previous,
      glossary: [
        { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
        ...previous.glossary,
      ].slice(0, 200),
    }));
  }, []);

  const removeGlossaryEntry = useCallback((id: string): void => {
    setState((previous) => ({ ...previous, glossary: previous.glossary.filter((entry) => entry.id !== id) }));
  }, []);

  const addReference = useCallback((reference: Omit<SavedReference, "id" | "createdAt">): void => {
    setState((previous) => ({
      ...previous,
      references: [
        { ...reference, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now() },
        ...previous.references,
      ].slice(0, 300),
    }));
  }, []);

  const removeReference = useCallback((id: string): void => {
    setState((previous) => ({ ...previous, references: previous.references.filter((item) => item.id !== id) }));
  }, []);

  const clearReferences = useCallback((): void => {
    setState((previous) => ({ ...previous, references: [] }));
  }, []);

  const glossaryPairs = useMemo(
    () => state.glossary.map((entry) => ({ source: entry.source, target: entry.target })),
    [state.glossary],
  );

  return {
    ...state,
    patch,
    setVariant,
    toggleLanguage,
    swapLanguages,
    addGlossaryEntry,
    removeGlossaryEntry,
    addReference,
    removeReference,
    clearReferences,
    glossaryPairs,
  };
});
