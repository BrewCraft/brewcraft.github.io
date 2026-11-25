/** Pure recipe, water, inventory and report calculations. Units: kg, g, L, °C, SG. */
import { alcohol, ibuRager, ibuTinseth } from "./brewing";
import { calculateAbv, defaultSettings, type AppSettings } from "./settings-model";
import type { BjcpStyle } from "./catalog";

export type HopUse = "fervura" | "whirlpool" | "dryhop" | "primeiro_mosto";
export interface RecipeFermentable { id: string; name: string; kg: number; potential: number; color: number; type: string; price: number }
export interface RecipeHop { id: string; name: string; grams: number; alpha: number; minutes: number; use: HopUse; price: number; dryHopDay?: number }
export interface RecipeYeast { id: string; name: string; attenuation: number; packs: number; price: number }
export interface RecipeMisc { id: string; name: string; amount: number; unit: string; use: string; price: number }
export interface Equipment { batchL: number; boilMinutes: number; evaporationLh: number; trubLossL: number; fermenterLossL: number; efficiency: number }
export interface MashStep { name: string; tempC: number; minutes: number }

export interface RecipeVersion {
  version: string;
  note: string;
  createdAt: string;
  snapshot: Omit<Recipe, "versionHistory">;
}

export interface DiffItem {
  name: string;
  type: "added" | "removed" | "modified" | "unchanged";
  detail: string;
}

export interface RecipeDiffResult {
  hasChanges: boolean;
  general: DiffItem[];
  stats: {
    og: { old: number; new: number };
    fg: { old: number; new: number };
    abv: { old: number; new: number };
    ibu: { old: number; new: number };
    srm: { old: number; new: number };
    cost: { old: number; new: number };
  };
  fermentables: DiffItem[];
  hops: DiffItem[];
  yeasts: DiffItem[];
  miscs: DiffItem[];
  mashSteps: DiffItem[];
}

export interface Recipe {
  id: string; name: string; styleCode: string; author: string; notes: string;
  equipment: Equipment; mashSteps: MashStep[]; fermentationTempC: number; fermentationDays: number;
  waterProfileId?: string; equipmentProfileId?: string; mashProfileId?: string; fermentationProfileId?: string;
  fermentables: RecipeFermentable[]; hops: RecipeHop[]; yeasts: RecipeYeast[]; miscs: RecipeMisc[];
  favorite?: boolean; createdAt: string; updatedAt: string;
  version?: string;
  versionNote?: string;
  versionHistory?: RecipeVersion[];
}

export const defaultEquipment: Equipment = { batchL: 20, boilMinutes: 60, evaporationLh: 4, trubLossL: 1, fermenterLossL: 1, efficiency: 72 };

export function createRecipeSnapshot(recipe: Recipe): Omit<Recipe, "versionHistory"> {
  const { versionHistory: _vh, ...snapshot } = recipe;
  return structuredClone(snapshot);
}

export function cloneRecipeForUser(
  source: Recipe,
  generateId: () => string = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
): Recipe {
  const cloned = structuredClone(source);
  const now = new Date().toISOString();
  return {
    ...cloned,
    id: generateId(),
    fermentables: cloned.fermentables.map((f) => ({ ...f, id: generateId() })),
    hops: cloned.hops.map((h) => ({ ...h, id: generateId() })),
    yeasts: cloned.yeasts.map((y) => ({ ...y, id: generateId() })),
    miscs: cloned.miscs.map((m) => ({ ...m, id: generateId() })),
    createdAt: now,
    updatedAt: now,
    version: cloned.version || "1.0",
    versionHistory: structuredClone(cloned.versionHistory || []),
  };
}

