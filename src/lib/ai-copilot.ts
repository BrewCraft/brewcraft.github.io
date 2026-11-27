import { calculators, validateCalculator, type CalculatorDefinition, type Result, type Values } from "./calculator-registry";
import { bjcpStyles } from "./catalog";
import {
  defaultEquipment,
  recipeStats,
  shoppingList,
  volumes,
  type Equipment,
  type HopUse,
  type InventoryItem,
  type InventoryKind,
  type Recipe,
  type RecipeFermentable,
  type RecipeHop,
  type RecipeMisc,
  type RecipeYeast,
} from "./recipe-calc";
import { defaultSettings, normalizeSettings, type AppSettings } from "./settings-model";
import { uid } from "./store";

export type CopilotRecipeSummary = {
  id: string;
  name: string;
  style: string;
  author: string;
  notes: string;
  batchSizeL: number;
  boilTimeMin: number;
  efficiency: number;
  equipment: Equipment;
  fermentationTempC: number;
  fermentationDays: number;
  waterProfileId?: string;
  fermentables: RecipeFermentable[];
  hops: RecipeHop[];
  yeasts: RecipeYeast[];
  miscs: RecipeMisc[];
  results: {
    og: number; fg: number; abv: number; ibu: number; ebc: number; srm: number;
    buGu: number; rbr: number; calories: number; grainKg: number;
    volumes: ReturnType<typeof volumes>; costTotal: number; costPerLiter: number;
  };
};

export type CopilotInventoryItem = InventoryItem & {
  validade?: string;
  dataAquisicao?: string;
  dataCadastro?: string;
  metadataNote: string;
};

export type CopilotContext = {
  source: "brewcraft";
  generatedAt: string;
  settings?: AppSettings;
  recipes?: CopilotRecipeSummary[];
  inventory?: CopilotInventoryItem[];
  calculators?: { id: string; title: string; group: string; note?: string; fields: { id: string; label: string; initial: string; min?: number; max?: number }[] }[];
  bjcpStyles?: { code: string; name: string; og: [number, number]; fg: [number, number]; ibu: [number, number]; srm: [number, number]; abv: [number, number] }[];
};

export type CopilotContextScope = {
  recipes?: boolean;
  inventory?: boolean;
  calculators?: boolean;
  bjcpStyles?: boolean;
  settings?: boolean;
};

export type CopilotChatMessage = {
  role: "user" | "model" | "system";
  content: string;
  image?: string;
};

export type CopilotTools = {
  getRecipes: () => Recipe[];
  getInventory: () => InventoryItem[];
  getSettings: () => AppSettings;
};

export type CopilotIntentKind =
  | "greeting"
  | "general_question"
  | "recipe_analysis"
  | "recipe_creation"
  | "recipe_update"
  | "inventory_query"
  | "inventory_mutation"
  | "calculator"
  | "task_continuation"
  | "unclear";

export type CopilotIntent = {
  kind: CopilotIntentKind;
  needsRecipes: boolean;
  needsInventory: boolean;
  needsBjcp: boolean;
  needsCalculators: boolean;
  needsSettings: boolean;
  allowMutation: boolean;
  isolatedHistory: boolean;
};

export type CopilotTurnPlan = {
  intent: CopilotIntent;
  context?: CopilotContext;
  messagesForModel: CopilotChatMessage[];
  consultedTools: {
    recipes: boolean;
    inventory: boolean;
    bjcpStyles: boolean;
    calculators: boolean;
    settings: boolean;
  };
};

const r4 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : n);
const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

export function summarizeRecipe(recipe: Recipe, settings: AppSettings = defaultSettings): CopilotRecipeSummary {
  const stats = recipeStats(recipe, settings);
  return {
    id: recipe.id,
    name: recipe.name,
    style: recipe.styleCode,
    author: recipe.author,
    notes: recipe.notes,
    batchSizeL: recipe.equipment.batchL,
    boilTimeMin: recipe.equipment.boilMinutes,
    efficiency: recipe.equipment.efficiency,
    equipment: recipe.equipment,
    fermentationTempC: recipe.fermentationTempC,
    fermentationDays: recipe.fermentationDays,
    waterProfileId: recipe.waterProfileId,
    fermentables: recipe.fermentables,
    hops: recipe.hops,
    yeasts: recipe.yeasts,
    miscs: recipe.miscs,
    results: {
      og: r4(stats.og), fg: r4(stats.fg), abv: r2(stats.abv), ibu: r2(stats.ibu),
      srm: r2(stats.srm), ebc: r2(stats.srm * 1.97),
      buGu: r4(stats.buGu), rbr: r4(stats.rbr), calories: r2(stats.calories),
      grainKg: r2(stats.grainKg), volumes: stats.volumes,
      costTotal: r2(stats.cost.total), costPerLiter: r2(stats.costPerLiter),
    },
  };
}

function mapInventoryItems(items: InventoryItem[]): CopilotInventoryItem[] {
  return (items ?? []).map((i) => {
    const any = i as InventoryItem & Record<string, unknown>;
    const validade = typeof any.validade === "string" ? any.validade : typeof any.expiry === "string" ? any.expiry : undefined;
    const dataAquisicao = typeof any.dataAquisicao === "string" ? any.dataAquisicao : typeof any.acquiredAt === "string" ? any.acquiredAt : undefined;
    const hasMeta = Boolean(validade || dataAquisicao || any.dataCadastro);
    return {
      ...i,
      validade,
      dataAquisicao,
      dataCadastro: typeof any.dataCadastro === "string" ? any.dataCadastro : undefined,
      metadataNote: hasMeta ? "ok" : "Validade e data de aquisição não cadastradas para este item.",
    };
  });
}

