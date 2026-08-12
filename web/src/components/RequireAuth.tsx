import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/context/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" /> Verificando tu cuenta…
      </div>
    );
  }

  if (!user) return <Navigate to="/acceso" replace state={{ from: location.pathname }} />;
  return children;
}
