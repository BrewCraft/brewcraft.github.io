/** BeerXML import/export utilities. */
import { type Recipe, type RecipeFermentable, type RecipeHop, type RecipeYeast, type RecipeMisc } from "./recipe-calc";

export function recipeToBeerXml(recipe: Recipe): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<RECIPES>');
  lines.push('  <RECIPE>');
  lines.push(`    <NAME>${escapeXml(recipe.name)}</NAME>`);
  lines.push(`    <TYPE>All Grain</TYPE>`);
  lines.push(`    <BATCH_SIZE>${recipe.equipment.batchL}</BATCH_SIZE>`);
  lines.push(`    <BOIL_SIZE>${(recipe.equipment.batchL + recipe.equipment.trubLossL + recipe.equipment.evaporationLh * recipe.equipment.boilMinutes / 60).toFixed(2)}</BOIL_SIZE>`);
  lines.push(`    <BOIL_TIME>${recipe.equipment.boilMinutes}</BOIL_TIME>`);
  lines.push(`    <EFFICIENCY>${recipe.equipment.efficiency}</EFFICIENCY>`);
  lines.push('    <FERMENTABLES>');
  for (const f of recipe.fermentables) {
    lines.push('      <FERMENTABLE>');
    lines.push(`        <NAME>${escapeXml(f.name)}</NAME>`);
    lines.push(`        <AMOUNT>${f.kg}</AMOUNT>`);
    lines.push(`        <YIELD>${((f.potential - 1) * 1000 / 8.3454).toFixed(2)}</YIELD>`);
    lines.push(`        <COLOR>${f.color}</COLOR>`);
    lines.push(`        <TYPE>${f.type === "grao" ? "Grain" : "Adjunct"}</TYPE>`);
    lines.push('      </FERMENTABLE>');
  }
  lines.push('    </FERMENTABLES>');
  lines.push('    <HOPS>');
  for (const h of recipe.hops) {
    lines.push('      <HOP>');
    lines.push(`        <NAME>${escapeXml(h.name)}</NAME>`);
    lines.push(`        <AMOUNT>${(h.grams / 1000).toFixed(4)}</AMOUNT>`);
    lines.push(`        <ALPHA>${h.alpha}</ALPHA>`);
    lines.push(`        <TIME>${h.minutes}</TIME>`);
    lines.push(`        <USE>${h.use === "dryhop" ? "Dry Hop" : "Boil"}</USE>`);
    lines.push('      </HOP>');
  }
  lines.push('    </HOPS>');
  lines.push('    <YEASTS>');
  for (const y of recipe.yeasts) {
    lines.push('      <YEAST>');
    lines.push(`        <NAME>${escapeXml(y.name)}</NAME>`);
    lines.push(`        <ATTENUATION>${y.attenuation}</ATTENUATION>`);
    lines.push('      </YEAST>');
  }
  lines.push('    </YEASTS>');
  lines.push('    <MISCS>');
  for (const m of recipe.miscs) {
    lines.push('      <MISC>');
    lines.push(`        <NAME>${escapeXml(m.name)}</NAME>`);
    lines.push(`        <AMOUNT>${m.amount}</AMOUNT>`);
    lines.push(`        <USE>${m.use}</USE>`);
    lines.push('      </MISC>');
  }
  lines.push('    </MISCS>');
  lines.push('  </RECIPE>');
  lines.push('</RECIPES>');
  return lines.join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function parseBeerXml(xml: string): Partial<Recipe> | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const recipeNode = doc.querySelector("RECIPE");
    if (!recipeNode) return null;
    const name = recipeNode.querySelector("NAME")?.textContent?.trim() || "Importada";
    const batchSize = parseFloat(recipeNode.querySelector("BATCH_SIZE")?.textContent || "20");
    const boilTime = parseFloat(recipeNode.querySelector("BOIL_TIME")?.textContent || "60");
    const efficiency = parseFloat(recipeNode.querySelector("EFFICIENCY")?.textContent || "72");
    const fermentables: RecipeFermentable[] = [];
    recipeNode.querySelectorAll("FERMENTABLE").forEach((n) => {
      fermentables.push({
        id: crypto.randomUUID(),
        name: n.querySelector("NAME")?.textContent?.trim() || "",
        kg: parseFloat(n.querySelector("AMOUNT")?.textContent || "0"),
        potential: 1.037,
        color: parseFloat(n.querySelector("COLOR")?.textContent || "0"),
        type: "grao",
        price: 0,
      });
    });
    const hops: RecipeHop[] = [];
    recipeNode.querySelectorAll("HOP").forEach((n) => {
      hops.push({
        id: crypto.randomUUID(),
        name: n.querySelector("NAME")?.textContent?.trim() || "",
        grams: parseFloat(n.querySelector("AMOUNT")?.textContent || "0") * 1000,
        alpha: parseFloat(n.querySelector("ALPHA")?.textContent || "0"),
        minutes: parseFloat(n.querySelector("TIME")?.textContent || "0"),
        use: "fervura",
        price: 0,
      });
    });
    const yeasts: RecipeYeast[] = [];
    recipeNode.querySelectorAll("YEAST").forEach((n) => {
      yeasts.push({
        id: crypto.randomUUID(),
        name: n.querySelector("NAME")?.textContent?.trim() || "",
        attenuation: parseFloat(n.querySelector("ATTENUATION")?.textContent || "75"),
        packs: 1,
        price: 0,
      });
    });
    const miscs: RecipeMisc[] = [];
    recipeNode.querySelectorAll("MISC").forEach((n) => {
      miscs.push({
        id: crypto.randomUUID(),
        name: n.querySelector("NAME")?.textContent?.trim() || "",
        amount: parseFloat(n.querySelector("AMOUNT")?.textContent || "0"),
        unit: "un",
        use: n.querySelector("USE")?.textContent?.trim() || "Fervura",
        price: 0,
      });
    });
    return {
      name,
      styleCode: "",
      author: "",
      notes: "",
      equipment: { batchL: batchSize, boilMinutes: boilTime, evaporationLh: 4, trubLossL: 1, fermenterLossL: 1, efficiency },
      mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
      fermentationTempC: 19,
      fermentationDays: 14,
      fermentables,
      hops,
      yeasts,
      miscs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1.0",
      versionHistory: [],
    };
  } catch {
    return null;
  }
}
