import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultEquipment,
  createRecipeSnapshot,
  hasRecipeChanged,
  createRecipeVersion,
  restoreRecipeVersion,
  compareRecipeVersions,
  type Recipe,
  type Batch
} from "./recipe-calc";

const baseTestRecipe = (): Recipe => ({
  id: "rec-test-1",
  name: "American IPA Original",
  styleCode: "21A",
  author: "Tester",
  notes: "Versão base de teste",
  equipment: { ...defaultEquipment, batchL: 20, efficiency: 75 },
  mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
  fermentationTempC: 19,
  fermentationDays: 14,
  fermentables: [
    { id: "f1", name: "Malte Pilsen", kg: 5, potential: 1.037, color: 3.5, type: "grao", price: 20 },
    { id: "f2", name: "Malte Caramelo 60L", kg: 0.5, potential: 1.034, color: 60, type: "grao", price: 28 },
  ],
  hops: [
    { id: "h1", name: "Magnum", grams: 20, alpha: 14, minutes: 60, use: "fervura", price: 200 },
    { id: "h2", name: "Citra", grams: 50, alpha: 12.5, minutes: 10, use: "fervura", price: 320 },
  ],
  yeasts: [{ id: "y1", name: "SafAle US-05", attenuation: 81, packs: 1, price: 35 }],
  miscs: [],
  createdAt: "2026-11-20T10:00:00Z",
  updatedAt: "2026-11-20T10:00:00Z",
  version: "1.0",
  versionHistory: [],
});

test("Versionamento: detecção precisa de alterações com hasRecipeChanged", () => {
  const r1 = baseTestRecipe();
  const r2 = baseTestRecipe();
  assert.equal(hasRecipeChanged(r1, r2), false, "Receitas idênticas não devem reportar alterações");

  r2.fermentables[0].kg = 5.5;
  assert.equal(hasRecipeChanged(r1, r2), true, "Alteração de peso no malte deve ser detectada");

  const r3 = baseTestRecipe();
  r3.hops[1].use = "dryhop";
  assert.equal(hasRecipeChanged(r1, r3), true, "Alteração de uso de lúpulo deve ser detectada");

  const r4 = baseTestRecipe();
  r4.name = "Novo Nome";
  assert.equal(hasRecipeChanged(r1, r4), true, "Alteração de nome deve ser detectada");

  const r5 = baseTestRecipe();
  r5.author = "Outro Autor";
  assert.equal(hasRecipeChanged(r1, r5), true, "Alteração de autor deve ser detectada");

  const r6 = baseTestRecipe();
  r6.hops[0].alpha = 15.2;
  assert.equal(hasRecipeChanged(r1, r6), true, "Alteração de alfa-ácido deve ser detectada");

  const r7 = baseTestRecipe();
  r7.hops[1].dryHopDay = 5;
  assert.equal(hasRecipeChanged(r1, r7), true, "Alteração de dryHopDay deve ser detectada");

  const r8 = baseTestRecipe();
  r8.equipment.trubLossL = 2.0;
  assert.equal(hasRecipeChanged(r1, r8), true, "Alteração de perda de trub deve ser detectada");

  const r9 = baseTestRecipe();
  r9.miscs.push({ id: "m1", name: "Whirlfloc", amount: 1, unit: "un", use: "Fervura", price: 2 });
  assert.equal(hasRecipeChanged(r1, r9), true, "Adição de misc deve ser detectada");

  const r10 = baseTestRecipe();
  r10.fermentables[0].price = 25;
  assert.equal(hasRecipeChanged(r1, r10), true, "Alteração de preço deve ser detectada");
});

