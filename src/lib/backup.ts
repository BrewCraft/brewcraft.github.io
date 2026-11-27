import { read } from "./store";
import { readSettings, saveSettings } from "./settings";
import { defaultSettings, normalizeSettings } from "./settings-model";

export const storageKeys: Record<string, string> = {
  receitas: "brewfather-recipes", lotes: "brewfather-batches", inventário: "brewfather-inventory",
  "perfil-equipamento": "brewfather-profiles-equipamento", "perfil-mostura": "brewfather-profiles-mostura",
  "perfil-fermentacao": "brewfather-profiles-fermentacao", "perfil-agua": "brewfather-profiles-agua", "perfil-estilos": "brewfather-profiles-estilos",
  "alertas-config": "brewfather-alert-configs", "alertas-historico": "brewfather-alert-history", "temporizadores": "brewfather-timers",
};

export const CALCULATOR_FAVORITES_KEY = "brewfather-calculator-favorites";

function sanitizeFavorites(items: unknown[]): string[] {
  return Array.from(
    new Set(
      items
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
}

export function readCalculatorFavorites(): string[] {
  try {
    const raw = localStorage.getItem(CALCULATOR_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sanitizeFavorites(parsed) : [];
  } catch {
    return [];
  }
}

export function saveCalculatorFavorites(favorites: string[], emit = true): string[] {
  const sanitized = sanitizeFavorites(favorites);
  localStorage.setItem(CALCULATOR_FAVORITES_KEY, JSON.stringify(sanitized));
  if (emit) {
    window.dispatchEvent(new CustomEvent("brewfather-store", { detail: "calculator-favorites" }));
  }
  return sanitized;
}

export type BackupData = Record<string, unknown[]>;
export function readBackupData(): BackupData {
  return Object.fromEntries(Object.entries(storageKeys).map(([name, key]) => {
    if (name === "receitas") return [name, read("recipes")];
    if (name === "lotes") return [name, read("batches")];
    if (name === "inventário") return [name, read("inventory")];
    try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return [name, Array.isArray(value) ? value : []]; } catch { return [name, []]; }
  }));
}
export const makeBackup = () => {
  const currentSettings = readSettings();
  // Regra de segurança/privacidade: geminiApiKey nunca deve constar no JSON exportado
  const { geminiApiKey: _omittedKey, ...safeSettings } = currentSettings;
  return {
    app: "brewcraft-web",
    version: 2,
    exportedAt: new Date().toISOString(),
    data: readBackupData(),
    settings: safeSettings,
    calculatorFavorites: readCalculatorFavorites(),
  };
};
export type BackupPayload = ReturnType<typeof makeBackup>;
const HISTORY = "brewfather-backup-history";
export function readHistory(): { id: string; label: string; payload: BackupPayload }[] {
  try { const value = JSON.parse(localStorage.getItem(HISTORY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
export function snapshot(label: string) {
  const history = [{ id: crypto.randomUUID(), label, payload: makeBackup() }, ...readHistory()].slice(0, 5);
  localStorage.setItem(HISTORY, JSON.stringify(history));
}
export function restoreBackup(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Backup inválido");
  const input = value as Record<string, unknown>;
  const data = (input.data ?? input) as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Backup inválido");
  const entries = Object.entries(storageKeys).filter(([name]) => Array.isArray(data[name]));
  if (!entries.length) throw new Error("Backup inválido");
  for (const [name] of entries) {
    const list = data[name] as unknown[];
    if (list.some(item => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("Backup inválido");
  }
  snapshot("Antes da restauração");
  for (const [name, key] of entries) localStorage.setItem(key, JSON.stringify(data[name]));

  // Restaura configurações preservando integralmente a chave Gemini local do navegador
  if (input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)) {
    const localSettings = readSettings();
    const localApiKey = localSettings.geminiApiKey || "";
    const normalized = normalizeSettings(input.settings);
    // Preserva a chave local contra sobrescrita por chave de terceiros ou remoção acidental
    normalized.geminiApiKey = localApiKey;
    saveSettings(normalized);
  }

  // Restaura favoritos das calculadoras se existirem no backup e forem válidos
  const rawFavs = input.calculatorFavorites ?? (data.calculatorFavorites as unknown);
  if (rawFavs !== undefined) {
    if (Array.isArray(rawFavs) && rawFavs.every(item => typeof item === "string")) {
      saveCalculatorFavorites(rawFavs, false);
    }
    // Se a estrutura for inválida, não grava no localStorage para proteger a integridade
  }

  window.dispatchEvent(new CustomEvent("brewfather-store"));
  return entries.length;
}
export function clearData(options?: { resetSettings?: boolean }) {
  snapshot("Antes de apagar os dados");
  for (const key of Object.values(storageKeys)) localStorage.setItem(key, "[]");
  localStorage.setItem(CALCULATOR_FAVORITES_KEY, "[]");
  if (options?.resetSettings) {
    saveSettings(defaultSettings);
  }
  window.dispatchEvent(new CustomEvent("brewfather-store"));
}