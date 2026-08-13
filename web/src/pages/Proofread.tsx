import { useMutation } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Download,
  Eraser,
  ExternalLink,
  FileText,
  Lightbulb,
  ShieldAlert,
  Sparkles,
  SpellCheck2,
  Wand2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CopyButton, LanguageBar, Panel, ProcessPercentage, RegisterDomainControls, Spinner, StatusPill } from "@/components/controls";
import { textToDocx } from "@/lib/docx-export";
import {
  buildProofreadReport,
  proofreadMedicalText,
  verifyAbbreviation,
  type AbbreviationCheck,
  type AbbreviationVerification,
  type IssueCategory,
  type IssueSeverity,
  type ProofIssue,
  type ProofreadResult,
} from "@/lib/proofread";
import { cn } from "@/lib/utils";
import { languageLabel } from "@/lib/languages";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/context/settings";

const SAMPLE = `Paciente femenino de 54 años con antecedentes de HTA, DM2 y dislipidemia. Ingresa por cuadro de 3 dias de evolución caracterizado por disnea progresiva, ortopnea y edema en miembros inferiores. TA: 160/95 mmHg, FC: 92 lpm, SatO2: 88% a aire ambiente. Se indica furosemida 40 mg IV c/12h, enalapril 5 mg VO c/24h y monitorización continua. Se solicita BNp, ecocardiograma y radiografía de tórax. Se activa código IAM por elevación del segmento ST en derivaciones D1, aVL, V5-V6. Se administra AAS 300 mg VO y se traslada a hemodinamia para ACTP primaria. Px alérgico a penicilina. Se deja con sonda Foley y vía periferica.`;

const SEVERITY_STYLES: Record<IssueSeverity, string> = {
  critico: "border-bad/45 bg-bad/15 text-bad",
  alto: "border-bad/30 bg-bad/10 text-bad",
  medio: "border-warn/35 bg-warn/10 text-warn",
  bajo: "border-info/30 bg-info/10 text-info",
  informativo: "border-border bg-secondary/60 text-muted-foreground",
};

const SEVERITY_ICONS: Record<IssueSeverity, typeof AlertTriangle> = {
  critico: ShieldAlert,
  alto: AlertTriangle,
  medio: AlertTriangle,
  bajo: Lightbulb,
  informativo: Lightbulb,
};

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  ortografia: "Ortografía",
  tipografia: "Tipografía",
  abreviatura: "Abreviatura",
  sigla: "Sigla",
  acronimo: "Acrónimo",
  contraccion: "Contracción",
  eponimo: "Epónimo",
  farmaco: "Fármaco",
  unidad: "Unidad",
  ortotipografia: "Ortotipografía",
  estilo: "Estilo",
};

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 85 ? "text-ok" : score >= 60 ? "text-warn" : "text-bad";
  const ring = score >= 85 ? "bg-ok" : score >= 60 ? "bg-warn" : "bg-bad";
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-14 w-14 shrink-0">
        <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
          <circle cx="28" cy="28" r="24" fill="none" strokeWidth="4" className="stroke-border" />
          <circle
            cx="28"
            cy="28"
            r="24"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className={cn("transition-all duration-700", color)}
            stroke="currentColor"
            strokeDasharray={`${(score / 100) * 150.8} 150.8`}
          />
        </svg>
        <span className={cn("absolute inset-0 flex items-center justify-center font-mono text-[14px] font-bold", color)}>
          {score}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium leading-tight">Puntuación global</p>
        <p className="label-xs">
          {score >= 85 ? "Calidad alta" : score >= 60 ? "Calidad media — revisar" : "Calidad baja — corregir"}
        </p>
      </div>
    </div>
  );
}

function IssueRow({ issue, index }: { issue: ProofIssue; index: number }) {
  const Icon = SEVERITY_ICONS[issue.severity] ?? Lightbulb;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4) }}
      className="rounded-xl border border-border/60 bg-elevated/40 p-3"
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", SEVERITY_STYLES[issue.severity])}>
          <Icon className="inline h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label-xs">{CATEGORY_LABELS[issue.category] ?? issue.category}</span>
            <span className="font-mono text-[10px] text-muted-foreground/60">#{issue.offset >= 0 ? issue.offset : "—"}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <code className="rounded bg-bad/10 px-1 py-0.5 text-[12px] text-bad/90 line-through decoration-bad/50">{issue.excerpt}</code>
            <span className="text-muted-foreground">→</span>
            <code className="rounded bg-ok/10 px-1 py-0.5 text-[12px] text-ok/90">{issue.suggestion}</code>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{issue.problem}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground/80">{issue.rationale}</p>
        </div>
      </div>
    </motion.div>
  );
}