export function buildCopilotContext(
  args: { recipes: Recipe[]; inventory: InventoryItem[]; settings?: AppSettings },
  scope: CopilotContextScope = { recipes: true, inventory: true, calculators: true, bjcpStyles: true, settings: true },
): CopilotContext {
  const settings = normalizeSettings(args.settings ?? defaultSettings);
  const ctx: CopilotContext = {
    source: "brewcraft",
    generatedAt: new Date().toISOString(),
  };

  if (scope.settings) {
    ctx.settings = settings;
  }
  if (scope.recipes) {
    ctx.recipes = (args.recipes ?? []).map((r) => summarizeRecipe(r, settings));
  }
  if (scope.inventory) {
    ctx.inventory = mapInventoryItems(args.inventory ?? []);
  }
  if (scope.calculators) {
    ctx.calculators = calculators.map((c) => ({
      id: c.id,
      title: c.title,
      group: c.group,
      note: c.note,
      fields: c.fields.map((f) => ({ id: f.id, label: f.label, initial: f.initial, min: f.min, max: f.max })),
    }));
  }
  if (scope.bjcpStyles) {
    ctx.bjcpStyles = bjcpStyles.map((s) => ({
      code: s.code,
      name: s.name,
      og: s.og,
      fg: s.fg,
      ibu: s.ibu,
      srm: s.srm,
      abv: s.abv,
    }));
  }

  return ctx;
}

export function queryRecipesByAbv(recipes: CopilotRecipeSummary[], op: ">" | ">=" | "<" | "<=" | "==" , value: number) {
  return recipes.filter((r) => {
    const v = r.results.abv;
    if (op === ">") return v > value;
    if (op === ">=") return v >= value;
    if (op === "<") return v < value;
    if (op === "<=") return v <= value;
    return Math.abs(v - value) < 1e-6;
  });
}

export function executeCalculator(calcId: string, values: Values): { ok: true; calculator: string; results: Result[] } | { ok: false; error: string } {
  const calc = calculators.find((c) => c.id === calcId);
  if (!calc) return { ok: false, error: `Calculadora desconhecida: ${calcId}` };
  const err = validateCalculator(calc, values);
  if (err) return { ok: false, error: err };
  try {
    const results = calc.calculate(values);
    if (!Array.isArray(results)) return { ok: false, error: "A calculadora não retornou resultados válidos." };
    return { ok: true, calculator: calc.title, results };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao executar calculadora." };
  }
}

