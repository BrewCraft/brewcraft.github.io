import { jsPDF } from "jspdf";
import { batchAbv, batchAttenuation, recipeStats, type Batch, type Recipe } from "./recipe-calc";
import type { InventoryItem } from "./recipe-calc";

// ── Layout constants ──────────────────────────────────────────────────────────
const ML = 15;   // margin left
const MR = 195;  // margin right (210 - 15)
const MT = 20;   // margin top
const FOOTER_Y = 282;
const CONTENT_BOTTOM = 268; // y limit before adding a new page

const APP = "BrewCraft";
const PRIMARY = [45, 110, 175] as const;
const GRAY = [120, 120, 120] as const;
const LIGHT = [240, 240, 240] as const;
const BLACK = [30, 30, 30] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function newDoc() {
  return new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
}

/** Wrap long text and return new y, adding pages as needed */
function wrapText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  addPageFn: () => number,
): number {
  if (!text) return y;
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    if (y > CONTENT_BOTTOM) y = addPageFn();
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** Draw page header with colored bar */
function drawHeader(doc: jsPDF, title: string, subtitle?: string) {
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, 210, 12, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(APP, ML, 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const ts = new Date().toLocaleDateString("pt-BR");
  doc.text(ts, MR, 8, { align: "right" });

  doc.setTextColor(...BLACK);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(title, ML, MT + 4);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(subtitle, ML, MT + 10);
  }
}

/** Draw footer with page number (Página X de Y) */
function drawFooter(doc: jsPDF, page: number, total: number) {
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.3);
  doc.line(ML, FOOTER_Y - 2, MR, FOOTER_Y - 2);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(APP, ML, FOOTER_Y + 2);
  doc.text(`Página ${page} de ${total}`, MR, FOOTER_Y + 2, { align: "right" });
}

/** Apply footers to all pages in a completed document */
function applyFootersToAllPages(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawFooter(doc, p, total);
  }
}

/** Section heading */
function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFillColor(...LIGHT);
  doc.rect(ML, y - 4, MR - ML, 7, "F");
  doc.setFillColor(...PRIMARY);
  doc.rect(ML, y - 4, 2, 7, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BLACK);
  doc.text(text, ML + 4, y);
  return y + 7;
}

/** Stat box row: label + value */
function stat(doc: jsPDF, label: string, value: string, x: number, y: number, colW = 45) {
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(label, x, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BLACK);
  doc.text(value, x, y + 4);
  return x + colW;
}

/** Table with header row */
function drawTable(
  doc: jsPDF,
  headers: string[],
  rows: string[][],
  colWidths: number[],
  startX: number,
  startY: number,
  addPageFn: () => number,
): number {
  let y = startY;
  const rowH = 6;
  const headerH = 7;

  // header
  doc.setFillColor(...PRIMARY);
  doc.rect(startX, y - 5, colWidths.reduce((a, b) => a + b, 0), headerH, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  let cx = startX + 1;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], cx, y);
    cx += colWidths[i];
  }
  y += headerH - 1;

  // rows
  doc.setFont("helvetica", "normal");
  let altRow = false;
  for (const row of rows) {
    if (y > CONTENT_BOTTOM) y = addPageFn();
    if (altRow) {
      doc.setFillColor(248, 248, 248);
      doc.rect(startX, y - 4.5, colWidths.reduce((a, b) => a + b, 0), rowH, "F");
    }
    doc.setTextColor(...BLACK);
    cx = startX + 1;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i] ?? "";
      // clip to column width to avoid overflow
      const maxW = colWidths[i] - 2;
      const clipped = doc.splitTextToSize(cell, maxW)[0] as string;
      doc.text(clipped, cx, y);
      cx += colWidths[i];
    }
    y += rowH;
    altRow = !altRow;
  }
  return y + 2;
}

// ── Hop use labels ────────────────────────────────────────────────────────────
const hopUseLabel: Record<string, string> = {
  fervura: "Fervura",
  whirlpool: "Whirlpool",
  dryhop: "Dry Hop",
  primeiro_mosto: "Primeiro Mosto",
};