function AbbreviationRow({
  abbr,
  index,
}: {
  abbr: AbbreviationCheck;
  index: number;
}) {
  const [verification, setVerification] = useState<AbbreviationVerification | undefined>(undefined);
  const [verifying, setVerifying] = useState<boolean>(false);
  const domain = useSettings().domain;

  const handleVerify = useCallback(async (): Promise<void> => {
    setVerifying(true);
    try {
      const result = await verifyAbbreviation(abbr.token, abbr.correctExpansion, domain);
      setVerification(result);
    } catch (error) {
      console.error("abbrev verify failed", error);
      toast.error("No se pudo cotejar la abreviatura.");
    } finally {
      setVerifying(false);
    }
  }, [abbr.token, abbr.correctExpansion, domain]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4) }}
      className="rounded-xl border border-border/60 bg-elevated/40 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded border border-border/70 bg-secondary/60 px-2 py-0.5 font-mono text-[13px] font-semibold">{abbr.token}</code>
        {abbr.isCorrect ? (
          <StatusPill status="confirmado">correcto</StatusPill>
        ) : (
          <StatusPill status="discrepancia">revisar</StatusPill>
        )}
        {abbr.isDangerous ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-bad/40 bg-bad/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-bad">
            <ShieldAlert className="h-3 w-3" /> ISMP peligroso
          </span>
        ) : null}
        {abbr.normalizedCode ? (
          <span className="font-mono text-[10px] text-muted-foreground">{abbr.normalizedCode}</span>
        ) : null}
      </div>

      <div className="mt-2 space-y-1 text-[12px] leading-relaxed">
        <p>
          <span className="text-muted-foreground">En texto:</span>{" "}
          <span className={cn(abbr.isCorrect ? "text-foreground/90" : "text-bad/90 line-through decoration-bad/40")}>
            {abbr.expansionInText || "(sin expandir)"}
          </span>
        </p>
        <p>
          <span className="text-muted-foreground">Correcto:</span>{" "}
          <span className="text-ok/90">{abbr.correctExpansion}</span>
        </p>
        {abbr.alternatives.length > 0 ? (
          <p className="text-warn">
            <span className="text-muted-foreground">Otras lecturas:</span> {abbr.alternatives.join(" · ")}
          </p>
        ) : null}
        <p className="text-muted-foreground/80">{abbr.note}</p>
      </div>

      <div className="mt-2.5 flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={verifying}
          onClick={handleVerify}
          className="h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-primary"
        >
          {verifying ? <Spinner label="Cotejando…" /> : <><BadgeCheck className="h-3.5 w-3.5" /> Cotejar en fuentes</>}
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
          <ul className="mt-2 space-y-1">
            {verification.sources.slice(0, 4).map((source) => (
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
    </motion.div>
  );
}

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

export default function ProofreadPage() {
  const settings = useSettings();
  const [text, setText] = useState<string>("");
  const [result, setResult] = useState<ProofreadResult | undefined>(undefined);
  const [dragging, setDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDroppedFile = useCallback(async (file: File): Promise<void> => {
    const name = file.name.toLowerCase();
    const isPdf = name.endsWith(".pdf");
    const isText = name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/");
    if (!isPdf && !isText) {
      toast.error("Suelta un .txt, .md o .pdf para cargar texto aquí.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("El archivo es demasiado grande (máx. 5 MB).");
      return;
    }
    try {
      if (isPdf) {
        const { extractPdfText } = await import("@/lib/documents");
        const { text: extracted } = await extractPdfText(file);
        if (extracted.trim().length < 50) {
          toast.error("El PDF no contiene texto seleccionable.");
          return;
        }
        setText(extracted.slice(0, 15000));
      } else {
        const content = await file.text();
        setText(content.slice(0, 15000));
      }
      setResult(undefined);
      toast.success(`«${file.name}» cargado`);
    } catch (error) {
      console.error("file drop failed", error);
      toast.error("No se pudo leer el archivo.");
    }
  }, []);

  const proofread = useMutation({
    mutationFn: () =>
      proofreadMedicalText({
        text,
        sourceLanguage: settings.sourceLanguage,
        sourceVariant: settings.variants[settings.sourceLanguage],
        targetLanguage: settings.targetLanguage,
        targetVariant: settings.variants[settings.targetLanguage],
        register: settings.register,
        domain: settings.domain,
      }),
    onSuccess: (data) => setResult(data),
    onError: (error: unknown) => {
      console.error("proofread failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo revisar el texto.");
    },
  });

  const handleProofread = useCallback((): void => {
    if (text.trim().length < 2) {
      toast.error("Escribe o pega un texto para revisar.");
      return;
    }
    proofread.mutate();
  }, [text, proofread]);

  const handleDownloadReport = useCallback((): void => {
    if (!result) return;
    const report = buildProofreadReport(result, text, {
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
    });
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    saveAs(blob, `medlingua-correccion-${Date.now()}.md`);
    toast.success("Informe descargado");
  }, [result, text, settings.sourceLanguage, settings.targetLanguage]);

  const handleDownloadWord = useCallback(async (): Promise<void> => {
    if (!result) return;
    const issuesBlock = result.issues
      .map((issue, index) => `${index + 1}. [${issue.severity}] ${issue.excerpt} → ${issue.suggestion}\n   ${issue.problem}`)
      .join("\n");
    const abbrBlock = result.abbreviations
      .map((abbr) => `${abbr.token}: ${abbr.expansionInText || "(sin expandir)"} → ${abbr.correctExpansion}${abbr.isDangerous ? " ⚠ PELIGROSO" : ""}`)
      .join("\n");
    const content = `${result.summary}\n\nPuntuación: ${result.score}/100\n\nProblemas:\n${issuesBlock || "Ninguno"}\n\nAbreviaturas:\n${abbrBlock || "Ninguna"}\n\nRecomendaciones:\n${result.recommendations.map((r) => `- ${r}`).join("\n")}`;
    try {
      const blob = await textToDocx(content, {
        title: "Informe de corrección — MedLingua",
        lang: settings.sourceLanguage,
      });
      saveAs(blob, `medlingua-correccion-${Date.now()}.docx`);
      toast.success("Informe Word descargado");
    } catch (error) {
      console.error("word export failed", error);
      toast.error("No se pudo generar el informe Word.");
    }
  }, [result, settings.sourceLanguage]);

  const charCount = text.length;
  const issues = useMemo(() => result?.issues ?? [], [result]);
  const abbreviations = useMemo(() => result?.abbreviations ?? [], [result]);
  const criticalCount = issues.filter((issue) => issue.severity === "critico" || issue.severity === "alto").length;
  const dangerousCount = abbreviations.filter((abbr) => abbr.isDangerous).length;

  return (
    <AppShell
      title="Doble corrección"
      subtitle="Ortografía, tipografía médica y verificación de cada abreviatura, sigla y acrónimo con cotejo en fuentes."
      actions={
        <Button
          type="button"
          onClick={handleProofread}
          disabled={proofread.isPending}
          className="gap-2 rounded-xl bg-primary font-medium text-primary-foreground shadow-glow transition active:scale-[0.97]"
        >
          {proofread.isPending ? (
            <Spinner label="Revisando…" />
          ) : (
            <>
              <Wand2 className="h-4 w-4" /> Revisar
            </>
          )}
        </Button>
      }
    >
      <div className="mx-auto max-w-[1400px] space-y-5">
        <Panel className="p-4">
          <div className="space-y-4">
            <LanguageBar allowAuto={true} />
            <div className="h-px hairline" />
            <RegisterDomainControls />
          </div>
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title="Texto a revisar"
            meta="Pega texto clínico, arrastra un .txt o un PDF — se extraerá el texto"
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
                  <p className="font-serif text-[15px] text-primary">Suelta el archivo aquí</p>
                </div>
              ) : null}
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                onDrop={(event) => {
                  event.stopPropagation();
                  const file = event.dataTransfer.files[0];
                  if (file) void handleDroppedFile(file);
                }}
                placeholder="Pega aquí un informe, historia clínica, abstract o ficha técnica para revisar ortografía, abreviaturas y siglas…"
                spellCheck={false}
                className="min-h-[340px] resize-y rounded-none border-0 bg-transparent px-4 py-3.5 font-sans text-[14px] leading-relaxed focus-visible:ring-0"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleDroppedFile(file);
              }}
            />
            <footer className="flex items-center justify-between border-t border-border/60 px-4 py-2">
              <span className="label-xs">{charCount.toLocaleString()} caracteres</span>
              {result ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleDownloadReport}
                    className="h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-primary"
                  >
                    <FileText className="h-3.5 w-3.5" /> Markdown
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleDownloadWord}
                    className="h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-primary"
                  >
                    <Download className="h-3.5 w-3.5" /> Word
                  </Button>
                </div>
              ) : null}
            </footer>
          </Panel>

          <Panel
            title="Resultado de la corrección"
            meta={
              result
                ? `${issues.length} problemas · ${abbreviations.length} abreviaturas`
                : "El informe aparecerá aquí"
            }
            actions={result ? <CopyButton value={result.summary} label="Copiar resumen" /> : null}
          >
            <div className="relative min-h-[340px] px-4 py-3.5">
              {proofread.isPending ? (
                <div className="absolute inset-0 overflow-hidden">
                  <div className="mx-auto mt-4 flex max-w-sm justify-center px-4"><ProcessPercentage label="Revisión ortográfica y médica" /></div>
                  <div className="h-[2px] w-full animate-scanline bg-gradient-to-r from-transparent via-primary to-transparent" />
                  <div className="space-y-2.5 p-1">
                    {[88, 72, 94, 60, 82, 68].map((width, index) => (
                      <div
                        key={index}
                        className="h-3.5 animate-pulse-soft rounded bg-secondary/70"
                        style={{ width: `${width}%`, animationDelay: `${index * 0.12}s` }}
                      />
                    ))}
                  </div>
                </div>
              ) : result ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                  <ScoreGauge score={result.score} />
                  <p className="text-[13px] leading-relaxed">{result.summary}</p>

                  {(criticalCount > 0 || dangerousCount > 0) && (
                    <div className="flex flex-wrap gap-2 rounded-xl border border-bad/30 bg-bad/5 p-3">
                      {criticalCount > 0 && (
                        <span className="flex items-center gap-1.5 text-[12px] text-bad">
                          <ShieldAlert className="h-3.5 w-3.5" /> {criticalCount} problema{criticalCount > 1 ? "s" : ""} crítico{criticalCount > 1 ? "s" : ""}
                        </span>
                      )}
                      {dangerousCount > 0 && (
                        <span className="flex items-center gap-1.5 text-[12px] text-bad">
                          <ShieldAlert className="h-3.5 w-3.5" /> {dangerousCount} abreviatura{dangerousCount > 1 ? "s" : ""} peligrosa{dangerousCount > 1 ? "s" : ""} (ISMP)
                        </span>
                      )}
                    </div>
                  )}

                  {result.recommendations.length > 0 && (
                    <div className="rounded-xl border border-info/25 bg-info/5 p-3">
                      <p className="flex items-center gap-1.5 label-xs">
                        <Lightbulb className="h-3 w-3 text-info" /> Recomendaciones
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {result.recommendations.map((rec, index) => (
                          <li key={index} className="text-[12px] leading-relaxed text-muted-foreground">{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <SpellCheck2 className="h-10 w-10 text-muted-foreground/40" strokeWidth={1.4} />
                  <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                    Se revisará la ortografía y la tipografía médica, y se verificará cada abreviatura,
                    sigla y acrónimo contra su uso correcto en contexto — con alerta de los de la lista
                    ISMP «Do Not Use».
                  </p>
                </div>
              )}
            </div>
          </Panel>
        </div>

        {result && issues.length > 0 ? (
          <Panel
            title={`Problemas detectados · ${issues.length}`}
            meta="Ordenados por aparición — severidad y categoría para cada uno"
          >
            <div className="space-y-2.5 p-4">
              {issues.map((issue, index) => (
                <IssueRow key={`${issue.offset}-${index}`} issue={issue} index={index} />
              ))}
            </div>
          </Panel>
        ) : null}

        {result && abbreviations.length > 0 ? (
          <Panel
            title={`Abreviaturas y siglas · ${abbreviations.length}`}
            meta="Cada token puede cotejarse contra PubMed, ISMP y portales científicos"
          >
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {abbreviations.map((abbr, index) => (
                <AbbreviationRow key={`${abbr.token}-${index}`} abbr={abbr} index={index} />
              ))}
            </div>
          </Panel>
        ) : null}

        {result && issues.length === 0 && abbreviations.length === 0 ? (
          <Panel className="p-6">
            <div className="flex flex-col items-center justify-center text-center">
              <CheckCircle2 className="h-10 w-10 text-ok" strokeWidth={1.8} />
              <p className="mt-3 font-serif text-[17px] font-semibold">Sin incidencias</p>
              <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                No se detectaron errores ortográficos, tipográficos ni de abreviaturas. El texto cumple
                con la ortotipografía médica del registro seleccionado.
              </p>
            </div>
          </Panel>
        ) : null}
      </div>
    </AppShell>
  );
}
