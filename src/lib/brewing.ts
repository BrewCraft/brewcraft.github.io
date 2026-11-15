/** Brewing calculations use liters, kilograms, Celsius and SG unless stated otherwise. */

/** Lincoln polynomial for SG to Plato (°P). Clamped at 0 for pure water / sub-1.0 gravity. */
export const sgToPlato = (sg: number): number => {
  if (sg <= 1) return 0;
  const p = -616.868 + 1111.14 * sg - 630.272 * sg ** 2 + 135.997 * sg ** 3;
  return Math.max(0, p);
};

/** ASBC polynomial inversion for Plato (°P) to SG. */
export const platoToSg = (p: number): number => {
  if (p <= 0) return 1;
  const denom = 258.6 - (p / 258.2) * 227.1;
  if (denom <= 0) return 1 + p / 258.6;
  return 1 + p / denom;
};

/**
 * Complete alcoholic fermentation calculation:
 * - abv: Standard formula (Miller / Papazian / Palmer) (OG - FG) * 131.25
 * - abvAlternative: Hall advanced formula for high-gravity beers (> 6% ABV)
 * - abw: Alcohol by Weight (ASBC Balling relation)
 * - apparent: Apparent degree of attenuation (%)
 * - real: Real degree of fermentation (%)
 * - realExtract: Balling real extract in °P
 * - calories: ASBC / USDA caloric estimation per serving
 */
export const alcohol = (og: number, fg: number, serving = 355) => {
  if (og <= 1 || fg <= 0) {
    return { abv: 0, abvAlternative: 0, abw: 0, apparent: 0, real: 0, realExtract: 0, calories: 0 };
  }
  const abv = Math.max(0, (og - fg) * 131.25);
  const abvAlternative = og < 1.775 && og > fg
    ? Math.max(0, (76.08 * (og - fg) / (1.775 - og)) * (fg / 0.794))
    : abv;
  const apparent = og > 1 ? Math.max(0, ((og - fg) / (og - 1)) * 100) : 0;
  const op = sgToPlato(og);
  const fp = sgToPlato(fg);
  const realExtract = Math.max(0, 0.1808 * op + 0.8192 * fp);
  const denomAbw = 2.0664 - 0.010664 * op;
  const abw = denomAbw > 0 && op > realExtract ? Math.max(0, (op - realExtract) / denomAbw) : 0;
  const carbExtract = Math.max(0, realExtract - 0.1);
  const safeServing = Math.max(0, serving);
  const calories = Math.max(0, (6.9 * abw + 4 * carbExtract) * fg * safeServing / 100);
  const real = op > 0 ? Math.max(0, ((op - realExtract) / op) * 100) : 0;
  return { abv, abvAlternative, abw, apparent, real, realExtract, calories };
};

/**
 * Sean Terrill linear model for refractometer reading of fermented wort.
 * For unfermented wort, use platoToSg(brix / correction).
 */
export const correctedRefractometer = (originalBrix: number, currentBrix: number, correction = 1.04) => {
  const factor = correction > 0 ? correction : 1;
  const ob = Math.max(0, originalBrix) / factor;
  const fb = Math.max(0, currentBrix) / factor;
  return 1 - 0.00085683 * ob + 0.0034941 * fb;
};

const hydrometerFactor = (f: number) => 1.00130346 - 0.000134722124 * f + 0.00000204052596 * f ** 2 - 0.00000000232820948 * f ** 3;

/** Hydrometer temperature correction based on calibration temperature (default 20°C). */
export const correctedHydrometer = (sg: number, measuredC: number, calibrationC = 20) => {
  if (sg <= 0) return 0;
  const fSample = hydrometerFactor(measuredC * 1.8 + 32);
  const fCal = hydrometerFactor(calibrationC * 1.8 + 32);
  return fCal > 0 ? sg * (fSample / fCal) : sg;
};

/** Specific gravity adjustment following volume changes (boil evaporation or dilution). */
export const gravityAfterVolumeChange = (sg: number, initial: number, final: number) => {
  if (final <= 0 || initial <= 0) return sg;
  return 1 + (sg - 1) * initial / final;
};

/**
 * Carbonation and priming calculations:
 * - residual: dissolved CO2 in volumes based on highest fermentation temperature
 * - sugar: required priming sugar (g) for bottle conditioning
 * - psi & bar: keg equilibrium pressure at serving temperature
 * - gl: carbonation in grams per liter (1 vol ≈ 1.96 g/L)
 */
