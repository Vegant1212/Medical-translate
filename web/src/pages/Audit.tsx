import { useMutation } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSearch,
  Link2Off,
  ScanSearch,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CopyButton, Panel, Segmented, Spinner, StatusPill } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSettings } from "@/context/settings";
import {
  buildReportMarkdown,
  checkClaimSupport,
  checkReference,
  crossMatch,
  extractBibliography,
  scoreAudit,
  type AuditIssue,
  type AuditReport,
  type ReferenceCheck,
} from "@/lib/audit";
import { CITATION_STYLES, formatCitation, type CitationStyle } from "@/lib/citations";
import { extractPdfText } from "@/lib/documents";

const STAGES = [
  "Extrayendo el texto del PDF",
  "Localizando citas y bibliografía",
  "Cotejando cada referencia en Crossref y PubMed",
  "Comprobando que las fuentes sustentan lo citado",
  "Generando el informe",
] as const;

const SEVERITY_ORDER: Record<AuditIssue["severity"], number> = {
  critico: 0,
  alto: 1,
  medio: 2,
  bajo: 3,
  ok: 4,
};

const CATEGORY_ICON: Record<AuditIssue["category"], typeof AlertTriangle> = {
  cita_sin_referencia: Link2Off,
  referencia_sin_cita: Link2Off,
  metadato_incorrecto: AlertTriangle,
  no_localizada: ScanSearch,
  retractada: ShieldAlert,
  formato: AlertTriangle,
  numeracion: AlertTriangle,
  contenido_no_sustentado: ShieldAlert,
};

