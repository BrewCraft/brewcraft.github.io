import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, Pause, Play, RotateCcw, Trash2, PackageMinus } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { batchAbv, batchStatuses, boilSchedule, deductInventory, recipeStats, type Batch } from "@/lib/recipe-calc";
import { readSettings, useSettings } from "@/lib/settings";
import { fmt, uid, useBatches, useInventory } from "@/lib/store";

const mmss = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

function useTimer(totalSec: number) {
  const [left, setLeft] = useState(totalSec);
  const [running, setRunning] = useState(false);
  useEffect(() => { setLeft(totalSec); setRunning(false); }, [totalSec]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setLeft(l => (l <= 1 ? (setRunning(false), 0) : l - 1)), 1000);
    return () => clearInterval(t);
  }, [running]);
  return { left, running, toggle: () => setRunning(r => !r), reset: () => { setRunning(false); setLeft(totalSec); } };
}

function TimerControls({ t }: { t: ReturnType<typeof useTimer> }) {
  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={t.toggle}>{t.running ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}{t.running ? "Pausar" : "Iniciar"}</Button>
      <Button size="sm" variant="outline" onClick={t.reset} aria-label="Reiniciar"><RotateCcw className="h-4 w-4" /></Button>
    </div>
  );
}

function BrewDay({ b }: { b: Batch }) {
  const r = b.recipe;
  const [step, setStep] = useState(0);
  const mash = r.mashSteps[step];
  const mashT = useTimer((mash?.minutes ?? 0) * 60);
  const boilT = useTimer(r.equipment.boilMinutes * 60);
  const events = boilSchedule(r);
  const announced = useRef(new Set<number>());
  const boilMinLeft = boilT.left / 60;
  useEffect(() => {
    events.forEach((e, i) => {
      if (boilT.left !== r.equipment.boilMinutes * 60 && boilMinLeft <= e.minutes && !announced.current.has(i)) {
        announced.current.add(i); toast(`Adicionar: ${e.label}`, { description: `${e.minutes} min restantes` });
      }
    });
    if (boilT.left === r.equipment.boilMinutes * 60) announced.current.clear();
  }, [boilT.left]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mashT.left === 0 && mash) toast.success(`Passo "${mash.name}" concluído`); }, [mashT.left]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle>Dia de brassagem</CardTitle></CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="font-semibold">Mostura</h3>
          <div className="flex flex-wrap gap-2">{r.mashSteps.map((s, i) => <Button key={i} size="sm" variant={i === step ? "default" : "outline"} onClick={() => setStep(i)}>{s.name} · {s.tempC}°C</Button>)}</div>
          {mash ? <><div className="text-5xl font-mono font-bold text-primary">{mmss(mashT.left)}</div><p className="text-sm text-muted-foreground">{mash.name}: manter {mash.tempC}°C por {mash.minutes} min</p><TimerControls t={mashT} /></> : <p className="text-sm text-muted-foreground">Sem passos de mostura.</p>}
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold">Fervura</h3>
          <div className="text-5xl font-mono font-bold text-primary">{mmss(boilT.left)}</div>
          <TimerControls t={boilT} />
          <ul className="space-y-1 text-sm">
            {events.map((e, i) => {
              const done = boilT.left !== r.equipment.boilMinutes * 60 && boilMinLeft <= e.minutes;
              return <li key={i} className={`flex justify-between rounded px-2 py-1 ${done ? "bg-muted line-through text-muted-foreground" : ""}`}><span>{e.label}</span><span className="font-mono">{e.minutes} min</span></li>;
            })}
            {events.length === 0 && <li className="text-muted-foreground">Sem adições na fervura.</li>}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BatchDetailPage() {
  const [settings] = useSettings();
  const locale = settings.language || "pt-BR";
  const { id } = useParams();
  const navigate = useNavigate();
  const [batches, saveBatches] = useBatches();
  const [inventory, saveInventory] = useInventory();
  const b = batches.find(x => x.id === id);
  const [m, setM] = useState({ date: new Date().toISOString().slice(0, 16), sg: "", tempC: "", note: "" });
  if (!b) return <div className="py-12 text-center"><p className="text-muted-foreground">Lote não encontrado.</p><Link to="/batches" className="text-primary underline">Voltar aos lotes</Link></div>;

  const update = (patch: Partial<Batch>) => saveBatches(batches.map(x => (x.id === b.id ? { ...x, ...patch } : x)));
  const stats = recipeStats(b.recipe);
  const statusIdx = batchStatuses.findIndex(s => s.id === b.status);
  const deduct = () => {
    const allowNegative = readSettings().negativeStock === true;
    saveInventory(deductInventory(b.recipe, inventory, allowNegative));
    update({ inventoryDeducted: true });
    toast.success("Ingredientes descontados do inventário");
  };
  const setStatus = (s: Batch["status"]) => {
    update({ status: s });
    if (s === "brassagem" && !b.inventoryDeducted && confirm("Descontar os ingredientes do inventário agora?")) deduct();
  };
  const addMeasurement = () => {
    const sg = Number(m.sg.replace(",", ".")), tempC = Number(m.tempC.replace(",", "."));
    if (!(sg > 0.98 && sg < 1.2)) { toast.error("Informe uma densidade válida (ex: 1.012)."); return; }
    update({ measurements: [...b.measurements, { id: uid(), date: new Date(m.date).toISOString(), sg, tempC: Number.isFinite(tempC) ? tempC : 0, note: m.note }] });
    setM({ ...m, sg: "", note: "" });
  };
  const sorted = [...b.measurements].sort((a, c) => a.date.localeCompare(c.date));
  const chart = sorted.map(x => ({ data: new Date(x.date).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }), SG: x.sg, Temp: x.tempC }));
  const abv = batchAbv(b);
  const dryHops = b.recipe.hops.filter(h => h.use === "dryhop");
  const addDays = (d: number) => { const t = new Date(b.brewDate + "T12:00"); t.setDate(t.getDate() + d); return t.toLocaleDateString(locale); };
  const numOrUndef = (v: string) => (v === "" ? undefined : Number(v.replace(",", ".")));

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate("/batches")} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button>
          <div><h1 className="text-2xl sm:text-3xl font-bold text-foreground">Lote #{b.number} · {b.name}</h1>
            <Link to={`/recipes/${b.recipeId}`} className="text-sm text-primary underline">Ver receita original</Link></div>
        </div>
        <Button variant="outline" onClick={() => { if (confirm("Excluir este lote?")) { saveBatches(batches.filter(x => x.id !== b.id)); navigate("/batches"); } }}><Trash2 className="h-4 w-4 mr-2" />Excluir</Button>
      </div>

      <Card className="shadow-card"><CardContent className="p-4">
        <div className="flex flex-wrap gap-2">
          {batchStatuses.map((s, i) => (
            <Button key={s.id} size="sm" variant={i === statusIdx ? "default" : i < statusIdx ? "secondary" : "outline"} onClick={() => setStatus(s.id)}>
              {i < statusIdx && <Check className="h-3 w-3 mr-1" />}{s.label}
            </Button>
          ))}
        </div>
      </CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="shadow-card lg:col-span-2">
          <CardHeader><CardTitle>Dados do lote</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1 col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Data da brassagem</Label><Input type="date" value={b.brewDate} onChange={e => update({ brewDate: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">OG medida (prev. {fmt(stats.og, 3)})</Label><Input type="number" step="0.001" value={b.measuredOg ?? ""} onChange={e => update({ measuredOg: numOrUndef(e.target.value) })} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">FG medida (prev. {fmt(stats.fg, 3)})</Label><Input type="number" step="0.001" value={b.measuredFg ?? ""} onChange={e => update({ measuredFg: numOrUndef(e.target.value) })} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Volume final (L)</Label><Input type="number" step="0.1" value={b.measuredVolumeL ?? ""} onChange={e => update({ measuredVolumeL: numOrUndef(e.target.value) })} /></div>
            <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-4 text-sm">
              <span>ABV: <b>{abv !== undefined ? `${fmt(abv)}%` : "—"}</b></span>
              <span>IBU previsto: <b>{fmt(stats.ibu, 0)}</b></span>
              <span>Fermentação: <b>{b.recipe.fermentationTempC}°C por {b.recipe.fermentationDays} dias</b> (até {addDays(b.recipe.fermentationDays)})</span>
            </div>
            <div className="col-span-2 sm:col-span-4 space-y-1"><Label className="text-xs text-muted-foreground">Anotações</Label><Textarea value={b.notes} onChange={e => update({ notes: e.target.value })} /></div>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle>Inventário e agenda</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {b.inventoryDeducted ? <Badge className="bg-success text-success-foreground">Ingredientes já descontados</Badge> : <Button variant="outline" className="w-full" onClick={deduct}><PackageMinus className="h-4 w-4 mr-2" />Descontar do inventário</Button>}
            <ul className="space-y-1">
              <li>Brassagem: <b>{addDays(0)}</b></li>
              {dryHops.map(h => <li key={h.id}>Dry hop {h.grams} g {h.name}: <b>{addDays(h.dryHopDay ?? 3)}</b></li>)}
              <li>Fim da fermentação: <b>{addDays(b.recipe.fermentationDays)}</b></li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <BrewDay b={b} />

      <Card className="shadow-card">
        <CardHeader><CardTitle>Medições de fermentação</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr_2fr_auto] gap-2 items-end">
            <div className="space-y-1 col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Data e hora</Label><Input type="datetime-local" value={m.date} onChange={e => setM({ ...m, date: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Densidade (SG)</Label><Input type="number" step="0.001" placeholder="1.020" value={m.sg} onChange={e => setM({ ...m, sg: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Temp. (°C)</Label><Input type="number" step="0.1" value={m.tempC} onChange={e => setM({ ...m, tempC: e.target.value })} /></div>
            <div className="space-y-1 col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Nota</Label><Input value={m.note} onChange={e => setM({ ...m, note: e.target.value })} /></div>
            <Button onClick={addMeasurement} className="col-span-2 sm:col-span-1">Adicionar</Button>
          </div>
          {chart.length > 0 && (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="data" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis yAxisId="sg" domain={["auto", "auto"]} stroke="hsl(var(--primary))" fontSize={12} tickFormatter={v => Number(v).toFixed(3)} />
                  <YAxis yAxisId="t" orientation="right" stroke="hsl(var(--accent))" fontSize={12} />
                  <Tooltip />
                  <Line yAxisId="sg" type="monotone" dataKey="SG" stroke="hsl(var(--primary))" strokeWidth={2} />
                  <Line yAxisId="t" type="monotone" dataKey="Temp" stroke="hsl(var(--accent))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="divide-y divide-border text-sm">
            {sorted.map(x => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{new Date(x.date).toLocaleString(locale)}</span><span className="font-mono">{x.sg.toFixed(3)}</span><span>{x.tempC}°C</span><span className="text-muted-foreground flex-1">{x.note}</span>
                <Button variant="ghost" size="icon" aria-label="Remover medição" onClick={() => update({ measurements: b.measurements.filter(y => y.id !== x.id) })}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
