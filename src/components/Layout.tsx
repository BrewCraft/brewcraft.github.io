import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReactNode } from "react";
import { useLocation } from "react-router-dom";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background text-foreground">
        <AppSidebar />
        <main className="min-w-0 flex-1 flex flex-col bg-background">
          <header className="sticky top-0 z-50 h-20 border-b border-border bg-[#eef3fb]/95 dark:bg-[#171b20]/95 flex items-center gap-3 px-6 shadow-[0_4px_18px_rgba(15,23,42,0.06)] backdrop-blur-sm">
            <SidebarTrigger className="shrink-0 text-slate-700 hover:text-slate-900 dark:text-foreground/80 dark:hover:text-foreground" />
            <div className="flex items-center gap-3">
              <img src="./logo-transparent.png" alt="BrewCraft" className="h-16 w-auto object-contain" />
              <span className="text-lg font-semibold tracking-[0.14em] text-slate-800 uppercase dark:text-foreground">BrewCraft</span>
            </div>
          </header>
          <div className="flex-1 p-6">
            <ErrorBoundary resetKey={location.pathname}>
              {children}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}