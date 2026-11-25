import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Copy, Eye, Plus, Search, Star, Trash2, List, LayoutGrid,
  Grid3X3, Download, FileUp, Upload, X, Filter,
} from "lucide-react";
import { toast } from "sonner";
import { cloneRecipeForUser, recipeStats, srmToHex, defaultEquipment, type Recipe } from "@/lib/recipe-calc";
import { parseBeerXmlAll, recipeToBeerXml } from "@/lib/beerxml";
import { exportRecipePdf } from "@/lib/pdf-export";
import { libraryRecipes, libraryCategories, type LibraryCategory, type LibraryRecipe } from "@/lib/recipe-library";
import { allStyles, fmt, money, uid, useRecipes } from "@/lib/store";
import CanecaLimpa from "@/components/CanecaLimpa";

// ── Preview Modal para receitas da biblioteca ─────────────────────────────────
function LibraryPreviewModal({
  recipe,
  onClose,
  onCopy,
}: {
  recipe: LibraryRecipe;
  onClose: () => void;
  onCopy: () => void;
}) {
  const s = recipeStats(recipe);
  const styles = allStyles();
  const style = styles.find((x) => x.code === recipe.styleCode);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-xl">{recipe.name}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {style?.name ?? recipe.styleCode} · {recipe.category}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{recipe.description}</p>
          {recipe.notes && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <span className="font-semibold">Notas do mestre: </span>{recipe.notes}
            </div>
          )}

          {/* Métricas */}
          <div className="grid grid-cols-5 gap-2 text-center">
            {[
              ["OG", fmt(s.og, 3)],
              ["FG", fmt(s.fg, 3)],
              ["ABV", `${fmt(s.abv)}%`],
              ["IBU", fmt(s.ibu, 0)],
              ["SRM", fmt(s.srm)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted p-2">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-bold">{value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-semibold mb-1">Fermentáveis</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {recipe.fermentables.map((f) => (
                  <li key={f.id}>{f.kg} kg {f.name}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold mb-1">Lúpulos</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {recipe.hops.map((h) => (
                  <li key={h.id}>
                    {h.grams} g {h.name}
                    {h.use === "dryhop" ? " (dry hop)" : h.use === "whirlpool" ? " (whirlpool)" : ` ${h.minutes} min`}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold mb-1">Leveduras</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {recipe.yeasts.map((y) => (
                  <li key={y.id}>{y.name} ({y.attenuation}%)</li>
                ))}
              </ul>
            </div>
            {recipe.miscs.length > 0 && (
              <div>
                <p className="font-semibold mb-1">Outros ingredientes</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {recipe.miscs.map((m) => (
                    <li key={m.id}>{m.amount} {m.unit} {m.name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="text-sm grid grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground">Volume: </span>
              <span className="font-medium">{recipe.equipment.batchL} L</span>
            </div>
            <div>
              <span className="text-muted-foreground">Dificuldade: </span>
              <span className="font-medium">{recipe.difficulty}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Fermentação: </span>
              <span className="font-medium">{recipe.fermentationTempC}°C por {recipe.fermentationDays} dias</span>
            </div>
            <div>
              <span className="text-muted-foreground">Custo estimado: </span>
              <span className="font-medium">{money(recipeStats(recipe).cost.total)}</span>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button className="flex-1 bg-gradient-primary text-primary-foreground" onClick={onCopy}>
              <Copy className="h-4 w-4 mr-2" />Copiar para Minhas Receitas
            </Button>
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function RecipesPage() {
  const navigate = useNavigate();
  const [recipes, save] = useRecipes();
  const [view, setView] = useState<"list" | "large" | "medium">("large");
  const [tab, setTab] = useState<"mine" | "library">("mine");
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<LibraryCategory | "">("");
  const [styleFilter, setStyleFilter] = useState("");
  const [previewRecipe, setPreviewRecipe] = useState<LibraryRecipe | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const styles = allStyles();

  // Importar BeerXML
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsedList = parseBeerXmlAll(text);
    e.target.value = "";
    if (parsedList.length === 0) {
      toast.error("Arquivo BeerXML inválido ou corrompido");
      return;
    }
    const baseName = file.name.replace(/\.xml$/i, "");
    const imported: Recipe[] = parsedList.map((parsed, idx) => ({
      id: uid(),
      name: parsed.name || (parsedList.length > 1 ? `${baseName} #${idx + 1}` : baseName),
      styleCode: parsed.styleCode || "",
      author: parsed.author || "",
      notes: parsed.notes || "",
      equipment: parsed.equipment || { ...defaultEquipment },
      mashSteps: parsed.mashSteps && parsed.mashSteps.length > 0 ? parsed.mashSteps : [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
      fermentationTempC: parsed.fermentationTempC ?? 19,
      fermentationDays: parsed.fermentationDays ?? 14,
      fermentables: parsed.fermentables || [],
      hops: parsed.hops || [],
      yeasts: parsed.yeasts || [],
      miscs: parsed.miscs || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1.0",
      versionHistory: [],
    }));
    save([...recipes, ...imported]);
    toast.success(imported.length === 1
      ? `Receita "${imported[0].name}" importada com sucesso`
      : `${imported.length} receitas importadas com sucesso`
    );
  };

  // Exportar BeerXML
  const exportRecipe = (r: Recipe) => {
    const xml = recipeToBeerXml(r);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.name}.xml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportado BeerXML de "${r.name}"`);
  };

  // Copiar da biblioteca para Minhas Receitas
  const copyLibraryRecipe = (r: LibraryRecipe) => {
    const copied = cloneRecipeForUser(r, uid);
    // Remover propriedades exclusivas de LibraryRecipe que não existem em Recipe
    const { category: _cat, difficulty: _diff, description: _desc, ...baseRecipe } = copied as LibraryRecipe;
    save([...recipes, { ...baseRecipe }]);
    toast.success(`Receita "${r.name}" copiada para Minhas Receitas`);
    setPreviewRecipe(null);
  };

  // Duplicar receita própria
  const duplicate = (id: string) => {
    const r = recipes.find(x => x.id === id);
    if (!r) return;
    save([...recipes, { ...structuredClone(r), id: uid(), name: `${r.name} (cópia)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
  };
  const remove = (id: string) => { if (confirm("Excluir esta receita?")) save(recipes.filter(r => r.id !== id)); };
  const toggleFavorite = (id: string) => {
    save(recipes.map(r => r.id === id ? { ...r, favorite: !r.favorite, updatedAt: new Date().toISOString() } : r));
  };

  // Filtros
  const baseList = tab === "library" ? libraryRecipes : recipes;
  const list = baseList
    .filter(r => r.name.toLowerCase().includes(q.toLowerCase()))
    .filter(r => !styleFilter || r.styleCode === styleFilter)
    .filter(r => {
      if (!categoryFilter || tab !== "library") return true;
      return (r as LibraryRecipe).category === categoryFilter;
    })
    .sort((a, b) =>
      Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
      a.name.localeCompare(b.name, "pt-BR") ||
      a.id.localeCompare(b.id)
    );

  const hasFilters = q !== "" || styleFilter !== "" || categoryFilter !== "";
  const clearFilters = () => { setQ(""); setStyleFilter(""); setCategoryFilter(""); };

  // Estilos presentes nas receitas atuais (para o filtro de estilo)
  const presentStyleCodes = [...new Set(baseList.map(r => r.styleCode).filter(Boolean))];
  const presentStyles = styles.filter(s => presentStyleCodes.includes(s.code));

  return (
    <div className="space-y-6">
      {/* Preview modal */}
      {previewRecipe && (
        <LibraryPreviewModal
          recipe={previewRecipe}
          onClose={() => setPreviewRecipe(null)}
          onCopy={() => copyLibraryRecipe(previewRecipe)}
        />
      )}

      {/* Cabeçalho / abas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1" role="group" aria-label="Abas">
          <Button size="sm" variant={tab === "mine" ? "default" : "ghost"} onClick={() => { setTab("mine"); clearFilters(); }}>
            Minhas receitas
            {recipes.length > 0 && <Badge variant="secondary" className="ml-1.5 h-5">{recipes.length}</Badge>}
          </Button>
          <Button size="sm" variant={tab === "library" ? "default" : "ghost"} onClick={() => { setTab("library"); clearFilters(); }}>
            Receitas prontas
            <Badge variant="secondary" className="ml-1.5 h-5">{libraryRecipes.length}</Badge>
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />Importar BeerXML
          </Button>
          <Button onClick={() => navigate("/recipes/new")} className="bg-gradient-primary text-primary-foreground shadow-brew">
            <Plus className="h-4 w-4 mr-2" />Nova Receita
          </Button>
        </div>
        <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={handleImport} />
      </div>

      {/* Barra de busca + filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar receitas..." value={q} onChange={e => setQ(e.target.value)} />
        </div>

        {/* Filtro por categoria (somente na biblioteca) */}
        {tab === "library" && (
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as LibraryCategory | "")}
            aria-label="Filtrar por categoria"
          >
            <option value="">Todas as categorias</option>
            {libraryCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}

        {/* Filtro por estilo BJCP */}
        {presentStyles.length > 0 && (
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={styleFilter}
            onChange={e => setStyleFilter(e.target.value)}
            aria-label="Filtrar por estilo BJCP"
          >
            <option value="">Todos os estilos</option>
            {presentStyles.map(s => (
              <option key={s.code} value={s.code}>{s.code} – {s.name}</option>
            ))}
          </select>
        )}

        {/* Limpar filtros */}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />Limpar filtros
          </Button>
        )}

        {/* Visualização */}
        <div className="inline-flex items-center gap-1 ml-auto" role="group" aria-label="Visualização">
          <Button size="sm" variant={view === "list" ? "default" : "ghost"} aria-pressed={view === "list"} onClick={() => setView("list")} title="Lista"><List className="h-4 w-4" /></Button>
          <Button size="sm" variant={view === "large" ? "default" : "ghost"} aria-pressed={view === "large"} onClick={() => setView("large")} title="Grade grande"><LayoutGrid className="h-4 w-4" /></Button>
          <Button size="sm" variant={view === "medium" ? "default" : "ghost"} aria-pressed={view === "medium"} onClick={() => setView("medium")} title="Grade média"><Grid3X3 className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Resultados: contagem e empty state */}
      {hasFilters && (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          {list.length} receita{list.length !== 1 ? "s" : ""} encontrada{list.length !== 1 ? "s" : ""}
        </p>
      )}
      {list.length === 0 && (
        <div className="py-12 text-center text-muted-foreground space-y-2">
          <p>Nenhuma receita encontrada.</p>
          {hasFilters && (
            <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>
          )}
        </div>
      )}

      {/* Grade ou lista */}
      <div className={
        view === "list"
          ? "divide-y divide-border border-y border-border"
          : view === "medium"
            ? "grid gap-4 md:grid-cols-3 xl:grid-cols-4"
            : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      }>
        {list.map(r => {
          const s = recipeStats(r);
          const style = styles.find(x => x.code === r.styleCode);
          const isLibrary = tab === "library";
          const libR = r as LibraryRecipe;

          const actions = (
            <div className="flex shrink-0" onClick={e => e.stopPropagation()}>
              {/* Favorito: apenas em Minhas Receitas */}
              {!isLibrary && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={r.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                  onClick={() => toggleFavorite(r.id)}
                >
                  <Star className={`h-4 w-4 ${r.favorite ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                </Button>
              )}
              {/* Preview (biblioteca) */}
              {isLibrary && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Ver detalhes"
                  title="Ver detalhes"
                  onClick={() => setPreviewRecipe(libR)}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              {/* Exportar BeerXML */}
              <Button variant="ghost" size="icon" aria-label="Exportar BeerXML" title="Exportar BeerXML" onClick={() => exportRecipe(r)}>
                <Download className="h-4 w-4" />
              </Button>
              {/* Exportar PDF */}
              <Button variant="ghost" size="icon" aria-label="Exportar PDF" title="Exportar PDF" onClick={() => exportRecipePdf(r)}>
                <FileUp className="h-4 w-4" />
              </Button>
              {isLibrary ? (
                // Copiar da biblioteca
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copiar para minhas receitas"
                  title="Copiar para Minhas Receitas"
                  onClick={() => copyLibraryRecipe(libR)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              ) : (
                <>
                  {/* Duplicar */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Duplicar receita"
                    title="Duplicar"
                    onClick={() => duplicate(r.id)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  {/* Excluir */}
                  <Button variant="ghost" size="icon" aria-label="Excluir receita" onClick={() => remove(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          );

          if (view === "list") return (
            <div key={r.id} className="flex flex-wrap items-center gap-4 py-4">
              <div className="min-w-0 flex-1 basis-48">
                <Button
                  variant="link"
                  className="h-auto max-w-full justify-start whitespace-normal px-0 text-left text-lg text-foreground"
                  onClick={() => isLibrary ? setPreviewRecipe(libR) : navigate(`/recipes/${r.id}`)}
                >
                  {r.name}
                </Button>
                <p className="text-sm text-muted-foreground">
                  {style?.name ?? "Sem estilo"}
                  {isLibrary && libR.category && ` · ${libR.category}`}
                </p>
              </div>
              <dl className="grid flex-1 basis-72 grid-cols-5 gap-3 text-sm">
                {[["OG", fmt(s.og, 3)], ["FG", fmt(s.fg, 3)], ["ABV", `${fmt(s.abv)}%`], ["IBU", fmt(s.ibu, 0)], ["SRM", fmt(s.srm)]].map(([label, value]) => (
                  <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>
                ))}
              </dl>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{fmt(r.equipment.batchL)} L</span>
                <Badge variant="secondary">{money(s.cost.total)}</Badge>
                {isLibrary && libR.difficulty && <Badge variant="outline">{libR.difficulty}</Badge>}
              </div>
              {actions}
            </div>
          );

          return (
            <div key={r.id}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold break-words">{r.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {style?.name ?? "Sem estilo"}
                    {isLibrary && libR.category && ` · ${libR.category}`}
                  </p>
                </div>
                {actions}
              </div>
              <Card
                className="shadow-card hover:shadow-brew transition-shadow cursor-pointer overflow-hidden p-2"
                onClick={() => isLibrary ? setPreviewRecipe(libR) : navigate(`/recipes/${r.id}`)}
              >
                <CanecaLimpa
                  color={srmToHex(s.srm)}
                  metrics={{ og: fmt(s.og, 3), fg: fmt(s.fg, 3), abv: `${fmt(s.abv)}%`, ibu: fmt(s.ibu, 0), srm: fmt(s.srm) }}
                  className={view === "large" ? "mx-auto block w-[179.2px] max-w-full h-auto" : "mx-auto block w-[134.4px] max-w-full h-auto"}
                  role="img"
                  aria-label={`OG ${fmt(s.og, 3)}, FG ${fmt(s.fg, 3)}, ABV ${fmt(s.abv)}%, IBU ${fmt(s.ibu, 0)}, SRM ${fmt(s.srm)}`}
                />
                <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span>{fmt(r.equipment.batchL)} L</span>
                  <div className="flex items-center gap-1">
                    {isLibrary && libR.difficulty && <Badge variant="outline" className="text-[10px]">{libR.difficulty}</Badge>}
                    <Badge variant="secondary">{money(s.cost.total)}</Badge>
                  </div>
                </div>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
