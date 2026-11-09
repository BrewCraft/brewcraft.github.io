import { GoogleGenAI, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import { type Recipe } from "./recipe-calc";

export const DEFAULT_GEMINI_3_MODEL = "gemini-3.8-flash";

export const GEMINI_3_FALLBACK_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
] as const;

export const isGemini3TextModel = (modelName?: string | null) => {
  const normalized = (modelName ?? "").trim();
  if (!normalized) return false;
  if (!normalized.toLowerCase().startsWith("gemini-3")) return false;
  if (/gemini-4/i.test(normalized)) return false;
  if (/(image|audio|video|tts|transcribe|embedding|voice|music)/i.test(normalized)) return false;
  return true;
};

export const resolveGeminiModelName = (modelName?: string | null) => {
  const normalized = (modelName ?? "").trim();
  return isGemini3TextModel(normalized) ? normalized : DEFAULT_GEMINI_3_MODEL;
};

export const filterGemini3TextModels = (modelCatalog: Array<Record<string, unknown>> = []) => {
  const normalized = modelCatalog
    .map((model) => {
      const rawName = String(model.name ?? "").trim();
      const displayName = String(model.displayName ?? "").trim();
      const name = rawName.split("/").pop() || rawName || displayName;
      const supportedGenerationMethods = Array.isArray(model.supportedGenerationMethods)
        ? model.supportedGenerationMethods.map((value) => String(value))
        : [];
      const supportedActions = Array.isArray(model.supportedActions)
        ? model.supportedActions.map((value) => String(value))
        : [];

      if (!isGemini3TextModel(name)) return null;
      const relevanceSignals = [...supportedGenerationMethods, ...supportedActions];
      const canGenerateText = relevanceSignals.some((value) => /generatecontent|generatemessage/i.test(value));
      const hasDisallowedFeature = /(image|audio|video|tts|transcribe|embedding|voice|music)/i.test(name);
      if (!canGenerateText && hasDisallowedFeature) return null;
      return canGenerateText || /^gemini-3/i.test(name) ? name : null;
    })
    .filter((value): value is string => Boolean(value));

  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
};

// Types
export interface Message {
  role: "user" | "model" | "system";
  content: string;
  image?: string; // Base64 string
}

export interface AiRecipeResponse {
  recipe: Partial<Recipe>;
  explanation: string;
}

// System Prompt
const SYSTEM_PROMPT = `Você é o agente autônomo do BrewCraft. Quando o usuário pedir para criar uma receita, adicionar algo ao inventário ou alterar uma configuração, você DEVE gerar um único bloco de código JSON com esta estrutura exata, e nada mais:
{
  "action": "ADD_INVENTORY" | "CREATE_RECIPE" | "UPDATE_RECIPE" | "UPDATE_SETTING",
  "payload": { ...dados específicos da ação... },
  "message": "Uma resposta em texto natural e amigável confirmando o que você acabou de fazer."
}
Nunca crie JSON de receita quando o usuário pedir para mexer no inventário.

Você tem acesso e conhecimento sobre as ferramentas do sistema: Calculadoras (IBU, ABV, Correção de Densidade, etc.), Inventário (Maltes, Lúpulos, Leveduras), Receitas, Configurações e histórico de uso do app. Quando o usuário tiver uma dúvida que possa ser resolvida por essas ferramentas, sugira o uso delas no menu lateral.

Seu objetivo é ajudar cervejeiros com dúvidas técnicas, criação de receitas, análise de problemas e sugestões de melhoria.

Conhecimentos específicos:
- Brassagem e mosturação (rampas, tempos, pH).
- Maltes, adjuntos e suas contribuições.
- Lúpulos, amargor (IBU) e técnicas (First Wort, Whirlpool, Dry Hop).
- Leveduras e fermentação (taxas de inoculação, atenuação, perfis).
- Cálculos cervejeiros: OG, FG, ABV, SRM (cor), BU/GU.
- Tratamento de água: sais minerais, pH e perfis de estilo.
- Estilos de cerveja (BJCP).
- Defeitos (off-flavors) e como corrigi-los.
- Equipamentos e boas práticas de sanitização.

Diretrizes:
- Seja tecnicamente preciso, didático e objetivo.
- Se não tiver certeza de algo, informe a incerteza em vez de inventar dados.
- Quando o usuário pedir para criar, salvar ou alterar uma receita, NUNCA diga que não consegue. Em vez disso, responda com JSON no formato da ação CREATE_RECIPE ou UPDATE_RECIPE conforme o caso.
- Quando o usuário pedir para adicionar ou ajustar itens no inventário, responda exclusivamente com JSON de ação ADD_INVENTORY.
- Para ADD_INVENTORY, o 'payload' DEVE seguir estritamente o formato: { name: string, type: 'Fermentable' | 'Hop' | 'Yeast' | 'Misc', amount: number, unit: 'kg' | 'g' | 'L' | 'ml' | 'un' }. Não invente outros campos. Use somente essas chaves, esses valores permitidos e o nome real do item do inventário (ex.: "Pale Ale", "Cascade", "SafAle US-05").
- Para CREATE_RECIPE, o 'payload' DEVE obrigatoriamente conter a estrutura completa de uma receita do BrewCraft: { name: string, style: string, batchSize: number, boilTime: number, efficiency: number, fermentables: [{ name, amount, color, yield, type }], hops: [{ name, amount, alpha, use, time }], yeasts: [{ name, attenuation }] }. Você DEVE popular esses arrays de ingredientes com dados realistas para que o sistema consiga calcular a cor, o IBU e o ABV. Nunca envie arrays vazios.
- Para UPDATE_RECIPE, o payload DEVE conter obrigatoriamente o 'id' da receita que será editada (você tem acesso aos IDs reais no contexto injetado), juntamente com a estrutura completa ou parcial da receita atualizada. Nunca apague receitas.
- Quando o usuário pedir para alterar uma configuração, responda exclusivamente com JSON de ação UPDATE_SETTING.
- Quando o usuário tiver dúvida que pode ser resolvida por ferramentas do app, sugira usar o menu lateral correspondente.
`;