export type ProposalKind = "CREATE_RECIPE" | "UPDATE_RECIPE" | "ADD_INVENTORY";
export type RecipeProposal = {
  kind: "CREATE_RECIPE" | "UPDATE_RECIPE";
  recipe: Recipe;
  before?: CopilotRecipeSummary;
  after: CopilotRecipeSummary;
  affectedIngredients: string[];
  missingInfo: string[];
  warnings: string[];
  inventoryCheck?: ReturnType<typeof shoppingList>;
};
export type InventoryProposal = {
  kind: "ADD_INVENTORY";
  item: InventoryItem;
  before?: InventoryItem;
  after: InventoryItem;
  affectedIngredients: string[];
  missingInfo: string[];
  warnings: string[];
};
export type Proposal = RecipeProposal | InventoryProposal;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOr = (v: unknown, d: number) => (isNum(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : d);

function normalizeHopUse(v: unknown): HopUse {
  const raw = String(v ?? "fervura").trim().toLowerCase();
  if (raw.includes("dry")) return "dryhop";
  if (raw.includes("whirl")) return "whirlpool";
  if (raw.includes("mosto") || raw.includes("first")) return "primeiro_mosto";
  return "fervura";
}

function normalizeEquipment(payload: Record<string, unknown>, base?: Equipment): { equipment: Equipment; missing: string[] } {
  const src = (payload.equipment && typeof payload.equipment === "object" ? payload.equipment : payload) as Record<string, unknown>;
  const b = base ?? defaultEquipment;
  const batchL = numOr(src.batchL ?? src.batchSize, b.batchL);
  const boilMinutes = numOr(src.boilMinutes ?? src.boilTime, b.boilMinutes);
  const efficiency = numOr(src.efficiency, b.efficiency);
  const missing: string[] = [];
  if (!isNum(src.batchL ?? src.batchSize) && !base) missing.push("volume do lote (L)");
  if (!isNum(src.efficiency) && !base) missing.push("eficiência (%)");
  return {
    equipment: {
      batchL: batchL > 0 ? batchL : b.batchL,
      boilMinutes: boilMinutes > 0 ? boilMinutes : b.boilMinutes,
      evaporationLh: numOr(src.evaporationLh, b.evaporationLh),
      trubLossL: numOr(src.trubLossL, b.trubLossL),
      fermenterLossL: numOr(src.fermenterLossL, b.fermenterLossL),
      efficiency: efficiency > 0 && efficiency <= 100 ? efficiency : b.efficiency,
    },
    missing,
  };
}

function normalizeRecipePayload(payload: Record<string, unknown>, existing: Recipe | undefined, settings: AppSettings): { recipe?: Recipe; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];
  const name = String(payload.name ?? existing?.name ?? "").trim();
  if (!name) missing.push("nome da receita");
  const styleCode = String(payload.styleCode ?? payload.style ?? existing?.styleCode ?? "").trim();
  if (!String(payload.styleCode ?? payload.style ?? "").trim() && !existing) missing.push("estilo desejado");

  const { equipment, missing: eqMissing } = normalizeEquipment(payload, existing?.equipment);
  missing.push(...eqMissing);

  const normFerms = (arr: unknown, fallback: RecipeFermentable[]): RecipeFermentable[] => {
    if (!Array.isArray(arr)) return fallback;
    return arr.map((item, i) => {
      const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const kg = numOr(it.kg ?? it.amount, 0);
      const potentialRaw = numOr(it.potential ?? it.yield, 1.037);
      const potential = potentialRaw > 1 && potentialRaw < 1.2 ? potentialRaw : 1 + ((potentialRaw / 100) * 0.046 || 0.037);
      return {
        id: String(it.id ?? `${uid()}-f${i}`),
        name: String(it.name ?? "Fermentável").trim() || "Fermentável",
        kg: kg >= 0 ? kg : 0,
        potential,
        color: Math.max(0, numOr(it.color, 2)),
        type: String(it.type ?? "grao"),
        price: Math.max(0, numOr(it.price, 0)),
      };
    });
  };
  const normHops = (arr: unknown, fallback: RecipeHop[]): RecipeHop[] => {
    if (!Array.isArray(arr)) return fallback;
    return arr.map((item, i) => {
      const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        id: String(it.id ?? `${uid()}-h${i}`),
        name: String(it.name ?? "Lúpulo").trim() || "Lúpulo",
        grams: Math.max(0, numOr(it.grams ?? it.amount, 0)),
        alpha: Math.max(0, numOr(it.alpha, 5)),
        minutes: Math.max(0, numOr(it.minutes ?? it.time, 60)),
        use: normalizeHopUse(it.use),
        price: Math.max(0, numOr(it.price, 0)),
        dryHopDay: it.dryHopDay !== undefined ? Math.max(0, numOr(it.dryHopDay, 0)) : undefined,
      };
    });
  };
  const normYeasts = (arr: unknown, fallback: RecipeYeast[]): RecipeYeast[] => {
    if (!Array.isArray(arr)) return fallback;
    return arr.map((item, i) => {
      const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        id: String(it.id ?? `${uid()}-y${i}`),
        name: String(it.name ?? "Levedura").trim() || "Levedura",
        attenuation: Math.max(1, Math.min(100, numOr(it.attenuation, 75))),
        packs: Math.max(0, numOr(it.packs, 1)),
        price: Math.max(0, numOr(it.price, 0)),
      };
    });
  };
  const normMiscs = (arr: unknown, fallback: RecipeMisc[]): RecipeMisc[] => {
    if (!Array.isArray(arr)) return fallback;
    return arr.map((item, i) => {
      const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        id: String(it.id ?? `${uid()}-m${i}`),
        name: String(it.name ?? "Adjunto").trim() || "Adjunto",
        amount: Math.max(0, numOr(it.amount, 0)),
        unit: String(it.unit ?? "un"),
        use: String(it.use ?? "Fervura"),
        price: Math.max(0, numOr(it.price, 0)),
      };
    });
  };

  const fermentables = normFerms(payload.fermentables, existing?.fermentables ?? []);
  const hops = normHops(payload.hops, existing?.hops ?? []);
  const yeasts = normYeasts(payload.yeasts, existing?.yeasts ?? []);
  const miscs = normMiscs(payload.miscs, existing?.miscs ?? []);

  if (!existing && (!Array.isArray(payload.fermentables) || fermentables.length === 0)) missing.push("maltes/fermentáveis");
  if (!existing && (!Array.isArray(payload.hops) || hops.length === 0)) warnings.push("Nenhum lúpulo informado.");
  if (!existing && (!Array.isArray(payload.yeasts) || yeasts.length === 0)) warnings.push("Nenhuma levedura informada (atenuação padrão pode ser aplicada nos cálculos).");

  const mashSteps = Array.isArray(payload.mashSteps)
    ? payload.mashSteps.map((step, i) => {
        const s = (step && typeof step === "object" ? step : {}) as Record<string, unknown>;
        return { name: String(s.name ?? `Etapa ${i + 1}`), tempC: numOr(s.tempC, 66), minutes: numOr(s.minutes, 60) };
      })
    : (existing?.mashSteps ?? [{ name: "Sacarificação", tempC: 66, minutes: 60 }]);

  const recipe: Recipe = {
    id: existing ? existing.id : uid(),
    name: name || "Nova Receita IA",
    styleCode: styleCode || existing?.styleCode || "Sem Estilo",
    author: String(payload.author ?? existing?.author ?? "IA Assistant"),
    notes: String(payload.notes ?? existing?.notes ?? ""),
    equipment,
    mashSteps,
    fermentationTempC: numOr(payload.fermentationTempC, existing?.fermentationTempC ?? 19),
    fermentationDays: numOr(payload.fermentationDays, existing?.fermentationDays ?? 14),
    waterProfileId: (payload.waterProfileId ?? existing?.waterProfileId) as string | undefined,
    fermentables, hops, yeasts, miscs,
    favorite: existing?.favorite,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return { recipe, missing, warnings };
}

