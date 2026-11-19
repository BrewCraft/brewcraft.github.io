import { useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, Trash2, Database, CheckCircle2, SlidersHorizontal } from "lucide-react";
import SettingsPreferences from "@/components/SettingsPreferences";
import { defaultSettings } from "@/lib/settings-model";
import { saveSettings } from "@/lib/settings";
import { makeBackup, restoreBackup } from "@/lib/backup";


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

export default function SettingsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState(readAll);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const totalItems = Object.values(counts).reduce((sum, list) => sum + list.length, 0);

  const exportData = () => {
    const payload = makeBackup();
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
      const parsed = JSON.parse(text) as unknown;
      const restored = restoreBackup(parsed);
      setCounts(readAll());
      setImportMsg({ ok: true, text: `Backup restaurado com segurança: ${restored} seções validadas.` });
    } catch (e) {
      setImportMsg({ ok: false, text: e instanceof Error ? e.message : "Não consegui restaurar o backup. Nada foi alterado." });
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
