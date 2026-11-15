/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { applySalts, deductInventory, finalGravity, originalGravity, recipeCost, shoppingList, styleCheck, volumes, type InventoryItem, type Recipe } from "./recipe-calc";

const closeTo = (actual: number, expected: number, precision = 4) => {
  const tolerance = 10 ** -precision / 2;
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not close to ${expected} (tol ${tolerance})`);
};

const eq = { batchL: 20, boilMinutes: 60, evaporationLh: 4, trubLossL: 1, fermenterLossL: 1, efficiency: 75 };
const recipe: Recipe = { id: "r", name: "T", styleCode: "18B", author: "", notes: "", equipment: eq, mashSteps: [], fermentationTempC: 19, fermentationDays: 14,
  fermentables: [{ id: "a", name: "Pale Ale", kg: 4, potential: 1.037, color: 3, type: "grao", price: 20 }],
  hops: [{ id: "h", name: "Cascade", grams: 50, alpha: 6, minutes: 60, use: "fervura", price: 250 }],
  yeasts: [{ id: "y", name: "US-05", attenuation: 80, packs: 1, price: 35 }], miscs: [], createdAt: "", updatedAt: "" };

describe("recipe", () => {
  test("volumes add trub and evaporation", () => {
    const v = volumes(eq);
    assert.equal(v.postBoil, 21);
    assert.equal(v.preBoil, 25);
    assert.equal(v.packaged, 19);
  });
  test("OG from 4 kg at 75% in 21 L", () => closeTo(originalGravity(recipe.fermentables, eq), 1.0441, 4));
  test("FG uses yeast attenuation", () => closeTo(finalGravity(1.05, recipe.yeasts), 1.01, 4));
  test("cost sums ingredients", () => closeTo(recipeCost(recipe).total, 80 + 12.5 + 35, 4));
  test("style check flags out-of-range", () => assert.equal(styleCheck({ og: 1.04, fg: 1.012, ibu: 40, srm: 7, abv: 5 }, { code: "x", name: "x", og: [1.045, 1.06], fg: [1.01, 1.015], ibu: [30, 50], srm: [5, 10], abv: [4.5, 6.2] }).og, "baixo"));
});
describe("inventory", () => {
  const inv: InventoryItem[] = [{ id: "1", kind: "fermentavel", name: "Pale Ale", amount: 3, unit: "kg", price: 20, minAmount: 0 }, { id: "2", kind: "lupulo", name: "cascade", amount: 100, unit: "g", price: 0.25, minAmount: 0 }];
  test("shopping list reports missing", () => {
    const s = shoppingList(recipe, inv);
    assert.equal(s.find(x => x.name === "Pale Ale")!.missing, 1);
    assert.equal(s.find(x => x.name === "US-05")!.missing, 1);
  });
  test("deduct never below zero", () => {
    const d = deductInventory(recipe, inv);
    assert.equal(d[0].amount, 0);
    assert.equal(d[1].amount, 50);
  });
});
test("1 g gypsum in 10 L adds 23 ppm Ca", () => closeTo(applySalts({ ca: 0, mg: 0, na: 0, so4: 0, cl: 0, hco3: 0 }, { gypsum: 1 }, 10).ca, 23.28, 2));
