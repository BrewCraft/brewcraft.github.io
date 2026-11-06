import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Plus, Search, Star, Trash2 } from "lucide-react";
import { recipeStats, srmToHex } from "@/lib/recipe-calc";
import { allStyles, fmt, money, uid, useRecipes } from "@/lib/store";
import CanecaLimpa from "@/components/CanecaLimpa";

export default function RecipesPage() {
  const navigate = useNavigate();
  const [recipes, save] = useRecipes();
  const [q, setQ] = useState("");
  const styles = allStyles();
  const list = [...recipes]
    .filter(r => r.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  const duplicate = (id: string) => { const r = recipes.find(x => x.id === id)!; save([...recipes, { ...structuredClone(r), id: uid(), name: `${r.name} (cópia)` }]); };
  const remove = (id: string) => { if (confirm("Excluir esta receita?")) save(recipes.filter(r => r.id !== id)); };
  const toggleFavorite = (id: string) => {
    save(recipes.map(r => r.id === id ? { ...r, favorite: !r.favorite, updatedAt: new Date().toISOString() } : r));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-3xl font-bold text-foreground">Receitas</h1><p className="text-muted-foreground">{recipes.length} receita(s)</p></div>
        <Button onClick={() => navigate("/recipes/new")} className="bg-gradient-primary text-primary-foreground shadow-brew"><Plus className="h-4 w-4 mr-2" />Nova Receita</Button>
      </div>
      <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar receitas..." value={q} onChange={e => setQ(e.target.value)} /></div>
      {list.length === 0 && <p className="text-muted-foreground">Nenhuma receita encontrada.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map(r => {
          const s = recipeStats(r);
          const style = styles.find(x => x.code === r.styleCode);
          return (
            <Card key={r.id} className="shadow-card hover:shadow-brew transition-shadow cursor-pointer" onClick={() => navigate(`/recipes/${r.id}`)}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <CanecaLimpa color={srmToHex(s.srm)} className="w-24 h-auto flex-shrink-0" />
                    <div><CardTitle className="text-lg">{r.name}</CardTitle><p className="text-sm text-muted-foreground">{style?.name ?? "Sem estilo"}</p></div>
                  </div>
                  <div className="flex" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" aria-label={r.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} onClick={() => toggleFavorite(r.id)}><Star className={`h-4 w-4 ${r.favorite ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} /></Button>
                    <Button variant="ghost" size="icon" aria-label="Duplicar" onClick={() => duplicate(r.id)}><Copy className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2 text-center text-sm">
                  <div><div className="font-bold">{fmt(s.og, 3)}</div><div className="text-xs text-muted-foreground">OG</div></div>
                  <div><div className="font-bold">{fmt(s.abv)}%</div><div className="text-xs text-muted-foreground">ABV</div></div>
                  <div><div className="font-bold">{fmt(s.ibu, 0)}</div><div className="text-xs text-muted-foreground">IBU</div></div>
                  <div><div className="font-bold">{fmt(s.srm)}</div><div className="text-xs text-muted-foreground">SRM</div></div>
                </div>
                <div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{fmt(r.equipment.batchL)} L</span><Badge variant="secondary">{money(s.cost.total)}</Badge></div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
