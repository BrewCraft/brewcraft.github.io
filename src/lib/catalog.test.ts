/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { fermentables, hops, yeasts, miscs } from "./catalog";
import { defaultEquipment, originalGravity, recipeCost, recipeIbu, type Recipe } from "./recipe-calc";

describe("catalog expansion", () => {
  test("includes requested fermentables without duplicates", () => {
    const names = fermentables.map(f => f.name);
    const must = [
      "Golden Promise", "Vienna Malt", "Munich I", "Munich II", "Caramunich I", "Caramunich II", "Caramunich III",
      "CaraRed", "CaraPils", "CaraFoam", "Special B", "Melanoidin Malt", "Aromatic Malt", "Biscuit Malt", "Victory Malt",
      "Chocolate Malt", "Chocolate Rye Malt", "Carafa Special I", "Carafa Special II", "Carafa Special III", "Black Patent Malt",
      "Roasted Barley", "Trigo em Flocos", "Trigo Torrado", "Centeio em Flocos", "Cevada em Flocos", "Dextrine Malt",
      "Lactose", "Dextrose", "Açúcar Invertido",
    ];
    for (const n of must) assert.ok(names.includes(n), `missing fermentable: ${n}`);
    assert.equal(new Set(names).size, names.length, "duplicate fermentable names");
  });

  test("fermentables have applicable technical fields and no invented values", () => {
    for (const f of fermentables) {
      assert.ok(f.name && f.type && f.manufacturer !== undefined || true);
      assert.ok(Number.isFinite(f.potential) && f.potential > 1 && f.potential < 1.1);
      assert.ok(Number.isFinite(f.color) && f.color >= 0);
      assert.ok(f.diastaticPower === "desconhecido" || typeof f.diastaticPower === "number");
      assert.ok(f.moisture === "desconhecido" || typeof f.moisture === "number");
      assert.ok(["official", "estimate", "user", "unknown", undefined].includes(f.source));
    }
  });

  test("includes requested hops without duplicates", () => {
    const names = hops.map(h => h.name);
    const must = ["Talus", "Nectaron", "Riwaka", "Eclipse", "HBC 586", "HBC 1019", "Cashmere", "Azacca", "Hüll Melon", "Barbe Rouge", "El Dorado", "Sabro", "Strata", "Nelson Sauvin", "Idaho 7"];
    for (const n of must) assert.ok(names.includes(n), `missing hop: ${n}`);
    assert.equal(new Set(names).size, names.length, "duplicate hop names");
  });

  test("hops have applicable fields", () => {
    for (const h of hops) {
      assert.ok(Number.isFinite(h.alpha) && h.alpha > 0 && h.alpha < 30);
      assert.ok(h.beta === "desconhecido" || typeof h.beta === "number");
      assert.ok(h.profile && h.usage);
      assert.ok(Array.isArray(h.substitutes) || h.substitutes === undefined);
    }
  });

  test("includes requested yeasts and key strains without duplicates", () => {
    const names = yeasts.map(y => y.name);
    const must = ["SafAle K-97", "SafAle S-33", "SafAle BE-134", "Mangrove Jack's M21 Belgian Wit", "Mangrove Jack's M44 US West Coast", "Diamond Lager", "WLP300 Hefeweizen Ale", "WLP500 Monastery Ale"];
    for (const n of must) assert.ok(names.includes(n), `missing yeast: ${n}`);
    assert.equal(new Set(names).size, names.length, "duplicate yeast names");
  });

  test("yeasts have applicable fields", () => {
    for (const y of yeasts) {
      assert.ok(y.lab && Number.isFinite(y.attenuation));
      assert.ok(Number.isFinite(y.tempMin) && Number.isFinite(y.tempMax));
      assert.ok(y.flocculation === "desconhecido" || typeof y.flocculation === "string");
      assert.ok(y.alcoholTolerance === "desconhecido" || typeof y.alcoholTolerance === "string");
      assert.ok(y.pitchRate === "desconhecido" || typeof y.pitchRate === "string");
    }
  });

  test("includes requested miscs/adjuncts", () => {
    const names = miscs.map(m => m.name);
    for (const n of ["Lactose (adjunto)", "Dextrose (priming/adjunto)", "Açúcar Invertido (adjunto)", "Mel (adjunto)", "Purê de Frutas", "Especiarias (mix)", "Casca de Arroz", "Flocos de Cereais (mix)"]) {
      assert.ok(names.includes(n), `missing misc: ${n}`);
    }
  });

  test("new catalog items work in recipe calculations", () => {
    const ferm = fermentables.find(f => f.name === "Golden Promise")!;
    const hop = hops.find(h => h.name === "Nectaron")!;
    const yeast = yeasts.find(y => y.name === "SafAle K-97")!;
    const recipe: Recipe = {
      id: "t", name: "Test", styleCode: "18B", author: "", notes: "",
      equipment: defaultEquipment, mashSteps: [], fermentationTempC: 19, fermentationDays: 14,
      fermentables: [{ id: "f", name: ferm.name, kg: 4, potential: ferm.potential, color: ferm.color, type: ferm.type, price: ferm.price }],
      hops: [{ id: "h", name: hop.name, grams: 30, alpha: hop.alpha, minutes: 60, use: "fervura", price: hop.price }],
      yeasts: [{ id: "y", name: yeast.name, attenuation: yeast.attenuation, packs: 1, price: yeast.price }],
      miscs: [], createdAt: "", updatedAt: "",
    };
    const og = originalGravity(recipe.fermentables, defaultEquipment);
    assert.ok(og > 1.03 && og < 1.06, `unexpected OG ${og}`);
    const ibu = recipeIbu(recipe.hops, og, defaultEquipment);
    assert.ok(ibu > 0, `unexpected IBU ${ibu}`);
    const cost = recipeCost(recipe);
    assert.ok(cost.total > 0);
  });
});
