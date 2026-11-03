import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Recipe } from "./recipe-calc";

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

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    const modelName = (import.meta.env.VITE_GEMINI_MODEL ?? "").trim() || "gemini-2.0-flash";

    this.model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
    });
  }

  async chat(messages: Message[], context?: any) {
    try {
      const history = messages.slice(0, -1).map(m => ({
        role: m.role === "system" ? "user" : m.role, // Gemini chat history doesn't support 'system' role
        parts: [{ text: m.content }],
      }));

      const lastMessage = messages[messages.length - 1];
      
      const chatSession = this.model.startChat({
        history: history,
      });

      let promptParts: any[] = [{ text: lastMessage.content }];
      
      if (context) {
        promptParts[0].text += `\n\nContexto do BrewCraft: ${JSON.stringify(context)}`;
      }

      if (lastMessage.image) {
        // Handle image input
        const imageData = lastMessage.image.split(",")[1]; // Remove prefix "data:image/png;base64,"
        promptParts = [
          { text: lastMessage.content },
          {
            inlineData: {
              data: imageData,
              mimeType: "image/jpeg" // Defaulting to jpeg, but should ideally be dynamic
            }
          }
        ];
        
        // Multi-modal calls usually use generateContent instead of chat for the specific message
        const result = await this.model.generateContent(promptParts);
        return result.response.text();
      }

      const result = await chatSession.sendMessage(promptParts);
      return result.response.text();
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      throw new Error(error.message || "Falha na comunicação com o Gemini");
    }
  }

  // Extract JSON recipe from text response
  static extractRecipe(text: string): Partial<Recipe> | null {
    try {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonStr);
      }
    } catch (e) {
      console.error("Failed to extract recipe JSON", e);
    }
    return null;
  }
}
