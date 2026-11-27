/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  buildCopilotContext,
  queryRecipesByAbv,
  executeCalculator,
  proposeRecipeCreate,
  proposeRecipeUpdate,
  proposeInventoryAdd,
  applyProposal,
  extractJsonObject,
  shouldAllowCopilotMutation,
  classifyCopilotIntent,
  prepareCopilotTurn,
  type CopilotChatMessage,
} from "./ai-copilot";
import { GeminiService } from "./gemini";
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

describe("roteamento de intenção e consulta sob demanda do copiloto", () => {
  const makeSpyTools = () => {
    const calls = { recipes: 0, inventory: 0, settings: 0 };
    return {
      calls,
      tools: {
        getRecipes: () => {
          calls.recipes += 1;
          return [recipe()];
        },
        getInventory: () => {
          calls.inventory += 1;
          return inv();
        },
        getSettings: () => {
          calls.settings += 1;
          return defaultSettings;
        },
      },
    };
  };

  test("saudações simples não disparam ferramentas de receita/inventário nem enviam contexto", () => {
    for (const greeting of ["oi", "olá", "bom dia", "boa tarde", "boa noite", "tudo bem?", "oi, tudo bem?"]) {
      const { calls, tools } = makeSpyTools();
      const plan = prepareCopilotTurn(greeting, [], tools);
      assert.equal(plan.intent.kind, "greeting", `Esperado greeting para "${greeting}"`);
      assert.equal(calls.recipes, 0, `getRecipes não deve ser chamado para "${greeting}"`);
      assert.equal(calls.inventory, 0, `getInventory não deve ser chamado para "${greeting}"`);
      assert.equal(plan.consultedTools.recipes, false);
      assert.equal(plan.consultedTools.inventory, false);
      assert.equal(plan.context, undefined);
      assert.equal(plan.intent.allowMutation, false);
    }
  });

  test("perguntas gerais não consultam receitas nem inventário automaticamente", () => {
    for (const q of ["O que é OG?", "Qual a diferença entre ale e lager?", "Como funciona o dry hopping?"]) {
      const { calls, tools } = makeSpyTools();
      const plan = prepareCopilotTurn(q, [], tools);
      assert.equal(plan.intent.kind, "general_question", `Esperado general_question para "${q}"`);
      assert.equal(calls.recipes, 0);
      assert.equal(calls.inventory, 0);
      assert.equal(plan.context, undefined);
    }
  });

  test("solicitações explícitas de análise de receita consultam apenas receitas e BJCP", () => {
    for (const prompt of [
      "Analise minha receita",
      "Minha receita está dentro do BJCP?",
      "O que posso melhorar nesta receita?",
      "oi, analise minha receita",
    ]) {
      const { calls, tools } = makeSpyTools();
      const plan = prepareCopilotTurn(prompt, [], tools);
      assert.equal(plan.intent.kind, "recipe_analysis", `Esperado recipe_analysis para "${prompt}"`);
      assert.equal(calls.recipes, 1);
      assert.equal(calls.inventory, 0);
      assert.ok(plan.context?.recipes && plan.context.recipes.length === 1);
      assert.ok(plan.context?.bjcpStyles && plan.context.bjcpStyles.length > 0);
      assert.equal(plan.context?.inventory, undefined);
    }
  });

  test("criação explícita de receita sem mencionar estoque inicia criação sem consultar receitas ou inventário", () => {
    for (const prompt of [
      "Crie uma APA de 20 litros",
      "Monte uma receita para 20 litros",
      "Quero desenvolver uma nova cerveja",
    ]) {
      const { calls, tools } = makeSpyTools();
      const plan = prepareCopilotTurn(prompt, [], tools);
      assert.equal(plan.intent.kind, "recipe_creation", `Esperado recipe_creation para "${prompt}"`);
      assert.equal(plan.intent.allowMutation, true);
      assert.equal(shouldAllowCopilotMutation(prompt, [], "PROPOSE_CREATE_RECIPE"), true);
      assert.equal(calls.recipes, 0);
      assert.equal(calls.inventory, 0);
      assert.equal(plan.context?.recipes, undefined);
      assert.equal(plan.context?.inventory, undefined);
      assert.ok(plan.context?.bjcpStyles && plan.context.bjcpStyles.length > 0);
    }
  });

  test("consulta de inventário acessa estoque sem consultar receitas desnecessariamente", () => {
    const { calls, tools } = makeSpyTools();
    const plan = prepareCopilotTurn("Quais ingredientes tenho?", [], tools);
    assert.equal(plan.intent.kind, "inventory_query");
    assert.equal(calls.inventory, 1);
    assert.equal(calls.recipes, 0);
    assert.ok(plan.context?.inventory && plan.context.inventory.length === 2);
    assert.equal(plan.context?.recipes, undefined);
  });

  test("verificação de estoque para receita existente consulta inventário e receita", () => {
    const { calls, tools } = makeSpyTools();
    const plan = prepareCopilotTurn("Tenho malte suficiente para esta receita?", [], tools);
    assert.equal(plan.intent.kind, "inventory_query");
    assert.equal(calls.inventory, 1);
    assert.equal(calls.recipes, 1);
    assert.ok(plan.context?.inventory);
    assert.ok(plan.context?.recipes);
  });

  test("criação de receita usando estoque consulta inventário e inicia criação", () => {
    const { calls, tools } = makeSpyTools();
    const plan = prepareCopilotTurn("Crie uma receita usando meu estoque", [], tools);
    assert.equal(plan.intent.kind, "recipe_creation");
    assert.equal(plan.intent.allowMutation, true);
    assert.equal(calls.inventory, 1);
    assert.equal(calls.recipes, 0);
    assert.ok(plan.context?.inventory);
    assert.ok(plan.context?.bjcpStyles);
  });

  test("histórico com análises ou coleta anterior não provoca análise nem mutação em novas saudações ou perguntas gerais", () => {
    const history: CopilotChatMessage[] = [
      { role: "user", content: "Analise minha receita" },
      { role: "model", content: "### Análise da IPA Teste\nNão foi possível preparar a proposta. Faltam: eficiência (%)." },
    ];

    const greetingSpy = makeSpyTools();
    const greetingPlan = prepareCopilotTurn("oi", history, greetingSpy.tools);
    assert.equal(greetingPlan.intent.kind, "greeting");
    assert.equal(greetingSpy.calls.recipes, 0);
    assert.equal(greetingSpy.calls.inventory, 0);
    assert.equal(greetingPlan.context, undefined);
    assert.equal(greetingPlan.messagesForModel.length, 1);
    assert.equal(greetingPlan.messagesForModel[0].content, "oi");
    assert.equal(shouldAllowCopilotMutation("oi", history, "PROPOSE_CREATE_RECIPE"), false);

    const questionSpy = makeSpyTools();
    const questionPlan = prepareCopilotTurn("O que é OG?", history, questionSpy.tools);
    assert.equal(questionPlan.intent.kind, "general_question");
    assert.equal(questionSpy.calls.recipes, 0);
    assert.equal(questionSpy.calls.inventory, 0);
    assert.equal(questionPlan.context, undefined);
    assert.equal(questionPlan.messagesForModel.length, 1);
    assert.equal(questionPlan.messagesForModel[0].content, "O que é OG?");
    assert.equal(shouldAllowCopilotMutation("O que é OG?", history, "PROPOSE_CREATE_RECIPE"), false);
  });

  test("preserva contexto para continuação de tarefa iniciada", () => {
    const creationHistory: CopilotChatMessage[] = [
      { role: "user", content: "Crie uma receita usando meu estoque" },
      { role: "model", content: "Qual volume e estilo você prefere? Faltam: volume do lote (L)." },
    ];
    const spy = makeSpyTools();
    const plan = prepareCopilotTurn("20 litros, eficiência 75% e estilo APA", creationHistory, spy.tools);
    assert.equal(plan.intent.kind, "task_continuation");
    assert.equal(plan.intent.allowMutation, true);
    assert.equal(spy.calls.inventory, 1);
    assert.equal(plan.messagesForModel.length, 3);

    const analysisHistory: CopilotChatMessage[] = [
      { role: "user", content: "Analise minha receita" },
      { role: "model", content: "A APA da Casa está com 35 IBU." },
    ];
    const followUpSpy = makeSpyTools();
    const followUp = prepareCopilotTurn("E qual lúpulo posso substituir nela?", analysisHistory, followUpSpy.tools);
    assert.ok(followUp.intent.kind === "recipe_analysis" || followUp.intent.kind === "task_continuation");
    assert.equal(followUp.intent.allowMutation, false);
    assert.equal(followUpSpy.calls.recipes, 1);
    assert.equal(followUp.messagesForModel.length, 3);
  });

  test("GeminiService não anexa Contexto do BrewCraft quando context é undefined", () => {
    const service = new GeminiService("fake-key");
    const internal = service as unknown as {
      buildContents: (msgs: CopilotChatMessage[], ctx?: unknown) => Array<{ role: string; parts: Array<{ text?: string }> }>;
    };
    const contents = internal.buildContents([{ role: "user", content: "oi" }], undefined);
    assert.equal(contents.length, 1);
    assert.equal(contents[0].parts[0].text, "oi");
    assert.equal(contents[0].parts[0].text?.includes("Contexto do BrewCraft"), false);
  });

  test("classifyCopilotIntent identifica intenção ambígua sem consultar dados", () => {
    const intent = classifyCopilotIntent("ajuda", []);
    assert.equal(intent.kind, "unclear");
    assert.equal(intent.needsRecipes, false);
    assert.equal(intent.needsInventory, false);
  });
});