// ── 1. Recipe PDF ─────────────────────────────────────────────────────────────
export function buildRecipePdf(recipe: Recipe): jsPDF {
  const doc = newDoc();
  const stats = recipeStats(recipe);

  const addPage = (): number => {
    doc.addPage();
    drawHeader(doc, recipe.name);
    return MT + 14;
  };

  drawHeader(doc, recipe.name, recipe.styleCode ? `Estilo BJCP: ${recipe.styleCode}` : undefined);
  let y = MT + 16;

  // ── Métricas principais ───
  const metrics = [
    ["OG", stats.og.toFixed(3)],
    ["FG", stats.fg.toFixed(3)],
    ["ABV", `${stats.abv.toFixed(1)}%`],
    ["IBU", stats.ibu.toFixed(0)],
    ["SRM", stats.srm.toFixed(1)],
    ["Volume", `${recipe.equipment.batchL} L`],
    ["Eficiência", `${recipe.equipment.efficiency}%`],
    ["Custo", `R$ ${stats.cost.total.toFixed(2)}`],
  ];
  const colW = 22;
  const perRow = 8;
  for (let i = 0; i < metrics.length; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const mx = ML + col * colW;
    const my = y + row * 10;
    doc.setFillColor(...LIGHT);
    doc.rect(mx, my - 5, colW - 1, 10, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(metrics[i][0], mx + 1, my - 1);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BLACK);
    doc.text(metrics[i][1], mx + 1, my + 3.5);
  }
  y += Math.ceil(metrics.length / perRow) * 10 + 4;

  // ── Descrição / Notas ───
  if (recipe.notes) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Notas", y);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BLACK);
    y = wrapText(doc, recipe.notes, ML + 4, y, MR - ML - 6, 5, addPage);
    y += 3;
  }

  // ── Fermentáveis ───
  if (recipe.fermentables.length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Fermentáveis", y);
    y = drawTable(
      doc,
      ["Nome", "Tipo", "Quantidade", "Potencial", "Cor (°L)", "% Grist"],
      recipe.fermentables.map(f => {
        const totalKg = recipe.fermentables.reduce((s, x) => s + x.kg, 0);
        const pct = totalKg > 0 ? ((f.kg / totalKg) * 100).toFixed(1) : "0";
        return [f.name, f.type, `${f.kg} kg`, f.potential.toFixed(3), f.color.toFixed(0), `${pct}%`];
      }),
      [65, 25, 24, 24, 20, 20],
      ML, y, addPage,
    );
  }

  // ── Lúpulos ───
  if (recipe.hops.length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Lúpulos", y);
    y = drawTable(
      doc,
      ["Nome", "Uso", "Quantidade", "Alpha", "Tempo"],
      recipe.hops.map(h => [
        h.name,
        hopUseLabel[h.use] ?? h.use,
        `${h.grams} g`,
        `${h.alpha}% AA`,
        h.use === "dryhop" ? `Dia ${h.dryHopDay ?? 3}` : `${h.minutes} min`,
      ]),
      [65, 30, 25, 22, 36],
      ML, y, addPage,
    );
  }

  // ── Leveduras ───
  if (recipe.yeasts.length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Leveduras", y);
    y = drawTable(
      doc,
      ["Nome", "Atenuação", "Pacotes"],
      recipe.yeasts.map(ys => [ys.name, `${ys.attenuation}%`, String(ys.packs)]),
      [120, 30, 28],
      ML, y, addPage,
    );
  }

  // ── Miscs ───
  if (recipe.miscs.length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Outros ingredientes", y);
    y = drawTable(
      doc,
      ["Nome", "Uso", "Quantidade"],
      recipe.miscs.map(m => [m.name, m.use, `${m.amount} ${m.unit}`]),
      [100, 40, 38],
      ML, y, addPage,
    );
  }

  // ── Mostura ───
  if (recipe.mashSteps.length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Mostura", y);
    y = drawTable(
      doc,
      ["Passo", "Temperatura", "Duração"],
      recipe.mashSteps.map(s => [s.name, `${s.tempC}°C`, `${s.minutes} min`]),
      [110, 40, 28],
      ML, y, addPage,
    );
  }

  // ── Fermentação ───
  if (y > CONTENT_BOTTOM) y = addPage();
  y = sectionTitle(doc, "Fermentação", y);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...BLACK);
  let fx = ML + 4;
  fx = stat(doc, "Temperatura", `${recipe.fermentationTempC}°C`, fx, y, 50);
  stat(doc, "Duração", `${recipe.fermentationDays} dias`, fx, y, 50);

  applyFootersToAllPages(doc);
  return doc;
}

export function exportRecipePdf(recipe: Recipe): void {
  const doc = buildRecipePdf(recipe);
  doc.save(`${recipe.name.replace(/[/\\:*?"<>|]/g, "_")}.pdf`);
}

