import { useMutation } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  BookmarkPlus,
  Download,
  ExternalLink,
  FileUp,
  Library,
  Loader2,
  Quote,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CopyButton, Panel, Segmented, Spinner, StatusPill } from "@/components/controls";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/context/settings";
import {
  CITATION_STYLES,
  formatCitation,
  formatInText,
  resolveAndVerify,
  resolveAndVerifyFromFile,
  type CitationStyle,
  type VerifiedWork,
} from "@/lib/citations";
import type { WebSource } from "@/lib/toolkit";

const PLACEHOLDER = `Pega aquí cualquiera de estas opciones:

· Un DOI:  10.1056/NEJMoa2034577
· Un PMID:  PMID: 33301246
· Una referencia en cualquier estilo o idioma:
  Polack FP, Thomas SJ, Kitchin N, et al. Safety and efficacy of the BNT162b2 mRNA Covid-19 vaccine. N Engl J Med. 2020;383(27):2603-2615.
· O los datos del estudio en texto libre.`;

const VERIFICATION_LABEL: Record<string, string> = {
  verificada: "Verificada",
  parcial: "Coincidencia parcial",
  no_encontrada: "No localizada",
};

export default function CitationsPage() {
  const settings = useSettings();
  const [raw, setRaw] = useState<string>("");
  const [result, setResult] = useState<(VerifiedWork & { webSources?: WebSource[] }) | undefined>(undefined);
  const [dragging, setDragging] = useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resolveFromFile = useMutation({
    mutationFn: (file: File) => resolveAndVerifyFromFile({ file }),
    onSuccess: (data) => {
      setRaw(data.extractedText);
      setResult(data);
      if (data.verification.retracted) {
        toast.error("⚠️ El artículo aparece como RETRACTADO en Crossref.");
      } else {
        toast.success(`Cita generada desde «${uploadedFileName ?? "el archivo"}»`);
      }
    },
    onError: (error: unknown) => {
      console.error("file citation failed", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo extraer la cita del archivo.",
      );
    },
  });

  const handleUploadedFile = useCallback(
    async (file: File): Promise<void> => {
      const name = file.name.toLowerCase();
      const isSupported =
        name.endsWith(".pdf") || name.endsWith(".docx") || name.endsWith(".pptx");
      if (!isSupported) {
        toast.error("Sube un archivo .pdf, .docx o .pptx.");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error("El archivo supera los 25 MB.");
        return;
      }
      setUploadedFileName(file.name);
      setResult(undefined);
      setRaw("");
      resolveFromFile.mutate(file);
    },
    [resolveFromFile],
  );

  const resolve = useMutation({
    mutationFn: () => resolveAndVerify({ raw: raw.trim() }),
    onSuccess: (data) => {
      setResult(data);
      setUploadedFileName(null);
      if (data.verification.retracted) {
        toast.error("⚠️ El artículo aparece como RETRACTADO en Crossref.");
      }
    },
    onError: (error: unknown) => {
      console.error("citation resolution failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo procesar la referencia.");
    },
  });

  const handleResolve = useCallback((): void => {
    if (raw.trim().length < 6) {
      toast.error("Pega un DOI, un PMID o una referencia completa.");
      return;
    }
    resolve.mutate();
  }, [raw, resolve]);

  const isBusy = resolve.isPending || resolveFromFile.isPending;

  const locale = settings.targetLanguage === "auto" ? "es" : settings.targetLanguage;

  const formatted = useMemo(() => {
    if (!result) return undefined;
    const index = settings.references.length + 1;
    return {
      apa: formatCitation(result.metadata, "apa", { locale, index }),
      ama: formatCitation(result.metadata, "ama", { locale, index }),
      vancouver: formatCitation(result.metadata, "vancouver", { locale, index }),
    };
  }, [locale, result, settings.references.length]);

  const libraryText = useMemo(
    () =>
      settings.references
        .slice()
        .reverse()
        .map((reference, index) =>
          reference.style === "apa" ? reference.text : reference.text.replace(/^\d+\.\s*/, `${index + 1}. `),
        )
        .join("\n\n"),
    [settings.references],
  );

  return (
    <AppShell
      title="Citas bibliográficas"
subtitle="Sube el artículo en PDF, Word o PowerPoint — o pega un DOI/PMID — y genera la cita en APA, AMA o Vancouver con validación en Crossref y PubMed."
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="gap-2 rounded-xl border border-border/70 text-[13px] text-muted-foreground hover:border-primary/40 hover:text-primary"
          >
            <FileUp className="h-4 w-4" /> Subir artículo
          </Button>
          <Button
            type="button"
            onClick={handleResolve}
            disabled={isBusy}
            className="gap-2 rounded-xl bg-primary text-primary-foreground shadow-glow active:scale-[0.97]"
          >
            {resolve.isPending ? <Spinner label="Cotejando…" /> : <><Search className="h-4 w-4" /> Generar y validar</>}
          </Button>
        </div>
      }
    >
      <div className="mx-auto grid max-w-[1400px] gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <Panel
            title="Estudio o referencia"
            meta={uploadedFileName ? `Archivo: ${uploadedFileName}` : "DOI, PMID, referencia en cualquier estilo o sube el artículo completo"}
            actions={
              <div className="flex items-center gap-2">
                {uploadedFileName ? (
                  <span className="flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    <FileUp className="h-3 w-3" /> {uploadedFileName.length > 24 ? uploadedFileName.slice(0, 22) + "…" : uploadedFileName}
                  </span>
                ) : null}
                <Segmented<CitationStyle>
                value={settings.citationStyle}
                onChange={(value) => settings.patch({ citationStyle: value })}
                options={CITATION_STYLES.map((style) => ({ id: style.id, label: style.label, hint: style.hint }))}
                />
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
                if (file) void handleUploadedFile(file);
              }}
              className={cn("relative", dragging && "ring-2 ring-primary/50 ring-inset")}
            >
              {dragging ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 backdrop-blur-sm">
                  <div className="text-center">
                    <FileUp className="mx-auto h-8 w-8 text-primary" strokeWidth={1.6} />
                    <p className="mt-2 font-serif text-[15px] text-primary">Suelta el artículo aquí</p>
                    <p className="mt-0.5 label-xs">PDF · Word · PowerPoint</p>
                  </div>
                </div>
              ) : null}
              {resolveFromFile.isPending ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center p-6 text-center">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  <p className="mt-3 text-[13px] font-medium">Extrayendo metadatos del artículo…</p>
                  <p className="mt-1 label-xs">Leyendo el documento · identificando título, autores, DOI · validando en Crossref</p>
                </div>
              ) : (
                <Textarea
                  value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                  onDrop={(event) => {
                    event.stopPropagation();
                    const file = event.dataTransfer.files[0];
                    if (file) void handleUploadedFile(file);
                  }}
                  placeholder={PLACEHOLDER}
                  spellCheck={false}
                  className="min-h-[220px] resize-y rounded-none border-0 bg-transparent px-4 py-3.5 font-mono text-[12.5px] leading-relaxed focus-visible:ring-0"
                />
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.pptx"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUploadedFile(file);
              }}
            />
            <footer className="flex items-center justify-between border-t border-border/60 px-4 py-2">
              <span className="label-xs">
                {uploadedFileName
                  ? `Texto extraído de ${uploadedFileName}`
                  : `${raw.length.toLocaleString()} caracteres`}
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition hover:text-primary"
              >
                <FileUp className="h-3.5 w-3.5" /> Subir PDF / Word / PPT
              </button>
            </footer>
          </Panel>

          {isBusy && !result ? (
            <Panel className="relative overflow-hidden p-6">
              <div className="absolute inset-x-0 top-0 h-[2px] animate-shimmer bg-gradient-to-r from-transparent via-primary to-transparent" />
              <div className="space-y-2.5">
                {[88, 62, 94, 45].map((width, index) => (
                  <div
                    key={index}
                    className="h-3.5 animate-pulse-soft rounded bg-secondary/70"
                    style={{ width: `${width}%`, animationDelay: `${index * 0.12}s` }}
                  />
                ))}
              </div>
              <p className="mt-4 label-xs">
                {resolveFromFile.isPending
                  ? "Leyendo documento · extrayendo metadatos · validando en Crossref"
                  : "Resolviendo DOI · consultando Crossref · comprobando PubMed"}
              </p>
            </Panel>
          ) : null}

          {result && formatted ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <Panel
                title={result.metadata.title || "Sin título"}
                meta={[
                  result.metadata.containerTitle,
                  result.metadata.year,
                  result.metadata.volume ? `vol. ${result.metadata.volume}` : undefined,
                  result.metadata.pages,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                actions={<StatusPill status={result.verification.status}>{VERIFICATION_LABEL[result.verification.status]}</StatusPill>}
              >
                <div className="space-y-3 p-4">
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    {result.metadata.authors.length > 0
                      ? result.metadata.authors
                          .map((author) => `${author.family}${author.given ? `, ${author.given}` : ""}`)
                          .join(" · ")
                      : (result.metadata.groupAuthor ?? "Autoría no identificada")}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    {result.metadata.doi ? (
                      <a
                        href={`https://doi.org/${result.metadata.doi}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary transition hover:bg-primary/20"
                      >
                        <ExternalLink className="h-3 w-3" /> {result.metadata.doi}
                      </a>
                    ) : null}
                    {result.metadata.pmid ? (
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${result.metadata.pmid}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-info/25 bg-info/10 px-2 py-0.5 font-mono text-[11px] text-info transition hover:bg-info/20"
                      >
                        <ExternalLink className="h-3 w-3" /> PMID {result.metadata.pmid}
                      </a>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-elevated/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <BadgeCheck className="h-3 w-3 text-primary" /> Fuente: {result.verification.source}
                      {result.verification.titleSimilarity !== undefined
                        ? ` · ${Math.round(result.verification.titleSimilarity * 100)}% título`
                        : ""}
                    </span>
                  </div>

                  {result.verification.retracted ? (
                    <p className="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 p-2.5 text-[12.5px] leading-relaxed text-bad">
                      <AlertTriangle className="mt-[2px] h-4 w-4 shrink-0" />
                      Crossref indica una <strong>retractación</strong> asociada a este DOI. No lo cites como evidencia
                      válida.
                    </p>
                  ) : null}

                  {result.verification.notes.map((note) => (
                    <p key={note} className="flex gap-2 text-[12.5px] leading-relaxed text-warn">
                      <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0" /> {note}
                    </p>
                  ))}

                  {result.webSources && result.webSources.length > 0 ? (
                    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                      <p className="label-xs">Coincidencias en portales científicos</p>
                      <ul className="mt-1.5 space-y-1">
                        {result.webSources.slice(0, 4).map((source) => (
                          <li key={source.url}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground transition hover:text-primary"
                            >
                              <ExternalLink className="mt-[2px] h-3 w-3 shrink-0" />
                              <span className="line-clamp-1">{source.title}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </Panel>

              {(["apa", "ama", "vancouver"] as CitationStyle[]).map((style) => {
                const label = CITATION_STYLES.find((item) => item.id === style)?.label ?? style;
                const text = formatted[style];
                const isActive = style === settings.citationStyle;
                return (
                  <Panel
                    key={style}
                    title={
                      <span className="flex items-center gap-2">
                        <Quote className="h-3.5 w-3.5 text-primary" /> {label}
                        {isActive ? <StatusPill status="ok">estilo activo</StatusPill> : null}
                      </span>
                    }
                    meta={`En texto: ${formatInText(result.metadata, style, settings.references.length + 1)}`}
                    actions={
                      <div className="flex items-center gap-1">
                        <CopyButton value={text} />
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            settings.addReference({
                              style,
                              text,
                              doi: result.metadata.doi,
                              status: result.verification.status,
                            });
                            toast.success("Guardada en tu bibliografía");
                          }}
                          className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-primary"
                        >
                          <BookmarkPlus className="h-3.5 w-3.5" /> Guardar
                        </Button>
                      </div>
                    }
                  >
                    <p className="px-4 py-3.5 font-mono text-[12.5px] leading-relaxed">{text}</p>
                  </Panel>
                );
              })}
            </motion.div>
          ) : null}
        </div>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Library className="h-3.5 w-3.5 text-primary" /> Mi bibliografía · {settings.references.length}
            </span>
          }
          meta="Se guarda en este navegador"
          actions={
            settings.references.length > 0 ? (
              <div className="flex items-center gap-1">
                <CopyButton value={libraryText} label="Copiar todo" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    saveAs(
                      new Blob([libraryText], { type: "text/plain;charset=utf-8" }),
                      `bibliografia-${new Date().toISOString().slice(0, 10)}.txt`,
                    )
                  }
                  className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-primary"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => settings.clearReferences()}
                  className="h-8 px-2 text-[12px] text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null
          }
          className="h-fit xl:sticky xl:top-24"
        >
          {settings.references.length === 0 ? (
            <p className="p-6 text-center text-[12.5px] leading-relaxed text-muted-foreground">
              Guarda aquí las citas validadas para exportar la lista completa en el estilo que necesites.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-border/40 overflow-y-auto">
              {settings.references.map((reference) => (
                <li key={reference.id} className="group p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <StatusPill status={reference.status}>{reference.style.toUpperCase()}</StatusPill>
                    <button
                      type="button"
                      onClick={() => settings.removeReference(reference.id)}
                      className="ml-auto text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                      aria-label="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="font-mono text-[11.5px] leading-relaxed text-muted-foreground">{reference.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
