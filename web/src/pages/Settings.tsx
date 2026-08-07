import { Check, Globe2, Languages, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Panel, Segmented, StatusPill } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/context/settings";
import { CATALOG, CORE_LANGUAGE_CODES } from "@/lib/languages";
import { CITATION_STYLES, type CitationStyle } from "@/lib/citations";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const settings = useSettings();
  const [source, setSource] = useState<string>("");
  const [target, setTarget] = useState<string>("");

  const addEntry = useCallback((): void => {
    if (source.trim().length === 0 || target.trim().length === 0) {
      toast.error("Escribe el término de origen y su equivalente.");
      return;
    }
    settings.addGlossaryEntry({ source: source.trim(), target: target.trim() });
    setSource("");
    setTarget("");
    toast.success("Término añadido a tu glosario");
  }, [settings, source, target]);

  return (
    <AppShell
      title="Ajustes"
      subtitle="Activa idiomas adicionales, elige la variante de cada país y fija tu glosario institucional."
    >
      <div className="mx-auto max-w-[1100px] space-y-5">
        <Panel
          title="Idiomas disponibles"
          meta="Los cuatro idiomas base están siempre activos; añade los que necesites"
        >
          <div className="grid gap-2.5 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {CATALOG.map((language) => {
              const enabled = settings.enabledLanguages.includes(language.code);
              const isCore = CORE_LANGUAGE_CODES.includes(language.code);
              return (
                <button
                  key={language.code}
                  type="button"
                  disabled={isCore}
                  onClick={() => settings.toggleLanguage(language.code)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition",
                    enabled
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/70 bg-elevated/40 hover:border-primary/30",
                    isCore ? "cursor-default" : "",
                  )}
                >
                  <span className="text-lg leading-none">{language.flag}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-medium">{language.name}</span>
                      {isCore ? <StatusPill status="ok">base</StatusPill> : null}
                    </span>
                    <span className="block text-[11.5px] text-muted-foreground">
                      {language.nativeName} · {language.variants.length} variantes
                    </span>
                  </span>
                  {enabled ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Variante por país" meta="Determina la terminología, las unidades y la ortotipografía">
          <div className="space-y-4 p-4">
            {CATALOG.filter((language) => settings.enabledLanguages.includes(language.code)).map((language) => (
              <div key={language.code}>
                <p className="mb-1.5 flex items-center gap-1.5 label-xs">
                  <Globe2 className="h-3 w-3" /> {language.name}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {language.variants.map((variant) => {
                    const active = settings.variants[language.code] === variant.code;
                    return (
                      <button
                        key={variant.code}
                        type="button"
                        onClick={() => settings.setVariant(language.code, variant.code)}
                        title={variant.note}
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-[12px] transition",
                          active
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border/70 bg-elevated/40 text-muted-foreground hover:border-primary/30",
                        )}
                      >
                        <span className="font-mono text-[10.5px] opacity-70">{variant.code}</span>{" "}
                        {variant.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Estilo de cita preferido" meta="Se usa en el módulo de citas y en la auditoría">
          <div className="p-4">
            <Segmented<CitationStyle>
              value={settings.citationStyle}
              onChange={(value) => settings.patch({ citationStyle: value })}
              options={CITATION_STYLES.map((style) => ({ id: style.id, label: style.label, hint: style.hint }))}
            />
          </div>
        </Panel>

        <Panel
          title={`Glosario institucional · ${settings.glossary.length}`}
          meta="Se aplica de forma obligatoria en cada traducción"
        >
          <div className="p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Término o sigla de origen"
                className="h-10 rounded-xl border-border/80 bg-elevated/60 text-[13px]"
              />
              <Input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addEntry();
                }}
                placeholder="Equivalente obligatorio"
                className="h-10 rounded-xl border-border/80 bg-elevated/60 text-[13px]"
              />
              <Button
                type="button"
                onClick={addEntry}
                className="h-10 shrink-0 gap-1.5 rounded-xl bg-primary text-primary-foreground"
              >
                <Plus className="h-4 w-4" /> Añadir
              </Button>
            </div>

            {settings.glossary.length === 0 ? (
              <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <Languages className="h-3.5 w-3.5" /> Aún no has fijado términos. Puedes añadirlos también desde el
                glosario que genera cada traducción.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border/40">
                {settings.glossary.map((entry) => (
                  <li key={entry.id} className="group flex items-center gap-3 py-2.5">
                    <span className="term-chip">{entry.source}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-mono text-[12px]">{entry.target}</span>
                    {entry.note ? (
                      <span className="hidden truncate text-[11.5px] text-muted-foreground sm:block">
                        {entry.note}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => settings.removeGlossaryEntry(entry.id)}
                      className="ml-auto text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                      aria-label="Eliminar término"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <p className="pb-4 text-center text-[11.5px] leading-relaxed text-muted-foreground">
          MedLingua es una herramienta de apoyo terminológico y editorial. Toda traducción destinada a uso clínico,
          regulatorio o de publicación debe ser revisada por un profesional cualificado.
        </p>
      </div>
    </AppShell>
  );
}
