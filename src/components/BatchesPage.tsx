import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { batchAbv, batchStatuses } from "@/lib/recipe-calc";
import { useSettings } from "@/lib/settings";
import { fmt, uid, useBatches, useRecipes } from "@/lib/store";

export default function BatchesPage() {
  const [settings] = useSettings();
  const locale = settings.language || "pt-BR";
  const navigate = useNavigate();
  const [batches, saveBatches] = useBatches();
  const [recipes] = useRecipes();
  const [recipeId, setRecipeId] = useState("");
  const [filter, setFilter] = useState("todos");

  const create = () => {
    const r = recipes.find(x => x.id === recipeId);
    if (!r) { toast.error("Escolha uma receita."); return; }
    const number = batches.reduce((m, b) => Math.max(m, b.number), 0) + 1;
    const b = { id: uid(), number, name: r.name, recipeId: r.id, recipe: structuredClone(r), status: "planejamento" as const, brewDate: new Date().toISOString().slice(0, 10), measurements: [], notes: "", inventoryDeducted: false, createdAt: new Date().toISOString() };
    saveBatches([...batches, b]);
    navigate(`/batches/${b.id}`);
  };
  const list = [...batches].filter(b => filter === "todos" || b.status === filter).sort((a, b) => b.number - a.number);

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold text-foreground">Lotes</h1><p className="text-muted-foreground">Acompanhe cada brassagem do planejamento ao copo.</p></div>
      <Card className="shadow-card">
        <CardContent className="p-4 flex flex-wrap gap-2 items-center">
          <Select value={recipeId} onValueChange={setRecipeId}>
            <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Receita para o novo lote" /></SelectTrigger>
            <SelectContent>{recipes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={create} className="bg-gradient-primary text-primary-foreground shadow-brew"><Plus className="h-4 w-4 mr-2" />Novo Lote</Button>
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-2">
        {[{ id: "todos", label: "Todos" }, ...batchStatuses].map(s => (
          <Button key={s.id} size="sm" variant={filter === s.id ? "default" : "outline"} onClick={() => setFilter(s.id)}>{s.label} ({s.id === "todos" ? batches.length : batches.filter(b => b.status === s.id).length})</Button>
        ))}
      </div>
      {list.length === 0 && <p className="text-muted-foreground">Nenhum lote ainda. Crie um a partir de uma receita.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map(b => {
          const idx = batchStatuses.findIndex(s => s.id === b.status);
          const abv = batchAbv(b, settings);
          return (
            <Card key={b.id} className="shadow-card hover:shadow-brew cursor-pointer" onClick={() => navigate(`/batches/${b.id}`)}>
              <CardHeader className="pb-2"><div className="flex justify-between gap-2"><CardTitle className="text-lg">#{b.number} {b.name}</CardTitle><Badge>{batchStatuses[idx].label}</Badge></div>
                <p className="text-sm text-muted-foreground">Brassagem: {new Date(b.brewDate + "T12:00").toLocaleDateString(locale)}</p></CardHeader>
              <CardContent className="space-y-2">
                <Progress value={(idx / (batchStatuses.length - 1)) * 100} />
                <div className="flex justify-between text-sm text-muted-foreground"><span>{b.measurements.length} medição(ões)</span><span>{abv !== undefined ? `${fmt(abv, 1, locale)}% ABV` : "ABV —"}</span></div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
