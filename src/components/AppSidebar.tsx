import {
  Home,
  FileText,
  Calculator,
  Package,
  BarChart3,
  Settings,
  Beaker,
  Layers,
  FlaskConical,
  Thermometer,
  Droplets,
  Wrench,
  CookingPot,
  BookOpen,
  Clock3,
  Sparkles,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useSettings } from "@/lib/settings";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

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

const profileItems = [
  { title: "Equipamento", url: "/profiles/equipamento", icon: Wrench },
  { title: "Mostura", url: "/profiles/mostura", icon: CookingPot },
  { title: "Fermentação", url: "/profiles/fermentacao", icon: Thermometer },
  { title: "Água", url: "/profiles/agua", icon: Droplets },
  { title: "Estilos Personalizados", url: "/profiles/estilos", icon: BookOpen },
];

export function AppSidebar() {
  const location = useLocation();
  const [settings] = useSettings();
  const isEnglish = settings.language === "en-US";
  const t = (pt: string, en: string) => (isEnglish ? en : pt);

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

  const profileItems = [
    { title: t("Equipamento", "Equipment"), url: "/profiles/equipamento", icon: Wrench },
    { title: t("Mostura", "Mash"), url: "/profiles/mostura", icon: CookingPot },
    { title: t("Fermentação", "Fermentation"), url: "/profiles/fermentacao", icon: Thermometer },
    { title: t("Água", "Water"), url: "/profiles/agua", icon: Droplets },
    { title: t("Estilos Personalizados", "Custom Styles"), url: "/profiles/estilos", icon: BookOpen },
  ];

  const getNavClassName = (path: string) => {
    const isActive = location.pathname === path;
    return isActive
      ? "bg-primary text-primary-foreground font-medium shadow-brew"
      : "hover:bg-muted text-muted-foreground hover:text-foreground";
  };

  const profilesActive = location.pathname.startsWith("/profiles");

  return (
    <Sidebar className="border-r border-border bg-[#edf3fb] text-slate-800 dark:bg-[#171b20] dark:text-[#eaf1ff]">
      <SidebarContent className="p-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-slate-500 dark:text-[#d9e7ff]/70 font-medium">{t("Principal", "Main")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.filter(item => item.url !== "/inventory" || settings.inventory).map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
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
                  <NavLink to="/profiles/equipamento" className={profilesActive ? "bg-primary text-primary-foreground font-medium shadow-brew" : "hover:bg-muted text-muted-foreground hover:text-foreground"}>
                    <Layers className="h-4 w-4" />
                    <span>{t("Perfis", "Profiles")}</span>
                  </NavLink>
                </SidebarMenuButton>
                {profilesActive && (
                  <SidebarMenuSub>
                    {profileItems.map((item) => (
                      <SidebarMenuSubItem key={item.title}>
                        <SidebarMenuSubButton asChild isActive={location.pathname === item.url}>
                          <NavLink to={item.url}>
                            <item.icon className="h-3.5 w-3.5" />
                            <span>{item.title}</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
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
                    to="/settings#cloud-sync"
                    className={getNavClassName("/settings")}
                  >
                    <Cloud className="h-4 w-4" />
                    <span>{t("Nuvem e sincronização", "Cloud & sync")}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
