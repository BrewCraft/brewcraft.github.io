/// <reference types="node" />
import { strict as assert } from "node:assert";
import { afterEach, describe, test } from "node:test";
import { calculators, validateCalculator } from "./calculator-registry";
import { buildCopilotContext, executeCalculator, proposeInventoryAdd, proposeRecipeCreate, proposeRecipeUpdate, applyProposal, extractJsonObject } from "./ai-copilot";
import { applySalts, deductInventory, recipeCost, recipeStats, shoppingList, volumes, type InventoryItem, type Recipe } from "./recipe-calc";
import { estimateMashPh } from "./water-calc";
import { makeBackup, restoreBackup, storageKeys } from "./backup";
import { defaultSettings, normalizeSettings } from "./settings-model";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};
(globalThis as any).window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {}, localStorage: (globalThis as any).localStorage };
(globalThis as any).CustomEvent = class { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; } };

const closeTo = (a: number, b: number, tol = 0.001) => assert.ok(Math.abs(a - b) <= tol, `${a} not close to ${b} (tol ${tol})`);
const eq = { batchL: 20, boilMinutes: 60, evaporationLh: 4, trubLossL: 1, fermenterLossL: 1, efficiency: 72 };
const baseRecipe = (): Recipe => ({
  id: "r-audit", name: "Receita Auditoria", styleCode: "18B", author: "Tester", notes: "nota",
  equipment: { ...eq }, mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
  fermentationTempC: 19, fermentationDays: 14,
  fermentables: [{ id: "f1", name: "Pale Ale", kg: 5, potential: 1.037, color: 3, type: "grao", price: 20 }],
  hops: [{ id: "h1", name: "Cascade", grams: 40, alpha: 6, minutes: 60, use: "fervura", price: 250 }],
  yeasts: [{ id: "y1", name: "US-05", attenuation: 80, packs: 1, price: 35 }],
  miscs: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const inv = (): InventoryItem[] => [
  { id: "i1", kind: "fermentavel", name: "Pale Ale", amount: 10, unit: "kg", price: 20, minAmount: 1 },
  { id: "i2", kind: "lupulo", name: "Cascade", amount: 100, unit: "g", price: 0.25, minAmount: 10 },
  { id: "i3", kind: "levedura", name: "US-05", amount: 2, unit: "pacote", price: 35, minAmount: 1 },
];

afterEach(() => store.clear());

describe("receitas e calculadoras", () => {
  test("criação/edição preserva ingredientes e recalcula após alterações", () => {
    const r = baseRecipe();
    const before = recipeStats(r, defaultSettings);
    r.fermentables[0].kg = 6;
    r.equipment.efficiency = 80;
    const after = recipeStats(r, defaultSettings);
    assert.equal(r.fermentables[0].name, "Pale Ale");
    assert.ok(after.og > before.og);
    assert.ok(after.ibu >= 0 && after.srm >= 0);
  });
  test("receita antiga continua válida e volumes/equipamento coerentes", () => {
    const legacy = { ...baseRecipe(), equipment: { batchL: 20, boilMinutes: 60, evaporationLh: 3, trubLossL: 0.5, fermenterLossL: 0.5, efficiency: 70 } } as Recipe;
    const s = recipeStats(legacy, defaultSettings);
    const v = volumes(legacy.equipment);
    assert.ok(s.og > 1 && s.fg < s.og);
    closeTo(v.postBoil, 20.5, 0.001);
    closeTo(v.preBoil, 23.5, 0.001);
  });
});

describe("inventário e custos", () => {
  test("adição/atualização/remoção e integração com receitas", () => {
    let items = inv();
    const r = baseRecipe();
    const list = shoppingList(r, items);
    assert.ok(list.some(x => x.name === "Pale Ale" && x.missing === 0));
    items = items.map(i => i.name === "Pale Ale" ? { ...i, amount: i.amount - 2 } : i);
    assert.equal(items.find(i => i.name === "Pale Ale")!.amount, 8);
    items = items.filter(i => i.name !== "Cascade");
    assert.ok(shoppingList(r, items).find(x => x.name === "Cascade")!.missing > 0);
    const cost = recipeCost(r);
    assert.ok(cost.total > 0 && Math.abs(cost.total - (100 + 10 + 35)) < 0.5);
  });
  test("evita estoque negativo sem autorização e permite quando autorizado", () => {
    const r = baseRecipe();
    r.fermentables[0].kg = 50;
    const blocked = deductInventory(r, inv(), false);
    assert.equal(blocked.find(i => i.name === "Pale Ale")!.amount, 0);
    const allowed = deductInventory(r, inv(), true);
    assert.ok(allowed.find(i => i.name === "Pale Ale")!.amount < 0);
  });
});

describe("Gemini/copiloto e ações controladas", () => {
  test("contexto usa dados reais e calculadoras reais do registro", () => {
    const ctx = buildCopilotContext({ recipes: [baseRecipe()], inventory: inv(), settings: defaultSettings });
    assert.equal(ctx.source, "brewcraft");
    assert.ok(ctx.recipes[0].results.og > 1);
    const calcIds = calculators.map(c => c.id);
    assert.ok(calcIds.includes("volumes_full") && calcIds.includes("mash_ph") && calcIds.includes("recipe_optimizer"));
    const exec = executeCalculator("alcohol", { og: "1.050", fg: "1.010", serving: "355" });
    assert.equal(exec.ok, true);
  });
  test("mutações só por proposta + confirmação explícita e validação", () => {
    const create = proposeRecipeCreate({ name: "Nova", style: "18B", equipment: { batchL: 20, boilMinutes: 60, efficiency: 72 }, fermentables: [{ name: "Pilsen", kg: 4.5, potential: 1.037, color: 2, type: "grao" }], hops: [{ name: "Saaz", grams: 30, alpha: 3.5, minutes: 60, use: "fervura" }], yeasts: [{ name: "US-05", attenuation: 80, packs: 1 }] }, { inventory: inv(), settings: defaultSettings });
    assert.equal(create.ok, true);
    if (create.ok) {
      const state = { recipes: [], inventory: inv() };
      const applied = applyProposal(create.proposal, state);
      assert.equal(applied.ok, true);
      assert.equal(state.recipes.length, 0); // não muta silenciosamente
      if (applied.ok) {
        const upd = proposeRecipeUpdate({ id: create.proposal.recipe.id, name: "Nova Editada", fermentables: [{ name: "Pilsen", kg: 5.5, potential: 1.037, color: 2, type: "grao" }], hops: create.proposal.recipe.hops, yeasts: create.proposal.recipe.yeasts, equipment: create.proposal.recipe.equipment, style: "18B" }, applied.recipes, { inventory: inv() });
        assert.equal(upd.ok, true);
      }
    }
    assert.equal(proposeRecipeCreate({ style: "18B" }, {}).ok, false);
    const invP = proposeInventoryAdd({ name: "Cascade", type: "Hop", amount: 25, unit: "g" }, inv());
    assert.equal(invP.ok, true);
    assert.equal(proposeInventoryAdd({ type: "Hop", amount: 10 }, []).ok, false);
    assert.equal(extractJsonObject('```json {"action":"X"} ```')?.action, "X");
  });
});

describe("água, equipamento e backup/integridade", () => {
  test("química da água e pH integrados aos maltes/equipamento", () => {
    const r = baseRecipe();
    const adj = applySalts({ ca: 20, mg: 5, na: 10, so4: 30, cl: 20, hco3: 40 }, { gypsum: 2, cacl2: 1 }, 15);
    assert.ok(adj.ca > 20 && adj.so4 > 30);
    const ph = estimateMashPh([{ name: "Pilsen", kg: 5, colorLovibond: 2, type: "base" }], 15, adj, { lactic85Ml: 1 });
    assert.ok(ph.estimatedPh >= 4.5 && ph.estimatedPh <= 6.5);
    assert.ok(recipeStats({ ...r, equipment: { ...r.equipment, batchL: 30 } }).volumes.postBoil > recipeStats(r).volumes.postBoil);
  });
  test("import/export preserva dados e rejeita estrutura inválida", () => {
    store.set(storageKeys.receitas, JSON.stringify([baseRecipe()]));
    store.set(storageKeys.lotes, JSON.stringify([]));
    store.set(storageKeys.inventário, JSON.stringify(inv()));
    store.set(storageKeys["perfil-equipamento"], JSON.stringify([]));
    store.set(storageKeys["perfil-mostura"], JSON.stringify([]));
    store.set(storageKeys["perfil-fermentacao"], JSON.stringify([]));
    store.set(storageKeys["perfil-agua"], JSON.stringify([]));
    store.set(storageKeys["perfil-estilos"], JSON.stringify([]));
    const backup = makeBackup();
    store.clear();
    const restored = restoreBackup(backup);
    assert.ok(restored >= 3);
    const recipes = JSON.parse(store.get(storageKeys.receitas)!);
    assert.equal(recipes[0].name, "Receita Auditoria");
    assert.equal(recipes[0].fermentables[0].kg, 5);
    assert.throws(() => restoreBackup({ app: "x" }), /Backup inválido/);
    assert.throws(() => restoreBackup({ data: { receitas: "bad" } }), /Backup inválido/);
  });
  test("defaults das calculadoras válidos e limites rejeitados", () => {
    for (const c of calculators) {
      const v = Object.fromEntries(c.fields.map(f => [f.id, f.initial]));
      assert.equal(validateCalculator(c, v), undefined, c.id);
    }
    const alc = calculators.find(c => c.id === "alcohol")!;
    assert.ok(validateCalculator(alc, { og: "1.010", fg: "1.020", serving: "355" }));
  });
});
