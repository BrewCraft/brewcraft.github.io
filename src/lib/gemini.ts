import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Recipe } from "./recipe-calc";

export const ALLOWED_GEMINI_MODELS = [
  "gemini-4-argon",
  "gemini-2.5-pro",
  "gemini-3.6-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
] as const;

export const resolveGeminiModelName = (modelName?: string | null) => {
  const normalized = (modelName ?? "").trim();
  return ALLOWED_GEMINI_MODELS.includes(normalized as typeof ALLOWED_GEMINI_MODELS[number])
    ? normalized
    : "gemini-4-argon";
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
const SYSTEM_PROMPT = `Você é o Assistente IA do BrewCraft, um especialista em cervejaria artesanal altamente qualificado.
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
- Quando solicitado a criar uma receita, você DEVE retornar a receita em um bloco de código JSON estruturado conforme o esquema do BrewCraft, seguido de uma explicação textual.

Esquema JSON para receitas (resumo):
{
  "name": "Nome da Cerveja",
  "styleCode": "Código BJCP (ex: 18B)",
  "equipment": { "batchL": 20, "efficiency": 72, "boilMinutes": 60, "evaporationLh": 4, "trubLossL": 1, "fermenterLossL": 1 },
  "fermentables": [{ "name": "Nome", "kg": 5, "potential": 1.037, "color": 5, "type": "grao" }],
  "hops": [{ "name": "Nome", "grams": 20, "alpha": 12, "minutes": 60, "use": "fervura" }],
  "yeasts": [{ "name": "Nome", "attenuation": 75, "packs": 1 }],
  "mashSteps": [{ "name": "Mostura", "tempC": 66, "minutes": 60 }],
  "notes": "Observações adicionais"
}
`;

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string, modelName: string = "gemini-4-argon") {
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
