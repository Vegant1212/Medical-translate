import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsProvider } from "@/context/settings";

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <SettingsProvider>
      <TooltipProvider delayDuration={200}>
        <Toaster position="top-center" />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/traducir" element={<Translate />} />
            <Route path="/correccion" element={<Proofread />} />
            <Route path="/terminologia" element={<Terminology />} />
            <Route path="/documentos" element={<Documents />} />
            <Route path="/video" element={<Video />} />
            <Route path="/citas" element={<Citations />} />
            <Route path="/auditoria" element={<Audit />} />
            <Route path="/ajustes" element={<Settings />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </SettingsProvider>
  </QueryClientProvider>
);

export default App;
