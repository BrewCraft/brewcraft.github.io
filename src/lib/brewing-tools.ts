/** Pure calculations for BrewCraft brewing tools: volumes, efficiency, dry hopping, carbonation, costs, pH, optimizer. */
import { platoToSg, sgToPlato, brewhouseEfficiency, carbonation as basicCarbonation } from "./brewing";
import { estimateMashPh, residualAlkalinity, sulfateChlorideRatio, type GrainAddition, type AcidAddition, type WaterProfile, zeroProfile } from "./water-calc";
import { defaultEquipment, recipeCost, recipeIbu, recipeSrm, volumes as baseVolumes, type Equipment, type Recipe, type RecipeFermentable, type RecipeHop, type RecipeYeast } from "./recipe-calc";
import { bjcpStyles, fermentables as catalogFermentables, hops as catalogHops, yeasts as catalogYeasts, type BjcpStyle } from "./catalog";
import type { AppSettings } from "./settings-model";
import { defaultSettings } from "./settings-model";

export interface FullVolumeInput {
  batchL: number;
  grainKg: number;
  mashWaterL: number;
  spargeWaterL: number;
  absorptionLPerKg: number;
  boilMinutes: number;
  evaporationLh: number;
  boilLossL: number;
  whirlpoolLossL: number;
  transferLossL: number;
  fermenterLossL: number;
}

export function fullVolumes(i: FullVolumeInput) {
  const totalWater = Math.max(0, i.mashWaterL + i.spargeWaterL);
  const grainAbsorption = Math.max(0, i.grainKg * i.absorptionLPerKg);
  const evaporation = Math.max(0, i.evaporationLh * i.boilMinutes / 60);
  const preBoil = Math.max(0, totalWater - grainAbsorption);
  const postBoil = Math.max(0, preBoil - evaporation - Math.max(0, i.boilLossL));
  const kettleOut = Math.max(0, postBoil - Math.max(0, i.whirlpoolLossL));
  const fermenter = Math.max(0, kettleOut - Math.max(0, i.transferLossL));
  const packaged = Math.max(0, fermenter - Math.max(0, i.fermenterLossL));
  const totalLosses = grainAbsorption + evaporation + Math.max(0, i.boilLossL) + Math.max(0, i.whirlpoolLossL) + Math.max(0, i.transferLossL) + Math.max(0, i.fermenterLossL);
  return { totalWater, mashWater: Math.max(0, i.mashWaterL), spargeWater: Math.max(0, i.spargeWaterL), grainAbsorption, evaporation, preBoil, postBoil, kettleOut, fermenter, packaged, totalLosses, targetMatch: packaged - Math.max(0, i.batchL) };
}

export interface EfficiencyInput {
  grainKg: number;
  potentialSg: number;
  mashVolumeL: number;
  mashOg: number;
  lauterVolumeL: number;
  preBoilOg: number;
  kettleVolumeL: number;
  kettleOg: number;
}

export function efficiencyBreakdown(i: EfficiencyInput) {
  const potentialPoints = Math.max(0, (i.potentialSg - 1) * 1000 * 8.3454 * Math.max(0, i.grainKg));
  const mashPoints = i.mashVolumeL > 0 ? Math.max(0, (i.mashOg - 1) * 1000 * i.mashVolumeL) : 0;
  const lauterPoints = i.lauterVolumeL > 0 ? Math.max(0, (i.preBoilOg - 1) * 1000 * i.lauterVolumeL) : 0;
  const kettlePoints = i.kettleVolumeL > 0 ? Math.max(0, (i.kettleOg - 1) * 1000 * i.kettleVolumeL) : 0;
  const pct = (a: number) => potentialPoints > 0 ? (a / potentialPoints) * 100 : 0;
  const mashEff = pct(mashPoints);
  const lauterEff = pct(lauterPoints);
  const brewhouseEff = pct(kettlePoints);
  const extractYield = i.grainKg > 0 ? kettlePoints / i.grainKg : 0;
  const extractPotentialKg = potentialPoints / 8.3454; // points in PPG*lb terms normalized
  return { potentialPoints, mashPoints, lauterPoints, kettlePoints, mashEff, lauterEff, brewhouseEff, lauterLossPct: Math.max(0, mashEff - lauterEff), transferLossPct: Math.max(0, lauterEff - brewhouseEff), extractYield, extractPotential: extractPotentialKg };
}

export interface DryHopAddition { name: string; grams: number; days: number; tempC: number }
export interface DryHopInput { volumeL: number; additions: DryHopAddition[] }

