import React, { useState, useRef, useEffect } from "react";
import { 
  Send, 
  User, 
  Loader2, 
  PlusCircle, 
  Trash2, 
  Image as ImageIcon, 
  AlertCircle,
  Mic,
  Key,
  ExternalLink,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  DEFAULT_GEMINI_MODEL,
  GEMINI_FALLBACK_MODELS,
  GeminiService,
  isSupportedGeminiModel,
  filterSupportedGeminiModels,
  cleanApiKey,
  getStoredApiKey,
  setStoredApiKey,
  GEMINI_API_KEY_STORAGE_KEY,
  type Message 
} from "@/lib/gemini";
import {
  AI_SYNC_ENABLED_STORAGE_KEY,
  getSizeMB,
  readStoredAiChats,
  syncAiChats,
  writeStoredAiChats,
  type ChatSession,
} from "@/lib/cloud-sync";
import { useInventory, useRecipes, uid } from "@/lib/store";
import { type Recipe, defaultEquipment, recipeStats, type InventoryItem } from "@/lib/recipe-calc";
import { saveSettings } from "@/lib/settings";
import geminiLogo from "../../gemini-svg.svg";

type AiAction = {
  action: "ADD_INVENTORY" | "CREATE_RECIPE" | "UPDATE_RECIPE" | "UPDATE_SETTING";
  payload: Record<string, unknown>;
  message: string;
};

const parseRecipeMarkdown = (content: string) => {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return null;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    const jsonText = fenceMatch[1].trim();
    const before = trimmed.slice(0, fenceMatch.index ?? 0).trim();
    const after = trimmed.slice((fenceMatch.index ?? 0) + fenceMatch[0].length).trim();

    try {
      return {
        recipe: JSON.parse(jsonText),
        explanation: [before, after].filter(Boolean).join("\n\n") || "Receita pronta para importação.",
      };
    } catch {
      return null;
    }
  }

  const jsonMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) return null;

  try {
    return {
      recipe: JSON.parse(jsonMatch[1]),
      explanation: trimmed.replace(jsonMatch[1], "").trim() || "Receita pronta para importação.",
    };
  } catch {
    return null;
  }
};

const parseAiAction = (content: string): AiAction | null => {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return null;

  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push(fenced[1].trim());

  if (trimmed.startsWith("{")) {
    candidates.push(trimmed);
  } else {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && typeof parsed.action === "string" && typeof parsed.message === "string") {
        return {
          action: parsed.action,
          payload: parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {},
          message: parsed.message,
        };
      }
    } catch {
      // Ignore malformed JSON and continue searching.
    }
  }

  return null;
};