export function proposeRecipeCreate(payload: Record<string, unknown>, opts: { settings?: AppSettings; inventory?: InventoryItem[] } = {}): { ok: true; proposal: RecipeProposal } | { ok: false; error: string; missingInfo?: string[] } {
  const settings = normalizeSettings(opts.settings ?? defaultSettings);
  if (!payload || typeof payload !== "object") return { ok: false, error: "Payload de receita inválido." };
  const { recipe, missing, warnings } = normalizeRecipePayload(payload, undefined, settings);
  if (!recipe) return { ok: false, error: "Não foi possível montar a receita.", missingInfo: missing };
  if (missing.length) return { ok: false, error: `Informações essenciais ausentes: ${missing.join(", ")}.`, missingInfo: missing };
  const after = summarizeRecipe(recipe, settings);
  const invCheck = opts.inventory ? shoppingList(recipe, opts.inventory) : undefined;
  return {
    ok: true,
    proposal: {
      kind: "CREATE_RECIPE",
      recipe,
      after,
      affectedIngredients: [...recipe.fermentables.map(f => f.name), ...recipe.hops.map(h => h.name), ...recipe.yeasts.map(y => y.name), ...recipe.miscs.map(m => m.name)],
      missingInfo: [],
      warnings,
      inventoryCheck: invCheck,
    },
  };
}

export function proposeRecipeUpdate(payload: Record<string, unknown>, existingRecipes: Recipe[], opts: { settings?: AppSettings; inventory?: InventoryItem[] } = {}): { ok: true; proposal: RecipeProposal } | { ok: false; error: string; missingInfo?: string[] } {
  const settings = normalizeSettings(opts.settings ?? defaultSettings);
  if (!payload || typeof payload !== "object") return { ok: false, error: "Payload de atualização inválido." };
  const id = String(payload.id ?? "");
  if (!id) return { ok: false, error: "ID da receita é obrigatório para atualização." };
  const existing = existingRecipes.find(r => r.id === id);
  if (!existing) return { ok: false, error: `Receita não encontrada para o id informado (${id}).` };
  const { recipe, missing, warnings } = normalizeRecipePayload(payload, existing, settings);
  if (!recipe) return { ok: false, error: "Não foi possível montar a receita atualizada.", missingInfo: missing };
  if (missing.length) return { ok: false, error: `Informações essenciais ausentes: ${missing.join(", ")}.`, missingInfo: missing };
  const before = summarizeRecipe(existing, settings);
  const after = summarizeRecipe(recipe, settings);
  const affected = Array.from(new Set([
    ...existing.fermentables.map(f => f.name), ...existing.hops.map(h => h.name), ...existing.yeasts.map(y => y.name), ...existing.miscs.map(m => m.name),
    ...recipe.fermentables.map(f => f.name), ...recipe.hops.map(h => h.name), ...recipe.yeasts.map(y => y.name), ...recipe.miscs.map(m => m.name),
  ]));
  return {
    ok: true,
    proposal: { kind: "UPDATE_RECIPE", recipe, before, after, affectedIngredients: affected, missingInfo: [], warnings, inventoryCheck: opts.inventory ? shoppingList(recipe, opts.inventory) : undefined },
  };
}

export function proposeInventoryAdd(payload: Record<string, unknown>, inventory: InventoryItem[]): { ok: true; proposal: InventoryProposal } | { ok: false; error: string; missingInfo?: string[] } {
  const raw = (payload && typeof payload === "object" ? (payload.item && typeof payload.item === "object" ? payload.item : payload) : {}) as Record<string, unknown>;
  const name = String(raw.name ?? "").trim();
  if (!name) return { ok: false, error: "Nome do item de inventário é obrigatório.", missingInfo: ["nome do item"] };
  const typeMap: Record<string, InventoryKind> = { Fermentable: "fermentavel", fermentable: "fermentavel", Hop: "lupulo", hop: "lupulo", Yeast: "levedura", yeast: "levedura", Misc: "outro", misc: "outro", fermentavel: "fermentavel", lupulo: "lupulo", levedura: "levedura", outro: "outro" };
  const kind = typeMap[String(raw.type ?? raw.kind ?? "Misc").trim()] ?? "outro";
  const amount = numOr(raw.amount, NaN);
  if (!Number.isFinite(amount)) return { ok: false, error: "Quantidade do item é obrigatória.", missingInfo: ["quantidade"] };
  const validUnits = new Set(["kg", "g", "L", "ml", "un", "pacote"]);
  const requestedUnit = String(raw.unit ?? "").trim();
  const unit = kind === "levedura" ? "pacote" : (validUnits.has(requestedUnit) ? requestedUnit : (kind === "fermentavel" ? "kg" : kind === "lupulo" ? "g" : "un"));
  const item: InventoryItem = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : uid(),
    kind, name, amount, unit,
    price: Math.max(0, numOr(raw.price, 0)),
    minAmount: Math.max(0, numOr(raw.minAmount, 0)),
    alpha: raw.alpha !== undefined ? numOr(raw.alpha, 0) : undefined,
    potential: raw.potential !== undefined ? numOr(raw.potential, 0) : undefined,
    color: raw.color !== undefined ? numOr(raw.color, 0) : undefined,
    attenuation: raw.attenuation !== undefined ? numOr(raw.attenuation, 0) : undefined,
  };
  const existing = inventory.find(i => i.kind === item.kind && i.name.toLowerCase() === item.name.toLowerCase());
  const after = existing ? { ...existing, ...item, amount: Number(existing.amount) + Number(item.amount) } : item;
  const warnings: string[] = [];
  if (!existing && amount <= 0) warnings.push("Quantidade informada é menor ou igual a zero.");
  return { ok: true, proposal: { kind: "ADD_INVENTORY", item, before: existing, after, affectedIngredients: [name], missingInfo: [], warnings } };
}

