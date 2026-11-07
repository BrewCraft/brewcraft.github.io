import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Recipe } from "./recipe-calc";

export const ALLOWED_GEMINI_MODELS = [
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
] as const;

const FALLBACK_MODELS = [
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

export const resolveGeminiModelName = (modelName?: string | null) => {
  const normalized = (modelName ?? "").trim();
  return ALLOWED_GEMINI_MODELS.includes(normalized as typeof ALLOWED_GEMINI_MODELS[number])
  ? normalized
  : "gemini-2.0-flash-exp";
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
  private genAI: GoogleGenerativeAI;
  private apiKey: string;
  private modelName: string;

  constructor(apiKey: string, modelName: string = "gemini-2.0-flash-exp") {
    this.apiKey = apiKey;
    this.modelName = resolveGeminiModelName(modelName);
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private getModel(name: string) {
    const cleanModelName = name.trim();
    return this.genAI.getGenerativeModel({
      model: cleanModelName || "gemini-2.0-flash-exp",
      systemInstruction: SYSTEM_PROMPT,
      tools: [
        {
          googleSearch: {},
        },
      ],
    });
  }

  async chat(messages: Message[], context?: unknown, signal?: AbortSignal) {
    const modelsToTry = [this.modelName, ...FALLBACK_MODELS.filter(m => m !== this.modelName)];

    for (const modelName of modelsToTry) {
      try {
        const model = this.getModel(modelName);
        const history = messages.slice(0, -1).map(m => ({
          role: m.role === "system" ? "user" : m.role,
          parts: [{ text: m.content || "" }],
        }));

        const lastMessage = messages[messages.length - 1] ?? { role: "user", content: "Olá" };
        const chatSession = model.startChat({ history });

        const promptParts: Array<{ text: string; inlineData?: { data: string; mimeType: string } }> = [{ text: lastMessage.content || "Olá" }];

        if (context) {
          promptParts[0].text += `\n\nContexto do BrewCraft: ${JSON.stringify(context)}`;
        }

        if (lastMessage.image) {
          const imageData = lastMessage.image.split(",")[1];
          const mimeMatch = lastMessage.image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

          promptParts[0] = { text: lastMessage.content || "Analise esta imagem:" };
          promptParts.push({ inlineData: { data: imageData, mimeType } });

          const result = await model.generateContent(promptParts, { signal });
          const text = await result.response.text();
          return text?.trim() || "";
        }

        const result = await chatSession.sendMessage(promptParts, { signal });
        const text = await result.response.text();
        return text?.trim() || "";
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Falha na comunicação com o Gemini";
        const errorName = error instanceof Error ? error.name : "Error";
        const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: number }).status) : undefined;
        const isQuotaError = errorMessage.includes("429") || status === 429;
        const isLastModel = modelName === modelsToTry[modelsToTry.length - 1];

        if (isQuotaError && !isLastModel) {
          console.warn(`Modelo ${modelName} esgotado (429), tentando próximo fallback...`);
          continue;
        }

        if (errorName === "AbortError" || errorMessage.includes("aborted")) {
          return "";
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
    const modelsToTry = [this.modelName, ...FALLBACK_MODELS.filter(m => m !== this.modelName)];

    for (const modelName of modelsToTry) {
      try {
        const model = this.getModel(modelName);
        const history = messages.slice(0, -1).map(m => ({
          role: m.role === "system" ? "user" : m.role,
          parts: [{ text: m.content || "" }],
        }));

        const lastMessage = messages[messages.length - 1] ?? { role: "user", content: "Olá" };
        const chatSession = model.startChat({ history });

        const promptParts: Array<{ text: string; inlineData?: { data: string; mimeType: string } }> = [{ text: lastMessage.content || "Olá" }];

        if (context) {
          promptParts[0].text += `\n\nContexto do BrewCraft: ${JSON.stringify(context)}`;
        }

        if (lastMessage.image) {
          const imageData = lastMessage.image.split(",")[1];
          const mimeMatch = lastMessage.image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

          promptParts[0] = { text: lastMessage.content || "Analise esta imagem:" };
          promptParts.push({ inlineData: { data: imageData, mimeType } });

          return await model.generateContentStream(promptParts, { signal });
        }

        return await chatSession.sendMessageStream(promptParts, { signal });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Falha na comunicação com o Gemini";
        const errorName = error instanceof Error ? error.name : "Error";
        const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: number }).status) : undefined;
        const isQuotaError = errorMessage.includes("429") || status === 429;
        const isLastModel = modelName === modelsToTry[modelsToTry.length - 1];

        if (isQuotaError && !isLastModel) {
          console.warn(`Modelo ${modelName} esgotado (429), tentando próximo fallback...`);
          continue;
        }

        if (errorName === "AbortError" || errorMessage.includes("aborted")) {
          throw error;
        }

        if (isLastModel) throw error;
      }
    }
    throw new Error("Todos os modelos falharam");
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
