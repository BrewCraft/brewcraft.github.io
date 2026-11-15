/**
 * Pure brewing water chemistry calculations:
 * - Mineral profiles (Ca, Mg, Na, SO4, Cl, HCO3)
 * - Salt additions (Mash, Sparge, Total)
 * - Alkalinity and Kolbach Residual Alkalinity
 * - Sulfate/Chloride ratio and sensory balance
 * - Advanced Mash pH estimation with malt buffering and acids
 * - Smart salt optimizer with brewing constraints and solubility awareness
 */

export type Ion = "ca" | "mg" | "na" | "so4" | "cl" | "hco3";

export type WaterProfile = Record<Ion, number>;

export const ions: { id: Ion; label: string; symbol: string; typicalRange: [number, number] }[] = [
  { id: "ca", label: "Cálcio (Ca²⁺)", symbol: "Ca", typicalRange: [50, 150] },
  { id: "mg", label: "Magnésio (Mg²⁺)", symbol: "Mg", typicalRange: [5, 30] },
  { id: "na", label: "Sódio (Na⁺)", symbol: "Na", typicalRange: [0, 100] },
  { id: "so4", label: "Sulfato (SO₄²⁻)", symbol: "SO₄", typicalRange: [50, 350] },
  { id: "cl", label: "Cloreto (Cl⁻)", symbol: "Cl", typicalRange: [50, 200] },
  { id: "hco3", label: "Bicarbonato (HCO₃⁻)", symbol: "HCO₃", typicalRange: [0, 250] },
];

export interface SaltDefinition {
  id: string;
  name: string;
  chemicalFormula: string;
  ppm: Partial<WaterProfile>;
  insolubleInColdWater?: boolean;
  notes?: string;
}

export const saltsCatalog: SaltDefinition[] = [
  {
    id: "gypsum",
    name: "Gipsita (Sulfato de Cálcio)",
    chemicalFormula: "CaSO₄·2H₂O",
    ppm: { ca: 232.8, so4: 557.9 },
    notes: "Acidifica a mostura e realça o amargor do lúpulo.",
  },
  {
    id: "cacl2",
    name: "Cloreto de Cálcio (di-hidratado)",
    chemicalFormula: "CaCl₂·2H₂O",
    ppm: { ca: 272.6, cl: 482.3 },
    notes: "Forma mais comum de cloreto de cálcio. Realça a sensação de malte e corpo.",
  },
  {
    id: "cacl2_anhydrous",
    name: "Cloreto de Cálcio (anidro)",
    chemicalFormula: "CaCl₂",
    ppm: { ca: 361.1, cl: 638.9 },
    notes: "Altamente higroscópico. Usar apenas se o rótulo indicar grau anidro puro.",
  },
  {
    id: "epsom",
    name: "Sal Amargo (Sal de Epsom)",
    chemicalFormula: "MgSO₄·7H₂O",
    ppm: { mg: 98.6, so4: 389.6 },
    notes: "Fornece magnésio (nutriente de levedura) e sulfato.",
  },
  {
    id: "mgcl2",
    name: "Cloreto de Magnésio",
    chemicalFormula: "MgCl₂·6H₂O",
    ppm: { mg: 119.6, cl: 348.8 },
    notes: "Fonte de magnésio e cloreto sem sulfato.",
  },
  {
    id: "nacl",
    name: "Sal de Cozinha (não iodado)",
    chemicalFormula: "NaCl",
    ppm: { na: 393.4, cl: 606.6 },
    notes: "Adiciona arredondamento de sabor em pequenas doses. Evitar sal iodado.",
  },
  {
    id: "bicarb",
    name: "Bicarbonato de Sódio",
    chemicalFormula: "NaHCO₃",
    ppm: { na: 273.7, hco3: 726.4 },
    notes: "Solúvel em água. Eleva a alcalinidade e o pH para cervejas muito escuras.",
  },
  {
    id: "chalk",
    name: "Giz (Carbonato de Cálcio)",
    chemicalFormula: "CaCO₃",
    ppm: { ca: 400.4, hco3: 1219.2 },
    insolubleInColdWater: true,
    notes: "Muito pouco solúvel em água pura sem CO₂. Na cervejaria, prefira bicarbonato de sódio.",
  },
];

