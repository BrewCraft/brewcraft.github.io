/** Pure recipe, water, inventory and report calculations. Units: kg, g, L, °C, SG. */
import { alcohol, ibuTinseth } from "./brewing";
import { calculateAbv, defaultSettings, type AppSettings } from "./settings-model";
import type { BjcpStyle } from "./catalog";

export type HopUse = "fervura" | "whirlpool" | "dryhop" | "primeiro_mosto";
export interface RecipeFermentable { id: string; name: string; kg: number; potential: number; color: number; type: string; price: number }
export interface RecipeHop { id: string; name: string; grams: number; alpha: number; minutes: number; use: HopUse; price: number; dryHopDay?: number }
export interface RecipeYeast { id: string; name: string; attenuation: number; packs: number; price: number }
export interface RecipeMisc { id: string; name: string; amount: number; unit: string; use: string; price: number }
export interface Equipment { batchL: number; boilMinutes: number; evaporationLh: number; trubLossL: number; fermenterLossL: number; efficiency: number }
export interface MashStep { name: string; tempC: number; minutes: number }

export interface Recipe {
  id: string; name: string; styleCode: string; author: string; notes: string;
  equipment: Equipment; mashSteps: MashStep[]; fermentationTempC: number; fermentationDays: number;
  waterProfileId?: string; equipmentProfileId?: string; mashProfileId?: string; fermentationProfileId?: string;
  fermentables: RecipeFermentable[]; hops: RecipeHop[]; yeasts: RecipeYeast[]; miscs: RecipeMisc[];
  favorite?: boolean; createdAt: string; updatedAt: string;
}

export const defaultEquipment: Equipment = { batchL: 20, boilMinutes: 60, evaporationLh: 4, trubLossL: 1, fermenterLossL: 1, efficiency: 72 };

export function volumes(eq: Equipment) {
  const postBoil = eq.batchL + eq.trubLossL;
  const preBoil = postBoil + eq.evaporationLh * eq.boilMinutes / 60;
  return { postBoil, preBoil, fermenter: eq.batchL, packaged: Math.max(0, eq.batchL - eq.fermenterLossL) };
}

export function originalGravity(fermentables: RecipeFermentable[], eq: Equipment) {
  const vol = volumes(eq).postBoil;
  if (vol <= 0) return 1;
  const points = fermentables.reduce((sum, f) => {
    const eff = f.type === "grao" || f.type === "adjunto" ? eq.efficiency / 100 : 1;
    // potential is SG per lb/gal (PPG); 1 kg/L = 8.3454 lb/gal
    return sum + (f.potential - 1) * 1000 * 8.3454 * f.kg * eff;
  }, 0);
  return 1 + points / vol / 1000;
}

export function finalGravity(og: number, yeasts: RecipeYeast[]) {
  const att = yeasts.length ? Math.max(...yeasts.map(y => y.attenuation)) : 75;
  return 1 + (og - 1) * (1 - att / 100);
}

export function recipeIbu(hops: RecipeHop[], og: number, eq: Equipment, formula: AppSettings["ibuFormula"] = "tinseth") {
  const vol = volumes(eq).postBoil;
  return hops.reduce((sum, h) => {
    if (h.use === "dryhop") return sum;
    const minutes = h.use === "primeiro_mosto" ? eq.boilMinutes + 20 : h.use === "whirlpool" ? Math.min(h.minutes, 30) * 0.5 : h.minutes;
    if (vol <= 0) return sum;
    if (formula === "rager") {
      const utilization = (18.11 + 13.86 * Math.tanh((minutes - 31.32) / 18.27)) / 100;
      return sum + utilization * h.grams * h.alpha * 10 / (vol * (1 + Math.max(0, (og - 1.05) / 0.2)));
    }
    return sum + ibuTinseth(h.grams, h.alpha, minutes, vol, og);
  }, 0);
}

export function recipeSrm(fermentables: RecipeFermentable[], eq: Equipment) {
  const gal = volumes(eq).postBoil / 3.785411784;
  if (gal <= 0) return 0;
  const mcu = fermentables.reduce((s, f) => s + f.kg * 2.2046226218 * f.color, 0) / gal;
  return mcu <= 0 ? 0 : 1.4922 * mcu ** 0.6859;
}

