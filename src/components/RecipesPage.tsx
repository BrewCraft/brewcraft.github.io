import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Plus, Search, Star, Trash2, List, LayoutGrid, Grid3X3, Download, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { recipeStats, srmToHex } from "@/lib/recipe-calc";
import { parseBeerXml, recipeToBeerXml } from "@/lib/beerxml";
import { exportRecipePdf } from "@/lib/pdf-export";
import { allStyles, fmt, money, uid, useRecipes } from "@/lib/store";
import CanecaLimpa from "@/components/CanecaLimpa";

export default function RecipesPage() {
  const navigate = useNavigate();
  const [recipes, save] = useRecipes();
  const fileRef = useRef<HTMLInputElement>(null);
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseBeerXml(text);
    if (!parsed) { alert("Arquivo BeerXML inválido"); return; }
    const newRecipe = { ...parsed, id: uid(), name: parsed.name || file.name.replace(".xml", "") } as any;
    save([...recipes, newRecipe]);
    e.target.value = "";
  };
  const exportRecipe = (r: any) => {
    const xml = recipeToBeerXml(r);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${r.name}.xml`; a.click();
    URL.revokeObjectURL(url);
  };
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"mine" | "library">("mine");
  const styles = allStyles();
  const list = (tab === "library" ? libraryRecipes : recipes)
    .filter(r => r.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  const duplicate = (id: string) => { const r = recipes.find(x => x.id === id); if (!r) return; save([...recipes, { ...structuredClone(r), id: uid(), name: `${r.name} (cópia)` }]); };
  const remove = (id: string) => { if (confirm("Excluir esta receita?")) save(recipes.filter(r => r.id !== id)); };
  const toggleFavorite = (id: string) => {
    save(recipes.map(r => r.id === id ? { ...r, favorite: !r.favorite, updatedAt: new Date().toISOString() } : r));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1" role="group" aria-label="Abas">
          <Button size="sm" variant={tab === "mine" ? "default" : "ghost"} onClick={() => setTab("mine")}>Minhas receitas</Button>
          <Button size="sm" variant={tab === "library" ? "default" : "ghost"} onClick={() => setTab("library")}>Receitas prontas</Button>
        </div>
        <div className="flex gap-2">
        <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Importar BeerXML</Button>
        <Button onClick={() => navigate("/recipes/new")} className="bg-gradient-primary text-primary-foreground shadow-brew"><Plus className="h-4 w-4 mr-2" />Nova Receita</Button>
      </div>
      <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={handleImport} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar receitas..." value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="inline-flex items-center gap-1" role="group" aria-label="Visualização das receitas">
          <Button size="sm" variant={view === "list" ? "default" : "ghost"} aria-pressed={view === "list"} onClick={() => setView("list")}><List />Lista</Button>
          <Button size="sm" variant={view === "large" ? "default" : "ghost"} aria-pressed={view === "large"} onClick={() => setView("large")}><LayoutGrid />Grande</Button>
          <Button size="sm" variant={view === "medium" ? "default" : "ghost"} aria-pressed={view === "medium"} onClick={() => setView("medium")}><Grid3X3 />Médio</Button>
        </div>
      </div>
      {list.length === 0 && <p className="text-muted-foreground">Nenhuma receita encontrada.</p>}
      <div className={view === "list" ? "divide-y divide-border border-y border-border" : view === "medium" ? "grid gap-4 md:grid-cols-3 xl:grid-cols-4" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"}>
        {list.map(r => {
          const s = recipeStats(r);
          const style = styles.find(x => x.code === r.styleCode);
          const actions = (
            <div className="flex shrink-0" onClick={e => e.stopPropagation()}>
              <Button variant="ghost" size="icon" aria-label={r.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} onClick={() => toggleFavorite(r.id)}><Star className={`h-4 w-4 ${r.favorite ? "fill-primary text-primary" : "text-muted-foreground"}`} /></Button>
              <Button variant="ghost" size="icon" aria-label="Exportar PDF" onClick={() => exportRecipePdf(r)}><FileUp className="h-4 w-4" /></Button>
              {tab === "library" ? (
                <Button variant="ghost" size="icon" aria-label="Copiar para minhas receitas" onClick={() => { save([...recipes, { ...structuredClone(r), id: uid(), name: r.name }]); toast.success("Receita copiada"); }}><Copy className="h-4 w-4" /></Button>
              ) : (
                <>
                  <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
                </>
              )}
            </div>
          );
          if (view === "list") return (
            <div key={r.id} className="flex flex-wrap items-center gap-4 py-4">
              <div className="min-w-0 flex-1 basis-48">
                <Button variant="link" className="h-auto max-w-full justify-start whitespace-normal px-0 text-left text-lg text-foreground" onClick={() => navigate(`/recipes/${r.id}`)}>{r.name}</Button>
                <p className="text-sm text-muted-foreground">{style?.name ?? "Sem estilo"}</p>
              </div>
              <dl className="grid flex-1 basis-72 grid-cols-5 gap-3 text-sm">
                {[["OG", fmt(s.og, 3)], ["FG", fmt(s.fg, 3)], ["ABV", `${fmt(s.abv)}%`], ["IBU", fmt(s.ibu, 0)], ["SRM", fmt(s.srm)]].map(([label, value]) => (
                  <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>
                ))}
              </dl>
              <div className="flex items-center gap-3 text-xs text-muted-foreground"><span>{fmt(r.equipment.batchL)} L</span><Badge variant="secondary">{money(s.cost.total)}</Badge></div>
              {actions}
            </div>
          );
          return (
            <div key={r.id}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0"><h2 className="text-lg font-semibold break-words">{r.name}</h2><p className="text-sm text-muted-foreground">{style?.name ?? "Sem estilo"}</p></div>
                {actions}
              </div>
              <Card className="shadow-card hover:shadow-brew transition-shadow cursor-pointer overflow-hidden p-2" onClick={() => navigate(`/recipes/${r.id}`)}>
                <CanecaLimpa
                  color={srmToHex(s.srm)}
                  metrics={{ og: fmt(s.og, 3), fg: fmt(s.fg, 3), abv: `${fmt(s.abv)}%`, ibu: fmt(s.ibu, 0), srm: fmt(s.srm) }}
                  className={view === "large" ? "mx-auto block w-[179.2px] max-w-full h-auto" : "mx-auto block w-[134.4px] max-w-full h-auto"}
                  role="img"
                  aria-label={`OG ${fmt(s.og, 3)}, FG ${fmt(s.fg, 3)}, ABV ${fmt(s.abv)}%, IBU ${fmt(s.ibu, 0)}, SRM ${fmt(s.srm)}`}
                />
                <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{fmt(r.equipment.batchL)} L</span><Badge variant="secondary">{money(s.cost.total)}</Badge></div>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