export const zeroProfile: WaterProfile = { ca: 0, mg: 0, na: 0, so4: 0, cl: 0, hco3: 0 };

export const waterPresets: Record<string, WaterProfile> = {
  "Destilada / Osmose Reversa (RO)": zeroProfile,
  "Pilsen (Plzeň) - Muito Mole": { ca: 7, mg: 3, na: 2, so4: 5, cl: 5, hco3: 15 },
  "Munique - Moderada / Bicarbonatada": { ca: 76, mg: 17, na: 2, so4: 41, cl: 2, hco3: 152 },
  "Burton on Trent - Muito Sulfatada": { ca: 275, mg: 40, na: 25, so4: 610, cl: 35, hco3: 270 },
  "Dublin - Alta Alcalinidade (Stouts)": { ca: 118, mg: 4, na: 12, so4: 54, cl: 19, hco3: 160 },
  "IPA Americana - Lupulada / Seca": { ca: 110, mg: 18, na: 16, so4: 280, cl: 50, hco3: 0 },
  "NEIPA - Macia / Cloreto Elevado": { ca: 120, mg: 10, na: 15, so4: 75, cl: 175, hco3: 0 },
  "Equilibrada - Uso Geral": { ca: 80, mg: 5, na: 25, so4: 80, cl: 75, hco3: 50 },
};

/** Calculates ion concentrations after salt additions in a given volume of water. */
export function applySalts(source: WaterProfile, additionsG: Record<string, number>, liters: number): WaterProfile {
  const out = { ...source };
  if (liters <= 0) return out;
  for (const salt of saltsCatalog) {
    const g = additionsG[salt.id] ?? 0;
    if (g <= 0) continue;
    for (const [ion, ppmPerGram] of Object.entries(salt.ppm) as [Ion, number][]) {
      out[ion] += (g * ppmPerGram) / liters;
    }
  }
  return out;
}

/** Total alkalinity as CaCO3 in ppm (mg/L). 1 mEq/L HCO3 = 50 ppm as CaCO3 = 61 ppm HCO3. */
export const totalAlkalinity = (w: WaterProfile): number => Math.max(0, w.hco3 * (50 / 61));

/**
 * Kolbach Residual Alkalinity (RA) in ppm as CaCO3:
 * RA = TotalAlkalinity - (Ca / 3.5 + Mg / 7.0)
 */
export const residualAlkalinity = (w: WaterProfile): number => {
  const alk = totalAlkalinity(w);
  return alk - (w.ca / 3.5 + w.mg / 7.0);
};

/** Sulfate to chloride ratio with sensory balance interpretation. */
export function sulfateChlorideRatio(w: WaterProfile): number {
  if (w.cl <= 0) return w.so4 > 0 ? 99 : 0;
  return w.so4 / w.cl;
}

export function ratioDescription(ratio: number): string {
  if (ratio === 0) return "Sem sulfato/cloreto";
  if (ratio > 3.0) return "Muito amarga e seca (realce agressivo de lúpulo)";
  if (ratio >= 1.8) return "Amarga e limpa (ideal para IPAs e APAs)";
  if (ratio >= 0.8) return "Equilibrada (adequada para estilos gerais)";
  if (ratio >= 0.4) return "Maltada e macia (ideal para NEIPA, Stouts e Ales inglesas)";
  return "Muito maltada e redonda (realce pronunciado de doçura e corpo)";
}

/**
 * Split salt additions between mash and sparge water.
 */
export interface WaterVolumes {
  mashL: number;
  spargeL: number;
  totalL: number;
}

export interface SplitSaltResult {
  mashSalts: Record<string, number>;
  spargeSalts: Record<string, number>;
  totalSalts: Record<string, number>;
  mashProfile: WaterProfile;
  spargeProfile: WaterProfile;
  combinedProfile: WaterProfile;
}

