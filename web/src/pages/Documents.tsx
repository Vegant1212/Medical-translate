import { useMutation } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  FolderOpen,
  History,
  Languages,
  Layers,
  Presentation,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  batchSegments,
  buildTranslatedDocument,
  parseDocument,
  type DocKind,
  type ParsedDocument,
} from "@/lib/documents";
import { NON_LATIN_LANGUAGES, languageLabel } from "@/lib/languages";
import { reviewTranslatedSegments, translateSegments } from "@/lib/medical";
import { cn } from "@/lib/utils";
import {
  deleteDocumentProject,
  listDocumentProjects,
  loadDocumentProject,
  saveDocumentProject,
  type SavedDocumentProject,
} from "@/lib/project-history";

const KIND_META: Record<DocKind, { label: string; icon: typeof FileText; note: string }> = {
  pdf: {
    label: "PDF",
    icon: FileText,
    note: "La traducción se escribe encima del original: se conservan imágenes, tablas, sellos y maquetación.",
  },
  docx: {
    label: "Word",
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

export default function DocumentsPage() {
  const settings = useSettings();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [document, setDocument] = useState<ParsedDocument | undefined>(undefined);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [filter, setFilter] = useState<Filter>("todos");
  const [search, setSearch] = useState<string>("");
  const [dragging, setDragging] = useState<boolean>(false);
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const [translateStart, setTranslateStart] = useState<number>(0);
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<SavedDocumentProject[]>([]);

  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      setProjects(await listDocumentProjects());
    } catch (error) {
      console.error("project history load failed", error);
      toast.error("No se pudo cargar el historial de proyectos.");
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const persistProject = useCallback(
    async (
      parsed: ParsedDocument,
      nextTranslations: Record<string, string>,
      nextEdited: Record<string, boolean>,
      id = currentProjectId ?? crypto.randomUUID(),
    ): Promise<string> => {
      const previous = projects.find((project) => project.id === id);
      const now = Date.now();
      await saveDocumentProject({
        id,
        name: parsed.fileName.replace(/\.(pdf|docx|pptx)$/i, ""),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        document: parsed,
        translations: nextTranslations,
        edited: nextEdited,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
      });
      setCurrentProjectId(id);
      await refreshProjects();
      return id;
    },
    [currentProjectId, projects, refreshProjects, settings.sourceLanguage, settings.targetLanguage],
  );

  const parse = useMutation({
    mutationFn: (file: File) => parseDocument(file),
    onSuccess: (parsed) => {
      setDocument(parsed);
      setTranslations({});
      setEdited({});
      setProgress({ done: 0, total: 0 });
      setExportWarnings([]);
      const id = crypto.randomUUID();
      setCurrentProjectId(id);
      void persistProject(parsed, {}, {}, id).catch((error) => {
        console.error("initial project save failed", error);
        toast.error("El documento abrió, pero no pudo guardarse en el historial.");
      });
      toast.success(`${parsed.segments.length} segmentos listos para traducir`);
    },
    onError: (error: unknown) => {
      console.error("document parse failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo leer el documento.");
    },
  });

  const translate = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!document) throw new Error("Sube un documento primero.");
      const protectedSegments = document.segments.filter((segment) => segment.protectedReason === "bibliography");
      const translatableSegments = document.segments.filter((segment) => !segment.protectedReason);
      const batches = batchSegments(translatableSegments);
      const protectedMap = Object.fromEntries(protectedSegments.map((segment) => [segment.id, segment.text]));
      const translatedMap: Record<string, string> = {};
      setTranslations((previous) => ({ ...previous, ...protectedMap }));
      setProgress({ done: protectedSegments.length, total: document.segments.length });
      let done = protectedSegments.length;
      for (const batch of batches) {
        const map = await translateSegments({
          segments: batch.map((segment) => ({ id: segment.id, text: segment.text })),
          targetLanguage: settings.targetLanguage,
          targetVariant: settings.variants[settings.targetLanguage],
          sourceLanguage: settings.sourceLanguage,
          register: settings.register,
          domain: settings.domain,
          glossary: settings.glossaryPairs,
        });
        Object.assign(translatedMap, map);
        setTranslations((previous) => ({ ...previous, ...map }));
        done += batch.length;
        setProgress({ done, total: document.segments.length });
      }

      // A final model pass fixes spelling, punctuation and PDF-extraction artifacts
      // such as words incorrectly joined together, without touching bibliography.
      const reviewBatches = batchSegments(
        translatableSegments.map((segment) => ({
          id: segment.id,
          text: translatedMap[segment.id] ?? segment.text,
          source: segment.text,
          translation: translatedMap[segment.id] ?? segment.text,
        })),
      );
      for (const batch of reviewBatches) {
        const reviewed = await reviewTranslatedSegments({
          segments: batch.map(({ id, source, translation }) => ({ id, source, translation })),
          targetLanguage: settings.targetLanguage,
          targetVariant: settings.variants[settings.targetLanguage],
          register: settings.register,
          domain: settings.domain,
        });
        Object.assign(translatedMap, reviewed);
        setTranslations((previous) => ({ ...previous, ...reviewed }));
      }
      await persistProject(document, { ...protectedMap, ...translatedMap }, edited);
      return translatableSegments.length;
    },
    onMutate: () => setTranslateStart(Date.now()),
    onSuccess: (count) =>
      toast.success(`${count} segmentos traducidos y revisados; bibliografía conservada sin cambios`),
    onError: (error: unknown) => {
      console.error("document translation failed", error);
      toast.error(error instanceof Error ? error.message : "La traducción del documento falló.");
    },
  });

  const download = useMutation({
    mutationFn: async () => {
      if (!document) throw new Error("Sube un documento primero.");
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

  const handleFiles = useCallback(
    (files: FileList | null): void => {
      const file = files?.[0];
      if (!file) return;
      parse.mutate(file);
    },
    [parse],
  );

  const translatedCount = useMemo(
    () => (document ? document.segments.filter((segment) => Boolean(translations[segment.id])).length : 0),
    [document, translations],
  );

  const visibleSegments = useMemo(() => {
    if (!document) return [];
    const needle = search.trim().toLowerCase();
    return document.segments.filter((segment) => {
      if (filter === "pendientes" && translations[segment.id]) return false;
      if (filter === "editados" && !edited[segment.id]) return false;
      if (needle.length > 0) {
        const haystack = `${segment.text} ${translations[segment.id] ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [document, edited, filter, search, translations]);

  const nonLatinWarning =
    document?.kind === "pdf" && NON_LATIN_LANGUAGES.includes(settings.targetLanguage)
      ? "El idioma destino usa un alfabeto no latino: para PDF conserva mejor el formato exportando a Word."
      : undefined;

  const meta = document ? KIND_META[document.kind] : undefined;
  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const totalChars = document?.segments.reduce((sum, s) => sum + s.text.length, 0) ?? 0;

  return (
    <AppShell
      title="Documentos"
      subtitle="Traduce PDF, Word y PowerPoint sobre el propio documento, edítalos y descárgalos con el formato original."
      actions={
        document ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDocument(undefined);
                setTranslations({});
                setEdited({});
                setCurrentProjectId(undefined);
              }}
              className="h-9 gap-1.5 px-2.5 text-[12.5px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Quitar
            </Button>
            <Button
              type="button"
              onClick={() => translate.mutate()}
              disabled={translate.isPending || document.segments.length === 0}
              className="gap-2 rounded-xl bg-primary text-primary-foreground shadow-glow active:scale-[0.97]"
            >
              {translate.isPending ? <Spinner label="Traduciendo…" /> : <><Languages className="h-4 w-4" /> Traducir documento</>}
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
                <LanguageBar />
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
                  PDF · DOCX · PPTX — hasta 25 MB. El diseño original se conserva.
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
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => download.mutate()}
                        disabled={download.isPending || translatedCount === 0}
                        className="h-9 gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 text-[12.5px] text-primary hover:bg-primary/20"
                      >
                        {download.isPending ? <Spinner label="Generando…" /> : <><Download className="h-3.5 w-3.5" /> Descargar {meta?.label}</>}
                      </Button>
                    </div>

                    <div className="mt-4 space-y-3">
                      <LanguageBar />
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
                            <div key={segment.id} className="grid gap-3 p-4 lg:grid-cols-2">
                              <div>
                                <p className="mb-1.5 flex items-center gap-2 label-xs">
                                  {segment.container}
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
                                  }}
                                  onBlur={() => {
                                    if (document && currentProjectId) {
                                      void persistProject(document, translations, edited).catch(() =>
                                        toast.error("No se pudo guardar el último cambio en el historial."),
                                      );
                                    }
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

      <Panel
        title="Historial de proyectos"
        meta={`${projects.length} guardado${projects.length === 1 ? "" : "s"} en este navegador`}
        className="mx-auto mt-5 max-w-[1400px]"
      >
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center text-muted-foreground">
            <History className="mb-3 h-8 w-8 opacity-50" />
            <p className="text-sm">Los documentos que abras aparecerán aquí automáticamente.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {projects.map((project) => {
              const completed = project.document.segments.filter((segment) => project.translations[segment.id]).length;
              return (
                <li key={project.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{project.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {project.document.kind.toUpperCase()} · {completed}/{project.document.segments.length} segmentos · Actualizado {new Date(project.updatedAt).toLocaleString("es-MX")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        void loadDocumentProject(project)
                          .then((loaded) => {
                            setDocument(loaded.document);
                            setTranslations(loaded.translations);
                            setEdited(loaded.edited);
                            setCurrentProjectId(loaded.id);
                            setProgress({ done: 0, total: 0 });
                            setExportWarnings([]);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                            toast.success(`Proyecto «${loaded.name}» recuperado`);
                          })
                          .catch(() => toast.error("No se pudo descargar el proyecto."));
                      }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Retomar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        void deleteDocumentProject(project.id)
                          .then(async () => {
                            if (currentProjectId === project.id) setCurrentProjectId(undefined);
                            await refreshProjects();
                            toast.success("Proyecto borrado del historial");
                          })
                          .catch(() => toast.error("No se pudo borrar el proyecto."));
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Borrar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </AppShell>
  );
}
