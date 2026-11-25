/** BeerXML 1.0 import/export utilities. */
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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeNum(raw: string | null | undefined, fallback: number, min = -Infinity, max = Infinity): number {
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw.trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

function directChild(el: Element, tag: string): Element | null {
  const upper = tag.toUpperCase();
  if (el.children) {
    for (let i = 0; i < el.children.length; i++) {
      if (el.children[i].tagName.toUpperCase() === upper) {
        return el.children[i];
      }
    }
    return null;
  }
  return el.querySelector(tag);
}

function childText(el: Element, tag: string): string {
  return directChild(el, tag)?.textContent?.trim() ?? "";
}

function mapHopUseToXml(use: HopUse): string {
  switch (use) {
    case "dryhop":
      return "Dry Hop";
    case "whirlpool":
      return "Aroma";
    case "primeiro_mosto":
      return "First Wort";
    case "fervura":
    default:
      return "Boil";
  }
}

function mapXmlUseToHopUse(xmlUse: string): HopUse {
  const lower = (xmlUse || "").toLowerCase().trim();
  if (lower.includes("dry") || lower === "dryhop") {
    return "dryhop";
  }
  if (lower.includes("whirlpool") || lower.includes("aroma")) {
    return "whirlpool";
  }
  if (lower.includes("first") || lower.includes("primeiro")) {
    return "primeiro_mosto";
  }
  return "fervura";
}

function mapFermentableTypeToXml(type: string): string {
  const t = (type || "").toLowerCase().trim();
  if (t === "adjunto" || t === "adjunct") return "Adjunct";
  if (t === "extrato" || t === "extract") return "Extract";
  if (t === "acucar" || t === "sugar") return "Sugar";
  return "Grain";
}

function mapXmlTypeToFermentableType(xmlType: string): string {
  const t = (xmlType || "").toLowerCase().trim();
  if (t.includes("adjunct") || t.includes("adjunto")) return "adjunto";
  if (t.includes("extract") || t.includes("extrato")) return "extrato";
  if (t.includes("sugar") || t.includes("acucar") || t.includes("açúcar")) return "acucar";
  return "grao";
}

function mapMiscUseToXml(use: string): string {
  const u = (use || "").toLowerCase().trim();
  if (u === "mostura" || u === "mash") return "Mash";
  if (u.includes("prim") || u === "primary") return "Primary";
  if (u.includes("sec") || u === "secondary") return "Secondary";
  if (u.includes("envase") || u.includes("bottl") || u.includes("keg")) return "Bottling";
  return "Boil";
}

function mapXmlUseToMiscUse(xmlUse: string): string {
  const u = (xmlUse || "").toLowerCase().trim();
  if (u === "mash" || u === "mostura") return "Mostura";
  if (u === "primary" || u.includes("prim")) return "Primária";
  if (u === "secondary" || u.includes("sec")) return "Secundária";
  if (u === "bottling" || u === "envase" || u.includes("keg")) return "Envase";
  if (u === "boil" || u === "fervura" || !u) return "Fervura";
  return xmlUse.trim();
}

export function recipeToBeerXml(recipe: Recipe): string {
  const lines: string[] = [];
  const boilHours = recipe.equipment.boilMinutes > 0 ? recipe.equipment.boilMinutes / 60 : 1;
  const boilVol = Number(
    (
      recipe.equipment.batchL +
      recipe.equipment.trubLossL +
      recipe.equipment.evaporationLh * boilHours
    ).toFixed(2)
  );
  const evapRatePct = boilVol > 0 ? Number(((recipe.equipment.evaporationLh / boilVol) * 100).toFixed(2)) : 0;

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<RECIPES>");
  lines.push("  <RECIPE>");
  lines.push(`    <NAME>${escapeXml(recipe.name)}</NAME>`);
  lines.push("    <VERSION>1</VERSION>");
  lines.push("    <TYPE>All Grain</TYPE>");
  lines.push(`    <BREWER>${escapeXml(recipe.author || "")}</BREWER>`);
  lines.push(`    <BATCH_SIZE>${recipe.equipment.batchL}</BATCH_SIZE>`);
  lines.push(`    <BOIL_SIZE>${boilVol.toFixed(2)}</BOIL_SIZE>`);
  lines.push(`    <BOIL_TIME>${recipe.equipment.boilMinutes}</BOIL_TIME>`);
  lines.push(`    <EFFICIENCY>${recipe.equipment.efficiency}</EFFICIENCY>`);
  lines.push(`    <EVAP_RATE>${evapRatePct}</EVAP_RATE>`);
  lines.push(`    <TRUB_CHILLER_LOSS>${recipe.equipment.trubLossL}</TRUB_CHILLER_LOSS>`);
  lines.push(`    <FERMENTER_LOSS>${recipe.equipment.fermenterLossL}</FERMENTER_LOSS>`);
  if (recipe.notes) {
    lines.push(`    <NOTES>${escapeXml(recipe.notes)}</NOTES>`);
  }

  lines.push("    <EQUIPMENT>");
  lines.push("      <NAME>Equipamento BrewCraft</NAME>");
  lines.push("      <VERSION>1</VERSION>");
  lines.push(`      <BATCH_SIZE>${recipe.equipment.batchL}</BATCH_SIZE>`);
  lines.push(`      <BOIL_SIZE>${boilVol.toFixed(2)}</BOIL_SIZE>`);
  lines.push(`      <BOIL_TIME>${recipe.equipment.boilMinutes}</BOIL_TIME>`);
  lines.push(`      <EVAP_RATE>${evapRatePct}</EVAP_RATE>`);
  lines.push(`      <TRUB_CHILLER_LOSS>${recipe.equipment.trubLossL}</TRUB_CHILLER_LOSS>`);
  lines.push(`      <FERMENTER_LOSS>${recipe.equipment.fermenterLossL}</FERMENTER_LOSS>`);
  lines.push("    </EQUIPMENT>");

  // Estilo BJCP estruturado
  if (recipe.styleCode) {
    const style = allStyles().find(
      (s) => s.code.toLowerCase() === recipe.styleCode.toLowerCase()
    );
    lines.push("    <STYLE>");
    lines.push(`      <NAME>${escapeXml(style?.name || recipe.styleCode)}</NAME>`);
    lines.push("      <VERSION>1</VERSION>");
    const catNum = recipe.styleCode.replace(/[A-Za-z]/g, "");
    const letter = recipe.styleCode.replace(/[0-9]/g, "");
    if (catNum) lines.push(`      <CATEGORY_NUMBER>${catNum}</CATEGORY_NUMBER>`);
    if (letter) lines.push(`      <STYLE_LETTER>${letter}</STYLE_LETTER>`);
    lines.push("      <STYLE_GUIDE>BJCP 2021</STYLE_GUIDE>");
    lines.push("      <TYPE>Ale</TYPE>");
    lines.push("    </STYLE>");
  }

  // Fermentáveis
  lines.push("    <FERMENTABLES>");
  for (const f of recipe.fermentables) {
    const yieldPct = (((f.potential - 1) * 1000) / 0.46214).toFixed(2);
    lines.push("      <FERMENTABLE>");
    lines.push(`        <NAME>${escapeXml(f.name)}</NAME>`);
    lines.push("        <VERSION>1</VERSION>");
    lines.push(`        <AMOUNT>${f.kg}</AMOUNT>`);
    lines.push(`        <TYPE>${mapFermentableTypeToXml(f.type)}</TYPE>`);
    lines.push(`        <YIELD>${yieldPct}</YIELD>`);
    lines.push(`        <POTENTIAL>${f.potential}</POTENTIAL>`);
    lines.push(`        <COLOR>${f.color}</COLOR>`);
    if (f.price) lines.push(`        <PRICE>${f.price}</PRICE>`);
    lines.push("      </FERMENTABLE>");
  }
  lines.push("    </FERMENTABLES>");

  // Lúpulos
  lines.push("    <HOPS>");
  for (const h of recipe.hops) {
    const xmlTime = h.use === "dryhop" ? (h.dryHopDay ?? 3) * 1440 : h.minutes;
    lines.push("      <HOP>");
    lines.push(`        <NAME>${escapeXml(h.name)}</NAME>`);
    lines.push("        <VERSION>1</VERSION>");
    lines.push(`        <AMOUNT>${(h.grams / 1000).toFixed(4)}</AMOUNT>`);
    lines.push(`        <ALPHA>${h.alpha}</ALPHA>`);
    lines.push(`        <USE>${mapHopUseToXml(h.use)}</USE>`);
    lines.push(`        <TIME>${xmlTime}</TIME>`);
    if (h.use === "dryhop" && h.dryHopDay !== undefined) {
      lines.push(`        <DRY_HOP_DAY>${h.dryHopDay}</DRY_HOP_DAY>`);
    }
    if (h.price) lines.push(`        <PRICE>${h.price}</PRICE>`);
    lines.push("      </HOP>");
  }
  lines.push("    </HOPS>");

  // Leveduras
  lines.push("    <YEASTS>");
  for (const y of recipe.yeasts) {
    lines.push("      <YEAST>");
    lines.push(`        <NAME>${escapeXml(y.name)}</NAME>`);
    lines.push("        <VERSION>1</VERSION>");
    lines.push("        <TYPE>Ale</TYPE>");
    lines.push("        <FORM>Dry</FORM>");
    lines.push(`        <AMOUNT>${y.packs}</AMOUNT>`);
    lines.push(`        <ATTENUATION>${y.attenuation}</ATTENUATION>`);
    if (y.price) lines.push(`        <PRICE>${y.price}</PRICE>`);
    lines.push("      </YEAST>");
  }
  lines.push("    </YEASTS>");

  // Outros ingredientes (Miscs)
  if (recipe.miscs.length > 0) {
    lines.push("    <MISCS>");
    for (const m of recipe.miscs) {
      const isWeight = m.unit === "kg" || m.unit === "g";
      const xmlAmount = m.unit === "g" ? m.amount / 1000 : m.amount;
      lines.push("      <MISC>");
      lines.push(`        <NAME>${escapeXml(m.name)}</NAME>`);
      lines.push("        <VERSION>1</VERSION>");
      lines.push("        <TYPE>Other</TYPE>");
      lines.push(`        <USE>${escapeXml(mapMiscUseToXml(m.use))}</USE>`);
      lines.push(`        <AMOUNT>${xmlAmount}</AMOUNT>`);
      lines.push(`        <AMOUNT_IS_WEIGHT>${isWeight ? "TRUE" : "FALSE"}</AMOUNT_IS_WEIGHT>`);
      lines.push(`        <UNIT>${escapeXml(m.unit)}</UNIT>`);
      if (m.price) lines.push(`        <PRICE>${m.price}</PRICE>`);
      lines.push("      </MISC>");
    }
    lines.push("    </MISCS>");
  }

  // Rampa de mostura (Mash)
  if (recipe.mashSteps.length > 0) {
    lines.push("    <MASH>");
    lines.push("      <NAME>Perfil de Mostura</NAME>");
    lines.push("      <VERSION>1</VERSION>");
    lines.push("      <GRAIN_TEMP>20</GRAIN_TEMP>");
    lines.push("      <MASH_STEPS>");
    for (const s of recipe.mashSteps) {
      lines.push("        <MASH_STEP>");
      lines.push(`          <NAME>${escapeXml(s.name)}</NAME>`);
      lines.push("          <VERSION>1</VERSION>");
      lines.push("          <TYPE>Temperature</TYPE>");
      lines.push(`          <STEP_TEMP>${s.tempC}</STEP_TEMP>`);
      lines.push(`          <STEP_TIME>${s.minutes}</STEP_TIME>`);
      lines.push("        </MASH_STEP>");
    }
    lines.push("      </MASH_STEPS>");
    lines.push("    </MASH>");
  }

  // Fermentação
  lines.push(`    <PRIMARY_TEMP>${recipe.fermentationTempC}</PRIMARY_TEMP>`);
  lines.push(`    <PRIMARY_AGE>${recipe.fermentationDays}</PRIMARY_AGE>`);

  lines.push("  </RECIPE>");
  lines.push("</RECIPES>");
  return lines.join("\n");
}

function parseRecipeNode(recipeNode: Element): Partial<Recipe> {
  const name = childText(recipeNode, "NAME") || recipeNode.querySelector("NAME")?.textContent?.trim() || "Importada";
  const author = childText(recipeNode, "BREWER");
  const notes = childText(recipeNode, "NOTES");

  const eqNode = directChild(recipeNode, "EQUIPMENT");
  const batchSize = safeNum(
    childText(recipeNode, "BATCH_SIZE") || (eqNode ? childText(eqNode, "BATCH_SIZE") : ""),
    defaultEquipment.batchL,
    0.1
  );
  const boilTime = safeNum(
    childText(recipeNode, "BOIL_TIME") || (eqNode ? childText(eqNode, "BOIL_TIME") : ""),
    defaultEquipment.boilMinutes,
    0
  );
  const efficiency = safeNum(
    childText(recipeNode, "EFFICIENCY"),
    defaultEquipment.efficiency,
    1,
    100
  );
  const boilSize = safeNum(
    childText(recipeNode, "BOIL_SIZE") || (eqNode ? childText(eqNode, "BOIL_SIZE") : ""),
    0,
    0
  );
  const evapRate = safeNum(
    childText(recipeNode, "EVAP_RATE") || (eqNode ? childText(eqNode, "EVAP_RATE") : ""),
    0,
    0,
    100
  );
  const trubLossL = safeNum(
    childText(recipeNode, "TRUB_CHILLER_LOSS") || (eqNode ? childText(eqNode, "TRUB_CHILLER_LOSS") : ""),
    defaultEquipment.trubLossL,
    0
  );
  const fermenterLossL = safeNum(
    childText(recipeNode, "FERMENTER_LOSS") || (eqNode ? childText(eqNode, "FERMENTER_LOSS") : ""),
    defaultEquipment.fermenterLossL,
    0
  );

  let evaporationLh = defaultEquipment.evaporationLh;
  if (evapRate > 0) {
    const refVol = boilSize > 0 ? boilSize : batchSize;
    evaporationLh = Number(((refVol * evapRate) / 100).toFixed(2));
  } else if (boilSize > batchSize + trubLossL && boilTime > 0) {
    evaporationLh = Number((((boilSize - batchSize - trubLossL) * 60) / boilTime).toFixed(2));
  }

  // Identificação do estilo BJCP
  let styleCode = "";
  const styleNode = directChild(recipeNode, "STYLE") ?? recipeNode.querySelector("STYLE");
  if (styleNode) {
    const cat = childText(styleNode, "CATEGORY_NUMBER") || styleNode.querySelector("CATEGORY_NUMBER")?.textContent?.trim() || "";
    const letter = childText(styleNode, "STYLE_LETTER") || styleNode.querySelector("STYLE_LETTER")?.textContent?.trim() || "";
    if (cat && letter) {
      styleCode = `${cat}${letter}`.toUpperCase();
    } else if (cat) {
      styleCode = cat.toUpperCase();
    } else {
      const styleName = (childText(styleNode, "NAME") || styleNode.querySelector("NAME")?.textContent?.trim() || "").toLowerCase();
      const found = allStyles().find(
        (s) => s.name.toLowerCase() === styleName || s.code.toLowerCase() === styleName
      );
      if (found) styleCode = found.code;
    }
  }

  // Fermentáveis
  const fermentables: RecipeFermentable[] = [];
  recipeNode.querySelectorAll("FERMENTABLE").forEach((n) => {
    const fName = n.querySelector("NAME")?.textContent?.trim() || "Malte";
    const amountKg = safeNum(n.querySelector("AMOUNT")?.textContent, 0, 0);
    const color = safeNum(n.querySelector("COLOR")?.textContent, 3, 0);
    const xmlType = n.querySelector("TYPE")?.textContent?.trim() || "Grain";
    const yieldTag = safeNum(n.querySelector("YIELD")?.textContent, 0, 0, 120);
    const potentialTag = safeNum(n.querySelector("POTENTIAL")?.textContent, 0, 1.0, 1.2);
    const price = safeNum(n.querySelector("PRICE")?.textContent, 0, 0);

    let potential = 1.037;
    if (potentialTag > 1.0 && potentialTag < 1.2) {
      potential = potentialTag;
    } else if (yieldTag > 0) {
      potential = Number((1 + (yieldTag * 0.46214) / 1000).toFixed(4));
    }

    fermentables.push({
      id: crypto.randomUUID(),
      name: fName,
      kg: amountKg,
      potential,
      color,
      type: mapXmlTypeToFermentableType(xmlType),
      price,
    });
  });

  // Lúpulos
  const hops: RecipeHop[] = [];
  recipeNode.querySelectorAll("HOP").forEach((n) => {
    const hName = n.querySelector("NAME")?.textContent?.trim() || "Lúpulo";
    const amountKg = safeNum(n.querySelector("AMOUNT")?.textContent, 0, 0);
    const alpha = safeNum(n.querySelector("ALPHA")?.textContent, 0, 0, 50);
    const rawMinutes = safeNum(n.querySelector("TIME")?.textContent, 0, 0);
    const rawUse = n.querySelector("USE")?.textContent?.trim() || "Boil";
    const use = mapXmlUseToHopUse(rawUse);
    const explicitDryHopDay = safeNum(n.querySelector("DRY_HOP_DAY")?.textContent, 0, 0);
    const price = safeNum(n.querySelector("PRICE")?.textContent, 0, 0);

    let minutes = rawMinutes;
    let dryHopDay: number | undefined;
    if (use === "dryhop") {
      minutes = 0;
      if (explicitDryHopDay > 0) {
        dryHopDay = Math.round(explicitDryHopDay);
      } else if (rawMinutes >= 1440) {
        dryHopDay = Math.max(1, Math.round(rawMinutes / 1440));
      } else if (rawMinutes > 0 && rawMinutes <= 30) {
        dryHopDay = Math.round(rawMinutes);
      } else {
        dryHopDay = 3;
      }
    }

    hops.push({
      id: crypto.randomUUID(),
      name: hName,
      grams: Number((amountKg * 1000).toFixed(1)),
      alpha,
      minutes,
      use,
      price,
      ...(dryHopDay !== undefined ? { dryHopDay } : {}),
    });
  });

  // Leveduras
  const yeasts: RecipeYeast[] = [];
  recipeNode.querySelectorAll("YEAST").forEach((n) => {
    const yName = n.querySelector("NAME")?.textContent?.trim() || "Levedura";
    const directAtt = safeNum(n.querySelector("ATTENUATION")?.textContent, 0, 1, 100);
    const minAtt = safeNum(n.querySelector("MIN_ATTENUATION")?.textContent, 0, 1, 100);
    const maxAtt = safeNum(n.querySelector("MAX_ATTENUATION")?.textContent, 0, 1, 100);
    const attenuation =
      directAtt > 0
        ? directAtt
        : minAtt > 0 && maxAtt > 0
          ? Number(((minAtt + maxAtt) / 2).toFixed(1))
          : minAtt > 0
            ? minAtt
            : maxAtt > 0
              ? maxAtt
              : 75;
    const amount = safeNum(n.querySelector("AMOUNT")?.textContent, 1, 0);
    const price = safeNum(n.querySelector("PRICE")?.textContent, 0, 0);

    yeasts.push({
      id: crypto.randomUUID(),
      name: yName,
      attenuation,
      packs: amount >= 1 ? Math.round(amount) : 1,
      price,
    });
  });

  // Miscs
  const miscs: RecipeMisc[] = [];
  recipeNode.querySelectorAll("MISC").forEach((n) => {
    const mName = n.querySelector("NAME")?.textContent?.trim() || "Adjunto";
    const rawAmount = safeNum(n.querySelector("AMOUNT")?.textContent, 0, 0);
    const rawUse = n.querySelector("USE")?.textContent?.trim() || "Boil";
    const explicitUnit = n.querySelector("UNIT")?.textContent?.trim() || "";
    const isWeight = (n.querySelector("AMOUNT_IS_WEIGHT")?.textContent?.trim() || "").toUpperCase() === "TRUE";
    const price = safeNum(n.querySelector("PRICE")?.textContent, 0, 0);

    let amount = rawAmount;
    let unit = explicitUnit || "un";
    if (!explicitUnit && isWeight) {
      if (rawAmount > 0 && rawAmount < 1) {
        amount = Number((rawAmount * 1000).toFixed(2));
        unit = "g";
      } else {
        unit = "kg";
      }
    } else if (explicitUnit === "g" && rawAmount > 0 && rawAmount < 1) {
      amount = Number((rawAmount * 1000).toFixed(2));
    }

    miscs.push({
      id: crypto.randomUUID(),
      name: mName,
      amount,
      unit,
      use: mapXmlUseToMiscUse(rawUse),
      price,
    });
  });

  // Mostura
  const mashSteps: MashStep[] = [];
  recipeNode.querySelectorAll("MASH_STEP").forEach((n) => {
    const sName = n.querySelector("NAME")?.textContent?.trim() || "Rampa";
    const tempC = safeNum(n.querySelector("STEP_TEMP")?.textContent, 66, 0, 100);
    const minutes = safeNum(n.querySelector("STEP_TIME")?.textContent, 60, 0);

    mashSteps.push({
      name: sName,
      tempC,
      minutes,
    });
  });

  // Fermentação
  const primTemp = safeNum(childText(recipeNode, "PRIMARY_TEMP") || recipeNode.querySelector("PRIMARY_TEMP")?.textContent, 19, -5, 45);
  const primAge = safeNum(childText(recipeNode, "PRIMARY_AGE") || recipeNode.querySelector("PRIMARY_AGE")?.textContent, 14, 0);

  return {
    name,
    styleCode,
    author,
    notes,
    equipment: {
      batchL: batchSize,
      boilMinutes: boilTime,
      evaporationLh,
      trubLossL,
      fermenterLossL,
      efficiency,
    },
    mashSteps:
      mashSteps.length > 0
        ? mashSteps
        : [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
    fermentationTempC: primTemp,
    fermentationDays: primAge,
    fermentables,
    hops,
    yeasts:
      yeasts.length > 0
        ? yeasts
        : [{ id: crypto.randomUUID(), name: "US-05", attenuation: 80, packs: 1, price: 0 }],
    miscs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: "1.0",
    versionHistory: [],
  };
}

export function parseBeerXmlAll(xml: string): Partial<Recipe>[] {
  if (!xml || !xml.trim()) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror") || (doc.getElementsByTagName?.("parsererror")?.length ?? 0) > 0) {
      return [];
    }
    const recipeNodes = doc.querySelectorAll
      ? Array.from(doc.querySelectorAll("RECIPE"))
      : (() => {
          const single = doc.querySelector("RECIPE");
          return single ? [single] : [];
        })();
    if (recipeNodes.length === 0) return [];
    return recipeNodes.map(parseRecipeNode);
  } catch {
    return [];
  }
}

export function parseBeerXml(xml: string): Partial<Recipe> | null {
  const all = parseBeerXmlAll(xml);
  return all.length > 0 ? all[0] : null;
}