export function recipeCost(r: Pick<Recipe, "fermentables" | "hops" | "yeasts" | "miscs">) {
  const fermentables = r.fermentables.reduce((s, f) => s + f.kg * f.price, 0);
  const hops = r.hops.reduce((s, h) => s + h.grams / 1000 * h.price, 0);
  const yeasts = r.yeasts.reduce((s, y) => s + y.packs * y.price, 0);
  const miscs = r.miscs.reduce((s, m) => s + m.amount * m.price, 0);
  return { fermentables, hops, yeasts, miscs, total: fermentables + hops + yeasts + miscs };
}

export function recipeStats(r: Recipe, settings: AppSettings = defaultSettings) {
  const og = originalGravity(r.fermentables, r.equipment);
  const baseFg = finalGravity(og, r.yeasts);
  const saccharification = r.mashSteps.filter(s => s.tempC >= 55 && s.tempC <= 75 && s.minutes > 0);
  const mashMinutes = saccharification.reduce((sum, s) => sum + s.minutes, 0);
  const mashTemp = mashMinutes ? saccharification.reduce((sum, s) => sum + s.tempC * s.minutes, 0) / mashMinutes : settings.mashReference;
  const fg = settings.fgFormula === "mash" ? Math.min(og, Math.max(1, baseFg + (og - 1) * (mashTemp - settings.mashReference) * settings.mashAdjustment / 100)) : baseFg;
  const ibu = recipeIbu(r.hops, og, r.equipment, settings.ibuFormula);
  const buGu = og > 1 ? ibu / ((og - 1) * 1000) : 0;
  const attenuation = og > 1 ? (og - fg) / (og - 1) : 0;
  const cost = recipeCost(r);
  const vol = volumes(r.equipment);
  return {
    og, fg, abv: calculateAbv(og, fg, settings.abvFormula), ibu, srm: recipeSrm(r.fermentables, r.equipment),
    buGu, rbr: buGu * (1 + attenuation - 0.765), calories: alcohol(og, fg, 100).calories,
    grainKg: r.fermentables.reduce((s, f) => s + f.kg, 0), volumes: vol, cost, costPerLiter: vol.packaged > 0 ? cost.total / vol.packaged : 0,
  };
}

export type StyleStatus = "baixo" | "ok" | "alto";
export function styleCheck(stats: { og: number; fg: number; ibu: number; srm: number; abv: number }, style: BjcpStyle) {
  const check = (v: number, [min, max]: [number, number]): StyleStatus => (v < min ? "baixo" : v > max ? "alto" : "ok");
  return { og: check(stats.og, style.og), fg: check(stats.fg, style.fg), ibu: check(stats.ibu, style.ibu), srm: check(stats.srm, style.srm), abv: check(stats.abv, style.abv) };
}

/** Approximate sRGB for an SRM value (for color swatches). */
export function srmToHex(srm: number) {
  const s = Math.max(0, Math.min(40, srm));
  const r = Math.round(Math.min(255, Math.max(0, 255 * 0.975 ** s)));
  const g = Math.round(Math.min(255, Math.max(0, 255 * 0.88 ** s)));
  const b = Math.round(Math.min(255, Math.max(0, 255 * 0.7 ** s)));
  return `rgb(${r}, ${g}, ${b})`;
}

