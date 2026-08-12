import { useMutation } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  FileType2,
  Languages,
  Layers,
  Presentation,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { TranslationProgress } from "@/components/TranslationProgress";
import { LanguageBar, Panel, RegisterDomainControls, Segmented, Spinner } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/context/settings";
import {
  ACCEPTED_EXTENSIONS,
  buildTranslatedDocument,
  parseDocument,
  type DocKind,
  type ParsedDocument,
} from "@/lib/documents";
import { NON_LATIN_LANGUAGES, languageLabel } from "@/lib/languages";
import { detectLanguageLocally } from "@/lib/language-detection";
import { textToDocx } from "@/lib/docx-export";
import { translateFastSegments } from "@/lib/fast-translation";
import { createLocalProject, loadLocalProject, newProjectId, saveLocalProjectLanguages, saveLocalProjectState } from "@/lib/project-history";
import { isDocumentTranslationComplete, preservesDocumentTokens, verifyClinicalTranslations, type ClinicalVerificationIssue } from "@/lib/medical";
import { cn } from "@/lib/utils";

const KIND_META: Record<DocKind, { label: string; icon: typeof FileText; note: string }> = {
  pdf: {
    label: "PDF",
    icon: FileText,
    note: "Conserva páginas, columnas e imágenes; ajusta la tipografía cuando la traducción necesita más espacio.",
  },
  docx: {
    label: "Word (.docx)",
    icon: Layers,
    note: "Se reescriben solo los nodos de texto del OOXML: estilos, numeración, tablas e imágenes intactos.",
  },
  pptx: {
    label: "PowerPoint",
    icon: Presentation,
    note: "Cada cuadro de texto y las notas del orador se traducen sin tocar el diseño de las diapositivas.",
  },
};

type Filter = "todos" | "pendientes" | "editados";

