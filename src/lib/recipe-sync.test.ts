/// <reference types="node" />
import { strict as assert } from "node:assert";
import { beforeEach, describe, test } from "node:test";
import {
  defaultEquipment,
  hasRecipeChanged,
  isExternalRecipeDifferent,
  type Recipe,
} from "./recipe-calc";
import {
  buildSavedRecipe,
  resolveExternalRecipeUpdate,
  validateRecipeSave,
} from "./recipe-sync";

const memoryStore = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (k: string) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
  setItem: (k: string, v: string) => { memoryStore.set(k, String(v)); },
  removeItem: (k: string) => { memoryStore.delete(k); },
  clear: () => memoryStore.clear(),
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
  get length() { return memoryStore.size; },
};

(globalThis as unknown as { localStorage: Storage }).localStorage = localStorageMock;
(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
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

const { read, write } = await import("./store");

const makeRecipe = (id = "r-sync-1", name = "Test Recipe"): Recipe => ({
  id,
  name,
  styleCode: "18B",
  author: "Brewer",
  notes: "Nota inicial",
  equipment: { ...defaultEquipment, batchL: 20 },
  mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
  fermentationTempC: 19,
  fermentationDays: 14,
  fermentables: [
    { id: "f1", name: "Pilsen", kg: 4, potential: 1.037, color: 3.5, type: "grao", price: 20 },
  ],
  hops: [
    { id: "h1", name: "Cascade", grams: 30, alpha: 5.5, minutes: 60, use: "fervura", price: 250 },
  ],
  yeasts: [
    { id: "y1", name: "US-05", attenuation: 80, packs: 1, price: 35 },
  ],
  miscs: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: "1.0",
  versionHistory: [],
});

/**
 * Harness que executa diretamente as funções de produção (`resolveExternalRecipeUpdate`,
 * `validateRecipeSave`, `buildSavedRecipe`) contra o `store` real (`read`/`write`).
 */
class RecipeFormSyncHarness {
  currentId: string | undefined;
  existing: boolean;
  r: Recipe;
  initialRecipe: Recipe;
  externalConflict = false;
  conflictAcknowledged = false;
  latestExternalVersion: Recipe | null = null;
  acknowledgedExternal: Recipe | null = null;

  constructor(id?: string) {
    this.currentId = id;
    const isNew = !id || id === "new";
    const stored = !isNew ? read("recipes").find((x) => x.id === id) : undefined;
    this.existing = Boolean(stored);
    const fresh = stored ? structuredClone(stored) : makeRecipe("new-id", "Nova Receita");
    this.r = structuredClone(fresh);
    this.initialRecipe = structuredClone(fresh);
  }

  isDirty(): boolean {
    return hasRecipeChanged(this.initialRecipe, this.r);
  }

  syncWithStore(recipesSnapshot = read("recipes")) {
    if (!this.currentId || this.currentId === "new") return;
    const currentStored = recipesSnapshot.find((x) => x.id === this.currentId);
    if (!currentStored) return;

    const resolution = resolveExternalRecipeUpdate({
      baseRecipe: this.initialRecipe,
      currentDraft: this.r,
      storedRecipe: currentStored,
      acknowledgedExternal: this.acknowledgedExternal,
    });

    if (resolution.action === "clear-conflict") {
      this.externalConflict = false;
      this.conflictAcknowledged = false;
      this.latestExternalVersion = null;
      this.acknowledgedExternal = null;
      return;
    }

    if (resolution.action === "auto-sync") {
      this.r = resolution.nextRecipe;
      this.initialRecipe = resolution.nextBase;
      this.externalConflict = false;
      this.conflictAcknowledged = false;
      this.latestExternalVersion = null;
      this.acknowledgedExternal = null;
      return;
    }

    this.externalConflict = true;
    this.latestExternalVersion = resolution.latestExternal;
    if (!resolution.keepAcknowledged) {
      this.acknowledgedExternal = null;
      this.conflictAcknowledged = false;
    }
  }

  reloadExternal() {
    const freshStored = this.currentId ? read("recipes").find((x) => x.id === this.currentId) : undefined;
    const target = freshStored ?? this.latestExternalVersion;
    if (!target) return;
    const fresh = structuredClone(target);
    this.r = fresh;
    this.initialRecipe = structuredClone(fresh);
    this.externalConflict = false;
    this.conflictAcknowledged = false;
    this.latestExternalVersion = null;
    this.acknowledgedExternal = null;
  }

  keepLocalEdits() {
    const currentExternal = (this.currentId ? read("recipes").find((x) => x.id === this.currentId) : undefined) ?? this.latestExternalVersion;
    this.acknowledgedExternal = currentExternal ? structuredClone(currentExternal) : null;
    this.conflictAcknowledged = true;
  }

  save(options: { confirmConflict?: boolean; forceSave?: boolean } = {}): {
    success: boolean;
    reason?: "missing-name" | "conflict-unacknowledged" | "conflict-cancelled";
    savedRecipe?: Recipe;
  } {
    const freshRecipes = read("recipes");
    const latestStored = freshRecipes.find((x) => x.id === this.r.id);
    const validation = validateRecipeSave({
      baseRecipe: this.initialRecipe,
      currentDraft: this.r,
      latestStored,
      isExisting: this.existing,
      conflictAcknowledged: this.conflictAcknowledged,
      acknowledgedExternal: this.acknowledgedExternal,
      forceSave: options.forceSave,
    });

    if (validation.status === "missing-name") {
      return { success: false, reason: "missing-name" };
    }

    if (validation.status === "conflict-unacknowledged") {
      this.externalConflict = true;
      this.conflictAcknowledged = false;
      this.acknowledgedExternal = null;
      this.latestExternalVersion = validation.latestExternal;
      return { success: false, reason: "conflict-unacknowledged" };
    }

    if (validation.status === "conflict-confirm") {
      this.externalConflict = true;
      this.latestExternalVersion = validation.latestExternal;
      if (!options.confirmConflict) {
        return { success: false, reason: "conflict-cancelled" };
      }
    }

    const next = buildSavedRecipe({
      baseRecipe: this.initialRecipe,
      currentDraft: this.r,
      latestStored,
      isExisting: this.existing,
    });

    this.initialRecipe = structuredClone(next);
    this.r = next;
    this.existing = true;
    this.externalConflict = false;
    this.conflictAcknowledged = false;
    this.latestExternalVersion = null;
    this.acknowledgedExternal = null;
    write(
      "recipes",
      freshRecipes.some((x) => x.id === next.id)
        ? freshRecipes.map((x) => (x.id === next.id ? next : x))
        : [...freshRecipes, next]
    );
    return { success: true, savedRecipe: next };
  }

  navigateTo(newId: string | undefined) {
    const next = new RecipeFormSyncHarness(newId);
    this.currentId = next.currentId;
    this.existing = next.existing;
    this.r = next.r;
    this.initialRecipe = next.initialRecipe;
    this.externalConflict = false;
    this.conflictAcknowledged = false;
    this.latestExternalVersion = null;
    this.acknowledgedExternal = null;
  }
}

describe("Sincronização e Prevenção de Conflitos no RecipeFormPage", () => {
  beforeEach(() => {
    memoryStore.clear();
  });

  test("1. Carregamento inicial de uma receita existente", () => {
    write("recipes", [makeRecipe("r1", "IPA Original")]);

    const editor = new RecipeFormSyncHarness("r1");
    assert.equal(editor.r.id, "r1");
    assert.equal(editor.r.name, "IPA Original");
    assert.equal(editor.isDirty(), false);
    assert.equal(editor.externalConflict, false);
  });

  test("2. Atualização externa com formulário clean atualiza automaticamente mesmo sem alterar updatedAt", () => {
    const original = makeRecipe("r1", "Pilsen Tradicional");
    write("recipes", [original]);

    const editor = new RecipeFormSyncHarness("r1");
    assert.equal(editor.isDirty(), false);

    const externalUpdate: Recipe = {
      ...original,
      // updatedAt propositalmente idêntico para provar independência de timestamp
      name: "Pilsen Extra Lúpulo",
      hops: [{ id: "h1", name: "Saaz", grams: 45, alpha: 3.5, minutes: 60, use: "fervura", price: 200 }],
    };
    write("recipes", [externalUpdate]);

    editor.syncWithStore();

    assert.equal(editor.r.name, "Pilsen Extra Lúpulo");
    assert.equal(editor.r.hops[0].name, "Saaz");
    assert.equal(editor.externalConflict, false);
    assert.equal(editor.isDirty(), false);
  });

  test("3. Atualização externa com formulário dirty preserva alterações locais", () => {
    const original = makeRecipe("r1", "Stout");
    write("recipes", [original]);

    const editor = new RecipeFormSyncHarness("r1");
    editor.r.notes = "Minhas anotações pessoais durante a brassagem";
    editor.r.fermentationTempC = 21;
    assert.equal(editor.isDirty(), true);

    const externalUpdate: Recipe = {
      ...original,
      name: "Dry Stout Especial",
      author: "Novo Cervejeiro",
    };
    write("recipes", [externalUpdate]);

    editor.syncWithStore();

    assert.equal(editor.r.notes, "Minhas anotações pessoais durante a brassagem");
    assert.equal(editor.r.fermentationTempC, 21);
    assert.equal(editor.r.name, "Stout");
  });

  test("4. Aviso de conflito exibido quando há divergência com edições locais", () => {
    const original = makeRecipe("r1", "Weiss");
    write("recipes", [original]);

    const editor = new RecipeFormSyncHarness("r1");
    editor.r.equipment.batchL = 50;

    const externalUpdate: Recipe = { ...original, notes: "Alterado via Cloud Sync" };
    write("recipes", [externalUpdate]);

    editor.syncWithStore();

    assert.equal(editor.externalConflict, true);
    assert.equal(editor.conflictAcknowledged, false);
    assert.equal(editor.latestExternalVersion?.notes, "Alterado via Cloud Sync");
  });

  test("5. Ação de recarregar substitui o formulário pela versão externa mais recente", () => {
    const original = makeRecipe("r1", "Red Ale");
    write("recipes", [original]);

    const editor = new RecipeFormSyncHarness("r1");
    editor.r.name = "Red Ale Modificada Localmente";

    const externalUpdate: Recipe = { ...original, name: "Irish Red Ale BJCP" };
    write("recipes", [externalUpdate]);
    editor.syncWithStore();
    assert.equal(editor.externalConflict, true);

    editor.reloadExternal();

    assert.equal(editor.r.name, "Irish Red Ale BJCP");
    assert.equal(editor.externalConflict, false);
    assert.equal(editor.isDirty(), false);
  });

  test("6. Ação de manter preserva alterações locais e detecta caso surja uma nova atualização externa depois", () => {
    const original = makeRecipe("r1", "Session IPA");
    write("recipes", [original]);

    const editor = new RecipeFormSyncHarness("r1");
    editor.r.name = "Minha Session IPA";

    const externalV1: Recipe = { ...original, author: "IA Copilot v1" };
    write("recipes", [externalV1]);
    editor.syncWithStore();
    assert.equal(editor.externalConflict, true);

    editor.keepLocalEdits();
    assert.equal(editor.r.name, "Minha Session IPA");
    assert.equal(editor.conflictAcknowledged, true);

    // Se outra atualização externa mais nova chegar depois, reabre decisão para o usuário
    const externalV2: Recipe = { ...original, author: "IA Copilot v2", notes: "Nova mudança" };
    write("recipes", [externalV2]);
    editor.syncWithStore();
    assert.equal(editor.externalConflict, true);
    assert.equal(editor.conflictAcknowledged, false);
    assert.equal(editor.latestExternalVersion?.author, "IA Copilot v2");
  });

  test("7. Tentativa de salvar durante conflito não resolvido impede sobrescrita silenciosa", () => {
    const original = makeRecipe("r1", "Porter");
    write("recipes", [original]);

    const editor = new RecipeFormSyncHarness("r1");
    editor.r.name = "Baltic Porter";

    const externalUpdate: Recipe = { ...original, notes: "Atualização remota" };
    write("recipes", [externalUpdate]);
    editor.syncWithStore();

    const result = editor.save();
    assert.equal(result.success, false);
    assert.equal(result.reason, "conflict-unacknowledged");

    const stored = read("recipes").find((x) => x.id === "r1");
    assert.equal(stored?.notes, "Atualização remota");
    assert.equal(stored?.name, "Porter");
    assert.equal(editor.r.name, "Baltic Porter");
  });

  test("8. Salvamento normal sem conflito grava no store e incrementa versão", () => {
    const original = makeRecipe("r1", "Blonde Ale");
    write("recipes", [original]);

    const editor = new RecipeFormSyncHarness("r1");
    editor.r.notes = "Nova nota válida";

    const result = editor.save();
    assert.equal(result.success, true);

    const stored = read("recipes").find((x) => x.id === "r1");
    assert.equal(stored?.notes, "Nova nota válida");
    assert.equal(stored?.version, "1.1");
    assert.equal(stored?.versionHistory?.length, 1);
  });

  test("9. Navegação para outra receita continua funcionando e limpa conflitos", () => {
    const r1 = makeRecipe("r1", "Receita 1");
    const r2 = makeRecipe("r2", "Receita 2");
    write("recipes", [r1, r2]);

    const editor = new RecipeFormSyncHarness("r1");
    editor.r.name = "R1 Alterada";
    editor.externalConflict = true;

    editor.navigateTo("r2");
    assert.equal(editor.r.id, "r2");
    assert.equal(editor.r.name, "Receita 2");
    assert.equal(editor.externalConflict, false);
    assert.equal(editor.isDirty(), false);
  });

  test("10. Criação de nova receita continua funcionando", () => {
    write("recipes", []);
    const editor = new RecipeFormSyncHarness("new");
    assert.equal(editor.r.name, "Nova Receita");
    editor.r.name = "Cerveja de Casa Nova";

    const result = editor.save();
    assert.equal(result.success, true);
    const stored = read("recipes").find((x) => x.id === "new-id");
    assert.equal(stored?.name, "Cerveja de Casa Nova");
  });

  test("11. Alterações em propriedades aninhadas e metadados são detectadas", () => {
    const rA = makeRecipe("r1", "Witbier");
    const rB = makeRecipe("r1", "Witbier");
    assert.equal(isExternalRecipeDifferent(rA, rB), false);

    rB.hops = [{ ...rA.hops[0], grams: 99 }];
    assert.equal(isExternalRecipeDifferent(rA, rB), true);

    const rC = makeRecipe("r1", "Witbier");
    rC.mashSteps = [{ name: "Sacarificação", tempC: 68, minutes: 60 }];
    assert.equal(isExternalRecipeDifferent(rA, rC), true);

    const rD = makeRecipe("r1", "Witbier");
    rD.equipment.efficiency = 80;
    assert.equal(isExternalRecipeDifferent(rA, rD), true);

    const rE = makeRecipe("r1", "Witbier");
    rE.fermentables = [{ ...rA.fermentables[0], kg: 5.2 }];
    assert.equal(isExternalRecipeDifferent(rA, rE), true);

    const rF = makeRecipe("r1", "Witbier");
    rF.favorite = true;
    assert.equal(isExternalRecipeDifferent(rA, rF), true);
  });

  test("12. Atualização externa imediatamente antes do salvamento é detectada no store e preserva histórico completo", () => {
    const original = makeRecipe("r1", "Kölsch");
    write("recipes", [original]);

    const editor = new RecipeFormSyncHarness("r1");
    editor.r.notes = "Minhas alterações locais que quero salvar";

    // Simula gravação externa no localStorage imediatamente antes de clicar em Salvar (sem re-render prévio)
    const externalUpdate: Recipe = {
      ...original,
      name: "Kölsch da Alemanha",
      author: "Mestre Cervejeiro",
      version: "1.1",
      versionHistory: [
        {
          version: "1.0",
          note: "Base inicial",
          createdAt: "2026-01-01T00:00:00.000Z",
          snapshot: { ...original, versionHistory: undefined } as Omit<Recipe, "versionHistory">,
        },
      ],
    };
    write("recipes", [externalUpdate]);

    // Primeira tentativa de salvar sem resolver conflito deve bloquear
    const firstSave = editor.save();
    assert.equal(firstSave.success, false);
    assert.equal(firstSave.reason, "conflict-unacknowledged");
    assert.equal(editor.externalConflict, true);
    assert.equal(editor.r.notes, "Minhas alterações locais que quero salvar");

    // Usuário escolhe manter alterações locais e confirma ao salvar
    editor.keepLocalEdits();
    const cancelledSave = editor.save({ confirmConflict: false });
    assert.equal(cancelledSave.success, false);
    assert.equal(cancelledSave.reason, "conflict-cancelled");

    const confirmedSave = editor.save({ confirmConflict: true });
    assert.equal(confirmedSave.success, true);

    const saved = read("recipes").find((x) => x.id === "r1")!;
    assert.equal(saved.notes, "Minhas alterações locais que quero salvar");
    assert.equal(saved.version, "1.2");
    assert.equal(saved.versionHistory?.length, 2, "Deve preservar v1.0 e arquivar v1.1 externa");
    assert.equal(saved.versionHistory?.[0].version, "1.0");
    assert.equal(saved.versionHistory?.[1].version, "1.1");
    assert.equal(saved.versionHistory?.[1].snapshot.name, "Kölsch da Alemanha");
  });
});
