import { type Recipe } from "./recipe-calc";
import { defaultEquipment } from "./recipe-calc";
import { uid } from "./store";

export const libraryRecipes: Recipe[] = [
  {
    id: "lib-apa", name: "American Pale Ale (Biblioteca)", styleCode: "18B", author: "BrewCraft", notes: "Receita de exemplo da biblioteca.",
    equipment: { ...defaultEquipment }, mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
    fermentationTempC: 19, fermentationDays: 14,
    fermentables: [{ id: uid(), name: "Pale Ale", kg: 4.2, potential: 1.037, color: 3, type: "grao", price: 20 }, { id: uid(), name: "Caramelo 40L", kg: 0.3, potential: 1.034, color: 40, type: "grao", price: 26 }],
    hops: [{ id: uid(), name: "Magnum", grams: 15, alpha: 13, minutes: 60, use: "fervura", price: 220 }, { id: uid(), name: "Cascade", grams: 30, alpha: 6, minutes: 10, use: "fervura", price: 250 }],
    yeasts: [{ id: uid(), name: "SafAle US-05", attenuation: 81, packs: 1, price: 35 }],
    miscs: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: "1.0", versionHistory: [],
  },
];
