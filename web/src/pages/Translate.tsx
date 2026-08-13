import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BookmarkPlus,
  Download,
  Eraser,
  ExternalLink,
  FileText,
  Info,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { TranslationProgress } from "@/components/TranslationProgress";
import { CopyButton, LanguageBar, Panel, RegisterDomainControls, Spinner, StatusPill } from "@/components/controls";
import { textToDocx } from "@/lib/docx-export";
import { translationToPdf, translationToTxt } from "@/lib/pdf-export";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/context/settings";
import { languageLabel } from "@/lib/languages";
import { detectLanguageLocally } from "@/lib/language-detection";
import {
  translateMedicalText,
  verifyAgainstSources,
  type GlossaryEntry,
  type TranslationResult,
  type VerificationResult,
} from "@/lib/medical";

const SAMPLE = `Px masc. 67 a., HTA y DM2 de larga data, acude a URG por dolor torácico opresivo de 40 min irradiado a MSI, con diaforesis. TA 168/96, FC 104 lpm, SatO2 94% aa. ECG: elevación del ST en V2-V4. Troponina I ultrasensible 3,2 ng/mL. Se activa código IAM y se traslada a UCIC para ACTP primaria. AAS 300 mg + ticagrelor 180 mg VO, HNF 60 UI/kg IV en bolo.`;

const MAX_TRANSLATION_CHARS = 50_000;

interface OptionToggleProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function OptionToggle({ label, hint, checked, onChange }: OptionToggleProps) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 bg-elevated/40 px-3 py-2.5 transition hover:border-primary/30">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 data-[state=checked]:bg-primary" />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight">{label}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function TermCard({ term, targetLanguage }: { term: GlossaryEntry; targetLanguage: string }) {
  const { addGlossaryEntry, domain } = useSettings();
  const [verification, setVerification] = useState<VerificationResult | undefined>(undefined);

  const verify = useMutation({
    mutationFn: () =>
      verifyAgainstSources({
        subject: `${term.source} (${term.expansionSource})`,
        claim: `equivale en ${languageLabel(targetLanguage)} a "${term.target}" — ${term.expansionTarget}. Definición: ${term.definition}`,
        language: "español",
        domain,
        extraQueries: [`${term.expansionSource} definición`, `"${term.source}" abbreviation meaning medical`],
      }),
    onSuccess: (result) => setVerification(result),
    onError: (error: unknown) => {
      console.error("term verification failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo cotejar el término.");
    },
  });

  const confidence = Math.round((term.confidence ?? 0) * 100);

  return (
    <div className="rounded-xl border border-border/60 bg-elevated/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="term-chip">{term.source}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-mono text-[12px] font-medium text-foreground">{term.target}</span>
        <StatusPill status="bajo">{term.type}</StatusPill>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-secondary">
            <span
              className="block h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(6, confidence)}%` }}
            />
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{confidence}%</span>
        </span>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
        <span className="text-foreground/90">{term.expansionSource}</span>
        {term.expansionTarget ? <> · {term.expansionTarget}</> : null}
      </p>
      {term.definition ? <p className="mt-1.5 text-[12.5px] leading-relaxed">{term.definition}</p> : null}
      {term.countryNote ? (
        <p className="mt-1.5 flex gap-1.5 text-[11.5px] leading-snug text-info">
          <Info className="mt-[1px] h-3 w-3 shrink-0" /> {term.countryNote}
        </p>
      ) : null}
      {term.ambiguity && term.ambiguity.length > 0 ? (
        <p className="mt-1.5 flex gap-1.5 text-[11.5px] leading-snug text-warn">
          <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" /> Otras lecturas: {term.ambiguity.join(" · ")}
        </p>
      ) : null}

      <div className="mt-2.5 flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={verify.isPending}
          onClick={() => verify.mutate()}
          className="h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-primary"
        >
          {verify.isPending ? <Spinner label="Cotejando…" /> : <><ShieldCheck className="h-3.5 w-3.5" /> Cotejar</>}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            addGlossaryEntry({ source: term.source, target: term.target, note: term.definition });
            toast.success(`«${term.source}» añadido a tu glosario`);
          }}
          className="h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-primary"
        >
          <BookmarkPlus className="h-3.5 w-3.5" /> Fijar
        </Button>
      </div>

      {verification ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-2 overflow-hidden rounded-lg border border-border/60 bg-background/50 p-2.5"
        >
          <div className="flex items-center gap-2">
            <StatusPill status={verification.status} />
            <span className="label-xs">{verification.sources.length} fuentes</span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed">{verification.verdict}</p>
          {verification.preferredForm ? (
            <p className="mt-1 text-[11.5px] text-primary">Forma preferida: {verification.preferredForm}</p>
          ) : null}
          <ul className="mt-2 space-y-1">
            {verification.sources.slice(0, 5).map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground transition hover:text-primary"
                >
                  <ExternalLink className="mt-[2px] h-3 w-3 shrink-0" />
                  <span className="min-w-0">
                    <span className="line-clamp-1">{source.title}</span>
                    <span className="font-mono text-[10px] text-muted-foreground/70">{source.domain}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </motion.div>
      ) : null}
    </div>
  );
}