export function applyProposal(proposal: Proposal, state: { recipes: Recipe[]; inventory: InventoryItem[] }): { ok: true; recipes: Recipe[]; inventory: InventoryItem[]; message: string } | { ok: false; error: string } {
  try {
    if (proposal.kind === "CREATE_RECIPE") {
      if (state.recipes.some(r => r.id === proposal.recipe.id)) return { ok: false, error: "Já existe uma receita com este ID." };
      return { ok: true, recipes: [...state.recipes, proposal.recipe], inventory: state.inventory, message: `Receita "${proposal.recipe.name}" criada.` };
    }
    if (proposal.kind === "UPDATE_RECIPE") {
      const idx = state.recipes.findIndex(r => r.id === proposal.recipe.id);
      if (idx < 0) return { ok: false, error: "Receita não encontrada para atualização." };
      const next = [...state.recipes]; next[idx] = proposal.recipe;
      return { ok: true, recipes: next, inventory: state.inventory, message: `Receita "${proposal.recipe.name}" atualizada.` };
    }
    if (proposal.kind === "ADD_INVENTORY") {
      const existing = state.inventory.find(i => i.kind === proposal.after.kind && i.name.toLowerCase() === proposal.after.name.toLowerCase());
      const nextInv = existing ? state.inventory.map(i => i.id === existing.id ? proposal.after : i) : [proposal.after, ...state.inventory];
      return { ok: true, recipes: state.recipes, inventory: nextInv, message: `Inventário atualizado: ${proposal.after.name}.` };
    }
    return { ok: false, error: "Tipo de proposta desconhecido." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao aplicar proposta." };
  }
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates = [fenced ? fenced[1].trim() : null, trimmed.startsWith("{") ? trimmed : null, trimmed.match(/\{[\s\S]*\}/)?.[0] ?? null].filter(Boolean) as string[];
  for (const c of candidates) {
    try { const parsed = JSON.parse(c) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null; } catch { /* try next */ }
  }
  return null;
}

const normalizeIntentText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const GREETING_SEGMENT_RE =
  /^(?:oi|ola|bom dia|boa tarde|boa noite|e ai|opa|fala|salve|hello|hi|hey|tudo bem|tudo bom|td bem|td bom|como vai|como voce esta|como vc esta|beleza|joia|obrigado|obrigada|muito obrigado|muito obrigada|valeu|ate mais|tchau|amigo|pessoal|galera|copiloto|assistente|cervejeiro|por ai|com voce|com vc)\b[\s!?,.;:-]*/;

function stripGreetingSegments(normalized: string): string {
  let rest = normalized.replace(/^[\s!?,.;:-]+/, "");
  let changed = true;
  while (changed && rest.length > 0) {
    const next = rest.replace(GREETING_SEGMENT_RE, "").replace(/^[\s!?,.;:-]+/, "");
    changed = next !== rest;
    rest = next;
  }
  return rest.trim();
}

export function isPureGreeting(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) return false;
  return stripGreetingSegments(normalized) === "";
}

const INVENTORY_MENTION_RE =
  /\b(inventario|estoque|ingredientes disponiveis|ingredientes que tenho|ingredientes tenho|que ingredientes|quais ingredientes|meus ingredientes|usando meu estoque|com meu estoque|usando o estoque|com o que tenho|tenho.*suficiente|falta.*ingrediente|lista de compras|preciso comprar|validade.*lupulo|lupulos sem validade|preco.*estoque)\b/;

const RECIPE_TARGET_RE =
  /\b(minha receita|minhas receitas|essa receita|esta receita|nesta receita|nessa receita|da receita|na receita|minha cerveja|meu lote|apa da casa|cadastrada|cadastradas)\b/;

const ANAPHORA_RE = /\b(dela|nela|disso|desse|dessa|desta|deste|nessa|nesse|nesta|neste)\b/;

const CONCEPTUAL_QUESTION_RE =
  /^(?:(?:e|mas|entao)\s+)?(como|por que|porque|qual|quais|o que|onde|quando|para que|pra que|posso|devo|me explique|explique)\b/;

const NEGATED_MUTATION_RE =
  /\b(nao|sem)\s+(crie|criar|cria|salve|salvar|salva|gere|gerar|monte|montar|adicione|adicionar|altere|alterar|edite|editar|desenvolva|desenvolver)\b/;

const CREATION_COMMAND_RE =
  /\b(crie|criar|cria|gere|gerar|gera|monte|montar|monta|elabore|elaborar|cadastre|cadastrar|cadastra|salve|salvar|salva|desenvolva|desenvolver|formule|formular|create|generate|build|save)\b/;

const EXPLICIT_WANT_CREATE_RE =
  /\b(quero|gostaria de|preciso|vamos)\s+(criar|montar|desenvolver|elaborar|fazer|produzir)\s+(uma\s+|um\s+)?(nova\s+|novo\s+)?(receita|cerveja|ipa|apa|neipa|lager|pilsen|pilsner|stout|porter|weiss|weizen|witbier|saison|bitter|pale ale|lote)\b/;

