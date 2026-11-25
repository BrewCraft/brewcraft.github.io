import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecipePdf,
  buildBatchPdf,
  buildInventoryPdf,
} from "./pdf-export";
import { defaultEquipment, type Batch, type Recipe, type InventoryItem } from "./recipe-calc";

test("PDF: receita simples gera documento válido com paginação", () => {
  const recipe: Recipe = {
    id: "r1",
    name: "IPA Teste com Acentuação e Cedilha: Ção",
    styleCode: "21A",
    author: "Cervejeiro Padrão",
    notes: "Uma cerveja com notas florais e cítricas excelentes.",
    equipment: { ...defaultEquipment, batchL: 20 },
    mashSteps: [
      { name: "Sacarificação", tempC: 65, minutes: 60 },
      { name: "Mash-out", tempC: 76, minutes: 10 },
    ],
    fermentationTempC: 19,
    fermentationDays: 14,
    fermentables: [
      { id: "f1", name: "Malte Pilsen Especial", kg: 5, potential: 1.037, color: 3, type: "grao", price: 20 },
    ],
    hops: [
      { id: "h1", name: "Cascade Aromático", grams: 50, alpha: 6, minutes: 60, use: "fervura", price: 250 },
    ],
    yeasts: [
      { id: "y1", name: "SafAle US-05 Fermentis", attenuation: 81, packs: 1, price: 35 },
    ],
    miscs: [
      { id: "m1", name: "Pastilha Whirlfloc Clarificante", amount: 1, unit: "un", use: "Fervura", price: 5 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const doc = buildRecipePdf(recipe);
  assert.ok(doc, "Documento jsPDF gerado com sucesso");
  assert.equal(doc.getNumberOfPages(), 1);
  const buf = doc.output("arraybuffer");
  assert.ok(buf.byteLength > 1000, "Buffer PDF gerado não vazio");
});

test("PDF: receita extensa gera múltiplas páginas automaticamente sem erro", () => {
  const extensiveRecipe: Recipe = {
    id: "r2",
    name: "Imperial Pastry Stout Super Extensa",
    styleCode: "20C",
    author: "Mestre Cervejeiro Especialista em Receitas Complexas",
    notes: "Esta é uma receita experimental extremamente complexa com muitas adições.\n" +
      "Linha adicional 1: detalhes sobre torrefação dos grãos e perfis enzimáticos.\n" +
      "Linha adicional 2: controle rigoroso de pH durante cada etapa da mostura.\n" +
      "Linha adicional 3: temperatura mantida com precisão de 0.1°C.\n" +
      "Linha adicional 4: rampa gradual de aquecimento evitando desnaturação prematura das beta-amilases.\n".repeat(6),
    equipment: { ...defaultEquipment, batchL: 50, boilMinutes: 90 },
    mashSteps: [
      { name: "Descanso Ácido", tempC: 38, minutes: 20 },
      { name: "Parada Ferúlica", tempC: 44, minutes: 15 },
      { name: "Descanso Proteico", tempC: 52, minutes: 25 },
      { name: "Sacarificação Beta", tempC: 62, minutes: 45 },
      { name: "Sacarificação Alfa", tempC: 70, minutes: 30 },
      { name: "Mash-out", tempC: 78, minutes: 15 },
    ],
    fermentationTempC: 18,
    fermentationDays: 28,
    fermentables: Array.from({ length: 12 }, (_, i) => ({
      id: `f-${i}`,
      name: `Malte Especial Selecionado Nível ${i + 1} Caramelo Tostado`,
      kg: 1.5,
      potential: 1.036,
      color: 10 + i * 20,
      type: "grao",
      price: 25,
    })),
    hops: Array.from({ length: 8 }, (_, i) => ({
      id: `h-${i}`,
      name: `Lúpulo Nobre de Aroma Variedade ${i + 1}`,
      grams: 30,
      alpha: 5 + i,
      minutes: 10 * (i + 1),
      use: i % 2 === 0 ? "fervura" : "whirlpool",
      price: 300,
    })),
    yeasts: [
      { id: "y1", name: "Levedura Especial SafAle English", attenuation: 77, packs: 2, price: 40 },
      { id: "y2", name: "Levedura Secundária Champagne", attenuation: 88, packs: 1, price: 45 },
    ],
    miscs: [
      { id: "m1", name: "Favas de Baunilha de Madagascar", amount: 4, unit: "un", use: "Maturação", price: 80 },
      { id: "m2", name: "Nibs de Cacau Torrado Orgânico", amount: 300, unit: "g", use: "Maturação", price: 60 },
      { id: "m3", name: "Café Bourbon Amarelo em Grãos", amount: 200, unit: "g", use: "Cold Brew", price: 45 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const doc = buildRecipePdf(extensiveRecipe);
  assert.ok(doc);
  assert.ok(doc.getNumberOfPages() >= 2, "Receita extensa paginou para pelo menos 2 páginas");
});

test("PDF: lote com medições de fermentação gera documento estruturado", () => {
  const batch: Batch = {
    id: "b1",
    number: 42,
    name: "Lote Festivo de Fim de Ano",
    recipeId: "r1",
    recipe: {
      id: "r1",
      name: "Belgian Dubbel Tradicional",
      styleCode: "26B",
      author: "Abadia",
      notes: "Notas ricas de passas e ameixas secas.",
      equipment: { ...defaultEquipment, batchL: 30 },
      mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
      fermentationTempC: 20,
      fermentationDays: 21,
      fermentables: [
        { id: "f1", name: "Pilsen Belga", kg: 6, potential: 1.037, color: 3, type: "grao", price: 20 },
      ],
      hops: [
        { id: "h1", name: "Saaz", grams: 40, alpha: 3.5, minutes: 60, use: "fervura", price: 250 },
      ],
      yeasts: [
        { id: "y1", name: "BE-256", attenuation: 82, packs: 2, price: 40 },
      ],
      miscs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    status: "fermentacao",
    brewDate: "2026-11-10",
    measuredOg: 1.065,
    measuredFg: 1.012,
    measuredVolumeL: 29.5,
    measurements: [
      { id: "m1", date: "2026-11-11T10:00:00.000Z", sg: 1.060, tempC: 20, note: "Fermentação vigorosa com krausen alto" },
      { id: "m2", date: "2026-11-13T10:00:00.000Z", sg: 1.030, tempC: 21, note: "Atenuação avançada" },
      { id: "m3", date: "2026-11-16T10:00:00.000Z", sg: 1.012, tempC: 21, note: "Densidade estável atingida" },
    ],
    notes: "Brassagem correu perfeitamente com recirculação contínua.",
    inventoryDeducted: true,
    createdAt: "2026-11-10",
  };

  const doc = buildBatchPdf(batch);
  assert.ok(doc);
  assert.ok(doc.getNumberOfPages() >= 1);
  const buf = doc.output("arraybuffer");
  assert.ok(buf.byteLength > 1000);
});

test("PDF: lote inclui leveduras e miscs do snapshot histórico da receita", () => {
  const batch: Batch = {
    id: "b2",
    number: 10,
    name: "Lote com Leveduras e Miscs",
    recipeId: "r2",
    recipe: {
      id: "r2",
      name: "Saison Especiada",
      styleCode: "25B",
      author: "Mestre",
      notes: "Receita de Saison com coentro e casca de laranja.",
      equipment: { ...defaultEquipment, batchL: 20 },
      mashSteps: [{ name: "Sacarificação", tempC: 64, minutes: 75 }],
      fermentationTempC: 22,
      fermentationDays: 14,
      fermentables: [
        { id: "f1", name: "Pilsen", kg: 4, potential: 1.037, color: 3, type: "grao", price: 20 },
      ],
      hops: [
        { id: "h1", name: "Saaz", grams: 30, alpha: 3.5, minutes: 60, use: "fervura", price: 250 },
      ],
      yeasts: [
        { id: "y1", name: "Belle Saison Lallemand", attenuation: 90, packs: 1, price: 42 },
      ],
      miscs: [
        { id: "m1", name: "Sementes de Coentro", amount: 15, unit: "g", use: "Fervura", price: 8 },
        { id: "m2", name: "Casca de Laranja Seca", amount: 20, unit: "g", use: "Fervura", price: 12 },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    status: "fermentacao",
    brewDate: "2026-11-15",
    measuredOg: 1.052,
    measuredFg: 1.004,
    measurements: [
      { id: "m1", date: "2026-11-16T10:00:00.000Z", sg: 1.040, tempC: 22 },
    ],
    notes: "Fermentando em temperatura ambiente controlada",
    inventoryDeducted: true,
    createdAt: "2026-11-15",
  };

  const doc = buildBatchPdf(batch);
  assert.ok(doc);
  const pdfText = doc.output();
  // Confirma que os nomes da levedura e dos miscs do snapshot estão no PDF gerado
  assert.ok(pdfText.includes("Belle Saison"), "Levedura do snapshot presente no PDF do lote");
  assert.ok(pdfText.includes("Sementes de Coentro"), "Misc do snapshot presente no PDF do lote");
  assert.ok(pdfText.includes("Casca de Laranja"), "Segundo misc do snapshot presente no PDF do lote");
});

test("PDF: lote com arrays vazios ou ausentes não causa falhas", () => {
  const minimalBatch: Batch = {
    id: "b3",
    number: 1,
    name: "Lote Mínimo",
    recipeId: "r-min",
    recipe: {
      id: "r-min",
      name: "Receita Mínima",
      styleCode: "",
      author: "",
      notes: "",
      equipment: { ...defaultEquipment, batchL: 20 },
      mashSteps: [],
      fermentationTempC: 20,
      fermentationDays: 14,
      fermentables: [],
      hops: [],
      yeasts: [],
      miscs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    status: "planejamento",
    brewDate: "2026-11-20",
    measurements: [],
    notes: "",
    inventoryDeducted: false,
    createdAt: "2026-11-20",
  };

  const doc = buildBatchPdf(minimalBatch);
  assert.ok(doc, "Documento gerado com sucesso mesmo com arrays vazios");
  assert.equal(doc.getNumberOfPages(), 1);
});

test("PDF: inventário completo gera relatório com categorias e alertas de estoque", () => {
  const items: InventoryItem[] = [
    { id: "i1", kind: "fermentavel", name: "Malte Pilsen Alemão", amount: 25, unit: "kg", price: 18, minAmount: 10, color: 2 },
    { id: "i2", kind: "fermentavel", name: "Malte Caramelo 60L", amount: 0.5, unit: "kg", price: 26, minAmount: 2, color: 60 },
    { id: "i3", kind: "lupulo", name: "Citra Lúpulo em Pellets", amount: 100, unit: "g", price: 0.35, minAmount: 200, alpha: 12.5 },
    { id: "i4", kind: "levedura", name: "Fermentis SafAle US-05", amount: 4, unit: "pacote", price: 35, minAmount: 2, attenuation: 81 },
    { id: "i5", kind: "outro", name: "Tampinhas Pry-Off Prateadas", amount: 150, unit: "un", price: 0.2, minAmount: 50 },
  ];

  const doc = buildInventoryPdf(items);
  assert.ok(doc);
  assert.ok(doc.getNumberOfPages() >= 1);
  const buf = doc.output("arraybuffer");
  assert.ok(buf.byteLength > 1000);
});