test("Versionamento: criação de nova versão preserva o snapshot do estado anterior e associa a nota à nova versão", () => {
  const original = baseTestRecipe();
  const snapshotOriginal = createRecipeSnapshot(original);

  // Usuário altera a receita para v1.1
  const modified: Recipe = {
    ...original,
    name: "American IPA Mais Lupulada",
    hops: [
      ...original.hops,
      { id: "h3", name: "Mosaic", grams: 60, alpha: 12, minutes: 0, use: "dryhop", price: 350 },
    ],
  };

  const v1_1 = createRecipeVersion(modified, snapshotOriginal, "Adicionado dry hop de Mosaic");

  assert.equal(v1_1.version, "1.1");
  assert.equal(v1_1.versionNote, "Adicionado dry hop de Mosaic");
  assert.equal(v1_1.name, "American IPA Mais Lupulada");
  assert.equal(v1_1.versionHistory?.length, 1);

  // O snapshot armazenado em versionHistory para v1.0 DEVE ter os dados originais intactos e a nota da v1.0 (vazia)
  const history0 = v1_1.versionHistory?.[0];
  assert.equal(history0?.version, "1.0");
  assert.equal(history0?.note, "");
  assert.equal(history0?.snapshot.name, "American IPA Original");
  assert.equal(history0?.snapshot.hops.length, 2, "Snapshot de v1.0 deve ter apenas 2 lúpulos");
  assert.equal(v1_1.hops.length, 3, "Versão atual 1.1 deve ter 3 lúpulos");

  // Ao criar v1.2, v1.1 entra para o histórico preservando sua nota "Adicionado dry hop de Mosaic"
  const v1_2 = createRecipeVersion({ ...v1_1, author: "Novo Mestre" }, v1_1, "Ajuste de autor");
  assert.equal(v1_2.versionNote, "Ajuste de autor");
  assert.equal(v1_2.versionHistory?.[1].version, "1.1");
  assert.equal(v1_2.versionHistory?.[1].note, "Adicionado dry hop de Mosaic");
});

test("Versionamento: comparação entre versões (compareRecipeVersions) trata ingredientes repetidos, miscs e autor", () => {
  const v1_0: Recipe = {
    ...baseTestRecipe(),
    hops: [
      { id: "h1", name: "Cascade", grams: 20, alpha: 6, minutes: 15, use: "fervura", price: 250 },
      { id: "h2", name: "Cascade", grams: 40, alpha: 6, minutes: 0, use: "dryhop", dryHopDay: 5, price: 250 },
    ],
    miscs: [{ id: "m1", name: "Whirlfloc", amount: 1, unit: "un", use: "Fervura", price: 2 }],
  };
  const v1_1: Recipe = {
    ...v1_0,
    name: "American IPA v1.1",
    author: "Outro Tester",
    fermentables: [
      { id: "f1", name: "Malte Pilsen", kg: 5.5, potential: 1.037, color: 3.5, type: "grao", price: 20 },
    ], // removeu o Caramelo e aumentou Pilsen
    hops: [
      { ...v1_0.hops[0], grams: 35 }, // aumentou o 1º Cascade (fervura)
      v1_0.hops[1], // manteve o 2º Cascade (dryhop)
      { id: "h3", name: "Simcoe", grams: 30, alpha: 13, minutes: 0, use: "dryhop", price: 300 },
    ],
    miscs: [{ id: "m1", name: "Whirlfloc", amount: 2, unit: "un", use: "Fervura", price: 2 }],
  };

  const diff = compareRecipeVersions(v1_0, v1_1);
  assert.equal(diff.hasChanges, true);

  // Nome e Autor modificados
  const nameDiff = diff.general.find(g => g.name === "Nome");
  const authorDiff = diff.general.find(g => g.name === "Autor");
  assert.ok(nameDiff && nameDiff.type === "modified");
  assert.ok(authorDiff && authorDiff.type === "modified");

  // Dois lúpulos Cascade não devem colidir
  const cascadeFerv = diff.hops.find(h => h.name.includes("Cascade") && h.name.includes("fervura"));
  const cascadeDry = diff.hops.find(h => h.name.includes("Cascade") && h.name.includes("dryhop"));
  assert.equal(cascadeFerv?.type, "modified");
  assert.equal(cascadeDry?.type, "unchanged");

  // Miscs modificado
  assert.equal(diff.miscs[0].type, "modified");

  // Fermentáveis: Pilsen modificado e Caramelo removido
  const fPilsen = diff.fermentables.find(f => f.name.includes("Pilsen"));
  const fCara = diff.fermentables.find(f => f.name.includes("Caramelo"));
  assert.equal(fPilsen?.type, "modified");
  assert.equal(fCara?.type, "removed");

  // Lúpulos: Simcoe adicionado
  const hSimcoe = diff.hops.find(h => h.name.includes("Simcoe"));
  assert.equal(hSimcoe?.type, "added");

  // Estatísticas calculadas
  assert.ok(diff.stats.og.old > 1.050);
  assert.ok(diff.stats.og.new > 1.050);
});