const UPDATE_COMMAND_RE =
  /\b(altere|alterar|altera|edite|editar|edita|atualize|atualizar|atualiza|modifique|modificar|mude|mudar|ajuste|ajustar|corrija|corrigir|substitua|substituir|remova|remover|update|edit|modify|change|adjust)\b/;

const INVENTORY_MUTATION_RE =
  /\b(adicione|adicionar|adiciona|cadastre|cadastrar|cadastra|registre|registrar|coloque|colocar|insira|inserir|comprei|some|somar|remova|remover|deduza|deduzir|baixe|dar baixa|add|register)\b/;

const ANALYSIS_VERB_RE =
  /\b(analise|analisar|avalie|avaliar|verifique|verificar|cheque|checar|revise|revisar|compare|comparar|liste|listar|mostre|mostrar|filtre|filtrar|melhorar|melhorias|desequilibrio|dentro do estilo|dentro do bjcp|fora do estilo|compatibilidade)\b/;

const CALCULATOR_COMMAND_RE =
  /\b(calcule|calcular|calcula|use a calculadora|execute a calculadora|converter|converta)\b/;

function getActiveTaskWindow(previousMessages: CopilotChatMessage[]): CopilotChatMessage[] {
  let startIndex = 0;
  for (let i = 0; i < previousMessages.length; i++) {
    const msg = previousMessages[i];
    if (msg.role === "user" && isPureGreeting(msg.content)) {
      startIndex = i + 1;
    }
  }
  return previousMessages.slice(startIndex);
}

function isContinuationCue(text: string, previousMessages: CopilotChatMessage[]): boolean {
  const activeWindow = getActiveTaskWindow(previousMessages);
  if (activeWindow.length === 0) return false;
  const lastModel = [...activeWindow].reverse().find((m) => m.role === "model");
  if (!lastModel) return false;

  const isCollectingInfo =
    lastModel.content.includes("Não foi possível preparar") ||
    lastModel.content.includes("Responda com as informações necessárias") ||
    lastModel.content.includes("Faltam:") ||
    lastModel.content.trim().endsWith("?");

  const isShortReply = text.split(/\s+/).length <= 16 && !CONCEPTUAL_QUESTION_RE.test(text);
  const hasFollowUpPhrase =
    ANAPHORA_RE.test(text) ||
    /^(sim|pode|confirmo|ok|beleza|fechado|isso|exato|use|coloque|adicione|aumente|diminua|reduza|troque|mude)\b/.test(text);

  return (isCollectingInfo && isShortReply) || hasFollowUpPhrase;
}

