import { ArrowLeftRight, Check, ChevronDown, Copy, Loader2 } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettings } from "@/context/settings";
import { CATALOG, DOMAINS, REGISTERS, getLanguage, type MedicalDomain, type RegisterLevel } from "@/lib/languages";
import { cn } from "@/lib/utils";

interface LanguagePickerProps {
  value: string;
  onChange: (code: string) => void;
  allowAuto?: boolean;
  align?: "start" | "end";
}

/** Language + regional variant picker limited to the languages enabled in settings. */
export function LanguagePicker({ value, onChange, allowAuto = false, align = "start" }: LanguagePickerProps) {
  const { enabledLanguages, variants, setVariant } = useSettings();
  const languages = CATALOG.filter((language) => enabledLanguages.includes(language.code));
  const language = getLanguage(value);
  const variantCode = language ? variants[language.code] : undefined;
  const variant = language?.variants.find((item) => item.code === variantCode);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-border/80 bg-elevated/60 px-3 py-2 text-left transition hover:border-primary/40 hover:bg-elevated"
        >
          <span className="text-base leading-none">{value === "auto" ? "🌐" : (language?.flag ?? "🌐")}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium leading-tight">
              {value === "auto" ? "Detectar idioma" : (language?.name ?? value)}
            </span>
            <span className="block truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              {value === "auto" ? "automático" : (variant?.label ?? "neutro")}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:text-primary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-[70vh] w-72 overflow-y-auto">
        {allowAuto ? (
          <>
            <DropdownMenuItem onSelect={() => onChange("auto")} className="gap-2">
              <span>🌐</span> Detectar automáticamente
              {value === "auto" ? <Check className="ml-auto h-3.5 w-3.5 text-primary" /> : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {languages.map((item) => (
          <DropdownMenuItem key={item.code} onSelect={() => onChange(item.code)} className="gap-2">
            <span>{item.flag}</span>
            <span className="flex-1">
              {item.name}
              <span className="ml-1.5 text-[11px] text-muted-foreground">{item.nativeName}</span>
            </span>
            {value === item.code ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        {language ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="label-xs">Variante de {language.name}</DropdownMenuLabel>
            {language.variants.map((item) => (
              <DropdownMenuItem
                key={item.code}
                onSelect={() => setVariant(language.code, item.code)}
                className="gap-2"
              >
                <span className="font-mono text-[10.5px] text-muted-foreground">{item.code}</span>
                <span className="flex-1">{item.label}</span>
                {variantCode === item.code ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Source → target language bar with swap button. */
export function LanguageBar({ allowAuto = true }: { allowAuto?: boolean }) {
  const { sourceLanguage, targetLanguage, patch, swapLanguages } = useSettings();
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <LanguagePicker
          value={sourceLanguage}
          allowAuto={allowAuto}
          onChange={(code) => patch({ sourceLanguage: code })}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={swapLanguages}
        disabled={sourceLanguage === "auto"}
        title={sourceLanguage === "auto" ? "Fija el idioma de origen para invertir" : "Invertir dirección"}
        className="h-9 w-9 shrink-0 rounded-xl border border-border/70 text-muted-foreground hover:border-primary/40 hover:text-primary active:scale-90"
      >
        <ArrowLeftRight className="h-4 w-4" />
      </Button>
      <div className="flex-1">
        <LanguagePicker value={targetLanguage} align="end" onChange={(code) => patch({ targetLanguage: code })} />
      </div>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={cn("flex gap-1 rounded-xl border border-border/70 bg-elevated/50 p-1", className)}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            title={option.hint}
            className={cn(
              "relative flex-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <span className="absolute inset-0 rounded-lg bg-primary shadow-glow" aria-hidden="true" />
            ) : null}
            <span className="relative whitespace-nowrap">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Register (complexity) + medical domain selector, shared by several modules. */
export function RegisterDomainControls() {
  const { register, domain, patch } = useSettings();
  return (
    <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
      <div>
        <p className="mb-1.5 label-xs">Nivel de complejidad</p>
        <Segmented<RegisterLevel>
          value={register}
          onChange={(value) => patch({ register: value })}
          options={REGISTERS.map((item) => ({ id: item.id, label: item.label, hint: item.short }))}
        />
      </div>
      <div>
        <p className="mb-1.5 label-xs">Ámbito</p>
        <Segmented<MedicalDomain>
          value={domain}
          onChange={(value) => patch({ domain: value })}
          options={DOMAINS.map((item) => ({
            id: item.id,
            label: item.id === "ambas" ? "One Health" : item.label.replace("Medicina ", ""),
            hint: item.label,
          }))}
        />
      </div>
    </div>
  );
}

export function CopyButton({
  value,
  label = "Copiar",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error("clipboard write failed", error);
      toast.error("Tu navegador bloqueó el portapapeles.");
    }
  }, [value]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      disabled={!value}
      className={cn("h-8 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-primary", className)}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copiado" : label}
    </Button>
  );
}

export function Panel({
  title,
  meta,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel grain relative overflow-hidden", className)}>
      {title ? (
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold tracking-tight">{title}</div>
            {meta ? <div className="mt-0.5 label-xs truncate">{meta}</div> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      {label}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  verificada: "border-ok/35 bg-ok/10 text-ok",
  confirmado: "border-ok/35 bg-ok/10 text-ok",
  sustentado: "border-ok/35 bg-ok/10 text-ok",
  ok: "border-ok/35 bg-ok/10 text-ok",
  parcial: "border-warn/35 bg-warn/10 text-warn",
  dudoso: "border-warn/35 bg-warn/10 text-warn",
  medio: "border-warn/35 bg-warn/10 text-warn",
  alto: "border-bad/30 bg-bad/10 text-bad",
  discrepancia: "border-bad/35 bg-bad/10 text-bad",
  no_sustentado: "border-bad/35 bg-bad/10 text-bad",
  no_encontrada: "border-bad/35 bg-bad/10 text-bad",
  critico: "border-bad/45 bg-bad/15 text-bad",
  bajo: "border-info/30 bg-info/10 text-info",
  sin_datos: "border-border bg-secondary/60 text-muted-foreground",
};

export function StatusPill({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        STATUS_STYLES[status] ?? "border-border bg-secondary/60 text-muted-foreground",
      )}
    >
      {children ?? status.replace(/_/g, " ")}
    </span>
  );
}
