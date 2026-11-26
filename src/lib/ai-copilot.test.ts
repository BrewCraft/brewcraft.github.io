/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { buildCopilotContext, queryRecipesByAbv, executeCalculator, proposeRecipeCreate, proposeRecipeUpdate, proposeInventoryAdd, applyProposal, extractJsonObject, shouldAllowCopilotMutation } from "./ai-copilot";
import { defaultEquipment, type InventoryItem, type Recipe } from "./recipe-calc";
import { defaultSettings } from "./settings-model";

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: "r1", name: "IPA Teste", styleCode: "21A", author: "", notes: "", equipment: { ...defaultEquipment },
  mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }], fermentationTempC: 19, fermentationDays: 14,
  fermentables: [{ id: "f1", name: "Pale Ale", kg: 5, potential: 1.037, color: 3, type: "grao", price: 20 }],
  hops: [{ id: "h1", name: "Cascade", grams: 40, alpha: 6, minutes: 60, use: "fervura", price: 250 }],
  yeasts: [{ id: "y1", name: "US-05", attenuation: 80, packs: 1, price: 35 }], miscs: [], createdAt: "", updatedAt: "", ...over,
});
const inv = (): InventoryItem[] => [
  { id: "i1", kind: "fermentavel", name: "Pale Ale", amount: 10, unit: "kg", price: 20, minAmount: 1 },
  { id: "i2", kind: "lupulo", name: "Cascade", amount: 100, unit: "g", price: 0.25, minAmount: 10 },
];

describe("consulta de receitas", () => {
  test("contexto expõe dados reais e resultados calculados", () => {
    const ctx = buildCopilotContext({ recipes: [recipe()], inventory: inv(), settings: defaultSettings });
    assert.equal(ctx.source, "brewcraft");
    assert.equal(ctx.recipes.length, 1);
    const r = ctx.recipes[0];
    assert.equal(r.name, "IPA Teste");
    assert.equal(r.fermentables[0].name, "Pale Ale");
    assert.ok(r.results.og > 1);
    assert.ok(r.results.abv > 0);
    assert.ok(r.results.ibu > 0);
    assert.ok(r.results.ebc > 0);
  });
  test("filtra receitas por ABV", () => {
    const ctx = buildCopilotContext({ recipes: [recipe(), recipe({ id: "r2", name: "Light", fermentables: [{ id: "f", name: "Pilsen", kg: 2, potential: 1.037, color: 2, type: "grao", price: 18 }] })], inventory: [] });
    assert.ok(queryRecipesByAbv(ctx.recipes, ">", 0).length >= 1);
  });
});

describe("consulta de inventário", () => {
  test("contexto expõe itens, quantidades e preços e indica metadados ausentes", () => {
    const ctx = buildCopilotContext({ recipes: [], inventory: inv() });
    assert.equal(ctx.inventory.length, 2);
    assert.equal(ctx.inventory[0].amount, 10);
    assert.ok(ctx.inventory[0].price > 0);
    assert.ok(ctx.inventory[0].metadataNote.includes("não cadastradas"));
  });
});

describe("execução de calculadoras", () => {
  test("executa calculadora real com validação", () => {
    const res = executeCalculator("alcohol", { og: "1.050", fg: "1.010", serving: "355" });
    assert.equal(res.ok, true);
    if (res.ok) assert.ok(res.results.some(x => x.label.includes("Teor alcoólico")));
  });
  test("rejeita argumentos inválidos", () => {
    const res = executeCalculator("alcohol", { og: "abc", fg: "1.010", serving: "355" });
    assert.equal(res.ok, false);
  });
  test("rejeita calculadora desconhecida", () => {
    const res = executeCalculator("nao-existe", {});
    assert.equal(res.ok, false);
  });
});

describe("criação de receitas", () => {
  test("gera proposta com resultados calculados pelo BrewCraft", () => {
    const p = proposeRecipeCreate({ name: "Nova", style: "18B", equipment: { batchL: 20, boilMinutes: 60, efficiency: 72 }, fermentables: [{ name: "Pale Ale", kg: 4, potential: 1.037, color: 3, type: "grao" }], hops: [{ name: "Cascade", grams: 30, alpha: 6, minutes: 60, use: "fervura" }], yeasts: [{ name: "US-05", attenuation: 80, packs: 1 }] }, { inventory: inv() });
    assert.equal(p.ok, true);
    if (p.ok) { assert.ok(p.proposal.after.results.og > 1); assert.ok(p.proposal.after.results.ibu > 0); }
  });
  test("não preenche silenciosamente informações essenciais ausentes", () => {
    const p = proposeRecipeCreate({ style: "18B", fermentables: [] }, {});
    assert.equal(p.ok, false);
    if (!p.ok) assert.ok((p.missingInfo?.length ?? 0) > 0);
  });
});