export function dryHoppingCalc(i: DryHopInput) {
  const vol = Math.max(0.001, i.volumeL);
  const per = i.additions.map(a => ({ ...a, gPerL: a.grams / vol }));
  const totalGrams = per.reduce((s, a) => s + Math.max(0, a.grams), 0);
  const totalGPerL = totalGrams / vol;
  const avgContactDays = per.length ? per.reduce((s, a) => s + Math.max(0, a.days), 0) / per.length : 0;
  const varietyTotals = new Map<string, number>();
  for (const a of per) varietyTotals.set(a.name || "Lúpulo", (varietyTotals.get(a.name || "Lúpulo") ?? 0) + Math.max(0, a.grams));
  return { totalGrams, totalGPerL, additions: per, varietyTotals: [...varietyTotals.entries()].map(([name, grams]) => ({ name, grams, gPerL: grams / vol })), count: per.length, avgContactDays };
}

export const primingSugars = [
  { id: "sucrose", label: "Sacarose (açúcar de mesa)", factor: 4.0, yield: 1.0 },
  { id: "dextrose", label: "Dextrose monohidratada", factor: 4.4, yield: 0.91 },
  { id: "dme", label: "Extrato seco de malte (DME)", factor: 6.5, yield: 0.65 },
  { id: "honey", label: "Mel", factor: 5.3, yield: 0.75 },
  { id: "candi", label: "Açúcar cristal/candi", factor: 4.1, yield: 0.98 },
  { id: "maple", label: "Xarope de bordo", factor: 5.7, yield: 0.7 },
] as const;

export interface AdvancedCarbonationInput { volumeL: number; beerTempC: number; targetVolumes: number; kegTempC: number; bottles: number; bottleVolumeMl: number }

export function advancedCarbonation(i: AdvancedCarbonationInput) {
  const base = basicCarbonation(i.beerTempC, i.targetVolumes, i.volumeL, 4.0);
  const keg = basicCarbonation(i.kegTempC, i.targetVolumes, i.volumeL, 4.0);
  const sugarPerLiter = i.volumeL > 0 ? base.sugar / i.volumeL : 0;
  const perBottle = i.bottleVolumeMl > 0 ? sugarPerLiter * (i.bottleVolumeMl / 1000) : 0;
  const sugars = primingSugars.map(s => ({ ...s, totalG: Math.max(0, base.sugar * (s.factor / 4.0)), perLiterG: sugarPerLiter * (s.factor / 4.0), perBottleG: perBottle * (s.factor / 4.0) }));
  const totalBottleSugar = perBottle * Math.max(0, i.bottles);
  return { residual: base.residual, target: i.targetVolumes, co2Gl: base.gl, sucroseTotal: base.sugar, sugarPerLiter, perBottleSucrose: perBottle, totalBottles: Math.max(0, i.bottles), totalBottleSugar, kegPsi: keg.psi, kegBar: keg.bar, sugars };
}

export interface CostLine { label: string; qty: number; unit: string; unitPrice: number }
export interface CostInput { ingredients: CostLine[]; packaging: CostLine[]; productionFixed: number; batchL: number; bottleMl: number }

export function costBreakdown(i: CostInput) {
  const lineTotal = (l: CostLine) => Math.max(0, l.qty) * Math.max(0, l.unitPrice);
  const ingredients = i.ingredients.map(l => ({ ...l, total: lineTotal(l) }));
  const packaging = i.packaging.map(l => ({ ...l, total: lineTotal(l) }));
  const ingredientTotal = ingredients.reduce((s, l) => s + l.total, 0);
  const packagingTotal = packaging.reduce((s, l) => s + l.total, 0);
  const production = Math.max(0, i.productionFixed);
  const total = ingredientTotal + packagingTotal + production;
  const costPerLiter = i.batchL > 0 ? total / i.batchL : 0;
  const costPerBottle = i.bottleMl > 0 ? costPerLiter * (i.bottleMl / 1000) : 0;
  return { ingredients, packaging, ingredientTotal, packagingTotal, production, total, costPerLiter, costPerBottle };
}

export function recipeCostIntegrated(r: Pick<Recipe, "fermentables" | "hops" | "yeasts" | "miscs" | "equipment">, packagingCost = 0, productionCost = 0, bottleMl = 500) {
  const c = recipeCost(r);
  const packaged = Math.max(0, r.equipment.batchL - r.equipment.fermenterLossL);
  const total = c.total + Math.max(0, packagingCost) + Math.max(0, productionCost);
  return { ...c, packaging: Math.max(0, packagingCost), production: Math.max(0, productionCost), total, costPerLiter: packaged > 0 ? total / packaged : 0, costPerBottle: packaged > 0 && bottleMl > 0 ? (total / packaged) * (bottleMl / 1000) : 0, packagedL: packaged };
}

export interface MashPhInput {
  grains: GrainAddition[];
  mashWaterL: number;
  source: WaterProfile;
  salts: Record<string, number>;
  acids: AcidAddition;
}

