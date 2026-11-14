import { GoogleGenAI, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import { type Recipe } from "./recipe-calc";

export const DEFAULT_GEMINI_3_MODEL = "gemini-3.8-flash";

export const GEMINI_3_LIVE_MODELS = [
  "gemini-3.8-live",
  "gemini-3.8-live-extended-thinking",
] as const;

export const GEMINI_3_FALLBACK_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
] as const;

export type GeminiModelType = typeof GEMINI_3_FALLBACK_MODELS[number] | typeof GEMINI_3_LIVE_MODELS[number];

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

export enum GeminiErrorClassification {
  MODEL_LIMIT = "MODEL_LIMIT",         // RPM, TPM, RPD for specific model
  GLOBAL_QUOTA = "GLOBAL_QUOTA",       // Billing, Project-wide limit
  SERVICE_OVERLOAD = "SERVICE_OVERLOAD", // 503, temporary busy
  AUTH_INVALID = "AUTH_INVALID",       // 401, 403
  NOT_FOUND = "NOT_FOUND",             // 404
  OTHER = "OTHER"
}

export interface GeminiError extends Error {
  status?: number;
  statusCode?: number;
  reason?: string;
  retryAfter?: number;
  classification?: GeminiErrorClassification;
}

export interface ChatResponse {
  text: string;
  modelUsed: string;
  isFallback: boolean;
  classification?: GeminiErrorClassification;
}

// ---- Rate-limit safeguards (shared by every Gemini text request) ----
export const GEMINI_LIMITS = {
  maxRequestsPerMinute: 10,
  minIntervalMs: 3000,
  maxAttemptsPerMessage: 3,
  defaultCooldownMs: 60000,
} as const;

export class GeminiRateLimitError extends Error {
  waitMs: number;
  constructor(waitMs: number) {
    super(`Limite de uso da IA atingido. Aguarde ${Math.max(1, Math.ceil(waitMs / 1000))}s antes de enviar outra mensagem.`);
    this.name = "GeminiRateLimitError";
    this.waitMs = waitMs;
  }
}

export class RequestLimiter {
  private stamps: number[] = [];
  private cooldownUntil = 0;
  constructor(
    private maxPerMinute: number = GEMINI_LIMITS.maxRequestsPerMinute,
    private minIntervalMs: number = GEMINI_LIMITS.minIntervalMs,
  ) {}

  /** Returns 0 when a request may go out now, otherwise how many ms to wait. */
  waitTime(now = Date.now()): number {
    this.stamps = this.stamps.filter((t) => now - t < 60000);
    let wait = Math.max(0, this.cooldownUntil - now);
    const last = this.stamps[this.stamps.length - 1];
    if (last !== undefined) wait = Math.max(wait, last + this.minIntervalMs - now);
    if (this.stamps.length >= this.maxPerMinute) wait = Math.max(wait, this.stamps[0] + 60000 - now);
    return wait;
  }

  /** Reserves a slot or throws GeminiRateLimitError (never waits silently). */
  acquire(now = Date.now()) {
    const wait = this.waitTime(now);
    if (wait > 0) throw new GeminiRateLimitError(wait);
    this.stamps.push(now);
  }

  pauseFor(ms: number, now = Date.now()) {
    this.cooldownUntil = Math.max(this.cooldownUntil, now + ms);
  }
}

export const geminiLimiter = new RequestLimiter();

/** Reads the server-suggested retry delay ("retryDelay":"23s" / "retry in 23.5s"). */
export const parseRetryDelayMs = (error: unknown): number | null => {
  const err = error as { message?: string; retryAfter?: number };
  if (typeof err?.retryAfter === "number" && err.retryAfter > 0) return err.retryAfter * 1000;
  const msg = String(err?.message ?? "");
  const m = msg.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i) || msg.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
};

