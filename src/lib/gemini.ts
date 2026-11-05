import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Recipe } from "./recipe-calc";

export const ALLOWED_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
] as const;

export const resolveGeminiModelName = (modelName?: string | null) => {
  const normalized = (modelName ?? "").trim();
  return ALLOWED_GEMINI_MODELS.includes(normalized as typeof ALLOWED_GEMINI_MODELS[number])
    ? normalized
    : "gemini-3.6-flash";
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
  "action": "ADD_INVENTORY" | "CREATE_RECIPE" | "UPDATE_SETTING",
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
- Quando o usuário pedir para criar, salvar ou alterar uma receita, NUNCA diga que não consegue. Em vez disso, responda com JSON no formato da ação CREATE_RECIPE.
- Quando o usuário pedir para adicionar ou ajustar itens no inventário, responda exclusivamente com JSON de ação ADD_INVENTORY.
- Quando o usuário pedir para alterar uma configuração, responda exclusivamente com JSON de ação UPDATE_SETTING.
- Quando o usuário tiver dúvida que pode ser resolvida por ferramentas do app, sugira usar o menu lateral correspondente.
`;

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string, modelName: string = "gemini-3.6-flash") {
    this.genAI = new GoogleGenerativeAI(apiKey);
    const resolvedModelName = resolveGeminiModelName(modelName);

    this.model = this.genAI.getGenerativeModel({
      model: resolvedModelName,
      systemInstruction: SYSTEM_PROMPT,
    });
  }

  async chat(messages: Message[], context?: any, signal?: AbortSignal) {
    const controller = new AbortController();

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    try {
      const history = messages.slice(0, -1).map(m => ({
        role: m.role === "system" ? "user" : m.role,
        parts: [{ text: m.content || "" }],
      }));

      const lastMessage = messages[messages.length - 1] ?? { role: "user", content: "Olá" };
      const chatSession = this.model.startChat({ history });

      let promptParts: any[] = [{ text: lastMessage.content || "Olá" }];

      if (context) {
        promptParts[0].text += `\n\nContexto do BrewCraft: ${JSON.stringify(context)}`;
      }

      if (lastMessage.image) {
        const imageData = lastMessage.image.split(",")[1];
        const mimeMatch = lastMessage.image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

        promptParts = [
          { text: lastMessage.content || "Analise esta imagem:" },
          { inlineData: { data: imageData, mimeType } },
        ];

        const result = await this.model.generateContent(promptParts, { signal: controller.signal });
        const text = await result.response.text();
        return text?.trim() || "";
      }

      const result = await chatSession.sendMessage(promptParts, { signal: controller.signal });
      const text = await result.response.text();
      return text?.trim() || "";
    } catch (error: any) {
      if (error?.name === "AbortError" || error?.message?.includes("aborted")) {
        return "";
      }

      console.error("Gemini API Error:", error);

      const message = typeof error?.message === "string"
        ? error.message
        : "Falha na comunicação com o Gemini";

      throw new Error(message);
    }
  }

  async chatStream(messages: Message[], context?: any, signal?: AbortSignal) {
    const controller = new AbortController();

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    const history = messages.slice(0, -1).map(m => ({
      role: m.role === "system" ? "user" : m.role,
      parts: [{ text: m.content || "" }],
    }));

    const lastMessage = messages[messages.length - 1] ?? { role: "user", content: "Olá" };
    const chatSession = this.model.startChat({ history });

    let promptParts: any[] = [{ text: lastMessage.content || "Olá" }];

    if (context) {
      promptParts[0].text += `\n\nContexto do BrewCraft: ${JSON.stringify(context)}`;
    }

    if (lastMessage.image) {
      const imageData = lastMessage.image.split(",")[1];
      const mimeMatch = lastMessage.image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

      promptParts = [
        { text: lastMessage.content || "Analise esta imagem:" },
        { inlineData: { data: imageData, mimeType } },
      ];

      return await this.model.generateContentStream(promptParts, { signal: controller.signal });
    }

    return await chatSession.sendMessageStream(promptParts, { signal: controller.signal });
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