// ---------- Water chemistry ----------
export type Ion = "ca" | "mg" | "na" | "so4" | "cl" | "hco3";
export type WaterProfile = Record<Ion, number>;
export const ions: { id: Ion; label: string }[] = [
  { id: "ca", label: "Cálcio (Ca)" }, { id: "mg", label: "Magnésio (Mg)" }, { id: "na", label: "Sódio (Na)" },
  { id: "so4", label: "Sulfato (SO₄)" }, { id: "cl", label: "Cloreto (Cl)" }, { id: "hco3", label: "Bicarbonato (HCO₃)" },
];
/** ppm contributed by 1 g of salt in 1 L. */
export const salts: { id: string; label: string; ppm: Partial<WaterProfile> }[] = [
  { id: "gypsum", label: "Gipsita (CaSO₄·2H₂O)", ppm: { ca: 232.8, so4: 557.9 } },
  { id: "cacl2", label: "Cloreto de Cálcio (CaCl₂·2H₂O)", ppm: { ca: 272.6, cl: 482.3 } },
  { id: "epsom", label: "Sal Amargo (MgSO₄·7H₂O)", ppm: { mg: 98.6, so4: 389.6 } },
  { id: "nacl", label: "Sal de Cozinha (NaCl)", ppm: { na: 393.4, cl: 606.6 } },
  { id: "bicarb", label: "Bicarbonato de Sódio (NaHCO₃)", ppm: { na: 273.7, hco3: 726.4 } },
  { id: "chalk", label: "Giz (CaCO₃)", ppm: { ca: 400.4, hco3: 1219.2 } },
];

export function applySalts(source: WaterProfile, additionsG: Record<string, number>, liters: number): WaterProfile {
  const out = { ...source };
  if (liters <= 0) return out;
  for (const s of salts) {
    const g = additionsG[s.id] || 0;
    for (const [ion, ppm] of Object.entries(s.ppm) as [Ion, number][]) out[ion] += g * ppm / liters;
  }
  return out;
}

/** Greedy non-negative salt suggestion to approach a target profile using gypsum, CaCl₂, Epsom and NaCl. */
export function suggestSalts(source: WaterProfile, target: WaterProfile, liters: number) {
  const g = (deficit: number, ppm: number) => Math.max(0, deficit) * liters / ppm;
  const add: Record<string, number> = {};
  add.epsom = g(target.mg - source.mg, 98.6);
  let cur = applySalts(source, add, liters);
  add.gypsum = g(target.so4 - cur.so4, 557.9);
  cur = applySalts(source, add, liters);
  add.cacl2 = g(target.cl - cur.cl, 482.3);
  cur = applySalts(source, add, liters);
  add.nacl = g(target.na - cur.na, 393.4);
  for (const k of Object.keys(add)) add[k] = Math.round(add[k] * 10) / 10;
  return add;
}

export const sulfateChlorideRatio = (w: WaterProfile) => (w.cl > 0 ? w.so4 / w.cl : 0);

// ---------- Inventory ----------
export type InventoryKind = "fermentavel" | "lupulo" | "levedura" | "outro";
export interface InventoryItem { id: string; kind: InventoryKind; name: string; amount: number; unit: string; price: number; minAmount: number; alpha?: number; potential?: number; color?: number; attenuation?: number }

/** Required amounts per recipe in inventory units (kg, g, pacote, un). */
export function recipeRequirements(r: Recipe) {
  const req: { kind: InventoryKind; name: string; amount: number; unit: string; price: number }[] = [];
  const add = (kind: InventoryKind, name: string, amount: number, unit: string, price: number) => {
    const ex = req.find(x => x.kind === kind && x.name.toLowerCase() === name.toLowerCase());
    if (ex) ex.amount += amount; else req.push({ kind, name, amount, unit, price });
  };
  r.fermentables.forEach(f => add("fermentavel", f.name, f.kg, "kg", f.price));
  r.hops.forEach(h => add("lupulo", h.name, h.grams, "g", h.price / 1000));
  r.yeasts.forEach(y => add("levedura", y.name, y.packs, "pacote", y.price));
  r.miscs.forEach(m => add("outro", m.name, m.amount, m.unit, m.price));
  return req;
}

const findItem = (inv: InventoryItem[], kind: InventoryKind, name: string) => inv.find(i => i.kind === kind && i.name.toLowerCase() === name.toLowerCase());

export function shoppingList(r: Recipe, inv: InventoryItem[]) {
  return recipeRequirements(r).map(req => {
    const have = findItem(inv, req.kind, req.name)?.amount ?? 0;
    const missing = Math.max(0, req.amount - have);
    return { ...req, have, missing, cost: missing * req.price };
  });
}

