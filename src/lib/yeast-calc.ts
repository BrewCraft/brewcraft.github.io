/**
 * Advanced yeast pitching rate and dynamic propagation model.
 *
 * References:
 * - Kai Troester (Braukaiser) Starter Growth and Cell Count Models
 * - Chris White & Jamil Zainasheff ("Yeast: The Practical Guide to Beer Fermentation")
 * - ASBC Methods of Analysis (Yeast-14: Pitching Rates)
 * - George Fix ("Principles of Brewing Science")
 */

import { sgToPlato } from "./brewing";

export type FermentationType = "ale" | "ale_high_gravity" | "lager" | "lager_high_gravity" | "hybrid";

export interface PitchRateRecommendation {
  type: FermentationType;
  label: string;
  rateMillionPerMlPerPlato: number;
  description: string;
}

export const pitchRatePresets: Record<FermentationType, PitchRateRecommendation> = {
  ale: {
    type: "ale",
    label: "Ale Padrão (OG ≤ 1,060)",
    rateMillionPerMlPerPlato: 0.75,
    description: "Taxa padrão ASBC para ales de média e baixa densidade.",
  },
  ale_high_gravity: {
    type: "ale_high_gravity",
    label: "Ale de Alta Densidade (OG > 1,060)",
    rateMillionPerMlPerPlato: 1.0,
    description: "Para IPAs potentes, Belgian Strong Ales e Barleywines.",
  },
  hybrid: {
    type: "hybrid",
    label: "Híbrida / Kölsch / Altbier",
    rateMillionPerMlPerPlato: 1.0,
    description: "Fermentação fria em ales ou temperatura amena em lagers.",
  },
  lager: {
    type: "lager",
    label: "Lager Padrão (OG ≤ 1,060)",
    rateMillionPerMlPerPlato: 1.5,
    description: "Taxa padrão para fermentação fria de lagers (8 a 12 °C).",
  },
  lager_high_gravity: {
    type: "lager_high_gravity",
    label: "Lager de Alta Densidade (Bocks / Doppelbocks)",
    rateMillionPerMlPerPlato: 2.0,
    description: "Garante perfil limpo e atenuação completa em lagers alcoólicas.",
  },
};

export type YeastForm = "liquid" | "dry";

export interface YeastViabilityResult {
  form: YeastForm;
  daysOld: number;
  viabilityPercent: number;
  totalViableCellsBillions: number;
  note: string;
}

/**
 * Calculates yeast viability based on storage age and form.
 * - Liquid yeast: White Labs empirical decay model (~0.7% daily decay under refrigeration).
 * - Dry yeast: Vacuum sealed sachet decay (~0.5% monthly decay).
 */
export function estimateYeastViability(
  form: YeastForm,
  daysOld: number,
  packs = 1,
  nominalCellsPerPackBillions = form === "liquid" ? 100 : 150
): YeastViabilityResult {
  const safeDays = Math.max(0, daysOld);
  let viability = 100;

  if (form === "liquid") {
    // White Labs empirical linear model: ~21% per month = ~0.7% per day
    viability = Math.max(0, Math.min(100, 100 - safeDays * 0.7));
  } else {
    // Dry yeast sealed: ~0.5% loss per 30 days
    viability = Math.max(50, Math.min(100, 100 - (safeDays / 30) * 0.5));
  }

  viability = Math.round(viability * 10) / 10;
  const viableCellsPerPack = (nominalCellsPerPackBillions * viability) / 100;
  const totalViable = Math.round(packs * viableCellsPerPack * 10) / 10;

  let note = "Levedura fresca com alta viabilidade.";
  if (viability < 40) {
    note = "Viabilidade muito baixa. Um starter de propagação em múltiplos estágios é indispensável.";
  } else if (viability < 70) {
    note = "Viabilidade reduzida pela idade. Recomenda-se propagação em starter para vitalidade celular.";
  }

  return {
    form,
    daysOld: safeDays,
    viabilityPercent: viability,
    totalViableCellsBillions: totalViable,
    note,
  };
}

export type StarterAgitation = "stir_plate" | "shaking" | "still";

export interface StarterStageInput {
  volumeL: number;
  gravitySg?: number; // default 1.037 (approx 100g DME / L)
  agitation: StarterAgitation;
}

export interface StarterStageResult {
  stage: number;
  volumeL: number;
  gravitySg: number;
  extractGrams: number;
  initialCellsBillions: number;
  inoculationRateBillionPerGram: number;
  yieldPerGram: number;
  newCellsProducedBillions: number;
  finalCellsBillions: number;
  growthFactor: number;
  saturationWarning?: string;
}

export interface StarterSimulationResult {
  stages: StarterStageResult[];
  finalCellsBillions: number;
  totalExtractGrams: number;
  totalVolumeL: number;
  targetMet: boolean;
  deficitRemainingBillions: number;
}

/**
 * Kai Troester (Braukaiser) empirical dynamic growth model for starters:
 * Evaluates cell division based on initial cell-to-extract ratio (Inoculation Rate).
 * - Stir plate: continuous agitation and aeration
 * - Shaking: intermittent manual shaking
 * - Still: simple fermentation without agitation
 */