export default function AiAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(AI_SYNC_ENABLED_STORAGE_KEY) === "true";
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<{ text: string; image?: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>(GEMINI_FALLBACK_MODELS as unknown as string[]);
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_GEMINI_MODEL;
    const savedModel = localStorage.getItem("brewcraft-ai-model")?.trim();
    return isSupportedGeminiModel(savedModel) ? savedModel! : DEFAULT_GEMINI_MODEL;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const { toast } = useToast();
  const [recipes, setRecipes] = useRecipes();
  const [inventory, setInventory] = useInventory();

  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [isKeyDialogOpen, setIsKeyDialogOpen] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyStatus, setKeyStatus] = useState<"idle" | "testing" | "valid" | "invalid">("idle");
  const [keyStatusMsg, setKeyStatusMsg] = useState<string | null>(null);
  const [apiAuthError, setApiAuthError] = useState<string | null>(null);

  const hasCustomKey = typeof window !== "undefined" && Boolean(cleanApiKey(localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY)));
  const totalHistorySizeMB = history.reduce((total, chat) => total + Number(getSizeMB(chat)), 0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    localStorage.setItem("brewcraft-ai-model", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem(AI_SYNC_ENABLED_STORAGE_KEY, String(cloudSyncEnabled));
  }, [cloudSyncEnabled]);

  useEffect(() => {
    const handleKeyChange = () => {
      setApiKey(getStoredApiKey());
      setApiAuthError(null);
    };
    window.addEventListener("brewcraft-apikey-changed", handleKeyChange);
    window.addEventListener("storage", handleKeyChange);
    return () => {
      window.removeEventListener("brewcraft-apikey-changed", handleKeyChange);
      window.removeEventListener("storage", handleKeyChange);
    };
  }, []);

  useEffect(() => {
    const key = cleanApiKey(apiKey);
    if (!key || typeof window === "undefined") {
      setAvailableModels(GEMINI_FALLBACK_MODELS as unknown as string[]);
      setSelectedModel((prev) => isSupportedGeminiModel(prev) ? prev : DEFAULT_GEMINI_MODEL);
      return;
    }

    let isMounted = true;
    const fetchAvailableModels = async () => {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
        if (!response.ok) {
          if (response.status === 401 && isMounted) {
            setApiAuthError("A chave da API Gemini é inválida ou não possui autorização (HTTP 401).");
          }
          throw new Error(`HTTP ${response.status}`);
        }

        if (isMounted) setApiAuthError(null);
        const payload = await response.json();
        const models = Array.isArray(payload.models)
          ? filterSupportedGeminiModels(payload.models as Array<Record<string, unknown>>)
          : [];

        console.log("Modelos Gemini disponíveis para esta API Key:", models);

        if (isMounted) {
          const list = models.length > 0 ? models : (GEMINI_FALLBACK_MODELS as unknown as string[]);
          setAvailableModels(list);

          setSelectedModel((prev) => {
            const validCurrent = isSupportedGeminiModel(prev) && list.includes(prev) ? prev : (list[0] ?? DEFAULT_GEMINI_MODEL);
            localStorage.setItem("brewcraft-ai-model", validCurrent);
            return validCurrent;
          });
        }
      } catch (error) {
        console.error("Erro ao listar modelos Gemini:", error);
        if (isMounted) {
          setAvailableModels(GEMINI_FALLBACK_MODELS as unknown as string[]);
          setSelectedModel((prev) => (isSupportedGeminiModel(prev) ? prev : DEFAULT_GEMINI_MODEL));
        }
      }
    };

    void fetchAvailableModels();
    return () => {
      isMounted = false;
    };
  }, [apiKey]);

  useEffect(() => {
    const savedChats = readStoredAiChats();
    if (savedChats.length > 0) {
      setHistory(savedChats);
      setActiveChatId(savedChats[0].id);
      setMessages(savedChats[0].messages);
    }
  }, []);

  useEffect(() => {
    if (isHistoryOpen && cloudSyncEnabled) {
      void (async () => {
        await syncAiChats();
        setHistory(readStoredAiChats());
      })();
    }
  }, [isHistoryOpen, cloudSyncEnabled]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleRecording = () => {
    if (typeof window === "undefined") return;

    type SpeechRecognitionInstance = {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult?: ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string };
        }>;
      }) => void) | null;
      onend?: (() => void) | null;
      onerror?: ((event: { error?: string }) => void) | null;
      start: () => void;
      stop: () => void;
    };

    const SpeechRecognition =
      (window as Window & {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      }).SpeechRecognition ||
      (window as Window & {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      toast({
        title: "Microfone não suportado",
        description: "Seu navegador não oferece suporte para reconhecimento de voz.",
        variant: "destructive",
      });
      return;
    }

    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript) {
        setInput((prev) => prev + (prev.length > 0 ? " " : "") + finalTranscript.trim());
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsRecording(false);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    setIsRecording(true);
    recognition.start();
  };

  const persistChatHistory = (nextMessages: Message[], chatIdOverride?: string) => {
    const sessionId = chatIdOverride ?? activeChatId ?? uid();
    const firstUserMessage = nextMessages.find((message) => message.role === "user")?.content?.trim();
    const title = (firstUserMessage && firstUserMessage.length > 0 ? firstUserMessage : "Nova conversa")
      .replace(/\s+/g, " ")
      .slice(0, 48);

    const nextSession: ChatSession = {
      id: sessionId,
      title,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
    };

    setActiveChatId(sessionId);
    setHistory((prev) => {
      const existing = prev.some((session) => session.id === sessionId);
      const nextHistory = existing
        ? prev.map((session) => (session.id === sessionId ? nextSession : session))
        : [nextSession, ...prev];
      writeStoredAiChats(nextHistory);
      return nextHistory;
    });
  };

  const openKeyDialog = () => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || "" : "";
    setKeyInput(cleanApiKey(stored));
    setKeyStatus("idle");
    setKeyStatusMsg(null);
    setIsKeyDialogOpen(true);
  };

  const handleTestKey = async () => {
    const candidate = cleanApiKey(keyInput);
    if (!candidate) {
      setKeyStatus("invalid");
      setKeyStatusMsg("Por favor, informe uma chave para testar.");
      return;
    }
    setKeyStatus("testing");
    setKeyStatusMsg(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(candidate)}`);
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Chave não autorizada (401). Verifique se a chave do Google AI Studio está correta.");
        }
        throw new Error(`Erro na API (${res.status})`);
      }
      setKeyStatus("valid");
      setKeyStatusMsg("Chave válida! Conexão com a API do Gemini confirmada.");
    } catch (err: unknown) {
      setKeyStatus("invalid");
      setKeyStatusMsg(err instanceof Error ? err.message : "Falha ao testar chave");
    }
  };

  const handleSaveKey = () => {
    const candidate = cleanApiKey(keyInput);
    setStoredApiKey(candidate);
    setApiKey(getStoredApiKey());
    setApiAuthError(null);
    setIsKeyDialogOpen(false);
    toast({
      title: "Chave da API salva",
      description: candidate ? "Chave personalizada configurada com sucesso." : "Usando chave padrão do ambiente.",
    });
  };

  const handleRemoveCustomKey = () => {
    setStoredApiKey("");
    setApiKey(getStoredApiKey());
    setKeyInput("");
    setKeyStatus("idle");
    setKeyStatusMsg(null);
    setApiAuthError(null);
    setIsKeyDialogOpen(false);
    toast({
      title: "Chave personalizada removida",
      description: "Voltando a usar a chave padrão do ambiente (se disponível).",
    });
  };

  const retryLastRequest = () => {
    if (!retryMessage) return;
    setInput(retryMessage.text);
    setSelectedImage(retryMessage.image ?? null);
    window.setTimeout(() => {
      void handleSend();
    }, 0);
  };

  const handleSend = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (isRecording) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsRecording(false);
    }

    if (!input.trim() && !selectedImage) return;

    const activeKey = cleanApiKey(apiKey);
    if (!activeKey) {
      toast({
        title: "API Key não configurada",
        description: "Configure sua chave da API Gemini para usar o assistente.",
        variant: "destructive",
      });
      openKeyDialog();
      return;
    }

    if (isLoading) {
      abortControllerRef.current?.abort();
    }

    const currentText = input.trim();
    const currentImage = selectedImage || undefined;
    const userMessage: Message = {
      role: "user",
      content: currentText || input,
      image: currentImage,
    };

    setRetryMessage({
      text: currentText || input,
      image: currentImage,
    });

    const nextAbortController = new AbortController();
    abortControllerRef.current = nextAbortController;
    const currentChatId = activeChatId ?? uid();
    const emptyAssistantMessage: Message = { role: "model", content: "" };
    const nextMessages = [...messages, userMessage, emptyAssistantMessage];

    setMessages(nextMessages);
    persistChatHistory(nextMessages, currentChatId);
    setInput("");
    setSelectedImage(null);
    setIsLoading(true);

    try {
      const gemini = new GeminiService(activeKey, selectedModel);

      const context = {
        recipeCount: recipes.length,
        recipes: recipes.map(r => ({ name: r.name, style: r.styleCode })),
      };

      const streamResult = await gemini.chatStream([...messages, userMessage], context, nextAbortController.signal);
      let streamedText = "";

      for await (const chunk of streamResult.stream) {
        const chunkText = chunk.text || "";
        if (!chunkText) continue;

        streamedText += chunkText;

        setMessages((prev) => {
          const next = [...prev];
          const lastIndex = next.length - 1;
          if (next[lastIndex]?.role !== "model") return prev;

          next[lastIndex] = {
            ...next[lastIndex],
            content: (next[lastIndex].content ?? "") + chunkText,
          };

          persistChatHistory(next, currentChatId);
          return next;
        });
      }

      const finalText = streamedText.trim();
      if (!finalText) {
        setMessages((prev) => {
          const next = [...prev];
          const lastIndex = next.length - 1;
          if (next[lastIndex]?.role === "model") {
            next[lastIndex] = {
              ...next[lastIndex],
              content: "A IA respondeu sem conteúdo. Tente novamente com outra pergunta ou ajuste o contexto da sua mensagem.",
            };
          }
          persistChatHistory(next, currentChatId);
          return next;
        });
      } else {
        const action = parseAiAction(finalText);
        if (action) {
          applyAiAction(finalText);
          setMessages((prev) => {
            const next = [...prev];
            const lastIndex = next.length - 1;
            if (next[lastIndex]?.role === "model") {
              next[lastIndex] = {
                ...next[lastIndex],
                content: action.message,
              };
            }
            persistChatHistory(next, currentChatId);
            return next;
          });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Não foi possível obter resposta da IA";
      const name = error instanceof Error ? error.name : "Error";

      if (name === "AbortError" || message.includes("aborted")) {
        return;
      }

      if (message.includes("401") || message.includes("inválida") || message.includes("autorização")) {
        setApiAuthError(message);
      }

      toast({
        title: "Erro",
        description: message,
        variant: "destructive",
      });
    } finally {
      if (abortControllerRef.current === nextAbortController) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearConversation = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setMessages([]);
    setSelectedImage(null);
    setRetryMessage(null);
    if (activeChatId) {
      setHistory((prev) => {
        const nextHistory = prev.filter((session) => session.id !== activeChatId);
        writeStoredAiChats(nextHistory);
        return nextHistory;
      });
    }
    setActiveChatId(null);
  };

  const deleteChatSession = (chatId: string) => {
    setHistory((prev) => {
      const nextHistory = prev.filter((session) => session.id !== chatId);
      writeStoredAiChats(nextHistory);
      return nextHistory;
    });

    if (activeChatId === chatId) {
      setMessages([]);
      setActiveChatId(null);
    }
  };

  const loadChatSession = (chat: ChatSession) => {
    setMessages(chat.messages);
    setActiveChatId(chat.id);
    setRetryMessage(null);
    setIsHistoryOpen(false);
  };

  const normalizeAiRecipe = (recipeLike: Partial<Recipe> & Record<string, unknown> | undefined) => {
    const payload = (recipeLike ?? {}) as Record<string, unknown>;
    const equipmentSource = (payload.equipment ?? {}) as Record<string, unknown>;
    const defaultFermentable = { id: uid(), name: "Pale Ale", kg: 4, potential: 1.037, color: 3, type: "grao", price: 0 };
    const defaultHop = { id: uid(), name: "Cascade", grams: 25, alpha: 5.5, minutes: 60, use: "fervura" as const, price: 0 };
    const defaultYeast = { id: uid(), name: "SafAle US-05", attenuation: 81, packs: 1, price: 0 };

    const equipment = {
      ...(defaultEquipment),
      ...((payload.equipment ?? {}) as Partial<Recipe["equipment"]>),
      batchL: Number(equipmentSource.batchL ?? payload.batchSize ?? defaultEquipment.batchL) || defaultEquipment.batchL,
      boilMinutes: Number(equipmentSource.boilMinutes ?? payload.boilTime ?? defaultEquipment.boilMinutes) || defaultEquipment.boilMinutes,
      efficiency: Number(equipmentSource.efficiency ?? payload.efficiency ?? defaultEquipment.efficiency) || defaultEquipment.efficiency,
    };

    const normalizeUse = (value: unknown): "fervura" | "dryhop" | "whirlpool" | "primeiro_mosto" => {
      const raw = String(value ?? "fervura").trim().toLowerCase();
      if (raw.includes("dry") || raw.includes("dryhop") || raw.includes("dry-hop")) return "dryhop";
      if (raw.includes("whirl") || raw.includes("whirlpool")) return "whirlpool";
      if (raw.includes("mosto") || raw.includes("first wort") || raw.includes("first_wort")) return "primeiro_mosto";
      return "fervura";
    };

    const rawFermentables = Array.isArray(payload.fermentables) ? (payload.fermentables as Array<Record<string, unknown>>) : [];
    const fermentables = rawFermentables.length > 0
      ? rawFermentables.map((item, index) => ({
          id: String(item?.id ?? `${uid()}-${index}`),
          name: String(item?.name ?? defaultFermentable.name),
          kg: Number(item?.kg ?? item?.amount ?? 0),
          potential: Number(item?.potential ?? item?.yield ?? 80) > 0
            ? (Number(item?.potential ?? item?.yield ?? 80) < 2 ? Number(item?.potential ?? item?.yield) : 1 + (((Number(item?.potential ?? item?.yield ?? 80) / 100) * 0.046)))
            : defaultFermentable.potential,
          color: Number(item?.color ?? 0),
          type: String(item?.type ?? "grao"),
          price: Number(item?.price ?? 0),
        }))
      : [defaultFermentable];

    const rawHops = Array.isArray(payload.hops) ? (payload.hops as Array<Record<string, unknown>>) : [];
    const hops = rawHops.length > 0
      ? rawHops.map((item, index) => ({
          id: String(item?.id ?? `${uid()}-${index}`),
          name: String(item?.name ?? defaultHop.name),
          grams: Number(item?.grams ?? item?.amount ?? 0),
          alpha: Number(item?.alpha ?? 5),
          minutes: Number(item?.minutes ?? item?.time ?? 60),
          use: normalizeUse(item?.use),
          price: Number(item?.price ?? 0),
        }))
      : [defaultHop];

    const rawYeasts = Array.isArray(payload.yeasts) ? (payload.yeasts as Array<Record<string, unknown>>) : [];
    const yeasts = rawYeasts.length > 0
      ? rawYeasts.map((item, index) => ({
          id: String(item?.id ?? `${uid()}-${index}`),
          name: String(item?.name ?? defaultYeast.name),
          attenuation: Number(item?.attenuation ?? 75),
          packs: Number(item?.packs ?? 1),
          price: Number(item?.price ?? 0),
        }))
      : [defaultYeast];

    const rawMashSteps = Array.isArray(payload.mashSteps) ? (payload.mashSteps as Array<Record<string, unknown>>) : [];
    const mashSteps = rawMashSteps.length > 0
      ? rawMashSteps.map((step, index) => ({
          name: String(step?.name ?? `Etapa ${index + 1}`),
          tempC: Number(step?.tempC ?? 66),
          minutes: Number(step?.minutes ?? 60),
        }))
      : [{ name: "Sacarificação", tempC: 66, minutes: 60 }];

    const rawMiscs = Array.isArray(payload.miscs) ? (payload.miscs as Array<Record<string, unknown>>) : [];
    const miscs = rawMiscs.map((item, index) => ({
      id: String(item?.id ?? `${uid()}-${index}`),
      name: String(item?.name ?? "Adjunto"),
      amount: Number(item?.amount ?? 0),
      unit: String(item?.unit ?? "un"),
      use: String(item?.use ?? "Fervura"),
      price: Number(item?.price ?? 0),
    }));

    const finalRecipe: Recipe = {
      id: String(payload.id ?? uid()),
      name: String(payload.name ?? "Nova Receita IA").trim() || "Nova Receita IA",
      styleCode: String(payload.styleCode ?? payload.style ?? "Sem Estilo").trim(),
      author: String(payload.author ?? "IA Assistant"),
      notes: String(payload.notes ?? `Receita gerada automaticamente pela IA em ${new Date().toLocaleString("pt-BR")}`),
      equipment,
      mashSteps,
      fermentationTempC: Number(payload.fermentationTempC ?? 19),
      fermentationDays: Number(payload.fermentationDays ?? 14),
      fermentables,
      hops,
      yeasts,
      miscs,
      createdAt: String(payload.createdAt ?? new Date().toISOString()),
      updatedAt: new Date().toISOString(),
    };

    const computedStats = recipeStats(finalRecipe);
    return {
      ...finalRecipe,
      og: computedStats.og,
      fg: computedStats.fg,
      abv: computedStats.abv,
      ibu: computedStats.ibu,
      srm: computedStats.srm,
    };
  };

  const applyAiAction = (content: string) => {
    try {
      const action = parseAiAction(content);
      if (!action) return false;

      const parsedData = action;
      console.log("Ação interceptada:", parsedData);

      switch (action.action) {
        case "ADD_INVENTORY": {
          const rawItem = (action.payload?.item ?? action.payload) as Record<string, unknown> | undefined;
          if (!rawItem || typeof rawItem !== "object") {
            throw new Error("Payload de inventário inválido: objeto ausente.");
          }

          const normalizedType = String(rawItem.type ?? rawItem.kind ?? "Misc").trim();
          const typeMap: Record<string, InventoryItem["kind"]> = {
            Fermentable: "fermentavel",
            fermentable: "fermentavel",
            Hop: "lupulo",
            hop: "lupulo",
            Yeast: "levedura",
            yeast: "levedura",
            Misc: "outro",
            misc: "outro",
          };

          const kind = typeMap[normalizedType] ?? "outro";
          const amountRaw = Number(rawItem.amount ?? 0);
          const amount = Number.isFinite(amountRaw) ? amountRaw : 0;
          const name = String(rawItem.name ?? "").trim() || "Item IA";

          const validInventoryUnits = new Set(["kg", "g", "L", "ml", "un"]);
          const requestedUnit = String(rawItem.unit ?? "").trim();
          const normalizedUnit = validInventoryUnits.has(requestedUnit) ? requestedUnit : (() => {
            if (kind === "fermentavel") return "kg";
            if (kind === "lupulo") return "g";
            if (kind === "levedura") return "un";
            return "un";
          })();

          const item: InventoryItem = {
            id: typeof rawItem.id === "string" && rawItem.id.trim()
              ? rawItem.id.trim()
              : (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
                ? globalThis.crypto.randomUUID()
                : Date.now().toString()),
            kind,
            name,
            amount,
            unit: kind === "levedura" ? "pacote" : normalizedUnit,
            price: Number(rawItem.price ?? 0),
            minAmount: Number(rawItem.minAmount ?? 0),
            alpha: rawItem.alpha !== undefined && rawItem.alpha !== null ? Number(rawItem.alpha) : undefined,
            potential: rawItem.potential !== undefined && rawItem.potential !== null ? Number(rawItem.potential) : undefined,
            color: rawItem.color !== undefined && rawItem.color !== null ? Number(rawItem.color) : undefined,
            attenuation: rawItem.attenuation !== undefined && rawItem.attenuation !== null ? Number(rawItem.attenuation) : undefined,
          };

          if (!item.name) {
            throw new Error("Inventário IA: o nome do item não pode ficar vazio.");
          }

          const existingItem = inventory.find((current) =>
            current.kind === item.kind && current.name.toLowerCase() === item.name.toLowerCase(),
          );

          const nextInventory = existingItem
            ? inventory.map((current) => current.id === existingItem.id
              ? { ...current, ...item, amount: Number(current.amount) + Number(item.amount) }
              : current)
            : [item, ...inventory];

          setInventory(nextInventory);
          return true;
        }
        case "CREATE_RECIPE": {
          const recipeData = (action.payload?.recipe ?? action.payload) as Partial<Recipe> & Record<string, unknown> | undefined;
          const newRecipe = normalizeAiRecipe(recipeData);

          setRecipes([...recipes, newRecipe as Recipe]);
          return true;
        }
        case "UPDATE_RECIPE": {
          const payload = action.payload as Partial<Recipe> & Record<string, unknown>;

          if (!payload.id) {
            throw new Error("Payload de atualização de receita inválido: id ausente.");
          }

          const currentRecipes = recipes;
          const previousRecipe = currentRecipes.find((recipe) => recipe.id === payload.id);

          if (!previousRecipe) {
            throw new Error("Receita para atualização não encontrada.");
          }

          const mergedRecipe = {
            ...previousRecipe,
            ...payload,
            id: payload.id,
            updatedAt: new Date().toISOString(),
          } as Recipe;

          const computedStats = recipeStats(mergedRecipe);
          const receitaAtualizadaCalculada = {
            ...mergedRecipe,
            og: computedStats.og,
            fg: computedStats.fg,
            abv: computedStats.abv,
            ibu: computedStats.ibu,
            srm: computedStats.srm,
          } as Recipe;

          const updatedRecipes = currentRecipes.map((recipe) => recipe.id === payload.id ? receitaAtualizadaCalculada : recipe);
          setRecipes(updatedRecipes);
          return true;
        }
        case "UPDATE_SETTING": {
          saveSettings(action.payload as Record<string, unknown>);
          return true;
        }
        default:
          return false;
      }
    } catch (error) {
      console.error("Failed to apply AI action", error);
      return false;
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto">
      <div className="mb-4 flex w-full flex-col flex-wrap items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="flex w-full flex-row flex-wrap items-center gap-2 md:w-auto">
          <img src={geminiLogo} alt="Assistente IA" className="w-16 h-16 object-contain" />
          <h1 className="text-2xl font-bold">Assistente IA</h1>
          <label className="flex items-center gap-2 rounded-md border border-slate-600/70 bg-[#111827]/85 px-2.5 py-1.5 text-xs text-slate-200 shadow-sm backdrop-blur-sm">
            <span className="font-medium text-slate-300">Modelo</span>
            <select
              value={selectedModel}
              onChange={(e) => {
                const nextModel = e.target.value.trim();
                if (isSupportedGeminiModel(nextModel)) {
                  setSelectedModel(nextModel);
                }
              }}
              className="min-w-[220px] rounded-md border border-slate-600/80 bg-[#0f172a] px-2 py-1.5 text-xs text-slate-100 outline-none ring-0 transition focus:border-primary focus:ring-2 focus:ring-primary/30"
              aria-label="Selecionar modelo de IA"
            >
              {(availableModels.length > 0 ? availableModels : [DEFAULT_GEMINI_MODEL]).map((model) => (
                <option key={model} value={model} className="bg-[#0f172a] text-slate-100">
                  {model}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex w-full flex-row flex-wrap gap-2 md:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={openKeyDialog}
            className="flex items-center gap-1.5"
            title="Configurar Chave da API Gemini"
          >
            <Key className="w-3.5 h-3.5 text-primary" />
            <span>API Key</span>
            {hasCustomKey && <span className="h-2 w-2 rounded-full bg-emerald-400" title="Chave personalizada ativa" />}
          </Button>

          <Button variant="outline" size="sm" onClick={() => setIsHistoryOpen((prev) => !prev)}>
            Histórico
          </Button>

          <Button variant="outline" size="sm" onClick={clearConversation}>
            <Trash2 className="w-4 h-4 mr-2" />
            Limpar
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            setMessages([]);
            setActiveChatId(null);
          }}>
            <PlusCircle className="w-4 h-4 mr-2" />
            Nova Conversa
          </Button>
        </div>
      </div>

      {apiAuthError && (
        <Card className="mb-4 border-destructive bg-destructive/10">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="text-destructive h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold text-destructive">Falha de autenticação com o Gemini (HTTP 401)</p>
                <p className="text-sm text-slate-300">
                  A chave de API configurada é inválida ou expirou. Atualize sua chave de API do Google AI Studio para utilizar o assistente.
                </p>
              </div>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={openKeyDialog}
              className="shrink-0"
            >
              <Key className="w-4 h-4 mr-2" />
              Configurar Chave
            </Button>
          </CardContent>
        </Card>
      )}

      {!cleanApiKey(apiKey) && !apiAuthError && (
        <Card className="mb-4 border-destructive bg-destructive/10">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="text-destructive h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold text-destructive">API Key não configurada</p>
                <p className="text-sm text-slate-300">
                  Nenhuma chave da API Gemini foi configurada. Insira sua chave gratuita do Google AI Studio para ativar o assistente.
                </p>
              </div>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={openKeyDialog}
              className="shrink-0"
            >
              <Key className="w-4 h-4 mr-2" />
              Configurar Chave
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-1 gap-4 min-h-0">
        {isHistoryOpen && (
          <aside className="w-80 shrink-0 rounded-xl border border-slate-700/80 bg-slate-900/90 text-slate-100 shadow-lg backdrop-blur-sm overflow-hidden">
            <div className="border-b border-slate-700/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Histórico de chats</h2>
                <span className="text-[10px] text-slate-300">{history.length} chats</span>
              </div>
              <p className="mt-2 text-[11px] text-slate-300">Total: {Number(totalHistorySizeMB).toFixed(3)} MB</p>
            </div>

            <div className="space-y-3 p-3">
              <label className="flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-2 text-xs text-slate-200">
                <span>Habilitar sincronização em nuvem</span>
                <input
                  type="checkbox"
                  checked={cloudSyncEnabled}
                  onChange={(e) => setCloudSyncEnabled(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
              </label>

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setHistory([]);
                  writeStoredAiChats([]);
                  setMessages([]);
                  setActiveChatId(null);
                }}
              >
                Excluir Todos os Chats
              </Button>
            </div>

            <div className="max-h-[calc(100vh-250px)] overflow-y-auto p-3 pt-0">
              {history.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum chat salvo ainda.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((session) => (
                    <div
                      key={session.id}
                      className={`rounded-lg border p-2 text-left transition ${activeChatId === session.id ? "border-primary bg-slate-800" : "border-slate-700 bg-slate-800/60"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => loadChatSession(session)}>
                          <p className="truncate text-sm font-medium text-slate-100">{session.title}</p>
                          <p className="mt-1 text-[10px] text-slate-400">{new Date(session.updatedAt).toLocaleDateString("pt-BR")}</p>
                          <p className="mt-1 text-[10px] text-slate-300">{Number(getSizeMB(session)).toFixed(3)} MB</p>
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-slate-400 hover:text-destructive"
                          onClick={() => deleteChatSession(session.id)}
                          aria-label={`Excluir chat ${session.title}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        <Card className="flex-1 overflow-hidden flex flex-col bg-slate-50/50 dark:bg-slate-900/50 min-h-0">
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4 pt-12">
                <img src={geminiLogo} alt="Assistente IA" className="w-20 h-20 object-contain opacity-20" />
                <div>
                  <p className="text-xl font-medium text-muted-foreground">Como posso ajudar na sua brassagem hoje?</p>
                  <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    Você pode pedir receitas, tirar dúvidas técnicas ou analisar problemas na sua cerveja.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, i) => {
                  const action = m.role === "model" ? parseAiAction(m.content) : null;
                  const recipePreview = !action && m.role === "model" ? parseRecipeMarkdown(m.content) : null;
                  const displayContent = action ? action.message : recipePreview?.explanation || m.content;

                  return (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`flex gap-3 max-w-[85%] ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                        <div className={`mt-1 p-2 rounded-full h-fit ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          {m.role === "user" ? <User className="w-4 h-4" /> : <img src={geminiLogo} alt="Assistente IA" className="w-10 h-10 object-contain" />}
                        </div>
                        <div className="space-y-2">
                          <div className={`p-3 rounded-2xl ${
                            m.role === "user" 
                            ? "bg-primary text-primary-foreground rounded-tr-none" 
                            : "bg-white dark:bg-slate-800 border rounded-tl-none shadow-sm"
                          }`}>
                            {m.image && (
                              <img src={m.image} alt="Upload" className="max-w-xs rounded-lg mb-2 border" />
                            )}

                            {recipePreview ? (
                              <div className="space-y-3">
                                {recipePreview.explanation && (
                                  <p className="text-sm whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-200">
                                    {recipePreview.explanation}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm whitespace-pre-wrap leading-relaxed">{displayContent}</p>
                            )}
                          </div>

                          {m.role === "model" && m.content.includes("A IA respondeu sem conteúdo") && (
                            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-100">
                              <p className="font-medium">Resposta vazia da IA</p>
                              <p className="mt-1">A IA não retornou conteúdo útil. Você pode tentar novamente.</p>
                              <Button 
                                variant="secondary" 
                                size="sm" 
                                className="mt-3 w-full gap-2"
                                type="button"
                                onClick={retryLastRequest}
                              >
                                <Send className="w-4 h-4" />
                                Tentar novamente
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="flex gap-3 max-w-[85%]">
                      <div className="mt-1 p-2 rounded-full bg-muted h-fit">
                        <img src={geminiLogo} alt="Assistente IA" className="w-10 h-10 object-contain" />
                      </div>
                      <div className="bg-white dark:bg-slate-800 border rounded-2xl rounded-tl-none p-4 shadow-sm">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </ScrollArea>

          <form onSubmit={handleSend} className="p-4 bg-white dark:bg-slate-800 border-t">
            {selectedImage && (
              <div className="relative inline-block mb-2">
                <img src={selectedImage} alt="Preview" className="h-20 w-20 object-cover rounded-md border" />
                <button 
                  type="button"
                  onClick={() => setSelectedImage(null)}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-lg"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleImageUpload}
              />
              <Button 
                variant="outline" 
                size="icon" 
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                <ImageIcon className="w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={toggleRecording}
                disabled={isLoading}
                aria-label={isRecording ? "Parar gravação de voz" : "Gravar por voz"}
              >
                <Mic className={`w-5 h-5 ${isRecording ? "text-red-500 animate-pulse" : ""}`} />
              </Button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Pergunte sobre sua cerveja..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button type="submit" disabled={isLoading || (!input.trim() && !selectedImage)}>
                <Send className="w-5 h-5" />
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Dialog open={isKeyDialogOpen} onOpenChange={setIsKeyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              Configurar Chave da API Gemini
            </DialogTitle>
            <DialogDescription>
              Insira sua chave de API do Google AI Studio para habilitar as funções de inteligência artificial do BrewCraft.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Chave da API (Google AI Studio)</label>
              <Input
                type="password"
                placeholder="Ex: AIzaSy..."
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setKeyStatus("idle");
                  setKeyStatusMsg(null);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Sua chave fica armazenada exclusivamente no seu navegador (localStorage).
              </p>
            </div>

            {hasCustomKey && (
              <div className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground flex items-center justify-between">
                <span>Chave personalizada ativa no navegador</span>
                <Badge variant="outline">Personalizada</Badge>
              </div>
            )}

            {!hasCustomKey && cleanApiKey(import.meta.env.VITE_GEMINI_API_KEY) && (
              <div className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground flex items-center justify-between">
                <span>Usando chave padrão do ambiente</span>
                <Badge variant="secondary">Ambiente</Badge>
              </div>
            )}

            {keyStatusMsg && (
              <div className={`p-3 rounded-md text-xs flex items-center gap-2 ${
                keyStatus === "valid" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                keyStatus === "invalid" ? "bg-destructive/10 text-destructive border border-destructive/20" :
                "bg-muted text-muted-foreground"
              }`}>
                {keyStatus === "valid" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
                {keyStatus === "invalid" && <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}
                <span>{keyStatusMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                Obter chave no Google AI Studio
                <ExternalLink className="h-3 w-3" />
              </a>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestKey}
                disabled={keyStatus === "testing" || !cleanApiKey(keyInput)}
              >
                {keyStatus === "testing" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Testando...
                  </>
                ) : (
                  "Testar Conexão"
                )}
              </Button>
            </div>
          </div>

          <DialogFooter className="flex sm:justify-between gap-2 pt-2">
            {hasCustomKey ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemoveCustomKey}
                className="text-muted-foreground hover:text-destructive"
              >
                Remover Chave
              </Button>
            ) : <div />}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsKeyDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveKey}
                disabled={!cleanApiKey(keyInput)}
              >
                Salvar Chave
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
