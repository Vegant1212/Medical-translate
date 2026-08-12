import { AnimatePresence, motion } from "framer-motion";
import {
  BookMarked,
  FileSearch,
  FileStack,
  Languages,
  LogOut,
  Menu,
  ScanText,
  Settings2,
  Sparkles,
  SpellCheck2,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { Logo } from "@/components/Logo";
import { MEDICAL_MODEL } from "@/lib/toolkit";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth";

interface NavItem {
  to: string;
  label: string;
  hint: string;
  icon: typeof Languages;
  color: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/traducir", label: "Traducir", hint: "Texto clínico bidireccional", icon: Languages, color: "164 66% 50%" },
  { to: "/correccion", label: "Corrección", hint: "Ortografía y siglas · doble check", icon: ScanText, color: "var(--info)" },
  { to: "/terminologia", label: "Terminología", hint: "Siglas y abreviaturas", icon: SpellCheck2, color: "var(--violet)" },
  { to: "/documentos", label: "Documentos", hint: "PDF · Word · PowerPoint", icon: FileStack, color: "var(--warn)" },
  { to: "/video", label: "Vídeo", hint: "Subtítulos desde audio", icon: VideoIcon, color: "var(--coral)" },
  { to: "/citas", label: "Citas", hint: "APA · AMA · Vancouver", icon: BookMarked, color: "var(--info)" },
  { to: "/auditoria", label: "Auditoría", hint: "Bibliografía de un PDF", icon: FileSearch, color: "var(--warn)" },
  { to: "/ajustes", label: "Ajustes", hint: "Idiomas y glosario", icon: Settings2, color: "var(--violet)" },
];

const SECTION_THEMES: Record<string, { primary: string; foreground: string }> = {
  "/traducir": { primary: "164 66% 50%", foreground: "168 70% 5%" },
  "/correccion": { primary: "205 95% 68%", foreground: "205 70% 7%" },
  "/terminologia": { primary: "272 88% 72%", foreground: "272 65% 8%" },
  "/documentos": { primary: "40 90% 61%", foreground: "35 75% 7%" },
  "/video": { primary: "347 88% 68%", foreground: "347 70% 8%" },
  "/citas": { primary: "190 88% 58%", foreground: "190 75% 6%" },
  "/auditoria": { primary: "28 94% 62%", foreground: "28 75% 7%" },
  "/ajustes": { primary: "272 88% 72%", foreground: "272 65% 8%" },
};

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <NavLink to="/" onClick={onNavigate} className="group flex items-center gap-3 px-5 py-6">
        <div className="relative">
          <div className="absolute inset-0 rounded-xl bg-primary/25 blur-lg transition-opacity group-hover:opacity-100 opacity-70" />
          <Logo size={34} className="relative" />
        </div>
        <div className="leading-tight">
          <p className="font-serif text-[17px] font-semibold tracking-tight text-foreground">MedLingua</p>
          <p className="label-xs">Traducción clínica</p>
        </div>
      </NavLink>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            style={{ "--nav-color": item.color } as CSSProperties}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
                isActive
                  ? "bg-[hsl(var(--nav-color)/0.11)] text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-[hsl(var(--nav-color))]"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                ) : null}
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
                  style={{
                    color: `hsl(${item.color})`,
                    borderColor: `hsl(${item.color} / 0.24)`,
                    background: `hsl(${item.color} / ${isActive ? 0.16 : 0.07})`,
                  }}
                >
                  <item.icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
                </span>
                <span className="flex-1">
                  <span className="block text-[13.5px] font-medium leading-tight">{item.label}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground/80">{item.hint}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="m-3 rounded-xl border border-border/70 bg-elevated/50 p-3">
        <p className="flex items-center gap-1.5 label-xs">
          <Sparkles className="h-3 w-3 text-primary" /> Motor
        </p>
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {MEDICAL_MODEL}
          <br />
          Crossref · PubMed · Exa
        </p>
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="truncate text-[11px] text-muted-foreground" title={user?.email}>{user?.email}</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-coral transition hover:brightness-125"
          >
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}

interface AppShellProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const location = useLocation();
  const sectionTheme = SECTION_THEMES[location.pathname] ?? SECTION_THEMES["/traducir"];

  return (
    <div
      className="min-h-screen lg:pl-[248px]"
      style={
        {
          "--primary": sectionTheme.primary,
          "--primary-foreground": sectionTheme.foreground,
          "--ring": sectionTheme.primary,
          "--sidebar-primary": sectionTheme.primary,
          "--sidebar-primary-foreground": sectionTheme.foreground,
        } as CSSProperties
      }
    >
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-border/70 bg-sidebar/80 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 lg:hidden"
          >
            <button
              type="button"
              aria-label="Cerrar menú"
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              className="absolute inset-y-0 left-0 w-[264px] border-r border-border bg-sidebar"
            >
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="absolute right-3 top-6 rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
              <SidebarContent onNavigate={() => setMenuOpen(false)} />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="flex items-start gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="mt-0.5 rounded-lg border border-border p-2 text-muted-foreground transition hover:text-foreground lg:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate bg-gradient-to-r from-foreground via-foreground to-info bg-clip-text font-serif text-xl font-semibold tracking-tight text-transparent sm:text-[26px]">{title}</h1>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{subtitle}</p>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </header>

      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="px-4 py-6 sm:px-6 lg:px-8"
      >
        {children}
      </motion.main>
    </div>
  );
}