export class GeminiService {
  private ai: GoogleGenAI;
  private apiKey: string;
  private modelName: string;

  constructor(apiKey: string, modelName: string = DEFAULT_GEMINI_3_MODEL) {
    this.apiKey = apiKey;
    this.modelName = resolveGeminiModelName(modelName);
    this.ai = new GoogleGenAI({ apiKey });
  }

  private getRequestConfig(signal?: AbortSignal): GenerateContentConfig {
    return {
      abortSignal: signal,
      systemInstruction: SYSTEM_PROMPT,
      tools: [
        {
          googleSearch: {},
        },
      ],
    };
  }

  private buildContents(messages: Message[], context?: unknown): Content[] {
    return messages.map((message, index) => {
      const role = message.role === "system" ? "user" : message.role === "model" ? "model" : "user";
      const parts: Part[] = [];
      const isLastMessage = index === messages.length - 1;

      let text = message.content ?? "";
      if (isLastMessage && context !== undefined && context !== null && message.role === "user") {
        text += `\n\nContexto do BrewCraft: ${JSON.stringify(context)}`;
      }

      if (text) {
        parts.push({ text });
      }

      if (message.image) {
        const imageData = message.image.includes(",") ? message.image.split(",")[1] : message.image;
        const mimeMatch = message.image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
        parts.push({
          inlineData: {
            mimeType,
            data: imageData,
          },
        });
      }

      return {
        role,
        parts,
      };
    });
  }

  async chat(messages: Message[], context?: unknown, signal?: AbortSignal) {
    const modelsToTry = [this.modelName, ...GEMINI_3_FALLBACK_MODELS.filter((model) => model !== this.modelName)];

    for (const modelName of modelsToTry) {
      try {
        const response = await this.ai.models.generateContent({
          model: modelName,
          contents: this.buildContents(messages, context),
          config: this.getRequestConfig(signal),
        });
        return response.text?.trim() || "";
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Falha na comunicação com o Gemini";
        const errorName = error instanceof Error ? error.name : "Error";
        const status = typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: number }).status)
          : undefined;
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;
        const isQuotaError = errorMessage.includes("429") || status === 429 || statusCode === 429;
        const isLastModel = modelName === modelsToTry[modelsToTry.length - 1];

        if (isQuotaError && !isLastModel) {
          console.warn(`Modelo ${modelName} esgotado (429), tentando próximo fallback...`);
          continue;
        }

        if (errorName === "AbortError" || errorMessage.includes("aborted")) {
          return "";
        }

        if (status === 401 || statusCode === 401 || /api key|invalid.*key|unauthorized/i.test(errorMessage)) {
          throw new Error("Chave da API Gemini inválida ou sem autorização para este modelo.");
        }

        console.error(`Gemini API Error (${modelName}):`, error);
        if (isLastModel) {
          throw new Error(errorMessage);
        }
      }
    }
    return "";
  }

  async chatStream(messages: Message[], context?: unknown, signal?: AbortSignal) {
    const modelsToTry = [this.modelName, ...GEMINI_3_FALLBACK_MODELS.filter((model) => model !== this.modelName)];

    for (const modelName of modelsToTry) {
      try {
        const responseStream = await this.ai.models.generateContentStream({
          model: modelName,
          contents: this.buildContents(messages, context),
          config: this.getRequestConfig(signal),
        });

        return { stream: responseStream };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Falha na comunicação com o Gemini";
        const errorName = error instanceof Error ? error.name : "Error";
        const status = typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: number }).status)
          : undefined;
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;
        const isQuotaError = errorMessage.includes("429") || status === 429 || statusCode === 429;
        const isLastModel = modelName === modelsToTry[modelsToTry.length - 1];

        if (isQuotaError && !isLastModel) {
          console.warn(`Modelo ${modelName} esgotado (429), tentando próximo fallback...`);
          continue;
        }

        if (errorName === "AbortError" || errorMessage.includes("aborted")) {
          throw error;
        }

        if (status === 401 || statusCode === 401 || /api key|invalid.*key|unauthorized/i.test(errorMessage)) {
          throw new Error("Chave da API Gemini inválida ou sem autorização para este modelo.");
        }

        if (isLastModel) throw error;
      }
    }

    throw new Error("Todos os modelos Gemini 3 disponíveis falharam");
  }

  // Extract JSON recipe from text response
  static extractRecipe(text: string): Partial<Recipe> | null {
    try {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      const jsonMatch = fenced || text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        const jsonStr = fenced ? fenced[1] : jsonMatch[1];
        return JSON.parse(jsonStr.trim());
      }
    } catch (e) {
      console.error("Failed to extract recipe JSON", e);
    }
    return null;
  }
}
