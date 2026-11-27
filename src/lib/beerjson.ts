/** BeerJSON 1.x import/export utilities (https://beerjson.org). */
import {
  defaultEquipment,
  type Recipe,
  type RecipeFermentable,
  type RecipeHop,
  type RecipeYeast,
  type RecipeMisc,
  type MashStep,
  type HopUse,
} from "./recipe-calc";
import { allStyles } from "./store";

const BJ_VERSION = "1.0.0";

function v(obj: Record<string, unknown>, key: string): number {
  if (!obj || typeof obj !== "object") return 0;
  const v = obj[key];
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof v.value === "number") {
    const unit = v.unit;
    const factor: Record<string, number> = {
      kg: 1, g: 0.001, lb: 0.453592, oz: 0.0283495,
      l: 1, L: 1, ml: 0.001, "us gal": 3.78541, gal: 3.78541,
      c: 1, // celsius already
      f: 0, // handled separately
      min: 1, s: 1 / 60, h: 60,
    };
    if (unit === "f") return (v.value - 32) * 5 / 9;
    return v.value * (factor[unit] ?? 1);
  }
  return 0;
}

function mapHopUseToBrewcraft(use: string, timing: unknown): HopUse {
  const u = (use || "").toLowerCase();
  if (u.includes("dry")) return "dryhop";
  if (u.includes("whirl") || u.includes("aroma") || u.includes("flame")) return "whirlpool";
  if (u.includes("first")) return "primeiro_mosto";
  return "fervura";
}

function mapFermentableTypeToBrewcraft(t: string): string {
  const x = (t || "").toLowerCase();
  if (x.includes("sugar") || x.includes("honey")) return "acucar";
  if (x.includes("extract")) return "extrato";
  if (x.includes("adjunct") || x.includes("fruit") || x.includes("juice")) return "adjunto";
  return "grao";
}

function mapFermentableTypeToBeerJson(t: string): string {
  const x = (t || "").toLowerCase();
  if (x === "acucar") return "sugar";
  if (x === "extrato") return "extract";
  if (x === "adjunto") return "adjunct";
  return "grain";
}

export function recipeToBeerJson(recipe: Recipe): string {
  const boilHours = recipe.equipment.boilMinutes > 0 ? recipe.equipment.boilMinutes / 60 : 1;
  const boilVol = recipe.equipment.batchL + recipe.equipment.trubLossL + recipe.equipment.evaporationLh * boilHours;

  const fermentableAdditions = recipe.fermentables.map(f => ({
    name: f.name,
    type: mapFermentableTypeToBeerJson(f.type),
    amount: { value: f.kg, unit: "kg" },
    yield: { potential: { value: f.potential, unit: "sg" } },
    color: { value: f.color, unit: "lovibond" },
  }));

  const hopAdditions = recipe.hops.map(h => ({
    name: h.name,
    alpha_acid: { value: h.alpha, unit: "%" },
    amount: { value: h.grams / 1000, unit: "kg" },
    timing: {
      use: h.use === "dryhop" ? "Dry Hop" : h.use === "whirlpool" ? "Whirlpool" : h.use === "primeiro_mosto" ? "First Wort" : "Boil",
      duration: { value: h.use === "dryhop" ? (h.dryHopDay ?? 3) * 1440 : h.minutes, unit: "min" },
    },
  }));

  const cultureAdditions = recipe.yeasts.map(y => ({
    name: y.name,
    type: "ale",
    form: "dry",
    attenuation: { value: y.attenuation, unit: "%" },
    amount: { value: y.packs, unit: "pkg" },
  }));

  const miscAdditions = recipe.miscs.map(m => ({
    name: m.name,
    type: "Other",
    use: m.use || "Boil",
    amount: m.unit === "g" ? { value: m.amount / 1000, unit: "kg" } : { value: m.amount, unit: m.unit === "kg" ? "kg" : "each" },
  }));

  const doc = {
    beerjson: {
      version: BJ_VERSION,
      recipes: [
        {
          name: recipe.name,
          type: "All Grain",
          author: recipe.author || undefined,
          created: recipe.createdAt ? recipe.createdAt.slice(0, 10) : undefined,
          batch_size: { value: recipe.equipment.batchL, unit: "l" },
          efficiency: { brewhouse: { value: recipe.equipment.efficiency, unit: "%" } },
          notes: recipe.notes || undefined,
          original_gravity: undefined,
          ingredients: {
            fermentable_additions: fermentableAdditions,
            hop_additions: hopAdditions,
            culture_additions: cultureAdditions,
            miscellaneous_additions: miscAdditions,
          },
          mash: recipe.mashSteps.length > 0 ? {
            name: "Perfil de Mostura",
            grain_temperature: { value: 20, unit: "c" },
            steps: recipe.mashSteps.map(s => ({
              name: s.name,
              type: "Temperature",
              step_temperature: { value: s.tempC, unit: "c" },
              step_time: { value: s.minutes, unit: "min" },
            })),
          } : undefined,
          fermentation: {
            name: "Fermentação",
            steps: [
              {
                type: "primary",
                step_temperature: { value: recipe.fermentationTempC, unit: "c" },
                step_time: { value: recipe.fermentationDays, unit: "day" },
              },
            ],
          },
          boil: {
            boil_time: { value: recipe.equipment.boilMinutes, unit: "min" },
          },
          equipment: {
            name: "Equipamento BrewCraft",
            batch_size: { value: recipe.equipment.batchL, unit: "l" },
            boil_size: { value: Number(boilVol.toFixed(2)), unit: "l" },
            boil_time: { value: recipe.equipment.boilMinutes, unit: "min" },
            evaporation_rate: { value: recipe.equipment.evaporationLh, unit: "l/h" },
            trub_chiller_loss: { value: recipe.equipment.trubLossL, unit: "l" },
            fermenter_loss: { value: recipe.equipment.fermenterLossL, unit: "l" },
          },
          style: recipe.styleCode ? { name: recipe.styleCode, category: "BJCP" } : undefined,
        },
      ],
    },
  };
  return JSON.stringify(doc, null, 2);
}

