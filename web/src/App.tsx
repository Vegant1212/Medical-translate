import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsProvider } from "@/context/settings";
import { AuthProvider } from "@/context/auth";
import { RequireAuth } from "@/components/RequireAuth";
import { InterfaceLanguageProvider } from "@/context/interface-language";

import Audit from "./pages/Audit";
import Citations from "./pages/Citations";
import Documents from "./pages/Documents";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Proofread from "./pages/Proofread";
import Settings from "./pages/Settings";
import Terminology from "./pages/Terminology";
import Translate from "./pages/Translate";
import Video from "./pages/Video";
import Login from "./pages/Login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
    <InterfaceLanguageProvider>
    <SettingsProvider>
      <TooltipProvider delayDuration={200}>
        <Toaster position="top-center" />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/acceso" element={<Login />} />
            <Route path="/traducir" element={<RequireAuth><Translate /></RequireAuth>} />
            <Route path="/correccion" element={<RequireAuth><Proofread /></RequireAuth>} />
            <Route path="/terminologia" element={<RequireAuth><Terminology /></RequireAuth>} />
            <Route path="/documentos" element={<RequireAuth><Documents /></RequireAuth>} />
            <Route path="/video" element={<RequireAuth><Video /></RequireAuth>} />
            <Route path="/citas" element={<RequireAuth><Citations /></RequireAuth>} />
            <Route path="/auditoria" element={<RequireAuth><Audit /></RequireAuth>} />
            <Route path="/ajustes" element={<RequireAuth><Settings /></RequireAuth>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </SettingsProvider>
    </InterfaceLanguageProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
