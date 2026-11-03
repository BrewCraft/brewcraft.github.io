import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./components/Dashboard";
import RecipesPage from "./components/RecipesPage";
import RecipeFormPage from "./components/RecipeFormPage";
import BatchesPage from "./components/BatchesPage";
import InventoryPage from "./components/InventoryPage";
import CalculatorsPage from "./components/CalculatorsPage";
import ProfilesPage from "./components/ProfilesPage";
import BatchDetailPage from "./components/BatchDetailPage";
import WaterPage from "./components/WaterPage";
import ReportsPage from "./components/ReportsPage";
import StylesPage from "./components/StylesPage";
import StyleDetailPage from "./components/StyleDetailPage";
import BrewDayPage from "./components/BrewDayPage";
import SettingsPage from "./components/SettingsPage";
import AiAssistant from "./components/AiAssistant";
import NotFound from "./pages/NotFound";
import { SettingsTheme } from "./lib/settings";

const queryClient = new QueryClient();

// Em hospedagens estáticas como GitHub Pages e em arquivos abertos direto do disco,
// o BrowserRouter pode quebrar por causa de rotas sem fallback do servidor.
// Usamos HashRouter nesses cenários para manter a navegação estável.
const Router = typeof window !== "undefined" &&
  (window.location.protocol === "file:" || window.location.hostname.endsWith("github.io"))
  ? HashRouter
  : BrowserRouter;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <SettingsTheme />
      <Toaster />
      <Sonner />
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/recipes" element={<RecipesPage />} />
            <Route path="/recipes/new" element={<RecipeFormPage />} />
            <Route path="/recipes/:id" element={<RecipeFormPage />} />
            <Route path="/batches" element={<BatchesPage />} />
            <Route path="/batches/:id" element={<BatchDetailPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/calculators" element={<CalculatorsPage />} />
            <Route path="/brew-day" element={<BrewDayPage />} />
            <Route path="/brewday" element={<BrewDayPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/profiles/:type" element={<ProfilesPage />} />
            <Route path="/water" element={<WaterPage />} />
            <Route path="/styles" element={<StylesPage />} />
            <Route path="/styles/:code" element={<StyleDetailPage />} />
            <Route path="/estilos" element={<StylesPage />} />
            <Route path="/estilos/:code" element={<StyleDetailPage />} />
            <Route path="/fermentation" element={<Navigate to="/profiles/fermentacao" replace />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/ai-assistant" element={<AiAssistant />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </Router>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