export function calculateWaterSplit(
  source: WaterProfile,
  mashSalts: Record<string, number>,
  spargeSalts: Record<string, number>,
  volumes: WaterVolumes
): SplitSaltResult {
  const mashL = Math.max(0.001, volumes.mashL);
  const spargeL = Math.max(0, volumes.spargeL);
  const totalL = Math.max(0.001, volumes.totalL || mashL + spargeL);

  const mashProfile = applySalts(source, mashSalts, mashL);
  const spargeProfile = spargeL > 0 ? applySalts(source, spargeSalts, spargeL) : { ...source };

  const totalSalts: Record<string, number> = {};
  for (const s of saltsCatalog) {
    const sum = (mashSalts[s.id] ?? 0) + (spargeSalts[s.id] ?? 0);
    if (sum > 0) totalSalts[s.id] = Math.round(sum * 100) / 100;
  }

  const combinedProfile: WaterProfile = { ...zeroProfile };
  for (const i of ions) {
    combinedProfile[i.id] = (mashProfile[i.id] * mashL + spargeProfile[i.id] * spargeL) / totalL;
  }

  return { mashSalts, spargeSalts, totalSalts, mashProfile, spargeProfile, combinedProfile };
}

/**
 * Smart Water Salt Optimizer:
 * Calculates the optimal non-negative addition of brewing salts to match a target profile.
 * - Respects maximum brewing limits.
 * - Prevents insoluble CaCO3 (chalk) from being recommended automatically.
 * - Reports target achievements, remaining deviations, and diagnostic explanations.
 */
export interface OptimizerReport {
  additions: Record<string, number>;
  achievedProfile: WaterProfile;
  deviations: Record<Ion, number>;
  ratio: number;
  residualAlkalinity: number;
  warnings: string[];
  success: boolean;
}

export function optimizeSalts(
  source: WaterProfile,
  target: WaterProfile,
  liters: number,
  options: { allowChalk?: boolean; maxSalts?: Record<string, number> } = {}
): OptimizerReport {
  const warnings: string[] = [];
  const safeLiters = Math.max(0.1, liters);
  const add: Record<string, number> = {};

  // Check if source water already exceeds target in any ion
  for (const ion of ions) {
    if (source[ion.id] > target[ion.id] + 5) {
      warnings.push(
        `A água de origem já contém ${Math.round(source[ion.id])} ppm de ${ion.label}, superando o alvo de ${Math.round(target[ion.id])} ppm. Para reduzir este íon, dilua com água de osmose reversa (RO).`
      );
    }
  }

  // 1. Magnesium adjustment: Epsom salt (MgSO4) or MgCl2
  const mgDeficit = Math.max(0, target.mg - source.mg);
  if (mgDeficit > 0) {
    const prefersCl = target.cl - source.cl > target.so4 - source.so4 && target.so4 <= 80;
    if (prefersCl) {
      add.mgcl2 = (mgDeficit * safeLiters) / 119.6;
    } else {
      add.epsom = (mgDeficit * safeLiters) / 98.6;
    }
  }
  let cur = applySalts(source, add, safeLiters);

  // 2. Bicarbonate adjustment: Baking Soda (NaHCO3, which also contributes Na)
  const hco3Deficit = Math.max(0, target.hco3 - cur.hco3);
  if (hco3Deficit > 0) {
    if (options.allowChalk) {
      warnings.push("Giz (CaCO₃) tem solubilidade limitada em água pura (~0,05 g/L). Utilizado apenas se for dissolvido na mostura ácida.");
      add.chalk = (hco3Deficit * safeLiters) / 1219.2;
    } else {
      add.bicarb = (hco3Deficit * safeLiters) / 726.4;
    }
  }
  cur = applySalts(source, add, safeLiters);

  // 3. Sodium adjustment: Table salt (NaCl, which also contributes Cl)
  const naDeficit = Math.max(0, target.na - cur.na);
  if (naDeficit > 0) {
    add.nacl = (naDeficit * safeLiters) / 393.4;
  }
  cur = applySalts(source, add, safeLiters);

  // 4. Sulfate adjustment: Gypsum (CaSO4, which also contributes Ca)
  const so4Deficit = Math.max(0, target.so4 - cur.so4);
  if (so4Deficit > 0) {
    add.gypsum = (so4Deficit * safeLiters) / 557.9;
  }
  cur = applySalts(source, add, safeLiters);

  // 5. Chloride adjustment: CaCl2 (which also contributes Ca)
  const clDeficit = Math.max(0, target.cl - cur.cl);
  if (clDeficit > 0) {
    add.cacl2 = (clDeficit * safeLiters) / 482.3;
  }
  cur = applySalts(source, add, safeLiters);

  // 6. Remaining Calcium evaluation
  const caDeficit = Math.max(0, target.ca - cur.ca);
  if (caDeficit > 15) {
    // Only top up calcium if it is deficient (< 50 ppm) and there is tolerance in anions
    if (cur.ca < 50) {
      if (cur.so4 < target.so4 * 1.15) {
        add.gypsum = (add.gypsum ?? 0) + (caDeficit * safeLiters) / 232.8;
      } else if (cur.cl < target.cl * 1.15) {
        add.cacl2 = (add.cacl2 ?? 0) + (caDeficit * safeLiters) / 272.6;
      }
    } else {
      warnings.push(
        `Cálcio obtido (${Math.round(cur.ca)} ppm) atende os requisitos de mostura (≥ 50 ppm). Sais adicionais de cálcio não foram acrescentados para preservar os alvos de sulfato (${target.so4} ppm), cloreto (${target.cl} ppm) e a relação sulfato/cloreto.`
      );
    }
  }

  // Round additions to 1 decimal place (0.1 g precision)
  for (const k of Object.keys(add)) {
    add[k] = Math.round(add[k] * 10) / 10;
  }

  const achieved = applySalts(source, add, safeLiters);
  const deviations: Record<Ion, number> = { ...zeroProfile };
  let maxRelDev = 0;

  for (const ion of ions) {
    const diff = achieved[ion.id] - target[ion.id];
    deviations[ion.id] = Math.round(diff * 10) / 10;
    const base = Math.max(15, target[ion.id]);
    const rel = Math.abs(diff) / base;
    if (rel > maxRelDev) maxRelDev = rel;
  }

  const ratio = sulfateChlorideRatio(achieved);
  const ra = residualAlkalinity(achieved);

  return {
    additions: add,
    achievedProfile: achieved,
    deviations,
    ratio,
    residualAlkalinity: ra,
    warnings,
    success: maxRelDev <= 0.35,
  };
}

