import {
  alcohol,
  brewhouseEfficiency,
  carbonation,
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
import { estimateViability, simulateStarterStage, type StarterAgitation } from "./yeast-calc";
import { applySalts, salts, suggestSalts, sulfateChlorideRatio, totalAlkalinity, residualAlkalinity, type WaterProfile } from "./recipe-calc";
import { getLocale, readSettings } from "./settings";

export type Values = Record<string, string>;
export type Result = { label: string; value: number; unit?: string; digits?: number };
export type Field = { id: string; label: string; initial: string; min?: number; max?: number; options?: { value: string; label: string }[] };
export type CalculatorDefinition = {
  id: string;
  title: string;
  group: "Geral" | "Mostura";
  fields: Field[];
  calculate: (v: Values) => Result[];
  validate?: (v: Values) => string | undefined;
  note?: string;
  converter?: "volume" | "weight" | "temperature" | "pressure" | "all";
};

const n = (v: Values, key: string) => Number(v[key]?.replace(",", ".") ?? 0);
const f = (id: string, label: string, initial: number, min?: number, max?: number): Field => ({ id, label, initial: String(initial), min, max });
const select = (id: string, label: string, initial: string, options: [string, string][]): Field => ({ id, label, initial, options: options.map(([value, label]) => ({ value, label })) });
const r = (label: string, value: number, unit = "", digits = 2): Result => ({ label, value, unit, digits });
const og = () => f("og", "Densidade inicial (SG)", 1.05, 1.001, 1.2);
const fg = () => f("fg", "Densidade final (SG)", 1.01, 0.98, 1.2);
const volume = () => f("volume", "Volume (L)", 20, 0.001);
const gravityValidation = (v: Values) => (n(v, "fg") > n(v, "og") ? "A densidade final não pode superar a inicial." : undefined);

export const calculators: CalculatorDefinition[] = [
  {
    id: "alcohol",
    title: "Álcool / Atenuação / Calorias",
    group: "Geral",
    fields: [og(), fg(), f("serving", "Porção (mL)", 355, 1)],
    validate: gravityValidation,
    note: "ABV pela fórmula padrão (OG − FG) × 131,25 e alternativa de Hall para alta gravidade. Calorias e atenuação real estimadas pelo extrato em °P.",
    calculate: (v) => {
      const a = alcohol(n(v, "og"), n(v, "fg"), n(v, "serving"));
      return [
        r("Teor alcoólico", a.abv, "% ABV"),
        r("Teor alcoólico (alta gravidade / Hall)", a.abvAlternative, "% ABV"),
        r("Teor por peso (ABW)", a.abw, "% ABW"),
        r("Atenuação aparente", a.apparent, "%"),
        r("Atenuação real", a.real, "%"),
        r("Extrato real", a.realExtract, "°P"),
        r("Calorias por porção", a.calories, "kcal", 0),
      ];
    },
  },
  {
    id: "efficiency",
    title: "Eficiência de Brassagem",
    group: "Geral",
    fields: [volume(), og(), f("malt", "Malte total (kg)", 5, 0.001), f("potential", "Potencial médio dos grãos (SG)", 1.037, 1.01, 1.05)],
    note: "Calcula a eficiência real com base no volume e densidade no fermentador comparados ao potencial teórico dos grãos (padrão 1,037 SG = 37 PPG / 80% extrato).",
    calculate: (v) => {
      const eff = brewhouseEfficiency(n(v, "volume"), n(v, "og"), n(v, "malt"), n(v, "potential"));
      return [
        r("Eficiência da brassagem", eff.efficiency, "%", 1),
        r("Pontos obtidos", eff.actualPoints, "GU", 0),
        r("Pontos potenciais", eff.potentialPoints, "GU", 0),
        r("Rendimento por kg de malte", eff.pointsPerKg, "GU/kg", 1),
      ];
    },
  },
  {
    id: "ogfg",
    title: "Estimativa de OG e FG",
    group: "Geral",
    fields: [f("malt", "Malte total (kg)", 5, 0.001), volume(), f("efficiency", "Eficiência estimada (%)", 75, 1, 100), f("attenuation", "Atenuação da levedura (%)", 75, 10, 100), f("potential", "Potencial médio dos grãos (SG)", 1.037, 1.01, 1.05)],
    note: "Estimativa teórica a partir da carga de grãos, eficiência do equipamento e atenuação esperada da levedura.",
    calculate: (v) => {
      const est = estimateOgFg(n(v, "malt"), n(v, "volume"), n(v, "efficiency"), n(v, "attenuation"), n(v, "potential"));
      return [
        r("Densidade inicial estimada (OG)", est.og, "SG", 4),
        r("Densidade final estimada (FG)", est.fg, "SG", 4),
        r("Extrato original", est.plato, "°P", 1),
        r("Pontos de gravidade", est.points, "GU", 1),
        r("Teor alcoólico estimado", est.abv, "% ABV", 1),
      ];
    },
  },
  {
    id: "water",
    title: "Química da água",
    group: "Geral",
    fields: [
      f("sourceCa", "Cálcio (Ca) de origem (ppm)", 80, 0),
      f("sourceMg", "Magnésio (Mg) de origem (ppm)", 20, 0),
      f("sourceNa", "Sódio (Na) de origem (ppm)", 10, 0),
      f("sourceSo4", "Sulfato (SO₄) de origem (ppm)", 30, 0),
      f("sourceCl", "Cloreto (Cl) de origem (ppm)", 20, 0),
      f("sourceHco3", "Bicarbonato (HCO₃) de origem (ppm)", 50, 0),
      f("targetCa", "Cálcio (Ca) alvo (ppm)", 120, 0),
      f("targetMg", "Magnésio (Mg) alvo (ppm)", 20, 0),
      f("targetNa", "Sódio (Na) alvo (ppm)", 25, 0),
      f("targetSo4", "Sulfato (SO₄) alvo (ppm)", 100, 0),
      f("targetCl", "Cloreto (Cl) alvo (ppm)", 60, 0),
      f("targetHco3", "Bicarbonato (HCO₃) alvo (ppm)", 80, 0),
      f("waterVolume", "Volume total de água (L)", 30, 0.001),
    ],
    note: "Ajuste estimado com gipsita, cloreto de cálcio, sal de Epsom, sal de cozinha e bicarbonato de sódio. Use perfis conhecidos como referência para a água de origem.",
    calculate: (v) => {
      const source: WaterProfile = { ca: n(v, "sourceCa"), mg: n(v, "sourceMg"), na: n(v, "sourceNa"), so4: n(v, "sourceSo4"), cl: n(v, "sourceCl"), hco3: n(v, "sourceHco3") };
      const target: WaterProfile = { ca: n(v, "targetCa"), mg: n(v, "targetMg"), na: n(v, "targetNa"), so4: n(v, "targetSo4"), cl: n(v, "targetCl"), hco3: n(v, "targetHco3") };
      const additions = suggestSalts(source, target, n(v, "waterVolume"));
      const result = applySalts(source, additions, n(v, "waterVolume"));
      const ratio = sulfateChlorideRatio(result);
      return [
        r("Cálcio final", result.ca, "ppm", 0),
        r("Magnésio final", result.mg, "ppm", 0),
        r("Sódio final", result.na, "ppm", 0),
        r("Sulfato final", result.so4, "ppm", 0),
        r("Cloreto final", result.cl, "ppm", 0),
        r("Bicarbonato final", result.hco3, "ppm", 0),
        r("Alcalinidade total", totalAlkalinity(result), "ppm CaCO₃", 0),
        r("Alcalinidade residual", residualAlkalinity(result), "ppm CaCO₃", 0),
        r("Relação sulfato/cloreto", ratio, "", 2),
        ...salts.filter((s) => (additions[s.id] ?? 0) > 0).map((s) => r(`${s.label}`, additions[s.id], "g", 1)),
      ];
    },
  },
  {
    id: "yeast",
    title: "Taxa de Inoculação / Propagação de Levedura",
    group: "Geral",
    fields: [
      volume(),
      og(),
      f("rate", "Taxa desejada (M células / mL / °P)", 0.75, 0.01),
      select("form", "Forma da levedura", "liquid", [
        ["liquid", "Líquida (decaimento White Labs ~21% ao mês)"],
        ["dry", "Seca ativa (perda ~0,5% ao mês)"],
      ]),
      f("ageDays", "Idade da levedura (dias de fabricação - 0 para usar viabilidade manual)", 0, 0, 730),
      f("viability", "Viabilidade manual (%) [usada se idade = 0]", 90, 0, 100),
      f("packs", "Pacotes disponíveis", 1, 1),
      f("cells", "Células nominais por pacote (bilhões)", 100, 1),
      f("starter", "Volume do starter (L) [0 para nenhum]", 1, 0),
      select("agitation", "Agitação do starter (Kai Troester)", "stir_plate", [
        ["stir_plate", "Agitador Magnético (rendimento máximo)"],
        ["shaking", "Agitação manual periódica"],
        ["still", "Estático (sem agitação)"],
      ]),
    ],
    note: "Modelo dinâmico de Kai Troester (Braukaiser) para starter e decaimento por idade. Graus Plato calculados automaticamente a partir da densidade (OG).",
    validate: (v) => {
      const effViab = n(v, "ageDays") > 0 ? estimateViability(n(v, "ageDays"), v.form as "liquid" | "dry") : n(v, "viability");
      if (effViab === 0 && n(v, "starter") > 0) return "A propagação exige células viáveis.";
      return undefined;
    },
    calculate: (v) => {
      const vol = n(v, "volume");
      const ogVal = n(v, "og");
      const plato = sgToPlato(ogVal);
      const rate = n(v, "rate");
      const needed = vol * plato * rate;
      const age = n(v, "ageDays");
      const form = (v.form as "liquid" | "dry") || "liquid";
      const viability = age > 0 ? estimateViability(age, form) : n(v, "viability");
      const packs = n(v, "packs");
      const cellsPerPack = n(v, "cells");
      const viableCells = Math.max(0, (packs * cellsPerPack * viability) / 100);
      const packsNeeded = Math.ceil(needed / Math.max(1, cellsPerPack * (viability / 100)));
      const starterL = n(v, "starter");
      const agitation = (v.agitation as StarterAgitation) || "stir_plate";

      const results: Result[] = [
        r("Graus Plato do mosto", plato, "°P", 2),
        r("Células necessárias", needed, "bilhões", 1),
        r("Viabilidade estimada", viability, "%", 1),
        r("Células viáveis disponíveis", viableCells, "bilhões", 1),
        r("Pacotes necessários (sem starter)", packsNeeded, "un", 0),
      ];

      if (starterL > 0 && viableCells > 0) {
        const stage = simulateStarterStage(viableCells, starterL, 1.037, agitation);
        const achievedRate = vol > 0 && plato > 0 ? stage.finalCellsBillions / (vol * plato) : 0;
        results.push(
          r("Extrato seco (DME) do starter", stage.extractGrams, "g", 0),
          r("Densidade de inoculação do starter", stage.inoculationRateBillionPerGram, "B/g", 2),
          r("Rendimento dinâmico (Troester)", stage.yieldPerGram, "B/g", 2),
          r("Células geradas no starter", stage.newCellsProducedBillions, "bilhões", 1),
          r("Células finais após starter", stage.finalCellsBillions, "bilhões", 1),
          r("Taxa final atingida no lote", achievedRate, "M/mL/°P", 2)
        );
      } else {
        const directRate = vol > 0 && plato > 0 ? viableCells / (vol * plato) : 0;
        results.push(
          r("Déficit de células", Math.max(0, needed - viableCells), "bilhões", 1),
          r("Taxa de inoculação direta", directRate, "M/mL/°P", 2)
        );
      }
      return results;
    },
  },
  {
    id: "brix",
    title: "Refratômetro / Brix",
    group: "Geral",
    fields: [
      f("original", "Brix inicial (leitura)", 12.4, 0, 40),
      f("current", "Brix atual (leitura)", 6, 0, 40),
      f("factor", "Fator de correção do mosto", 1.04, 0.8, 1.3),
      select("fermented", "Estado do mosto", "yes", [
        ["yes", "Após fermentação"],
        ["no", "Antes da fermentação"],
      ]),
    ],
    note: "Após fermentação: modelo linear de Sean Terrill, estimativo. Antes da fermentação: conversão Brix/SG com fator do mosto.",
    validate: (v) => (v.fermented === "yes" && n(v, "current") > n(v, "original") ? "O Brix atual não pode superar o inicial após fermentação." : undefined),
    calculate: (v) => {
      const sg = v.fermented === "yes" ? correctedRefractometer(n(v, "original"), n(v, "current"), n(v, "factor")) : platoToSg(n(v, "current") / n(v, "factor"));
      return [
        r("Densidade corrigida", sg, "SG", 4),
        r("Leitura corrigida do mosto", n(v, "current") / n(v, "factor"), "°Bx"),
        ...(v.fermented === "yes" ? [r("Teor alcoólico estimado", (platoToSg(n(v, "original") / n(v, "factor")) - sg) * 131.25, "% ABV")] : []),
      ];
    },
  },
  {
    id: "evaporation",
    title: "Correção da Densidade / Evaporação",
    group: "Geral",
    fields: [f("sg", "Densidade atual (SG)", 1.05, 1, 1.3), f("initial", "Volume inicial (L)", 25, 0.001), f("final", "Volume final (L)", 20, 0.001), f("time", "Tempo (min)", 60, 0.001)],
    note: "Conservação dos pontos de gravidade, sem perdas de extrato. Volumes na mesma temperatura; diferença negativa indica diluição.",
    validate: (v) => (n(v, "time") <= 0 ? "O tempo de fervura deve ser maior que zero." : n(v, "initial") <= 0 ? "O volume inicial deve ser maior que zero." : n(v, "final") <= 0 ? "O volume final deve ser maior que zero." : undefined),
    calculate: (v) => [
      r("Densidade final", gravityAfterVolumeChange(n(v, "sg"), n(v, "initial"), n(v, "final")), "SG", 4),
      r("Variação de volume", n(v, "initial") - n(v, "final"), "L"),
      r("Evaporação por hora", ((n(v, "initial") - n(v, "final")) * 60) / n(v, "time"), "L/h"),
      r("Redução do volume", (1 - n(v, "final") / n(v, "initial")) * 100, "%"),
    ],
  },
  {
    id: "hydrometer",
    title: "Correção de Temperatura do Densímetro",
    group: "Geral",
    fields: [f("sg", "Leitura do densímetro (SG)", 1.05, 0.98, 1.3), f("measured", "Temperatura da amostra (°C)", 30, 0, 60), f("calibration", "Temperatura de calibração (°C)", 20, 0, 30)],
    note: "Correção aproximada. Amostras próximas da temperatura de calibração produzem leituras mais confiáveis.",
    calculate: (v) => [r("Densidade corrigida", correctedHydrometer(n(v, "sg"), n(v, "measured"), n(v, "calibration")), "SG", 4)],
  },
  {
    id: "carbonation",
    title: "Carbonatação",
    group: "Geral",
    fields: [
      volume(),
      f("temperature", "Maior temperatura após fermentação (°C)", 20, 0, 35),
      f("target", "Carbonatação desejada (volumes CO₂)", 2.5, 0.5, 5),
      select("sugar", "Açúcar para priming", "4", [
        ["4", "Sacarose (açúcar de mesa)"],
        ["4.4", "Dextrose monohidratada"],
        ["6.5", "Extrato seco de malte"],
      ]),
      f("kegTemp", "Temperatura de serviço do barril (°C)", 4, 0, 30),
    ],
    note: "Priming estimado pelo CO₂ residual. Pressão manométrica de equilíbrio para barril na temperatura de serviço. Use recipientes adequados à pressão; não engarrafe antes do fim da fermentação.",
    calculate: (v) => {
      const a = carbonation(n(v, "temperature"), n(v, "target"), n(v, "volume"), n(v, "sugar"));
      const keg = carbonation(n(v, "kegTemp"), n(v, "target"), n(v, "volume"), n(v, "sugar"));
      return [
        r("Açúcar para priming", a.sugar, "g", 1),
        r("CO₂ residual estimado", a.residual, "vol"),
        r("Carbonatação equivalente", a.gl, "g/L", 2),
        r("Pressão do barril", keg.bar, "bar"),
        r("Pressão do barril", keg.psi, "psi"),
      ];
    },
  },
  {
    id: "hops",
    title: "Frescor do Lúpulo",
    group: "Geral",
    fields: [
      f("alpha", "Ácido alfa inicial (%)", 12, 0, 30),
      f("loss", "Perda em 6 meses a 20 °C (%)", 25, 0, 99),
      f("days", "Tempo armazenado (dias)", 180, 0),
      f("temperature", "Temperatura de armazenamento (°C)", 20, -30, 40),
      select("package", "Embalagem", "1", [
        ["1", "Aberta / em contato com ar"],
        ["0.5", "Selada"],
        ["0.25", "Vácuo / gás inerte"],
      ]),
    ],
    note: "Estimativa exponencial: a degradação dobra a cada +10 °C; fatores de embalagem são aproximações. Informe a perda da variedade fornecida pelo produtor.",
    calculate: (v) => {
      const a = hopFreshness(n(v, "alpha"), n(v, "loss"), n(v, "days"), n(v, "temperature"), n(v, "package"));
      return [r("Ácido alfa estimado", a.alpha, "%"), r("Retenção estimada", a.retention, "%")];
    },
  },
  {
    id: "scale",
    title: "Conversão de Brassagem",
    group: "Geral",
    fields: [
      f("oldVolume", "Volume original (L)", 20, 0.001),
      f("newVolume", "Novo volume (L)", 40, 0.001),
      f("oldEfficiency", "Eficiência original (%)", 75, 1, 100),
      f("newEfficiency", "Nova eficiência (%)", 75, 1, 100),
      f("malt", "Malte original (kg)", 5, 0),
      f("hops", "Lúpulo original (g)", 50, 0),
      f("yeast", "Levedura original (g)", 11, 0),
    ],
    note: "Maltes ajustados por volume e eficiência; lúpulos e levedura por volume. Reavalie IBU e inoculação quando mudar o equipamento.",
    validate: (v) => (n(v, "oldVolume") <= 0 ? "O volume original deve ser maior que zero." : n(v, "newEfficiency") <= 0 ? "A nova eficiência deve ser maior que zero." : undefined),
    calculate: (v) => {
      const factor = n(v, "newVolume") / n(v, "oldVolume");
      return [
        r("Fator de volume", factor, "×"),
        r("Malte ajustado", (n(v, "malt") * factor * n(v, "oldEfficiency")) / n(v, "newEfficiency"), "kg", 3),
        r("Lúpulo ajustado", n(v, "hops") * factor, "g", 1),
        r("Levedura ajustada", n(v, "yeast") * factor, "g", 1),
      ];
    },
  },
  {
    id: "gravity",
    title: "Conversão de Gravidade",
    group: "Geral",
    fields: [
      f("value", "Valor", 1.05, 0),
      select("unit", "Unidade de entrada", "sg", [
        ["sg", "SG"],
        ["plato", "°Plato"],
        ["points", "Pontos de gravidade"],
      ]),
    ],
    validate: (v) =>
      v.unit === "sg" && (n(v, "value") < 1 || n(v, "value") > 1.2)
        ? "Informe SG entre 1,000 e 1,200."
        : v.unit === "plato" && (n(v, "value") < 0 || n(v, "value") > 40)
          ? "Informe °Plato entre 0 e 40."
          : v.unit === "points" && (n(v, "value") < 0 || n(v, "value") > 200)
            ? "Informe de 0 a 200 pontos."
            : undefined,
    calculate: (v) => {
      const value = n(v, "value");
      const sg = v.unit === "sg" ? value : v.unit === "plato" ? platoToSg(value) : 1 + value / 1000;
      return [r("Gravidade específica", sg, "SG", 4), r("Extrato", sgToPlato(sg), "°P"), r("Pontos de gravidade", (sg - 1) * 1000, "GU", 1)];
    },
  },
  {
    id: "color",
    title: "Conversão de Cor",
    group: "Geral",
    fields: [
      f("value", "Cor", 10, 0),
      select("unit", "Unidade de entrada", "srm", [
        ["srm", "SRM"],
        ["ebc", "EBC"],
        ["lovibond", "°Lovibond"],
      ]),
    ],
    note: "SRM = 1,3546 × °Lovibond − 0,76; EBC = 1,97 × SRM. Conversão aproximada de Lovibond; limitada a zero na faixa muito clara.",
    calculate: (v) => {
      const x = n(v, "value");
      const srm = v.unit === "srm" ? x : v.unit === "ebc" ? x / 1.97 : Math.max(0, 1.3546 * x - 0.76);
      const ebc = v.unit === "ebc" ? x : srm * 1.97;
      const lovibond = v.unit === "lovibond" ? x : (srm + 0.76) / 1.3546;
      return [r("Cor SRM", srm, "SRM"), r("Cor EBC", ebc, "EBC"), r("Cor Lovibond", lovibond, "°L")];
    },
  },
  ...(
    [
      ["units", "Conversão de unidade", "all"],
      ["volume", "Conversão de volumes", "volume"],
      ["weight", "Conversão de peso", "weight"],
      ["temperature", "Conversão de Temperatura", "temperature"],
      ["pressure", "Conversão de pressão", "pressure"],
    ] as const
  ).map(
    ([id, title, converter]): CalculatorDefinition => ({
      id,
      title,
      group: "Geral",
      fields: [],
      calculate: () => [],
      converter,
    })
  ),
  {
    id: "strike",
    title: "Calculadora de Temperatura Desejada",
    group: "Mostura",
    fields: [
      f("grain", "Malte (kg)", 5, 0.001),
      f("water", "Água de mostura (L)", 15, 0.001),
      f("grainTemp", "Temperatura do malte (°C)", 20, 0, 40),
      f("target", "Temperatura desejada da mostura (°C)", 67, 35, 80),
      f("tun", "Equivalente térmico da panela (L de água)", 0, 0),
      f("tunTemp", "Temperatura da panela (°C)", 20, 0, 80),
    ],
    note: "Temperatura da água de ataque por balanço térmico. Equivalente térmico zero representa panela pré-aquecida; ignora perdas para o ambiente.",
    calculate: (v) => [r("Temperatura da água de ataque", strikeTemperature(n(v, "grain"), n(v, "water"), n(v, "grainTemp"), n(v, "target"), n(v, "tun"), n(v, "tunTemp")), "°C", 1)],
  },
  {
    id: "rest",
    title: "Calculadora da Temperatura de Repouso",
    group: "Mostura",
    fields: [
      f("grain", "Malte (kg)", 5, 0.001),
      f("water", "Água atual na mostura (L)", 15, 0.001),
      f("current", "Temperatura atual (°C)", 63, 0, 95),
      f("target", "Novo repouso (°C)", 72, 0, 95),
      f("infusion", "Temperatura da água adicionada (°C)", 100, 0, 100),
    ],
    validate: (v) =>
      n(v, "target") <= n(v, "current")
        ? "O novo repouso deve ser mais quente que o atual."
        : n(v, "infusion") <= n(v, "target")
          ? "A água adicionada deve estar acima da temperatura do novo repouso."
          : undefined,
    note: "Infusão para elevar a temperatura, sem perdas térmicas. Confira se o volume total cabe na panela.",
    calculate: (v) => {
      const added = infusionWater(n(v, "grain"), n(v, "water"), n(v, "current"), n(v, "target"), n(v, "infusion"));
      const totalWater = added + n(v, "water");
      const grain = n(v, "grain");
      return [
        r("Água a adicionar", added, "L"),
        r("Água total após infusão", totalWater, "L"),
        r("Relação água / malte", grain > 0 ? totalWater / grain : 0, "L/kg"),
      ];
    },
  },
  {
    id: "tun",
    title: "Calibração da Panela de Mostura",
    group: "Mostura",
    fields: [
      f("grain", "Malte (kg)", 5, 0),
      f("water", "Água adicionada (L)", 15, 0.001),
      f("grainTemp", "Temperatura inicial do malte (°C)", 20, 0, 40),
      f("waterTemp", "Temperatura inicial da água (°C)", 75, 0, 100),
      f("tunTemp", "Temperatura inicial da panela (°C)", 20, 0, 80),
      f("final", "Temperatura medida após mistura (°C)", 67, 0, 95),
    ],
    validate: (v) =>
      n(v, "final") <= n(v, "tunTemp")
        ? "A temperatura final deve superar a temperatura inicial da panela."
        : n(v, "final") >= n(v, "waterTemp")
          ? "A temperatura final deve estar abaixo da temperatura inicial da água."
          : tunCalibration(n(v, "grain"), n(v, "water"), n(v, "grainTemp"), n(v, "waterTemp"), n(v, "tunTemp"), n(v, "final")) < 0
            ? "Estas medições resultam em capacidade térmica negativa; confira as temperaturas."
            : undefined,
    note: "Equivalente térmico em litros de água, não volume da panela. Misture e meça rapidamente; perdas de calor aumentam o valor estimado.",
    calculate: (v) => {
      const equivalent = tunCalibration(n(v, "grain"), n(v, "water"), n(v, "grainTemp"), n(v, "waterTemp"), n(v, "tunTemp"), n(v, "final"));
      return [r("Equivalente térmico da panela", equivalent, "L de água", 3), r("Capacidade térmica", equivalent * 4.186, "kJ/°C")];
    },
  },
  {
    id: "ibu",
    title: "Amargor / IBU",
    group: "Geral",
    fields: [f("weight", "Lúpulo (g)", 30, 0), f("alpha", "Ácido alfa (%)", 12.5, 0, 30), f("time", "Fervura (min)", 60, 0), volume(), og()],
    note: "Modelos Tinseth e Rager para adição na fervura. Tinseth é o padrão em softwares modernos; Rager ajusta para mostos com densidade superior a 1,050.",
    calculate: (v) => {
      const tinseth = ibuTinseth(n(v, "weight"), n(v, "alpha"), n(v, "time"), n(v, "volume"), n(v, "og"));
      const rager = ibuRager(n(v, "weight"), n(v, "alpha"), n(v, "time"), n(v, "volume"), n(v, "og"));
      return [
        r("Amargor (Tinseth)", tinseth, "IBU", 1),
        r("Amargor (Rager)", rager, "IBU", 1),
      ];
    },
  },
  {
    id: "srm",
    title: "Cor da receita / SRM",
    group: "Geral",
    fields: [f("grain1", "Malte 1 (kg)", 4, 0), f("color1", "Cor do malte 1 (°L)", 2, 0), f("grain2", "Malte 2 (kg)", 0.5, 0), f("color2", "Cor do malte 2 (°L)", 40, 0), volume()],
    note: "Modelo Morey com pesos convertidos para libras e volume para galões americanos.",
    calculate: (v) => {
      const srm = moreySrm(n(v, "grain1"), n(v, "color1"), n(v, "grain2"), n(v, "color2"), n(v, "volume"));
      return [r("Cor estimada", srm, "SRM", 1), r("Cor estimada", srm * 1.97, "EBC", 1)];
    },
  },
];

export function validateCalculator(calculator: CalculatorDefinition, values: Values): string | undefined {
  for (const field of calculator.fields) {
    if (field.options) continue;
    const raw = values[field.id]?.trim();
    const value = Number(raw?.replace(",", "."));
    if (!raw || !Number.isFinite(value)) return `Informe um número válido em “${field.label}”.`;
    if (field.min !== undefined && value < field.min) return `“${field.label}” deve ser no mínimo ${field.min.toLocaleString(getLocale(readSettings()))}.`;
    if (field.max !== undefined && value > field.max) return `“${field.label}” deve ser no máximo ${field.max.toLocaleString(getLocale(readSettings()))}.`;
  }
  return calculator.validate?.(values);
}