export function hasRecipeChanged(a: Recipe | Omit<Recipe, "versionHistory">, b: Recipe | Omit<Recipe, "versionHistory">): boolean {
  if (a.name !== b.name || a.styleCode !== b.styleCode || a.author !== b.author || a.notes !== b.notes) return true;
  if (a.fermentationTempC !== b.fermentationTempC || a.fermentationDays !== b.fermentationDays) return true;
  if (
    a.waterProfileId !== b.waterProfileId ||
    a.equipmentProfileId !== b.equipmentProfileId ||
    a.mashProfileId !== b.mashProfileId ||
    a.fermentationProfileId !== b.fermentationProfileId
  ) return true;
  if (
    a.equipment.batchL !== b.equipment.batchL ||
    a.equipment.efficiency !== b.equipment.efficiency ||
    a.equipment.boilMinutes !== b.equipment.boilMinutes ||
    a.equipment.evaporationLh !== b.equipment.evaporationLh ||
    a.equipment.trubLossL !== b.equipment.trubLossL ||
    a.equipment.fermenterLossL !== b.equipment.fermenterLossL
  ) return true;
  if (
    a.fermentables.length !== b.fermentables.length ||
    a.hops.length !== b.hops.length ||
    a.yeasts.length !== b.yeasts.length ||
    a.miscs.length !== b.miscs.length ||
    a.mashSteps.length !== b.mashSteps.length
  ) return true;

  for (let i = 0; i < a.fermentables.length; i++) {
    const fA = a.fermentables[i], fB = b.fermentables[i];
    if (fA.name !== fB.name || fA.kg !== fB.kg || fA.potential !== fB.potential || fA.color !== fB.color || fA.type !== fB.type || fA.price !== fB.price) return true;
  }
  for (let i = 0; i < a.hops.length; i++) {
    const hA = a.hops[i], hB = b.hops[i];
    if (hA.name !== hB.name || hA.grams !== hB.grams || hA.alpha !== hB.alpha || hA.minutes !== hB.minutes || hA.use !== hB.use || hA.price !== hB.price || (hA.dryHopDay ?? 0) !== (hB.dryHopDay ?? 0)) return true;
  }
  for (let i = 0; i < a.yeasts.length; i++) {
    const yA = a.yeasts[i], yB = b.yeasts[i];
    if (yA.name !== yB.name || yA.attenuation !== yB.attenuation || yA.packs !== yB.packs || yA.price !== yB.price) return true;
  }
  for (let i = 0; i < a.miscs.length; i++) {
    const mA = a.miscs[i], mB = b.miscs[i];
    if (mA.name !== mB.name || mA.amount !== mB.amount || mA.unit !== mB.unit || mA.use !== mB.use || mA.price !== mB.price) return true;
  }
  for (let i = 0; i < a.mashSteps.length; i++) {
    const mA = a.mashSteps[i], mB = b.mashSteps[i];
    if (mA.name !== mB.name || mA.tempC !== mB.tempC || mA.minutes !== mB.minutes) return true;
  }
  return false;
}

export function isExternalRecipeDifferent(base: Recipe, external: Recipe): boolean {
  if (base.id !== external.id) return true;
  if (hasRecipeChanged(base, external)) return true;
  if (base.version !== external.version) return true;
  if ((base.versionNote ?? "") !== (external.versionNote ?? "")) return true;
  if (Boolean(base.favorite) !== Boolean(external.favorite)) return true;
  if ((base.versionHistory?.length ?? 0) !== (external.versionHistory?.length ?? 0)) return true;
  return false;
}

export function createRecipeVersion(
  newRecipeData: Recipe,
  previousRecipeOrSnapshot?: Recipe | Omit<Recipe, "versionHistory">,
  note: string = ""
): Recipe {
  const prevSource = previousRecipeOrSnapshot ?? newRecipeData;
  const currentVersion = ("version" in prevSource && prevSource.version) ? prevSource.version : (newRecipeData.version || "1.0");
  const snapshotToStore = previousRecipeOrSnapshot
    ? ("versionHistory" in previousRecipeOrSnapshot ? createRecipeSnapshot(previousRecipeOrSnapshot as Recipe) : structuredClone(previousRecipeOrSnapshot))
    : createRecipeSnapshot(newRecipeData);

  const archivedNote = snapshotToStore.versionNote || "";
  const currentVersionEntry: RecipeVersion = {
    version: currentVersion,
    note: archivedNote,
    createdAt: snapshotToStore.updatedAt || new Date().toISOString(),
    snapshot: snapshotToStore,
  };

  const parts = currentVersion.split(".").map(Number);
  const major = Number.isFinite(parts[0]) && parts[0] > 0 ? parts[0] : 1;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  const newVersion = `${major}.${minor + 1}`;

  return {
    ...newRecipeData,
    version: newVersion,
    versionNote: note,
    versionHistory: [...(newRecipeData.versionHistory || []), currentVersionEntry],
    updatedAt: new Date().toISOString(),
  };
}

export function restoreRecipeVersion(recipe: Recipe, targetVersion: string): Recipe {
  const v = (recipe.versionHistory || []).find((x) => x.version === targetVersion);
  if (!v) return recipe;

  // Ao restaurar, a versão atual corrente entra para o histórico com sua própria nota,
  // e os dados do snapshot alvo tornam-se a base da nova versão com a nota de restauração.
  const restoredData: Recipe = {
    ...structuredClone(v.snapshot),
    id: recipe.id,
    version: recipe.version || "1.0",
    versionHistory: recipe.versionHistory,
  };

  return createRecipeVersion(
    restoredData,
    createRecipeSnapshot(recipe),
    `Restaurada da versão ${targetVersion}`
  );
}