export function simulateStarterStages(
  initialViableCellsBillions: number,
  stages: StarterStageInput[],
  targetCellsBillions: number
): StarterSimulationResult {
  const stageResults: StarterStageResult[] = [];
  let currentCells = Math.max(0.1, initialViableCellsBillions);
  let totalExtract = 0;
  let totalVol = 0;

  stages.forEach((stage, idx) => {
    const volL = Math.max(0.1, stage.volumeL);
    const sg = stage.gravitySg && stage.gravitySg >= 1.01 ? stage.gravitySg : 1.037;
    // Extract in grams: 1 L of 1.037 SG wort has approx 100g of dry malt extract (DME)
    const plato = sgToPlato(sg);
    const extractGrams = Math.round(volL * plato * 10.5 * 10) / 10;
    totalExtract += extractGrams;
    totalVol += volL;

    // Inoculation rate in billions of cells per gram of extract
    const ir = currentCells / extractGrams;
    let yieldFactor = 0;
    let saturationWarning: string | undefined;

    // Troester empirical yield curve on stir plate
    if (ir < 1.4) {
      yieldFactor = 1.4;
    } else if (ir < 3.5) {
      yieldFactor = Math.max(0.1, 2.33 - 0.67 * ir);
    } else if (ir < 5.0) {
      yieldFactor = Math.max(0, 0.16 * (5.0 - ir));
      saturationWarning = "Taxa de inoculação alta no starter (> 3,5 B/g); o crescimento celular satura com pouco ganho de novas células.";
    } else {
      yieldFactor = 0;
      saturationWarning = "Starter saturado. A quantidade de levedura inoculada é muito grande para o volume de mosto; não haverá divisão celular.";
    }

    // Adjust yield factor by agitation method
    if (stage.agitation === "shaking") {
      yieldFactor *= 0.65;
    } else if (stage.agitation === "still") {
      yieldFactor *= 0.4;
    }

    const newCells = Math.round(extractGrams * yieldFactor * 10) / 10;
    const finalCells = Math.round((currentCells + newCells) * 10) / 10;
    const growthFactor = Math.round((finalCells / currentCells) * 100) / 100;

    stageResults.push({
      stage: idx + 1,
      volumeL: volL,
      gravitySg: sg,
      extractGrams,
      initialCellsBillions: Math.round(currentCells * 10) / 10,
      inoculationRateBillionPerGram: Math.round(ir * 100) / 100,
      yieldPerGram: Math.round(yieldFactor * 100) / 100,
      newCellsProducedBillions: newCells,
      finalCellsBillions: finalCells,
      growthFactor,
      saturationWarning,
    });

    currentCells = finalCells;
  });

  const deficit = Math.max(0, Math.round((targetCellsBillions - currentCells) * 10) / 10);

  return {
    stages: stageResults,
    finalCellsBillions: currentCells,
    totalExtractGrams: Math.round(totalExtract * 10) / 10,
    totalVolumeL: Math.round(totalVol * 100) / 100,
    targetMet: currentCells >= targetCellsBillions,
    deficitRemainingBillions: deficit,
  };
}

/**
 * Convenient single-stage starter simulator using the Troester model.
 */
export function simulateStarterStage(
  inputCellsBillions: number,
  volumeL: number,
  og = 1.037,
  agitation: StarterAgitation = "stir_plate"
): StarterStageResult {
  const sim = simulateStarterStages(inputCellsBillions, [{ volumeL, gravitySg: og, agitation }], 0);
  return sim.stages[0];
}

export const estimateViability = (daysOld: number, form: YeastForm = "liquid") =>
  estimateYeastViability(form, daysOld).viabilityPercent;

/**
 * Complete batch yeast pitch evaluation:
 * - Calculates target cells needed
 * - Compares against available packs and viability
 * - Determines required starter volume or packages if deficient
 */
export interface BatchYeastPlan {
  volumeL: number;
  og: number;
  plato: number;
  pitchRate: number;
  targetCellsBillions: number;
  viableCellsAvailableBillions: number;
  deficitBillions: number;
  neededPacksWithoutStarter: number;
  suggestedStarterVolumeL: number;
  starterDmeGrams: number;
}

export function planBatchYeast(
  batchL: number,
  og: number,
  rate: number,
  availableViableCellsBillions: number,
  packNominalCellsBillions = 100
): BatchYeastPlan {
  const plato = sgToPlato(og);
  const targetCells = Math.round(batchL * plato * rate * 10) / 10;
  const deficit = Math.max(0, Math.round((targetCells - availableViableCellsBillions) * 10) / 10);

  // Number of fresh packs needed if pitched directly without starter
  const packsNeeded = Math.ceil(targetCells / Math.max(1, packNominalCellsBillions));

  // Starter size recommendation based on target gap
  let suggestedStarterL = 0;
  if (deficit > 0) {
    // Estimating ~120 to 140 billion cells generated per liter of 1.037 starter on stir plate
    suggestedStarterL = Math.max(1.0, Math.round((deficit / 130) * 10) / 10);
  }
  const starterDmeGrams = Math.round(suggestedStarterL * 100);

  return {
    volumeL: batchL,
    og,
    plato: Math.round(plato * 100) / 100,
    pitchRate: rate,
    targetCellsBillions: targetCells,
    viableCellsAvailableBillions: Math.round(availableViableCellsBillions * 10) / 10,
    deficitBillions: deficit,
    neededPacksWithoutStarter: packsNeeded,
    suggestedStarterVolumeL: suggestedStarterL,
    starterDmeGrams,
  };
}
