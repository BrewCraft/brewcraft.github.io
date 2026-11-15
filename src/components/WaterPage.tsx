import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wand2, RotateCcw, AlertTriangle, CheckCircle2, Droplets, FlaskConical, Scale, Info } from "lucide-react";
import {
  ions,
  saltsCatalog,
  waterPresets,
  zeroProfile,
  applySalts,
  totalAlkalinity,
  residualAlkalinity,
  sulfateChlorideRatio,
  ratioDescription,
  optimizeSalts,
  estimateMashPh,
  type WaterProfile,
  type Ion,
  type OptimizerReport,
} from "@/lib/water-calc";
import { fmt, profileNumber as pn, readProfiles } from "@/lib/store";

const fromProfile = (v: Record<string, string>): WaterProfile => ({
  ca: pn(v.calcio),
  mg: pn(v.magnesio),
  na: pn(v.sodio),
  so4: pn(v.sulfato),
  cl: pn(v.cloreto),
  hco3: pn(v.bicarbonato),
});

export default function WaterPage() {
  const [params] = useSearchParams();
  const saved = useMemo(() => readProfiles("agua"), []);
  const options: Record<string, WaterProfile> = {
    ...waterPresets,
    ...Object.fromEntries(saved.map((p) => [`Meu perfil: ${p.name}`, fromProfile(p.values)])),
  };

  const initialTarget = saved.find((p) => p.id === params.get("profile"));
  const [sourceName, setSourceName] = useState("Destilada / Osmose Reversa (RO)");
  const [targetName, setTargetName] = useState(initialTarget ? `Meu perfil: ${initialTarget.name}` : "Equilibrada - Uso Geral");
  const [source, setSource] = useState<WaterProfile>(waterPresets["Destilada / Osmose Reversa (RO)"]);

  // Volumes
  const [splitWater, setSplitWater] = useState(false);
  const [totalLiters, setTotalLiters] = useState(Number(params.get("liters")) || 30);
  const [mashLiters, setMashLiters] = useState(18);
  const [spargeLiters, setSpargeLiters] = useState(12);

  // Salt Additions
  const [addTotal, setAddTotal] = useState<Record<string, number>>({});
  const [addMash, setAddMash] = useState<Record<string, number>>({});
  const [addSparge, setAddSparge] = useState<Record<string, number>>({});
  const [splitMode, setSplitMode] = useState<"proportional" | "custom">("proportional");

  // Optimizer Report
  const [optimizerReport, setOptimizerReport] = useState<OptimizerReport | null>(null);

  // Mash pH Estimation inputs
  const [baseMaltKg, setBaseMaltKg] = useState(4.5);
  const [crystalMaltKg, setCrystalMaltKg] = useState(0.5);
  const [roastedMaltKg, setRoastedMaltKg] = useState(0);
  const [acidMaltGrams, setAcidMaltGrams] = useState(0);
  const [lacticAcidMl, setLacticAcidMl] = useState(0);
  const [phosphoricAcidMl, setPhosphoricAcidMl] = useState(0);
  const [measuredPh, setMeasuredPh] = useState("");

  const target = options[targetName] ?? zeroProfile;

  // Active volume calculation
  const effectiveTotalL = splitWater ? Math.max(1, mashLiters + spargeLiters) : Math.max(1, totalLiters);
  const effectiveMashL = splitWater ? Math.max(1, mashLiters) : effectiveTotalL;

  // Active salt calculation
  let activeAdditions = addTotal;
  if (splitWater) {
    if (splitMode === "proportional") {
      activeAdditions = addTotal;
    } else {
      activeAdditions = {};
      for (const salt of saltsCatalog) {
        const m = addMash[salt.id] ?? 0;
        const s = addSparge[salt.id] ?? 0;
        if (m + s > 0) activeAdditions[salt.id] = Math.round((m + s) * 10) / 10;
      }
    }
  }

  const result = applySalts(source, activeAdditions, effectiveTotalL);
  const mashResult = splitWater && splitMode === "custom"
    ? applySalts(source, addMash, effectiveMashL)
    : result;

  const ratio = sulfateChlorideRatio(result);
  const alk = totalAlkalinity(result);
  const ra = residualAlkalinity(result);

  // Mash pH estimation
  const mashPhEstimate = useMemo(() => {
    return estimateMashPh(
      [
        { name: "Malte Base", kg: baseMaltKg, colorLovibond: 2, type: "base" },
        ...(crystalMaltKg > 0 ? [{ name: "Malte Crystal", kg: crystalMaltKg, colorLovibond: 40, type: "crystal" as const }] : []),
        ...(roastedMaltKg > 0 ? [{ name: "Malte Torrado", kg: roastedMaltKg, colorLovibond: 400, type: "roasted" as const }] : []),
        ...(acidMaltGrams > 0 ? [{ name: "Malte Acidificado", kg: acidMaltGrams / 1000, colorLovibond: 3, type: "acidulated" as const }] : []),
      ],
      effectiveMashL,
      mashResult,
      {
        lactic85Ml: lacticAcidMl,
        phosphoric75Ml: phosphoricAcidMl,
        acidulatedMaltGrams: acidMaltGrams,
      }
    );
  }, [baseMaltKg, crystalMaltKg, roastedMaltKg, acidMaltGrams, effectiveMashL, mashResult, lacticAcidMl, phosphoricAcidMl]);

  const runOptimizer = () => {
    const report = optimizeSalts(source, target, effectiveTotalL, { allowChalk: false });
    setOptimizerReport(report);
    setAddTotal(report.additions);

    if (splitWater && splitMode === "custom") {
      const mashProp = effectiveMashL / effectiveTotalL;
      const spargeProp = 1 - mashProp;
      const nextMash: Record<string, number> = {};
      const nextSparge: Record<string, number> = {};
      for (const [k, val] of Object.entries(report.additions)) {
        // Do not add bicarbonate or chalk to sparge water
        if (k === "bicarb" || k === "chalk") {
          nextMash[k] = val;
          nextSparge[k] = 0;
        } else {
          nextMash[k] = Math.round(val * mashProp * 10) / 10;
          nextSparge[k] = Math.round(val * spargeProp * 10) / 10;
        }
      }
      setAddMash(nextMash);
      setAddSparge(nextSparge);
    }
  };

  const resetAll = () => {
    setAddTotal({});
    setAddMash({});
    setAddSparge({});
    setOptimizerReport(null);
    setLacticAcidMl(0);
    setPhosphoricAcidMl(0);
    setAcidMaltGrams(0);
    setMeasuredPh("");
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Droplets className="h-8 w-8 text-primary shrink-0" />
            <h1 className="text-3xl font-bold text-foreground">Química da Água & Mostura</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Ajuste mineral avançado, separação de mostura/lavagem, otimizador de sais e estimativa de pH da mostura.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={resetAll} className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4" /> Restaurar Padrões
        </Button>
      </header>

      {/* Volumes and Separation */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" /> Volumes e Divisão de Água
            </CardTitle>
            <div className="flex items-center gap-2">
              <Switch id="split-water-toggle" checked={splitWater} onCheckedChange={setSplitWater} />
              <Label htmlFor="split-water-toggle" className="cursor-pointer text-sm font-medium">
                Separar mostura e lavagem
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!splitWater ? (
            <div className="max-w-xs space-y-1">
              <Label className="text-xs text-muted-foreground">Volume total de água a tratar (L)</Label>
              <Input
                type="number"
                step="0.5"
                min="1"
                value={totalLiters}
                onChange={(e) => setTotalLiters(Number(e.target.value) || 0)}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Água de Mostura (L)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="1"
                    value={mashLiters}
                    onChange={(e) => setMashLiters(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Água de Lavagem (L)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    value={spargeLiters}
                    onChange={(e) => setSpargeLiters(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Volume Total (L)</Label>
                  <div className="h-10 px-3 py-2 rounded-md border border-input bg-muted/40 font-semibold text-foreground flex items-center">
                    {effectiveTotalL} L
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 border-t border-border pt-3">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Aplicação dos sais:</Label>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="splitMode"
                      checked={splitMode === "proportional"}
                      onChange={() => setSplitMode("proportional")}
                    />
                    <span>Proporcional (mesma concentração para toda a água)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="splitMode"
                      checked={splitMode === "custom"}
                      onChange={() => setSplitMode("custom")}
                    />
                    <span>Personalizado (gramas separadas por etapa)</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Profiles Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Source Water */}
        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">1. Água de Origem</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Selecionar perfil de origem ou preset</Label>
              <Select
                value={sourceName}
                onValueChange={(n) => {
                  setSourceName(n);
                  if (options[n]) setSource(options[n]);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(options).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {ions.map((i) => (
                <div key={i.id} className="space-y-1">
                  <Label className="text-xs text-muted-foreground font-mono">{i.label}</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={source[i.id]}
                    onChange={(e) => setSource({ ...source, [i.id]: Number(e.target.value) || 0 })}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Alcalinidade de origem: <b>{fmt(totalAlkalinity(source), 0)} ppm</b> CaCO₃ · Alcalinidade residual:{" "}
              <b>{fmt(residualAlkalinity(source), 0)} ppm</b>
            </p>
          </CardContent>
        </Card>

        {/* Target Profile & Optimizer Action */}
        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg">2. Perfil Desejado (Alvo)</CardTitle>
              <Button onClick={runOptimizer} className="shadow-sm">
                <Wand2 className="h-4 w-4 mr-2" /> Otimizar Sais
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Perfil cervejeiro de referência</Label>
              <Select
                value={targetName}
                onValueChange={(n) => {
                  setTargetName(n);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(options).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {ions.map((i) => (
                <div key={i.id} className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-xs text-muted-foreground font-mono">{i.symbol}</div>
                  <div className="text-lg font-bold">{fmt(target[i.id], 0)}</div>
                  <div className="text-[10px] text-muted-foreground">ppm</div>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Relação SO₄/Cl alvo: <b>{fmt(sulfateChlorideRatio(target), 2)}</b> — {ratioDescription(sulfateChlorideRatio(target))}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Optimizer Report / Warnings */}
      {optimizerReport && (
        <Alert className={optimizerReport.success ? "border-success/50 bg-success/10" : "border-warning/50 bg-warning/10"}>
          <div className="flex items-start gap-3">
            {optimizerReport.success ? (
              <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            )}
            <div className="space-y-1.5 flex-1">
              <AlertTitle className="text-sm font-semibold">
                {optimizerReport.success ? "Otimização Concluída com Sucesso" : "Otimização com Desvios Restantes"}
              </AlertTitle>
              <AlertDescription className="text-xs leading-relaxed space-y-1">
                <p>
                  Sais calculados para <b>{effectiveTotalL} L</b> de água.
                  {optimizerReport.warnings.length === 0 && " Todos os íons foram ajustados próximos aos alvos desejados."}
                </p>
                {optimizerReport.warnings.map((w, idx) => (
                  <p key={idx} className="text-foreground/90 font-medium">
                    ⚠️ {w}
                  </p>
                ))}
              </AlertDescription>
            </div>
          </div>
        </Alert>
      )}

      {/* Salts Addition Table */}
      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center justify-between">
            <span>3. Adições de Sais (g)</span>
            <span className="text-xs font-normal text-muted-foreground">
              {splitWater && splitMode === "custom" ? "Defina os sais para mostura e lavagem" : `Para volume total de ${effectiveTotalL} L`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {saltsCatalog.map((s) => {
              const totalG = activeAdditions[s.id] ?? 0;
              return (
                <div key={s.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">{s.name}</span>
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {s.chemicalFormula}
                      </span>
                      {s.insolubleInColdWater && (
                        <span className="text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded font-semibold">
                          Solubilidade Limitada
                        </span>
                      )}
                    </div>
                    {s.notes && <p className="text-xs text-muted-foreground mt-0.5">{s.notes}</p>}
                  </div>

                  {!splitWater || splitMode === "proportional" ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        className="w-28 text-right font-mono"
                        value={addTotal[s.id] ?? 0}
                        onChange={(e) => setAddTotal({ ...addTotal, [s.id]: Number(e.target.value) || 0 })}
                      />
                      <span className="text-xs text-muted-foreground w-4">g</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[11px] text-muted-foreground">Mostura:</Label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          className="w-20 text-right font-mono"
                          value={addMash[s.id] ?? 0}
                          onChange={(e) => setAddMash({ ...addMash, [s.id]: Number(e.target.value) || 0 })}
                        />
                        <span className="text-[10px] text-muted-foreground">g</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[11px] text-muted-foreground">Lavagem:</Label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          className="w-20 text-right font-mono"
                          value={addSparge[s.id] ?? 0}
                          onChange={(e) => setAddSparge({ ...addSparge, [s.id]: Number(e.target.value) || 0 })}
                        />
                        <span className="text-[10px] text-muted-foreground">g</span>
                      </div>
                      <div className="text-xs font-semibold text-muted-foreground w-16 text-right">
                        = {totalG} g
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Resultados Minerais e Estimativa de pH */}
      <Tabs defaultValue="results" className="space-y-4">
        <TabsList className="grid grid-cols-2 max-w-md">
          <TabsTrigger value="results" className="flex items-center gap-2">
            <Droplets className="h-4 w-4" /> Perfil Mineral Final
          </TabsTrigger>
          <TabsTrigger value="mashph" className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Estimativa de pH da Mostura
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Mineral Results */}
        <TabsContent value="results" className="space-y-4">
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Resultado Final dos Minerais (ppm)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                {ions.map((i) => {
                  const finalVal = result[i.id];
                  const targetVal = target[i.id];
                  const diff = finalVal - targetVal;
                  const absDiff = Math.abs(diff);
                  const statusClass =
                    absDiff <= Math.max(10, targetVal * 0.15)
                      ? "text-success border-success/30 bg-success/5"
                      : absDiff <= Math.max(25, targetVal * 0.35)
                        ? "text-warning border-warning/30 bg-warning/5"
                        : "text-destructive border-destructive/30 bg-destructive/5";

                  return (
                    <div key={i.id} className={`rounded-lg border p-3 ${statusClass}`}>
                      <div className="text-xs font-semibold text-muted-foreground font-mono">{i.label}</div>
                      <div className="text-2xl font-bold text-foreground my-1">{fmt(finalVal, 0)}</div>
                      <div className="text-[11px] font-medium">
                        alvo {fmt(targetVal, 0)} ({diff >= 0 ? "+" : ""}
                        {fmt(diff, 0)})
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-border pt-4 mt-5">
                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground font-semibold">RELAÇÃO SULFATO / CLORETO</div>
                  <div className="text-2xl font-bold text-primary my-1">{fmt(ratio, 2)}</div>
                  <div className="text-xs text-muted-foreground">{ratioDescription(ratio)}</div>
                </div>

                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground font-semibold">ALCALINIDADE TOTAL</div>
                  <div className="text-2xl font-bold text-foreground my-1">{fmt(alk, 0)} <span className="text-sm font-normal text-muted-foreground">ppm CaCO₃</span></div>
                  <div className="text-xs text-muted-foreground">Bicarbonato: {fmt(result.hco3, 0)} ppm</div>
                </div>

                <div className="rounded-md bg-muted/40 p-3">
                  <div className="text-xs text-muted-foreground font-semibold">ALCALINIDADE RESIDUAL (KOLBACH)</div>
                  <div className="text-2xl font-bold text-foreground my-1">{fmt(ra, 0)} <span className="text-sm font-normal text-muted-foreground">ppm CaCO₃</span></div>
                  <div className="text-xs text-muted-foreground">
                    {ra < 0 ? "Acidificante natural (ideal para cervejas claras)" : ra > 80 ? "Alta (exige ácido ou maltes torrados)" : "Moderada"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Mash pH Estimation */}
        <TabsContent value="mashph" className="space-y-4">
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Estimativa de pH da Mostura (Palmer & Troester)</span>
                <span className="text-xs font-normal text-muted-foreground">Faixa recomendada: 5,2 a 5,6</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
                {/* Inputs for grains and acids */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase">1. Carga de Grãos</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Malte Base (kg)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={baseMaltKg}
                        onChange={(e) => setBaseMaltKg(Number(e.target.value) || 0)}
                      />
                      <span className="text-[10px] text-muted-foreground">Pilsen/Pale (~2 °L)</span>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Malte Crystal/Caramelo (kg)</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        value={crystalMaltKg}
                        onChange={(e) => setCrystalMaltKg(Number(e.target.value) || 0)}
                      />
                      <span className="text-[10px] text-muted-foreground">Caramelo (~40 °L)</span>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Malte Torrado (kg)</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        value={roastedMaltKg}
                        onChange={(e) => setRoastedMaltKg(Number(e.target.value) || 0)}
                      />
                      <span className="text-[10px] text-muted-foreground">Chocolate/Black (~400 °L)</span>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Malte Acidificado (g)</Label>
                      <Input
                        type="number"
                        step="10"
                        min="0"
                        value={acidMaltGrams}
                        onChange={(e) => setAcidMaltGrams(Number(e.target.value) || 0)}
                      />
                      <span className="text-[10px] text-muted-foreground">Sauermalz (~2-3% ác. lático)</span>
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold text-muted-foreground uppercase pt-2">2. Acidificantes Líquidos</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Ácido Lático 85% (mL)</Label>
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        value={lacticAcidMl}
                        onChange={(e) => setLacticAcidMl(Number(e.target.value) || 0)}
                      />
                      <span className="text-[10px] text-muted-foreground">~11,3 mEq H⁺ por mL</span>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Ácido Fosfórico 75% (mL)</Label>
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        value={phosphoricAcidMl}
                        onChange={(e) => setPhosphoricAcidMl(Number(e.target.value) || 0)}
                      />
                      <span className="text-[10px] text-muted-foreground">Sabor neutro, ideal para lagers</span>
                    </div>
                  </div>
                </div>

                {/* pH Estimated Output Box */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-4 flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      pH ESTIMADO DA MOSTURA
                    </span>
                    <div className="text-4xl font-extrabold text-primary my-2 tabular-nums">
                      {fmt(mashPhEstimate.estimatedPh, 2)}
                    </div>
                    <div
                      className={`text-xs font-semibold px-2 py-1 rounded inline-block ${
                        mashPhEstimate.estimatedPh >= 5.2 && mashPhEstimate.estimatedPh <= 5.6
                          ? "bg-success/20 text-success"
                          : "bg-warning/20 text-warning"
                      }`}
                    >
                      {mashPhEstimate.estimatedPh >= 5.2 && mashPhEstimate.estimatedPh <= 5.6
                        ? "FAIXA IDEAL (5,2 - 5,6)"
                        : mashPhEstimate.estimatedPh < 5.2
                          ? "MUITO ÁCIDO (< 5,2)"
                          : "MUITO ALCALINO (> 5,6)"}
                    </div>

                    {/* Breakdown */}
                    <div className="space-y-1 text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
                      <div className="flex justify-between">
                        <span>pH base dos grãos:</span>
                        <span className="font-mono">{fmt(mashPhEstimate.baseMaltPh, 2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Efeito alcalinidade água:</span>
                        <span className="font-mono text-warning">+{fmt(mashPhEstimate.waterAlkalinityEffect, 2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Efeito cálcio/magnésio:</span>
                        <span className="font-mono text-success">{fmt(mashPhEstimate.calciumMagnesiumEffect, 2)}</span>
                      </div>
                      {mashPhEstimate.acidEffect < 0 && (
                        <div className="flex justify-between">
                          <span>Efeito dos ácidos adicionados:</span>
                          <span className="font-mono text-success">{fmt(mashPhEstimate.acidEffect, 2)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Measured pH Comparison */}
                  <div className="pt-3 border-t border-border space-y-1.5">
                    <Label className="text-xs text-muted-foreground">pH Real Medido no pHmetro:</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Ex: 5.35"
                        className="font-mono"
                        value={measuredPh}
                        onChange={(e) => setMeasuredPh(e.target.value)}
                      />
                      {measuredPh && !isNaN(Number(measuredPh)) && (
                        <span className="text-xs text-muted-foreground font-mono shrink-0">
                          Δ {Number(measuredPh) - mashPhEstimate.estimatedPh >= 0 ? "+" : ""}
                          {fmt(Number(measuredPh) - mashPhEstimate.estimatedPh, 2)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg border border-border">
                <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <p>
                  <b>Nota técnica:</b> O pH da mostura deve ser aferido à temperatura ambiente (~20 a 25 °C) cerca de 10 a 15 minutos após o início da arriada do malte. Amostras medidas quentes leem aproximadamente 0,2 a 0,3 unidades abaixo do valor real em temperatura ambiente.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
