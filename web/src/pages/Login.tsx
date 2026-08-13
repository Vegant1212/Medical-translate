import { Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth";

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const destination = (location.state as { from?: string } | null)?.from ?? "/documentos";

  if (user) return <Navigate to={destination} replace />;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setPending(true);
    try {
      await signIn(email.trim(), password);
      toast.success("Sesión iniciada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo acceder.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute left-[-10%] top-[-20%] h-[500px] w-[500px] rounded-full bg-primary/12 blur-[120px]" />
      <div className="absolute bottom-[-25%] right-[-10%] h-[520px] w-[520px] rounded-full bg-violet/12 blur-[120px]" />
      <div className="panel relative z-10 w-full max-w-md p-6 sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <Logo size={38} />
          <div>
            <h1 className="font-serif text-2xl font-semibold">MedLingua</h1>
            <p className="text-sm text-muted-foreground">Tus proyectos médicos, siempre disponibles</p>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-sm font-medium text-primary">Acceso privado por invitación</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Ingresa con el correo autorizado por el administrador.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Correo electrónico</span>
            <Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Contraseña</span>
            <Input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres" />
          </label>
          <Button type="submit" disabled={pending} className="h-11 w-full rounded-xl">
            {pending ? <><Loader2 className="animate-spin" /> Procesando…</> : <><LockKeyhole /> Entrar</>}
          </Button>
        </form>

        <p className="mt-5 flex items-start gap-2 rounded-xl border border-info/20 bg-info/5 p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          Tus proyectos y documentos se guardan de forma privada y solo estarán disponibles dentro de tu cuenta.
        </p>
      </div>
    </div>
  );
}
