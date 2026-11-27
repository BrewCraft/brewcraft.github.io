import {
  Home,
  FileText,
  Calculator,
  Package,
  BarChart3,
  Settings,
  Beaker,
  Layers,
  BookOpen,
  Clock3,
  Sparkles,
  Cloud,
  Download,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { confirmNavigationIfGuarded } from "@/lib/navigation-guard";
import { useSettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSidebar } from "@/components/ui/sidebar-context";

type OfflineReleaseInfo = {
  version: string;
  publishedAt?: string;
  downloadUrl: string;
};

const OFFLINE_RELEASE_TAG = "offline-latest";
const OFFLINE_RELEASE_REPO = (import.meta.env.VITE_OFFLINE_REPO as string | undefined) || "BrewCraft/brewcraft.github.io";

function formatOfflineDate(value: string | undefined, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

const mainItems = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Receitas", url: "/recipes", icon: FileText },
  { title: "Lotes", url: "/batches", icon: Beaker },
  { title: "Inventário", url: "/inventory", icon: Package },
];

const toolsItems = [
  { title: "Calculadoras", url: "/calculators", icon: Calculator },
  { title: "Estilos", url: "/profiles/estilos", icon: BookOpen },
  { title: "Relatórios", url: "/reports", icon: BarChart3 },
];

export function AppSidebar() {
  const location = useLocation();
  const [settings] = useSettings();
  const { isMobile, setOpenMobile } = useSidebar();
  const isEnglish = settings.language === "en-US";
  const t = (pt: string, en: string) => (isEnglish ? en : pt);

  const [offlineRelease, setOfflineRelease] = useState<OfflineReleaseInfo | null>(null);
  const [offlineLoading, setOfflineLoading] = useState(true);
  const [offlineError, setOfflineError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadOfflineRelease = async () => {
      setOfflineLoading(true);
      setOfflineError(false);

      try {
        const endpoint = `https://api.github.com/repos/${OFFLINE_RELEASE_REPO}/releases/tags/${OFFLINE_RELEASE_TAG}?_=${Date.now()}`;
        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: {
            Accept: "application/vnd.github+json",
          },
        });

        if (!response.ok) {
          throw new Error(`Offline release unavailable: ${response.status}`);
        }

        const data = (await response.json()) as {
          draft?: boolean;
          tag_name?: string;
          name?: string;
          published_at?: string;
          updated_at?: string;
          assets?: Array<{ name?: string; browser_download_url?: string; state?: string; updated_at?: string }>;
        };

        if (data.draft) {
          throw new Error("Offline release not published");
        }

        const zipAsset = (data.assets ?? []).find((asset) => {
          const name = asset.name ?? "";
          const isZip = name.toLowerCase().endsWith(".zip");
          const ready = !asset.state || asset.state === "uploaded";
          return isZip && ready && typeof asset.browser_download_url === "string";
        });

        if (!zipAsset?.browser_download_url) {
          throw new Error("Offline release asset not ready");
        }

        const info: OfflineReleaseInfo = {
          version: data.name?.trim() || data.tag_name?.trim() || OFFLINE_RELEASE_TAG,
          publishedAt: zipAsset.updated_at || data.updated_at || data.published_at,
          downloadUrl: zipAsset.browser_download_url,
        };

        if (!cancelled) {
          setOfflineRelease(info);
        }
      } catch {
        if (!cancelled) {
          setOfflineRelease(null);
          setOfflineError(true);
        }
      } finally {
        if (!cancelled) {
          setOfflineLoading(false);
        }
      }
    };

    void loadOfflineRelease();

    return () => {
      cancelled = true;
    };
  }, []);


  const mainItems = [
    { title: t("Dashboard", "Dashboard"), url: "/", icon: Home },
    { title: t("Receitas", "Recipes"), url: "/recipes", icon: FileText },
    { title: t("Lotes", "Batches"), url: "/batches", icon: Beaker },
    { title: t("Inventário", "Inventory"), url: "/inventory", icon: Package },
    { title: t("Assistente IA", "AI Assistant"), url: "/ai-assistant", icon: Sparkles },
  ];

  const toolsItems = [
    { title: t("Calculadoras", "Calculators"), url: "/calculators", icon: Calculator },
    { title: "Brew Day", url: "/brew-day", icon: Clock3 },
    { title: t("Estilos", "Styles"), url: "/styles", icon: BookOpen },
    { title: t("Relatórios", "Reports"), url: "/reports", icon: BarChart3 },
  ];

  const getNavClassName = (path: string) => {
    const isActive = location.pathname === path;
    return isActive
      ? "bg-primary text-primary-foreground font-medium shadow-brew"
      : "hover:bg-muted text-muted-foreground hover:text-foreground";
  };

  const profilesActive = location.pathname.startsWith("/profiles");

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!confirmNavigationIfGuarded()) {
      e.preventDefault();
      return;
    }
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar className="border-r border-border bg-[#edf3fb] text-slate-800 dark:bg-[#171b20] dark:text-[#eaf1ff]">
      <SidebarContent className="p-3">
        {isMobile && (
          <div className="flex items-center justify-end pb-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpenMobile(false)}
              aria-label={t("Fechar menu", "Close menu")}
              title={t("Fechar menu", "Close menu")}
              className="h-8 w-8 text-slate-600 hover:text-slate-900 dark:text-[#d9e7ff]/80 dark:hover:text-[#eaf1ff]"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        )}
        <SidebarGroup>
          <SidebarGroupLabel className="text-slate-500 dark:text-[#d9e7ff]/70 font-medium">{t("Principal", "Main")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.filter(item => item.url !== "/inventory" || settings.inventory).map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      onClick={handleNavClick}
                      className={getNavClassName(item.url)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-slate-500 dark:text-[#d9e7ff]/70 font-medium">{t("Ferramentas", "Tools")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      onClick={handleNavClick}
                      className={getNavClassName(item.url)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={profilesActive}>
                  <NavLink to="/profiles/equipamento" onClick={handleNavClick} className={profilesActive ? "bg-primary text-primary-foreground font-medium shadow-brew" : "hover:bg-muted text-muted-foreground hover:text-foreground"}>
                    <Layers className="h-4 w-4" />
                    <span>{t("Perfis", "Profiles")}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/settings"
                    onClick={handleNavClick}
                    className={getNavClassName("/settings")}
                  >
                    <Settings className="h-4 w-4" />
                    <span>{t("Configurações", "Settings")}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/cloud-sync"
                    onClick={handleNavClick}
                    className={getNavClassName("/cloud-sync")}
                  >
                    <Cloud className="h-4 w-4" />
                    <span>{t("Nuvem e sincronização", "Cloud & sync")}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className="h-auto items-start [&>span:last-child]:overflow-visible [&>span:last-child]:whitespace-normal [&>span:last-child]:text-clip"
                >
                  <button
                    type="button"
                    disabled={!offlineRelease || offlineLoading}
                    onClick={() => {
                      if (!offlineRelease) return;
                      window.open(offlineRelease.downloadUrl, "_blank", "noopener,noreferrer");
                      if (isMobile) {
                        setOpenMobile(false);
                      }
                    }}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    title={
                      offlineRelease
                        ? t("Baixar versão offline", "Download offline version")
                        : offlineLoading
                          ? t("Verificando versão offline...", "Checking offline version...")
                          : t("Versão offline indisponível", "Offline version unavailable")
                    }
                  >
                    <Download className="mt-0.5 h-4 w-4" />
                    <span className="flex min-w-0 flex-col items-start leading-tight">
                      <span>{t("Versão Offline", "Offline Version")}</span>
                      <span className="text-xs text-muted-foreground whitespace-normal break-words">
                        {offlineLoading
                          ? t("Verificando...", "Checking...")
                          : offlineRelease
                            ? [
                                offlineRelease.version,
                                formatOfflineDate(
                                  offlineRelease.publishedAt,
                                  isEnglish ? "en-US" : "pt-BR",
                                ),
                              ]
                                .filter(Boolean)
                                .join(" • ")
                            : offlineError
                              ? t("Indisponível", "Unavailable")
                              : t("Não publicada", "Not published")}
                      </span>
                    </span>
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
