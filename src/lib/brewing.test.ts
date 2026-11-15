/// <reference types="node" />
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  alcohol,
  brewhouseEfficiency,
  carbonation,
  convertUnit,
  correctedHydrometer,
  correctedRefractometer,
  estimateOgFg,
  gravityAfterVolumeChange,
  hopFreshness,
  ibuRager,
  ibuTinseth,
  infusionWater,
  moreySrm,
  platoToSg,
  sgToPlato,
  strikeTemperature,
  tunCalibration,
  yeastPitch,
} from "./brewing";
import { calculators, validateCalculator } from "./calculator-registry";

const near = (actual: number, expected: number, tolerance = 0.0001) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected} (tol ${tolerance})`);

describe("Álcool, Atenuação e Calorias", () => {
  test("Cálculo padrão (OG 1.050 / FG 1.010)", () => {
    const a = alcohol(1.05, 1.01, 355);
    near(a.abv, 5.25, 0.01);
    near(a.apparent, 80, 0.01);
    near(a.calories, 163.74, 0.1);
    near(a.abw, 4.13, 0.05);
    assert.ok(a.real > 60 && a.real < 70, `Atenuação real fora da faixa: ${a.real}`);
  });

  test("Cerveja de alta densidade usa fórmula avançada de Hall", () => {
    const a = alcohol(1.08, 1.015, 355);
    near(a.abv, 8.53, 0.01);
    near(a.abvAlternative, 9.1, 0.05);
    assert.ok(a.abvAlternative > a.abv, "Fórmula de Hall deve ser superior ao método linear simples em alta densidade");
  });

  test("Trata densidades iguais ou inválidas sem produzir NaN", () => {
    const zero = alcohol(1.0, 1.0, 355);
    assert.equal(zero.abv, 0);
    assert.equal(zero.apparent, 0);
    assert.equal(zero.calories, 0);

    const neg = alcohol(0.99, 1.01, 355);
    assert.equal(neg.abv, 0);
  });
});

describe("Inoculação e Propagação de Levedura", () => {
  test("Taxa de inoculação para ale padrão", () => {
    const a = yeastPitch(20, 1.05, 0.75, 1, 100, 90, 1, 1.4);
    near(a.available, 90);
    near(a.propagated, 230);
    near(a.extractGrams, 100);
    near(a.needed, 185.82, 0.1);
    near(a.deficit, 95.82, 0.1);
  });

  test("Lager exige dobro da taxa de inoculação", () => {
    const ale = yeastPitch(20, 1.05, 0.75, 1, 100, 100, 0, 1.4);
    const lager = yeastPitch(20, 1.05, 1.5, 1, 100, 100, 0, 1.4);
    near(lager.needed, ale.needed * 2, 0.01);
  });
});

describe("Refratômetro e Brix", () => {
  test("Sean Terrill linear para mosto fermentado", () => {
    near(correctedRefractometer(12.4, 6, 1.04), 1.00995, 0.0001);
  });

  test("Mosto não fermentado converte direto Brix para SG", () => {
    const wcf = 1.04;
    const brix = 12.4;
    const sg = platoToSg(brix / wcf);
    near(sg, 1.048, 0.002);
  });
});

describe("Correção de Densidade por Temperatura e Volume", () => {
  test("Densímetro na calibração e com correção térmica", () => {
    near(correctedHydrometer(1.05, 20, 20), 1.05, 0.0001);
    near(correctedHydrometer(1.05, 30, 20), 1.0526, 0.0002);
  });

  test("Evaporação e diluição de mosto conservam pontos de extrato", () => {
    near(gravityAfterVolumeChange(1.05, 25, 20), 1.0625, 0.0001);
    near(gravityAfterVolumeChange(1.05, 20, 25), 1.04, 0.0001);
  });

  test("Volume final zero não trava nem retorna NaN", () => {
    assert.equal(gravityAfterVolumeChange(1.05, 20, 0), 1.05);
  });
});

describe("Carbonatação", () => {
  test("Priming com sacarose e pressão em barril", () => {
    const a = carbonation(20, 2.5, 20, 4);
    near(a.sugar, 131.08, 0.1);
    near(a.residual, 0.86, 0.05);
    near(a.gl, 4.9, 0.01);

    const keg = carbonation(4, 2.5, 20, 4);
    near(keg.psi, 11.86, 0.1);
    near(keg.bar, 0.818, 0.01);
  });

  test("Priming com dextrose e extrato seco de malte", () => {
    const sucrose = carbonation(20, 2.5, 20, 4);
    const dextrose = carbonation(20, 2.5, 20, 4.4);
    const dme = carbonation(20, 2.5, 20, 6.5);
    assert.ok(dextrose.sugar > sucrose.sugar, "Dextrose deve exigir maior massa que sacarose");
    assert.ok(dme.sugar > dextrose.sugar, "DME deve exigir maior massa que dextrose");
  });
});

describe("Degradação e Frescor do Lúpulo", () => {
  test("Decaimento exponencial por tempo e temperatura", () => {
    near(hopFreshness(12, 25, 180, 20, 1).alpha, 9, 0.01);
    near(hopFreshness(12, 25, 0, 20, 1).alpha, 12, 0.01);
    const warm = hopFreshness(12, 25, 180, 30, 1);
    assert.ok(warm.alpha < 9, "Temperatura mais alta deve acelerar degradação");
    const vacuum = hopFreshness(12, 25, 180, 20, 0.25);
    assert.ok(vacuum.alpha > 9, "Embalagem a vácuo deve reter mais ácido alfa");
  });
});

describe("Conversão de Escala de Receita", () => {
  test("Ajusta malte por volume e eficiência; lúpulo por volume", () => {
    const c = calculators.find((x) => x.id === "scale");
    assert.ok(c);
    const v = { oldVolume: "20", newVolume: "40", oldEfficiency: "75", newEfficiency: "60", malt: "5", hops: "50", yeast: "11" };
    const results = c.calculate(v);
    near(results[1].value, 12.5); // malte: 5 * 2 * (75/60) = 12.5 kg
    near(results[2].value, 100); // lúpulo: 50 * 2 = 100 g
    near(results[3].value, 22); // levedura: 11 * 2 = 22 g
  });
});

describe("Conversões de Gravidade e Cor", () => {
  test("Conversão bidirecional SG e Plato", () => {
    near(sgToPlato(1.05), 12.3876, 0.01);
    near(platoToSg(12), 1.04838, 0.0002);
    assert.equal(sgToPlato(1.0), 0);
    assert.equal(platoToSg(0), 1.0);
  });

  test("Conversão de cor SRM, EBC e Lovibond", () => {
    const c = calculators.find((x) => x.id === "color");
    assert.ok(c);
    const r = c.calculate({ value: "10", unit: "srm" });
    near(r[0].value, 10);
    near(r[1].value, 19.7); // EBC = 1.97 * SRM
    near(r[2].value, 7.94, 0.05); // Lovibond
  });
});

describe("Conversões de Unidades Físicas", () => {
  test("Comprimento", () => near(convertUnit(1, "length", "in", "mm"), 25.4));
  test("Volume", () => near(convertUnit(1, "volume", "gal (US)", "L"), 3.78541, 0.0001));
  test("Peso", () => near(convertUnit(1, "weight", "lb", "g"), 453.59237, 0.001));
  test("Temperatura", () => {
    near(convertUnit(20, "temperature", "°C", "°F"), 68);
    near(convertUnit(273.15, "temperature", "K", "°C"), 0);
  });
  test("Pressão", () => near(convertUnit(1, "pressure", "bar", "psi"), 14.50377, 0.001));
});

describe("Mostura: Água de Ataque, Repouso e Calibração", () => {
  test("Temperatura da água de ataque (Strike Water)", () => {
    near(strikeTemperature(5, 15, 20, 67, 0, 20), 73.42, 0.05);
  });

  test("Infusão de água quente para rampa de temperatura", () => {
    near(infusionWater(5, 15, 63, 72, 100), 5.48, 0.05);
  });

  test("Calibração térmica da panela de mostura", () => {
    near(tunCalibration(5, 15, 20, 75, 20, 67), 0.503, 0.01);
  });
});

describe("Amargor IBU (Tinseth e Rager) e Cor SRM (Morey)", () => {
  test("IBU Tinseth calcula amargor padrão com curva de saturação", () => {
    near(ibuTinseth(30, 12.5, 60, 20, 1.05), 43.25, 0.05);
  });

  test("IBU Rager calcula com correção de gravidade", () => {
    const rager = ibuRager(30, 12.5, 60, 20, 1.05);
    assert.ok(rager > 40 && rager < 65, `Rager IBU inesperado: ${rager}`);
  });

  test("Morey SRM calcula cor a partir da carga de grãos", () => {
    near(moreySrm(4, 2, 0.5, 40, 20), 8.055, 0.01);
  });
});

describe("Eficiência de Brassagem e Estimativa de OG/FG", () => {
  test("Calcula eficiência da brassagem a partir do volume e OG medidos", () => {
    const res = brewhouseEfficiency(20, 1.05, 5, 1.037);
    near(res.efficiency, 64.77, 0.1);
    near(res.actualPoints, 1000, 1);
    near(res.pointsPerKg, 200, 1);
  });

  test("Estima OG, FG e ABV a partir dos grãos e eficiência esperada", () => {
    const est = estimateOgFg(5, 20, 75, 75, 1.037);
    near(est.og, 1.0579, 0.001);
    near(est.fg, 1.0145, 0.001);
    near(est.abv, 5.7, 0.1);
  });
});

describe("Química da Água", () => {
  test("Ajuste de água calcula sais e relação sulfato/cloreto", () => {
    const c = calculators.find((x) => x.id === "water");
    assert.ok(c);
    const v = {
      sourceCa: "80",
      sourceMg: "20",
      sourceNa: "10",
      sourceSo4: "30",
      sourceCl: "20",
      sourceHco3: "50",
      targetCa: "120",
      targetMg: "20",
      targetNa: "25",
      targetSo4: "100",
      targetCl: "60",
      targetHco3: "80",
      waterVolume: "30",
    };
    const result = c.calculate(v);
    assert.ok(result.some((r) => r.label.includes("Relação sulfato/cloreto")));
    assert.ok(result.some((r) => r.value > 0 && r.label.toLowerCase().includes("gipsita")));
  });
});

describe("Registro e Integridade de Todas as Calculadoras", () => {
  test("Todas as 30 calculadoras têm IDs únicos e valores iniciais válidos", () => {
    assert.equal(calculators.length, 30);
    assert.equal(new Set(calculators.map((c) => c.id)).size, 30);
    for (const c of calculators) {
      const v = Object.fromEntries(c.fields.map((f) => [f.id, f.initial]));
      assert.equal(validateCalculator(c, v), undefined, `Erro inicial em ${c.id}`);
      for (const result of c.calculate(v)) {
        assert.ok(Number.isFinite(result.value), `Valor não finito em ${c.id}: ${result.label} = ${result.value}`);
      }
    }
  });

  test("Validação bloqueia limites inválidos e condições impossíveis", () => {
    const testCases: [string, Record<string, string>][] = [
      ["evaporation", { final: "0" }],
      ["evaporation", { time: "0" }],
      ["alcohol", { fg: "1.06" }],
      ["rest", { infusion: "70" }],
      ["rest", { target: "60" }],
      ["yeast", { viability: "0", starter: "1" }],
      ["gravity", { value: "0.9" }],
      ["scale", { oldVolume: "0" }],
    ];

    for (const [id, override] of testCases) {
      const c = calculators.find((calc) => calc.id === id);
      assert.ok(c, `Calculadora ${id} não encontrada`);
      const v = { ...Object.fromEntries(c.fields.map((f) => [f.id, f.initial])), ...override };
      const err = validateCalculator(c, v);
      assert.ok(err, `Deveria ter bloqueado caso inválido em ${id}: ${JSON.stringify(override)}`);
    }
  });
});