function pairIngredients<T extends { id?: string; name: string }>(
  listA: T[],
  listB: T[],
  secondaryKey?: (item: T) => string
): Array<[T | null, T | null]> {
  const pairs: Array<[T | null, T | null]> = [];
  const usedB = new Set<number>();

  const norm = (s: string) => s.toLowerCase().trim();
  const findMatch = (itemA: T): number => {
    if (itemA.id) {
      const byId = listB.findIndex((b, idx) => !usedB.has(idx) && b.id === itemA.id);
      if (byId !== -1) return byId;
    }
    if (secondaryKey) {
      const keyA = secondaryKey(itemA);
      const bySec = listB.findIndex((b, idx) => !usedB.has(idx) && secondaryKey(b) === keyA);
      if (bySec !== -1) return bySec;
    }
    return listB.findIndex((b, idx) => !usedB.has(idx) && norm(b.name) === norm(itemA.name));
  };

  for (const itemA of listA) {
    const matchIdx = findMatch(itemA);
    if (matchIdx !== -1) {
      usedB.add(matchIdx);
      pairs.push([itemA, listB[matchIdx]]);
    } else {
      pairs.push([itemA, null]);
    }
  }
  for (let i = 0; i < listB.length; i++) {
    if (!usedB.has(i)) {
      pairs.push([null, listB[i]]);
    }
  }
  return pairs;
}

