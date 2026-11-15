/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  applySalts,
  calculateWaterSplit,
  estimateMashPh,
  optimizeSalts,
  ratioDescription,
  residualAlkalinity,
  saltsCatalog,
  sulfateChlorideRatio,
  totalAlkalinity,
  zeroProfile,
  type WaterProfile,
} from "./water-calc";

const near = (actual: number, expected: number, tolerance = 0.1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected} (tol ${tolerance})`);

describe("Química da Água: Contribuição Iônica dos Sais", () => {
  test("1 g de Gipsita em 10 L adiciona 23,28 ppm Ca e 55,79 ppm SO4", () => {
    const res = applySalts(zeroProfile, { gypsum: 1 }, 10);
    near(res.ca, 23.28, 0.05);
    near(res.so4, 55.79, 0.05);
  });

  test("1 g de CaCl2 di-hidratado em 10 L adiciona 27,26 ppm Ca e 48,23 ppm Cl", () => {
    const res = applySalts(zeroProfile, { cacl2: 1 }, 10);
    near(res.ca, 27.26, 0.05);
    near(res.cl, 48.23, 0.05);
  });

  test("1 g de Cloreto de Magnésio em 10 L adiciona 11,96 ppm Mg e 34,88 ppm Cl", () => {
    const res = applySalts(zeroProfile, { mgcl2: 1 }, 10);
    near(res.mg, 11.96, 0.05);
    near(res.cl, 34.88, 0.05);
  });

  test("1 g de Bicarbonato de Sódio em 10 L adiciona 27,37 ppm Na e 72,64 ppm HCO3", () => {
    const res = applySalts(zeroProfile, { bicarb: 1 }, 10);
    near(res.na, 27.37, 0.05);
    near(res.hco3, 72.64, 0.05);
  });

  test("Giz (CaCO3) está catalogado com alerta de solubilidade limitada", () => {
    const chalk = saltsCatalog.find((s) => s.id === "chalk");
    assert.ok(chalk);
    assert.equal(chalk.insolubleInColdWater, true);
  });
});

describe("Alcalinidade e Alcalinidade Residual de Kolbach", () => {
  test("Alcalinidade total a partir do bicarbonato", () => {
    // 122 ppm HCO3 = 100 ppm as CaCO3
    const w: WaterProfile = { ca: 50, mg: 10, na: 0, so4: 50, cl: 50, hco3: 122 };
    near(totalAlkalinity(w), 100, 1);
  });

  test("Alcalinidade Residual de Kolbach", () => {
    // RA = Alk - (Ca/3.5 + Mg/7.0)
    // 100 - (70/3.5 + 14/7.0) = 100 - (20 + 2) = 78 ppm CaCO3
    const w: WaterProfile = { ca: 70, mg: 14, na: 0, so4: 50, cl: 50, hco3: 122 };
    near(residualAlkalinity(w), 78, 1);
  });

  test("Água rica em cálcio e sulfato produz RA negativa (acidificante)", () => {
    const burton: WaterProfile = { ca: 275, mg: 40, na: 25, so4: 610, cl: 35, hco3: 100 };
    const ra = residualAlkalinity(burton);
    assert.ok(ra < 0, `RA deveria ser negativa para água Burton: ${ra}`);
  });
});

describe("Relação Sulfato / Cloreto", () => {
  test("Calcula proporção e classificação sensorial", () => {
    const ipa: WaterProfile = { ca: 100, mg: 10, na: 10, so4: 250, cl: 50, hco3: 0 };
    assert.equal(sulfateChlorideRatio(ipa), 5.0);
    assert.ok(ratioDescription(5.0).toLowerCase().includes("amarga"));

    const neipa: WaterProfile = { ca: 100, mg: 10, na: 10, so4: 60, cl: 150, hco3: 0 };
    assert.equal(sulfateChlorideRatio(neipa), 0.4);
    assert.ok(ratioDescription(0.4).toLowerCase().includes("maltada"));
  });
});

describe("Divisão de Água: Mostura e Lavagem", () => {
  test("Combina mostura e lavagem mantendo balanço de massa", () => {
    const source: WaterProfile = { ...zeroProfile };
    const mashSalts = { gypsum: 4, cacl2: 2 };
    const spargeSalts = { gypsum: 2, cacl2: 1 };
    const split = calculateWaterSplit(source, mashSalts, spargeSalts, { mashL: 20, spargeL: 10, totalL: 30 });

    assert.equal(split.totalSalts.gypsum, 6);
    assert.equal(split.totalSalts.cacl2, 3);
    near(split.combinedProfile.ca, split.mashProfile.ca * (20 / 30) + split.spargeProfile.ca * (10 / 30), 0.1);
  });
});

describe("Otimizador Inteligente de Sais", () => {
  test("Alcança perfil alvo equilibrado a partir de água destilada", () => {
    const target: WaterProfile = { ca: 80, mg: 10, na: 15, so4: 100, cl: 80, hco3: 0 };
    const report = optimizeSalts(zeroProfile, target, 30);
    assert.ok(report.success);
    assert.ok((report.additions.gypsum ?? 0) > 0);
    assert.ok((report.additions.cacl2 ?? 0) > 0);
    near(report.achievedProfile.ca, target.ca, 25);
    near(report.achievedProfile.so4, target.so4, 15);
    near(report.achievedProfile.cl, target.cl, 15);
  });

  test("Alerta quando água de origem já supera o alvo", () => {
    const hardSource: WaterProfile = { ca: 150, mg: 30, na: 50, so4: 100, cl: 80, hco3: 200 };
    const targetPilsen: WaterProfile = { ca: 20, mg: 5, na: 5, so4: 20, cl: 20, hco3: 30 };
    const report = optimizeSalts(hardSource, targetPilsen, 30);
    assert.ok(report.warnings.some((w) => w.toLowerCase().includes("osmose") || w.toLowerCase().includes("superando")));
  });

  test("Não recomenda CaCO3 (giz) automaticamente para ajuste de perfil", () => {
    const target: WaterProfile = { ca: 80, mg: 10, na: 15, so4: 100, cl: 80, hco3: 80 };
    const report = optimizeSalts(zeroProfile, target, 30, { allowChalk: false });
    assert.equal(report.additions.chalk ?? 0, 0);
    assert.ok((report.additions.bicarb ?? 0) > 0); // Deve preferir bicarbonato solúvel
  });
});

describe("Estimativa de pH da Mostura", () => {
  test("Malte base puro com água mole fica próximo de 5.5 - 5.6", () => {
    const est = estimateMashPh(
      [{ name: "Pilsen", kg: 5, colorLovibond: 2, type: "base" }],
      15,
      { ca: 50, mg: 10, na: 0, so4: 50, cl: 50, hco3: 30 }
    );
    assert.ok(est.estimatedPh >= 5.3 && est.estimatedPh <= 5.7, `pH inesperado: ${est.estimatedPh}`);
  });

  test("Maltes escuros e torrados reduzem o pH da mostura", () => {
    const pale = estimateMashPh(
      [{ name: "Pilsen", kg: 5, colorLovibond: 2, type: "base" }],
      15,
      zeroProfile
    );
    const dark = estimateMashPh(
      [
        { name: "Pilsen", kg: 4, colorLovibond: 2, type: "base" },
        { name: "Roasted Barley", kg: 1, colorLovibond: 450, type: "roasted" },
      ],
      15,
      zeroProfile
    );
    assert.ok(dark.estimatedPh < pale.estimatedPh, "Maltes torrados devem acidificar a mostura");
  });

  test("Adição de ácido lático 85% reduz o pH", () => {
    const semAcido = estimateMashPh(
      [{ name: "Pilsen", kg: 5, colorLovibond: 2, type: "base" }],
      15,
      { ca: 50, mg: 10, na: 0, so4: 50, cl: 50, hco3: 100 }
    );
    const comAcido = estimateMashPh(
      [{ name: "Pilsen", kg: 5, colorLovibond: 2, type: "base" }],
      15,
      { ca: 50, mg: 10, na: 0, so4: 50, cl: 50, hco3: 100 },
      { lactic85Ml: 3 }
    );
    assert.ok(comAcido.estimatedPh < semAcido.estimatedPh);
    assert.ok(comAcido.acidEffect < 0);
  });
});
