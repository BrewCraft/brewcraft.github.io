/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { fullVolumes, efficiencyBreakdown, dryHoppingCalc, advancedCarbonation, primingSugars, costBreakdown, recipeCostIntegrated, mashPhTool, optimizeRecipe } from "./brewing-tools";
import { calculators, validateCalculator } from "./calculator-registry";
import { defaultEquipment, type Recipe } from "./recipe-calc";

const near = (a: number, b: number, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (tol ${tol})`);

describe("volumes completos", () => {
  test("calcula balanço de volumes e perdas", () => {
    const out = fullVolumes({ batchL: 20, grainKg: 5, mashWaterL: 15, spargeWaterL: 12, absorptionLPerKg: 1, boilMinutes: 60, evaporationLh: 4, boilLossL: 0.5, whirlpoolLossL: 0.5, transferLossL: 0.5, fermenterLossL: 1 });
    near(out.totalWater, 27);
    near(out.grainAbsorption, 5);
    near(out.preBoil, 22);
    near(out.evaporation, 4);
    near(out.postBoil, 17.5);
    near(out.kettleOut, 17);
    near(out.fermenter, 16.5);
    near(out.packaged, 15.5);
  });
});

describe("eficiência detalhada", () => {
  test("calcula eficiências por etapa e perdas de extrato", () => {
    const out = efficiencyBreakdown({ grainKg: 5, potentialSg: 1.037, mashVolumeL: 16, mashOg: 1.05, lauterVolumeL: 25, preBoilOg: 1.042, kettleVolumeL: 21, kettleOg: 1.05 });
    assert.ok(out.mashEff > 0 && out.lauterEff > 0 && out.brewhouseEff > 0);
    assert.ok(out.potentialPoints > 0);
    near(out.lauterLossPct, Math.max(0, out.mashEff - out.lauterEff), 0.01);
    near(out.transferLossPct, Math.max(0, out.lauterEff - out.brewhouseEff), 0.01);
    assert.ok(out.extractYield > 0);
  });
});

describe("dry hopping", () => {
  test("calcula total, g/L e distribuição por adição", () => {
    const out = dryHoppingCalc({ volumeL: 20, additions: [ { name: "Citra", grams: 60, days: 4, tempC: 18 }, { name: "Mosaic", grams: 40, days: 3, tempC: 18 } ] });
    near(out.totalGrams, 100);
    near(out.totalGPerL, 5);
    assert.equal(out.count, 2);
    near(out.additions[0].gPerL, 3);
    near(out.additions[1].gPerL, 2);
    assert.equal(out.varietyTotals.length, 2);
  });
  test("não estima extração aromática como valor laboratorial", () => {
    const c = calculators.find(x => x.id === "dry_hopping");
    assert.ok(c);
    const note = (c.note || "").toLowerCase();
    assert.ok(note.includes("não") && (note.includes("laboratorial") || note.includes("não é estimada")));
  });
});

describe("carbonatação avançada", () => {
  test("calcula CO2 residual, açúcares, garrafas e barril", () => {
    const out = advancedCarbonation({ volumeL: 20, beerTempC: 20, targetVolumes: 2.5, kegTempC: 4, bottles: 40, bottleVolumeMl: 500 });
    assert.ok(out.residual > 0.5 && out.residual < 1.2);
    assert.ok(out.sucroseTotal > 0);
    near(out.sugarPerLiter, out.sucroseTotal / 20, 0.001);
    assert.ok(out.perBottleSucrose > 0);
    assert.ok(out.kegPsi > 0);
    assert.ok(primingSugars.length >= 5);
    assert.ok(out.sugars.some(s => s.id === "dextrose" && s.totalG > out.sucroseTotal));
  });
});

describe("custos", () => {
  test("calcula totais e custos por litro/garrafa", () => {
    const out = costBreakdown({ ingredients: [{ label: "Malte", qty: 5, unit: "kg", unitPrice: 20 }, { label: "Lúpulo", qty: 0.1, unit: "kg", unitPrice: 250 }], packaging: [{ label: "Garrafas", qty: 40, unit: "un", unitPrice: 1 }], productionFixed: 10, batchL: 20, bottleMl: 500 });
    near(out.ingredientTotal, 125);
    near(out.packagingTotal, 40);
    near(out.total, 175);
    near(out.costPerLiter, 8.75, 0.01);
    near(out.costPerBottle, 4.375, 0.01);
  });
  test("integra com dados de receita", () => {
    const r: Recipe = { id: "r", name: "T", styleCode: "18B", author: "", notes: "", equipment: { ...defaultEquipment, batchL: 20, fermenterLossL: 1 }, mashSteps: [], fermentationTempC: 19, fermentationDays: 14, fermentables: [{ id: "f", name: "Pale", kg: 4, potential: 1.037, color: 3, type: "grao", price: 20 }], hops: [{ id: "h", name: "Cascade", grams: 50, alpha: 6, minutes: 60, use: "fervura", price: 250 }], yeasts: [{ id: "y", name: "US-05", attenuation: 80, packs: 1, price: 35 }], miscs: [], createdAt: "", updatedAt: "" };
    const out = recipeCostIntegrated(r, 20, 10, 500);
    const ingredientTotal = out.fermentables + out.hops + out.yeasts + out.miscs;
    assert.ok(ingredientTotal > 0);
    assert.ok(out.total > ingredientTotal);
    near(out.packaging, 20, 0.001);
    near(out.production, 10, 0.001);
    assert.ok(out.costPerLiter > 0);
    assert.ok(out.costPerBottle > 0);
  });
});

describe("pH da mostura", () => {
  test("estima pH na faixa cervejeira com grãos e água", () => {
    const out = mashPhTool({ grains: [{ name: "Pilsen", kg: 4.5, colorLovibond: 2, type: "base" }, { name: "Crystal", kg: 0.3, colorLovibond: 40, type: "crystal" }], mashWaterL: 15, source: { ca: 50, mg: 10, na: 10, so4: 80, cl: 60, hco3: 50 }, salts: { gypsum: 2 }, acids: { lactic85Ml: 1 } });
    assert.ok(out.estimatedPh >= 4.5 && out.estimatedPh <= 6.5);
    assert.ok(Number.isFinite(out.residualAlkalinity));
  });
});

describe("otimizador de receitas", () => {
  test("sugere composição dentro de limites razoáveis do estilo", () => {
    const out = optimizeRecipe({ styleCode: "18B", batchL: 20, efficiency: 72, targetOg: 1.055, targetIbu: 35, targetEbc: 16 });
    assert.equal(out.style.code, "18B");
    assert.ok(out.fermentables.length >= 1);
    assert.ok(out.hops.length >= 1);
    assert.ok(out.yeast);
    assert.ok(out.estimates.og > 1.03 && out.estimates.og < 1.08);
    assert.ok(out.estimates.ibu > 10);
    assert.ok(out.estimates.grainKg > 0);
  });
  test("respeita ingredientes disponíveis informados", () => {
    const out = optimizeRecipe({ styleCode: "21A", batchL: 20, efficiency: 72, targetOg: 1.06, targetIbu: 60, targetEbc: 12, availableFermentables: ["Pale Ale", "Munich I"], availableHops: ["Magnum", "Cascade"], availableYeasts: ["SafAle US-05"] });
    assert.ok(out.fermentables.some(f => /Pale Ale|Munich/i.test(f.name)));
    assert.ok(out.hops.some(h => /Magnum|Cascade/i.test(h.name)));
  });
});

describe("calculadoras registradas", () => {
  const ids = ["volumes_full", "efficiency_detailed", "dry_hopping", "carbonation_advanced", "costs", "mash_ph", "recipe_optimizer"];
  for (const id of ids) {
    test(`registrada e válida: ${id}`, () => {
      const c = calculators.find(x => x.id === id);
      assert.ok(c, `missing ${id}`);
      const v = Object.fromEntries(c.fields.map(f => [f.id, f.initial]));
      assert.equal(validateCalculator(c, v), undefined, `invalid defaults ${id}`);
      const results = c.calculate(v);
      assert.ok(results.length > 0);
      for (const r of results) assert.ok(Number.isFinite(r.value), `${id} ${r.label} not finite`);
    });
  }
});
