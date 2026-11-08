import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";

interface ProfileField {
  key: string;
  label: string;
  type?: "text" | "number";
  step?: string;
  placeholder?: string;
}

interface ProfileDef {
  slug: string;
  title: string;
  description: string;
  storageKey: string;
  fields: ProfileField[];
}

interface SavedProfile {
  id: string;
  name: string;
  descricao?: string;
  values: Record<string, string>;
}

const PROFILE_TYPES: ProfileDef[] = [
  {
    slug: "equipamento",
    title: "Equipamento",
    description: "Configure os volumes e perdas do seu equipamento.",
    storageKey: "brewfather-profiles-equipamento",
    fields: [
      { key: "volumeLote", label: "Volume do lote (L)", type: "number", step: "0.1", placeholder: "20" },
      { key: "volumeFervura", label: "Volume de fervura (L)", type: "number", step: "0.1", placeholder: "26" },
      { key: "evaporacao", label: "Evaporação (%/h)", type: "number", step: "0.1", placeholder: "10" },
      { key: "perdasTrub", label: "Perdas no trub e lúpulo (L)", type: "number", step: "0.1", placeholder: "1" },
      { key: "perdasFermentador", label: "Perdas no fermentador (L)", type: "number", step: "0.1", placeholder: "1" },
      { key: "eficiencia", label: "Eficiência de mostura (%)", type: "number", step: "0.1", placeholder: "75" },
    ],
  },
  {
    slug: "mostura",
    title: "Mostura",
    description: "Perfil de temperaturas e tempos de repouso.",
    storageKey: "brewfather-profiles-mostura",
    fields: [
      { key: "tipo", label: "Tipo", placeholder: "Ex: Simples repouso" },
      { key: "passos", label: "Passos", placeholder: "Ex: 66°C por 60 min" },
      { key: "tempAlvo", label: "Temperatura alvo (°C)", type: "number", step: "0.1", placeholder: "66" },
      { key: "tempoTotal", label: "Tempo total (min)", type: "number", placeholder: "60" },
      { key: "relacaoAgua", label: "Relação água/malte (L/kg)", type: "number", step: "0.1", placeholder: "3" },
    ],
  },
  {
    slug: "fermentacao",
    title: "Fermentação",
    description: "Temperaturas e leveduras do seu processo.",
    storageKey: "brewfather-profiles-fermentacao",
    fields: [
      { key: "levedura", label: "Levedura", placeholder: "Ex: US-05" },
      { key: "tempMin", label: "Temperatura mínima (°C)", type: "number", step: "0.1", placeholder: "18" },
      { key: "tempMax", label: "Temperatura máxima (°C)", type: "number", step: "0.1", placeholder: "20" },
      { key: "duracao", label: "Duração (dias)", type: "number", placeholder: "10" },
    ],
  },
  {
    slug: "agua",
    title: "Água",
    description: "Perfil químico da sua água (ppm).",
    storageKey: "brewfather-profiles-agua",
    fields: [
      { key: "calcio", label: "Cálcio (ppm)", type: "number", step: "0.1", placeholder: "50" },
      { key: "magnesio", label: "Magnésio (ppm)", type: "number", step: "0.1", placeholder: "10" },
      { key: "sodio", label: "Sódio (ppm)", type: "number", step: "0.1", placeholder: "20" },
      { key: "sulfato", label: "Sulfato (ppm)", type: "number", step: "0.1", placeholder: "50" },
      { key: "cloreto", label: "Cloreto (ppm)", type: "number", step: "0.1", placeholder: "50" },
      { key: "bicarbonato", label: "Bicarbonato (ppm)", type: "number", step: "0.1", placeholder: "120" },
    ],
  },
  {
    slug: "estilos",
    title: "Estilos Personalizados",
    description: "Especificações dos seus estilos próprios.",
    storageKey: "brewfather-profiles-estilos",
    fields: [
      { key: "categoria", label: "Categoria", placeholder: "Ex: IPA" },
      { key: "ogMin", label: "OG mínima", type: "number", step: "0.001", placeholder: "1.050" },
      { key: "ogMax", label: "OG máxima", type: "number", step: "0.001", placeholder: "1.065" },
      { key: "fgMin", label: "FG mínima", type: "number", step: "0.001", placeholder: "1.010" },
      { key: "fgMax", label: "FG máxima", type: "number", step: "0.001", placeholder: "1.014" },
      { key: "ibu", label: "IBU", type: "number", placeholder: "40" },
      { key: "srm", label: "SRM", type: "number", step: "0.1", placeholder: "8" },
      { key: "abv", label: "ABV (%)", type: "number", step: "0.1", placeholder: "5.5" },
    ],
  },
];

