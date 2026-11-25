import test from "node:test";
import assert from "node:assert/strict";
import { cloneRecipeForUser, type Recipe } from "./recipe-calc";
import { libraryRecipes } from "./recipe-library";
import { confirmNavigationIfGuarded, setNavigationGuard } from "./navigation-guard";

test("Biblioteca: cloneRecipeForUser cria cópia independente preservando todos os dados e sem mutar a original", () => {
  const source = libraryRecipes[0];
  const originalSnapshot = structuredClone(source);
  const sourceWithExtras = {
    ...structuredClone(source),
    image: "data:image/png;base64,abc123",
  } as Recipe & { image: string };

  let seq = 0;
  const copy = cloneRecipeForUser(sourceWithExtras, () => `copy-id-${++seq}`) as Recipe & { image: string };

  assert.notEqual(copy.id, source.id);
  assert.equal(copy.name, source.name);
  assert.equal(copy.styleCode, source.styleCode);
  assert.equal(copy.author, source.author);
  assert.equal(copy.notes, source.notes);
  assert.equal(copy.image, "data:image/png;base64,abc123");
  assert.deepEqual(copy.equipment, source.equipment);
  assert.deepEqual(copy.mashSteps, source.mashSteps);
  assert.equal(copy.fermentationTempC, source.fermentationTempC);
  assert.equal(copy.fermentationDays, source.fermentationDays);
  assert.equal(copy.fermentables.length, source.fermentables.length);
  assert.equal(copy.hops.length, source.hops.length);
  assert.equal(copy.yeasts.length, source.yeasts.length);

  // Editar a cópia não afeta a receita original da biblioteca
  copy.name = "Cópia Editada";
  copy.notes = "Nota modificada";
  copy.equipment.batchL = 40;
  copy.fermentables[0].kg = 9.9;
  copy.hops[0].grams = 120;
  copy.mashSteps[0].tempC = 68;

  assert.equal(source.name, originalSnapshot.name);
  assert.equal(source.notes, originalSnapshot.notes);
  assert.equal(source.equipment.batchL, originalSnapshot.equipment.batchL);
  assert.equal(source.fermentables[0].kg, originalSnapshot.fermentables[0].kg);
  assert.equal(source.hops[0].grams, originalSnapshot.hops[0].grams);
  assert.equal(source.mashSteps[0].tempC, originalSnapshot.mashSteps[0].tempC);
});

test("Guarda de navegação: bloqueia quando há alterações não salvas e libera após limpar", () => {
  setNavigationGuard(null);
  assert.equal(confirmNavigationIfGuarded(), true);

  setNavigationGuard(() => false);
  assert.equal(confirmNavigationIfGuarded(), false);

  setNavigationGuard(() => true);
  assert.equal(confirmNavigationIfGuarded(), true);

  setNavigationGuard(null);
  assert.equal(confirmNavigationIfGuarded(), true);
});
