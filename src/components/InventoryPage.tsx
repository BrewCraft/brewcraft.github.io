import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Pencil, Plus, Trash2, X } from "lucide-react";
import { fermentables, hops, miscs, yeasts } from "@/lib/catalog";
import type { InventoryItem, InventoryKind } from "@/lib/recipe-calc";
import { fmt, money, uid, useInventory } from "@/lib/store";

const kinds: { id: InventoryKind; label: string; unit: string; priceLabel: string }[] = [
  { id: "fermentavel", label: "Fermentáveis", unit: "kg", priceLabel: "R$/kg" },
  { id: "lupulo", label: "Lúpulos", unit: "g", priceLabel: "R$/g" },
  { id: "levedura", label: "Leveduras", unit: "pacote", priceLabel: "R$/pacote" },
  { id: "outro", label: "Outros", unit: "un", priceLabel: "R$/un" },
];
const catalogFor = (k: InventoryKind) =>
  (k === "fermentavel" ? fermentables.map(f => ({ name: f.name, price: f.price, extra: { potential: f.potential, color: f.color } }))
  : k === "lupulo" ? hops.map(h => ({ name: h.name, price: h.price / 1000, extra: { alpha: h.alpha } }))
  : k === "levedura" ? yeasts.map(y => ({ name: y.name, price: y.price, extra: { attenuation: y.attenuation } }))
  : miscs.map(m => ({ name: m.name, price: m.price, extra: {} })))
  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

export default function InventoryPage() {
  const [items, save] = useInventory();
  const [kind, setKind] = useState<InventoryKind>("fermentavel");
  const [form, setForm] = useState<InventoryItem | null>(null);
  const def = kinds.find(k => k.id === kind)!;
  const list = items.filter(i => i.kind === kind).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const low = items.filter(i => i.amount <= i.minAmount);
  const total = items.reduce((s, i) => s + i.amount * i.price, 0);
  const blank = (): InventoryItem => ({ id: uid(), kind, name: "", amount: 0, unit: def.unit, price: 0, minAmount: 0 });
  const submit = () => {
    if (!form || !form.name.trim()) return;
    save(items.some(i => i.id === form.id) ? items.map(i => (i.id === form.id ? form : i)) : [...items, form]);
    setForm(null);
  };
  const num = (v: string) => Number(v.replace(",", ".")) || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-3xl font-bold text-foreground">Inventário</h1><p className="text-muted-foreground">{items.length} itens · valor em estoque {money(total)}</p></div>
        <Button onClick={() => setForm(blank())} className="bg-gradient-primary text-primary-foreground shadow-brew"><Plus className="h-4 w-4 mr-2" />Adicionar item</Button>
      </div>
      {low.length > 0 && (
        <Card className="border-destructive/50"><CardContent className="p-4 flex gap-3 items-start text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div><b>Estoque baixo:</b> {low.map(i => `${i.name} (${fmt(i.amount, 2)} ${i.unit})`).join(", ")}</div>
        </CardContent></Card>
      )}
      <Tabs value={kind} onValueChange={v => { setKind(v as InventoryKind); setForm(null); }}>
        <TabsList className="flex-wrap h-auto">{kinds.map(k => <TabsTrigger key={k.id} value={k.id}>{k.label} ({items.filter(i => i.kind === k.id).length})</TabsTrigger>)}</TabsList>
      </Tabs>

      {form && (
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0"><CardTitle>{items.some(i => i.id === form.id) ? "Editar item" : `Novo item · ${def.label}`}</CardTitle><Button variant="ghost" size="icon" aria-label="Fechar" onClick={() => setForm(null)}><X className="h-4 w-4" /></Button></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-5 items-end">
            <div className="space-y-1 sm:col-span-2"><Label>Do catálogo</Label>
              <Select value="" onValueChange={n => { const c = catalogFor(form.kind).find(x => x.name === n); if (c) setForm({ ...form, name: c.name, price: c.price, ...c.extra }); }}>
                <SelectTrigger><SelectValue placeholder="Escolher do catálogo" /></SelectTrigger>
                <SelectContent>{catalogFor(form.kind).map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1 sm:col-span-3"><Label>Nome</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Quantidade ({form.unit})</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: num(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Mínimo ({form.unit})</Label><Input type="number" step="0.01" value={form.minAmount} onChange={e => setForm({ ...form, minAmount: num(e.target.value) })} /></div>
            <div className="space-y-1"><Label>{def.priceLabel}</Label><Input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: num(e.target.value) })} /></div>
            {form.kind === "lupulo" && (() => { const h = hops.find(x => x.name === form.name); return h ? (
              <div className="sm:col-span-5 rounded-md border border-border bg-muted/40 p-3 space-y-1 text-xs text-muted-foreground">
                <div><b className="text-foreground">Uso:</b> {h.usage} · {h.origin} · {h.alpha}% AA</div>
                <div><b className="text-foreground">Perfil:</b> {h.profile}</div>
                <div><b className="text-foreground">Substitutos:</b> {h.substitutes.join(", ")}</div>
                <div><b className="text-foreground">História:</b> {h.history}</div>
              </div>
            ) : null; })()}
            <Button onClick={submit} className="sm:col-span-2">Salvar</Button>
          </CardContent>
        </Card>
      )}

      {list.length === 0 && <p className="text-muted-foreground">Nenhum item nesta categoria.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map(i => {
          const hopInfo = i.kind === "lupulo" ? hops.find(h => h.name === i.name) : undefined;
          return (
          <Card key={i.id} className="shadow-card"><CardContent className="p-4 flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{i.name}</div>
              <div className="text-sm text-muted-foreground">{fmt(i.amount, 2)} {i.unit} · {money(i.amount * i.price)}{i.alpha ? ` · ${i.alpha}% AA` : ""}{i.color !== undefined ? ` · ${i.color}°L` : ""}</div>
              {i.amount <= i.minAmount && <Badge variant="destructive" className="mt-1">Estoque baixo</Badge>}
              {hopInfo && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div><b className="text-foreground">Uso:</b> {hopInfo.usage} · {hopInfo.origin}</div>
                  <div><b className="text-foreground">Perfil:</b> {hopInfo.profile}</div>
                  <div><b className="text-foreground">Substitutos:</b> {hopInfo.substitutes.join(", ")}</div>
                  <div><b className="text-foreground">História:</b> {hopInfo.history}</div>
                </div>
              )}
            </div>
            <div className="flex">
              <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setForm(i)}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => save(items.filter(x => x.id !== i.id))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </CardContent></Card>
          );
        })}
      </div>
    </div>
  );
}