function shouldPreserveText(text: string): boolean {
  const value = text.trim();
  if (/^[A-ZÀ-ÖØ-Þ' -]+ ET AL\.?$/u.test(value)) return true;
  if (/^\s*\d{1,3}\.\s+\p{Lu}/u.test(value)) return true;
  if (/\b(?:University|Hospital|Medical Center|Medical College|Clinics|Pharmaceuticals Corporation)\b/.test(value) && !/[.!?]\s+\p{Lu}/u.test(value)) return true;
  const allCaps = value === value.toLocaleUpperCase() && /^[\p{Lu}\d.,'&\-\s]+$/u.test(value);
  const isContentHeading = /\b(?:BASILIXIMAB|REJECTION|METHODS|MATERIALS|RESULTS|INTRODUCTION|DISCUSSION|CONCLUSIONS?|BACKGROUND|PATIENTS?|TREATMENT|THERAPY|SAFETY|SURVIVAL|REFERENCES)\b/.test(value);
  return allCaps && !isContentHeading;
}

const SPANISH_SCIENTIFIC_HEADINGS: Record<string, string> = {
  "INTRODUCTION": "INTRODUCCIÓN",
  "BACKGROUND": "ANTECEDENTES",
  "MATERIALS AND METHODS": "MATERIALES Y MÉTODOS",
  "METHODS": "MÉTODOS",
  "RESULTS": "RESULTADOS",
  "DISCUSSION": "DISCUSIÓN",
  "CONCLUSION": "CONCLUSIÓN",
  "CONCLUSIONS": "CONCLUSIONES",
  "REFERENCES": "REFERENCIAS",
  "PATIENTS": "PACIENTES",
  "TREATMENT REGIMEN": "RÉGIMEN DE TRATAMIENTO",
  "STATISTICAL ANALYSIS": "ANÁLISIS ESTADÍSTICO",
  "PATIENT POPULATION": "POBLACIÓN DE PACIENTES",
  "IMMUNOSUPPRESSIVE THERAPY": "TERAPIA INMUNOSUPRESORA",
  "REJECTION": "RECHAZO",
  "PATIENT AND GRAFT SURVIVAL": "SUPERVIVENCIA DEL PACIENTE Y DEL INJERTO",
  "SAFETY PROFILE": "PERFIL DE SEGURIDAD",
};

function fixedHeadingTranslation(text: string, targetLanguage: string): string | undefined {
  if (targetLanguage !== "es") return undefined;
  return SPANISH_SCIENTIFIC_HEADINGS[text.trim().toLocaleUpperCase()];
}

function preservedDocumentIds(document: ParsedDocument | undefined): Set<string> {
  const preserved = new Set<string>();
  if (!document) return preserved;
  for (const segment of document.segments) {
    if (segment.translatable === false || shouldPreserveText(segment.text)) preserved.add(segment.id);
  }
  if (document.kind !== "pdf" || !document.blocks) return preserved;

  const blocks = new Map(document.blocks.map((block) => [block.id, block]));
  for (const heading of document.segments.filter((segment) => /^\s*(?:REFERENCES|BIBLIOGRAPHY|REFERENCIAS|BIBLIOGRAFÍA)\s*$/i.test(segment.text))) {
    const headingBlock = blocks.get(heading.id);
    if (!headingBlock?.lines.length) continue;
    const referencePage = headingBlock.lines[0].page;
    const referenceX = Math.min(...headingBlock.lines.map((line) => line.x));
    const referenceY = Math.max(...headingBlock.lines.map((line) => line.y));
    for (const block of document.blocks) {
      if (!block.lines.length) continue;
      if (block.id === heading.id) continue;
      const page = block.lines[0].page;
      const x = Math.min(...block.lines.map((line) => line.x));
      const y = Math.max(...block.lines.map((line) => line.y));
      if (page > referencePage || (page === referencePage && x >= referenceX - 24 && y <= referenceY + 12)) {
        preserved.add(block.id);
      }
    }
  }
  return preserved;
}

export default function DocumentsPage() {
  const settings = useSettings();
  const [searchParams] = useSearchParams();
  const requestedProjectId = searchParams.get("project");
  const restoredProjectRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const translationControllerRef = useRef<AbortController | null>(null);
  const autoClinicalReviewRef = useRef<string | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [document, setDocument] = useState<ParsedDocument | undefined>(undefined);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [filter, setFilter] = useState<Filter>("todos");
  const [search, setSearch] = useState<string>("");
  const [dragging, setDragging] = useState<boolean>(false);
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const [translateStart, setTranslateStart] = useState<number>(0);
  const [clinicalIssues, setClinicalIssues] = useState<ClinicalVerificationIssue[] | undefined>();
  const blockingClinicalIssues = clinicalIssues?.filter((issue) => issue.severity === "alta") ?? [];
  const pdfClinicallyApproved = document?.kind !== "pdf" || (clinicalIssues !== undefined && blockingClinicalIssues.length === 0);
  const preservedIds = useMemo(() => preservedDocumentIds(document), [document]);
  const segmentIsComplete = useCallback((segment: { id: string; text: string }, values: Record<string, string> = translations) =>
    (preservedIds.has(segment.id) && values[segment.id] === segment.text) || isDocumentTranslationComplete(
      segment.text,
      values[segment.id],
      settings.sourceLanguage,
      settings.targetLanguage,
    ), [preservedIds, settings.sourceLanguage, settings.targetLanguage, translations]);

  const parse = useMutation({
    mutationFn: (file: File) => parseDocument(file),
    onSuccess: (parsed) => {
      const id = newProjectId();
      const detectedSource = detectLanguageLocally(parsed.segments.slice(0, 30).map((segment) => segment.text).join(" "));
      const sourceLanguage = detectedSource ?? settings.sourceLanguage;
      if (detectedSource && detectedSource !== settings.sourceLanguage) settings.patch({ sourceLanguage: detectedSource });
      setProjectId(id);
      setDocument(parsed);
      setTranslations({});
      setEdited({});
      setProgress({ done: 0, total: 0 });
      setExportWarnings([]);
      setClinicalIssues(undefined);
      autoClinicalReviewRef.current = null;
      void createLocalProject({
        id,
        document: parsed,
        sourceLanguage,
        targetLanguage: settings.targetLanguage,
      }).then(() => toast.success("Proyecto guardado en el historial local")).catch((error: unknown) => {
        console.error("initial project save failed", error);
        toast.error("El documento se abrió, pero el navegador no pudo guardarlo en el historial.");
      });
      toast.success(`${parsed.segments.length} segmentos listos para traducir`);
    },
    onError: (error: unknown) => {
      console.error("document parse failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo leer el documento.");
    },
  });

  const translate = useMutation({
    mutationFn: async (signal: AbortSignal): Promise<{ completed: number; remaining: number }> => {
      if (!document) throw new Error("Sube un documento primero.");
      const working = { ...translations };
      for (const segment of document.segments) {
        const fixedHeading = fixedHeadingTranslation(segment.text, settings.targetLanguage);
        if (fixedHeading) working[segment.id] = fixedHeading;
        else if (preservedIds.has(segment.id)) working[segment.id] = segment.text;
      }
      setTranslations((previous) => ({ ...previous, ...working }));
      const isComplete = (segment: { id: string; text: string }) => segmentIsComplete(segment, working);
      const initialDone = document.segments.filter(isComplete).length;
      setProgress({ done: initialDone, total: document.segments.length });

      // Retry only the residual segments. Short headings, citation-heavy lines,
      // and author rows occasionally need a smaller follow-up pass.
      for (let pass = 0; pass < 3; pass += 1) {
        const pending = document.segments.filter((segment) => !isComplete(segment));
        if (pending.length === 0) break;
        const pendingBeforePass = pending.length;
        const map = await translateFastSegments({
          segments: pending.map((segment) => ({ id: segment.id, text: segment.text })),
          targetLanguage: settings.targetLanguage,
          targetVariant: settings.variants[settings.targetLanguage],
          sourceLanguage: settings.sourceLanguage,
          signal,
          onProgress: (partial) => {
            for (const segment of pending) {
              const value = partial[segment.id];
              if (value && preservesDocumentTokens(segment.text, value)) working[segment.id] = value;
            }
            setTranslations((previous) => ({ ...previous, ...working }));
            setProgress({ done: document.segments.filter(isComplete).length, total: document.segments.length });
          },
        });
        for (const segment of pending) {
          const value = map[segment.id];
          if (value && preservesDocumentTokens(segment.text, value)) working[segment.id] = value;
        }
        setTranslations((previous) => ({ ...previous, ...working }));
        setProgress({ done: document.segments.filter(isComplete).length, total: document.segments.length });
        const pendingAfterPass = document.segments.filter((segment) => !isComplete(segment)).length;
        // Do not keep the UI apparently frozen if a model repeats the same
        // rejected output. Stop promptly and expose the exact residual rows.
        if (pendingAfterPass >= pendingBeforePass) break;
      }

      const completed = document.segments.filter(isComplete).length;
      return { completed: completed - initialDone, remaining: document.segments.length - completed };
    },
    onMutate: () => setTranslateStart(Date.now()),
    onSuccess: ({ completed, remaining }) => {
      if (remaining === 0) {
        toast.success("Documento traducido completamente");
      } else if (completed > 0) {
        setFilter("pendientes");
        toast.warning(`${completed} segmentos completados; quedan ${remaining} para otro intento.`);
      } else {
        setFilter("pendientes");
        toast.error(`${remaining} segmentos requieren revisión. Ya se muestran en el editor para corregirlos sin esperar.`);
      }
    },
    onError: (error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("document translation failed", error);
      toast.error(error instanceof Error ? error.message : "La traducción del documento falló.");
    },
    onSettled: (_data, _error, signal) => {
      if (translationControllerRef.current?.signal === signal) translationControllerRef.current = null;
    },
  });

  const startTranslation = useCallback(() => {
    translationControllerRef.current?.abort();
    autoClinicalReviewRef.current = null;
    setClinicalIssues(undefined);
    const controller = new AbortController();
    translationControllerRef.current = controller;
    translate.mutate(controller.signal);
  }, [translate]);

  const cancelTranslation = useCallback(() => {
    translationControllerRef.current?.abort();
    translationControllerRef.current = null;
    toast.info("Proceso detenido. El avance quedó guardado en el historial.");
  }, []);

  const openIssueSegment = useCallback((id: string) => {
    setFilter("todos");
    setSearch(id);
    globalThis.setTimeout(() => {
      globalThis.document.getElementById(`segment-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, []);

  const acknowledgeIssue = useCallback((issueIndex: number) => {
    setClinicalIssues((previous) => previous?.filter((_issue, index) => index !== issueIndex));
    toast.success("Observación marcada como revisada");
  }, []);

  const download = useMutation({
    mutationFn: async () => {
      if (!document) throw new Error("Sube un documento primero.");
      const incomplete = document.segments.filter((segment) => !segmentIsComplete(segment));
      if (incomplete.length > 0) {
        throw new Error(`Aún hay ${incomplete.length} segmentos sin traducir completamente. Pulsa “Completar pendientes” antes de generar el PDF.`);
      }
      return buildTranslatedDocument(document, translations);
    },
    onSuccess: (result) => {
      saveAs(result.blob, result.fileName);
      setExportWarnings(result.warnings);
      toast.success(`Descargado ${result.fileName}`);
    },
    onError: (error: unknown) => {
      console.error("document export failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo generar el archivo.");
    },
  });

  const downloadWord = useMutation({
    mutationFn: async () => {
      if (!document) throw new Error("Sube un documento primero.");
      const lines: string[] = [];
      let currentPage: number | undefined;
      for (const segment of document.segments) {
        if (segment.page !== undefined && segment.page !== currentPage) {
          if (lines.length > 0) lines.push("");
          lines.push(`${document.kind === "pptx" ? "Diapositiva" : "Página original"} ${segment.page}`);
          currentPage = segment.page;
        }
        lines.push(translations[segment.id] ?? "");
      }
      const baseName = document.fileName.replace(/\.[^.]+$/, "");
      const blob = await textToDocx(lines.join("\n"), {
        title: `${baseName} — traducción`,
        lang: settings.targetLanguage,
      });
      return { blob, fileName: `${baseName}-traducido.docx` };
    },
    onSuccess: ({ blob, fileName }) => {
      saveAs(blob, fileName);
      toast.success(`Word descargado: ${fileName}`);
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "No se pudo generar el Word."),
  });

  const clinicalVerification = useMutation({
    mutationFn: async () => {
      if (!document) throw new Error("Sube un documento primero.");
      const issues: ClinicalVerificationIssue[] = [];
      const pairs = document.segments.filter((segment) => !preservedIds.has(segment.id)).map((segment) => ({
        id: segment.id,
        source: segment.text,
        translation: translations[segment.id] ?? "",
      }));
      for (let start = 0; start < pairs.length; start += 40) {
        const batch = pairs.slice(start, start + 40);
        issues.push(...await verifyClinicalTranslations({
          segments: batch,
          targetLanguage: settings.targetLanguage,
          targetVariant: settings.variants[settings.targetLanguage],
          domain: settings.domain,
        }));
      }
      for (const pair of pairs) {
        if (!preservesDocumentTokens(pair.source, pair.translation) && !issues.some((issue) => issue.id === pair.id)) {
          issues.push({ id: pair.id, severity: "alta", message: "Las cifras o referencias no coinciden exactamente con el original." });
        }
      }
      return issues;
    },
    onSuccess: (issues) => {
      setClinicalIssues(issues);
      const blocking = issues.filter((issue) => issue.severity === "alta").length;
      if (issues.length === 0) toast.success("Verificación clínica terminada sin observaciones");
      else if (blocking > 0) toast.warning(`Verificación terminada: ${blocking} observaciones importantes y ${issues.length - blocking} recomendaciones`);
      else toast.info(`Verificación terminada: ${issues.length} recomendaciones no bloqueantes`);
    },
    onError: (error: unknown) => {
      console.error("automatic clinical review failed", error);
      toast.warning("La revisión clínica automática no estuvo disponible. Puedes repetirla sin perder la traducción.");
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null): void => {
      const file = files?.[0];
      if (!file) return;
      parse.mutate(file);
    },
    [parse],
  );

  const translatedCount = useMemo(
    () => (document ? document.segments.filter((segment) => segmentIsComplete(segment)).length : 0),
    [document, segmentIsComplete],
  );
  const remainingCount = document ? document.segments.length - translatedCount : 0;

  useEffect(() => {
    if (!document || document.segments.length === 0 || remainingCount > 0 || translate.isPending) return;
    if (clinicalIssues !== undefined || clinicalVerification.isPending) return;
    const reviewKey = projectId ?? document.fileName;
    if (autoClinicalReviewRef.current === reviewKey) return;
    autoClinicalReviewRef.current = reviewKey;
    clinicalVerification.mutate();
  }, [clinicalIssues, clinicalVerification, document, projectId, remainingCount, translate.isPending]);

  const verifyDocumentIntegrity = (): ClinicalVerificationIssue[] => {
    if (!document) return [{ id: "documento", severity: "alta", message: "No hay un documento abierto." }];
    const issues: ClinicalVerificationIssue[] = [];
    for (const segment of document.segments) {
      const translation = translations[segment.id] ?? "";
      if (!segmentIsComplete(segment)) {
        issues.push({ id: segment.id, severity: "alta", message: "El segmento no tiene una traducción completa." });
      } else if (!preservesDocumentTokens(segment.text, translation)) {
        issues.push({ id: segment.id, severity: "alta", message: "Las cifras, dosis o referencias no coinciden exactamente con el original." });
      }
    }
    setClinicalIssues(issues);
    if (issues.length === 0) toast.success("Integridad verificada: cifras, dosis y referencias intactas");
    else toast.warning(`Se encontraron ${issues.length} segmentos que necesitan revisión`);
    return issues;
  };

  useEffect(() => {
    if (!requestedProjectId || restoredProjectRef.current === requestedProjectId) return;
    restoredProjectRef.current = requestedProjectId;
    void loadLocalProject(requestedProjectId).then((project) => {
      if (!project) {
        toast.error("Ese proyecto ya no existe en el historial local.");
        return;
      }
      setProjectId(project.id);
      setDocument(project.document);
      autoClinicalReviewRef.current = null;
      setTranslations(project.translations);
      setEdited(project.edited);
      setProgress({
        done: project.document.segments.filter((segment) => project.translations[segment.id]?.trim()).length,
        total: project.document.segments.length,
      });
      const detectedSource = detectLanguageLocally(
        project.document.segments.slice(0, 30).map((segment) => segment.text).join(" "),
      );
      const detectedTarget = detectLanguageLocally(
        project.document.segments.slice(0, 30).map((segment) => project.translations[segment.id] ?? "").join(" "),
      );
      const sourceLanguage = detectedSource ?? project.sourceLanguage;
      const targetLanguage = detectedTarget ?? project.targetLanguage;
      settings.patch({ sourceLanguage, targetLanguage });
      if (sourceLanguage !== project.sourceLanguage || targetLanguage !== project.targetLanguage) {
        void saveLocalProjectLanguages(project.id, sourceLanguage, targetLanguage);
      }
      toast.success(`Proyecto «${project.document.fileName}» recuperado`);
    }).catch((error: unknown) => {
      console.error("project restore failed", error);
      toast.error("No se pudo recuperar el proyecto local.");
    });
  }, [requestedProjectId, settings]);

  useEffect(() => {
    if (!document || projectId) return;
    const id = newProjectId();
    setProjectId(id);
    void createLocalProject({
      id,
      document,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      translations,
      edited,
    }).catch((error: unknown) => console.error("recovered session save failed", error));
  }, [document, edited, projectId, settings.sourceLanguage, settings.targetLanguage, translations]);

  useEffect(() => {
    if (!projectId || !document) return;
    const timeout = window.setTimeout(() => {
      void saveLocalProjectState(projectId, translations, edited).catch((error: unknown) => {
        console.error("project autosave failed", error);
        toast.error("No se pudo guardar el progreso local.");
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [document, edited, projectId, translations]);

  useEffect(() => {
    if (!projectId || !document) return;
    const timeout = window.setTimeout(() => {
      void saveLocalProjectLanguages(projectId, settings.sourceLanguage, settings.targetLanguage)
        .catch((error: unknown) => console.error("project language save failed", error));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [document, projectId, settings.sourceLanguage, settings.targetLanguage]);

  const visibleSegments = useMemo(() => {
    if (!document) return [];
    const needle = search.trim().toLowerCase();
    return document.segments.filter((segment) => {
      if (filter === "pendientes" && segmentIsComplete(segment)) return false;
      if (filter === "editados" && !edited[segment.id]) return false;
      if (needle.length > 0) {
        const haystack = `${segment.id} ${segment.text} ${translations[segment.id] ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [document, edited, filter, search, segmentIsComplete, translations]);

  const nonLatinWarning =
    document?.kind === "pdf" && NON_LATIN_LANGUAGES.includes(settings.targetLanguage)
      ? "El idioma destino usa un alfabeto no latino: para PDF conserva mejor el formato exportando a Word."
      : undefined;

  const meta = document ? KIND_META[document.kind] : undefined;
  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const totalChars = document?.segments.reduce((sum, s) => sum + s.text.length, 0) ?? 0;
  const detectedLanguage = useMemo(
    () => detectLanguageLocally(document?.segments.slice(0, 30).map((segment) => segment.text).join(" ") ?? ""),
    [document],
  );

  return (
    <AppShell
      title="Documentos"
      subtitle="Traduce PDF, Word y PowerPoint sobre el propio documento, edítalos y descárgalos con el formato original."
      actions={
        document ? (
          <div className="flex items-center gap-2">
            {!translate.isPending ? (
              <>
                {translatedCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (!window.confirm("¿Borrar las traducciones de este proyecto y comenzar nuevamente? El PDF original se conservará.")) return;
                      setTranslations({});
                      setEdited({});
                      setProgress({ done: 0, total: document.segments.length });
                      setClinicalIssues(undefined);
                      autoClinicalReviewRef.current = null;
                      toast.success("Traducción reiniciada; el documento original se conservó");
                    }}
                    className="h-9 gap-1.5 px-2.5 text-[12.5px] text-muted-foreground hover:text-primary"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reiniciar traducción
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDocument(undefined);
                    setProjectId(undefined);
                    setTranslations({});
                    setEdited({});
                    setClinicalIssues(undefined);
                    autoClinicalReviewRef.current = null;
                  }}
                  className="h-9 gap-1.5 px-2.5 text-[12.5px] text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Quitar documento
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              onClick={translate.isPending ? cancelTranslation : startTranslation}
              disabled={!translate.isPending && (document.segments.length === 0 || remainingCount === 0)}
              variant={translate.isPending ? "destructive" : "default"}
              className="gap-2 rounded-xl shadow-glow active:scale-[0.97]"
            >
              {translate.isPending ? (
                <><X className="h-4 w-4" /> Cancelar proceso</>
              ) : (
                <><Languages className="h-4 w-4" /> {translatedCount > 0 ? `Completar ${remainingCount} pendientes` : "Traducir documento"}</>
              )}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="mx-auto max-w-[1400px] space-y-5">
        {!document ? (
          <>
            <Panel className="p-4">
              <div className="space-y-4">
                <LanguageBar detectedLanguage={detectedLanguage} />
                <div className="h-px hairline" />
                <RegisterDomainControls />
              </div>
            </Panel>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                handleFiles(event.dataTransfer.files);
              }}
              className={cn(
                "panel grain relative flex w-full flex-col items-center justify-center gap-4 px-6 py-16 transition",
                dragging ? "border-primary/60 bg-primary/5" : "hover:border-primary/40",
              )}
            >
              <div className="relative">
                <div className="absolute inset-0 animate-pulse-soft rounded-2xl bg-primary/20 blur-2xl" />
                <div className="relative rounded-2xl border border-primary/30 bg-primary/10 p-4">
                  <Upload className="h-7 w-7 text-primary" />
                </div>
              </div>
              <div className="text-center">
                <p className="font-serif text-lg">
                  {parse.isPending ? "Analizando el documento…" : "Arrastra tu documento o haz clic"}
                </p>
                <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                  PDF · Word (.docx) · PowerPoint (.pptx) — hasta 25 MB.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {(Object.keys(KIND_META) as DocKind[]).map((kind) => {
                  const item = KIND_META[kind];
                  return (
                    <span
                      key={kind}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-elevated/50 px-2 py-1 text-[11.5px] text-muted-foreground"
                    >
                      <item.icon className="h-3.5 w-3.5 text-primary" /> {item.label}
                    </span>
                  );
                })}
              </div>
              {parse.isPending ? (
                <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
                  <div className="h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-primary to-transparent" />
                </div>
              ) : null}
            </button>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />

            <div className="grid gap-3 md:grid-cols-3">
              {(Object.keys(KIND_META) as DocKind[]).map((kind) => {
                const item = KIND_META[kind];
                return (
                  <div key={kind} className="panel-flat p-4">
                    <p className="flex items-center gap-2 text-[13px] font-semibold">
                      <item.icon className="h-4 w-4 text-primary" /> {item.label}
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.note}</p>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <AnimatePresence mode="wait">
              {translate.isPending ? (
                <motion.div
                  key="progress"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <Panel className="relative overflow-hidden">
                    <TranslationProgress
                      active={translate.isPending}
                      startTime={translateStart}
                      charCount={totalChars}
                      progressPercent={progressPercent}
                      totalUnits={progress.total}
                      doneUnits={progress.done}
                      fileName={document.fileName}
                      onCancel={cancelTranslation}
                    />
                  </Panel>
                </motion.div>
              ) : (
                <motion.div
                  key="editor"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-5"
                >
                  <Panel className="p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      {meta ? (
                        <span className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[12.5px] text-primary">
                          <meta.icon className="h-4 w-4" /> {meta.label}
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium">{document.fileName}</p>
                        <p className="label-xs">
                          {document.segments.length} segmentos ·{" "}
                          {document.kind === "pptx" ? `${document.pageCount} diapositivas` : `${document.pageCount} págs.`} ·{" "}
                          {translatedCount} traducidos
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      <LanguageBar detectedLanguage={detectedLanguage} />
                      <RegisterDomainControls />
                    </div>

                    {progress.total > 0 && !translate.isPending ? (
                      <div className="mt-4">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="label-xs">
                            Progreso · {progress.done}/{progress.total} segmentos
                          </span>
                          <span className="label-xs">{languageLabel(settings.targetLanguage)}</span>
                        </div>
                        <Progress
                          value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
                          className="h-1.5 bg-secondary"
                        />
                      </div>
                    ) : null}

                    {[...document.warnings, ...(nonLatinWarning ? [nonLatinWarning] : []), ...exportWarnings].map(
                      (warning) => (
                        <p key={warning} className="mt-3 flex gap-2 text-[12px] leading-relaxed text-warn">
                          <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0" /> {warning}
                        </p>
                      ),
                    )}
                  </Panel>

                  <Panel
                    title={remainingCount === 0 ? "Traducción completa" : "Finalización del documento"}
                    meta={remainingCount === 0
                      ? clinicalVerification.isPending
                        ? "La revisión clínica automática está comprobando la traducción."
                        : "La revisión clínica se ejecuta automáticamente; también puedes repetirla cuando quieras."
                      : `Faltan ${remainingCount} segmentos. Completa la traducción para habilitar las descargas y la revisión clínica.`}
                  >
                      <div className="grid gap-3 p-4 md:grid-cols-3">
                        <Button type="button" onClick={() => downloadWord.mutate()} disabled={downloadWord.isPending || remainingCount > 0} className="h-auto justify-start gap-3 rounded-xl px-4 py-3">
                          {downloadWord.isPending ? <Spinner label="Creando Word…" /> : <><FileType2 className="h-5 w-5" /><span className="text-left"><strong className="block">Descargar Word</strong><small className="font-normal opacity-80">{remainingCount > 0 ? `Completa ${remainingCount} pendientes` : "Texto completo y editable"}</small></span></>}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => clinicalVerification.mutate()} disabled={clinicalVerification.isPending || remainingCount > 0} className="h-auto justify-start gap-3 rounded-xl px-4 py-3">
                          {clinicalVerification.isPending ? <Spinner label="Revisando automáticamente…" /> : <><ShieldCheck className="h-5 w-5" /><span className="text-left"><strong className="block">Revisión clínica automática</strong><small className="font-normal text-muted-foreground">{remainingCount > 0 ? `Completa ${remainingCount} pendientes` : clinicalVerification.isError ? "No disponible · pulsa para reintentar" : clinicalIssues === undefined ? "Se iniciará al completar" : "Terminada · pulsa para repetir"}</small></span></>}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={async () => {
                            if (document.kind !== "pdf" || pdfClinicallyApproved) {
                              download.mutate();
                              return;
                            }
                            if (clinicalIssues === undefined) {
                              const issues = verifyDocumentIntegrity();
                              if (issues.length === 0) download.mutate();
                            }
                          }}
                          disabled={download.isPending || remainingCount > 0 || (document.kind === "pdf" && (clinicalVerification.isPending || blockingClinicalIssues.length > 0))}
                          className="h-auto justify-start gap-3 rounded-xl px-4 py-3"
                        >
                          {download.isPending ? <Spinner label="Reconstruyendo…" /> : <><Download className="h-5 w-5" /><span className="text-left"><strong className="block">{document.kind === "pdf" ? (clinicalIssues === undefined ? "Verificar integridad y crear PDF" : "Crear PDF traducido") : `Descargar ${meta?.label}`}</strong><small className="font-normal text-muted-foreground">{remainingCount > 0 ? `Completa ${remainingCount} pendientes` : document.kind === "pdf" ? clinicalVerification.isPending ? "Esperando la revisión clínica automática" : clinicalIssues === undefined ? "Comprobación local y reconstrucción" : blockingClinicalIssues.length > 0 ? `Resuelve ${blockingClinicalIssues.length} observaciones importantes` : "Listo · recomendaciones no bloqueantes" : "Conservar estructura original"}</small></span></>}
                        </Button>
                      </div>
                      {clinicalIssues ? (
                        <div className="border-t border-border/50 p-4 text-[12.5px]">
                          {clinicalIssues.length === 0 ? (
                            <p className="flex items-center gap-2 text-primary"><Check className="h-4 w-4" /> Sin observaciones clínicas detectadas.</p>
                          ) : (
                            <div className="space-y-2">
                              <p className="font-medium">{blockingClinicalIssues.length > 0 ? `${blockingClinicalIssues.length} observaciones importantes y ${clinicalIssues.length - blockingClinicalIssues.length} recomendaciones:` : `${clinicalIssues.length} recomendaciones no bloqueantes:`}</p>
                              {clinicalIssues.map((issue, index) => (
                                <div key={`${issue.id}-${index}`} className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                                  <p className={issue.severity === "alta" ? "text-warn" : "text-muted-foreground"}>
                                    {issue.id} · {issue.severity}: {issue.message}
                                  </p>
                                  <div className="flex shrink-0 gap-2">
                                    <Button type="button" size="sm" variant="outline" onClick={() => openIssueSegment(issue.id)}>
                                      Editar segmento
                                    </Button>
                                    <Button type="button" size="sm" variant="ghost" onClick={() => acknowledgeIssue(index)}>
                                      Marcar revisada
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </Panel>

                  <Panel
                    title="Editor bilingüe"
                    meta="Corrige cualquier segmento: los cambios se aplican al archivo descargado"
                    actions={
                      <div className="flex items-center gap-2">
                        <Input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Buscar…"
                          className="h-8 w-32 rounded-lg border-border/70 bg-elevated/60 text-[12px] sm:w-44"
                        />
                        <Segmented<Filter>
                          value={filter}
                          onChange={setFilter}
                          options={[
                          { id: "todos", label: "Todos" },
                          { id: "pendientes", label: "Pendientes" },
                          { id: "editados", label: "Editados" },
                        ]}
                          className="hidden sm:flex"
                        />
                      </div>
                    }
                  >
                    <div className="max-h-[62vh] divide-y divide-border/40 overflow-y-auto">
                      {visibleSegments.length === 0 ? (
                        <p className="p-6 text-center text-[13px] text-muted-foreground">
                          No hay segmentos que coincidan con el filtro.
                        </p>
                      ) : (
                        visibleSegments.map((segment) => {
                          const value = translations[segment.id] ?? "";
                          return (
                            <div id={`segment-${segment.id}`} key={segment.id} className="grid gap-3 p-4 lg:grid-cols-2">
                              <div>
                                <p className="mb-1.5 flex items-center gap-2 label-xs">
                                  {segment.container} · {segment.id}
                                  {edited[segment.id] ? (
                                    <span className="inline-flex items-center gap-1 text-primary">
                                      <Check className="h-3 w-3" /> editado
                                    </span>
                                  ) : null}
                                </p>
                                <p className="whitespace-pre-wrap rounded-lg bg-background/40 p-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                                  {segment.text}
                                </p>
                              </div>
                              <div>
                                <p className="mb-1.5 flex items-center justify-between label-xs">
                                  <span>{languageLabel(settings.targetLanguage)}</span>
                                  {value && edited[segment.id] ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEdited((previous) => {
                                          const next = { ...previous };
                                          delete next[segment.id];
                                          return next;
                                        })
                                      }
                                      className="inline-flex items-center gap-1 text-muted-foreground transition hover:text-primary"
                                    >
                                      <RotateCcw className="h-3 w-3" /> marcar sin editar
                                    </button>
                                  ) : null}
                                </p>
                                <Textarea
                                  value={value}
                                  onChange={(event) => {
                                    setTranslations((previous) => ({ ...previous, [segment.id]: event.target.value }));
                                    setEdited((previous) => ({ ...previous, [segment.id]: true }));
                                    setClinicalIssues((previous) => previous?.filter((issue) => issue.id !== segment.id));
                                  }}
                                  placeholder="Sin traducir"
                                  className={cn(
                                    "min-h-[76px] resize-y rounded-lg border-border/70 bg-elevated/50 text-[12.5px] leading-relaxed",
                                    value ? "" : "border-dashed",
                                  )}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </Panel>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </AppShell>
  );
}