export function compareRecipeVersions(
  a: Recipe | Omit<Recipe, "versionHistory">,
  b: Recipe | Omit<Recipe, "versionHistory">
): RecipeDiffResult {
  const recipeA: Recipe = "versionHistory" in a ? (a as Recipe) : { ...(a as Recipe), versionHistory: [] };
  const recipeB: Recipe = "versionHistory" in b ? (b as Recipe) : { ...(b as Recipe), versionHistory: [] };

  const sA = recipeStats(recipeA);
  const sB = recipeStats(recipeB);

  const general: DiffItem[] = [];
  if (a.name !== b.name) general.push({ name: "Nome", type: "modified", detail: `"${a.name}" → "${b.name}"` });
  if (a.styleCode !== b.styleCode) general.push({ name: "Estilo", type: "modified", detail: `"${a.styleCode || "—"}" → "${b.styleCode || "—"}"` });
  if (a.author !== b.author) general.push({ name: "Autor", type: "modified", detail: `"${a.author || "—"}" → "${b.author || "—"}"` });
  if (a.notes !== b.notes) general.push({ name: "Notas", type: "modified", detail: `"${a.notes || "—"}" → "${b.notes || "—"}"` });
  if (a.equipment.batchL !== b.equipment.batchL) general.push({ name: "Volume do lote", type: "modified", detail: `${a.equipment.batchL} L → ${b.equipment.batchL} L` });
  if (a.equipment.efficiency !== b.equipment.efficiency) general.push({ name: "Eficiência", type: "modified", detail: `${a.equipment.efficiency}% → ${b.equipment.efficiency}%` });
  if (a.equipment.boilMinutes !== b.equipment.boilMinutes) general.push({ name: "Fervura", type: "modified", detail: `${a.equipment.boilMinutes} min → ${b.equipment.boilMinutes} min` });
  if (a.equipment.evaporationLh !== b.equipment.evaporationLh) general.push({ name: "Evaporação", type: "modified", detail: `${a.equipment.evaporationLh} L/h → ${b.equipment.evaporationLh} L/h` });
  if (a.equipment.trubLossL !== b.equipment.trubLossL) general.push({ name: "Perda trub", type: "modified", detail: `${a.equipment.trubLossL} L → ${b.equipment.trubLossL} L` });
  if (a.equipment.fermenterLossL !== b.equipment.fermenterLossL) general.push({ name: "Perda fermentador", type: "modified", detail: `${a.equipment.fermenterLossL} L → ${b.equipment.fermenterLossL} L` });
  if (a.fermentationTempC !== b.fermentationTempC) general.push({ name: "Temp. Fermentação", type: "modified", detail: `${a.fermentationTempC}°C → ${b.fermentationTempC}°C` });
  if (a.fermentationDays !== b.fermentationDays) general.push({ name: "Dias Fermentação", type: "modified", detail: `${a.fermentationDays} d → ${b.fermentationDays} d` });

  const fermentables: DiffItem[] = pairIngredients(a.fermentables, b.fermentables).map(([fA, fB]) => {
    if (fA && !fB) return { name: fA.name, type: "removed", detail: `${fA.kg} kg (${fA.color}°L, R$${fA.price.toFixed(2)}/kg)` };
    if (!fA && fB) return { name: fB.name, type: "added", detail: `${fB.kg} kg (${fB.color}°L, R$${fB.price.toFixed(2)}/kg)` };
    const changes: string[] = [];
    if (fA!.name !== fB!.name) changes.push(`nome "${fA!.name}" → "${fB!.name}"`);
    if (fA!.kg !== fB!.kg) changes.push(`${fA!.kg} kg → ${fB!.kg} kg`);
    if (fA!.color !== fB!.color) changes.push(`${fA!.color}°L → ${fB!.color}°L`);
    if (fA!.potential !== fB!.potential) changes.push(`${fA!.potential.toFixed(3)} → ${fB!.potential.toFixed(3)}`);
    if (fA!.type !== fB!.type) changes.push(`${fA!.type} → ${fB!.type}`);
    if (fA!.price !== fB!.price) changes.push(`R$${fA!.price.toFixed(2)} → R$${fB!.price.toFixed(2)}`);
    if (changes.length > 0) return { name: fB!.name, type: "modified", detail: changes.join(" · ") };
    return { name: fA!.name, type: "unchanged", detail: `${fA!.kg} kg` };
  });

  const hops: DiffItem[] = pairIngredients(
    a.hops,
    b.hops,
    (h) => `${h.name.toLowerCase().trim()}|${h.use}|${h.minutes}|${h.dryHopDay ?? 0}`
  ).map(([hA, hB]) => {
    const hopTiming = (h: RecipeHop) => h.use === "dryhop" ? `dryhop dia ${h.dryHopDay ?? 3}` : `${h.use}, ${h.minutes}min`;
    if (hA && !hB) return { name: `${hA.name} (${hA.use})`, type: "removed", detail: `${hA.grams}g (${hA.alpha}% AA, ${hopTiming(hA)})` };
    if (!hA && hB) return { name: `${hB.name} (${hB.use})`, type: "added", detail: `${hB.grams}g (${hB.alpha}% AA, ${hopTiming(hB)})` };
    const changes: string[] = [];
    if (hA!.name !== hB!.name) changes.push(`nome "${hA!.name}" → "${hB!.name}"`);
    if (hA!.grams !== hB!.grams) changes.push(`${hA!.grams}g → ${hB!.grams}g`);
    if (hA!.alpha !== hB!.alpha) changes.push(`${hA!.alpha}% AA → ${hB!.alpha}% AA`);
    if (hA!.use !== hB!.use) changes.push(`${hA!.use} → ${hB!.use}`);
    if (hA!.minutes !== hB!.minutes) changes.push(`${hA!.minutes}m → ${hB!.minutes}m`);
    if ((hA!.dryHopDay ?? 0) !== (hB!.dryHopDay ?? 0)) changes.push(`dia ${hA!.dryHopDay ?? 0} → dia ${hB!.dryHopDay ?? 0}`);
    if (hA!.price !== hB!.price) changes.push(`R$${hA!.price.toFixed(2)} → R$${hB!.price.toFixed(2)}`);
    if (changes.length > 0) return { name: `${hB!.name} (${hB!.use})`, type: "modified", detail: changes.join(" · ") };
    return { name: `${hA!.name} (${hA!.use})`, type: "unchanged", detail: `${hA!.grams}g (${hopTiming(hA!)})` };
  });

  const yeasts: DiffItem[] = pairIngredients(a.yeasts, b.yeasts).map(([yA, yB]) => {
    if (yA && !yB) return { name: yA.name, type: "removed", detail: `${yA.packs} pct (${yA.attenuation}%)` };
    if (!yA && yB) return { name: yB.name, type: "added", detail: `${yB.packs} pct (${yB.attenuation}%)` };
    const changes: string[] = [];
    if (yA!.name !== yB!.name) changes.push(`nome "${yA!.name}" → "${yB!.name}"`);
    if (yA!.packs !== yB!.packs) changes.push(`${yA!.packs} pct → ${yB!.packs} pct`);
    if (yA!.attenuation !== yB!.attenuation) changes.push(`${yA!.attenuation}% → ${yB!.attenuation}%`);
    if (yA!.price !== yB!.price) changes.push(`R$${yA!.price.toFixed(2)} → R$${yB!.price.toFixed(2)}`);
    if (changes.length > 0) return { name: yB!.name, type: "modified", detail: changes.join(" · ") };
    return { name: yA!.name, type: "unchanged", detail: `${yA!.packs} pct (${yA!.attenuation}%)` };
  });

  const miscs: DiffItem[] = pairIngredients(
    a.miscs,
    b.miscs,
    (m) => `${m.name.toLowerCase().trim()}|${m.use.toLowerCase().trim()}`
  ).map(([mA, mB]) => {
    if (mA && !mB) return { name: mA.name, type: "removed", detail: `${mA.amount} ${mA.unit} (${mA.use})` };
    if (!mA && mB) return { name: mB.name, type: "added", detail: `${mB.amount} ${mB.unit} (${mB.use})` };
    const changes: string[] = [];
    if (mA!.name !== mB!.name) changes.push(`nome "${mA!.name}" → "${mB!.name}"`);
    if (mA!.amount !== mB!.amount || mA!.unit !== mB!.unit) changes.push(`${mA!.amount} ${mA!.unit} → ${mB!.amount} ${mB!.unit}`);
    if (mA!.use !== mB!.use) changes.push(`${mA!.use} → ${mB!.use}`);
    if (mA!.price !== mB!.price) changes.push(`R$${mA!.price.toFixed(2)} → R$${mB!.price.toFixed(2)}`);
    if (changes.length > 0) return { name: mB!.name, type: "modified", detail: changes.join(" · ") };
    return { name: mA!.name, type: "unchanged", detail: `${mA!.amount} ${mA!.unit} (${mA!.use})` };
  });

  const mashSteps: DiffItem[] = [];
  const maxMash = Math.max(a.mashSteps.length, b.mashSteps.length);
  for (let i = 0; i < maxMash; i++) {
    const mA = a.mashSteps[i];
    const mB = b.mashSteps[i];
    if (mA && !mB) {
      mashSteps.push({ name: mA.name, type: "removed", detail: `${mA.tempC}°C por ${mA.minutes} min` });
    } else if (!mA && mB) {
      mashSteps.push({ name: mB.name, type: "added", detail: `${mB.tempC}°C por ${mB.minutes} min` });
    } else if (mA && mB && (mA.name !== mB.name || mA.tempC !== mB.tempC || mA.minutes !== mB.minutes)) {
      mashSteps.push({ name: `${mA.name} → ${mB.name}`, type: "modified", detail: `${mA.tempC}°C/${mA.minutes}m → ${mB.tempC}°C/${mB.minutes}m` });
    }
  }

  const hasChanges = general.length > 0 ||
    fermentables.some(f => f.type !== "unchanged") ||
    hops.some(h => h.type !== "unchanged") ||
    yeasts.some(y => y.type !== "unchanged") ||
    miscs.some(m => m.type !== "unchanged") ||
    mashSteps.length > 0;

  return {
    hasChanges,
    general,
    stats: {
      og: { old: sA.og, new: sB.og },
      fg: { old: sA.fg, new: sB.fg },
      abv: { old: sA.abv, new: sB.abv },
      ibu: { old: sA.ibu, new: sB.ibu },
      srm: { old: sA.srm, new: sB.srm },
      cost: { old: sA.cost.total, new: sB.cost.total },
    },
    fermentables,
    hops,
    yeasts,
    miscs,
    mashSteps,
  };
}