// ── 2. Batch PDF ──────────────────────────────────────────────────────────────
export function buildBatchPdf(batch: Batch): jsPDF {
  const doc = newDoc();
  const recipe = batch.recipe;
  const stats = recipeStats(recipe);
  const abv = batchAbv(batch);
  const att = batchAttenuation(batch);

  const addPage = (): number => {
    doc.addPage();
    drawHeader(doc, `Lote #${batch.number} · ${batch.name}`);
    return MT + 14;
  };

  drawHeader(doc, `Lote #${batch.number} · ${batch.name}`, `Receita: ${recipe.name}`);
  let y = MT + 16;

  // ── Dados do lote ───
  y = sectionTitle(doc, "Dados do Lote", y);
  const ld: [string, string][] = [
    ["Status", batch.status],
    ["Data de brassagem", new Date(batch.brewDate + "T12:00").toLocaleDateString("pt-BR")],
    ["Volume produzido", batch.measuredVolumeL ? `${batch.measuredVolumeL} L` : `${recipe.equipment.batchL} L (previsto)`],
    ["OG medida", batch.measuredOg ? batch.measuredOg.toFixed(3) : `${stats.og.toFixed(3)} (prevista)`],
    ["FG medida", batch.measuredFg ? batch.measuredFg.toFixed(3) : `${stats.fg.toFixed(3)} (prevista)`],
    ["ABV calculado", abv !== undefined ? `${abv.toFixed(2)}%` : `${stats.abv.toFixed(1)}% (previsto)`],
    ["Atenuação aparente", att !== undefined ? `${att.toFixed(1)}%` : "—"],
    ["IBU previsto", stats.ibu.toFixed(0)],
    ["SRM previsto", stats.srm.toFixed(1)],
    ["Eficiência", `${recipe.equipment.efficiency}%`],
  ];
  const colW2 = (MR - ML - 4) / 2;
  for (let i = 0; i < ld.length; i += 2) {
    if (y > CONTENT_BOTTOM) y = addPage();
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(ld[i][0], ML + 2, y);
    if (ld[i + 1]) doc.text(ld[i + 1][0], ML + 2 + colW2, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BLACK);
    doc.text(ld[i][1], ML + 2, y + 4);
    if (ld[i + 1]) doc.text(ld[i + 1][1], ML + 2 + colW2, y + 4);
    y += 10;
  }

  // ── Fermentáveis da receita ───
  if ((recipe.fermentables ?? []).length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Fermentáveis (snapshot da receita)", y);
    y = drawTable(
      doc,
      ["Nome", "Quantidade", "Potencial", "Cor (°L)"],
      recipe.fermentables.map(f => [f.name, `${f.kg} kg`, f.potential.toFixed(3), f.color.toFixed(0)]),
      [90, 30, 28, 30],
      ML, y, addPage,
    );
  }

  // ── Lúpulos ───
  if ((recipe.hops ?? []).length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Lúpulos (snapshot da receita)", y);
    y = drawTable(
      doc,
      ["Nome", "Uso", "Quantidade", "Alpha", "Tempo"],
      recipe.hops.map(h => [
        h.name,
        hopUseLabel[h.use] ?? h.use,
        `${h.grams} g`,
        `${h.alpha}% AA`,
        h.use === "dryhop" ? `Dia ${h.dryHopDay ?? 3}` : `${h.minutes} min`,
      ]),
      [60, 28, 24, 22, 44],
      ML, y, addPage,
    );
  }

  // ── Leveduras ───
  if ((recipe.yeasts ?? []).length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Leveduras (snapshot da receita)", y);
    y = drawTable(
      doc,
      ["Nome", "Atenuação", "Pacotes"],
      recipe.yeasts.map(ys => [ys.name, `${ys.attenuation}%`, String(ys.packs)]),
      [120, 30, 28],
      ML, y, addPage,
    );
  }

  // ── Outros ingredientes ───
  if ((recipe.miscs ?? []).length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Outros ingredientes (snapshot da receita)", y);
    y = drawTable(
      doc,
      ["Nome", "Uso", "Quantidade"],
      recipe.miscs.map(m => [m.name, m.use, `${m.amount} ${m.unit}`]),
      [100, 40, 38],
      ML, y, addPage,
    );
  }

  // ── Mostura ───
  if ((recipe.mashSteps ?? []).length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Mostura", y);
    y = drawTable(
      doc,
      ["Passo", "Temperatura", "Duração"],
      recipe.mashSteps.map(s => [s.name, `${s.tempC}°C`, `${s.minutes} min`]),
      [110, 40, 28],
      ML, y, addPage,
    );
  }

  // ── Medições de fermentação ───
  const sorted = [...(batch.measurements ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Histórico de Fermentação", y);
    y = drawTable(
      doc,
      ["Data e Hora", "Densidade (SG)", "Temperatura", "Nota"],
      sorted.map(m => [
        new Date(m.date).toLocaleString("pt-BR"),
        m.sg.toFixed(3),
        `${m.tempC}°C`,
        m.note ?? "",
      ]),
      [52, 32, 28, 66],
      ML, y, addPage,
    );
  }

  // ── Observações do lote ───
  if (batch.notes?.trim()) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, "Observações", y);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...BLACK);
    y = wrapText(doc, batch.notes, ML + 4, y, MR - ML - 6, 5, addPage);
  }

  applyFootersToAllPages(doc);
  return doc;
}