/**
 * Mash pH Estimation Model:
 * Evaluates the buffered equilibrium between malt acidity, water alkalinity,
 * calcium/magnesium phosphate precipitation, and added brewing acids.
 *
 * References:
 * - Palmer & Kaminski ("Water: A Comprehensive Guide for Brewers")
 * - Troester ("Braukaiser - Mash pH and Water Chemistry")
 * - deLange ("Understanding Mash pH")
 */
export interface GrainAddition {
  name: string;
  kg: number;
  colorLovibond: number;
  type?: "base" | "crystal" | "roasted" | "acidulated";
}

export interface AcidAddition {
  lactic85Ml?: number;
  phosphoric75Ml?: number;
  phosphoric10Ml?: number;
  acidulatedMaltGrams?: number;
}

export interface MashPhEstimate {
  estimatedPh: number;
  baseMaltPh: number;
  waterAlkalinityEffect: number;
  calciumMagnesiumEffect: number;
  grainColorEffect: number;
  acidEffect: number;
  residualAlkalinity: number;
  notes: string[];
}

export function estimateMashPh(
  grains: GrainAddition[],
  mashWaterL: number,
  waterProfile: WaterProfile,
  acids: AcidAddition = {}
): MashPhEstimate {
  const notes: string[] = [];
  const safeWaterL = Math.max(1, mashWaterL);
  const totalGrainKg = Math.max(0.1, grains.reduce((sum, g) => sum + g.kg, 0));

  // 1. Distilled water baseline pH of malts by type and color (Palmer / Troester)
  let weightedPhSum = 0;
  for (const g of grains) {
    let maltDistilledPh = 5.75;
    if (g.type === "acidulated") {
      maltDistilledPh = 3.6;
    } else if (g.type === "roasted" || g.colorLovibond >= 150) {
      maltDistilledPh = 4.7 - 0.001 * Math.min(300, g.colorLovibond);
    } else if (g.type === "crystal" || (g.colorLovibond > 10 && g.colorLovibond < 150)) {
      maltDistilledPh = 5.2 - 0.0035 * Math.min(100, g.colorLovibond);
    } else {
      // Base malts: Pilsen ~5.65, Pale Ale ~5.55, Vienna/Munich ~5.40
      maltDistilledPh = Math.max(5.35, 5.68 - 0.02 * Math.min(15, g.colorLovibond));
    }
    weightedPhSum += g.kg * maltDistilledPh;
  }
  const baseMaltPh = weightedPhSum / totalGrainKg;

  // 2. Kolbach residual alkalinity and water buffer effect
  const ra = residualAlkalinity(waterProfile);
  // Total alkalinity elevates pH (~0.0016 pH per ppm CaCO3 per (L/kg) water-to-grain ratio)
  const waterAlkalinityEffect = (0.0016 * totalAlkalinity(waterProfile) * safeWaterL) / (totalGrainKg * 3.0);

  // 3. Calcium and Magnesium acidifying effect (Kolbach reaction: Ca3(PO4)2 precipitation releases H+)
  const calciumMagnesiumEffect = -((waterProfile.ca / 3.5 + waterProfile.mg / 7.0) * 0.0016 * safeWaterL) / (totalGrainKg * 3.0);

  // 4. Net grain color effect relative to base malts
  const avgLovibond = grains.reduce((sum, g) => sum + g.kg * g.colorLovibond, 0) / totalGrainKg;
  const grainColorEffect = avgLovibond > 5 ? -Math.min(0.3, (avgLovibond - 5) * 0.002) : 0;

  // 5. Acid additions
  // 1 mL of Lactic 85% contains ~11.3 mEq H+
  const lacticMeq = (acids.lactic85Ml ?? 0) * 11.3;
  // 1 mL Phosphoric 75% contains ~11.5 mEq H+; 10% contains ~1.5 mEq H+
  const phosMeq = (acids.phosphoric75Ml ?? 0) * 11.5 + (acids.phosphoric10Ml ?? 0) * 1.5;
  // 100 g Acidulated malt contains ~2.5% lactic acid (~28 mEq H+)
  const acidMaltMeq = ((acids.acidulatedMaltGrams ?? 0) / 100) * 28;

  const totalAcidMeq = lacticMeq + phosMeq + acidMaltMeq;
  // Typical malt buffering capacity in mash is ~40 mEq/kg of grain per unit pH drop
  const maltBufferCapacity = totalGrainKg * 40;
  const acidEffect = maltBufferCapacity > 0 ? -(totalAcidMeq / maltBufferCapacity) : 0;

  let estimatedPh = baseMaltPh + waterAlkalinityEffect + calciumMagnesiumEffect + acidEffect;
  estimatedPh = Math.round(Math.max(4.5, Math.min(6.5, estimatedPh)) * 100) / 100;

  if (estimatedPh < 5.2) {
    notes.push("pH da mostura abaixo do ideal (< 5,2). Risco de menor rendimento enzimático e cerveja com acidez residual excessiva.");
  } else if (estimatedPh > 5.6) {
    notes.push("pH da mostura acima do ideal (> 5,6). Risco de menor clarificação, amargor adstringente e menor conversão enzimática.");
  } else {
    notes.push("pH da mostura na faixa ideal cervejeira (5,2 a 5,6 à temperatura ambiente).");
  }

  return {
    estimatedPh,
    baseMaltPh: Math.round(baseMaltPh * 100) / 100,
    waterAlkalinityEffect: Math.round(waterAlkalinityEffect * 100) / 100,
    calciumMagnesiumEffect: Math.round(calciumMagnesiumEffect * 100) / 100,
    grainColorEffect: Math.round(grainColorEffect * 100) / 100,
    acidEffect: Math.round(acidEffect * 100) / 100,
    residualAlkalinity: Math.round(ra * 10) / 10,
    notes,
  };
}