// Global registry for model availability to avoid retrying failed models too soon
const modelBlacklist: Record<string, { until: number; reason: GeminiErrorClassification }> = {};

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

  private classifyError(error: unknown): GeminiErrorClassification {
    const err = error as any;
    const message = (err.message || "").toUpperCase();
    const status = err.status || err.statusCode;

    if (status === 401 || status === 403 || message.includes("API_KEY_INVALID") || message.includes("UNAUTHORIZED")) {
      return GeminiErrorClassification.AUTH_INVALID;
    }

    if (status === 404) return GeminiErrorClassification.NOT_FOUND;

    if (status === 429) {
      if (message.includes("BILLING") || message.includes("PLAN") || message.includes("PROJECT QUOTA") || message.includes("ACCOUNT")) {
        return GeminiErrorClassification.GLOBAL_QUOTA;
      }
      return GeminiErrorClassification.MODEL_LIMIT;
    }

    if (status >= 500 || message.includes("OVERLOADED") || message.includes("BUSY") || message.includes("SERVICE_UNAVAILABLE")) {
      return GeminiErrorClassification.SERVICE_OVERLOAD;
    }

    return GeminiErrorClassification.OTHER;
  }

  private async wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isModelAvailable(model: string): boolean {
    const record = modelBlacklist[model];
    if (!record) return true;
    if (Date.now() > record.until) {
      delete modelBlacklist[model];
      return true;
    }
    return false;
  }

  private markModelUnavailable(model: string, classification: GeminiErrorClassification, durationMs: number = 60000) {
    modelBlacklist[model] = {
      until: Date.now() + durationMs,
      reason: classification
    };
  }

  private modelsToTry() {
    const allModels = [this.modelName, ...GEMINI_3_FALLBACK_MODELS.filter((model) => model !== this.modelName)];
    const available = allModels.filter((m) => this.isModelAvailable(m));
    if (available.length === 0) {
      const soonest = Math.min(...allModels.map((m) => modelBlacklist[m]?.until ?? Date.now()));
      throw new GeminiRateLimitError(soonest - Date.now());
    }
    return available.slice(0, GEMINI_LIMITS.maxAttemptsPerMessage);
  }

  /** Runs one request with strict limits: at most maxAttemptsPerMessage calls, no hidden loops. */
  private async run<T>(request: (model: string) => Promise<T>): Promise<{ result: T; modelUsed: string }> {
    const models = this.modelsToTry();
    let lastError: GeminiError | null = null;
    let overloadRetried = false;

    for (let i = 0; i < models.length; i++) {
      const modelName = models[i];
      geminiLimiter.acquire();
      try {
        return { result: await request(modelName), modelUsed: modelName };
      } catch (error: unknown) {
        lastError = error as GeminiError;
        const classification = this.classifyError(error);
        lastError.classification = classification;

        if (lastError.name === "AbortError" || String(lastError.message).includes("aborted")) throw lastError;
        if (classification === GeminiErrorClassification.AUTH_INVALID) throw new Error("Chave da API Gemini inválida ou sem autorização.");
        if (classification === GeminiErrorClassification.GLOBAL_QUOTA) {
          geminiLimiter.pauseFor(parseRetryDelayMs(error) ?? GEMINI_LIMITS.defaultCooldownMs * 5);
          throw new Error("Cota do projeto esgotada no Google AI Studio. Trocar de modelo não resolve; aguarde ou verifique o faturamento.");
        }
        if (classification === GeminiErrorClassification.MODEL_LIMIT) {
          const delay = parseRetryDelayMs(error) ?? GEMINI_LIMITS.defaultCooldownMs;
          this.markModelUnavailable(modelName, classification, delay);
          // short pause so the fallback does not fire in the same instant
          geminiLimiter.pauseFor(GEMINI_LIMITS.minIntervalMs);
          if (i === models.length - 1) throw new GeminiRateLimitError(delay);
          await this.wait(GEMINI_LIMITS.minIntervalMs);
          continue;
        }
        if (classification === GeminiErrorClassification.NOT_FOUND) {
          // model does not exist for this key: skip it for an hour instead of retrying every message
          this.markModelUnavailable(modelName, classification, 60 * 60 * 1000);
          continue;
        }
        if (classification === GeminiErrorClassification.SERVICE_OVERLOAD && !overloadRetried) {
          overloadRetried = true;
          await this.wait(GEMINI_LIMITS.minIntervalMs);
          i--; // one single retry on the same model
          continue;
        }
        console.error(`Gemini API Error (${modelName}):`, error);
        throw lastError;
      }
    }
    throw lastError || new Error("Falha ao comunicar com os modelos Gemini.");
  }

  async chat(messages: Message[], context?: unknown, signal?: AbortSignal): Promise<ChatResponse> {
    try {
      const { result, modelUsed } = await this.run((model) =>
        this.ai.models.generateContent({ model, contents: this.buildContents(messages, context), config: this.getRequestConfig(signal) }),
      );
      return { text: result.text?.trim() || "", modelUsed, isFallback: modelUsed !== this.modelName };
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError" || String(err.message).includes("aborted")) return { text: "", modelUsed: this.modelName, isFallback: false };
      throw error;
    }
  }

  async chatStream(messages: Message[], context?: unknown, signal?: AbortSignal) {
    const { result, modelUsed } = await this.run((model) =>
      this.ai.models.generateContentStream({ model, contents: this.buildContents(messages, context), config: this.getRequestConfig(signal) }),
    );
    return { stream: result, modelUsed, isFallback: modelUsed !== this.modelName };
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
