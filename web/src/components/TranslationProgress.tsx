/**
 * TranslationProgress — a multi-stage animated visualization shown while
 * the medical translation is in flight. Each stage lights up in sequence
 * with a shimmering progress bar, rotating status icons, and live metrics.
 *
 * Two modes:
 * - **Text mode** (default): stages advance on a time heuristic, progress
 *   bar fills gradually but never reaches 100% until `active` flips false.
 * - **Document mode** (`progressPercent` provided): stages and bar are
 *   driven by real segment-level progress (done/total). The big percentage
 *   in the orb reflects exact completion.
 */

import { AnimatePresence, motion } from "framer-motion";
import { Check, FileText, FileSearch, Languages, Loader2, ScanText, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export interface ProgressStage {
  id: string;
  label: string;
  hint: string;
  icon: typeof Languages;
}

const TEXT_STAGES: ProgressStage[] = [
  { id: "parse", label: "Analizando texto", hint: "Detección de idioma · estructura · siglas", icon: ScanText },
  { id: "translate", label: "Traduciendo", hint: "Terminología MeSH · DCI/INN · CIE-11", icon: Languages },
  { id: "glossary", label: "Construyendo glosario", hint: "Abreviaturas · epónimos · unidades", icon: FileText },
  { id: "verify", label: "Verificación clínica", hint: "Lista ISMP · ambigüedades · dosis", icon: ShieldCheck },
];

const DOC_STAGES: ProgressStage[] = [
  { id: "connect", label: "Iniciando traducción", hint: "Conectando con el motor de traducción", icon: FileSearch },
  { id: "translate", label: "Traduciendo segmentos", hint: "Traducción neuronal rápida por lotes", icon: Languages },
  { id: "integrity", label: "Protegiendo datos", hint: "Cifras · dosis · DOI · referencias intactas", icon: ShieldCheck },
  { id: "finish", label: "Finalizando traducción", hint: "Completando los últimos segmentos", icon: FileText },
];

const STAGE_COLORS = ["var(--primary)", "var(--info)", "var(--violet)", "var(--coral)"] as const;

export interface TranslationProgressProps {
  /** Elapsed milliseconds since the translation started. */
  startTime: number;
  /** Character count of the source text being translated. */
  charCount: number;
  /** Whether the translation is currently running. */
  active: boolean;
  /** Real progress 0–100. When provided, drives stages + bar (document mode). */
  progressPercent?: number;
  /** Total units (segments) being processed — shown in document mode. */
  totalUnits?: number;
  /** Completed units (segments) so far — shown in document mode. */
  doneUnits?: number;
  /** File name being translated — shown in document mode. */
  fileName?: string;
  /** Live status from the active translation engine. */
  statusMessage?: string;
  /** Cancels the active request. Used for text translations. */
  onCancel?: () => void;
}

export function TranslationProgress({
  startTime,
  charCount,
  active,
  progressPercent,
  totalUnits,
  doneUnits,
  fileName,
  statusMessage,
  onCancel,
}: TranslationProgressProps) {
  const [elapsed, setElapsed] = useState<number>(0);
  const isDocMode = typeof progressPercent === "number";
  const stages = isDocMode ? DOC_STAGES : TEXT_STAGES;

  // Tick elapsed timer
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 50);
    return () => window.clearInterval(interval);
  }, [active, startTime]);

  // ── Compute current stage ──
  // In document mode: map progressPercent to 4 stages.
  // In text mode: use elapsed-time breakpoints.
  let currentStage = 0;
  if (isDocMode) {
    const pct = progressPercent ?? 0;
    if (pct >= 85) currentStage = 3;
    else if (pct >= 50) currentStage = 2;
    else if (pct >= 15) currentStage = 1;
    else currentStage = 0;
  } else {
    const breakpoints = [1200, 3500, 5500, 7500];
    let stage = 0;
    for (let i = 0; i < breakpoints.length; i++) {
      if (elapsed >= breakpoints[i]) stage = i + 1;
    }
    currentStage = Math.min(stage, stages.length - 1);
  }

  useEffect(() => {
    if (!active) {
      // no-op; stage computed each render
    }
  }, [active]);

  const elapsedSeconds = elapsed / 1000;
  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)} min ${Math.floor(elapsedSeconds % 60)} s`;

  // Overall progress (0..1)
  const overallProgress = isDocMode
    ? Math.max(0, Math.min((progressPercent ?? 0) / 100, 1))
    : Math.min(elapsed / 8000, 0.92);

  const displayPercent = Math.round(progressPercent ?? 0);

  const waitingMessage = elapsed >= 12_000
    ? "La IA está terminando los últimos segmentos…"
    : "La IA está procesando el texto…";

  const charsPerSec = elapsed > 500 ? Math.round((charCount / (elapsed / 1000)) * 10) / 10 : 0;
  const secondsPerSegment = elapsedSeconds / Math.max(doneUnits ?? 1, 1);
  const paceLabel = secondsPerSegment >= 60
    ? `${(secondsPerSegment / 60).toFixed(1)} min/seg`
    : `${Math.round(secondsPerSegment * 10) / 10} s/seg`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex min-h-[340px] flex-col items-center justify-center px-6 py-8"
    >
      {/* ── Ambient glow ── */}
      <motion.div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <motion.div
          className="absolute -inset-20 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, hsl(var(--primary) / 0.12), transparent 60%)",
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      {/* ── Central orb with percentage ── */}
      <div className="relative mb-8 flex items-center justify-center">
        {/* Pulsing rings */}
        {[0, 1, 2].map((ring) => (
          <motion.div
            key={ring}
            className="absolute rounded-full border"
            style={{
              width: 130 + ring * 36,
              height: 130 + ring * 36,
              borderColor: `hsl(${STAGE_COLORS[ring]} / 0.22)`,
            }}
            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: "easeOut",
              delay: ring * 0.6,
            }}
          />
        ))}

        {/* SVG progress ring */}
        <svg
          className="absolute"
          width="160"
          height="160"
          viewBox="0 0 160 160"
          style={{ transform: "rotate(-90deg)" }}
        >
          <defs>
            <linearGradient id="translation-progress-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="38%" stopColor="hsl(var(--info))" />
              <stop offset="72%" stopColor="hsl(var(--violet))" />
              <stop offset="100%" stopColor="hsl(var(--coral))" />
            </linearGradient>
          </defs>
          <circle
            cx="80"
            cy="80"
            r="70"
            fill="none"
            stroke="hsl(var(--secondary))"
            strokeWidth="3"
            opacity="0.5"
          />
          <motion.circle
            cx="80"
            cy="80"
            r="70"
            fill="none"
            stroke="url(#translation-progress-ring)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 70}
            animate={{
              strokeDashoffset: 2 * Math.PI * 70 * (1 - overallProgress),
            }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            style={{
              filter: "drop-shadow(0 0 7px hsl(var(--info) / 0.45))",
            }}
          />
        </svg>

        {/* Core */}
        <motion.div
          className="relative flex h-[120px] w-[120px] flex-col items-center justify-center rounded-full"
          style={{
            background:
              "radial-gradient(circle at 28% 22%, hsl(var(--info) / 0.22), transparent 44%), radial-gradient(circle at 76% 78%, hsl(var(--violet) / 0.18), transparent 48%), hsl(var(--primary) / 0.055)",
            border: "1px solid hsl(var(--info) / 0.32)",
            boxShadow: "0 0 42px -10px hsl(var(--violet) / 0.38), inset 0 0 22px -5px hsl(var(--primary) / 0.18)",
          }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Text requests do not expose real progress, so only documents show a percentage. */}
          {isDocMode ? (
            <motion.div
              key={displayPercent}
              className="font-mono text-[30px] font-bold tabular-nums text-foreground"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              {displayPercent}
              <span className="text-[14px]">%</span>
            </motion.div>
          ) : (
            <Loader2 className="h-9 w-9 animate-spin text-primary" aria-hidden="true" />
          )}
          <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground">
            {isDocMode ? "segmentos" : "procesando"}
          </div>

        </motion.div>
      </div>

      {/* ── File name (document mode) ── */}
      {isDocMode && fileName ? (
        <motion.div
          className="mb-5 max-w-[420px] truncate text-center"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="inline-flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-1.5 text-[12px] text-primary">
            <FileText className="h-3.5 w-3.5" />
            <span className="truncate">{fileName}</span>
          </span>
        </motion.div>
      ) : null}

      {isDocMode && statusMessage ? (
        <p className="mb-4 max-w-[420px] text-center text-[12.5px] leading-relaxed text-muted-foreground" role="status">
          {statusMessage}
        </p>
      ) : null}

      {!isDocMode ? (
        <p className="mb-4 max-w-[420px] text-center text-[12.5px] leading-relaxed text-muted-foreground" role="status">
          {waitingMessage}
        </p>
      ) : null}

      {/* ── Overall progress bar ── */}
      <div className="relative mb-7 h-1.5 w-full max-w-[420px] overflow-hidden rounded-full bg-secondary/60">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--info)), hsl(var(--violet)), hsl(var(--coral)))",
            backgroundSize: "200% 100%",
            boxShadow: "0 0 14px -2px hsl(var(--info) / 0.48)",
          }}
          animate={{
            width: isDocMode ? `${Math.max(4, overallProgress * 100)}%` : "38%",
            x: isDocMode ? "0%" : ["-110%", "270%"],
            backgroundPosition: ["0% 0%", "200% 0%"],
          }}
          transition={{
            width: { duration: 0.4, ease: "easeOut" },
            x: isDocMode ? { duration: 0 } : { duration: 1.8, repeat: Infinity, ease: "easeInOut" },
            backgroundPosition: { duration: 2, repeat: Infinity, ease: "linear" },
          }}
        />
        {/* Scan shimmer overlay */}
        <motion.div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.3) 50%, transparent 100%)",
            backgroundSize: "40% 100%",
          }}
          animate={{ backgroundPosition: ["-40% 0", "140% 0"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* ── Stage list ── */}
      <div className="w-full max-w-[420px] space-y-2.5">
        {stages.map((stage, index) => {
          const isDone = index < currentStage;
          const isActive = index === currentStage;
          const isPending = index > currentStage;
          const Icon = stage.icon;
          const stageColor = STAGE_COLORS[index] ?? "var(--primary)";

          return (
            <motion.div
              key={stage.id}
              initial={false}
              animate={{
                opacity: isPending ? 0.35 : 1,
                scale: isActive ? 1.0 : 0.98,
              }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-3"
            >
              {/* Icon / status circle */}
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors"
                style={{
                  borderColor: isDone
                    ? `hsl(${stageColor} / 0.32)`
                    : isActive
                      ? `hsl(${stageColor} / 0.58)`
                      : "hsl(var(--border) / 0.5)",
                  background: isDone
                    ? `hsl(${stageColor} / 0.1)`
                    : isActive
                      ? `hsl(${stageColor} / 0.1)`
                      : "transparent",
                }}
              >
                <AnimatePresence mode="wait">
                  {isDone ? (
                    <motion.div
                      key="done"
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    >
                      <Check className="h-4 w-4" style={{ color: `hsl(${stageColor})` }} strokeWidth={2.5} />
                    </motion.div>
                  ) : isActive ? (
                    <motion.div key="active">
                      <Loader2 className="h-4 w-4 animate-spin" style={{ color: `hsl(${stageColor})` }} />
                    </motion.div>
                  ) : (
                    <Icon
                      className="h-4 w-4 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* Label + hint */}
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13px] font-medium leading-tight transition-colors"
                  style={{
                    color: isDone
                      ? "hsl(var(--foreground) / 0.7)"
                      : isActive
                        ? `hsl(${stageColor})`
                        : "hsl(var(--muted-foreground))",
                  }}
                >
                  {stage.label}
                </div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {stage.hint}
                </div>
              </div>

              {/* Active shimmer line */}
              {isActive ? (
                <motion.div
                  className="h-3 w-16 overflow-hidden rounded-full bg-secondary/50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, transparent, hsl(${stageColor}), transparent)`,
                      backgroundSize: "50% 100%",
                    }}
                    animate={{ backgroundPosition: ["-50% 0", "150% 0"] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                </motion.div>
              ) : null}
            </motion.div>
          );
        })}
      </div>

      {/* ── Live metrics ── */}
      <motion.div
        className="mt-7 flex items-center gap-6"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="text-center">
          <div className="font-mono text-[18px] font-semibold tabular-nums text-primary">
            {elapsedLabel}
          </div>
          <div className="label-xs mt-0.5">tiempo</div>
        </div>
        <div className="h-8 w-px bg-border/60" />
        {isDocMode ? (
          <div className="text-center">
            <div className="font-mono text-[18px] font-semibold tabular-nums text-foreground">
              {doneUnits ?? 0}
              <span className="text-muted-foreground">/{totalUnits ?? 0}</span>
            </div>
            <div className="label-xs mt-0.5">segmentos</div>
          </div>
        ) : (
          <div className="text-center">
            <div className="font-mono text-[18px] font-semibold tabular-nums text-foreground">
              {charCount.toLocaleString()}
            </div>
            <div className="label-xs mt-0.5">caracteres</div>
          </div>
        )}
        <div className="h-8 w-px bg-border/60" />
        <div className="text-center">
          <div className="font-mono text-[18px] font-semibold tabular-nums text-foreground">
            {isDocMode && totalUnits
              ? paceLabel
              : charsPerSec > 0
                ? charsPerSec.toFixed(0)
                : "—"}
          </div>
          <div className="label-xs mt-0.5">{isDocMode ? "ritmo" : "car/s"}</div>
        </div>
      </motion.div>

      {onCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="mt-5 gap-1.5 text-[12px] text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" /> Cancelar proceso
        </Button>
      ) : null}
    </motion.div>
  );
}