export const carbonation = (temperature: number, target: number, liters: number, sugarFactor = 4) => {
  const f = temperature * 1.8 + 32;
  const residualRaw = 3.0378 - 0.050062 * f + 0.00026555 * f ** 2;
  const residual = Math.max(0, residualRaw);
  const psiRaw = -16.6999 - 0.0101059 * f + 0.00116512 * f ** 2 + 0.173354 * f * target + 4.24267 * target - 0.0684226 * target ** 2;
  const psi = Math.max(0, psiRaw);
  const sugar = Math.max(0, target - residual) * Math.max(0, liters) * sugarFactor;
  return { residual, sugar, psi, bar: psi / 14.5037738, gl: target * 1.96 };
};

/**
 * Hop alpha-acid degradation over storage time:
 * First-order exponential decay at 20°C with Arrhenius Q10 = 2 temperature adjustment
 * and packaging barrier factor.
 */
export const hopFreshness = (alpha: number, lossSixMonths: number, days: number, temperature: number, packaging = 1) => {
  const safeLoss = Math.min(99.9, Math.max(0, lossSixMonths));
  const safeAlpha = Math.max(0, alpha);
  const safeDays = Math.max(0, days);
  const k = -Math.log(1 - safeLoss / 100) / 180;
  const retention = Math.exp(-k * safeDays * 2 ** ((temperature - 20) / 10) * packaging);
  return { alpha: safeAlpha * retention, retention: Math.min(100, Math.max(0, retention * 100)) };
};

/** Strike water temperature by thermal equilibrium (Palmer / Hall). */
export const strikeTemperature = (grainKg: number, waterL: number, grainC: number, targetC: number, tunEquivalentL = 0, tunC = 20) => {
  if (waterL <= 0) return targetC;
  return targetC + (0.41 * grainKg * (targetC - grainC) + tunEquivalentL * (targetC - tunC)) / waterL;
};

/** Hot water infusion volume to step mash temperature without external heat. */
export const infusionWater = (grainKg: number, waterL: number, currentC: number, targetC: number, infusionC = 100) => {
  if (infusionC <= targetC) return 0;
  return (targetC - currentC) * (0.41 * grainKg + waterL) / (infusionC - targetC);
};

/** Mash tun thermal mass calibration in equivalent liters of water. */
export const tunCalibration = (grainKg: number, waterL: number, grainC: number, waterC: number, tunC: number, finalC: number) => {
  if (finalC <= tunC) return 0;
  return (waterL * (waterC - finalC) - 0.41 * grainKg * (finalC - grainC)) / (finalC - tunC);
};

export {
  type FermentationType,
  type YeastForm,
  type StarterAgitation,
  type StarterStageInput,
  type StarterStageResult,
  type StarterSimulationResult,
  type BatchYeastPlan,
  pitchRatePresets,
  estimateYeastViability,
  simulateStarterStages,
  planBatchYeast,
} from "./yeast-calc";

/**
 * Yeast pitch rate and propagation:
 * - needed: required cells (billions)
 * - available: viable cells currently available (billions)
 * - deficit: missing cells before starter
 * - propagated: estimated cells after starter
 */
export const yeastPitch = (liters: number, sg: number, rate: number, packs: number, cellsPerPack: number, viability: number, starterLiters: number, yieldPerGram: number) => {
  const plato = sgToPlato(sg);
  const needed = Math.max(0, liters * plato * rate);
  const available = Math.max(0, packs * cellsPerPack * Math.max(0, viability) / 100);
  const extractGrams = Math.max(0, starterLiters) * 100;
  return { needed, available, deficit: Math.max(0, needed - available), propagated: available + extractGrams * yieldPerGram, extractGrams };
};

/** Glenn Tinseth IBU formula for boil hop additions. */
export const ibuTinseth = (grams: number, alphaPercent: number, minutes: number, liters: number, sg: number): number => {
  if (liters <= 0 || minutes <= 0 || grams <= 0 || alphaPercent <= 0) return 0;
  const bigness = 1.65 * 0.000125 ** (sg - 1);
  const boilFactor = (1 - Math.exp(-0.04 * minutes)) / 4.15;
  const concentrationMgL = grams * alphaPercent * 10 / liters;
  return Math.max(0, bigness * boilFactor * concentrationMgL);
};

