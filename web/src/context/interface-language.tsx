import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type InterfaceLanguage = "es" | "en" | "pt";

const STORAGE_KEY = "medlingua-interface-language";

const InterfaceLanguageContext = createContext<{
  language: InterfaceLanguage;
  setLanguage: (language: InterfaceLanguage) => void;
}>({ language: "es", setLanguage: () => undefined });

export function InterfaceLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<InterfaceLanguage>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "en" || saved === "pt" ? saved : "es";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language === "pt" ? "pt-BR" : language;
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <InterfaceLanguageContext.Provider value={value}>{children}</InterfaceLanguageContext.Provider>;
}

export function useInterfaceLanguage() {
  return useContext(InterfaceLanguageContext);
}
