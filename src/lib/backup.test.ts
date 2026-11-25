/// <reference types="node" />
import { strict as assert } from "node:assert";
import { beforeEach, describe, test } from "node:test";
import {
  CALCULATOR_FAVORITES_KEY,
  clearData,
  makeBackup,
  readCalculatorFavorites,
  readHistory,
  restoreBackup,
  saveCalculatorFavorites,
  snapshot,
  storageKeys,
} from "./backup";
import { readSettings, saveSettings, SETTINGS_EVENT } from "./settings";
import { defaultSettings } from "./settings-model";

const memoryStore = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (k: string) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
  setItem: (k: string, v: string) => { memoryStore.set(k, String(v)); },
  removeItem: (k: string) => { memoryStore.delete(k); },
  clear: () => memoryStore.clear(),
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
  get length() { return memoryStore.size; },
};

type WindowListener = (event: { type: string; detail?: unknown }) => void;
const windowListeners = new Map<string, Set<WindowListener>>();
const dispatchedEvents: Array<{ type: string; detail?: unknown }> = [];

(globalThis as unknown as { localStorage: Storage }).localStorage = localStorageMock;
(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: (event: { type: string; detail?: unknown }) => {
    const entry = { type: event.type, detail: event.detail };
    dispatchedEvents.push(entry);
    for (const listener of windowListeners.get(event.type) ?? []) {
      listener(entry);
    }
    return true;
  },
  addEventListener: (type: string, listener: WindowListener) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(listener);
  },
  removeEventListener: (type: string, listener: WindowListener) => {
    windowListeners.get(type)?.delete(listener);
  },
  localStorage: localStorageMock,
};
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const { write: writeStore } = await import("./store");

