/** Brewing calculations use liters, kilograms, Celsius and SG unless stated otherwise. */
export const sgToPlato = (sg: number) => -616.868 + 1111.14 * sg - 630.272 * sg ** 2 + 135.997 * sg ** 3;
export const platoToSg = (p: number) => 1 + p / (258.6 - (p / 258.2) * 227.1);
export const alcohol = (og: number, fg: number, serving: number) => {
  const abv = (og - fg) * 131.25;
  const apparent = (og - fg) / (og - 1) * 100;
  const op = sgToPlato(og), fp = sgToPlato(fg);
  const realExtract = 0.1808 * op + 0.8192 * fp;
  const abw = (op - realExtract) / (2.0664 - 0.010664 * op);
  const calories = Math.max(0, (6.9 * abw + 4 * (realExtract - 0.1)) * fg * serving / 100);
  return { abv, apparent, real: (op - realExtract) / op * 100, calories };
};
export const correctedRefractometer = (originalBrix: number, currentBrix: number, correction: number) => {
  const ob = originalBrix / correction, fb = currentBrix / correction;
  // Sean Terrill linear model for fermented beer.
  return 1 - 0.00085683 * ob + 0.0034941 * fb;
};
const hydrometerFactor = (f: number) => 1.00130346 - 0.000134722124 * f + 0.00000204052596 * f ** 2 - 0.00000000232820948 * f ** 3;
export const correctedHydrometer = (sg: number, measuredC: number, calibrationC: number) => sg * hydrometerFactor(measuredC * 1.8 + 32) / hydrometerFactor(calibrationC * 1.8 + 32);
export const gravityAfterVolumeChange = (sg: number, initial: number, final: number) => 1 + (sg - 1) * initial / final;
export const carbonation = (temperature: number, target: number, liters: number, sugarFactor: number) => {
  const f = temperature * 1.8 + 32;
  const residual = 3.0378 - 0.050062 * f + 0.00026555 * f ** 2;
  const psi = -16.6999 - 0.0101059 * f + 0.00116512 * f ** 2 + 0.173354 * f * target + 4.24267 * target - 0.0684226 * target ** 2;
  return { residual, sugar: Math.max(0, target - residual) * liters * sugarFactor, psi, bar: psi / 14.5037738 };
};
export const hopFreshness = (alpha: number, lossSixMonths: number, days: number, temperature: number, packaging: number) => {
  const k = -Math.log(1 - lossSixMonths / 100) / 180;
  const retention = Math.exp(-k * days * 2 ** ((temperature - 20) / 10) * packaging);
  return { alpha: alpha * retention, retention: retention * 100 };
};
export const strikeTemperature = (grainKg: number, waterL: number, grainC: number, targetC: number, tunEquivalentL: number, tunC: number) => targetC + (0.41 * grainKg * (targetC - grainC) + tunEquivalentL * (targetC - tunC)) / waterL;
export const infusionWater = (grainKg: number, waterL: number, currentC: number, targetC: number, infusionC: number) => (targetC - currentC) * (0.41 * grainKg + waterL) / (infusionC - targetC);
export const tunCalibration = (grainKg: number, waterL: number, grainC: number, waterC: number, tunC: number, finalC: number) => (waterL * (waterC - finalC) - 0.41 * grainKg * (finalC - grainC)) / (finalC - tunC);
export const yeastPitch = (liters: number, sg: number, rate: number, packs: number, cellsPerPack: number, viability: number, starterLiters: number, yieldPerGram: number) => {
  const needed = liters * sgToPlato(sg) * rate;
  const available = packs * cellsPerPack * viability / 100;
  const extractGrams = starterLiters * 100;
  return { needed, available, deficit: Math.max(0, needed - available), propagated: available + extractGrams * yieldPerGram, extractGrams };
};
export const ibuTinseth = (grams: number, alphaPercent: number, minutes: number, liters: number, sg: number) => 1.65 * 0.000125 ** (sg - 1) * (1 - Math.exp(-0.04 * minutes)) / 4.15 * grams * alphaPercent * 10 / liters;
export const moreySrm = (kg1: number, lovibond1: number, kg2: number, lovibond2: number, liters: number) => 1.4922 * ((kg1 * lovibond1 + kg2 * lovibond2) * 2.2046226218 / (liters / 3.785411784)) ** 0.6859;

export const unitFamilies = {
  volume: { label: "Volume", units: { L: 1, mL: 0.001, "m³": 1000, "gal (US)": 3.785411784, "gal (UK)": 4.54609, "fl oz (US)": 0.0295735295625, "pint (US)": 0.473176473 } },
  weight: { label: "Peso", units: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.45359237, oz: 0.028349523125 } },
  pressure: { label: "Pressão", units: { bar: 1, psi: 0.0689475729318, kPa: 0.01, Pa: 0.00001, atm: 1.01325 } },
  temperature: { label: "Temperatura", units: { "°C": 1, "°F": 1, K: 1 } },
  length: { label: "Comprimento", units: { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 } },
} as const;
export type UnitFamily = keyof typeof unitFamilies;
export function convertUnit(value: number, family: UnitFamily, from: string, to: string) {
  if (family === "temperature") {
    const c = from === "°F" ? (value - 32) / 1.8 : from === "K" ? value - 273.15 : value;
    return to === "°F" ? c * 1.8 + 32 : to === "K" ? c + 273.15 : c;
  }
  const factors: Record<string, number> = unitFamilies[family].units;
  return value * factors[from] / factors[to];
}
