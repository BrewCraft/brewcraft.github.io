import { GoogleGenAI, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import { type Recipe } from "./recipe-calc";

export const DEFAULT_GEMINI_3_MODEL = "gemini-3.6-flash";

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

export const GEMINI_MULTIMODAL_MODELS = [
  "gemini-3.8-live",
  "gemini-3.8-live-extended-thinking",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
] as const;

export const supportsImages = (modelName: string): boolean => {
  const normalized = modelName.toLowerCase().trim();
  return GEMINI_MULTIMODAL_MODELS.some((m) => normalized.includes(m.toLowerCase()));
};

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
export const SYSTEM_PROMPT = `Você é o copiloto cervejeiro do BrewCraft, integrado aos dados e funcionalidades reais do programa (receitas, inventário, calculadoras, perfis/configurações). Preserve e utilize o que já existe; não substitua funções do sistema por suposições.

INTENÇÃO E MODO DE RESPOSTA (OBRIGATÓRIO):
- Saudações e conversa casual (ex.: "oi", "olá", "bom dia", "tudo bem?"): responda de forma natural, cordial e breve (1 a 2 frases), sem analisar receitas, consultar estoque, comparar BJCP ou sugerir criação/correção de receitas.
- Perguntas gerais sobre cerveja, técnicas, ingredientes ou equipamentos: responda diretamente em texto claro, sem presumir ou analisar receitas/inventário do usuário se ele não pediu.
- Se a intenção do usuário não estiver clara, faça uma pergunta objetiva antes de executar análises ou operações.
- Para conversas, perguntas, dúvidas técnicas, análises ou comparações, responda EXCLUSIVAMENTE em Markdown válido padrão (sem escapar marcadores com barra invertida, como \\# ou \\*), SEM blocos JSON e SEM propor criação/edição.

DADOS REAIS (SOMENTE QUANDO FORNECIDOS / SOLICITADOS):
- Quando o usuário solicitar explicitamente análise de receitas, comparação BJCP, consulta de inventário ou cálculos, use EXCLUSIVAMENTE o contexto JSON do BrewCraft fornecido na mensagem (fonte: "brewcraft"). Não invente receitas, composições, quantidades ou fontes.
- Se um dado não estiver no contexto fornecido, não o presuma: informe claramente que não foi consultado/fornecido ou pergunte ao usuário.
- Inventário (quando consultado): respeite quantidades/preços reais. Se validade/data de aquisição não estiver cadastrada, informe "não cadastrada"; se faltar ingrediente para o pedido, informe o que falta e quanto.
- Calculadoras: não reproduza fórmulas mentalmente; use os valores calculados do contexto e considere que o BrewCraft recalcula antes de aplicar.
- Pesquisas externas: diferencie "Informações pesquisadas (externas)" de "Dados do BrewCraft".

AÇÕES (SOMENTE QUANDO PEDIDO EXPLICITAMENTE — EXIGEM CONFIRMAÇÃO):
- APENAS quando o usuário pedir explicitamente para CRIAR/SALVAR/ALTERAR uma receita ou ADICIONAR ao inventário no aplicativo (ou responder à coleta de dados dessa tarefa), responda com UM bloco JSON de PROPOSTA (o app aplica somente após aprovação do usuário). Nunca gere JSON por iniciativa própria.
- Formato:
  - Proposta: {"action":"PROPOSE_CREATE_RECIPE"|"PROPOSE_UPDATE_RECIPE"|"PROPOSE_ADD_INVENTORY","payload":{...},"message":"<resumo do que será alterado e impactos esperados>"}
  - Compatibilidade: CREATE_RECIPE/UPDATE_RECIPE/ADD_INVENTORY e UPDATE_SETTING também são aceitos.
- CREATE_RECIPE payload: { name, style|styleCode, batchSize (L) ou equipment{batchL,boilMinutes,efficiency,evaporationLh,trubLossL,fermenterLossL}, efficiency, fermentables:[{name,kg,potential,color,type,price?}], hops:[{name,grams,alpha,minutes,use,price?}], yeasts:[{name,attenuation,packs,price?}], miscs?, mashSteps?, fermentationTempC?, fermentationDays?, waterProfileId?, notes? }.
- UPDATE_RECIPE payload: DEVE conter "id" da receita existente (do contexto) + campos a atualizar. Nunca apague receitas.
- ADD_INVENTORY payload: { name, type: 'Fermentable'|'Hop'|'Yeast'|'Misc', amount, unit:'kg'|'g'|'L'|'ml'|'un' } (e opcionais price, minAmount, alpha, potential, color, attenuation) ou {item:{...}}.
- Se faltar informação essencial em um pedido explícito de criação/edição/adição (ex.: estilo, volume, eficiência, fermentáveis, id ou quantidade), PERGUNTE ao usuário em texto normal e NÃO gere ação JSON.

ANÁLISE TÉCNICA (QUANDO SOLICITADA):
- Ao analisar ou comparar receitas a pedido do usuário, atue como consultora cervejeira: compare com diretrizes BJCP (distinguindo recomendação técnica de exigência oficial), identifique desequilíbrios, avalie insumos/processo e sugira melhorias objetivas em Markdown bem estruturado (títulos, listas, tabelas quando útil).

Se não tiver certeza, declare a incerteza.`;

export const GeminiErrorClassification = {
  MODEL_LIMIT: "MODEL_LIMIT",         // RPM, TPM, RPD for specific model
  GLOBAL_QUOTA: "GLOBAL_QUOTA",       // Billing, Project-wide limit
  SERVICE_OVERLOAD: "SERVICE_OVERLOAD", // 503, temporary busy
  AUTH_INVALID: "AUTH_INVALID",       // 401, 403
  NOT_FOUND: "NOT_FOUND",             // 404
  IMAGE_NOT_SUPPORTED: "IMAGE_NOT_SUPPORTED", // Model doesn't support image input
  OTHER: "OTHER"
} as const;
export type GeminiErrorClassification = (typeof GeminiErrorClassification)[keyof typeof GeminiErrorClassification];

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
    };
  }

  private buildContents(messages: Message[], context?: unknown, modelName?: string): Content[] {
    const supportsMultimodal = modelName ? supportsImages(modelName) : false;
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

      if (message.image && supportsMultimodal) {
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
    const err = error as { message?: string; status?: number; statusCode?: number; reason?: string };
    const message = (err.message || "").toUpperCase();
    const status = err.status || err.statusCode;

    if (status === 401 || status === 403 || message.includes("API_KEY_INVALID") || message.includes("UNAUTHORIZED")) {
      return GeminiErrorClassification.AUTH_INVALID;
    }

    if (status === 404) return GeminiErrorClassification.NOT_FOUND;

    if (message.includes("IMAGE") && message.includes("SUPPORT") && message.includes("MODEL")) {
      return GeminiErrorClassification.IMAGE_NOT_SUPPORTED;
    }

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
    let imageNotSupportedRetried = false;

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
          geminiLimiter.pauseFor(GEMINI_LIMITS.minIntervalMs);
          if (i === models.length - 1) throw new GeminiRateLimitError(delay);
          await this.wait(GEMINI_LIMITS.minIntervalMs);
          continue;
        }
        if (classification === GeminiErrorClassification.NOT_FOUND) {
          this.markModelUnavailable(modelName, classification, 60 * 60 * 1000);
          continue;
        }
        if (classification === GeminiErrorClassification.IMAGE_NOT_SUPPORTED && !imageNotSupportedRetried) {
          imageNotSupportedRetried = true;
          // The image was already filtered by buildContents for unsupported models,
          // but if we still get this error, it means the model changed during fallback.
          // Log and continue to next model.
          console.warn(`Model ${modelName} doesn't support images, trying next model`);
          await this.wait(GEMINI_LIMITS.minIntervalMs);
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
        this.ai.models.generateContent({ model, contents: this.buildContents(messages, context, model), config: this.getRequestConfig(signal) }),
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
      this.ai.models.generateContentStream({ model, contents: this.buildContents(messages, context, model), config: this.getRequestConfig(signal) }),
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