describe("Backup e Restauração com Integridade e Segurança", () => {
  beforeEach(() => {
    memoryStore.clear();
    windowListeners.clear();
    dispatchedEvents.length = 0;
    // Preenche as 8 coleções com dados básicos
    for (const [, key] of Object.entries(storageKeys)) {
      localStorageMock.setItem(key, JSON.stringify([{ id: "test-item" }]));
    }
  });

  test("1. Exportação inclui as oito coleções existentes", () => {
    const backup = makeBackup();
    assert.ok(backup.data, "Deveria conter data");
    for (const collection of Object.keys(storageKeys)) {
      assert.ok(Array.isArray(backup.data[collection]), `Coleção ${collection} deveria ser array`);
      assert.equal(backup.data[collection].length, 1);
    }
  });

  test("2. Exportação inclui os favoritos das calculadoras", () => {
    localStorageMock.setItem(CALCULATOR_FAVORITES_KEY, JSON.stringify(["alcohol", "ibu", "dilution"]));
    const backup = makeBackup();
    assert.deepEqual(backup.calculatorFavorites, ["alcohol", "ibu", "dilution"]);
  });

  test("3. Exportação não contém geminiApiKey, inclusive em verificações do JSON completo", () => {
    saveSettings({ ...defaultSettings, geminiApiKey: "segredo-super-confidencial" });
    const backup = makeBackup();

    // Verificação tipada
    assert.equal((backup.settings as Record<string, unknown>).geminiApiKey, undefined);

    // Verificação no JSON serializado completo
    const jsonStr = JSON.stringify(backup);
    assert.equal(jsonStr.includes("segredo-super-confidencial"), false, "A chave não pode constar no JSON exportado");
    assert.equal(jsonStr.includes("geminiApiKey"), false, "A propriedade geminiApiKey não deve constar no JSON");
  });

  test("4. Exportação não altera a chave original armazenada no navegador", () => {
    saveSettings({ ...defaultSettings, geminiApiKey: "minha-chave-local" });
    makeBackup();
    const current = readSettings();
    assert.equal(current.geminiApiKey, "minha-chave-local", "A chave no navegador não deve ser alterada durante exportação");
  });

  test("5. Restauração recupera corretamente os favoritos", () => {
    const payload = {
      app: "brewcraft-web",
      version: 2,
      data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "rec-1" }]])),
      settings: { ...defaultSettings },
      calculatorFavorites: ["refratometro", "strike-water"],
    };
    restoreBackup(payload);
    const favs = readCalculatorFavorites();
    assert.deepEqual(favs, ["refratometro", "strike-water"]);
  });

  test("6. Restauração de backup antigo sem favoritos preserva os favoritos atuais", () => {
    localStorageMock.setItem(CALCULATOR_FAVORITES_KEY, JSON.stringify(["alcohol", "carbonation"]));
    const oldBackup = {
      app: "brewcraft-web",
      version: 1,
      data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "rec-1" }]])),
      settings: { ...defaultSettings },
    };
    restoreBackup(oldBackup);
    const favs = readCalculatorFavorites();
    assert.deepEqual(favs, ["alcohol", "carbonation"], "Favoritos existentes devem ser preservados");
  });

  test("7. Restauração preserva a chave Gemini local quando o backup não contém chave", () => {
    saveSettings({ ...defaultSettings, geminiApiKey: "chave-local-existente" });
    const backupSemChave = {
      app: "brewcraft-web",
      version: 2,
      data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "rec-1" }]])),
      settings: { ...defaultSettings }, // sem geminiApiKey
    };
    restoreBackup(backupSemChave);
    const current = readSettings();
    assert.equal(current.geminiApiKey, "chave-local-existente");
  });

  test("8. Restauração preserva a chave Gemini local quando o backup contém outra chave", () => {
    saveSettings({ ...defaultSettings, geminiApiKey: "chave-local-intocavel" });
    const backupComChaveDeTerceiro = {
      app: "brewcraft-web",
      version: 2,
      data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "rec-1" }]])),
      settings: { ...defaultSettings, geminiApiKey: "chave-de-outra-pessoa" },
    };
    restoreBackup(backupComChaveDeTerceiro);
    const current = readSettings();
    assert.equal(current.geminiApiKey, "chave-local-intocavel", "Chave local não pode ser sobrescrita por chave de backup");
  });

  test("9. Restauração funciona com backup antigo sem settings", () => {
    saveSettings({ ...defaultSettings, geminiApiKey: "chave-local-persistente", theme: "dark" });
    const legacyBackup = {
      data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "rec-legacy" }]])),
    };
    const count = restoreBackup(legacyBackup);
    assert.equal(count, Object.keys(storageKeys).length);
    const current = readSettings();
    assert.equal(current.geminiApiKey, "chave-local-persistente");
    assert.equal(current.theme, "dark");
  });

  test("10. Normalização das configurações continua funcionando", () => {
    const backupComSettingsIncompletas = {
      data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "rec-1" }]])),
      settings: { theme: "light" }, // faltam vários campos
    };
    restoreBackup(backupComSettingsIncompletas);
    const current = readSettings();
    assert.equal(current.theme, "light");
    assert.equal(current.temperature, "°C");
    assert.equal(current.volume, "L");
    assert.equal(current.gravity, "sg");
  });

  test("11. Dados inválidos de favoritos não são gravados", () => {
    localStorageMock.setItem(CALCULATOR_FAVORITES_KEY, JSON.stringify(["alcohol"]));
    const backupInvalido = {
      data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "rec-1" }]])),
      calculatorFavorites: [{ invalid: "not-a-string-array" }, 12345],
    };
    restoreBackup(backupInvalido);
    assert.deepEqual(readCalculatorFavorites(), ["alcohol"], "Favoritos originais mantidos após tentativa com dados inválidos");

    const backupComTipoErrado = {
      data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "rec-1" }]])),
      calculatorFavorites: "alcohol",
    };
    restoreBackup(backupComTipoErrado);
    assert.deepEqual(readCalculatorFavorites(), ["alcohol"], "String não-array também deve ser ignorada");
  });

  test("12. clearData() limpa favoritos e coleções, gera snapshot pré-limpeza e preserva settings locais", () => {
    saveSettings({ ...defaultSettings, geminiApiKey: "chave-local-nao-apagada", theme: "light" });
    localStorageMock.setItem(CALCULATOR_FAVORITES_KEY, JSON.stringify(["alcohol", "ibu"]));
    clearData();
    const favs = readCalculatorFavorites();
    assert.deepEqual(favs, [], "clearData deve esvaziar a lista de favoritos");
    for (const key of Object.values(storageKeys)) {
      assert.equal(localStorageMock.getItem(key), "[]");
    }
    const history = readHistory();
    assert.equal(history[0]?.label, "Antes de apagar os dados");
    assert.deepEqual(history[0]?.payload.calculatorFavorites, ["alcohol", "ibu"]);
    assert.equal(readSettings().geminiApiKey, "chave-local-nao-apagada");
  });

  test("13. Favoritos: eventos compatíveis entre store.ts, backup.ts e sincronização sem sobrescrita na montagem", () => {
    localStorageMock.setItem(CALCULATOR_FAVORITES_KEY, JSON.stringify(["alcohol", "ibu"]));

    // Simula o ciclo de montagem/escuta de CalculatorsPage.tsx sem gravar na montagem
    let writeCallsOnFavorites = 0;
    const originalSetItem = localStorageMock.setItem;
    localStorageMock.setItem = (k: string, v: string) => {
      if (k === CALCULATOR_FAVORITES_KEY) writeCallsOnFavorites += 1;
      originalSetItem(k, v);
    };

    try {
      let uiFavorites = readCalculatorFavorites();
      const syncFavorites = () => {
        const next = readCalculatorFavorites();
        const same = uiFavorites.length === next.length && uiFavorites.every((item, i) => item === next[i]);
        if (!same) uiFavorites = next;
      };
      (globalThis.window as Window).addEventListener("brewfather-store", syncFavorites as EventListener);
      (globalThis.window as Window).addEventListener("storage", syncFavorites as EventListener);

      assert.equal(writeCallsOnFavorites, 0, "Montagem e registro de listeners não devem gravar favoritos");
      assert.deepEqual(uiFavorites, ["alcohol", "ibu"]);

      // Evento emitido pelo store.ts é compatível e não altera nem sobrescreve favoritos
      dispatchedEvents.length = 0;
      writeStore("recipes", []);
      assert.deepEqual(
        dispatchedEvents.filter(e => e.type === "brewfather-store"),
        [{ type: "brewfather-store", detail: "recipes" }]
      );
      assert.deepEqual(uiFavorites, ["alcohol", "ibu"]);
      assert.equal(writeCallsOnFavorites, 0);

      // Alteração local via saveCalculatorFavorites persiste, sanitiza e sincroniza na mesma aba
      dispatchedEvents.length = 0;
      const saved = saveCalculatorFavorites(["carbonation", "alcohol", "alcohol", "  "]);
      assert.deepEqual(saved, ["carbonation", "alcohol"]);
      assert.deepEqual(uiFavorites, ["carbonation", "alcohol"]);
      assert.deepEqual(
        dispatchedEvents.filter(e => e.type === "brewfather-store"),
        [{ type: "brewfather-store", detail: "calculator-favorites" }]
      );

      // Restauração de backup atualiza favoritos e dispara um único evento brewfather-store
      dispatchedEvents.length = 0;
      restoreBackup({
        app: "brewcraft-web",
        version: 2,
        data: Object.fromEntries(Object.keys(storageKeys).map(k => [k, [{ id: "restored-1" }]])),
        calculatorFavorites: ["mash_ph", "water"],
      });
      assert.equal(dispatchedEvents.filter(e => e.type === "brewfather-store").length, 1);
      assert.deepEqual(uiFavorites, ["mash_ph", "water"]);

      // Remoção local de todos os favoritos persiste lista vazia e reflete imediatamente
      saveCalculatorFavorites([]);
      assert.deepEqual(readCalculatorFavorites(), []);
      assert.deepEqual(uiFavorites, []);

      // Evento storage (outra aba) também sincroniza corretamente
      localStorageMock.setItem(CALCULATOR_FAVORITES_KEY, JSON.stringify(["dilution"]));
      (globalThis.window as Window).dispatchEvent(new Event("storage"));
      assert.deepEqual(uiFavorites, ["dilution"]);

      // Limpeza de dados remove favoritos e atualiza via evento
      dispatchedEvents.length = 0;
      clearData();
      assert.equal(dispatchedEvents.filter(e => e.type === "brewfather-store").length, 1);
      assert.deepEqual(readCalculatorFavorites(), []);
      assert.deepEqual(uiFavorites, []);
    } finally {
      localStorageMock.setItem = originalSetItem;
    }
  });

  test("14. Limpeza total (resetSettings: true) apaga coleções, favoritos, restaura defaultSettings, limpa geminiApiKey e preserva histórico/nuvem", () => {
    saveSettings({
      ...defaultSettings,
      theme: "light",
      language: "en-US",
      abvFormula: "alternative",
      geminiApiKey: "chave-que-deve-ser-removida-na-limpeza-total",
    });
    localStorageMock.setItem(CALCULATOR_FAVORITES_KEY, JSON.stringify(["alcohol", "ibu"]));
    localStorageMock.setItem("brewfather-cloud-sync-dropbox", JSON.stringify({ provider: "dropbox", enabled: false }));
    snapshot("Snapshot anterior");

    let syncedFavorites = readCalculatorFavorites();
    let syncedSettings = readSettings();
    const onStore = () => { syncedFavorites = readCalculatorFavorites(); };
    const onSettings = () => { syncedSettings = readSettings(); };
    (globalThis.window as Window).addEventListener("brewfather-store", onStore as EventListener);
    (globalThis.window as Window).addEventListener(SETTINGS_EVENT, onSettings as EventListener);

    dispatchedEvents.length = 0;
    clearData({ resetSettings: true });

    // 1. Todas as 8 coleções previstas ficam vazias
    for (const key of Object.values(storageKeys)) {
      assert.equal(localStorageMock.getItem(key), "[]");
    }

    // 2. Favoritos das calculadoras removidos
    assert.equal(localStorageMock.getItem(CALCULATOR_FAVORITES_KEY), "[]");
    assert.deepEqual(readCalculatorFavorites(), []);

    // 3 e 4. Configurações restauradas para defaultSettings e geminiApiKey limpa
    assert.deepEqual(readSettings(), defaultSettings);
    assert.equal(readSettings().geminiApiKey, "");

    // 5. Dados históricos permanecem (snapshot pré-limpeza + snapshot anterior) e integração em nuvem intocada
    const history = readHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0]?.label, "Antes de apagar os dados");
    assert.deepEqual(history[0]?.payload.calculatorFavorites, ["alcohol", "ibu"]);
    assert.equal((history[0]?.payload.settings as Record<string, unknown>).geminiApiKey, undefined);
    assert.equal(history[1]?.label, "Snapshot anterior");
    assert.ok(localStorageMock.getItem("brewfather-cloud-sync-dropbox"));

    // 6. Eventos necessários disparados para atualizar interface sem duplicação
    assert.equal(dispatchedEvents.filter(e => e.type === "brewfather-store").length, 1);
    assert.equal(dispatchedEvents.filter(e => e.type === SETTINGS_EVENT).length, 1);
    assert.deepEqual(syncedFavorites, []);
    assert.deepEqual(syncedSettings, defaultSettings);
  });
});
