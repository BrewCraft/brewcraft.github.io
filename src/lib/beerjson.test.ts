import test from "node:test";
import assert from "node:assert/strict";
import { recipeToBeerJson, parseBeerJson, parseBeerJsonAll } from "./beerjson";
import { defaultEquipment, type Recipe } from "./recipe-calc";

const sampleRecipe: Recipe = {
  id: "rec-bjson",
  name: "American IPA BeerJSON",
  styleCode: "21A",
  author: "Cervejeiro Mestre",
  notes: "Receita de teste para validação de BeerJSON",
  equipment: { ...defaultEquipment, batchL: 20, boilMinutes: 60, evaporationLh: 3.5, trubLossL: 1.5, fermenterLossL: 0.8, efficiency: 75 },
  mashSteps: [
    { name: "Parada Proteica", tempC: 52, minutes: 15 },
    { name: "Sacarificação", tempC: 66, minutes: 60 },
  ],
  fermentationTempC: 18,
  fermentationDays: 14,
  fermentables: [
    { id: "f1", name: "Malte Pilsen", kg: 5.0, potential: 1.037, color: 3.5, type: "grao", price: 20 },
  ],
  hops: [
    { id: "h1", name: "Citra", grams: 50, alpha: 12.5, minutes: 0, use: "dryhop", dryHopDay: 5, price: 350 },
  ],
  yeasts: [{ id: "y1", name: "SafAle US-05", attenuation: 81, packs: 2, price: 35 }],
  miscs: [{ id: "m1", name: "Whirlfloc", amount: 1, unit: "un", use: "Fervura", price: 5 }],
  createdAt: "2026-11-22T10:00:00Z",
  updatedAt: "2026-11-22T10:00:00Z",
  version: "1.0",
  versionHistory: [],
};

test("BeerJSON: exportação contém beerjson root e receita", () => {
  const json = recipeToBeerJson(sampleRecipe);
  const parsed = JSON.parse(json);
  assert.ok(parsed.beerjson);
  assert.equal(parsed.beerjson.version, "1.0.0");
  assert.equal(parsed.beerjson.recipes.length, 1);
  assert.equal(parsed.beerjson.recipes[0].name, "American IPA BeerJSON");
});

test("BeerJSON: round-trip preserva nome, volume, fermentáveis e lúpulos", () => {
  const json = recipeToBeerJson(sampleRecipe);
  const parsed = parseBeerJson(json);
  assert.ok(parsed !== null);
  assert.equal(parsed.name, "American IPA BeerJSON");
  assert.equal(parsed.equipment?.batchL, 20);
  assert.equal(parsed.equipment?.efficiency, 75);
  const pilsen = parsed.fermentables?.find(f => f.name === "Malte Pilsen");
  assert.ok(pilsen);
  assert.ok(Math.abs((pilsen.kg ?? 0) - 5) < 0.001);
  const citra = parsed.hops?.find(h => h.name === "Citra");
  assert.ok(citra);
  assert.equal(citra.use, "dryhop");
  assert.equal(citra.dryHopDay, 5);
});

test("BeerJSON: importação de JSON inválido retorna null/vazio", () => {
  assert.equal(parseBeerJson(""), null);
  assert.equal(parseBeerJson("{not json}"), null);
  assert.deepEqual(parseBeerJsonAll(""), []);
  assert.deepEqual(parseBeerJsonAll("{}"), []);
});

test("BeerJSON: importação de estrutura mínima válida", () => {
  const minimal = JSON.stringify({
    beerjson: {
      version: "1.0.0",
      recipes: [
        {
          name: "Minimal",
          type: "All Grain",
          author: "X",
          batch_size: { value: 10, unit: "l" },
          efficiency: { brewhouse: { value: 70, unit: "%" } },
          ingredients: {
            fermentable_additions: [
              { name: "Pilsen", type: "grain", amount: { value: 4, unit: "kg" }, yield: { potential: { value: 1.037, unit: "sg" } }, color: { value: 3, unit: "lovibond" } },
            ],
          },
        },
      ],
    },
  });
  const parsed = parseBeerJson(minimal);
  assert.ok(parsed);
  assert.equal(parsed.name, "Minimal");
  assert.equal(parsed.equipment?.batchL, 10);
  assert.equal(parsed.fermentables?.length, 1);
});