export function volumes(eq: Equipment) {
  const postBoil = eq.batchL + eq.trubLossL;
  const preBoil = postBoil + eq.evaporationLh * eq.boilMinutes / 60;
  return { postBoil, preBoil, fermenter: eq.batchL, packaged: Math.max(0, eq.batchL - eq.fermenterLossL) };
}

export function originalGravity(fermentables: RecipeFermentable[], eq: Equipment) {
  const vol = volumes(eq).postBoil;
  if (vol <= 0) return 1;
  const points = fermentables.reduce((sum, f) => {
    const eff = f.type === "grao" || f.type === "adjunto" ? eq.efficiency / 100 : 1;
    // potential is SG per lb/gal (PPG); 1 kg/L = 8.3454 lb/gal
    return sum + (f.potential - 1) * 1000 * 8.3454 * f.kg * eff;
  }, 0);
  return 1 + points / vol / 1000;
}

export function finalGravity(og: number, yeasts: RecipeYeast[]) {
  const att = yeasts.length ? Math.max(...yeasts.map(y => y.attenuation)) : 75;
  return 1 + (og - 1) * (1 - att / 100);
}

export function recipeIbu(hops: RecipeHop[], og: number, eq: Equipment, formula: AppSettings["ibuFormula"] = "tinseth") {
  const vol = volumes(eq).postBoil;
  return hops.reduce((sum, h) => {
    if (h.use === "dryhop") return sum;
    const minutes = h.use === "primeiro_mosto" ? eq.boilMinutes + 20 : h.use === "whirlpool" ? Math.min(h.minutes, 30) * 0.5 : h.minutes;
    if (vol <= 0) return sum;
    if (formula === "rager") {
      return sum + ibuRager(h.grams, h.alpha, minutes, vol, og);
    }
    return sum + ibuTinseth(h.grams, h.alpha, minutes, vol, og);
  }, 0);
}