export function mashPhTool(i: MashPhInput) {
  const profile = i.salts && Object.keys(i.salts).length ? { ...i.source } : i.source;
  // apply salts inline to get mash profile
  let mashProfile = { ...profile } as WaterProfile;
  const salts = i.salts ?? {};
  // reuse estimateMashPh with adjusted water via apply-like contribution
  // simple local apply
  const literSafe = Math.max(0.001, i.mashWaterL);
  // dynamic import avoidance: replicate small apply
  const saltDefs = [
    { id: "gypsum", ppm: { ca: 232.8, so4: 557.9 } }, { id: "cacl2", ppm: { ca: 272.6, cl: 482.3 } },
    { id: "cacl2_anhydrous", ppm: { ca: 361.1, cl: 638.9 } }, { id: "epsom", ppm: { mg: 98.6, so4: 389.6 } },
    { id: "mgcl2", ppm: { mg: 119.6, cl: 348.8 } }, { id: "nacl", ppm: { na: 393.4, cl: 606.6 } },
    { id: "bicarb", ppm: { na: 273.7, hco3: 726.4 } }, { id: "chalk", ppm: { ca: 400.4, hco3: 1219.2 } },
  ] as const;
  for (const s of saltDefs) {
    const g = salts[s.id] ?? 0; if (g <= 0) continue;
    for (const [ion, ppmPerGram] of Object.entries(s.ppm) as [keyof WaterProfile, number][]) mashProfile[ion] += (g * ppmPerGram) / literSafe;
  }
  const est = estimateMashPh(i.grains, i.mashWaterL, mashProfile, i.acids);
  return { ...est, profile: mashProfile, ratio: sulfateChlorideRatio(mashProfile), ra: residualAlkalinity(mashProfile) };
}

export interface OptimizerInput {
  styleCode: string;
  batchL: number;
  efficiency: number;
  targetOg: number;
  targetIbu: number;
  targetEbc: number;
  availableFermentables?: string[];
  availableHops?: string[];
  availableYeasts?: string[];
}

function pickAvailable<T extends { name: string }>(pool: T[], available: string[] | undefined, fallback: T[]) {
  if (!available || available.length === 0) return fallback;
  const set = new Set(available.map(s => s.toLowerCase()));
  const found = pool.filter(p => set.has(p.name.toLowerCase()));
  return found.length ? found : fallback;
}