export default function TranslatePage() {
  const settings = useSettings();
  const [text, setText] = useState<string>("");
  const [keepAcronyms, setKeepAcronyms] = useState<boolean>(true);
  const [expandAbbr, setExpandAbbr] = useState<boolean>(false);
  const [backTranslation, setBackTranslation] = useState<boolean>(false);
  const [result, setResult] = useState<TranslationResult | undefined>(undefined);
  const [dragging, setDragging] = useState<boolean>(false);
  const [translateStart, setTranslateStart] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const translationControllerRef = useRef<AbortController | null>(null);

  const handleDroppedFile = useCallback(async (file: File): Promise<void> => {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".txt") && !name.endsWith(".md") && !file.type.startsWith("text/")) {
      toast.error("Suelta un archivo .txt o .md para cargar su texto aquí.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("El archivo de texto es demasiado grande (máx. 2 MB).");
      return;
    }
    try {
      const content = await file.text();
      if (content.length > MAX_TRANSLATION_CHARS) {
        toast.error(`El texto supera el máximo de ${MAX_TRANSLATION_CHARS.toLocaleString()} caracteres por traducción.`);
        return;
      }
      setText(content);
      setResult(undefined);
      toast.success(`«${file.name}» cargado (${content.length} caracteres)`);
    } catch {
      toast.error("No se pudo leer el archivo de texto.");
    }
  }, []);

  useEffect(() => {
    translationControllerRef.current?.abort();
    translationControllerRef.current = null;
    setResult(undefined);
  }, [
    text,
    settings.sourceLanguage,
    settings.targetLanguage,
    settings.register,
    settings.domain,
    settings.variants,
    settings.glossaryPairs,
    keepAcronyms,
    expandAbbr,
    backTranslation,
  ]);

  const translate = useMutation({
    mutationFn: (signal: AbortSignal) =>
      translateMedicalText({
        text,
        sourceLanguage: settings.sourceLanguage,
        sourceVariant: settings.variants[settings.sourceLanguage],
        targetLanguage: settings.targetLanguage,
        targetVariant: settings.variants[settings.targetLanguage],
        register: settings.register,
        domain: settings.domain,
        keepOriginalAcronyms: keepAcronyms,
        expandAbbreviations: expandAbbr,
        withBackTranslation: backTranslation,
        customGlossary: settings.glossaryPairs,
        signal,
      }),
    onMutate: () => {
      setResult(undefined);
      setTranslateStart(Date.now());
    },
    onSuccess: (data) => setResult(data),
    onError: (error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("translation failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo traducir el texto.");
    },
    onSettled: (_data, _error, signal) => {
      if (translationControllerRef.current?.signal === signal) {
        translationControllerRef.current = null;
      }
    },
  });

  const handleTranslate = useCallback((): void => {
    if (text.trim().length < 2) {
      toast.error("Escribe o pega un texto para traducir.");
      return;
    }
    if (text.length > MAX_TRANSLATION_CHARS) {
      toast.error(`El texto supera el máximo de ${MAX_TRANSLATION_CHARS.toLocaleString()} caracteres por traducción.`);
      return;
    }
    if (settings.sourceLanguage !== "auto" && settings.sourceLanguage === settings.targetLanguage) {
      toast.error("El idioma de origen y el idioma de destino deben ser distintos.");
      return;
    }
    translationControllerRef.current?.abort();
    const controller = new AbortController();
    translationControllerRef.current = controller;
    translate.mutate(controller.signal);
  }, [text, settings.sourceLanguage, settings.targetLanguage, translate]);

  const handleCancelTranslation = useCallback((): void => {
    translationControllerRef.current?.abort();
    translationControllerRef.current = null;
    toast.info("Traducción cancelada.");
  }, []);

  const handleDownloadWord = useCallback(async (): Promise<void> => {
    if (!result?.translation) return;
    try {
      const blob = await textToDocx(result.translation, {
        title: `Traducción · ${languageLabel(settings.targetLanguage)}`,
        lang: settings.targetLanguage,
      });
      saveAs(blob, `medlingua-traduccion-${Date.now()}.docx`);
      toast.success("Documento Word descargado");
    } catch (error) {
      console.error("docx export failed", error);
      toast.error("No se pudo generar el documento Word.");
    }
  }, [result, settings.targetLanguage]);

  const handleDownloadPdf = useCallback((): void => {
    if (!result?.translation) return;
    try {
      const blob = translationToPdf({
        sourceText: text,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        targetVariant: settings.variants[settings.targetLanguage],
        result,
        register: settings.register,
        domain: settings.domain,
      });
      saveAs(blob, `medlingua-traduccion-${Date.now()}.pdf`);
      toast.success("PDF descargado");
    } catch (error) {
      console.error("pdf export failed", error);
      toast.error("No se pudo generar el PDF.");
    }
  }, [result, text, settings]);

  const handleDownloadTxt = useCallback((): void => {
    if (!result?.translation) return;
    try {
      const blob = translationToTxt({
        sourceText: text,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        targetVariant: settings.variants[settings.targetLanguage],
        result,
        register: settings.register,
        domain: settings.domain,
      });
      saveAs(blob, `medlingua-traduccion-${Date.now()}.txt`);
      toast.success("Archivo de texto descargado");
    } catch (error) {
      console.error("txt export failed", error);
      toast.error("No se pudo generar el archivo de texto.");
    }
  }, [result, text, settings]);

  const charCount = text.length;
  const terms = useMemo(() => result?.terms ?? [], [result]);
  const detectedLanguage = useMemo(() => detectLanguageLocally(text), [text]);

  return (
    <AppShell
      title="Traducción médica especializada"
      subtitle="Bidireccional, por país y por nivel de complejidad — de lenguaje de paciente a artículo indexado."
      actions={
        <Button
          type="button"
          onClick={handleTranslate}
          disabled={translate.isPending}
          className="gap-2 rounded-xl bg-primary font-medium text-primary-foreground shadow-glow transition active:scale-[0.97]"
        >
          {translate.isPending ? (
            <Spinner label="Traduciendo…" />
          ) : (
            <>
              <Wand2 className="h-4 w-4" /> Traducir
            </>
          )}
        </Button>
      }
    >
      <div className="mx-auto max-w-[1400px] space-y-5">
        <Panel className="p-4">
          <div className="space-y-4">
            <LanguageBar detectedLanguage={detectedLanguage} />
            <div className="h-px hairline" />
            <RegisterDomainControls />
            <div className="grid gap-2 sm:grid-cols-3">
              <OptionToggle
                label="Conservar sigla original"
                hint="Añade la sigla de origen entre paréntesis."
                checked={keepAcronyms}
                onChange={setKeepAcronyms}
              />
              <OptionToggle
                label="Expandir abreviaturas"
                hint="Desarrolla toda abreviatura o contracción."
                checked={expandAbbr}
                onChange={setExpandAbbr}
              />
              <OptionToggle
                label="Retrotraducción"
                hint="Control de calidad al idioma de origen."
                checked={backTranslation}
                onChange={setBackTranslation}
              />
            </div>
          </div>
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title="Texto original"
            meta={
              settings.sourceLanguage === "auto"
                ? "Idioma detectado automáticamente"
                : languageLabel(settings.sourceLanguage)
            }
            actions={
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setText(SAMPLE)}
                  className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-primary"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Ejemplo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Borrar texto original"
                  onClick={() => {
                    setText("");
                    setResult(undefined);
                  }}
                  className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-destructive"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </Button>
              </div>
            }
          >
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) void handleDroppedFile(file);
              }}
              className={cn("relative", dragging && "ring-2 ring-primary/50 ring-inset")}
            >
              {dragging ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 backdrop-blur-sm">
                  <p className="font-serif text-[15px] text-primary">Suelta el archivo .txt aquí</p>
                </div>
              ) : null}
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    handleTranslate();
                  }
                }}
                onDrop={(event) => {
                  event.stopPropagation();
                  const file = event.dataTransfer.files[0];
                  if (file) void handleDroppedFile(file);
                }}
                placeholder="Pega aquí un informe clínico, un consentimiento informado, un abstract o una ficha técnica… También puedes arrastrar un .txt"
                spellCheck={false}
                className="min-h-[340px] resize-y rounded-none border-0 bg-transparent px-4 py-3.5 font-sans text-[14px] leading-relaxed focus-visible:ring-0"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleDroppedFile(file);
              }}
            />
            <footer className="flex flex-col items-start gap-1 border-t border-border/60 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className={cn("label-xs", charCount > MAX_TRANSLATION_CHARS && "text-destructive")}>
                {charCount.toLocaleString()} / {MAX_TRANSLATION_CHARS.toLocaleString()} caracteres
              </span>
              <span className="label-xs">⌘/Ctrl + Intro · Traducir</span>
            </footer>
          </Panel>

          <Panel
            title="Traducción"
            meta={`${languageLabel(settings.targetLanguage)} · ${settings.variants[settings.targetLanguage] ?? "neutro"}`}
            actions={result ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleDownloadPdf}
                  className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-primary"
                >
                  <Download className="h-3.5 w-3.5" /> PDF
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleDownloadWord}
                  className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-primary"
                >
                  <Download className="h-3.5 w-3.5" /> Word
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleDownloadTxt}
                  className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-primary"
                >
                  <FileText className="h-3.5 w-3.5" /> TXT
                </Button>
                <CopyButton value={result.translation} />
              </div>
            ) : null}
          >
            <div className="relative min-h-[340px] px-4 py-3.5">
              <AnimatePresence mode="wait">
              {translate.isPending ? (
                <motion.div
                  key="progress"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0"
                >
                  <TranslationProgress
                    active={translate.isPending}
                    startTime={translateStart}
                    charCount={charCount}
                    onCancel={handleCancelTranslation}
                  />
                </motion.div>
              ) : result ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{result.translation}</p>
                  {result.backTranslation ? (
                    <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-3">
                      <p className="flex items-center gap-1.5 label-xs">
                        <Repeat2 className="h-3 w-3" /> Retrotraducción de control
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                        {result.backTranslation}
                      </p>
                    </div>
                  ) : null}
                </motion.div>
              ) : (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[13px] leading-relaxed text-muted-foreground"
                >
                  La traducción aparecerá aquí junto al glosario de siglas, abreviaturas y epónimos detectados, con su
                  definición y su uso por país.
                </motion.p>
              )}
              </AnimatePresence>
            </div>
          </Panel>
        </div>

        {result && (result.warnings?.length > 0 || result.notes?.length > 0) ? (
          <div className="grid gap-4 md:grid-cols-2">
            {result.warnings?.length > 0 ? (
              <Panel title="Advertencias de seguridad" meta="Revisar antes de usar clínicamente" className="p-0">
                <ul className="space-y-2 p-4">
                  {result.warnings.map((warning) => (
                    <li key={warning} className="flex gap-2 text-[12.5px] leading-relaxed text-warn">
                      <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0" />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
            {result.notes?.length > 0 ? (
              <Panel title="Notas del traductor" meta="Decisiones terminológicas">
                <ul className="space-y-2 p-4">
                  {result.notes.map((note) => (
                    <li key={note} className="flex gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
                      <Info className="mt-[2px] h-3.5 w-3.5 shrink-0 text-info" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>
        ) : null}

        {terms.length > 0 ? (
          <Panel
            title={`Glosario detectado · ${terms.length}`}
            meta="Cada término puede cotejarse contra portales científicos"
          >
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {terms.map((term, index) => (
                <motion.div
                  key={`${term.source}-${index}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.3) }}
                >
                  <TermCard term={term} targetLanguage={settings.targetLanguage} />
                </motion.div>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
    </AppShell>
  );
}