export function recipeSrm(fermentables: RecipeFermentable[], eq: Equipment) {
  const gal = volumes(eq).postBoil / 3.785411784;
  if (gal <= 0) return 0;
  const mcu = fermentables.reduce((s, f) => s + f.kg * 2.2046226218 * f.color, 0) / gal;
  return mcu <= 0 ? 0 : 1.4922 * mcu ** 0.6859;
}

export function recipeCost(r: Pick<Recipe, "fermentables" | "hops" | "yeasts" | "miscs">) {
  const fermentables = r.fermentables.reduce((s, f) => s + f.kg * f.price, 0);
  const hops = r.hops.reduce((s, h) => s + h.grams / 1000 * h.price, 0);
  const yeasts = r.yeasts.reduce((s, y) => s + y.packs * y.price, 0);
  const miscs = r.miscs.reduce((s, m) => s + m.amount * m.price, 0);
  return { fermentables, hops, yeasts, miscs, total: fermentables + hops + yeasts + miscs };
}

export function recipeStats(r: Recipe, settings: AppSettings = defaultSettings) {
  const og = originalGravity(r.fermentables, r.equipment);
  const baseFg = finalGravity(og, r.yeasts);
  const saccharification = r.mashSteps.filter(s => s.tempC >= 55 && s.tempC <= 75 && s.minutes > 0);
  const mashMinutes = saccharification.reduce((sum, s) => sum + s.minutes, 0);
  const mashTemp = mashMinutes ? saccharification.reduce((sum, s) => sum + s.tempC * s.minutes, 0) / mashMinutes : settings.mashReference;
  const fg = settings.fgFormula === "mash" ? Math.min(og, Math.max(1, baseFg + (og - 1) * (mashTemp - settings.mashReference) * settings.mashAdjustment / 100)) : baseFg;
  const ibu = recipeIbu(r.hops, og, r.equipment, settings.ibuFormula);
  const buGu = og > 1 ? ibu / ((og - 1) * 1000) : 0;
  const attenuation = og > 1 ? (og - fg) / (og - 1) : 0;
  const cost = recipeCost(r);
  const vol = volumes(r.equipment);
  return {
    og, fg, abv: calculateAbv(og, fg, settings.abvFormula), ibu, srm: recipeSrm(r.fermentables, r.equipment),
    buGu, rbr: buGu * (1 + attenuation - 0.765), calories: alcohol(og, fg, 100).calories,
    grainKg: r.fermentables.reduce((s, f) => s + f.kg, 0), volumes: vol, cost, costPerLiter: vol.packaged > 0 ? cost.total / vol.packaged : 0,
  };
}

export type StyleStatus = "baixo" | "ok" | "alto";
export function styleCheck(stats: { og: number; fg: number; ibu: number; srm: number; abv: number }, style: BjcpStyle) {
  const check = (v: number, [min, max]: [number, number]): StyleStatus => (v < min ? "baixo" : v > max ? "alto" : "ok");
  return { og: check(stats.og, style.og), fg: check(stats.fg, style.fg), ibu: check(stats.ibu, style.ibu), srm: check(stats.srm, style.srm), abv: check(stats.abv, style.abv) };
}

/** Approximate sRGB for an SRM value (for color swatches). */
export function srmToHex(srm: number) {
  const s = Math.max(0, Math.min(40, srm));
  const r = Math.round(Math.min(255, Math.max(0, 255 * 0.975 ** s)));
  const g = Math.round(Math.min(255, Math.max(0, 255 * 0.88 ** s)));
  const b = Math.round(Math.min(255, Math.max(0, 255 * 0.7 ** s)));
  return `rgb(${r}, ${g}, ${b})`;
}

// ---------- Water chemistry ----------
export {
  type Ion,
  type WaterProfile,
  ions,
  saltsCatalog,
  zeroProfile,
  waterPresets,
  applySalts,
  totalAlkalinity,
  residualAlkalinity,
  sulfateChlorideRatio,
  ratioDescription,
  calculateWaterSplit,
  type WaterVolumes,
  type SplitSaltResult,
  optimizeSalts,
  type OptimizerReport,
  estimateMashPh,
  type GrainAddition,
  type AcidAddition,
  type MashPhEstimate,
} from "./water-calc";
import { optimizeSalts, saltsCatalog, type WaterProfile } from "./water-calc";