export function classifyCopilotIntent(
  userText: string,
  previousMessages: CopilotChatMessage[] = [],
  opts: { hasImage?: boolean } = {},
): CopilotIntent {
  const rawNormalized = normalizeIntentText(userText);
  if (!rawNormalized) {
    return {
      kind: opts.hasImage ? "general_question" : "unclear",
      needsRecipes: false,
      needsInventory: false,
      needsBjcp: false,
      needsCalculators: false,
      needsSettings: false,
      allowMutation: false,
      isolatedHistory: false,
    };
  }

  if (isPureGreeting(rawNormalized)) {
    return {
      kind: "greeting",
      needsRecipes: false,
      needsInventory: false,
      needsBjcp: false,
      needsCalculators: false,
      needsSettings: false,
      allowMutation: false,
      isolatedHistory: true,
    };
  }

  const text = stripGreetingSegments(rawNormalized) || rawNormalized;
  const hasNegatedMutation = NEGATED_MUTATION_RE.test(text);
  const mentionsInventory = INVENTORY_MENTION_RE.test(text);
  const mentionsRecipeTarget = RECIPE_TARGET_RE.test(text);
  const mentionsBjcp = /\b(bjcp|diretriz|diretrizes|dentro do estilo|fora do estilo)\b/.test(text);
  const mentionsRecipeOrStyleNoun =
    /\b(receita|receitas|cerveja|ipa|apa|neipa|lager|pilsen|pilsner|stout|porter|weiss|weizen|witbier|saison|bitter|pale ale|amber|red ale|blonde|tripel|dubbel|quadrupel|bock|kolsch|marzen|lote)\b/.test(text);
  const isConceptual =
    CONCEPTUAL_QUESTION_RE.test(text) &&
    !/\b(no app|no brewcraft|para mim|pra mim|e salve|salva)\b/.test(text);

  // 1. Explicit inventory mutation ("adicione 5 kg de malte no inventário")
  if (
    !hasNegatedMutation &&
    INVENTORY_MUTATION_RE.test(text) &&
    (/\b(inventario|estoque)\b/.test(text) || /\bcomprei\b/.test(text))
  ) {
    return {
      kind: "inventory_mutation",
      needsRecipes: mentionsRecipeTarget,
      needsInventory: true,
      needsBjcp: false,
      needsCalculators: false,
      needsSettings: true,
      allowMutation: true,
      isolatedHistory: false,
    };
  }

  // 2. Explicit recipe update ("altere/corrija/atualize minha receita...")
  if (
    !hasNegatedMutation &&
    !isConceptual &&
    UPDATE_COMMAND_RE.test(text) &&
    (mentionsRecipeTarget || mentionsRecipeOrStyleNoun || ANAPHORA_RE.test(text))
  ) {
    return {
      kind: "recipe_update",
      needsRecipes: true,
      needsInventory: mentionsInventory,
      needsBjcp: true,
      needsCalculators: false,
      needsSettings: true,
      allowMutation: true,
      isolatedHistory: false,
    };
  }

  // 3. Explicit recipe creation ("crie uma APA de 20L", "monte uma receita", "quero desenvolver uma nova cerveja")
  const wantsRecipeCreation =
    !hasNegatedMutation &&
    !isConceptual &&
    ((CREATION_COMMAND_RE.test(text) && (mentionsRecipeOrStyleNoun || /\b\d+\s*(l|litros?)\b/.test(text))) ||
      /\b(faca|fazer|faz)\s+(uma|um|essa|esta|a)\s+(nova\s+)?(receita|cerveja)\b/.test(text) ||
      EXPLICIT_WANT_CREATE_RE.test(text));

  if (wantsRecipeCreation) {
    const basedOnExistingRecipe = /\b(baseada na minha|a partir da minha|parecida com minha|copia da minha)\b/.test(text);
    return {
      kind: "recipe_creation",
      needsRecipes: basedOnExistingRecipe,
      needsInventory: mentionsInventory,
      needsBjcp: true,
      needsCalculators: false,
      needsSettings: true,
      allowMutation: true,
      isolatedHistory: false,
    };
  }

  // 4. Explicit inventory query ("Quais ingredientes tenho?", "Tenho malte suficiente para esta receita?")
  if (mentionsInventory) {
    return {
      kind: "inventory_query",
      needsRecipes: mentionsRecipeTarget || /\bsuficiente\s+para\b/.test(text),
      needsInventory: true,
      needsBjcp: false,
      needsCalculators: false,
      needsSettings: mentionsRecipeTarget,
      allowMutation: false,
      isolatedHistory: false,
    };
  }

  // 5. Explicit recipe analysis / consultation ("Analise minha receita", "Minha receita está dentro do BJCP?")
  const asksRecipeAnalysis =
    mentionsRecipeTarget ||
    (ANALYSIS_VERB_RE.test(text) && (mentionsRecipeOrStyleNoun || ANAPHORA_RE.test(text))) ||
    /\b(quais receitas|quantas receitas|receitas com abv|receitas acima|receitas abaixo)\b/.test(text);

  if (asksRecipeAnalysis) {
    return {
      kind: "recipe_analysis",
      needsRecipes: true,
      needsInventory: mentionsInventory,
      needsBjcp: true,
      needsCalculators: false,
      needsSettings: true,
      allowMutation: false,
      isolatedHistory: false,
    };
  }

  // 6. Explicit calculator request
  if (CALCULATOR_COMMAND_RE.test(text)) {
    return {
      kind: "calculator",
      needsRecipes: mentionsRecipeTarget || ANAPHORA_RE.test(text),
      needsInventory: false,
      needsBjcp: false,
      needsCalculators: true,
      needsSettings: true,
      allowMutation: false,
      isolatedHistory: false,
    };
  }

  // 7. Follow-up / continuation of active multi-turn task (not a standalone conceptual question)
  if (isContinuationCue(text, previousMessages)) {
    const activeWindow = getActiveTaskWindow(previousMessages);
    const activeUserHistory = activeWindow
      .filter((m) => m.role === "user")
      .map((m) => normalizeIntentText(m.content))
      .join(" ");

    const activeNeedsInventory = INVENTORY_MENTION_RE.test(activeUserHistory) || mentionsInventory;
    const activeNeedsRecipes =
      RECIPE_TARGET_RE.test(activeUserHistory) ||
      ANALYSIS_VERB_RE.test(activeUserHistory) ||
      UPDATE_COMMAND_RE.test(activeUserHistory);
    const activeIsCreationOrMutation =
      CREATION_COMMAND_RE.test(activeUserHistory) ||
      EXPLICIT_WANT_CREATE_RE.test(activeUserHistory) ||
      UPDATE_COMMAND_RE.test(activeUserHistory) ||
      INVENTORY_MUTATION_RE.test(activeUserHistory);

    return {
      kind: "task_continuation",
      needsRecipes: activeNeedsRecipes,
      needsInventory: activeNeedsInventory,
      needsBjcp: activeNeedsRecipes || activeIsCreationOrMutation || mentionsBjcp,
      needsCalculators: CALCULATOR_COMMAND_RE.test(activeUserHistory),
      needsSettings: activeNeedsRecipes || activeIsCreationOrMutation,
      allowMutation: activeIsCreationOrMutation && !hasNegatedMutation,
      isolatedHistory: false,
    };
  }

  // 8. General technical/brewing question ("O que é OG?", "Como fazer uma IPA?", etc.)
  if (
    isConceptual ||
    hasNegatedMutation ||
    mentionsBjcp ||
    /\b(og|fg|abv|ibu|ebc|srm|mostura|fermentacao|lupulo|malte|levedura|brassagem|dry hop|priming|carbonatacao|agua|ph|estilo|cerveja)\b/.test(text)
  ) {
    return {
      kind: "general_question",
      needsRecipes: false,
      needsInventory: false,
      needsBjcp: mentionsBjcp,
      needsCalculators: false,
      needsSettings: false,
      allowMutation: false,
      isolatedHistory: !ANAPHORA_RE.test(text),
    };
  }

  return {
    kind: "unclear",
    needsRecipes: false,
    needsInventory: false,
    needsBjcp: false,
    needsCalculators: false,
    needsSettings: false,
    allowMutation: false,
    isolatedHistory: true,
  };
}

