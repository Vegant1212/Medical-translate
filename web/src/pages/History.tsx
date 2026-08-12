import { Clock3, FileText, FolderOpen, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Panel, Spinner } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { clearLocalProjects, deleteLocalProject, listLocalProjects, type ProjectSummary } from "@/lib/project-history";

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function HistoryPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setProjects(await listLocalProjects());
    } catch (error) {
      console.error("history load failed", error);
      toast.error("No se pudo abrir el historial local.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <AppShell
      title="Historial local"
      subtitle="Proyectos guardados únicamente en este navegador y computadora."
      actions={projects.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          className="gap-2 text-muted-foreground hover:text-destructive"
          onClick={() => {
            if (!window.confirm("¿Eliminar definitivamente todos los proyectos locales?")) return;
            void clearLocalProjects().then(() => { setProjects([]); toast.success("Historial eliminado"); });
          }}
        >
          <Trash2 className="h-4 w-4" /> Borrar todo
        </Button>
      ) : undefined}
    >
      <div className="mx-auto max-w-[1100px] space-y-4">
        <p className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/8 px-3 py-2 text-[12px] text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" /> Los documentos no se sincronizan con la nube y pueden perderse si borras los datos del navegador.
        </p>
        {loading ? (
          <Panel className="flex min-h-40 items-center justify-center"><Spinner label="Abriendo historial…" /></Panel>
        ) : projects.length === 0 ? (
          <Panel className="flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center">
            <Clock3 className="h-8 w-8 text-primary" />
            <div><p className="font-serif text-lg">Aún no hay proyectos guardados</p><p className="mt-1 text-[12.5px] text-muted-foreground">Los próximos documentos aparecerán aquí automáticamente.</p></div>
            <Button asChild><Link to="/documentos">Subir un documento</Link></Button>
          </Panel>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {projects.map((project) => {
              const percent = project.totalSegments > 0 ? Math.round(project.translatedCount / project.totalSegments * 100) : 0;
              return (
                <Panel key={project.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl border border-primary/25 bg-primary/10 p-2.5"><FileText className="h-5 w-5 text-primary" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-semibold">{project.fileName}</p>
                      <p className="label-xs mt-1">{project.kind.toUpperCase()} · {formatSize(project.size)} · {new Date(project.updatedAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between label-xs"><span>{project.translatedCount}/{project.totalSegments} segmentos</span><span>{percent}%</span></div>
                    <Progress value={percent} className="h-1.5" />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button asChild size="sm" className="flex-1 gap-1.5"><a href={`/documentos?project=${encodeURIComponent(project.id)}`}><FolderOpen className="h-3.5 w-3.5" /> Continuar</a></Button>
                    <Button
                      type="button" size="sm" variant="ghost" aria-label={`Eliminar ${project.fileName}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (!window.confirm(`¿Eliminar definitivamente «${project.fileName}»?`)) return;
                        void deleteLocalProject(project.id).then(() => refresh());
                      }}
                    ><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