export function deductInventory(r: Recipe, inv: InventoryItem[], allowNegative = false): InventoryItem[] {
  const next = inv.map(i => ({ ...i }));
  for (const req of recipeRequirements(r)) {
    const item = findItem(next, req.kind, req.name);
    if (item) {
      const amount = Math.round((item.amount - req.amount) * 1000) / 1000;
      item.amount = allowNegative ? amount : Math.max(0, amount);
    } else if (allowNegative) next.push({ id: `missing-${req.kind}-${req.name}`, ...req, amount: -req.amount, minAmount: 0 });
  }
  return next;
}

// ---------- Batches ----------
export type BatchStatus = "planejamento" | "brassagem" | "fermentacao" | "condicionamento" | "concluido";
export const batchStatuses: { id: BatchStatus; label: string }[] = [
  { id: "planejamento", label: "Planejamento" }, { id: "brassagem", label: "Brassagem" }, { id: "fermentacao", label: "Fermentação" },
  { id: "condicionamento", label: "Condicionamento" }, { id: "concluido", label: "Concluído" },
];
export interface Measurement { id: string; date: string; sg: number; tempC: number; note?: string }
export interface Batch {
  id: string; number: number; name: string; recipeId: string; recipe: Recipe; status: BatchStatus;
  brewDate: string; measuredOg?: number; measuredFg?: number; measuredVolumeL?: number;
  measurements: Measurement[]; notes: string; inventoryDeducted: boolean; createdAt: string;
  additionalMeasurements?: Record<string, number>;
}

export function batchAbv(b: Batch, settings: AppSettings = defaultSettings) {
  const og = b.measuredOg ?? recipeStats(b.recipe, settings).og;
  const last = [...b.measurements].sort((a, c) => a.date.localeCompare(c.date)).at(-1);
  const fg = b.measuredFg ?? last?.sg;
  return fg ? calculateAbv(og, fg, settings.abvFormula) : undefined;
}

/** Boil-timer events: hop/misc additions sorted by minutes remaining. */
export function boilSchedule(r: Recipe) {
  const events = r.hops.filter(h => h.use === "fervura" || h.use === "primeiro_mosto")
    .map(h => ({ minutes: h.use === "primeiro_mosto" ? r.equipment.boilMinutes : h.minutes, label: `${h.grams} g ${h.name}` }));
  r.hops.filter(h => h.use === "whirlpool").forEach(h => events.push({ minutes: 0, label: `Whirlpool: ${h.grams} g ${h.name}` }));
  r.miscs.filter(m => m.use === "Fervura").forEach(m => events.push({ minutes: 10, label: `${m.amount} ${m.unit} ${m.name}` }));
  return events.sort((a, b) => b.minutes - a.minutes);
}

// ---------- Reports ----------
export function reportSummary(batches: Batch[]) {
  const done = batches.filter(b => b.status === "concluido" || b.status === "condicionamento");
  const liters = batches.filter(b => b.status !== "planejamento").reduce((s, b) => s + (b.measuredVolumeL ?? b.recipe.equipment.batchL), 0);
  const cost = batches.reduce((s, b) => s + recipeCost(b.recipe).total, 0);
  const byMonth = new Map<string, { month: string; litros: number; custo: number; lotes: number }>();
  for (const b of batches) {
    const month = b.brewDate.slice(0, 7);
    const e = byMonth.get(month) ?? { month, litros: 0, custo: 0, lotes: 0 };
    e.litros += b.status === "planejamento" ? 0 : b.measuredVolumeL ?? b.recipe.equipment.batchL;
    e.custo += recipeCost(b.recipe).total; e.lotes += 1;
    byMonth.set(month, e);
  }
  const hopUse = new Map<string, number>();
  const maltUse = new Map<string, number>();
  for (const b of batches) {
    b.recipe.hops.forEach(h => hopUse.set(h.name, (hopUse.get(h.name) ?? 0) + h.grams));
    b.recipe.fermentables.forEach(f => maltUse.set(f.name, (maltUse.get(f.name) ?? 0) + f.kg));
  }
  const top = (m: Map<string, number>) => [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  return {
    totalBatches: batches.length, finished: done.length, liters, cost, costPerLiter: liters > 0 ? cost / liters : 0,
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)), hops: top(hopUse), malts: top(maltUse),
  };
}
