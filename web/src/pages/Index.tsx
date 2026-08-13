import { motion } from "framer-motion";
import {
  ArrowRight,
  BookMarked,
  FileSearch,
  FileStack,
  Globe2,
  Languages,
  ScanText,
  ShieldCheck,
  SpellCheck2,
  Stethoscope,
  Video as VideoIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { CSSProperties } from "react";

import { Logo } from "@/components/Logo";
import { useInterfaceLanguage, type InterfaceLanguage } from "@/context/interface-language";
import { CATALOG, CORE_LANGUAGE_CODES } from "@/lib/languages";
import { cn } from "@/lib/utils";

const MODULES = [
  {
    to: "/traducir",
    icon: Languages,
    title: "Traducción clínica",
    detail:
      "Bidireccional entre español, inglés, portugués y francés, con variante por país y cuatro niveles: de lenguaje de paciente a artículo indexado.",
    badge: "Glosario automático",
    color: "var(--primary)",
  },
  {
    to: "/correccion",
    icon: ScanText,
    title: "Doble corrección",
    detail:
      "Revisa ortografía, tipografía médica y verifica cada abreviatura, sigla y acrónimo contra su uso correcto en contexto — con alerta ISMP de siglas peligrosas.",
    badge: "Doble check",
    color: "var(--info)",
  },
  {
    to: "/terminologia",
    icon: SpellCheck2,
    title: "Siglas y abreviaturas",
    detail:
      "Todas las lecturas posibles ordenadas por probabilidad, uso por país, códigos normalizados y alerta de abreviaturas peligrosas.",
    badge: "Cotejo científico",
    color: "var(--violet)",
  },
  {
    to: "/documentos",
    icon: FileStack,
    title: "Documentos",
    detail:
      "PDF, Word y PowerPoint traducidos sobre el propio archivo: se conserva el diseño, se editan segmento a segmento y se descargan.",
    badge: "Formato intacto",
    color: "var(--warn)",
  },
  {
    to: "/video",
    icon: VideoIcon,
    title: "Vídeo y subtítulos",
    detail:
      "Sube un vídeo o audio médico: se transcribe el audio, se generan subtítulos con timestamps y se traducen al idioma que elijas.",
    badge: "SRT · VTT · Bilingüe",
    color: "var(--coral)",
  },
  {
    to: "/citas",
    icon: BookMarked,
    title: "Citas bibliográficas",
    detail:
      "APA 7.ª, AMA 11.ª y Vancouver generadas desde un DOI, un PMID o texto libre, con validación en Crossref y PubMed.",
    badge: "Validez comprobada",
    color: "var(--info)",
  },
  {
    to: "/auditoria",
    icon: FileSearch,
    title: "Auditoría de bibliografía",
    detail:
      "Cruza las citas del PDF con su bibliografía, verifica que los estudios existan aunque estén en otro idioma y propone correcciones.",
    badge: "Detecta retractaciones",
    color: "var(--warn)",
  },
] as const;

export default function Index() {
  const { language, setLanguage } = useInterfaceLanguage();
  const coreLanguages = CATALOG.filter((language) => CORE_LANGUAGE_CODES.includes(language.code));
  const extraCount = CATALOG.length - coreLanguages.length;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -left-40 -top-52 h-[560px] w-[560px] animate-drift rounded-full bg-primary/12 blur-[130px]" />
      <div className="pointer-events-none absolute -right-40 top-20 h-[520px] w-[520px] animate-drift rounded-full bg-info/10 blur-[130px]" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-[460px] w-[460px] animate-drift rounded-full bg-violet/8 blur-[130px]" />

      <header className="relative z-10 mx-auto flex max-w-[1200px] items-center justify-between px-5 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <Logo size={32} />
          <div className="leading-tight">
            <p className="font-serif text-[17px] font-semibold tracking-tight">MedLingua</p>
            <p className="label-xs">Traducción y verificación médica</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className="flex items-center rounded-lg border border-border/70 bg-elevated/50 p-0.5"
            aria-label="Idioma de la interfaz"
          >
            {(["es", "en", "pt"] as InterfaceLanguage[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLanguage(option)}
                className={cn(
                  "rounded-md px-2 py-1 text-[10.5px] font-semibold uppercase transition",
                  language === option
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={language === option}
              >
                {option}
              </button>
            ))}
          </div>
          <Link
            to="/traducir"
            className="group inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2 text-[13px] font-medium text-primary transition hover:bg-primary/20"
          >
            <span className="hidden sm:inline">Abrir el traductor</span>
            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1200px] px-5 pb-20 sm:px-8">
        <section className="pt-10 sm:pt-16">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-elevated/60 px-3 py-1 text-[11.5px] text-muted-foreground"
          >
            <Stethoscope className="h-3.5 w-3.5 text-primary" />
            Medicina humana y veterinaria · One Health
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            className="mt-5 max-w-4xl font-serif text-[38px] font-semibold leading-[1.06] tracking-tight sm:text-[62px]"
          >
            Del lenguaje del paciente
            <br />
            <span className="bg-gradient-to-r from-primary via-primary to-info bg-clip-text text-transparent">
              al artículo indexado.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-muted-foreground"
          >
            Traducción médica bidireccional especializada en siglas, abreviaturas, contracciones y epónimos —
            incluyendo su uso real por país. Traduce documentos completos sin tocar su diseño, genera citas en APA, AMA
            o Vancouver y audita la bibliografía de cualquier PDF contra Crossref y PubMed.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Link
              to="/traducir"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-[14px] font-semibold text-primary-foreground shadow-glow transition active:scale-[0.97]"
            >
              Traducir un texto
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/documentos"
              className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-elevated/50 px-5 py-3 text-[14px] font-medium text-foreground transition hover:border-primary/40"
            >
              <FileStack className="h-4 w-4 text-primary" />
              Subir un documento
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.26 }}
            className="mt-10 flex flex-wrap items-center gap-2"
          >
            {coreLanguages.map((language) => (
              <span
                key={language.code}
                className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-elevated/50 px-3 py-1.5 text-[12.5px]"
              >
                <span>{language.flag}</span>
                {language.name}
                <span className="font-mono text-[10px] text-muted-foreground">{language.variants.length} países</span>
              </span>
            ))}
            <Link
              to="/ajustes"
              className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            >
              <Globe2 className="h-3.5 w-3.5" /> +{extraCount} idiomas ampliables
            </Link>
          </motion.div>
        </section>

        <section className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((module, index) => (
            <motion.div
              key={module.to}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.06 }}
            >
              <Link
                to={module.to}
                style={{ "--module-color": module.color } as CSSProperties}
                className="panel grain group flex h-full flex-col p-5 transition hover:border-[hsl(var(--module-color)/0.5)]"
              >
                <div className="flex items-center gap-3">
                  <span className="rounded-xl border border-[hsl(var(--module-color)/0.28)] bg-[hsl(var(--module-color)/0.11)] p-2.5 shadow-[0_8px_28px_-14px_hsl(var(--module-color))]">
                    <module.icon className="h-[18px] w-[18px] text-[hsl(var(--module-color))]" strokeWidth={1.9} />
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--module-color))]">{module.badge}</span>
                </div>
                <p className="mt-4 font-serif text-[19px] font-semibold tracking-tight">{module.title}</p>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">{module.detail}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[hsl(var(--module-color))]">
                  Abrir
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="panel grain flex h-full flex-col justify-between p-5"
          >
            <div>
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-info/25 bg-info/10">
                <ShieldCheck className="h-[18px] w-[18px] text-info" strokeWidth={1.9} />
              </span>
              <p className="mt-4 font-serif text-[19px] font-semibold tracking-tight">Trazabilidad científica</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                Cada término, sigla y referencia puede cotejarse con PubMed, la OMS, MedlinePlus, DeCS, Cochrane,
                Crossref y manuales veterinarios, con enlace a la fuente.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {["pubmed", "crossref", "who.int", "decs", "medlineplus", "merckvetmanual"].map((source) => (
                <span
                  key={source}
                  className="rounded-md border border-border/70 bg-elevated/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  {source}
                </span>
              ))}
            </div>
          </motion.div>
        </section>

        <p className="mt-14 max-w-3xl text-[11.5px] leading-relaxed text-muted-foreground">
          MedLingua es una herramienta de apoyo terminológico y editorial. Toda traducción destinada a uso clínico,
          regulatorio o de publicación debe ser revisada por un profesional cualificado.
        </p>
      </main>
    </div>
  );
}
