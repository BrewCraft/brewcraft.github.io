import jsPDF from "jspdf";
import { type Recipe } from "./recipe-calc";
import { recipeStats } from "./recipe-calc";

export function exportRecipePdf(recipe: Recipe) {
  const doc = new jsPDF();
  const stats = recipeStats(recipe);
  let y = 20;
  doc.setFontSize(18);
  doc.text(recipe.name, 20, y); y += 10;
  doc.setFontSize(10);
  doc.text(`Estilo: ${recipe.styleCode}`, 20, y); y += 6;
  doc.text(`OG: ${stats.og.toFixed(3)}  FG: ${stats.fg.toFixed(3)}  ABV: ${stats.abv.toFixed(1)}%  IBU: ${stats.ibu.toFixed(0)}  SRM: ${stats.srm.toFixed(1)}`, 20, y); y += 6;
  doc.text(`Volume: ${recipe.equipment.batchL} L  Eficiência: ${recipe.equipment.efficiency}%`, 20, y); y += 10;
  doc.setFontSize(12);
  doc.text("Fermentáveis", 20, y); y += 6;
  doc.setFontSize(10);
  for (const f of recipe.fermentables) {
    doc.text(`${f.name}: ${f.kg} kg`, 20, y); y += 5;
  }
  y += 4;
  doc.setFontSize(12);
  doc.text("Lúpulos", 20, y); y += 6;
  doc.setFontSize(10);
  for (const h of recipe.hops) {
    doc.text(`${h.name}: ${h.grams} g @ ${h.minutes} min (${h.use})`, 20, y); y += 5;
  }
  y += 4;
  doc.setFontSize(12);
  doc.text("Leveduras", 20, y); y += 6;
  doc.setFontSize(10);
  for (const yst of recipe.yeasts) {
    doc.text(`${yst.name} (${yst.attenuation}% att)`, 20, y); y += 5;
  }
  doc.save(`${recipe.name}.pdf`);
}
