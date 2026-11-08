import { useEffect, useState } from "react";
import { Calculator, ChevronRight, RotateCcw, Search, ArrowLeftRight, Star, Thermometer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculators, validateCalculator, type CalculatorDefinition, type Values, type Result } from "@/lib/calculator-registry";
import { convertUnit, unitFamilies, type UnitFamily } from "@/lib/brewing";
import { useSettings } from "@/lib/settings";

const format = (value: number, digits = 2, locale = "pt-BR") => Number(value).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
function ResultPanel({ results, error, locale }: { results: Result[]; error?: string; locale: string }) {
  return <section aria-label="Resultados" aria-live="polite" className="border-t border-border pt-6 mt-6">
    <h3 className="text-sm font-semibold text-muted-foreground mb-4">RESULTADOS</h3>
    {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">{results.map((result, i) => <div key={`${result.label}-${i}`} className="min-w-0"><dt className="text-sm text-muted-foreground mb-1">{result.label}</dt><dd className="text-2xl font-semibold text-primary break-words tabular-nums">{format(result.value, result.digits, locale)} <span className="text-sm font-medium text-muted-foreground">{result.unit}</span></dd></div>)}</dl>}
  </section>;
}
function UnitConverter({ fixed, locale }: { fixed: CalculatorDefinition["converter"]; locale: string }) {
  const [family, setFamily] = useState<UnitFamily>(fixed && fixed !== "all" ? fixed : "volume");
  const units = Object.keys(unitFamilies[family].units);
  const [from, setFrom] = useState(units[0]);
  const [to, setTo] = useState(units[1]);
  const [input, setInput] = useState("1");
  const number = Number(input.replace(",", "."));
  const celsius = family === "temperature" ? convertUnit(number, family, from, "°C") : 0;
  const error = !input.trim() || !Number.isFinite(number) ? "Informe um número válido." : family === "temperature" && celsius < -273.15 ? "A temperatura não pode ser inferior ao zero absoluto." : family !== "temperature" && number < 0 ? "Informe um valor maior ou igual a zero." : undefined;
  return <>
    <div className="flex justify-end mb-4"><Button size="icon" variant="ghost" aria-label="Restaurar conversão" title="Restaurar conversão" onClick={() => {setInput("1");setFrom(units[0]);setTo(units[1]);}}><RotateCcw /></Button></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {fixed === "all" && <div className="sm:col-span-2 space-y-2"><Label htmlFor="family">Grandeza</Label><Select value={family} onValueChange={value => { const next = value as UnitFamily; const keys = Object.keys(unitFamilies[next].units);setFamily(next);setFrom(keys[0]);setTo(keys[1]); }}><SelectTrigger id="family"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(unitFamilies).map(([key, item]) => <SelectItem key={key} value={key}>{item.label}</SelectItem>)}</SelectContent></Select></div>}
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="convert-value">Valor</Label><Input id="convert-value" inputMode="decimal" value={input} onChange={e => setInput(e.target.value)} /></div>
      {[{id:"from",label:"De",value:from,set:setFrom},{id:"to",label:"Para",value:to,set:setTo}].map(field => <div className="space-y-2" key={field.id}><Label htmlFor={field.id}>{field.label}</Label><Select value={field.value} onValueChange={field.set}><SelectTrigger id={field.id}><SelectValue /></SelectTrigger><SelectContent>{units.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select></div>)}
    </div>
    <div className="flex justify-center mt-3"><Button variant="outline" size="icon" title="Inverter unidades" aria-label="Inverter unidades" onClick={()=>{setFrom(to);setTo(from);}}><ArrowLeftRight /></Button></div>
    <ResultPanel locale={locale} error={error} results={[{label:"Valor convertido",value:convertUnit(number,family,from,to),unit:to,digits:6}]} />
  </>;
}
function CalculationForm({ calculator, locale }: { calculator: CalculatorDefinition; locale: string }) {
  const defaults = Object.fromEntries(calculator.fields.map(field => [field.id, field.initial]));
  const [values, setValues] = useState<Values>(defaults);
  let error = validateCalculator(calculator, values);
  const results = error ? [] : calculator.calculate(values);
  if (!error && results.some(result => !Number.isFinite(result.value))) error = "Não foi possível calcular com estes valores. Confira as entradas.";
  return <>
    <div className="flex justify-end mb-4"><Button size="icon" variant="ghost" title="Restaurar valores" aria-label="Restaurar valores" onClick={() => setValues(defaults)}><RotateCcw /></Button></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{calculator.fields.map(field => <div key={field.id} className="space-y-2 min-w-0"><Label htmlFor={`calc-${field.id}`} className="leading-relaxed">{field.label}</Label>{field.options ? <Select value={values[field.id]} onValueChange={value => setValues(old=>({...old,[field.id]:value}))}><SelectTrigger id={`calc-${field.id}`} className="h-auto min-h-10 text-left [&>span]:whitespace-normal"><SelectValue /></SelectTrigger><SelectContent>{field.options.map(option=><SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select> : <Input id={`calc-${field.id}`} inputMode="decimal" value={values[field.id]} onChange={e=>setValues(old=>({...old,[field.id]:e.target.value}))} />}</div>)}</div>
    <ResultPanel locale={locale} results={results} error={error} />
    {calculator.note && <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-4 mt-6">{calculator.note}</p>}
  </>;
}
const FAVORITES_KEY = "brewfather-calculator-favorites";
const readFavorites = () => {
  if (typeof window === "undefined") return [] as string[];
  try {
    const value = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [] as string[];
  }
};

export default function CalculatorsPage() {
  const [settings] = useSettings();
  const locale = settings.language || "pt-BR";
  const [selected, setSelected] = useState("alcohol");
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  const calculator = calculators.find(item => item.id === selected) ?? calculators[0];
  const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = calculators
    .filter(item => normalized(item.title).includes(normalized(search)))
    .sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id));

  const toggleFavorite = (id: string) => {
    setFavorites(current => current.includes(id) ? current.filter(item => item !== id) : [id, ...current]);
  };

  return <div className="space-y-6">
    <header><div className="flex items-center gap-3"><Calculator className="h-7 w-7 text-primary shrink-0" /><h1 className="text-3xl font-bold text-foreground">Calculadoras</h1></div><p className="text-muted-foreground mt-2">Geral e mostura · {calculators.length} calculadoras</p></header>
    <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
      <aside aria-label="Escolher calculadora" className="min-w-0"><div className="relative mb-4"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar calculadora" placeholder="Buscar calculadora" className="pl-9" value={search} onChange={e=>setSearch(e.target.value)} /></div>
        <nav className="max-h-72 lg:max-h-none overflow-y-auto">{(["Geral","Mostura"] as const).map(group=>{const items=filtered.filter(item=>item.group===group);return items.length>0 && <section key={group} className="mb-5"><h2 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-2">{group==="Mostura"&&<Thermometer className="h-4 w-4" />}{group}</h2><div className="space-y-1">{items.map(item=><div key={item.id} className="flex items-center gap-1"><Button variant={selected===item.id?"secondary":"ghost"} aria-current={selected===item.id?"page":undefined} onClick={()=>setSelected(item.id)} className="flex-1 h-auto min-h-10 justify-between text-left px-3 py-2 whitespace-normal gap-2 hover:bg-muted hover:text-foreground"><span className="min-w-0 leading-5">{item.title}</span>{selected===item.id&&<ChevronRight className="shrink-0" />}</Button><Button type="button" size="icon" variant="ghost" aria-label={favorites.includes(item.id) ? `Remover ${item.title} dos favoritos` : `Adicionar ${item.title} aos favoritos`} title={favorites.includes(item.id) ? "Favorita" : "Favoritar"} onClick={(event)=>{event.stopPropagation();toggleFavorite(item.id);}} className="shrink-0 h-9 w-9 rounded-full"><Star className={`h-4 w-4 ${favorites.includes(item.id) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} /></Button></div>)}</div></section>;})}{filtered.length===0&&<p className="text-sm text-muted-foreground py-4">Nenhuma calculadora encontrada.</p>}</nav>
      </aside>
      <section aria-label={calculator.title} className="min-w-0 bg-card border border-border rounded-lg p-5 sm:p-6 shadow-foam">
        <div className="border-b border-border pb-4"><p className="text-xs text-muted-foreground mb-1">{calculator.group}</p><h2 className="text-xl font-semibold text-foreground break-words">{calculator.title}</h2></div>
        {calculator.converter ? <UnitConverter key={calculator.id} fixed={calculator.converter} locale={locale} /> : <CalculationForm key={calculator.id} calculator={calculator} locale={locale} />}
      </section>
    </div>
  </div>;
}
