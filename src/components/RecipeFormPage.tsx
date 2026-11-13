import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Beaker, Plus, Save, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fermentables as catFerm, hops as catHops, yeasts as catYeasts, miscs as catMiscs } from "@/lib/catalog";
import { defaultEquipment, recipeStats, shoppingList, srmToHex, styleCheck, type HopUse, type Recipe } from "@/lib/recipe-calc";
import { allStyles, fmt, money, profileNumber as pn, readProfiles, uid, useBatches, useInventory, useRecipes } from "@/lib/store";

const emptyRecipe = (): Recipe => {
  const t = new Date().toISOString();
  return { id: uid(), name: "", styleCode: "18B", author: "", notes: "", equipment: { ...defaultEquipment }, mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }], fermentationTempC: 19, fermentationDays: 14, fermentables: [], hops: [], yeasts: [], miscs: [], createdAt: t, updatedAt: t };
};
const numIn = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const hopUses: { id: HopUse; label: string }[] = [{ id: "fervura", label: "Fervura" }, { id: "primeiro_mosto", label: "1º mosto" }, { id: "whirlpool", label: "Whirlpool" }, { id: "dryhop", label: "Dry hop" }];

function NumField({ label, value, onChange, step = "0.1" }: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label><Input type="number" step={step} value={value} onChange={e => onChange(numIn(e.target.value))} /></div>;
}

function CatalogPicker<T extends { name: string }>({ items, placeholder, onPick, describe }: { items: T[]; placeholder: string; onPick: (i: T) => void; describe: (i: T) => string }) {
  return (
    <Select value="" onValueChange={v => { const i = items.find(x => x.name === v); if (i) onPick(i); }}>
      <SelectTrigger className="w-full sm:w-64"><Plus className="h-4 w-4 mr-1" /><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{items.map(i => <SelectItem key={i.name} value={i.name}>{i.name} <span className="text-muted-foreground">· {describe(i)}</span></SelectItem>)}</SelectContent>
    </Select>
  );
}