const readProfiles = (storageKey: string): SavedProfile[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as SavedProfile[]) : [];
  } catch {
    return [];
  }
};

export default function ProfilesPage() {
  const { type } = useParams<{ type: string }>();
  const def = PROFILE_TYPES.find((p) => p.slug === type);
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [editing, setEditing] = useState<SavedProfile | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SavedProfile>({ id: "", name: "", descricao: "", values: {} });

  useEffect(() => {
    if (def) setProfiles(readProfiles(def.storageKey));
  }, [def]);

  if (!def) return <Navigate to="/profiles/equipamento" replace />;

  const openNew = () => {
    setForm({ id: "", name: "", descricao: "", values: {} });
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (profile: SavedProfile) => {
    setForm({ ...profile, values: { ...profile.values } });
    setEditing(profile);
    setShowForm(true);
  };

  const persist = (next: SavedProfile[]) => {
    setProfiles(next);
    localStorage.setItem(def.storageKey, JSON.stringify(next));
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    const entry: SavedProfile = { ...form, id: form.id || crypto.randomUUID() };
    const next = editing
      ? profiles.map((p) => (p.id === editing.id ? entry : p))
      : [...profiles, entry];
    persist(next);
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = (id: string) => {
    persist(profiles.filter((p) => p.id !== id));
    if (editing?.id === id) {
      setShowForm(false);
      setEditing(null);
    }
  };

  const handleFieldChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, values: { ...prev.values, [key]: value } }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Perfis</h1>
          <p className="text-muted-foreground">{def.title} — {def.description}</p>
        </div>
        <Button
          onClick={openNew}
          className="bg-gradient-primary hover:bg-primary-glow text-primary-foreground shadow-brew"
        >
          <Plus className="h-4 w-4 mr-2" />
          Novo Perfil
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PROFILE_TYPES.map((t) => (
          <Link
            key={t.slug}
            to={`/profiles/${t.slug}`}
            className={
              t.slug === def.slug
                ? "bg-primary text-primary-foreground font-medium px-4 py-2 rounded-md shadow-brew"
                : "hover:bg-muted text-muted-foreground hover:text-foreground px-4 py-2 rounded-md"
            }
          >
            {t.title}
          </Link>
        ))}
      </div>

      {showForm && (
        <Card className="shadow-foam border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-foreground">
              {editing ? "Editar Perfil" : "Novo Perfil"} — {def.title}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setShowForm(false)} aria-label="Fechar">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Nome do Perfil</Label>
                <Input
                  id="profile-name"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={`Ex: ${def.title === "Água" ? "Minha água" : "Meu perfil"}`}
                  className="border-border"
                />
              </div>
              {def.fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`profile-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`profile-${field.key}`}
                    type={field.type ?? "text"}
                    step={field.step}
                    value={form.values[field.key] ?? ""}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="border-border"
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-descricao">Descrição</Label>
              <Textarea
                id="profile-descricao"
                value={form.descricao ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
                placeholder="Observações sobre este perfil..."
                className="border-border min-h-[80px]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={!form.name.trim()}
                className="bg-gradient-primary hover:bg-primary-glow text-primary-foreground shadow-brew"
              >
                Salvar Perfil
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {profiles.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-lg">
          <p>Nenhum perfil de {def.title.toLowerCase()} salvo ainda</p>
          <p className="text-sm">Clique em "Novo Perfil" para criar o primeiro</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {profiles.map((profile) => (
            <Card key={profile.id} className="shadow-foam border-border/50">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-foreground">{profile.name}</CardTitle>
                  {profile.descricao && (
                    <p className="text-sm text-muted-foreground mt-1">{profile.descricao}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(profile)} aria-label="Editar perfil">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(profile.id)} aria-label="Excluir perfil">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {def.fields.map((field) => {
                    const value = profile.values[field.key];
                    if (!value) return null;
                    return (
                      <div key={field.key}>
                        <dt className="text-muted-foreground">{field.label}</dt>
                        <dd className="text-foreground font-medium">{value}</dd>
                      </div>
                    );
                  })}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