export function exportBatchPdf(batch: Batch): void {
  const doc = buildBatchPdf(batch);
  const fname = `Lote_${batch.number}_${batch.name.replace(/[/\\:*?"<>|]/g, "_")}.pdf`;
  doc.save(fname);
}

// ── 3. Inventory PDF ──────────────────────────────────────────────────────────
export function buildInventoryPdf(items: InventoryItem[]): jsPDF {
  const doc = newDoc();

  const kindLabel: Record<string, string> = {
    fermentavel: "Fermentável",
    lupulo: "Lúpulo",
    levedura: "Levedura",
    outro: "Outro",
  };

  const addPage = (): number => {
    doc.addPage();
    drawHeader(doc, "Relatório de Inventário");
    return MT + 14;
  };

  drawHeader(doc, "Relatório de Inventário", `${items.length} itens · Gerado em ${new Date().toLocaleDateString("pt-BR")}`);
  let y = MT + 16;

  // ── Resumo por categoria ───
  const kinds = ["fermentavel", "lupulo", "levedura", "outro"];
  y = sectionTitle(doc, "Resumo por Categoria", y);

  const summaryData = kinds.map(k => {
    const kItems = items.filter(i => i.kind === k);
    const totalValue = kItems.reduce((s, i) => s + i.amount * i.price, 0);
    const lowCount = kItems.filter(i => i.amount <= i.minAmount).length;
    return [
      kindLabel[k] ?? k,
      String(kItems.length),
      `R$ ${totalValue.toFixed(2)}`,
      lowCount > 0 ? `⚠ ${lowCount} baixo(s)` : "OK",
    ];
  });

  y = drawTable(
    doc,
    ["Categoria", "Itens", "Valor total", "Alertas"],
    summaryData,
    [70, 25, 45, 38],
    ML, y, addPage,
  );

  const totalValue = items.reduce((s, i) => s + i.amount * i.price, 0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BLACK);
  doc.text(`Valor total do estoque: R$ ${totalValue.toFixed(2)}`, ML + 4, y);
  y += 10;

  // ── Itens com estoque baixo ───
  const lowItems = items.filter(i => i.amount <= i.minAmount);
  if (lowItems.length > 0) {
    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, `⚠ Estoque Baixo (${lowItems.length} itens)`, y);
    y = drawTable(
      doc,
      ["Nome", "Categoria", "Quantidade", "Mínimo", "Unidade"],
      lowItems.map(i => [i.name, kindLabel[i.kind] ?? i.kind, String(i.amount), String(i.minAmount), i.unit]),
      [65, 30, 25, 25, 33],
      ML, y, addPage,
    );
  }

  // ── Inventário por categoria ───
  for (const k of kinds) {
    const kItems = items.filter(i => i.kind === k).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    if (kItems.length === 0) continue;

    if (y > CONTENT_BOTTOM) y = addPage();
    y = sectionTitle(doc, `${kindLabel[k] ?? k} (${kItems.length})`, y);

    const rows = kItems.map(i => {
      const extra: string[] = [];
      if (i.alpha !== undefined) extra.push(`${i.alpha}% AA`);
      if (i.attenuation !== undefined) extra.push(`${i.attenuation}% aten.`);
      if (i.color !== undefined) extra.push(`${i.color}°L`);
      return [
        i.name,
        `${i.amount} ${i.unit}`,
        i.price > 0 ? `R$ ${i.price.toFixed(2)}` : "—",
        i.price > 0 ? `R$ ${(i.amount * i.price).toFixed(2)}` : "—",
        extra.join(" · "),
        i.amount <= i.minAmount ? "⚠ Baixo" : "",
      ];
    });

    y = drawTable(
      doc,
      ["Nome", "Quantidade", "Preço unit.", "Valor total", "Especificações", "Status"],
      rows,
      [55, 25, 23, 25, 42, 18],
      ML, y, addPage,
    );
  }

  applyFootersToAllPages(doc);
  return doc;
}

export function exportInventoryPdf(items: InventoryItem[]): void {
  const doc = buildInventoryPdf(items);
  doc.save(`Inventario_BrewCraft_${new Date().toISOString().slice(0, 10)}.pdf`);
}