/** Runs promises with a small concurrency limit to be gentle with public APIs. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 34;
  const offset = circumference * (1 - score / 100);
  const tone = score >= 85 ? "hsl(var(--ok))" : score >= 60 ? "hsl(var(--warn))" : "hsl(var(--bad))";
  return (
    <div className="relative h-[92px] w-[92px] shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r="34" fill="none" stroke="hsl(var(--secondary))" strokeWidth="7" />
        <motion.circle
          cx="40"
          cy="40"
          r="34"
          fill="none"
          stroke={tone}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-[22px] font-semibold leading-none">{score}</span>
        <span className="label-xs mt-0.5">/100</span>
      </div>
    </div>
  );
}

export default function AuditPage() {
  const settings = useSettings();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [stage, setStage] = useState<number>(-1);
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [report, setReport] = useState<AuditReport | undefined>(undefined);
  const [dragging, setDragging] = useState<boolean>(false);

  const locale = settings.targetLanguage === "auto" ? "es" : settings.targetLanguage;

  const audit = useMutation({
    mutationFn: async (file: File): Promise<AuditReport> => {
      setFileName(file.name);
      setReport(undefined);
      setStage(0);
      const { text } = await extractPdfText(file);
      if (text.trim().length < 200) {
        throw new Error("El PDF no contiene texto seleccionable (parece escaneado). Necesita OCR previo.");
      }

      setStage(1);
      const extraction = await extractBibliography({ text });
      const issues: AuditIssue[] = crossMatch(extraction);

      setStage(2);
      setCheckProgress({ done: 0, total: extraction.references.length });
      let done = 0;
      const checks: ReferenceCheck[] = await mapLimit(extraction.references, 4, async (reference) => {
        const result = await checkReference(reference, { style: settings.citationStyle, locale }).catch(
          (error: unknown): ReferenceCheck => {
            console.error("reference check failed", error);
            return {
              reference,
              status: "no_encontrada",
              retracted: false,
              problems: ["No se pudo consultar la fuente (error de red)."],
            };
          },
        );
        done += 1;
        setCheckProgress({ done, total: extraction.references.length });
        return result;
      });

      checks.forEach((check, index) => {
        const number = check.reference.number ?? index + 1;
        if (check.retracted) {
          issues.push({
            id: `retracted-${index}`,
            severity: "critico",
            category: "retractada",
            title: `Referencia ${number}: artículo RETRACTADO`,
            detail: `Crossref registra una retractación para ${check.reference.doi ?? check.metadata?.doi ?? "este DOI"}.`,
            reference: check.reference.raw,
            suggestion: "Elimina la cita o sustitúyela por evidencia vigente.",
            evidenceUrl: check.url,
          });
        }
        if (check.status === "no_encontrada") {
          issues.push({
            id: `missing-${index}`,
            severity: "alto",
            category: "no_localizada",
            title: `Referencia ${number} no localizada`,
            detail: check.problems.join(" ") || "Sin coincidencias en Crossref ni PubMed.",
            reference: check.reference.raw,
            suggestion: "Comprueba título, autores, revista y año; puede tratarse de una referencia inexistente.",
          });
        }
        for (const problem of check.problems) {
          if (check.status === "no_encontrada") break;
          issues.push({
            id: `meta-${index}-${problem.slice(0, 10)}`,
            severity: problem.toLowerCase().includes("doi") ? "alto" : "medio",
            category: "metadato_incorrecto",
            title: `Referencia ${number}: metadato discrepante`,
            detail: problem,
            reference: check.reference.raw,
            suggestion: check.formatted ? `Versión corregida: ${check.formatted}` : undefined,
            evidenceUrl: check.url,
          });
        }
      });

      setStage(3);
      const numeric = extraction.detectedStyle !== "autor-fecha";
      const pairs = extraction.citations
        .map((citation) => {
          const target = citation.targets[0];
          if (!target) return undefined;
          const match = numeric
            ? checks.find((check, index) => String(check.reference.number ?? index + 1) === target.trim())
            : checks.find((check) =>
                `${check.reference.firstAuthor ?? ""} ${check.reference.year ?? ""}`
                  .toLowerCase()
                  .includes(target.trim().toLowerCase().split(" ")[0] ?? ""),
              );
          const title = match?.metadata?.title ?? match?.reference.title;
          if (!match || !title || !citation.sentence) return undefined;
          return {
            marker: citation.marker,
            sentence: citation.sentence,
            referenceTitle: title,
            abstract: match.metadata?.abstract,
          };
        })
        .filter((pair): pair is NonNullable<typeof pair> => pair !== undefined)
        .slice(0, 20);

      const support = await checkClaimSupport({ pairs, language: "español" }).catch((error: unknown) => {
        console.error("claim support check failed", error);
        return [];
      });

      for (const verdict of support) {
        if (verdict.verdict === "sustentado") continue;
        issues.push({
          id: `claim-${verdict.marker}-${verdict.reason.slice(0, 8)}`,
          severity: verdict.verdict === "no_sustentado" ? "critico" : "medio",
          category: "contenido_no_sustentado",
          title: `La fuente de ${verdict.marker} podría no sustentar la afirmación`,
          detail: verdict.reason,
          suggestion: "Revisa el estudio original o cita una fuente que respalde la afirmación.",
        });
      }

      setStage(4);
      const deduped = Array.from(new Map(issues.map((issue) => [issue.id, issue])).values()).sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      );
      const score = scoreAudit(deduped, checks);
      const verified = checks.filter((check) => check.status === "verificada").length;

      setStage(-1);
      return {
        extraction,
        checks,
        issues: deduped,
        score,
        summary: `Se analizaron ${extraction.references.length} referencias y ${extraction.citations.length} llamadas de cita (estilo detectado: ${extraction.detectedStyle}). ${verified} referencias se verificaron por completo y se detectaron ${deduped.length} incidencias.`,
      };
    },
    onSuccess: (data) => {
      setReport(data);
      toast.success(`Auditoría completada · ${data.issues.length} incidencias`);
    },
    onError: (error: unknown) => {
      console.error("audit failed", error);
      setStage(-1);
      toast.error(error instanceof Error ? error.message : "No se pudo auditar el documento.");
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null): void => {
      const file = files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        toast.error("La auditoría bibliográfica funciona con archivos PDF.");
        return;
      }
      audit.mutate(file);
    },
    [audit],
  );

  const correctedBibliography = useMemo(() => {
    if (!report) return "";
    return report.checks
      .map((check, index) => {
        if (check.metadata) {
          return formatCitation(check.metadata, settings.citationStyle, {
            locale,
            index: index + 1,
          });
        }
        return `${index + 1}. [SIN VERIFICAR] ${check.reference.raw}`;
      })
      .join("\n\n");
  }, [locale, report, settings.citationStyle]);

  const grouped = useMemo(() => {
    if (!report) return { critico: [], alto: [], medio: [], bajo: [] } as Record<string, AuditIssue[]>;
    return report.issues.reduce<Record<string, AuditIssue[]>>(
      (accumulator, issue) => {
        accumulator[issue.severity] = [...(accumulator[issue.severity] ?? []), issue];
        return accumulator;
      },
      { critico: [], alto: [], medio: [], bajo: [] },
    );
  }, [report]);

  return (
    <AppShell
      title="Auditoría bibliográfica"
      subtitle="Comprueba que las citas del PDF coincidan con la bibliografía y que los estudios citados existan, aunque estén en otro idioma."
      actions={
        <div className="flex items-center gap-2">
          <Segmented<CitationStyle>
            value={settings.citationStyle}
            onChange={(value) => settings.patch({ citationStyle: value })}
            options={CITATION_STYLES.map((style) => ({ id: style.id, label: style.label }))}
          />
          {report ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setReport(undefined);
                setFileName("");
              }}
              className="h-9 gap-1.5 px-2.5 text-[12.5px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="mx-auto max-w-[1400px] space-y-5">
        {!report && !audit.isPending ? (
          <>
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
              className={`panel grain flex w-full flex-col items-center gap-4 px-6 py-16 transition ${
                dragging ? "border-primary/60 bg-primary/5" : "hover:border-primary/40"
              }`}
            >
              <div className="relative">
                <div className="absolute inset-0 animate-pulse-soft rounded-2xl bg-primary/20 blur-2xl" />
                <div className="relative rounded-2xl border border-primary/30 bg-primary/10 p-4">
                  <Upload className="h-7 w-7 text-primary" />
                </div>
              </div>
              <div className="text-center">
                <p className="font-serif text-lg">Sube el artículo o tesis en PDF</p>
                <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-muted-foreground">
                  MedLingua extrae las llamadas de cita y la bibliografía, cruza unas con otras, verifica cada estudio
                  en Crossref y PubMed, detecta retractaciones y propone la corrección.
                </p>
              </div>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />

            <div className="grid gap-3 md:grid-cols-4">
              {[
                { title: "Cruce cita ↔ referencia", detail: "Citas huérfanas y referencias nunca citadas." },
                { title: "Existencia real", detail: "DOI, título, autores, revista y año contra Crossref/PubMed." },
                { title: "Retractaciones", detail: "Alerta si el estudio fue retractado." },
                { title: "Coherencia de contenido", detail: "¿La fuente sustenta lo que se afirma? Multilingüe." },
              ].map((item) => (
                <div key={item.title} className="panel-flat p-4">
                  <p className="text-[13px] font-semibold">{item.title}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.detail}</p>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {audit.isPending ? (
          <Panel className="p-6">
            <p className="font-serif text-lg">Auditando {fileName}</p>
            <ul className="mt-4 space-y-2.5">
              {STAGES.map((label, index) => {
                const active = stage === index;
                const complete = stage > index || stage === -1;
                return (
                  <li key={label} className="flex items-center gap-2.5 text-[13px]">
                    {complete ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : active ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    ) : (
                      <span className="h-4 w-4 rounded-full border border-border" />
                    )}
                    <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                    {active && index === 2 && checkProgress.total > 0 ? (
                      <span className="label-xs ml-auto">
                        {checkProgress.done}/{checkProgress.total}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {stage === 2 && checkProgress.total > 0 ? (
              <Progress
                value={(checkProgress.done / checkProgress.total) * 100}
                className="mt-4 h-1.5 bg-secondary"
              />
            ) : (
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-primary to-transparent" />
              </div>
            )}
          </Panel>
        ) : null}

        {report ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <Panel className="p-5">
              <div className="flex flex-wrap items-center gap-5">
                <ScoreRing score={report.score} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 label-xs">
                    <FileSearch className="h-3 w-3" /> {fileName}
                  </p>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed">{report.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <StatusPill status="critico">{grouped.critico?.length ?? 0} críticas</StatusPill>
                    <StatusPill status="alto">{grouped.alto?.length ?? 0} altas</StatusPill>
                    <StatusPill status="medio">{grouped.medio?.length ?? 0} medias</StatusPill>
                    <StatusPill status="bajo">{grouped.bajo?.length ?? 0} bajas</StatusPill>
                    <StatusPill status="ok">
                      {report.checks.filter((check) => check.status === "verificada").length} verificadas
                    </StatusPill>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      saveAs(
                        new Blob([buildReportMarkdown(report, fileName, settings.citationStyle)], {
                          type: "text/markdown;charset=utf-8",
                        }),
                        `informe-bibliografia-${fileName.replace(/\.pdf$/i, "")}.md`,
                      )
                    }
                    className="h-9 gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 text-[12.5px] text-primary hover:bg-primary/20"
                  >
                    <Download className="h-3.5 w-3.5" /> Informe
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      saveAs(
                        new Blob([correctedBibliography], { type: "text/plain;charset=utf-8" }),
                        `bibliografia-corregida-${settings.citationStyle}.txt`,
                      )
                    }
                    className="h-9 gap-1.5 rounded-xl border border-border/70 px-3 text-[12.5px] text-muted-foreground hover:text-primary"
                  >
                    <Download className="h-3.5 w-3.5" /> Bibliografía
                  </Button>
                </div>
              </div>
            </Panel>

            <Panel title={`Incidencias · ${report.issues.length}`} meta="Ordenadas por gravedad">
              {report.issues.length === 0 ? (
                <p className="flex items-center gap-2 p-6 text-[13px] text-ok">
                  <CheckCircle2 className="h-4 w-4" /> No se detectaron discrepancias entre citas, bibliografía y
                  estudios.
                </p>
              ) : (
                <ul className="max-h-[58vh] divide-y divide-border/40 overflow-y-auto">
                  {report.issues.map((issue) => {
                    const Icon = CATEGORY_ICON[issue.category];
                    return (
                      <li key={issue.id} className="p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              issue.severity === "critico"
                                ? "text-bad"
                                : issue.severity === "alto"
                                  ? "text-bad/80"
                                  : issue.severity === "medio"
                                    ? "text-warn"
                                    : "text-info"
                            }`}
                          />
                          <p className="text-[13.5px] font-medium">{issue.title}</p>
                          <StatusPill status={issue.severity} />
                          <span className="label-xs">{issue.category.replace(/_/g, " ")}</span>
                        </div>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{issue.detail}</p>
                        {issue.suggestion ? (
                          <p className="mt-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[12px] leading-relaxed text-primary">
                            {issue.suggestion}
                          </p>
                        ) : null}
                        {issue.evidenceUrl ? (
                          <a
                            href={issue.evidenceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition hover:text-primary"
                          >
                            <ExternalLink className="h-3 w-3" /> Ver registro
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              title={`Bibliografía corregida · ${CITATION_STYLES.find((style) => style.id === settings.citationStyle)?.label}`}
              meta="Reconstruida con los metadatos oficiales de Crossref"
              actions={<CopyButton value={correctedBibliography} label="Copiar todo" />}
            >
              <ol className="max-h-[58vh] divide-y divide-border/40 overflow-y-auto">
                {report.checks.map((check, index) => (
                  <li key={`${check.reference.raw.slice(0, 24)}-${index}`} className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {String(check.reference.number ?? index + 1).padStart(2, "0")}
                      </span>
                      <StatusPill status={check.status} />
                      {check.retracted ? <StatusPill status="critico">retractada</StatusPill> : null}
                      {check.similarity !== undefined ? (
                        <span className="label-xs">{Math.round(check.similarity * 100)}% título</span>
                      ) : null}
                      {check.url ? (
                        <a
                          href={check.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-muted-foreground transition hover:text-primary"
                        >
                          <ExternalLink className="h-3 w-3" /> fuente
                        </a>
                      ) : null}
                    </div>
                    <p className="mt-2 font-mono text-[12px] leading-relaxed">
                      {check.formatted ?? check.reference.raw}
                    </p>
                    {check.formatted && check.formatted !== check.reference.raw ? (
                      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground line-through decoration-bad/50">
                        {check.reference.raw}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Panel>
          </motion.div>
        ) : null}
      </div>
    </AppShell>
  );
}
