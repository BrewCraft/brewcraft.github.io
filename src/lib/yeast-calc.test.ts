/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  estimateYeastViability,
  pitchRatePresets,
  planBatchYeast,
  simulateStarterStages,
} from "./yeast-calc";

const near = (actual: number, expected: number, tolerance = 0.1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected} (tol ${tolerance})`);

describe("Taxas de Inoculação Recomendadas", () => {
  test("Taxa de ale padrão é 0.75 e lager padrão é 1.5 M/mL/°P", () => {
    assert.equal(pitchRatePresets.ale.rateMillionPerMlPerPlato, 0.75);
    assert.equal(pitchRatePresets.lager.rateMillionPerMlPerPlato, 1.5);
    assert.equal(pitchRatePresets.ale_high_gravity.rateMillionPerMlPerPlato, 1.0);
    assert.equal(pitchRatePresets.lager_high_gravity.rateMillionPerMlPerPlato, 2.0);
  });
});

describe("Estimativa de Viabilidade por Idade e Forma da Levedura", () => {
  test("Levedura líquida nova tem 100% de viabilidade", () => {
    const res = estimateYeastViability("liquid", 0, 1, 100);
    assert.equal(res.viabilityPercent, 100);
    assert.equal(res.totalViableCellsBillions, 100);
  });

  test("Levedura líquida perde ~21% de viabilidade a cada 30 dias sob refrigeração", () => {
    const res30 = estimateYeastViability("liquid", 30, 1, 100);
    near(res30.viabilityPercent, 79, 1);
    near(res30.totalViableCellsBillions, 79, 1);

    const res60 = estimateYeastViability("liquid", 60, 1, 100);
    near(res60.viabilityPercent, 58, 1);
  });

  test("Levedura seca lacrada preserva viabilidade muito superior", () => {
    const dry30 = estimateYeastViability("dry", 30, 1, 150);
    assert.ok(dry30.viabilityPercent >= 99);
    assert.ok(dry30.totalViableCellsBillions >= 148);
  });
});

describe("Modelo Dinâmico de Crescimento de Starter (Kai Troester)", () => {
  test("Crescimento máximo em agitador magnético com baixa densidade de inoculação", () => {
    // 50 bilhões inoculados em 1 L de 1.037 SG (~100g DME) -> IR = 0.5 B/g (< 1.4)
    // Rendimento = 1.4 B/g -> novos = 140B -> final ~ 190B
    const sim = simulateStarterStages(50, [{ volumeL: 1.0, agitation: "stir_plate" }], 200);
    assert.equal(sim.stages.length, 1);
    const s1 = sim.stages[0];
    assert.equal(s1.yieldPerGram, 1.4);
    assert.ok(s1.newCellsProducedBillions > 130 && s1.newCellsProducedBillions < 155);
    assert.ok(sim.finalCellsBillions > 180);
  });

  test("Agitação intermitente produz menos células que agitador magnético", () => {
    const stir = simulateStarterStages(80, [{ volumeL: 1.0, agitation: "stir_plate" }], 200);
    const shake = simulateStarterStages(80, [{ volumeL: 1.0, agitation: "shaking" }], 200);
    const still = simulateStarterStages(80, [{ volumeL: 1.0, agitation: "still" }], 200);

    assert.ok(stir.finalCellsBillions > shake.finalCellsBillions, "Stir plate deve ser mais eficiente que shaking");
    assert.ok(shake.finalCellsBillions > still.finalCellsBillions, "Shaking deve ser mais eficiente que still");
  });

  test("Starter saturado com excesso de levedura emite aviso de saturação", () => {
    // 400 bilhões inoculados em apenas 0.5 L (~50g DME) -> IR = 8 B/g (> 5.0)
    const sim = simulateStarterStages(400, [{ volumeL: 0.5, agitation: "stir_plate" }], 400);
    const s1 = sim.stages[0];
    assert.ok(s1.saturationWarning, "Deveria emitir aviso de saturação para taxa de inoculação excessiva");
    assert.equal(s1.yieldPerGram, 0); // Sem divisão celular adicional
  });

  test("Starter em dois estágios (Multi-step) para propagação de grande volume", () => {
    // Estágio 1: 50B em 1 L stir plate -> ~190B
    // Estágio 2: 190B em 2 L stir plate -> ~400B
    const sim = simulateStarterStages(
      50,
      [
        { volumeL: 1.0, agitation: "stir_plate" },
        { volumeL: 2.0, agitation: "stir_plate" },
      ],
      350
    );

    assert.equal(sim.stages.length, 2);
    assert.ok(sim.targetMet, "Dois estágios devem alcançar a meta de 350 bilhões");
    assert.ok(sim.finalCellsBillions >= 350);
    assert.equal(sim.stages[1].initialCellsBillions, sim.stages[0].finalCellsBillions);
  });
});

describe("Planejamento Completo de Inoculação para Lote", () => {
  test("Calcula células necessárias e sugere tamanho do starter", () => {
    // 20 L a 1.050 (12.39 °P) com taxa 0.75 M/mL/°P = ~185.8B necessárias
    // Disponível: 1 pacote com 80B viáveis -> déficit ~105.8B
    const plan = planBatchYeast(20, 1.05, 0.75, 80, 100);
    near(plan.targetCellsBillions, 185.8, 1);
    near(plan.deficitBillions, 105.8, 1);
    assert.equal(plan.neededPacksWithoutStarter, 2);
    assert.ok(plan.suggestedStarterVolumeL >= 1.0, "Deveria sugerir pelo menos 1 L de starter");
    assert.equal(plan.starterDmeGrams, plan.suggestedStarterVolumeL * 100);
  });
});