/** Jackie Rager IBU formula with gravity adjustment for dense wort. */
export const ibuRager = (grams: number, alphaPercent: number, minutes: number, liters: number, sg: number): number => {
  if (liters <= 0 || minutes <= 0 || grams <= 0 || alphaPercent <= 0) return 0;
  const utilization = (18.11 + 13.86 * Math.tanh((minutes - 31.32) / 18.27)) / 100;
  const gravityAdjustment = sg > 1.050 ? (sg - 1.050) / 0.2 : 0;
  const concentrationMgL = grams * alphaPercent * 10 / liters;
  return Math.max(0, (utilization * concentrationMgL) / (1 + gravityAdjustment));
};

/** Dan Morey SRM color formula for malt additions. */
export const moreySrm = (kg1: number, lovibond1: number, kg2: number, lovibond2: number, liters: number): number => {
  if (liters <= 0) return 0;
  const gal = liters / 3.785411784;
  const lb1 = kg1 * 2.2046226218;
  const lb2 = kg2 * 2.2046226218;
  const mcu = (lb1 * lovibond1 + lb2 * lovibond2) / gal;
  return mcu <= 0 ? 0 : 1.4922 * mcu ** 0.6859;
};

/**
 * Brewhouse efficiency calculator:
 * Compares actual gravity points in fermenter against theoretical maximum extract.
 */
export const brewhouseEfficiency = (volumeL: number, measuredOg: number, grainKg: number, potentialSg = 1.037) => {
  if (volumeL <= 0 || grainKg <= 0 || potentialSg <= 1) {
    return { efficiency: 0, actualPoints: 0, potentialPoints: 0, pointsPerKg: 0 };
  }
  const actualPoints = Math.max(0, (measuredOg - 1) * 1000 * volumeL);
  const potentialPoints = Math.max(0, (potentialSg - 1) * 1000 * 8.3454 * grainKg);
  const efficiency = potentialPoints > 0 ? (actualPoints / potentialPoints) * 100 : 0;
  const pointsPerKg = actualPoints / grainKg;
  return { efficiency, actualPoints, potentialPoints, pointsPerKg };
};

/**
 * Theoretical OG and FG estimation from grain bill, efficiency and yeast attenuation.
 */
export const estimateOgFg = (grainKg: number, volumeL: number, efficiencyPercent: number, attenuationPercent: number, potentialSg = 1.037) => {
  if (volumeL <= 0 || grainKg <= 0) {
    return { og: 1, fg: 1, points: 0, abv: 0, plato: 0 };
  }
  const points = (potentialSg - 1) * 1000 * 8.3454 * grainKg * (efficiencyPercent / 100);
  const og = 1 + points / volumeL / 1000;
  const fg = 1 + (og - 1) * (1 - attenuationPercent / 100);
  const abv = Math.max(0, (og - fg) * 131.25);
  const plato = sgToPlato(og);
  return { og, fg, points, abv, plato };
};

export const unitFamilies = {
  volume: { label: "Volume", units: { L: 1, mL: 0.001, "m³": 1000, "gal (US)": 3.785411784, "gal (UK)": 4.54609, "fl oz (US)": 0.0295735295625, "pint (US)": 0.473176473 } },
  weight: { label: "Peso", units: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.45359237, oz: 0.028349523125 } },
  pressure: { label: "Pressão", units: { bar: 1, psi: 0.0689475729318, kPa: 0.01, Pa: 0.00001, atm: 1.01325 } },
  temperature: { label: "Temperatura", units: { "°C": 1, "°F": 1, K: 1 } },
  length: { label: "Comprimento", units: { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 } },
} as const;

export type UnitFamily = keyof typeof unitFamilies;

export function convertUnit(value: number, family: UnitFamily, from: string, to: string): number {
  if (from === to) return value;
  if (family === "temperature") {
    const c = from === "°F" ? (value - 32) / 1.8 : from === "K" ? value - 273.15 : value;
    return to === "°F" ? c * 1.8 + 32 : to === "K" ? c + 273.15 : c;
  }
  const familyDef = unitFamilies[family];
  if (!familyDef) return value;
  const factors: Record<string, number> = familyDef.units;
  const fromFactor = factors[from];
  const toFactor = factors[to];
  if (!fromFactor || !toFactor) return value;
  return value * fromFactor / toFactor;
}
