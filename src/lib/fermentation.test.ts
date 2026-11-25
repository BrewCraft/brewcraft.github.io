import test from "node:test";
import assert from "node:assert/strict";
import {
  checkFermentationStability,
  updateBatchMeasurement,
  batchAttenuation,
  defaultEquipment,
  type Batch,
  type Measurement,
} from "./recipe-calc";

test("Fermentação: estabilidade com 0 ou 1 medição retorna falso", () => {
  assert.equal(checkFermentationStability([]).isStable, false);
  const single: Measurement[] = [{ id: "m1", date: "2026-11-01T10:00:00.000Z", sg: 1.010, tempC: 20 }];
  const res = checkFermentationStability(single);
  assert.equal(res.isStable, false);
  assert.equal(res.lastSg, 1.010);
});

test("Fermentação: medições no mesmo dia não contam como estáveis por 3 dias", () => {
  const sameDay: Measurement[] = [
    { id: "m1", date: "2026-11-01T08:00:00.000Z", sg: 1.010, tempC: 20 },
    { id: "m2", date: "2026-11-01T14:00:00.000Z", sg: 1.010, tempC: 20 },
    { id: "m3", date: "2026-11-01T20:00:00.000Z", sg: 1.010, tempC: 20 },
  ];
  const res = checkFermentationStability(sameDay);
  assert.equal(res.isStable, false);
});

test("Fermentação: detecta estabilidade ao atingir >= 3 dias consecutivos estáveis", () => {
  const measurements: Measurement[] = [
    { id: "m1", date: "2026-11-01T10:00:00.000Z", sg: 1.050, tempC: 20 },
    { id: "m2", date: "2026-11-03T10:00:00.000Z", sg: 1.020, tempC: 20 },
    { id: "m3", date: "2026-11-05T10:00:00.000Z", sg: 1.012, tempC: 20 },
    { id: "m4", date: "2026-11-06T10:00:00.000Z", sg: 1.011, tempC: 20 },
    { id: "m5", date: "2026-11-07T10:00:00.000Z", sg: 1.011, tempC: 20 },
  ];
  const res = checkFermentationStability(measurements);
  assert.equal(res.isStable, true);
  assert.equal(res.daysStable >= 3, true);
  assert.equal(res.lastSg, 1.011);
  assert.ok(res.message && res.message.includes("estável"));
});

test("Fermentação: gravidade caindo ativamente não é estável", () => {
  const dropping: Measurement[] = [
    { id: "m1", date: "2026-11-05T10:00:00.000Z", sg: 1.025, tempC: 20 },
    { id: "m2", date: "2026-11-06T10:00:00.000Z", sg: 1.018, tempC: 20 },
    { id: "m3", date: "2026-11-07T10:00:00.000Z", sg: 1.012, tempC: 20 },
  ];
  const res = checkFermentationStability(dropping);
  assert.equal(res.isStable, false);
});

test("Fermentação: lida com medições fora de ordem cronológica", () => {
  const unsorted: Measurement[] = [
    { id: "m3", date: "2026-11-07T10:00:00.000Z", sg: 1.010, tempC: 20 },
    { id: "m1", date: "2026-11-05T10:00:00.000Z", sg: 1.010, tempC: 20 },
    { id: "m2", date: "2026-11-06T10:00:00.000Z", sg: 1.011, tempC: 20 },
  ];
  const res = checkFermentationStability(unsorted);
  assert.equal(res.isStable, true);
  assert.equal(res.lastSg, 1.010);
});

test("Fermentação: updateBatchMeasurement é imutável e atualiza medição específica", () => {
  const batch: Batch = {
    id: "b1",
    number: 1,
    name: "Lote Teste",
    recipeId: "r1",
    recipe: {
      id: "r1",
      name: "Receita",
      styleCode: "18B",
      author: "",
      notes: "",
      equipment: { ...defaultEquipment, batchL: 20 },
      mashSteps: [],
      fermentationTempC: 19,
      fermentationDays: 14,
      fermentables: [],
      hops: [],
      yeasts: [{ id: "y1", name: "US-05", attenuation: 80, packs: 1, price: 30 }],
      miscs: [],
      createdAt: "",
      updatedAt: "",
    },
    status: "fermentacao",
    brewDate: "2026-11-01",
    measuredOg: 1.050,
    measuredFg: undefined,
    measurements: [
      { id: "m1", date: "2026-11-02T10:00:00.000Z", sg: 1.040, tempC: 20, note: "Início" },
      { id: "m2", date: "2026-11-04T10:00:00.000Z", sg: 1.020, tempC: 20 },
    ],
    notes: "",
    inventoryDeducted: false,
    createdAt: "2026-11-01",
  };

  const updated = updateBatchMeasurement(batch, "m2", { sg: 1.018, note: "Corrigido" });

  assert.notEqual(updated, batch);
  assert.equal(batch.measurements[1].sg, 1.020);
  assert.equal(updated.measurements[1].sg, 1.018);
  assert.equal(updated.measurements[1].note, "Corrigido");
  assert.equal(updated.measurements[0].sg, 1.040);
});

test("Fermentação: batchAttenuation calcula a atenuação aparente corretamente", () => {
  const batch: Batch = {
    id: "b1",
    number: 1,
    name: "Lote Teste",
    recipeId: "r1",
    recipe: {
      id: "r1",
      name: "Receita",
      styleCode: "18B",
      author: "",
      notes: "",
      equipment: { ...defaultEquipment, batchL: 20 },
      mashSteps: [],
      fermentationTempC: 19,
      fermentationDays: 14,
      fermentables: [],
      hops: [],
      yeasts: [{ id: "y1", name: "US-05", attenuation: 80, packs: 1, price: 30 }],
      miscs: [],
      createdAt: "",
      updatedAt: "",
    },
    status: "fermentacao",
    brewDate: "2026-11-01",
    measuredOg: 1.050,
    measuredFg: 1.010,
    measurements: [],
    notes: "",
    inventoryDeducted: false,
    createdAt: "2026-11-01",
  };

  // (1.050 - 1.010) / (1.050 - 1) * 100 = 0.040 / 0.050 * 100 = 80%
  const att = batchAttenuation(batch);
  assert.ok(att !== undefined);
  assert.equal(Math.round(att), 80);
});