describe("alteração de receitas", () => {
  test("gera proposta com antes/depois e ingredientes afetados", () => {
    const base = recipe();
    const p = proposeRecipeUpdate({ id: "r1", name: "IPA Editada", fermentables: [{ name: "Pale Ale", kg: 6, potential: 1.037, color: 3, type: "grao" }], hops: base.hops, yeasts: base.yeasts, equipment: base.equipment, style: base.styleCode }, [base], {});
    assert.equal(p.ok, true);
    if (p.ok) {
      assert.ok(p.proposal.before);
      assert.ok(p.proposal.after.results.og >= p.proposal.before!.results.og);
      assert.ok(p.proposal.affectedIngredients.includes("Pale Ale"));
    }
  });
  test("falha para id inexistente", () => {
    const p = proposeRecipeUpdate({ id: "x" }, [recipe()], {});
    assert.equal(p.ok, false);
  });
});

describe("confirmação de operações", () => {
  test("só aplica quando chamada explicitamente (após aprovação)", () => {
    const p = proposeInventoryAdd({ name: "Cascade", type: "Hop", amount: 50, unit: "g" }, inv());
    assert.equal(p.ok, true);
    if (p.ok) {
      const state = { recipes: [recipe()], inventory: inv() };
      const applied = applyProposal(p.proposal, state);
      assert.equal(applied.ok, true);
      if (applied.ok) assert.equal(applied.inventory.find(i => i.name === "Cascade")!.amount, 150);
      // estado original não alterado
      assert.equal(state.inventory.find(i => i.name === "Cascade")!.amount, 100);
    }
  });
});

describe("erros de execução e respostas incompletas", () => {
  test("inventário inválido sem nome/quantidade", () => {
    assert.equal(proposeInventoryAdd({ type: "Hop", amount: 10 }, []).ok, false);
    assert.equal(proposeInventoryAdd({ name: "X", type: "Hop" }, []).ok, false);
  });
  test("extrai JSON de resposta incompleta/fenced", () => {
    assert.equal(extractJsonObject('texto ```json {"a":1} ``` fim')?.a, 1);
    assert.equal(extractJsonObject('não é json'), null);
  });
});

describe("guarda de intenção para mutações do copiloto", () => {
  test("bloqueia criação de receita não solicitada em conversas e perguntas comuns", () => {
    assert.equal(shouldAllowCopilotMutation("oi, tudo bem?", [], "PROPOSE_CREATE_RECIPE"), false);
    assert.equal(shouldAllowCopilotMutation("como fazer uma IPA bem aromática?", [], "PROPOSE_CREATE_RECIPE"), false);
    assert.equal(shouldAllowCopilotMutation("qual a diferença entre IPA e APA?", [], "CREATE_RECIPE"), false);
    assert.equal(shouldAllowCopilotMutation("analise minha receita de Pilsen", [], "PROPOSE_CREATE_RECIPE"), false);
    assert.equal(shouldAllowCopilotMutation("não crie receita, só me dê dicas", [], "PROPOSE_CREATE_RECIPE"), false);
  });

  test("permite proposta quando usuário pede explicitamente ou responde à coleta de dados", () => {
    assert.equal(shouldAllowCopilotMutation("crie uma receita de American IPA de 20L", [], "PROPOSE_CREATE_RECIPE"), true);
    assert.equal(shouldAllowCopilotMutation("monte uma receita de Weiss para mim", [], "CREATE_RECIPE"), true);
    assert.equal(shouldAllowCopilotMutation("atualize a receita IPA Teste com 50g de Cascade", [], "PROPOSE_UPDATE_RECIPE"), true);
    assert.equal(shouldAllowCopilotMutation("adicione 5 kg de malte Pilsen no inventário", [], "PROPOSE_ADD_INVENTORY"), true);
    assert.equal(
      shouldAllowCopilotMutation(
        "20 litros, eficiência 75% e malte Pale Ale",
        [{ role: "model", content: "Não foi possível preparar a proposta. Faltam: volume do lote (L)." }],
        "PROPOSE_CREATE_RECIPE"
      ),
      true
    );
  });

  test("proposeRecipeCreate gera ID único mesmo se payload trouxer id existente", () => {
    const existing = recipe({ id: "r1" });
    const p = proposeRecipeCreate(
      {
        id: "r1",
        name: "Nova IPA",
        style: "21A",
        equipment: { batchL: 20, boilMinutes: 60, efficiency: 75 },
        fermentables: [{ name: "Pale Ale", kg: 5, potential: 1.037, color: 3, type: "grao" }],
      },
      { inventory: inv() }
    );
    assert.equal(p.ok, true);
    if (p.ok) {
      assert.notEqual(p.proposal.recipe.id, "r1");
      const applied = applyProposal(p.proposal, { recipes: [existing], inventory: inv() });
      assert.equal(applied.ok, true);
      if (applied.ok) assert.equal(applied.recipes.length, 2);
    }
  });
});