export const salts = saltsCatalog.map(s => ({ id: s.id, label: s.name, ppm: s.ppm }));

export function suggestSalts(source: WaterProfile, target: WaterProfile, liters: number) {
  return optimizeSalts(source, target, liters).additions;
}

// ---------- Inventory ----------
export type InventoryKind = "fermentavel" | "lupulo" | "levedura" | "outro";
export interface InventoryItem { id: string; kind: InventoryKind; name: string; amount: number; unit: string; price: number; minAmount: number; alpha?: number; potential?: number; color?: number; attenuation?: number }

/** Required amounts per recipe in inventory units (kg, g, pacote, un). */
export function recipeRequirements(r: Recipe) {
  const req: { kind: InventoryKind; name: string; amount: number; unit: string; price: number }[] = [];
  const add = (kind: InventoryKind, name: string, amount: number, unit: string, price: number) => {
    const ex = req.find(x => x.kind === kind && x.name.toLowerCase() === name.toLowerCase());
    if (ex) ex.amount += amount; else req.push({ kind, name, amount, unit, price });
  };
  r.fermentables.forEach(f => add("fermentavel", f.name, f.kg, "kg", f.price));
  r.hops.forEach(h => add("lupulo", h.name, h.grams, "g", h.price / 1000));
  r.yeasts.forEach(y => add("levedura", y.name, y.packs, "pacote", y.price));
  r.miscs.forEach(m => add("outro", m.name, m.amount, m.unit, m.price));
  return req;
}

const findItem = (inv: InventoryItem[], kind: InventoryKind, name: string) => inv.find(i => i.kind === kind && i.name.toLowerCase() === name.toLowerCase());

export function shoppingList(r: Recipe, inv: InventoryItem[]) {
  return recipeRequirements(r).map(req => {
    const have = findItem(inv, req.kind, req.name)?.amount ?? 0;
    const missing = Math.max(0, req.amount - have);
    return { ...req, have, missing, cost: missing * req.price };
  });
}

export function deductInventory(r: Recipe, inv: InventoryItem[], allowNegative = false): InventoryItem[] {
  const next = inv.map(i => ({ ...i }));
  for (const req of recipeRequirements(r)) {
    const item = findItem(next, req.kind, req.name);
    if (item) {
      const amount = Math.round((item.amount - req.amount) * 1000) / 1000;
      item.amount = allowNegative ? amount : Math.max(0, amount);
    } else if (allowNegative) next.push({ id: `missing-${req.kind}-${req.name}`, ...req, amount: -req.amount, minAmount: 0 });
  }
  return next;
}

// ---------- Batches ----------
export type BatchStatus = "planejamento" | "brassagem" | "fermentacao" | "condicionamento" | "concluido";
export const batchStatuses: { id: BatchStatus; label: string }[] = [
  { id: "planejamento", label: "Planejamento" }, { id: "brassagem", label: "Brassagem" }, { id: "fermentacao", label: "Fermentação" },
  { id: "condicionamento", label: "Condicionamento" }, { id: "concluido", label: "Concluído" },
];
export interface Measurement { id: string; date: string; sg: number; tempC: number; note?: string }
export interface Batch {
  id: string; number: number; name: string; recipeId: string; recipe: Recipe; status: BatchStatus;
  brewDate: string; measuredOg?: number; measuredFg?: number; measuredVolumeL?: number;
  measurements: Measurement[]; notes: string; inventoryDeducted: boolean; createdAt: string;
  additionalMeasurements?: Record<string, number>;
}

export function batchAbv(b: Batch, settings: AppSettings = defaultSettings) {
  const og = b.measuredOg ?? recipeStats(b.recipe, settings).og;
  const last = [...b.measurements].sort((a, c) => a.date.localeCompare(c.date)).at(-1);
  const fg = b.measuredFg ?? last?.sg;
  return fg ? calculateAbv(og, fg, settings.abvFormula) : undefined;
}

export function batchAttenuation(b: Batch, settings: AppSettings = defaultSettings) {
  const og = b.measuredOg ?? recipeStats(b.recipe, settings).og;
  const last = [...b.measurements].sort((a, c) => a.date.localeCompare(c.date)).at(-1);
  const fg = b.measuredFg ?? last?.sg;
  if (!fg || og <= 1) return undefined;
  return Math.max(0, ((og - fg) / (og - 1)) * 100);
}

export interface FermentationStabilityResult {
  isStable: boolean;
  daysStable: number;
  lastSg?: number;
  message?: string;
}

