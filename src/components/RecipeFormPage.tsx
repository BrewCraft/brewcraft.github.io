import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Beaker, Copy, GitBranch, GitCompare, History, Lock, Plus, Save, ShoppingCart, Trash2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fermentables as catFerm, hops as catHops, yeasts as catYeasts, miscs as catMiscs } from "@/lib/catalog";
import {
  defaultEquipment,
  cloneRecipeForUser,
  createRecipeVersion,
  restoreRecipeVersion,
  compareRecipeVersions,
  hasRecipeChanged,
  isExternalRecipeDifferent,
  recipeStats,
  shoppingList,
  srmToHex,
  styleCheck,
  type HopUse,
  type Recipe,
  type RecipeVersion
} from "@/lib/recipe-calc";
import { buildSavedRecipe, resolveExternalRecipeUpdate, validateRecipeSave } from "@/lib/recipe-sync";
import { libraryRecipes } from "@/lib/recipe-library";
import { setNavigationGuard } from "@/lib/navigation-guard";
import { allStyles, fmt, money, profileNumber as pn, read, readProfiles, uid, useBatches, useInventory, useRecipes } from "@/lib/store";

const emptyRecipe = (): Recipe => {
  const t = new Date().toISOString();
  return { id: uid(), name: "", styleCode: "18B", author: "", notes: "", equipment: { ...defaultEquipment }, mashSteps: [{ name: "Sacarificação", tempC: 66, minutes: 60 }], fermentationTempC: 19, fermentationDays: 14, fermentables: [], hops: [], yeasts: [], miscs: [], createdAt: t, updatedAt: t, version: "1.0", versionHistory: [] };
};
const numIn = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const hopUses: { id: HopUse; label: string }[] = [{ id: "fervura", label: "Fervura" }, { id: "primeiro_mosto", label: "1º mosto" }, { id: "whirlpool", label: "Whirlpool" }, { id: "dryhop", label: "Dry hop" }];

function NumField({ label, value, onChange, step = "0.1", disabled = false }: { label: string; value: number; onChange: (v: number) => void; step?: string; disabled?: boolean }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label><Input type="number" step={step} value={value} disabled={disabled} onChange={e => onChange(numIn(e.target.value))} /></div>;
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
  return <RecipeFormEditor key={id ?? "new"} id={id} />;
}

function RecipeFormEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const [recipes, saveRecipes] = useRecipes();
  const [batches, saveBatches] = useBatches();
  const [inventory] = useInventory();
  const isNew = !id || id === "new";
  const existing = !isNew ? recipes.find(r => r.id === id) : undefined;
  const libraryItem = !isNew && !existing ? libraryRecipes.find(r => r.id === id) : undefined;
  const isMissing = !isNew && !existing && !libraryItem;
  const isReadOnly = Boolean(libraryItem);

  const [r, setR] = useState<Recipe>(() => {
    const source = existing ?? libraryItem;
    return source ? structuredClone(source) : emptyRecipe();
  });
  const rRef = useRef<Recipe>(r);
  rRef.current = r;
  const initialRecipeRef = useRef<Recipe>(structuredClone(r));
  const prevIdRef = useRef<string | undefined>(id);
  const [diffVersion, setDiffVersion] = useState<RecipeVersion | null>(null);
  const [showShopping, setShowShopping] = useState(false);

  const [externalConflict, setExternalConflict] = useState(false);
  const externalConflictRef = useRef(false);
  externalConflictRef.current = externalConflict;
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const [latestExternalVersion, setLatestExternalVersion] = useState<Recipe | null>(null);
  const acknowledgedExternalRef = useRef<Recipe | null>(null);

  useEffect(() => {
    if (prevIdRef.current !== id) {
      prevIdRef.current = id;
      const nextIsNew = !id || id === "new";
      const nextExisting = !nextIsNew ? recipes.find(x => x.id === id) : undefined;
      const nextLib = !nextIsNew && !nextExisting ? libraryRecipes.find(x => x.id === id) : undefined;
      const fresh = nextExisting || nextLib ? structuredClone((nextExisting ?? nextLib)!) : emptyRecipe();
      setR(fresh);
      initialRecipeRef.current = structuredClone(fresh);
      setDiffVersion(null);
      setShowShopping(false);
      setExternalConflict(false);
      setConflictAcknowledged(false);
      setLatestExternalVersion(null);
      acknowledgedExternalRef.current = null;
      return;
    }

    if (!id || id === "new" || isReadOnly) return;
    const currentStored = recipes.find(x => x.id === id);
    if (!currentStored || !initialRecipeRef.current) return;

    const resolution = resolveExternalRecipeUpdate({
      baseRecipe: initialRecipeRef.current,
      currentDraft: rRef.current,
      storedRecipe: currentStored,
      acknowledgedExternal: acknowledgedExternalRef.current,
    });

    if (resolution.action === "clear-conflict") {
      if (externalConflictRef.current || acknowledgedExternalRef.current) {
        setExternalConflict(false);
        setConflictAcknowledged(false);
        setLatestExternalVersion(null);
        acknowledgedExternalRef.current = null;
      }
      return;
    }

    if (resolution.action === "auto-sync") {
      setR(resolution.nextRecipe);
      initialRecipeRef.current = resolution.nextBase;
      setExternalConflict(false);
      setConflictAcknowledged(false);
      setLatestExternalVersion(null);
      acknowledgedExternalRef.current = null;
      toast.info("A receita foi atualizada com dados mais recentes.");
      return;
    }

    setExternalConflict(true);
    setLatestExternalVersion(resolution.latestExternal);
    if (!resolution.keepAcknowledged) {
      acknowledgedExternalRef.current = null;
      setConflictAcknowledged(false);
    }
  }, [id, recipes, isReadOnly]);

  const isDirty = !isReadOnly && !isMissing && hasRecipeChanged(initialRecipeRef.current, r);

  useEffect(() => {
    if (!isDirty) {
      setNavigationGuard(null);
      return;
    }
    setNavigationGuard(() =>
      window.confirm("Existem alterações não salvas nesta receita. Deseja sair sem salvar?")
    );
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [isDirty]);

  const shopping = shoppingList(r, inventory);
  const styles = useMemo(() => allStyles(), []);
  const style = styles.find(s => s.code === r.styleCode);
  const stats = recipeStats(r);
  const check = style ? styleCheck(stats, style) : undefined;

  const set = (patch: Partial<Recipe>) => { if (!isReadOnly) setR(prev => ({ ...prev, ...patch })); };
  const setEq = (k: keyof Recipe["equipment"], v: number) => { if (!isReadOnly) setR(p => ({ ...p, equipment: { ...p.equipment, [k]: v } })); };
  function updateList<K extends "fermentables" | "hops" | "yeasts" | "miscs">(key: K, idx: number, patch: Partial<Recipe[K][number]>) {
    if (isReadOnly) return;
    setR(p => ({ ...p, [key]: p[key].map((x, i) => (i === idx ? { ...x, ...patch } : x)) }));
  }
  const removeFrom = (key: "fermentables" | "hops" | "yeasts" | "miscs", idx: number) => {
    if (isReadOnly) return;
    setR(p => ({ ...p, [key]: (p[key] as unknown[]).filter((_, i) => i !== idx) }));
  };

  const equipmentProfiles = readProfiles("equipamento"), mashProfiles = readProfiles("mostura"), fermProfiles = readProfiles("fermentacao"), waterProfiles = readProfiles("agua");
  const applyEquipment = (pid: string) => {
    if (isReadOnly) return;
    const p = equipmentProfiles.find(x => x.id === pid); if (!p) return;
    const v = p.values, batchL = pn(v.volumeLote, r.equipment.batchL), boil = pn(v.volumeFervura, 0);
    const evapPct = pn(v.evaporacao, 0);
    set({ equipmentProfileId: pid, equipment: { ...r.equipment, batchL, trubLossL: pn(v.perdasTrub, r.equipment.trubLossL), fermenterLossL: pn(v.perdasFermentador, r.equipment.fermenterLossL), efficiency: pn(v.eficiencia, r.equipment.efficiency), evaporationLh: evapPct && boil ? boil * evapPct / 100 : r.equipment.evaporationLh } });
  };
  const applyMash = (pid: string) => {
    if (isReadOnly) return;
    const p = mashProfiles.find(x => x.id === pid); if (!p) return;
    set({ mashProfileId: pid, mashSteps: [{ name: p.values.tipo || p.name, tempC: pn(p.values.tempAlvo, 66), minutes: pn(p.values.tempoTotal, 60) }] });
  };
  const applyFerm = (pid: string) => {
    if (isReadOnly) return;
    const p = fermProfiles.find(x => x.id === pid); if (!p) return;
    const min = pn(p.values.tempMin, 18), max = pn(p.values.tempMax, min);
    set({ fermentationProfileId: pid, fermentationTempC: (min + max) / 2, fermentationDays: pn(p.values.duracao, r.fermentationDays) });
  };

  const handleNavigate = (to: string) => {
    if (isDirty && !window.confirm("Existem alterações não salvas nesta receita. Deseja sair sem salvar?")) return;
    setNavigationGuard(null);
    navigate(to);
  };

  const copyFromLibrary = () => {
    if (!libraryItem) return;
    const copy = cloneRecipeForUser(libraryItem, uid);
    saveRecipes([...recipes, copy]);
    setNavigationGuard(null);
    toast.success("Receita copiada para Minhas receitas");
    navigate(`/recipes/${copy.id}`);
  };

  const handleReloadExternal = () => {
    const freshStored = id ? read("recipes").find(x => x.id === id) : undefined;
    const target = freshStored ?? latestExternalVersion;
    if (!target) return;
    const fresh = structuredClone(target);
    setR(fresh);
    initialRecipeRef.current = structuredClone(fresh);
    setExternalConflict(false);
    setConflictAcknowledged(false);
    setLatestExternalVersion(null);
    acknowledgedExternalRef.current = null;
    toast.success("Receita recarregada com a versão externa mais recente.");
  };

  const handleKeepLocalEdits = () => {
    const currentExternal = (id ? read("recipes").find(x => x.id === id) : undefined) ?? latestExternalVersion;
    acknowledgedExternalRef.current = currentExternal ? structuredClone(currentExternal) : null;
    setConflictAcknowledged(true);
    toast.info("Alterações locais mantidas. O conflito será resolvido ao salvar.");
  };

  const save = (silent = false, forceSave = false) => {
    if (isReadOnly) return false;

    const freshRecipes = read("recipes");
    const latestStored = freshRecipes.find(x => x.id === r.id);
    const validation = validateRecipeSave({
      baseRecipe: initialRecipeRef.current,
      currentDraft: r,
      latestStored,
      isExisting: Boolean(existing),
      conflictAcknowledged,
      acknowledgedExternal: acknowledgedExternalRef.current,
      forceSave,
    });

    if (validation.status === "missing-name") {
      toast.error("Dê um nome à receita.");
      return false;
    }

    if (validation.status === "conflict-unacknowledged") {
      setExternalConflict(true);
      setConflictAcknowledged(false);
      acknowledgedExternalRef.current = null;
      setLatestExternalVersion(validation.latestExternal);
      toast.error("A receita foi modificada externamente. Escolha se deseja recarregar a versão externa ou manter suas alterações antes de salvar.");
      return false;
    }

    if (validation.status === "conflict-confirm") {
      setExternalConflict(true);
      setLatestExternalVersion(validation.latestExternal);
      const proceed = window.confirm(
        "A receita foi alterada externamente (por IA ou sincronização). Salvar suas alterações locais agora arquivará a versão externa no histórico de versões para que nada seja perdido. Deseja continuar?"
      );
      if (!proceed) return false;
    }

    const next = buildSavedRecipe({
      baseRecipe: initialRecipeRef.current,
      currentDraft: r,
      latestStored,
      isExisting: Boolean(existing),
    });

    initialRecipeRef.current = structuredClone(next);
    setR(next);
    setExternalConflict(false);
    setConflictAcknowledged(false);
    setLatestExternalVersion(null);
    acknowledgedExternalRef.current = null;
    setNavigationGuard(null);
    saveRecipes(freshRecipes.some(x => x.id === r.id) ? freshRecipes.map(x => (x.id === r.id ? next : x)) : [...freshRecipes, next]);
    if (!silent) { toast.success(`Receita salva${next.version ? ` (v${next.version})` : ""}`); navigate("/recipes"); }
    return true;
  };
  const createBatch = () => {
    if (isReadOnly) return;
    if (!save(true)) return;
    const number = batches.reduce((m, b) => Math.max(m, b.number), 0) + 1;
    const b = { id: uid(), number, name: r.name, recipeId: r.id, recipe: structuredClone(r), status: "planejamento" as const, brewDate: new Date().toISOString().slice(0, 10), measurements: [], notes: "", inventoryDeducted: false, createdAt: new Date().toISOString() };
    saveBatches([...batches, b]);
    setNavigationGuard(null);
    toast.success(`Lote #${number} criado`);
    navigate(`/batches/${b.id}`);
  };
  const saveNewVersion = () => {
    if (isReadOnly) return;
    const freshRecipes = read("recipes");
    const latestStored = freshRecipes.find(x => x.id === r.id);
    if (existing && latestStored && isExternalRecipeDifferent(initialRecipeRef.current, latestStored)) {
      setExternalConflict(true);
      setConflictAcknowledged(false);
      acknowledgedExternalRef.current = null;
      setLatestExternalVersion(structuredClone(latestStored));
      toast.error("A receita foi modificada externamente. Resolva o conflito antes de criar uma nova versão.");
      return;
    }
    const note = window.prompt("Descrição da alteração (opcional):");
    if (note === null) return;
    const prevSnapshot = hasRecipeChanged(initialRecipeRef.current, r) ? initialRecipeRef.current : undefined;
    const next = createRecipeVersion({ ...r, updatedAt: new Date().toISOString() }, prevSnapshot, note);
    initialRecipeRef.current = structuredClone(next);
    setExternalConflict(false);
    setConflictAcknowledged(false);
    setLatestExternalVersion(null);
    acknowledgedExternalRef.current = null;
    saveRecipes(freshRecipes.some(x => x.id === r.id) ? freshRecipes.map(x => (x.id === r.id ? next : x)) : [...freshRecipes, next]);
    setR(next);
    toast.success(`Nova versão ${next.version} criada`);
  };

  if (isMissing) {
    return (
      <div className="py-12 text-center space-y-2">
        <p className="text-muted-foreground">Receita não encontrada.</p>
        <Link to="/recipes" className="text-primary underline">Voltar às receitas</Link>
      </div>
    );
  }

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
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => handleNavigate("/recipes")} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {isReadOnly ? (r.name || "Receita da Biblioteca") : existing ? "Editar Receita" : "Nova Receita"}
          </h1>
          {isReadOnly && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" /> Biblioteca · Somente leitura
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowShopping(s => !s)}><ShoppingCart className="h-4 w-4 mr-2" />Lista de compras</Button>
          {isReadOnly ? (
            <Button onClick={copyFromLibrary} className="bg-gradient-primary text-primary-foreground shadow-brew">
              <Copy className="h-4 w-4 mr-2" />Copiar para Minhas receitas
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={createBatch}><Beaker className="h-4 w-4 mr-2" />Criar lote</Button>
              <Button onClick={() => save()} className="bg-gradient-primary text-primary-foreground shadow-brew"><Save className="h-4 w-4 mr-2" />Salvar</Button>
            </>
          )}
        </div>
      </div>

      {externalConflict && (
        <Card className="border-amber-500/50 bg-amber-500/10">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
            <div className="flex items-start gap-2.5 text-foreground">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-600 dark:text-amber-400">
                  Receita modificada externamente
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {conflictAcknowledged
                    ? "Você optou por manter suas edições locais. Ao salvar, a versão externa será arquivada no histórico de versões."
                    : "Esta receita foi modificada externamente (por IA ou sincronização) enquanto você editava. Suas alterações locais estão preservadas."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <Button size="sm" variant="outline" onClick={handleReloadExternal} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Recarregar versão externa
              </Button>
              {!conflictAcknowledged && (
                <Button size="sm" variant="secondary" onClick={handleKeepLocalEdits}>
                  Manter minhas alterações
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isReadOnly && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <Lock className="h-4 w-4 text-primary shrink-0" />
              <span>Receita protegida da biblioteca (somente leitura). Copie para <b>Minhas receitas</b> para editar, salvar versões ou criar lotes.</span>
            </div>
            <Button size="sm" variant="outline" onClick={copyFromLibrary}>
              <Copy className="h-4 w-4 mr-1.5" />Copiar e editar
            </Button>
          </CardContent>
        </Card>
      )}

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
          <div className="space-y-1"><Label>Nome</Label><Input value={r.name} disabled={isReadOnly} onChange={e => set({ name: e.target.value })} placeholder="Ex: IPA Tropical" /></div>
          <div className="space-y-1"><Label>Estilo</Label>
            <Select value={r.styleCode} disabled={isReadOnly} onValueChange={v => set({ styleCode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{styles.map(s => <SelectItem key={s.code} value={s.code}>{s.code.startsWith("custom") ? "" : `${s.code} · `}{s.name}</SelectItem>)}</SelectContent>
            </Select>
            {style && <p className="text-xs text-muted-foreground">OG {style.og.map(x => fmt(x, 3)).join("–")} · IBU {style.ibu.map(x => fmt(x, 0)).join("–")} · SRM {style.srm.map(x => fmt(x, 0)).join("–")} · ABV {style.abv.map(x => fmt(x)).join("–")}%</p>}
          </div>
          <div className="space-y-1"><Label>Autor</Label><Input value={r.author} disabled={isReadOnly} onChange={e => set({ author: e.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Notas</Label><Textarea value={r.notes} disabled={isReadOnly} onChange={e => set({ notes: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader><CardTitle>Equipamento e volumes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ProfileSelect label="Perfil de equipamento" value={r.equipmentProfileId} profiles={equipmentProfiles} onChange={applyEquipment} disabled={isReadOnly} />
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <NumField label="Volume do lote (L)" value={r.equipment.batchL} disabled={isReadOnly} onChange={v => setEq("batchL", v)} />
            <NumField label="Fervura (min)" value={r.equipment.boilMinutes} disabled={isReadOnly} onChange={v => setEq("boilMinutes", v)} step="1" />
            <NumField label="Evaporação (L/h)" value={r.equipment.evaporationLh} disabled={isReadOnly} onChange={v => setEq("evaporationLh", v)} />
            <NumField label="Perda trub (L)" value={r.equipment.trubLossL} disabled={isReadOnly} onChange={v => setEq("trubLossL", v)} />
            <NumField label="Perda fermentador (L)" value={r.equipment.fermenterLossL} disabled={isReadOnly} onChange={v => setEq("fermenterLossL", v)} />
            <NumField label="Eficiência (%)" value={r.equipment.efficiency} disabled={isReadOnly} onChange={v => setEq("efficiency", v)} step="1" />
          </div>
          <p className="text-sm text-muted-foreground">Pré-fervura {fmt(stats.volumes.preBoil)} L · pós-fervura {fmt(stats.volumes.postBoil)} L · envase {fmt(stats.volumes.packaged)} L · {fmt(stats.grainKg, 2)} kg de fermentáveis</p>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><CardTitle>Fermentáveis</CardTitle>
          {!isReadOnly && <CatalogPicker items={catFerm} placeholder="Adicionar fermentável" describe={i => `${i.color}°L`} onPick={i => set({ fermentables: [...r.fermentables, { id: uid(), name: i.name, kg: 1, potential: i.potential, color: i.color, type: i.type, price: i.price }] })} />}
        </CardHeader>
        <CardContent className="space-y-3">
          {r.fermentables.length === 0 && <p className="text-sm text-muted-foreground">Nenhum fermentável.</p>}
          {r.fermentables.map((f, i) => (
            <div key={f.id} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 items-end border-b border-border pb-3">
              <div className="col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Nome</Label><Input value={f.name} disabled={isReadOnly} onChange={e => updateList("fermentables", i, { name: e.target.value })} /><span className="text-xs text-muted-foreground">{stats.grainKg ? fmt(f.kg / stats.grainKg * 100, 0) : 0}%</span></div>
              <NumField label="kg" value={f.kg} step="0.01" disabled={isReadOnly} onChange={v => updateList("fermentables", i, { kg: v })} />
              <NumField label="Cor (°L)" value={f.color} disabled={isReadOnly} onChange={v => updateList("fermentables", i, { color: v })} />
              <NumField label="Potencial (SG)" value={f.potential} step="0.001" disabled={isReadOnly} onChange={v => updateList("fermentables", i, { potential: v })} />
              <NumField label="R$/kg" value={f.price} disabled={isReadOnly} onChange={v => updateList("fermentables", i, { price: v })} />
              {!isReadOnly && <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => removeFrom("fermentables", i)}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><CardTitle>Lúpulos</CardTitle>
          {!isReadOnly && <CatalogPicker items={catHops} placeholder="Adicionar lúpulo" describe={i => `${i.alpha}% AA`} onPick={i => set({ hops: [...r.hops, { id: uid(), name: i.name, grams: 20, alpha: i.alpha, minutes: 60, use: "fervura", price: i.price }] })} />}
        </CardHeader>
        <CardContent className="space-y-3">
          {r.hops.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lúpulo.</p>}
          {r.hops.map((h, i) => {
            const cat = catHops.find(c => c.name === h.name);
            return (
            <div key={h.id} className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1.2fr_1fr_1fr_auto] gap-2 items-end border-b border-border pb-3">
              <div className="col-span-2 sm:col-span-1"><Label className="text-xs text-muted-foreground">Nome</Label><Input value={h.name} disabled={isReadOnly} onChange={e => updateList("hops", i, { name: e.target.value })} /></div>
              <NumField label="g" value={h.grams} step="1" disabled={isReadOnly} onChange={v => updateList("hops", i, { grams: v })} />
              <NumField label="Alfa (%)" value={h.alpha} disabled={isReadOnly} onChange={v => updateList("hops", i, { alpha: v })} />
              <div><Label className="text-xs text-muted-foreground">Uso</Label>
                <Select value={h.use} disabled={isReadOnly} onValueChange={v => updateList("hops", i, { use: v as HopUse })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{hopUses.map(u => <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>)}</SelectContent></Select>
              </div>
              {h.use === "dryhop"
                ? <NumField label="Dia" value={h.dryHopDay ?? 3} step="1" disabled={isReadOnly} onChange={v => updateList("hops", i, { dryHopDay: v })} />
                : <NumField label="Minutos" value={h.minutes} step="1" disabled={isReadOnly} onChange={v => updateList("hops", i, { minutes: v })} />}
              <NumField label="R$/kg" value={h.price} disabled={isReadOnly} onChange={v => updateList("hops", i, { price: v })} />
              {!isReadOnly && <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => removeFrom("hops", i)}><Trash2 className="h-4 w-4" /></Button>}
              {cat && (
                <div className="col-span-2 sm:col-span-full text-xs text-muted-foreground">
                  <b className="text-foreground">Substitutos:</b> {(cat.substitutes ?? []).join(", ") || "desconhecidos"} · <b className="text-foreground">Perfil:</b> {cat.profile}{cat.beta !== undefined ? <> · <b className="text-foreground">β:</b> {cat.beta}%</> : null}{cat.source ? <> · <b className="text-foreground">Fonte:</b> {cat.source === "official" ? "oficial" : cat.source === "estimate" ? "estimativa" : cat.source}</> : null}
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
            {!isReadOnly && <CatalogPicker items={catYeasts} placeholder="Adicionar levedura" describe={i => `${i.lab} · ${i.attenuation}%`} onPick={i => set({ yeasts: [...r.yeasts, { id: uid(), name: i.name, attenuation: i.attenuation, packs: 1, price: i.price }] })} />}
          </CardHeader>
          <CardContent className="space-y-3">
            {r.yeasts.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma levedura (atenuação padrão de 75%).</p>}
            {r.yeasts.map((y, i) => (
              <div key={y.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs text-muted-foreground">Nome</Label><Input value={y.name} disabled={isReadOnly} onChange={e => updateList("yeasts", i, { name: e.target.value })} /></div>
                <NumField label="Aten. %" value={y.attenuation} step="1" disabled={isReadOnly} onChange={v => updateList("yeasts", i, { attenuation: v })} />
                <NumField label="Pacotes" value={y.packs} step="1" disabled={isReadOnly} onChange={v => updateList("yeasts", i, { packs: v })} />
                <NumField label="R$/pct" value={y.price} disabled={isReadOnly} onChange={v => updateList("yeasts", i, { price: v })} />
                {!isReadOnly && <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => removeFrom("yeasts", i)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0"><CardTitle>Outros</CardTitle>
            {!isReadOnly && <CatalogPicker items={catMiscs} placeholder="Adicionar item" describe={i => i.use} onPick={i => set({ miscs: [...r.miscs, { id: uid(), name: i.name, amount: 1, unit: i.price < 1 ? "g" : "un", use: i.use, price: i.price }] })} />}
          </CardHeader>
          <CardContent className="space-y-3">
            {r.miscs.length === 0 && <p className="text-sm text-muted-foreground">Nenhum item.</p>}
            {r.miscs.map((m, i) => (
              <div key={m.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs text-muted-foreground">Nome</Label><Input value={m.name} disabled={isReadOnly} onChange={e => updateList("miscs", i, { name: e.target.value })} /></div>
                <NumField label={`Qtd (${m.unit})`} value={m.amount} disabled={isReadOnly} onChange={v => updateList("miscs", i, { amount: v })} />
                <div><Label className="text-xs text-muted-foreground">Uso</Label><Input value={m.use} disabled={isReadOnly} onChange={e => updateList("miscs", i, { use: e.target.value })} /></div>
                <NumField label="R$/un" value={m.price} disabled={isReadOnly} onChange={v => updateList("miscs", i, { price: v })} />
                {!isReadOnly && <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => removeFrom("miscs", i)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader><CardTitle>Mostura</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ProfileSelect label="Perfil de mostura" value={r.mashProfileId} profiles={mashProfiles} onChange={applyMash} disabled={isReadOnly} />
            {r.mashSteps.map((s, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs text-muted-foreground">Passo</Label><Input value={s.name} disabled={isReadOnly} onChange={e => set({ mashSteps: r.mashSteps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></div>
                <NumField label="°C" value={s.tempC} disabled={isReadOnly} onChange={v => set({ mashSteps: r.mashSteps.map((x, j) => (j === i ? { ...x, tempC: v } : x)) })} />
                <NumField label="min" value={s.minutes} step="1" disabled={isReadOnly} onChange={v => set({ mashSteps: r.mashSteps.map((x, j) => (j === i ? { ...x, minutes: v } : x)) })} />
                {!isReadOnly && <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => set({ mashSteps: r.mashSteps.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
            {!isReadOnly && <Button variant="outline" size="sm" onClick={() => set({ mashSteps: [...r.mashSteps, { name: "Novo passo", tempC: 72, minutes: 15 }] })}><Plus className="h-4 w-4 mr-1" />Passo</Button>}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle>Fermentação e água</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ProfileSelect label="Perfil de fermentação" value={r.fermentationProfileId} profiles={fermProfiles} onChange={applyFerm} disabled={isReadOnly} />
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Temperatura (°C)" value={r.fermentationTempC} disabled={isReadOnly} onChange={v => set({ fermentationTempC: v })} />
              <NumField label="Duração (dias)" value={r.fermentationDays} step="1" disabled={isReadOnly} onChange={v => set({ fermentationDays: v })} />
            </div>
            <ProfileSelect label="Perfil de água" value={r.waterProfileId} profiles={waterProfiles} onChange={v => set({ waterProfileId: v })} disabled={isReadOnly} />
            {r.waterProfileId && <Button variant="link" className="px-0" onClick={() => handleNavigate(`/water?profile=${r.waterProfileId}&liters=${fmt(stats.volumes.preBoil, 0)}`)}>Ajustar sais para este perfil →</Button>}
          </CardContent>
        </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Versões (atual: v{r.version || "1.0"}{r.versionNote ? ` — ${r.versionNote}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!isReadOnly && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={saveNewVersion}><GitBranch className="h-4 w-4 mr-1" /> Salvar nova versão</Button>
            </div>
          )}
          {(r.versionHistory || []).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma versão anterior gravada.</p>}
          <ul className="space-y-1">
            {(r.versionHistory || []).map(v => (
              <li key={v.version} className="flex flex-wrap items-center justify-between text-sm border rounded-md px-3 py-2 gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">v{v.version}</span>
                    <span className="text-muted-foreground text-xs">{new Date(v.createdAt).toLocaleString()}</span>
                  </div>
                  {v.note && <p className="text-xs text-muted-foreground truncate">{v.note}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setDiffVersion(v)} title="Comparar com versão atual">
                    <GitCompare className="h-3.5 w-3.5 mr-1" /> Comparar
                  </Button>
                  {!isReadOnly && (
                    <Button variant="ghost" size="sm" onClick={() => {
                      const freshRecipes = read("recipes");
                      const latestStored = freshRecipes.find(x => x.id === r.id);
                      if (existing && latestStored && isExternalRecipeDifferent(initialRecipeRef.current, latestStored)) {
                        setExternalConflict(true);
                        setConflictAcknowledged(false);
                        acknowledgedExternalRef.current = null;
                        setLatestExternalVersion(structuredClone(latestStored));
                        toast.error("A receita foi modificada externamente. Resolva o conflito antes de restaurar uma versão.");
                        return;
                      }
                      const restored = restoreRecipeVersion(r, v.version);
                      initialRecipeRef.current = structuredClone(restored);
                      setR(restored);
                      setExternalConflict(false);
                      setConflictAcknowledged(false);
                      setLatestExternalVersion(null);
                      acknowledgedExternalRef.current = null;
                      saveRecipes(freshRecipes.map(x => x.id === r.id ? restored : x));
                      toast.success(`Restaurada versão ${v.version} como v${restored.version}`);
                    }}>Restaurar</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      </div>

      <RecipeVersionDiffDialog
        selectedVersion={diffVersion}
        currentRecipe={r}
        onClose={() => setDiffVersion(null)}
      />
    </div>
  );
}

function RecipeVersionDiffDialog({
  selectedVersion,
  currentRecipe,
  onClose,
}: {
  selectedVersion: RecipeVersion | null;
  currentRecipe: Recipe;
  onClose: () => void;
}) {
  if (!selectedVersion) return null;
  const diff = compareRecipeVersions(selectedVersion.snapshot, currentRecipe);

  const statColor = (type: "og" | "fg" | "abv" | "ibu" | "srm" | "cost") => {
    const oldV = diff.stats[type].old;
    const newV = diff.stats[type].new;
    if (Math.abs(oldV - newV) < 0.001) return "text-muted-foreground font-mono";
    return oldV < newV ? "text-emerald-600 dark:text-emerald-400 font-semibold font-mono" : "text-amber-600 dark:text-amber-400 font-semibold font-mono";
  };

  return (
    <Dialog open={!!selectedVersion} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-primary" />
            Comparação: v{selectedVersion.version} → Atual ({currentRecipe.version || "1.0"})
          </DialogTitle>
          <DialogDescription>
            {selectedVersion.note ? `Nota da v${selectedVersion.version}: "${selectedVersion.note}"` : `Criada em ${new Date(selectedVersion.createdAt).toLocaleString()}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!diff.hasChanges ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma diferença detectada entre estas versões.</p>
          ) : (
            <>
              {/* Estatísticas calculadas */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 rounded-lg border p-3 bg-muted/30 text-center text-xs">
                <div>
                  <span className="text-muted-foreground">OG</span>
                  <p className={statColor("og")}>{diff.stats.og.old.toFixed(3)} → {diff.stats.og.new.toFixed(3)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">FG</span>
                  <p className={statColor("fg")}>{diff.stats.fg.old.toFixed(3)} → {diff.stats.fg.new.toFixed(3)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">ABV</span>
                  <p className={statColor("abv")}>{diff.stats.abv.old.toFixed(1)}% → {diff.stats.abv.new.toFixed(1)}%</p>
                </div>
                <div>
                  <span className="text-muted-foreground">IBU</span>
                  <p className={statColor("ibu")}>{diff.stats.ibu.old.toFixed(0)} → {diff.stats.ibu.new.toFixed(0)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">SRM</span>
                  <p className={statColor("srm")}>{diff.stats.srm.old.toFixed(1)} → {diff.stats.srm.new.toFixed(1)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Custo</span>
                  <p className={statColor("cost")}>R${diff.stats.cost.old.toFixed(2)} → R${diff.stats.cost.new.toFixed(2)}</p>
                </div>
              </div>

              {/* Parâmetros Gerais */}
              {diff.general.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Parâmetros Gerais</h4>
                  <ul className="text-sm border rounded-md divide-y">
                    {diff.general.map((item, idx) => (
                      <li key={idx} className="flex justify-between p-2">
                        <span className="font-medium">{item.name}</span>
                        <span className="text-muted-foreground font-mono">{item.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Fermentáveis */}
              {diff.fermentables.some(f => f.type !== "unchanged") && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Fermentáveis</h4>
                  <ul className="text-sm border rounded-md divide-y">
                    {diff.fermentables.filter(f => f.type !== "unchanged").map((f, idx) => (
                      <li key={idx} className="flex justify-between items-center p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={f.type === "added" ? "default" : f.type === "removed" ? "destructive" : "secondary"}>
                            {f.type === "added" ? "+ Adicionado" : f.type === "removed" ? "- Removido" : "Modificado"}
                          </Badge>
                          <span>{f.name}</span>
                        </div>
                        <span className="text-muted-foreground font-mono">{f.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Lúpulos */}
              {diff.hops.some(h => h.type !== "unchanged") && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Lúpulos</h4>
                  <ul className="text-sm border rounded-md divide-y">
                    {diff.hops.filter(h => h.type !== "unchanged").map((h, idx) => (
                      <li key={idx} className="flex justify-between items-center p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={h.type === "added" ? "default" : h.type === "removed" ? "destructive" : "secondary"}>
                            {h.type === "added" ? "+ Adicionado" : h.type === "removed" ? "- Removido" : "Modificado"}
                          </Badge>
                          <span>{h.name}</span>
                        </div>
                        <span className="text-muted-foreground font-mono">{h.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Leveduras */}
              {diff.yeasts.some(y => y.type !== "unchanged") && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Leveduras</h4>
                  <ul className="text-sm border rounded-md divide-y">
                    {diff.yeasts.filter(y => y.type !== "unchanged").map((y, idx) => (
                      <li key={idx} className="flex justify-between items-center p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={y.type === "added" ? "default" : y.type === "removed" ? "destructive" : "secondary"}>
                            {y.type === "added" ? "+ Adicionado" : y.type === "removed" ? "- Removido" : "Modificado"}
                          </Badge>
                          <span>{y.name}</span>
                        </div>
                        <span className="text-muted-foreground font-mono">{y.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Outros (Miscs) */}
              {diff.miscs.some(m => m.type !== "unchanged") && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Outros</h4>
                  <ul className="text-sm border rounded-md divide-y">
                    {diff.miscs.filter(m => m.type !== "unchanged").map((m, idx) => (
                      <li key={idx} className="flex justify-between items-center p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={m.type === "added" ? "default" : m.type === "removed" ? "destructive" : "secondary"}>
                            {m.type === "added" ? "+ Adicionado" : m.type === "removed" ? "- Removido" : "Modificado"}
                          </Badge>
                          <span>{m.name}</span>
                        </div>
                        <span className="text-muted-foreground font-mono">{m.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Mostura */}
              {diff.mashSteps.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Passos de Mostura</h4>
                  <ul className="text-sm border rounded-md divide-y">
                    {diff.mashSteps.map((m, idx) => (
                      <li key={idx} className="flex justify-between items-center p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={m.type === "added" ? "default" : m.type === "removed" ? "destructive" : "secondary"}>
                            {m.type === "added" ? "+ Adicionado" : m.type === "removed" ? "- Removido" : "Modificado"}
                          </Badge>
                          <span>{m.name}</span>
                        </div>
                        <span className="text-muted-foreground font-mono">{m.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProfileSelect({ label, value, profiles, onChange, disabled = false }: { label: string; value?: string; profiles: { id: string; name: string }[]; onChange: (id: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {profiles.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum perfil salvo em Perfis.</p> : (
        <Select value={value ?? ""} disabled={disabled} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Escolher perfil" /></SelectTrigger>
          <SelectContent>{profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
      )}
    </div>
  );
}
