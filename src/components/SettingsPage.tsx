import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Upload, Trash2, Database, CheckCircle2, SlidersHorizontal, Cloud, RefreshCw } from "lucide-react";
import SettingsPreferences from "@/components/SettingsPreferences";
import { defaultSettings, normalizeSettings } from "@/lib/settings-model";
import { readSettings, saveSettings } from "@/lib/settings";
import { restoreBackup } from "@/lib/backup";
import {
  cloudProviderLabels,
  connectProvider,
  disconnectProvider,
  getConnectedProviderAccountName,
  getProviderConnectionStatus,
  readCloudSyncConfig,
  resolveCloudConflict,
  saveCloudSyncConfig,
  supportedCloudProviders,
  syncCloudData,
  type CloudProvider,
} from "@/lib/cloud-sync";

const STORAGE_KEYS = {
  receitas: "brewfather-recipes",
  lotes: "brewfather-batches",
  "inventário": "brewfather-inventory",
  "perfil-equipamento": "brewfather-profiles-equipamento",
  "perfil-mostura": "brewfather-profiles-mostura",
  "perfil-fermentacao": "brewfather-profiles-fermentacao",
  "perfil-agua": "brewfather-profiles-agua",
  "perfil-estilos": "brewfather-profiles-estilos",
} as const;

type Backup = Record<string, unknown[]>;

const readAll = (): Backup => {
  const data: Backup = {};
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      data[name] = raw === null ? [] : (JSON.parse(raw) as unknown[]);
    } catch {
      data[name] = [];
    }
  }
  return data;
};

