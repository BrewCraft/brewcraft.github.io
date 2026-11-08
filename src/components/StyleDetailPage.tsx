import { ArrowLeft, BookOpenText } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { allStyles } from "@/lib/store";

const fmtRange = (value: [number, number], digits = 3) => {
  const format = (n: number) => Number(n).toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
  return `${format(value[0])}–${format(value[1])}`;
};

export default function StyleDetailPage() {
  const { code } = useParams<{ code: string }>();
  const styles = allStyles();
  const style = styles.find(item => item.code === decodeURIComponent(code ?? ""));

  if (!style) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-foreground">Estilo não encontrado</h1>
        <p className="text-muted-foreground">Este estilo não existe ou foi removido.</p>
        <Link to="/styles"><Button variant="outline">Voltar para estilos</Button></Link>
      </div>
    );
  }

  const isCustom = style.code.startsWith("custom-");
  const detail = style.details ?? {
    category: style.name,
    type: isCustom ? "Personalizado" : "Ale",
    overview: "Estilo com perfil característico e faixa recomendada para comparação com receitas.",
    aroma: "Aroma principal do estilo, com equilíbrio e boa limpeza fermentativa.",
    appearance: "Cor e espuma compatíveis com a categoria desta cerveja.",
    flavor: "Sabor correspondente ao estilo, com equilíbrio entre malte, lúpulo e fermentação.",
    mouthfeel: "Corpo e carbonatação adequados ao estilo proposto.",
    comments: "Observações gerais sobre o perfil do estilo para comparação na receita.",
    history: "Histórico do estilo e evolução de produção ao longo do tempo.",
    historicalStyle: "Classificação histórica da categoria.",
    ingredients: "Maltes, lúpulos e leveduras típicas da categoria.",
    comparison: "Comparação com estilos semelhantes da família cervejeira.",
    examples: "Exemplos relevantes do estilo.",
    origin: "Origem histórica do estilo.",
  };
  const ebcRange: [number, number] = [style.srm[0] * 1.97, style.srm[1] * 1.97];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BookOpenText className="h-7 w-7 text-primary" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Estilo</p>
            <h1 className="text-3xl font-bold text-foreground">{style.name}</h1>
          </div>
        </div>
        <Link to="/styles">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-foam">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {style.code}
          </span>
          <span className="rounded border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
            {isCustom ? "Estilo personalizado" : "BJCP 2021"}
          </span>
        </div>

        <p className="mt-5 text-base leading-relaxed text-foreground">{detail.overview}</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          {([
            ["ABV", style.abv, "%"],
            ["OG", style.og, ""],
            ["FG", style.fg, ""],
            ["IBU", style.ibu, ""],
            ["EBC", ebcRange, ""],
            ["SRM", style.srm, ""],
          ] as [string, [number, number], string][]).map(([label, range, suffix]) => (
            <div key={label} className="rounded-lg border border-border bg-background p-4">
              <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
              <div className="mt-2 text-lg font-bold text-foreground">
                {fmtRange(range, label === "OG" || label === "FG" || label === "ABV" ? 3 : 0)}
                {suffix}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
          <div>
            <h3 className="text-base font-semibold text-foreground">Categoria</h3>
            <p className="mt-1">{detail.category}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Tipo</h3>
            <p className="mt-1">{detail.type}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Aroma</h3>
            <p className="mt-1">{detail.aroma}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Aparência</h3>
            <p className="mt-1">{detail.appearance}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Sabor</h3>
            <p className="mt-1">{detail.flavor}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Sensação na Boca</h3>
            <p className="mt-1">{detail.mouthfeel}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Comentário</h3>
            <p className="mt-1">{detail.comments}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Histórico</h3>
            <p className="mt-1">{detail.history}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Estilo Histórico</h3>
            <p className="mt-1">{detail.historicalStyle}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Ingredientes</h3>
            <p className="mt-1">{detail.ingredients}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Comparação</h3>
            <p className="mt-1">{detail.comparison}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Exemplos</h3>
            <p className="mt-1">{detail.examples}</p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Origem</h3>
            <p className="mt-1">{detail.origin}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
