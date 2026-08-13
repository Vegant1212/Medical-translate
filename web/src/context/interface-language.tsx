import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { translateInterfaceCopy } from "@/lib/interface-copy";

export type InterfaceLanguage = "es" | "en" | "pt";

const STORAGE_KEY = "medlingua-interface-language";

const InterfaceLanguageContext = createContext<{
  language: InterfaceLanguage;
  setLanguage: (language: InterfaceLanguage) => void;
}>({ language: "en", setLanguage: () => undefined });

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const localizedWrites = new WeakSet<Text>();
const TRANSLATABLE_ATTRIBUTES = ["aria-label", "placeholder", "title"] as const;
const SKIPPED_ELEMENTS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"]);

function localizeElement(root: Node, language: InterfaceLanguage): void {
  const translateTextNode = (node: Text): void => {
    const parent = node.parentElement;
    if (!parent || SKIPPED_ELEMENTS.has(parent.tagName) || parent.closest("[data-interface-translate='off']")) return;
    const current = node.nodeValue ?? "";
    const source = originalText.get(node) ?? current;
    originalText.set(node, source);
    const trimmed = source.trim();
    if (!trimmed) return;
    const translated = translateInterfaceCopy(trimmed, language);
    const next = source.replace(trimmed, translated);
    if (current !== next) {
      localizedWrites.add(node);
      node.nodeValue = next;
    }
  };

  const translateAttributes = (element: Element): void => {
    if (element.closest("[data-interface-translate='off']")) return;
    let originals = originalAttributes.get(element);
    if (!originals) {
      originals = new Map<string, string>();
      originalAttributes.set(element, originals);
    }
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      const source = originals.get(attribute) ?? current;
      originals.set(attribute, source);
      const translated = translateInterfaceCopy(source, language);
      if (current !== translated) element.setAttribute(attribute, translated);
    }
  };

  if (root.nodeType === Node.TEXT_NODE) translateTextNode(root as Text);
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
    else translateAttributes(node as Element);
    node = walker.nextNode();
  }
}

export function InterfaceLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<InterfaceLanguage>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "es" || saved === "pt" ? saved : "en";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language === "pt" ? "pt-BR" : language;
  }, [language]);

  useEffect(() => {
    localizeElement(document.body, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const text = mutation.target as Text;
          if (localizedWrites.has(text)) localizedWrites.delete(text);
          else {
            originalText.delete(text);
            localizeElement(text, language);
          }
        }
        for (const node of mutation.addedNodes) localizeElement(node, language);
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <InterfaceLanguageContext.Provider value={value}>{children}</InterfaceLanguageContext.Provider>;
}

export function useInterfaceLanguage() {
  return useContext(InterfaceLanguageContext);
}