export function checkFermentationStability(measurements: Measurement[]): FermentationStabilityResult {
  if (!measurements || measurements.length === 0) {
    return { isStable: false, daysStable: 0 };
  }
  const valid = measurements.filter(m => typeof m.sg === "number" && !isNaN(m.sg) && m.sg > 0.98);
  if (valid.length < 2) {
    return { isStable: false, daysStable: 0, lastSg: valid.at(-1)?.sg };
  }
  const sorted = [...valid].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const last = sorted[sorted.length - 1];

  // Find all consecutive measurements backwards from the end within 0.001 SG of the last reading
  const stableStreak: Measurement[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    // Round to 4 decimal places to avoid floating point imprecision (e.g. 1.012 - 1.011 = 0.001000000000000112)
    if (Math.round(Math.abs(sorted[i].sg - last.sg) * 1000) <= 1) {
      stableStreak.unshift(sorted[i]);
    } else {
      break;
    }
  }

  const distinctDays = new Set(stableStreak.map(m => m.date.slice(0, 10)));
  const firstTime = new Date(stableStreak[0].date).getTime();
  const lastTime = new Date(last.date).getTime();
  const elapsedDays = (lastTime - firstTime) / (1000 * 60 * 60 * 24);

  const isStable = distinctDays.size >= 3 || (elapsedDays >= 2.0 && stableStreak.length >= 3);
  const daysStable = Math.max(distinctDays.size, Math.round(elapsedDays) + 1);

  return {
    isStable,
    daysStable: isStable ? daysStable : 0,
    lastSg: last.sg,
    message: isStable
      ? `Densidade aparentemente estável há ${daysStable} dias (SG: ${last.sg.toFixed(3)}). Confirme a atenuação antes de envasar.`
      : undefined,
  };
}

export function updateBatchMeasurement(
  batch: Batch,
  measurementId: string,
  patch: Partial<Measurement>
): Batch {
  return {
    ...batch,
    measurements: batch.measurements.map(m =>
      m.id === measurementId ? { ...m, ...patch } : m
    ),
  };
}

/** Boil-timer events: hop/misc additions sorted by minutes remaining. */
export function boilSchedule(r: Recipe) {
  const events = r.hops.filter(h => h.use === "fervura" || h.use === "primeiro_mosto")
    .map(h => ({ minutes: h.use === "primeiro_mosto" ? r.equipment.boilMinutes : h.minutes, label: `${h.grams} g ${h.name}` }));
  r.hops.filter(h => h.use === "whirlpool").forEach(h => events.push({ minutes: 0, label: `Whirlpool: ${h.grams} g ${h.name}` }));
  r.miscs.filter(m => m.use === "Fervura").forEach(m => events.push({ minutes: 10, label: `${m.amount} ${m.unit} ${m.name}` }));
  return events.sort((a, b) => b.minutes - a.minutes);
}

// ---------- Reports ----------
export function reportSummary(batches: Batch[]) {
  const done = batches.filter(b => b.status === "concluido" || b.status === "condicionamento");
  const liters = batches.filter(b => b.status !== "planejamento").reduce((s, b) => s + (b.measuredVolumeL ?? b.recipe.equipment.batchL), 0);
  const cost = batches.reduce((s, b) => s + recipeCost(b.recipe).total, 0);
  const byMonth = new Map<string, { month: string; litros: number; custo: number; lotes: number }>();
  for (const b of batches) {
    const month = b.brewDate.slice(0, 7);
    const e = byMonth.get(month) ?? { month, litros: 0, custo: 0, lotes: 0 };
    e.litros += b.status === "planejamento" ? 0 : b.measuredVolumeL ?? b.recipe.equipment.batchL;
    e.custo += recipeCost(b.recipe).total; e.lotes += 1;
    byMonth.set(month, e);
  }
  const hopUse = new Map<string, number>();
  const maltUse = new Map<string, number>();
  for (const b of batches) {
    b.recipe.hops.forEach(h => hopUse.set(h.name, (hopUse.get(h.name) ?? 0) + h.grams));
    b.recipe.fermentables.forEach(f => maltUse.set(f.name, (maltUse.get(f.name) ?? 0) + f.kg));
  }
  const top = (m: Map<string, number>) => [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  return {
    totalBatches: batches.length, finished: done.length, liters, cost, costPerLiter: liters > 0 ? cost / liters : 0,
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)), hops: top(hopUse), malts: top(maltUse),
  };
}

export interface FermentationMeasurement {
  id: string;
  batchId: string;
  date: string;
  sg: number;
  tempC: number;
  method: string;
  notes: string;
}