const statusTone = (s: "baixo" | "ok" | "alto") => (s === "ok" ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground");

export default function RecipeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipes, saveRecipes] = useRecipes();
  const [batches, saveBatches] = useBatches();
  const [inventory] = useInventory();
  const existing = recipes.find(r => r.id === id);
  const [r, setR] = useState<Recipe>(() => existing ? structuredClone(existing) : emptyRecipe());
  const [showShopping, setShowShopping] = useState(false);
  const styles = useMemo(() => allStyles(), []);
  const style = styles.find(s => s.code === r.styleCode);
  const stats = recipeStats(r);
  const check = style ? styleCheck(stats, style) : undefined;
  const set = (patch: Partial<Recipe>) => setR(prev => ({ ...prev, ...patch }));
  const setEq = (k: keyof Recipe["equipment"], v: number) => setR(p => ({ ...p, equipment: { ...p.equipment, [k]: v } }));
  function updateList<K extends "fermentables" | "hops" | "yeasts" | "miscs">(key: K, idx: number, patch: Partial<Recipe[K][number]>) {
    setR(p => ({ ...p, [key]: p[key].map((x, i) => (i === idx ? { ...x, ...patch } : x)) }));
  }
  const removeFrom = (key: "fermentables" | "hops" | "yeasts" | "miscs", idx: number) => setR(p => ({ ...p, [key]: (p[key] as unknown[]).filter((_, i) => i !== idx) }));

  const equipmentProfiles = readProfiles("equipamento"), mashProfiles = readProfiles("mostura"), fermProfiles = readProfiles("fermentacao"), waterProfiles = readProfiles("agua");
  const applyEquipment = (pid: string) => {
    const p = equipmentProfiles.find(x => x.id === pid); if (!p) return;
    const v = p.values, batchL = pn(v.volumeLote, r.equipment.batchL), boil = pn(v.volumeFervura, 0);
    const evapPct = pn(v.evaporacao, 0);
    set({ equipmentProfileId: pid, equipment: { ...r.equipment, batchL, trubLossL: pn(v.perdasTrub, r.equipment.trubLossL), fermenterLossL: pn(v.perdasFermentador, r.equipment.fermenterLossL), efficiency: pn(v.eficiencia, r.equipment.efficiency), evaporationLh: evapPct && boil ? boil * evapPct / 100 : r.equipment.evaporationLh } });
  };
  const applyMash = (pid: string) => {
    const p = mashProfiles.find(x => x.id === pid); if (!p) return;
    set({ mashProfileId: pid, mashSteps: [{ name: p.values.tipo || p.name, tempC: pn(p.values.tempAlvo, 66), minutes: pn(p.values.tempoTotal, 60) }] });
  };
  const applyFerm = (pid: string) => {
    const p = fermProfiles.find(x => x.id === pid); if (!p) return;
    const min = pn(p.values.tempMin, 18), max = pn(p.values.tempMax, min);
    set({ fermentationProfileId: pid, fermentationTempC: (min + max) / 2, fermentationDays: pn(p.values.duracao, r.fermentationDays) });
  };

  const save = (silent = false) => {
    if (!r.name.trim()) { toast.error("Dê um nome à receita."); return false; }
    const next = { ...r, updatedAt: new Date().toISOString() };
    saveRecipes(recipes.some(x => x.id === r.id) ? recipes.map(x => (x.id === r.id ? next : x)) : [...recipes, next]);
    if (!silent) { toast.success("Receita salva"); navigate("/recipes"); }
    return true;
  };
  const createBatch = () => {
    if (!save(true)) return;
    const number = batches.reduce((m, b) => Math.max(m, b.number), 0) + 1;
    const b = { id: uid(), number, name: r.name, recipeId: r.id, recipe: structuredClone(r), status: "planejamento" as const, brewDate: new Date().toISOString().slice(0, 10), measurements: [], notes: "", inventoryDeducted: false, createdAt: new Date().toISOString() };
    saveBatches([...batches, b]);
    toast.success(`Lote #${number} criado`);
    navigate(`/batches/${b.id}`);
  };
  const shopping = shoppingList(r, inventory);

  const Stat = ({ label, value, k }: { label: string; value: string; k?: keyof NonNullable<typeof check> }) => (
    <div className="rounded-md bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold text-foreground">{value}</div>
      {check && k && style && <Badge className={`mt-1 text-[10px] ${statusTone(check[k])}`}>{check[k] === "ok" ? "no estilo" : check[k]}</Badge>}
    </div>
  );

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate("/recipes")} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{existing ? "Editar Receita" : "Nova Receita"}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowShopping(s => !s)}><ShoppingCart className="h-4 w-4 mr-2" />Lista de compras</Button>
          <Button variant="outline" onClick={createBatch}><Beaker className="h-4 w-4 mr-2" />Criar lote</Button>
          <Button onClick={() => save()} className="bg-gradient-primary text-primary-foreground shadow-brew"><Save className="h-4 w-4 mr-2" />Salvar</Button>
        </div>
      </div>

      <Card className="shadow-card sticky top-16 z-10">
        <CardContent className="p-4 grid grid-cols-3 sm:grid-cols-7 gap-2">
          <Stat label="OG" value={fmt(stats.og, 3)} k="og" />
          <Stat label="FG" value={fmt(stats.fg, 3)} k="fg" />
          <Stat label="ABV" value={`${fmt(stats.abv)}%`} k="abv" />
          <Stat label="IBU" value={fmt(stats.ibu, 0)} k="ibu" />
          <div className="rounded-md bg-muted/50 p-3 flex items-center gap-2">
            <div className="h-8 w-8 rounded-full border border-border" style={{ background: srmToHex(stats.srm) }} />
            <div><div className="text-xs text-muted-foreground">SRM</div><div className="text-lg font-bold">{fmt(stats.srm)}</div>{check && <Badge className={`text-[10px] ${statusTone(check.srm)}`}>{check.srm === "ok" ? "no estilo" : check.srm}</Badge>}</div>
          </div>
          <Stat label="Custo" value={money(stats.cost.total)} />
          <Stat label="R$/litro" value={money(stats.costPerLiter)} />
        </CardContent>
      </Card>

      {showShopping && (
        <Card className="shadow-card">
          <CardHeader><CardTitle>Lista de compras</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {shopping.length === 0 && <p className="text-muted-foreground text-sm">Adicione ingredientes à receita.</p>}
            {shopping.map(s => (
              <div key={s.kind + s.name} className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-sm">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">precisa {fmt(s.amount, 2)} {s.unit} · tem {fmt(s.have, 2)}</span>
                <span className={s.missing > 0 ? "text-destructive font-semibold" : "text-success font-semibold"}>{s.missing > 0 ? `comprar ${fmt(s.missing, 2)} ${s.unit} (${money(s.cost)})` : "ok"}</span>
              </div>
            ))}
            <p className="text-sm font-semibold pt-2">Total a comprar: {money(shopping.reduce((a, s) => a + s.cost, 0))}</p>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardHeader><CardTitle>Informações</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label>Nome</Label><Input value={r.name} onChange={e => set({ name: e.target.value })} placeholder="Ex: IPA Tropical" /></div>
          <div className="space-y-1"><Label>Estilo</Label>
            <Select value={r.styleCode} onValueChange={v => set({ styleCode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{styles.map(s => <SelectItem key={s.code} value={s.code}>{s.code.startsWith("custom") ? "" : `${s.code} · `}{s.name}</SelectItem>)}</SelectContent>
            </Select>
            {style && <p className="text-xs text-muted-foreground">OG {style.og.map(x => fmt(x, 3)).join("–")} · IBU {style.ibu.map(x => fmt(x, 0)).join("–")} · SRM {style.srm.map(x => fmt(x, 0)).join("–")} · ABV {style.abv.map(x => fmt(x)).join("–")}%</p>}
          </div>
          <div className="space-y-1"><Label>Autor</Label><Input value={r.author} onChange={e => set({ author: e.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Notas</Label><Textarea value={r.notes} onChange={e => set({ notes: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle>Equipamento e volumes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ProfileSelect label="Perfil de equipamento" value={r.equipmentProfileId} profiles={equipmentProfiles} onChange={applyEquipment} />
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <NumField label="Volume do lote (L)" value={r.equipment.batchL} onChange={v => setEq("batchL", v)} />
            <NumField label="Fervura (min)" value={r.equipment.boilMinutes} onChange={v => setEq("boilMinutes", v)} step="1" />
            <NumField label="Evaporação (L/h)" value={r.equipment.evaporationLh} onChange={v => setEq("evaporationLh", v)} />
            <NumField label="Perda trub (L)" value={r.equipment.trubLossL} onChange={v => setEq("trubLossL", v)} />
            <NumField label="Perda fermentador (L)" value={r.equipment.fermenterLossL} onChange={v => setEq("fermenterLossL", v)} />
            <NumField label="Eficiência (%)" value={r.equipment.efficiency} onChange={v => setEq("efficiency", v)} step="1" />
          </div>
          <p className="text-sm text-muted-foreground">Pré-fervura {fmt(stats.volumes.preBoil)} L · pós-fervura {fmt(stats.volumes.postBoil)} L · envase {fmt(stats.volumes.packaged)} L · {fmt(stats.grainKg, 2)} kg de fermentáveis</p>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><CardTitle>Fermentáveis</CardTitle>
          <CatalogPicker items={catFerm} placeholder="Adicionar fermentável" describe={i => `${i.color}°L`} onPick={i => set({ fermentables: [...r.fermentables, { id: uid(), name: i.name, kg: 1, potential: i.potential, color: i.color, type: i.type, price: i.price }] })} />
        </CardHeader>
        <CardContent className="space-y-3">
          {r.fermentables.length === 0 && <p className="text-sm text-muted-foreground">Nenhum fermentável.</p>}
          {r.fermentables.map((f, i) => (
            <div key={f.id} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 items-end border-b border-border pb-3">
              <div className="col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Nome</Label><Input value={f.name} onChange={e => updateList("fermentables", i, { name: e.target.value })} /><span className="text-xs text-muted-foreground">{stats.grainKg ? fmt(f.kg / stats.grainKg * 100, 0) : 0}%</span></div>
              <NumField label="kg" value={f.kg} step="0.01" onChange={v => updateList("fermentables", i, { kg: v })} />
              <NumField label="Cor (°L)" value={f.color} onChange={v => updateList("fermentables", i, { color: v })} />
              <NumField label="Potencial (SG)" value={f.potential} step="0.001" onChange={v => updateList("fermentables", i, { potential: v })} />
              <NumField label="R$/kg" value={f.price} onChange={v => updateList("fermentables", i, { price: v })} />
              <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => removeFrom("fermentables", i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><CardTitle>Lúpulos</CardTitle>
          <CatalogPicker items={catHops} placeholder="Adicionar lúpulo" describe={i => `${i.alpha}% AA`} onPick={i => set({ hops: [...r.hops, { id: uid(), name: i.name, grams: 20, alpha: i.alpha, minutes: 60, use: "fervura", price: i.price }] })} />
        </CardHeader>
        <CardContent className="space-y-3">
          {r.hops.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lúpulo.</p>}
          {r.hops.map((h, i) => {
            const cat = catHops.find(c => c.name === h.name);
            return (
            <div key={h.id} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1.2fr_1fr_1fr_auto] gap-2 items-end border-b border-border pb-3">
              <div className="col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Nome</Label><Input value={h.name} onChange={e => updateList("hops", i, { name: e.target.value })} /></div>
              <NumField label="g" value={h.grams} step="1" onChange={v => updateList("hops", i, { grams: v })} />
              <NumField label="Alfa (%)" value={h.alpha} onChange={v => updateList("hops", i, { alpha: v })} />
              <div><Label className="text-xs text-muted-foreground">Uso</Label>
                <Select value={h.use} onValueChange={v => updateList("hops", i, { use: v as HopUse })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{hopUses.map(u => <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>)}</SelectContent></Select>
              </div>
              {h.use === "dryhop"
                ? <NumField label="Dia" value={h.dryHopDay ?? 3} step="1" onChange={v => updateList("hops", i, { dryHopDay: v })} />
                : <NumField label="Minutos" value={h.minutes} step="1" onChange={v => updateList("hops", i, { minutes: v })} />}
              <NumField label="R$/kg" value={h.price} onChange={v => updateList("hops", i, { price: v })} />
              <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => removeFrom("hops", i)}><Trash2 className="h-4 w-4" /></Button>
              {cat && (
                <div className="col-span-2 sm:col-span-full text-xs text-muted-foreground">
                  <b className="text-foreground">Substitutos:</b> {cat.substitutes.join(", ")} · <b className="text-foreground">Perfil:</b> {cat.profile}
                </div>
              )}
            </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><CardTitle>Leveduras</CardTitle>
            <CatalogPicker items={catYeasts} placeholder="Adicionar levedura" describe={i => `${i.lab} · ${i.attenuation}%`} onPick={i => set({ yeasts: [...r.yeasts, { id: uid(), name: i.name, attenuation: i.attenuation, packs: 1, price: i.price }] })} />
          </CardHeader>
          <CardContent className="space-y-3">
            {r.yeasts.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma levedura (atenuação padrão de 75%).</p>}
            {r.yeasts.map((y, i) => (
              <div key={y.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs text-muted-foreground">Nome</Label><Input value={y.name} onChange={e => updateList("yeasts", i, { name: e.target.value })} /></div>
                <NumField label="Aten. %" value={y.attenuation} step="1" onChange={v => updateList("yeasts", i, { attenuation: v })} />
                <NumField label="Pacotes" value={y.packs} step="1" onChange={v => updateList("yeasts", i, { packs: v })} />
                <NumField label="R$/pct" value={y.price} onChange={v => updateList("yeasts", i, { price: v })} />
                <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => removeFrom("yeasts", i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><CardTitle>Outros</CardTitle>
            <CatalogPicker items={catMiscs} placeholder="Adicionar item" describe={i => i.use} onPick={i => set({ miscs: [...r.miscs, { id: uid(), name: i.name, amount: 1, unit: i.price < 1 ? "g" : "un", use: i.use, price: i.price }] })} />
          </CardHeader>
          <CardContent className="space-y-3">
            {r.miscs.length === 0 && <p className="text-sm text-muted-foreground">Nenhum item.</p>}
            {r.miscs.map((m, i) => (
              <div key={m.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs text-muted-foreground">Nome</Label><Input value={m.name} onChange={e => updateList("miscs", i, { name: e.target.value })} /></div>
                <NumField label={`Qtd (${m.unit})`} value={m.amount} onChange={v => updateList("miscs", i, { amount: v })} />
                <div><Label className="text-xs text-muted-foreground">Uso</Label><Input value={m.use} onChange={e => updateList("miscs", i, { use: e.target.value })} /></div>
                <NumField label="R$/un" value={m.price} onChange={v => updateList("miscs", i, { price: v })} />
                <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => removeFrom("miscs", i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader><CardTitle>Mostura</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ProfileSelect label="Perfil de mostura" value={r.mashProfileId} profiles={mashProfiles} onChange={applyMash} />
            {r.mashSteps.map((s, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs text-muted-foreground">Passo</Label><Input value={s.name} onChange={e => set({ mashSteps: r.mashSteps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></div>
                <NumField label="°C" value={s.tempC} onChange={v => set({ mashSteps: r.mashSteps.map((x, j) => (j === i ? { ...x, tempC: v } : x)) })} />
                <NumField label="min" value={s.minutes} step="1" onChange={v => set({ mashSteps: r.mashSteps.map((x, j) => (j === i ? { ...x, minutes: v } : x)) })} />
                <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => set({ mashSteps: r.mashSteps.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set({ mashSteps: [...r.mashSteps, { name: "Novo passo", tempC: 72, minutes: 15 }] })}><Plus className="h-4 w-4 mr-1" />Passo</Button>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle>Fermentação e água</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ProfileSelect label="Perfil de fermentação" value={r.fermentationProfileId} profiles={fermProfiles} onChange={applyFerm} />
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Temperatura (°C)" value={r.fermentationTempC} onChange={v => set({ fermentationTempC: v })} />
              <NumField label="Duração (dias)" value={r.fermentationDays} step="1" onChange={v => set({ fermentationDays: v })} />
            </div>
            <ProfileSelect label="Perfil de água" value={r.waterProfileId} profiles={waterProfiles} onChange={v => set({ waterProfileId: v })} />
            {r.waterProfileId && <Button variant="link" className="px-0" onClick={() => navigate(`/water?profile=${r.waterProfileId}&liters=${fmt(stats.volumes.preBoil, 0)}`)}>Ajustar sais para este perfil →</Button>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProfileSelect({ label, value, profiles, onChange }: { label: string; value?: string; profiles: { id: string; name: string }[]; onChange: (id: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {profiles.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum perfil salvo em Perfis.</p> : (
        <Select value={value ?? ""} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Escolher perfil" /></SelectTrigger>
          <SelectContent>{profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
      )}
    </div>
  );
}
