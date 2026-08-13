import { useMutation } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Captions,
  CheckCircle2,
  Download,
  FileAudio,
  FileVideo,
  Film,
  Languages,
  Mic,
  RotateCcw,
  Sparkles,
  Stethoscope,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CopyButton, LanguageBar, Panel, RegisterDomainControls, Segmented, Spinner } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/context/settings";
import { languageLabel } from "@/lib/languages";
import {
  buildBilingualSrt,
  buildSrt,
  buildVtt,
  detectSpecialty,
  formatSrtTime,
  MAX_VIDEO_BYTES,
  summarizeTranscript,
  transcribeMedia,
  translateSubtitles,
  type SubtitleSegment,
  type TranscriptSegment,
  type TranscriptionResult,
  VIDEO_EXTENSIONS,
} from "@/lib/transcribe";
import { cn } from "@/lib/utils";

type Stage = "idle" | "extracting" | "transcribing" | "translated" | "translating" | "done";
type SubFormat = "srt" | "vtt" | "bilingual";

const STAGE_LABELS: Record<string, string> = {
  extracting: "Extrayendo pista de audio del vídeo…",
  transcribing: "Transcribiendo el audio a texto…",
  translated: "Transcripción lista",
  translating: "Traduciendo segmentos…",
  done: "Traducción completada",
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VideoPage() {
  const settings = useSettings();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [dragging, setDragging] = useState<boolean>(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [transcript, setTranscript] = useState<TranscriptionResult | undefined>(undefined);
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [summary, setSummary] = useState<string>("");
  const [specialty, setSpecialty] = useState<string>("");
  const [subFormat, setSubFormat] = useState<SubFormat>("srt");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const transcribe = useMutation({
    mutationFn: async (inputFile: File): Promise<TranscriptionResult> => {
      setStage("extracting");
      setExtractionProgress({ current: 0, total: 0 });
      const result = await transcribeMedia(inputFile, (st, mediaProgress) => {
        if (st.startsWith("Extrayendo")) {
          setStage("extracting");
          if (mediaProgress) {
            setExtractionProgress({ current: mediaProgress.currentTime, total: mediaProgress.totalTime });
          }
        } else {
          setStage("transcribing");
        }
      });
      setStage("translated");
      setExtractionProgress((previous) => ({ current: previous.total, total: previous.total }));
      return result;
    },
    onSuccess: (data) => {
      setTranscript(data);
      setSubtitles(
        data.segments.map((seg) => ({
          index: seg.index,
          start: seg.start,
          end: seg.end,
          original: seg.text,
          translated: "",
        })),
      );
      toast.success(`${data.segments.length} segmentos transcritos en ${data.duration.toFixed(0)}s`);

      // Fire summary + specialty detection in background
      if (data.text.trim().length > 50) {
        summarizeTranscript(data.text, settings.targetLanguage, settings.domain)
          .then((s) => setSummary(s))
          .catch((err: unknown) => console.error("summary failed", err));
        detectSpecialty(data.text)
          .then((s) => setSpecialty(s))
          .catch((err: unknown) => console.error("specialty failed", err));
      }
    },
    onError: (error: unknown) => {
      console.error("transcription failed", error);
      setStage("idle");
      setExtractionProgress({ current: 0, total: 0 });
      toast.error(error instanceof Error ? error.message : "No se pudo transcribir el archivo.");
    },
  });

  const translate = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!transcript) throw new Error("Transcribe el vídeo primero.");
      setStage("translating");
      setProgress({ done: 0, total: transcript.segments.length });
      const map = await translateSubtitles(
        {
          segments: transcript.segments,
          targetLanguage: settings.targetLanguage,
          targetVariant: settings.variants[settings.targetLanguage],
          sourceLanguage:
            settings.sourceLanguage === "auto" && transcript.language !== "unknown"
              ? transcript.language
              : settings.sourceLanguage,
          register: settings.register,
          domain: settings.domain,
          glossary: settings.glossaryPairs,
        },
        (done, total) => setProgress({ done, total }),
      );
      setSubtitles((prev) =>
        prev.map((seg) => ({
          ...seg,
          translated: map[`s${seg.index}`] ?? seg.translated,
        })),
      );
      setStage("done");
    },
    onSuccess: () => toast.success("Subtítulos traducidos"),
    onError: (error: unknown) => {
      console.error("subtitle translation failed", error);
      setStage("translated");
      toast.error(error instanceof Error ? error.message : "No se pudieron traducir los subtítulos.");
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null): void => {
      const f = files?.[0];
      if (!f) return;
      if (f.size > MAX_VIDEO_BYTES) {
        toast.error("El archivo supera los 100 MB.");
        return;
      }
      setFile(f);
      setTranscript(undefined);
      setSubtitles([]);
      setSummary("");
      setSpecialty("");
      setStage("idle");
      setExtractionProgress({ current: 0, total: 0 });
      transcribe.mutate(f);
    },
    [transcribe],
  );

  const translatedCount = useMemo(() => subtitles.filter((s) => s.translated).length, [subtitles]);

  const handleDownload = useCallback(
    (format: SubFormat): void => {
      if (subtitles.length === 0) return;
      const baseName = (file?.name ?? "subtitulos").replace(/\.[^.]+$/, "");
      let content: string;
      let ext: string;

      switch (format) {
        case "vtt":
          content = buildVtt(subtitles);
          ext = "vtt";
          break;
        case "bilingual":
          content = buildBilingualSrt(subtitles);
          ext = "bilingual.srt";
          break;
        default:
          content = buildSrt(subtitles);
          ext = "srt";
      }

      saveAs(new Blob([content], { type: "text/plain;charset=utf-8" }), `${baseName}-${settings.targetLanguage}.${ext}`);
      toast.success(`Descargado ${baseName}-${settings.targetLanguage}.${ext}`);
    },
    [file, subtitles, settings.targetLanguage],
  );

  const isBusy = transcribe.isPending || translate.isPending;
  const isVideo = file?.type.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/i.test(file?.name ?? "");

  return (
    <AppShell
      title="Vídeo y subtítulos"
      subtitle="Sube un vídeo o audio médico: MedLingua transcribe el audio, genera subtítulos y los traduce al idioma que elijas."
      actions={
        transcript ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setFile(undefined);
                setTranscript(undefined);
                setSubtitles([]);
                setSummary("");
                setSpecialty("");
                setStage("idle");
              }}
              className="h-9 gap-1.5 px-2.5 text-[12.5px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Quitar
            </Button>
            <Button
              type="button"
              onClick={() => translate.mutate()}
              disabled={translate.isPending || translatedCount === subtitles.length}
              className="gap-2 rounded-xl bg-primary text-primary-foreground shadow-glow active:scale-[0.97]"
            >
              {translate.isPending ? <Spinner label="Traduciendo…" /> : <><Languages className="h-4 w-4" /> Traducir subtítulos</>}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="mx-auto max-w-[1400px] space-y-5">
        {!transcript ? (
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
                  {isVideo ? <FileVideo className="h-7 w-7 text-primary" /> : <FileAudio className="h-7 w-7 text-primary" />}
                </div>
              </div>
              <div className="text-center">
                <p className="font-serif text-lg">
                  {transcribe.isPending ? STAGE_LABELS[stage] : "Arrastra tu vídeo o audio, o haz clic"}
                </p>
                <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                  MP4 · WebM · MOV · MP3 · WAV · M4A — hasta 100 MB. Se extrae el audio y se transcribe automáticamente.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  { icon: Mic, label: "Conferencias" },
                  { icon: Stethoscope, label: "Casos clínicos" },
                  { icon: Captions, label: "Vídeos para pacientes" },
                  { icon: Film, label: "Documentales médicos" },
                ].map((item) => (
                  <span
                    key={item.label}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-elevated/50 px-2 py-1 text-[11.5px] text-muted-foreground"
                  >
                    <item.icon className="h-3.5 w-3.5 text-primary" /> {item.label}
                  </span>
                ))}
              </div>
              {transcribe.isPending ? (
                <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
                  <div className="h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-primary to-transparent" />
                </div>
              ) : null}
            </button>

            <input
              ref={inputRef}
              type="file"
              accept={VIDEO_EXTENSIONS}
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />

            {file && transcribe.isPending ? (
              <Panel className="p-5">
                <div className="flex items-center gap-3">
                  {isVideo ? <FileVideo className="h-5 w-5 text-primary" /> : <FileAudio className="h-5 w-5 text-primary" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{file.name}</p>
                    <p className="label-xs">{formatBytes(file.size)} · {STAGE_LABELS[stage]}</p>
                  </div>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary">
                  {stage === "extracting" && extractionProgress.total > 0 ? (
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary via-violet to-coral transition-[width] duration-300"
                      style={{ width: `${Math.min(100, (extractionProgress.current / extractionProgress.total) * 100)}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-primary to-transparent" />
                  )}
                </div>
                {stage === "extracting" && extractionProgress.total > 0 ? (
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {Math.round((extractionProgress.current / extractionProgress.total) * 100)}% extraído
                    </span>
                    <span>
                      {formatDuration(extractionProgress.current)} / {formatDuration(extractionProgress.total)}
                    </span>
                  </div>
                ) : null}
              </Panel>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              {[
                { icon: Mic, title: "Transcripción automática", detail: "IA Gateway speech-to-text con timestamps por segmento. Scribe de ElevenLabs como respaldo con diarización." },
                { icon: Languages, title: "Traducción médica", detail: "Cada segmento se traduce con terminología MeSH/DeCS, siglas, abreviaturas y variantes por país." },
                { icon: Download, title: "SRT · VTT · Bilingüe", detail: "Descarga subtítulos en formato SRT, WebVTT o bilingüe (original + traducción) listos para el reproductor." },
              ].map((item) => (
                <div key={item.title} className="panel-flat p-4">
                  <p className="flex items-center gap-2 text-[13px] font-semibold">
                    <item.icon className="h-4 w-4 text-primary" /> {item.title}
                  </p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.detail}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <Panel className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[12.5px] text-primary">
                  {isVideo ? <FileVideo className="h-4 w-4" /> : <FileAudio className="h-4 w-4" />} {isVideo ? "Vídeo" : "Audio"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{file?.name}</p>
                  <p className="label-xs">
                    {formatBytes(file?.size ?? 0)} · {formatDuration(transcript.duration)} · {transcript.segments.length} segmentos ·{" "}
                    {transcript.language !== "unknown" ? `idioma: ${transcript.language}` : "idioma detectado"}
                    {specialty ? ` · ${specialty}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Segmented<SubFormat>
                    value={subFormat}
                    onChange={setSubFormat}
                    options={[
                      { id: "srt", label: "SRT" },
                      { id: "vtt", label: "VTT" },
                      { id: "bilingual", label: "Bilingüe" },
                    ]}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleDownload(subFormat)}
                    disabled={translatedCount === 0}
                    className="h-9 gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 text-[12.5px] text-primary hover:bg-primary/20"
                  >
                    <Download className="h-3.5 w-3.5" /> Descargar
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <LanguageBar />
                <RegisterDomainControls />
              </div>

              <div className="mt-4 flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {settings.sourceLanguage === "auto"
                      ? transcript.language !== "unknown"
                        ? `Idioma detectado: ${languageLabel(transcript.language)}`
                        : "El idioma se detectará automáticamente al traducir"
                      : `Idioma de origen: ${languageLabel(settings.sourceLanguage)}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Traduce todos los segmentos al {languageLabel(settings.targetLanguage)}.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => translate.mutate()}
                  disabled={translate.isPending || subtitles.length === 0 || translatedCount === subtitles.length}
                  className="gap-2 rounded-xl bg-primary text-primary-foreground shadow-glow sm:min-w-52"
                >
                  {translate.isPending ? (
                    <Spinner label="Traduciendo…" />
                  ) : translatedCount === subtitles.length && subtitles.length > 0 ? (
                    <><CheckCircle2 className="h-4 w-4" /> Traducción terminada</>
                  ) : (
                    <><Languages className="h-4 w-4" /> Traducir subtítulos</>
                  )}
                </Button>
              </div>

              {translate.isPending || progress.total > 0 ? (
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
            </Panel>

            {summary ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Resumen médico
                  </span>
                }
                meta="Generado automáticamente a partir de la transcripción"
                actions={<CopyButton value={summary} />}
              >
                <p className="whitespace-pre-wrap px-4 py-3.5 text-[13px] leading-relaxed text-muted-foreground">{summary}</p>
              </Panel>
            ) : null}

            <Panel
              title={`Editor de subtítulos · ${subtitles.length}`}
              meta="Edita cualquier línea antes de descargar. Los cambios se aplican al archivo final."
              actions={
                <div className="flex items-center gap-2">
                  {translatedCount > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownload(subFormat)}
                      disabled={translatedCount === 0}
                      className="h-8 gap-1.5 px-2 text-[12px] text-primary hover:bg-primary/10"
                    >
                      <Download className="h-3.5 w-3.5" /> Exportar
                    </Button>
                  ) : null}
                </div>
              }
            >
              <div className="max-h-[60vh] divide-y divide-border/40 overflow-y-auto">
                {subtitles.map((seg, index) => (
                  <div key={seg.index} className="grid gap-2 p-3 lg:grid-cols-[auto_1fr_1fr]">
                    <div className="flex items-start gap-2 lg:w-28">
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {formatSrtTime(seg.start)}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/60">→</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {formatSrtTime(seg.end)}
                      </span>
                    </div>
                    <div>
                      <p className="mb-1 label-xs">
                        {transcript.language !== "unknown" ? transcript.language.toUpperCase() : "Original"}
                      </p>
                      <p
                        className={cn(
                          "cursor-pointer whitespace-pre-wrap rounded-lg bg-background/40 p-2.5 text-[12.5px] leading-relaxed text-muted-foreground",
                          editingIndex === index && "ring-1 ring-primary/40",
                        )}
                        onClick={() => setEditingIndex(editingIndex === index ? null : index)}
                      >
                        {seg.original}
                      </p>
                    </div>
                    <div>
                      <p className="mb-1 flex items-center justify-between label-xs">
                        <span>{languageLabel(settings.targetLanguage)}</span>
                        {seg.translated && seg.edited ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSubtitles((prev) =>
                                prev.map((s, i) => (i === index ? { ...s, edited: false } : s)),
                              )
                            }
                            className="inline-flex items-center gap-1 text-muted-foreground transition hover:text-primary"
                          >
                            <RotateCcw className="h-3 w-3" /> sin editar
                          </button>
                        ) : null}
                      </p>
                      <Textarea
                        value={seg.translated}
                        onChange={(event) =>
                          setSubtitles((prev) =>
                            prev.map((s, i) =>
                              i === index
                                ? { ...s, translated: event.target.value, edited: true }
                                : s,
                            ),
                          )
                        }
                        placeholder="Sin traducir"
                        rows={2}
                        className={cn(
                          "resize-none rounded-lg border-border/70 bg-elevated/50 text-[12.5px] leading-relaxed",
                          seg.translated ? "" : "border-dashed",
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {stage === "done" ? (
              <Panel className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <p className="flex-1 text-[13px]">
                    {translatedCount} subtítulos traducidos a {languageLabel(settings.targetLanguage)}.
                    Descarga en SRT, VTT o bilingüe y ábrelos junto al vídeo.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownload("srt")}
                      className="h-8 gap-1.5 rounded-lg border border-border/70 px-2.5 text-[12px]"
                    >
                      <Download className="h-3.5 w-3.5" /> SRT
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownload("vtt")}
                      className="h-8 gap-1.5 rounded-lg border border-border/70 px-2.5 text-[12px]"
                    >
                      <Download className="h-3.5 w-3.5" /> VTT
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownload("bilingual")}
                      className="h-8 gap-1.5 rounded-lg border border-border/70 px-2.5 text-[12px]"
                    >
                      <Download className="h-3.5 w-3.5" /> Bilingüe
                    </Button>
                  </div>
                </div>
              </Panel>
            ) : null}

            <p className="flex gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warn" />
              La calidad de la transcripción depende del audio original (ruido de fondo, acentos, solapamientos).
              Revisa siempre los subtítulos antes de publicarlos en contenido clínico o para pacientes.
            </p>
          </motion.div>
        )}
      </div>
    </AppShell>
  );
}