const writeAll = (data: Backup) => {
  const known = new Set(Object.values(STORAGE_KEYS));
  for (const [name, value] of Object.entries(data)) {
    const key = (STORAGE_KEYS as Record<string, string>)[name];
    if (key && Array.isArray(value)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }
  for (const key of known) {
    window.dispatchEvent(new CustomEvent("brewfather-store", { detail: key.replace("brewfather-", "") }));
  }
};

const PROVIDERS: CloudProvider[] = supportedCloudProviders;

export default function SettingsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const [counts, setCounts] = useState(readAll);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<CloudProvider>("dropbox");
  const [cloudConfig, setCloudConfig] = useState<ReturnType<typeof readCloudSyncConfig>>(() => readCloudSyncConfig("dropbox"));
  const [draftCloudConfig, setDraftCloudConfig] = useState<ReturnType<typeof readCloudSyncConfig>>(() => readCloudSyncConfig("dropbox"));
  const [cloudSyncMsg, setCloudSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncConflict, setSyncConflict] = useState<{ provider?: CloudProvider; [key: string]: unknown } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("brewfather-cloud-conflict");
      setSyncConflict(raw ? JSON.parse(raw) : null);
    } catch {
      setSyncConflict(null);
    }
  }, []);

  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [location.hash]);

  useEffect(() => {
    const next = readCloudSyncConfig(selectedProvider);
    setDraftCloudConfig(next);
    setCloudConfig(next);
  }, [selectedProvider]);

  const updateCloudConfig = (patch: Partial<typeof draftCloudConfig>) => {
    setDraftCloudConfig((prev) => ({ ...prev, ...patch }));
  };

  const refreshCloudConfig = () => {
    const next = readCloudSyncConfig(selectedProvider);
    setCloudConfig(next);
    setDraftCloudConfig(next);
  };

  const handleSaveCloudConfig = () => {
    const next = saveCloudSyncConfig({ ...draftCloudConfig, provider: selectedProvider, enabled: draftCloudConfig.enabled });
    setCloudConfig(next);
    setDraftCloudConfig(next);

    if (!next.enabled) {
      setCloudSyncMsg({ ok: true, text: "Configuração da nuvem salva. A sincronização foi desativada." });
      return;
    }

    setCloudSyncMsg({ ok: true, text: `Configuração salva para ${cloudProviderLabels[selectedProvider]}.` });
  };

  const handleConnectProvider = async (provider: CloudProvider) => {
    try {
      const session = await connectProvider(provider);
      const next = readCloudSyncConfig(provider);
      setSelectedProvider(provider);
      setCloudConfig(next);
      setDraftCloudConfig(next);
      setCloudSyncMsg({ ok: true, text: `Conectado ao ${cloudProviderLabels[provider]} como ${session.accountName ?? "sua conta"}.` });
    } catch (error) {
      setCloudSyncMsg({ ok: false, text: error instanceof Error ? error.message : `Não foi possível conectar ao ${cloudProviderLabels[provider]}.` });
    }
  };

  const handleDisconnectProvider = async (provider: CloudProvider) => {
    try {
      await disconnectProvider(provider);
      refreshCloudConfig();
      setCloudSyncMsg({ ok: true, text: `Conexão com ${cloudProviderLabels[provider]} encerrada.` });
    } catch (error) {
      setCloudSyncMsg({ ok: false, text: error instanceof Error ? error.message : `Não foi possível desconectar o ${cloudProviderLabels[provider]}.` });
    }
  };

  const handleSyncProvider = async (provider: CloudProvider) => {
    const next = saveCloudSyncConfig({ ...readCloudSyncConfig(provider), provider, enabled: true });
    setCloudConfig(next);
    setDraftCloudConfig(next);
    setSelectedProvider(provider);

    try {
      const result = await syncCloudData(provider);
      try {
        const raw = localStorage.getItem("brewfather-cloud-conflict");
        setSyncConflict(raw ? JSON.parse(raw) : null);
      } catch {
        setSyncConflict(null);
      }
      setCloudSyncMsg({ ok: true, text: `Sincronização com ${cloudProviderLabels[provider]}: ${result.message}` });
    } catch (error) {
      setCloudSyncMsg({ ok: false, text: error instanceof Error ? error.message : `Não foi possível sincronizar com ${cloudProviderLabels[provider]}.` });
    }
  };

  const totalItems = Object.values(counts).reduce((sum, list) => sum + list.length, 0);

  const exportData = () => {
    const payload = {
      app: "brewcraft-web",
      version: 2,
      exportedAt: new Date().toISOString(),
      data: readAll(),
      settings: readSettings(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "brewcraft-backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setImportMsg({ ok: true, text: "Backup exportado com sucesso." });
  };

  const importData = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const data = (parsed.data ?? parsed) as Record<string, unknown>;
      const keys = Object.keys(data).filter((k) => k in STORAGE_KEYS && Array.isArray(data[k]));
      if (keys.length === 0) {
        setImportMsg({ ok: false, text: "Arquivo não parece um backup do BrewCraft. Nada foi alterado." });
        return;
      }
      if (parsed.settings && typeof parsed.settings === "object") {
        saveSettings(normalizeSettings(parsed.settings));
      }
      writeAll(data as Backup);
      setCounts(readAll());
      setImportMsg({ ok: true, text: `Backup restaurado: ${keys.length} seções importadas.` });
    } catch {
      setImportMsg({ ok: false, text: "Não consegui ler o arquivo. Verifique se é um backup .json válido." });
    }
  };

  const clearAll = () => {
    if (!window.confirm("Apagar TODOS os dados deste navegador (receitas, lotes, inventário, perfis e preferências)? Recomendo exportar um backup antes.")) return;
    writeAll(Object.fromEntries(Object.keys(STORAGE_KEYS).map((k) => [k, []])));
    saveSettings(defaultSettings);
    setCounts(readAll());
    setImportMsg({ ok: true, text: "Todos os dados foram apagados." });
  };

  const labels: Record<string, string> = {
    receitas: "Receitas",
    lotes: "Lotes",
    "inventário": "Itens de inventário",
    "perfil-equipamento": "Perfis de equipamento",
    "perfil-mostura": "Perfis de mostura",
    "perfil-fermentacao": "Perfis de fermentação",
    "perfil-agua": "Perfis de água",
    "perfil-estilos": "Estilos personalizados",
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Configurações</h1>
        <p className="text-muted-foreground">Gerencie seus dados: backup, restauração, limpeza e sincronização em nuvem.</p>
      </div>

      <Card className="shadow-foam border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Database className="h-5 w-5 text-accent" />
            Seus dados neste navegador
          </CardTitle>
          <CardDescription>
            {totalItems} itens salvos no total. Os dados ficam apenas neste navegador — exporte um backup para não perder nada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {Object.keys(STORAGE_KEYS).map((name) => (
              <div key={name} className="flex items-center justify-between rounded-md border border-border px-3 py-2 bg-background">
                <dt className="text-muted-foreground">{labels[name]}</dt>
                <dd className="font-medium text-foreground">{counts[name]?.length ?? 0}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card className="shadow-foam border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <SlidersHorizontal className="h-5 w-5 text-accent" />
            Preferências
          </CardTitle>
          <CardDescription>Configure tema, fórmulas, unidades, impressão de datas e comportamento do app.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsPreferences />
        </CardContent>
      </Card>

      <Card id="cloud-sync" className="shadow-foam border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Cloud className="h-5 w-5 text-accent" />
            Nuvem e sincronização
          </CardTitle>
          <CardDescription>Conecte diretamente ao Dropbox, Google Drive ou OneDrive sem servidor próprio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            {PROVIDERS.map((provider) => {
              const status = getProviderConnectionStatus(provider);
              const connectedName = getConnectedProviderAccountName(provider) ?? "Não conectada";
              const isSelected = selectedProvider === provider;
              return (
                <div
                  key={provider}
                  className={`cursor-pointer rounded-md border p-3 transition-colors ${isSelected ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}
                  onClick={() => setSelectedProvider(provider)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{cloudProviderLabels[provider]}</span>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${status.connected ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300"}`}>
                      {status.connected ? "Conectado" : "Desconectado"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Conta: {connectedName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Última sincronização: {status.lastSync ? new Date(status.lastSync).toLocaleString() : "Nunca"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Resultado: {status.lastSyncStatus}</p>
                  <div className="mt-3 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                    {!status.connected ? (
                      <Button size="sm" variant="outline" onClick={() => void handleConnectProvider(provider)}>
                        Conectar
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => void handleDisconnectProvider(provider)}>
                        Desconectar
                      </Button>
                    )}
                    <Button size="sm" variant="default" onClick={() => void handleSyncProvider(provider)}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Sincronizar
                    </Button>
                  </div>

                  {syncConflict && syncConflict.provider === provider && (
                    <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                      <p className="font-medium">Conflito detectado: Já existe um backup na nuvem. Qual versão você deseja manter?</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await resolveCloudConflict(provider, "local-wins");
                            setSyncConflict(null);
                          }}
                        >
                          Manter local
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={async () => {
                            await resolveCloudConflict(provider, "remote-wins");
                            setSyncConflict(null);
                          }}
                        >
                          Manter nuvem
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Provedor ativo</Label>
              <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium">
                {cloudProviderLabels[selectedProvider]}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloud-enabled">Estado</Label>
              <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 py-2 text-sm">
                {draftCloudConfig.enabled ? "Sincronização ativada" : "Sincronização desativada"}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cloud-folder">Pasta</Label>
              <Input
                id="cloud-folder"
                value={draftCloudConfig.folder}
                onChange={(event) => updateCloudConfig({ folder: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cloud-file">Arquivo de sincronização</Label>
              <Input
                id="cloud-file"
                value={draftCloudConfig.fileName}
                onChange={(event) => updateCloudConfig({ fileName: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant={draftCloudConfig.enabled ? "default" : "outline"}
              onClick={() => {
                const next = { ...draftCloudConfig, provider: selectedProvider, enabled: true };
                setDraftCloudConfig(next);
                saveCloudSyncConfig(next);
                setCloudConfig(next);
                setCloudSyncMsg({ ok: true, text: `Sincronização ativada para ${cloudProviderLabels[selectedProvider]}.` });
              }}
            >
              Ativar sincronização
            </Button>
            <Button
              variant={!draftCloudConfig.enabled ? "default" : "outline"}
              onClick={() => {
                const next = { ...draftCloudConfig, provider: selectedProvider, enabled: false };
                setDraftCloudConfig(next);
                saveCloudSyncConfig(next);
                setCloudConfig(next);
                setCloudSyncMsg({ ok: true, text: `Sincronização desativada para ${cloudProviderLabels[selectedProvider]}.` });
              }}
            >
              Desativar
            </Button>
            <Button onClick={() => handleSaveCloudConfig()} className="bg-gradient-primary hover:bg-primary-glow text-primary-foreground shadow-brew">
              Salvar
            </Button>
          </div>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {cloudConfig.enabled && cloudConfig.token
              ? `Status: ${cloudConfig.lastSyncStatus || "pronto para sincronizar"}. Arquivo remoto: ${cloudConfig.folder}/${cloudConfig.fileName}`
              : "Ative a sincronização e conecte um provedor para sincronizar os dados."}
          </div>

          {cloudSyncMsg && (
            <div
              role="status"
              className={
                cloudSyncMsg.ok
                  ? "mt-3 flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-900 dark:text-emerald-200"
                  : "mt-3 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-900 dark:text-red-200"
              }
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{cloudSyncMsg.text}</span>
            </div>
          )}

        </CardContent>
      </Card>

      <Card className="shadow-foam border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Download className="h-5 w-5 text-accent" />
            Backup
          </CardTitle>
          <CardDescription>Baixe um arquivo com todas as suas receitas, lotes, inventário, perfis e preferências.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={exportData} className="bg-gradient-primary hover:bg-primary-glow text-primary-foreground shadow-brew">
            <Download className="h-4 w-4 mr-2" />
            Exportar backup (.json)
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Restaurar backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importData(file);
              event.target.value = "";
            }}
          />
        </CardContent>
      </Card>

      {importMsg && (
        <div
          role="status"
          className={
            importMsg.ok
              ? "flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm text-foreground"
              : "flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
          }
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {importMsg.text}
        </div>
      )}

      <Card className="shadow-foam border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Zona de perigo
          </CardTitle>
          <CardDescription>Apaga tudo de uma vez. Não dá para desfazer.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={clearAll}>
            <Trash2 className="h-4 w-4 mr-2" />
            Apagar todos os dados
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