export function prepareCopilotTurn(
  userText: string,
  previousMessages: CopilotChatMessage[],
  tools: CopilotTools,
  opts: { hasImage?: boolean; currentUserMessage?: CopilotChatMessage } = {},
): CopilotTurnPlan {
  const intent = classifyCopilotIntent(userText, previousMessages, { hasImage: opts.hasImage });
  const currentMessage: CopilotChatMessage = opts.currentUserMessage ?? {
    role: "user",
    content: userText,
  };

  const messagesForModel = intent.isolatedHistory
    ? [currentMessage]
    : [...getActiveTaskWindow(previousMessages), currentMessage];

  const consultedTools = {
    recipes: intent.needsRecipes,
    inventory: intent.needsInventory,
    bjcpStyles: intent.needsBjcp,
    calculators: intent.needsCalculators,
    settings: intent.needsSettings,
  };

  const needsAnyContext =
    consultedTools.recipes ||
    consultedTools.inventory ||
    consultedTools.bjcpStyles ||
    consultedTools.calculators ||
    consultedTools.settings;

  if (!needsAnyContext) {
    return {
      intent,
      context: undefined,
      messagesForModel,
      consultedTools,
    };
  }

  const recipes = consultedTools.recipes ? tools.getRecipes() : [];
  const inventory = consultedTools.inventory ? tools.getInventory() : [];
  const settings = consultedTools.settings || consultedTools.recipes ? tools.getSettings() : defaultSettings;

  const context = buildCopilotContext(
    { recipes, inventory, settings },
    {
      recipes: consultedTools.recipes,
      inventory: consultedTools.inventory,
      bjcpStyles: consultedTools.bjcpStyles,
      calculators: consultedTools.calculators,
      settings: consultedTools.settings,
    },
  );

  return {
    intent,
    context,
    messagesForModel,
    consultedTools,
  };
}

export function shouldAllowCopilotMutation(
  userText: string,
  previousMessages: Array<{ role: string; content: string }>,
  actionKind: string,
): boolean {
  const kind = actionKind.toUpperCase();
  const isCreate = kind === "PROPOSE_CREATE_RECIPE" || kind === "CREATE_RECIPE";
  const isUpdate = kind === "PROPOSE_UPDATE_RECIPE" || kind === "UPDATE_RECIPE";
  const isInventory = kind === "PROPOSE_ADD_INVENTORY" || kind === "ADD_INVENTORY";
  const isSetting = kind === "UPDATE_SETTING";

  const text = normalizeIntentText(userText);
  if (!text) return false;
  if (isPureGreeting(text)) return false;

  if (isSetting) {
    return /\b(configuracao|configuracoes|setting|settings|unidade|unidades|eficiencia|idioma|tema|moeda|formula)\b/.test(text);
  }
  if (!isCreate && !isUpdate && !isInventory) return true;

  // Negação explícita de ação (ex.: "não crie receita", "sem salvar")
  if (NEGATED_MUTATION_RE.test(text)) {
    return false;
  }

  // Cancelamento em follow-up
  if (/^(cancelar|cancela|nao|deixa|esqueca|esquece|abortar)$/.test(text)) {
    return false;
  }

  // Perguntas conceituais ("como fazer", "como criar", "o que posso fazer") não são comandos de mutação
  const isConceptualQuestion =
    /^(como|por que|porque|qual|quais|o que|onde|quando)\s+(fazer|criar|montar|editar|calcular|posso fazer|devo fazer|e|significa)\b/.test(text);
  if (isConceptualQuestion && !/\b(no app|no brewcraft|para mim|pra mim|e salve|salva)\b/.test(text)) {
    return false;
  }

  if (isCreate) {
    if (
      /\b(crie|criar|cria|gere|gerar|gera|monte|montar|monta|elabore|elaborar|cadastre|cadastrar|cadastra|salve|salvar|salva|desenvolva|desenvolver|create|generate|build|save)\b/.test(text)
    ) {
      return true;
    }
    if (/\b(faca|fazer|faz)\s+(uma|um|essa|esta|a)\s+(nova\s+)?(receita|cerveja)\b/.test(text)) {
      return true;
    }
    if (EXPLICIT_WANT_CREATE_RE.test(text)) {
      return true;
    }
  }

  if (isUpdate) {
    if (UPDATE_COMMAND_RE.test(text) || /\b(adicione|adicionar)\b/.test(text)) {
      return true;
    }
  }

  if (isInventory) {
    if (/\b(adicione|adicionar|adiciona|cadastre|cadastrar|cadastra|registre|registrar|coloque|colocar|insira|inserir|comprei|some|somar|add|register)\b/.test(text)) {
      return true;
    }
  }

  // Continuação de coleta de dados após proposta incompleta na última resposta do assistente
  // (somente se a mensagem atual não for uma pergunta conceitual solta)
  if (!CONCEPTUAL_QUESTION_RE.test(text)) {
    const activeWindow = getActiveTaskWindow(
      previousMessages.map((m) => ({
        role: m.role === "model" ? "model" : m.role === "system" ? "system" : "user",
        content: m.content,
      })),
    );
    const lastModel = [...activeWindow].reverse().find((m) => m.role === "model");
    if (
      lastModel &&
      (lastModel.content.includes("Não foi possível preparar") ||
        lastModel.content.includes("Responda com as informações necessárias") ||
        lastModel.content.includes("Faltam:"))
    ) {
      return true;
    }
  }

  return false;
}
