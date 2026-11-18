import { convertUnit, sgToPlato, platoToSg } from "./brewing";

export interface AppSettings {
  language: "pt-BR" | "en-US" | "es-ES" | "fr-FR" | "de-DE";
  theme: "light" | "dark" | "system";
  nextBatch: number;
  abvFormula: "standard" | "alternative";
  fgFormula: "normal" | "mash";
  ibuFormula: "tinseth" | "rager";
  inventory: boolean;
  negativeStock: boolean;
  brewMonitoring: boolean;
  nutrition: boolean;
  autoSave: boolean;
  buGu: boolean;
  rbr: boolean;
  gravity: "sg" | "plato";
  sgFormat: "decimal" | "points";
  color: "srm" | "ebc";
  grainColor: "lovibond" | "srm" | "ebc";
  temperature: "°C" | "°F";
  volume: "L" | "gal (US)" | "gal (UK)";
  weight: "kg" | "lb";
  hopWeight: "g" | "oz";
  carbonation: "vol" | "g/L";
  pressure: "bar" | "psi" | "kPa";
  altitude: "m" | "ft";
  diastatic: "lintner" | "wk";
  dateFormat: "auto" | "dmy" | "mdy" | "iso";
  timeFormat: "auto" | "12" | "24";
  mashReference: number;
  mashAdjustment: number;
  additionalMeasurements: string[];
  geminiApiKey: string;
  geminiModel: string;
}

export const defaultSettings: AppSettings = {
  language: "pt-BR", theme: "dark", nextBatch: 1, abvFormula: "standard", fgFormula: "normal", ibuFormula: "tinseth",
  inventory: true, negativeStock: false, brewMonitoring: true, nutrition: false, autoSave: false,
  buGu: true, rbr: false, gravity: "sg", sgFormat: "decimal", color: "srm", grainColor: "lovibond",
  temperature: "°C", volume: "L", weight: "kg", hopWeight: "g", carbonation: "vol", pressure: "bar",
  altitude: "m", diastatic: "lintner", dateFormat: "auto", timeFormat: "auto", mashReference: 66,
  mashAdjustment: 1, additionalMeasurements: [],
  geminiApiKey: "",
  geminiModel: "gemini-3.6-flash",
};
export const measurementOptions = [
  { id: "preBoilSg", label: "Densidade pré-fervura", unit: "SG" },
  { id: "preBoilL", label: "Volume pré-fervura", unit: "L" },
  { id: "postBoilL", label: "Volume pós-fervura", unit: "L" },
  { id: "mashPh", label: "pH da mostura", unit: "pH" },
  { id: "finalPh", label: "pH final", unit: "pH" },
  { id: "pressure", label: "Pressão", unit: "bar" },
  { id: "carbonation", label: "Carbonatação", unit: "vol" },
];
export function normalizeSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaultSettings };
  const out = { ...defaultSettings };
  const input = value as Record<string, unknown>;
  const choices: Partial<Record<keyof AppSettings, readonly string[]>> = {
    language: ["pt-BR", "en-US", "es-ES", "fr-FR", "de-DE"],
    theme: ["light", "dark", "system"], abvFormula: ["standard", "alternative"], fgFormula: ["normal", "mash"], ibuFormula: ["tinseth", "rager"], gravity: ["sg", "plato"], sgFormat: ["decimal", "points"], color: ["srm", "ebc"], grainColor: ["lovibond", "srm", "ebc"], temperature: ["°C", "°F"], volume: ["L", "gal (US)", "gal (UK)"], weight: ["kg", "lb"], hopWeight: ["g", "oz"], carbonation: ["vol", "g/L"], pressure: ["bar", "psi", "kPa"], altitude: ["m", "ft"], diastatic: ["lintner", "wk"], dateFormat: ["auto", "dmy", "mdy", "iso"], timeFormat: ["auto", "12", "24"],
  };
  for (const key of Object.keys(out) as (keyof AppSettings)[]) {
    const v = input[key];
    if (typeof out[key] === "boolean" && typeof v === "boolean") Object.assign(out, { [key]: v });
    if (choices[key]?.includes(String(v))) Object.assign(out, { [key]: v });
    if (typeof out[key] === "string" && typeof v === "string" && !choices[key]) Object.assign(out, { [key]: v });
  }
  if (typeof input.nextBatch === "number" && Number.isSafeInteger(input.nextBatch) && input.nextBatch >= 1) out.nextBatch = input.nextBatch;
  if (typeof input.mashReference === "number" && input.mashReference >= 55 && input.mashReference <= 75) out.mashReference = input.mashReference;
  if (typeof input.mashAdjustment === "number" && input.mashAdjustment >= 0 && input.mashAdjustment <= 3) out.mashAdjustment = input.mashAdjustment;
  if (Array.isArray(input.additionalMeasurements)) out.additionalMeasurements = measurementOptions.filter(o => input.additionalMeasurements instanceof Array && input.additionalMeasurements.includes(o.id)).map(o => o.id);
  return out;
}
export const nextBatchNumber = (batches: { number: number }[], preferred: number) => Math.max(preferred, ...batches.map(b => b.number + 1), 1);
export const calculateAbv = (og: number, fg: number, formula: AppSettings["abvFormula"] = "standard") => formula === "alternative" ? 76.08 * (og - fg) / (1.775 - og) * fg / 0.794 : (og - fg) * 131.25;
export const unitValue = (v: number, kind: "volume" | "weight" | "hopWeight" | "temperature" | "pressure" | "altitude", s: AppSettings, reverse = false) => {
  const family = kind === "hopWeight" ? "weight" : kind === "altitude" ? "length" : kind;
  const base = { volume: "L", weight: "kg", hopWeight: "g", temperature: "°C", pressure: "bar", altitude: "m" }[kind];
  return convertUnit(v, family, reverse ? s[kind] : base, reverse ? base : s[kind]);
};
export const gravityValue = (sg: number, s: AppSettings) => s.gravity === "plato" ? sgToPlato(sg) : s.sgFormat === "points" ? (sg - 1) * 1000 : sg;
export const gravityInput = (v: number, s: AppSettings) => s.gravity === "plato" ? platoToSg(v) : s.sgFormat === "points" ? 1 + v / 1000 : v;
export const gravityLabel = (s: AppSettings) => s.gravity === "plato" ? "°P" : s.sgFormat === "points" ? "pontos" : "SG";
export const grainColorValue = (lovibond: number, s: AppSettings, reverse = false) => {
  if (s.grainColor === "lovibond") return lovibond;
  const srm = reverse && s.grainColor === "ebc" ? lovibond / 1.97 : lovibond;
  return reverse ? (srm + 0.76) / 1.3546 : (1.3546 * lovibond - 0.76) * (s.grainColor === "ebc" ? 1.97 : 1);
};