test("Versionamento: restauração de versão antiga cria nova versão sem apagar histórico e associa nota à restaurada", () => {
  const original = baseTestRecipe();
  const v1_1 = createRecipeVersion(
    { ...original, name: "Versão Alterada 1.1", fermentationTempC: 22 },
    original,
    "Teste de temperatura mais alta"
  );
  assert.equal(v1_1.version, "1.1");

  const v1_2 = createRecipeVersion(
    { ...v1_1, name: "Versão Alterada 1.2", fermentationTempC: 24 },
    v1_1,
    "Subiu para 24C"
  );
  assert.equal(v1_2.version, "1.2");
  assert.equal(v1_2.versionHistory?.length, 2);

  // Restaura a versão 1.0 original
  const restored = restoreRecipeVersion(v1_2, "1.0");

  // Deve ter criado a versão 1.3 com a nota de restauração na própria versão 1.3
  assert.equal(restored.version, "1.3");
  assert.ok(restored.versionNote?.includes("Restaurada da versão 1.0"));
  // O nome e temperatura restaurados devem ser os da 1.0
  assert.equal(restored.name, "American IPA Original");
  assert.equal(restored.fermentationTempC, 19);

  // O histórico deve conter agora 3 entradas (1.0, 1.1 e 1.2) mantendo as notas originais de cada versão
  assert.equal(restored.versionHistory?.length, 3);
  assert.equal(restored.versionHistory?.[0].version, "1.0");
  assert.equal(restored.versionHistory?.[0].note, "");
  assert.equal(restored.versionHistory?.[1].version, "1.1");
  assert.equal(restored.versionHistory?.[1].note, "Teste de temperatura mais alta");
  assert.equal(restored.versionHistory?.[2].version, "1.2");
  assert.equal(restored.versionHistory?.[2].note, "Subiu para 24C");
});

test("Versionamento: lotes antigos preservam seu snapshot de receita independentemente de versões posteriores", () => {
  const recipeV1 = baseTestRecipe();
  const batch: Batch = {
    id: "batch-1",
    number: 1,
    name: "Lote 1",
    recipeId: recipeV1.id,
    recipe: structuredClone(recipeV1),
    status: "fermentacao",
    brewDate: "2026-11-20",
    measurements: [],
    notes: "",
    inventoryDeducted: true,
    createdAt: "2026-11-20T11:00:00Z",
  };

  // Receita evolui para v1.1 e v1.2
  const recipeV1_1 = createRecipeVersion({ ...recipeV1, name: "Receita Modificada" }, recipeV1, "mod 1");
  const recipeV1_2 = createRecipeVersion({ ...recipeV1_1, name: "Receita Super Modificada" }, recipeV1_1, "mod 2");

  // O lote deve continuar exatamente com os dados da v1 original
  assert.equal(batch.recipe.name, "American IPA Original");
  assert.equal(batch.recipe.version, "1.0");
  assert.equal(recipeV1_2.name, "Receita Super Modificada");
  assert.equal(recipeV1_2.version, "1.2");
});