export function parseBeerJsonAll(json: string): Partial<Recipe>[] {
  if (!json || !json.trim()) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed.beerjson ?? parsed;
  if (!root || typeof root !== "object") return [];
  const recipes = Array.isArray(root.recipes) ? root.recipes : [];
  if (recipes.length === 0) return [];

  const results: Partial<Recipe>[] = [];
  for (const r of recipes as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    try {
      const name = (r.name && String(r.name).trim()) || "Importada";
      const author = r.author ? String(r.author) : "";
      const notes = r.notes ? String(r.notes) : "";

      const batchSize = v(r, "batch_size") || v(r.equipment, "batch_size") || defaultEquipment.batchL;
      const boilTime = v(r.boil, "boil_time") || v(r.equipment, "boil_time") || defaultEquipment.boilMinutes;
      const efficiency = v(r.efficiency, "brewhouse") || v(r.efficiency, "mash") || defaultEquipment.efficiency;
      const boilSize = v(r.equipment, "boil_size");
      const evapRate = v(r.equipment, "evaporation_rate");
      const trubLoss = v(r.equipment, "trub_chiller_loss") || defaultEquipment.trubLossL;
      const fermLoss = v(r.equipment, "fermenter_loss") || defaultEquipment.fermenterLossL;

      let evaporationLh = defaultEquipment.evaporationLh;
      if (evapRate > 0) evaporationLh = Number(evapRate.toFixed(2));
      else if (boilSize > batchSize + trubLoss && boilTime > 0) {
        evaporationLh = Number((((boilSize - batchSize - trubLoss) * 60) / boilTime).toFixed(2));
      }

      const styleCode = r.style && (r.style.category_number || r.style.name)
        ? String(r.style.category_number || r.style.name).replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(0, 4)
        : "";

      // Fermentables
      const fermentables: RecipeFermentable[] = [];
      const fAdds = r.ingredients?.fermentable_additions ?? [];
      for (const f of fAdds) {
        const amountKg = v(f, "amount");
        const potential = v(f.yield, "potential") || v(f, "potential") || 1.037;
        const color = v(f.color, "value") || v(f, "color") || 3;
        const xmlType = f.type || "grain";
        fermentables.push({
          id: crypto.randomUUID(),
          name: f.name || "Malte",
          kg: amountKg > 0 ? amountKg : 0,
          potential: potential > 1 ? potential : 1.037,
          color,
          type: mapFermentableTypeToBrewcraft(xmlType),
          price: 0,
        });
      }

      // Hops
      const hops: RecipeHop[] = [];
      const hAdds = r.ingredients?.hop_additions ?? [];
      for (const h of hAdds) {
        const amountKg = v(h, "amount");
        const alpha = v(h, "alpha_acid") || 0;
        const useRaw = h.timing?.use || "Boil";
        const use = mapHopUseToBrewcraft(useRaw, h.timing);
        const timeVal = v(h.timing, "duration") || v(h.timing, "time") || 0;
        let minutes = timeVal;
        let dryHopDay: number | undefined;
        if (use === "dryhop") {
          minutes = 0;
          if (timeVal >= 1440) dryHopDay = Math.max(1, Math.round(timeVal / 1440));
          else if (timeVal > 0 && timeVal <= 30) dryHopDay = Math.round(timeVal);
          else if (timeVal > 0) dryHopDay = Math.round(timeVal);
          else dryHopDay = 3;
        }
        hops.push({
          id: crypto.randomUUID(),
          name: h.name || "Lúpulo",
          grams: Number((amountKg * 1000).toFixed(1)),
          alpha,
          minutes,
          use,
          price: 0,
          ...(dryHopDay !== undefined ? { dryHopDay } : {}),
        });
      }

      // Yeasts
      const yeasts: RecipeYeast[] = [];
      const cAdds = r.ingredients?.culture_additions ?? [];
      for (const y of cAdds) {
        const att = v(y, "attenuation") || 75;
        const amount = v(y, "amount");
        yeasts.push({
          id: crypto.randomUUID(),
          name: y.name || "Levedura",
          attenuation: att > 0 ? att : 75,
          packs: amount >= 1 ? Math.round(amount) : 1,
          price: 0,
        });
      }
      if (yeasts.length === 0) {
        yeasts.push({ id: crypto.randomUUID(), name: "US-05", attenuation: 75, packs: 1, price: 0 });
      }

      // Miscs
      const miscs: RecipeMisc[] = [];
      const mAdds = r.ingredients?.miscellaneous_additions ?? [];
      for (const m of mAdds) {
        const amountVal = v(m, "amount");
        let amount = amountVal;
        let unit = "un";
        if (m.amount && m.amount.unit) {
          const u = String(m.amount.unit).toLowerCase();
          if (u === "kg" || u === "g") {
            if (u === "g") { amount = amountVal; unit = "g"; }
            else { amount = amountVal; unit = "kg"; }
          } else if (u === "l" || u === "ml") {
            unit = u;
          }
        }
        miscs.push({
          id: crypto.randomUUID(),
          name: m.name || "Adjunto",
          amount,
          unit,
          use: m.use || "Boil",
          price: 0,
        });
      }

      // Mash
      const mashSteps: MashStep[] = [];
      const mashStepsRaw = r.mash?.steps ?? r.mash?.mash_steps ?? [];
      for (const s of mashStepsRaw) {
        mashSteps.push({
          name: s.name || "Rampa",
          tempC: v(s, "step_temperature") || v(s, "temp") || 66,
          minutes: v(s, "step_time") || v(s, "time") || 60,
        });
      }
      if (mashSteps.length === 0) {
        mashSteps.push({ name: "Sacarificação", tempC: 66, minutes: 60 });
      }

      // Fermentation
      let fermentationTempC = 19;
      let fermentationDays = 14;
      const fermSteps = r.fermentation?.steps ?? [];
      if (fermSteps.length > 0) {
        const first = fermSteps[0];
        fermentationTempC = v(first, "step_temperature") || fermentationTempC;
        const t = v(first, "step_time");
        if (t > 0) fermentationDays = Math.round(t);
      }

      results.push({
        name,
        styleCode,
        author,
        notes,
        equipment: {
          batchL: batchSize,
          boilMinutes: boilTime,
          evaporationLh,
trubLossL: trubLoss,
          fermenterLossL: fermLoss,
          efficiency,
        },
        mashSteps,
        fermentationTempC,
        fermentationDays,
        fermentables,
        hops,
        yeasts,
        miscs,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: "1.0",
        versionHistory: [],
      });
    } catch {
      // skip malformed recipe
    }
  }

  return results;
}

export function parseBeerJson(json: string): Partial<Recipe> | null {
  const all = parseBeerJsonAll(json);
  return all.length > 0 ? all[0] : null;
}