import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertOctagon,
  BookmarkPlus,
  ExternalLink,
  Globe2,
  Microscope,
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { LanguagePicker, Panel, RegisterDomainControls, Spinner, StatusPill } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/context/settings";
import { getLanguage, languageLabel } from "@/lib/languages";
import {
  decodeAbbreviation,
  verifyAgainstSources,
  type AbbreviationResult,
  type VerificationResult,
} from "@/lib/medical";

const EXAMPLES = ["IAM", "BID", "q.d.", "GC/GB", "FeLV", "VSG", "RCP", "TAC c/c", "HTA", "SOAP"];

export default function TerminologyPage() {
  const settings = useSettings();
  const [query, setQuery] = useState<string>("");
  const [context, setContext] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [result, setResult] = useState<AbbreviationResult | undefined>(undefined);
  const [verification, setVerification] = useState<VerificationResult | undefined>(undefined);

  const decode = useMutation({
    mutationFn: () =>
      decodeAbbreviation({
        query: query.trim(),
        context,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        targetVariant: settings.variants[settings.targetLanguage],
        country: country.trim() || undefined,
        domain: settings.domain,
      }),
    onSuccess: (data) => {
      setResult(data);
      setVerification(undefined);
    },
    onError: (error: unknown) => {
      console.error("decode failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo descifrar la abreviatura.");
    },
  });

  const verify = useMutation({
    mutationFn: () => {
      if (!result) throw new Error("Descifra primero una abreviatura.");
      const top = result.readings[0];
      return verifyAgainstSources({
        subject: result.query,
        claim: `significa "${top?.expansion ?? ""}" (${top?.specialty ?? ""}) y se traduce como "${top?.translation ?? ""}"`,
        language: "español",
        domain: settings.domain,
        extraQueries: result.searchQueries,
      });
    },
    onSuccess: (data) => setVerification(data),
    onError: (error: unknown) => {
      console.error("verification failed", error);
      toast.error(error instanceof Error ? error.message : "No se pudo cotejar en las fuentes.");
    },
  });

  const handleDecode = useCallback((): void => {
    if (query.trim().length === 0) {
      toast.error("Escribe una sigla, abreviatura o término.");
      return;
    }
    decode.mutate();
  }, [decode, query]);

  return (
    <AppShell
      title="Terminología y siglas"
      subtitle="Descifra siglas, abreviaturas, contracciones y símbolos médicos, con su uso por país y su cotejo científico."
      actions={
        <Button
          type="button"
          onClick={handleDecode}
          disabled={decode.isPending}
          className="gap-2 rounded-xl bg-primary text-primary-foreground shadow-glow active:scale-[0.97]"
        >
          {decode.isPending ? <Spinner label="Analizando…" /> : <><Search className="h-4 w-4" /> Descifrar</>}
        </Button>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-5">
        <Panel className="p-4">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
              <div>
                <p className="mb-1.5 label-xs">Sigla / abreviatura / término</p>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleDecode();
                  }}
                  placeholder="p. ej. IAM, BID, FeLV, q.d."
                  className="h-[42px] rounded-xl border-border/80 bg-elevated/60 font-mono text-[14px]"
                />
              </div>
              <div>
                <p className="mb-1.5 label-xs">Idioma de la abreviatura</p>
                <LanguagePicker
                  value={settings.sourceLanguage}
                  allowAuto
                  onChange={(code) => settings.patch({ sourceLanguage: code })}
                />
              </div>
              <div>
                <p className="mb-1.5 label-xs">Explicar en</p>
                <LanguagePicker
                  value={settings.targetLanguage}
                  align="end"
                  onChange={(code) => settings.patch({ targetLanguage: code })}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
              <div>
                <p className="mb-1.5 label-xs">Contexto donde aparece (opcional, mejora mucho la precisión)</p>
                <Textarea
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                  placeholder="Pega la frase completa: «…se activa código IAM y se traslada a UCIC…»"
                  className="min-h-[84px] rounded-xl border-border/80 bg-elevated/60 text-[13px]"
                />
              </div>
              <div>
                <p className="mb-1.5 label-xs">País de uso (opcional)</p>
                <Input
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  placeholder="México, Brasil, Francia…"
                  className="h-[42px] rounded-xl border-border/80 bg-elevated/60 text-[13.5px]"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setQuery(example)}
                      className="rounded-md border border-border/70 bg-elevated/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <RegisterDomainControls />
          </div>
        </Panel>

        {result ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[15px] text-primary">{result.normalized || result.query}</span>
                  <StatusPill status="bajo">{result.kind}</StatusPill>
                </span>
              }
              meta={
                result.contextualPick
                  ? `Lectura más probable en contexto: ${result.contextualPick}`
                  : `${result.readings.length} lecturas posibles · explicado en ${languageLabel(settings.targetLanguage)}`
              }
              actions={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={verify.isPending}
                  onClick={() => verify.mutate()}
                  className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-primary"
                >
                  {verify.isPending ? <Spinner label="Cotejando…" /> : <><ShieldCheck className="h-3.5 w-3.5" /> Cotejar en fuentes</>}
                </Button>
              }
            >
              <div className="divide-y divide-border/50">
                {result.readings.map((reading, index) => (
                  <div key={`${reading.expansion}-${index}`} className="p-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <p className="text-[14.5px] font-medium">{reading.expansion}</p>
                      <span className="ml-auto flex items-center gap-1.5">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(5, Math.round((reading.likelihood ?? 0) * 100))}%` }}
                          />
                        </span>
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {Math.round((reading.likelihood ?? 0) * 100)}%
                        </span>
                      </span>
                    </div>

                    <p className="mt-1 text-[13px] text-primary">{reading.translation}</p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{reading.definition}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {reading.specialty ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-elevated/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          <Stethoscope className="h-3 w-3" /> {reading.specialty}
                        </span>
                      ) : null}
                      {(reading.regions ?? []).slice(0, 4).map((region) => (
                        <span
                          key={region}
                          className="inline-flex items-center gap-1 rounded-md border border-info/25 bg-info/10 px-1.5 py-0.5 text-[11px] text-info"
                        >
                          <Globe2 className="h-3 w-3" /> {region}
                        </span>
                      ))}
                      {reading.domain ? <StatusPill status="bajo">{reading.domain}</StatusPill> : null}
                      {reading.normalizedCode ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-mono text-[10.5px] text-primary">
                          <Microscope className="h-3 w-3" /> {reading.normalizedCode}
                        </span>
                      ) : null}
                      {reading.riskFlag ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-bad/35 bg-bad/10 px-1.5 py-0.5 text-[11px] text-bad">
                          <AlertOctagon className="h-3 w-3" /> {reading.riskFlag}
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          settings.addGlossaryEntry({
                            source: result.normalized || result.query,
                            target: reading.translation,
                            note: reading.expansion,
                          });
                          toast.success("Añadido a tu glosario");
                        }}
                        className="ml-auto h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-primary"
                      >
                        <BookmarkPlus className="h-3.5 w-3.5" /> Fijar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {result.safetyNotes?.length > 0 ? (
              <Panel title="Seguridad del paciente" meta="Abreviaturas de riesgo y buenas prácticas">
                <ul className="space-y-2 p-4">
                  {result.safetyNotes.map((note) => (
                    <li key={note} className="flex gap-2 text-[12.5px] leading-relaxed text-warn">
                      <AlertOctagon className="mt-[2px] h-3.5 w-3.5 shrink-0" /> <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {verification ? (
              <Panel
                title="Cotejo en portales científicos"
                meta={`${verification.sources.length} fuentes · PubMed, OMS, MedlinePlus, DeCS, manuales veterinarios`}
                actions={<StatusPill status={verification.status} />}
              >
                <div className="space-y-3 p-4">
                  <p className="text-[13px] leading-relaxed">{verification.verdict}</p>
                  {verification.preferredForm ? (
                    <p className="text-[12.5px] text-primary">Forma normalizada sugerida: {verification.preferredForm}</p>
                  ) : null}
                  {verification.evidence?.length > 0 ? (
                    <ul className="space-y-1.5">
                      {verification.evidence.map((item, index) => (
                        <li key={index} className="text-[12.5px] leading-relaxed text-muted-foreground">
                          <span className="font-mono text-[10.5px] uppercase tracking-wider text-primary">
                            {item.source}
                          </span>{" "}
                          · {item.claim}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {verification.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-start gap-2 rounded-lg border border-border/60 bg-elevated/40 p-2.5 transition hover:border-primary/40"
                      >
                        <ExternalLink className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="line-clamp-2 text-[12px] leading-snug">{source.title}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{source.domain}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              </Panel>
            ) : null}
          </motion.div>
        ) : (
          <Panel className="p-8 text-center">
            <p className="font-serif text-lg">¿Qué significa esta sigla?</p>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              MedLingua ordena todas las lecturas posibles por probabilidad, indica en qué países se usa cada una,
              marca las abreviaturas peligrosas de la lista «Do Not Use» del ISMP y coteja el resultado con PubMed, la
              OMS, DeCS y manuales veterinarios.
            </p>
          </Panel>
        )}

        {getLanguage(settings.targetLanguage) ? null : null}
      </div>
    </AppShell>
  );
}