export function optimizeRecipe(i: OptimizerInput) {
  const style = bjcpStyles.find(s => s.code === i.styleCode) || bjcpStyles[0];
  const eff = Math.max(40, Math.min(95, i.efficiency)) / 100;
  const targetOg = Math.min(style.og[1] + 0.005, Math.max(style.og[0] - 0.005, i.targetOg));
  const targetIbu = Math.min(style.ibu[1], Math.max(style.ibu[0], i.targetIbu));
  const targetEbc = Math.min(style.srm[1] * 1.97, Math.max(style.srm[0] * 1.97, i.targetEbc));

  const fermPool = pickAvailable(catalogFermentables, i.availableFermentables, catalogFermentables.slice(0, 40));
  const base = fermPool.find(f => f.type === "Base" || /pilsen|pale|pilsner/i.test(f.name)) || fermPool[0];
  const specialty = fermPool.find(f => f !== base && (f.color > 10 || /caramel|crystal|munich|vienna|cara/i.test(f.name))) || fermPool[1] || base;
  const dark = fermPool.find(f => f !== base && f.color >= 100) || specialty;

  const volPost = Math.max(1, i.batchL + 1);
  const totalPoints = (targetOg - 1) * 1000 * volPost;
  const basePot = (base.potential - 1) * 1000 * 8.3454 * eff;
  let baseKg = basePot > 0 ? (totalPoints * 0.9) / basePot : 4;
  let specKg = targetEbc > 30 ? Math.max(0.1, baseKg * 0.12) : targetEbc > 15 ? Math.max(0.05, baseKg * 0.07) : Math.max(0, baseKg * 0.03);
  let darkKg = targetEbc > 60 ? Math.max(0.05, baseKg * 0.06) : 0;
  // adjust color roughly
  const colorFactor = targetEbc / Math.max(5, (base.color * baseKg + specialty.color * specKg + (dark?.color ?? 0) * darkKg) * 2.2046 / (volPost / 3.785) * 1.97 || 5);
  if (Number.isFinite(colorFactor) && colorFactor > 0) { specKg *= Math.min(3, Math.max(0.3, colorFactor)); darkKg *= Math.min(3, Math.max(0.3, colorFactor)); }

  const fermentables = [{ name: base.name, kg: Math.round(baseKg * 100) / 100, potential: base.potential, color: base.color, type: base.type }];
  if (specKg > 0.02 && specialty !== base) fermentables.push({ name: specialty.name, kg: Math.round(specKg * 100) / 100, potential: specialty.potential, color: specialty.color, type: specialty.type });
  if (darkKg > 0.02 && dark && dark !== base) fermentables.push({ name: dark.name, kg: Math.round(darkKg * 100) / 100, potential: dark.potential, color: dark.color, type: dark.type });

  const hopPool = pickAvailable(catalogHops, i.availableHops, catalogHops.slice(0, 40));
  const bitterHop = hopPool.find(h => /magnum|warrior|columbus|chinook|target/i.test(h.name)) || hopPool[0];
  const aromaHop = hopPool.find(h => h !== bitterHop && /cascade|citra|centennial|saaz|hallertau|amarillo/i.test(h.name)) || hopPool[1] || bitterHop;
  const boilVol = volPost;
  const estOg = targetOg;
  const bitterAlpha = bitterHop?.alpha ?? 12;
  const util60 = 1.65 * 0.000125 ** (estOg - 1) * ((1 - Math.exp(-0.04 * 60)) / 4.15);
  const bitterGrams = util60 > 0 ? (targetIbu * 0.7 * boilVol) / (bitterAlpha * 10 * util60) : 20;
  const aromaGrams = Math.max(10, bitterGrams * 0.8);
  const hops = [
    { name: bitterHop?.name ?? "Magnum", grams: Math.round(Math.max(5, bitterGrams) * 10) / 10, alpha: bitterAlpha, minutes: 60, use: "fervura" },
    { name: aromaHop?.name ?? "Cascade", grams: Math.round(aromaGrams * 10) / 10, alpha: aromaHop?.alpha ?? 6, minutes: 10, use: "fervura" },
  ];

  const yeastPool = pickAvailable(catalogYeasts, i.availableYeasts, catalogYeasts);
  const ale = style.abv[1] >= 7 ? yeastPool.find(y => /us-05|nottingham|belgian|s-04/i.test(y.name)) : yeastPool.find(y => /us-05|s-04|safale|nottingham|wlp001/i.test(y.name));
  const lager = yeastPool.find(y => /lager|34\/70|w-34|s-23/i.test(y.name));
  const yeast = /lager|pils|bock|märzen|helles|schwarz|vienna lager/i.test(style.name) ? (lager || ale || yeastPool[0]) : (ale || yeastPool[0]);

  const grainTotal = fermentables.reduce((s, f) => s + f.kg, 0);
  const points = fermentables.reduce((s, f) => s + (f.potential - 1) * 1000 * 8.3454 * f.kg * eff, 0);
  const og = 1 + points / volPost / 1000;
  const fg = 1 + (og - 1) * (1 - (yeast?.attenuation ?? 75) / 100);
  const ibuApprox = hops.reduce((s, h) => s + (h.grams * h.alpha * 10 / boilVol) * (1.65 * 0.000125 ** (og - 1)) * ((1 - Math.exp(-0.04 * h.minutes)) / 4.15), 0);
  const mcu = fermentables.reduce((s, f) => s + f.kg * 2.2046 * f.color, 0) / (volPost / 3.785);
  const srm = mcu > 0 ? 1.4922 * mcu ** 0.6859 : 0;
  const abv = Math.max(0, (og - fg) * 131.25);
  const warnings: string[] = [];
  if (i.availableFermentables?.length && fermentables.length < 1) warnings.push("Poucos fermentáveis disponíveis; sugestão baseada no catálogo.");
  if (og < style.og[0] || og > style.og[1]) warnings.push("OG estimada fora da faixa do estilo; ajuste eficiência ou carga de grãos.");
  if (ibuApprox < style.ibu[0] || ibuApprox > style.ibu[1]) warnings.push("IBU estimado fora da faixa do estilo; ajuste lúpulos.");
  return {
    style: { code: style.code, name: style.name, ranges: { og: style.og, fg: style.fg, ibu: style.ibu, srm: style.srm, abv: style.abv } },
    fermentables, hops, yeast: yeast ? { name: yeast.name, attenuation: yeast.attenuation, form: yeast.form } : null,
    estimates: { og: Math.round(og * 10000) / 10000, fg: Math.round(fg * 10000) / 10000, abv: Math.round(abv * 100) / 100, ibu: Math.round(ibuApprox * 10) / 10, srm: Math.round(srm * 10) / 10, ebc: Math.round(srm * 1.97 * 10) / 10, grainKg: Math.round(grainTotal * 100) / 100 },
    notes: ["Sugestão estimada a partir de catálogo, estilo e limitações informadas; valide com seu equipamento e ingredientes.", ...warnings],
  };
}
