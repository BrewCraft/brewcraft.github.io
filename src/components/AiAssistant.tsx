import React, { useState, useRef, useEffect } from "react";
import { 
  Send, 
  User, 
  Loader2, 
  PlusCircle, 
  Trash2, 
  Image as ImageIcon, 
  AlertCircle,
  Mic
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { GeminiService, type Message } from "@/lib/gemini";
import {
  AI_SYNC_ENABLED_STORAGE_KEY,
  getSizeMB,
  readStoredAiChats,
  syncAiChats,
  writeStoredAiChats,
  type ChatSession,
} from "@/lib/cloud-sync";
import { useInventory, useRecipes, uid } from "@/lib/store";
import { type Recipe, defaultEquipment, recipeStats, type InventoryItem, type HopUse } from "@/lib/recipe-calc";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const { toast } = useToast();
  const [recipes, setRecipes] = useRecipes();
  const [inventory, setInventory] = useInventory();

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
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
    localStorage.setItem(AI_SYNC_ENABLED_STORAGE_KEY, String(cloudSyncEnabled));
  }, [cloudSyncEnabled]);

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
    if (!apiKey) {
      toast({
        title: "API Key não configurada",
        description: "Configure VITE_GEMINI_API_KEY no seu arquivo .env",
        variant: "destructive",
      });
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
      const gemini = new GeminiService(apiKey);

      const context = {
        recipeCount: recipes.length,
        recipes: recipes.map(r => ({ name: r.name, style: r.styleCode })),
      };

      const streamResult = await gemini.chatStream([...messages, userMessage], context, nextAbortController.signal);
      let streamedText = "";

      for await (const chunk of streamResult.stream) {
        const chunkText = chunk.text;
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

  const normalizeAiRecipe = (recipeLike: Record<string, unknown> | undefined) => {
    const payload = recipeLike ?? {};
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

    const normalizeUse = (value: unknown): HopUse => {
      const raw = String(value ?? "fervura").trim().toLowerCase();
      if (raw.includes("dry") || raw.includes("dryhop") || raw.includes("dry-hop")) return "dryhop";
      if (raw.includes("whirl") || raw.includes("whirlpool")) return "whirlpool";
      if (raw.includes("mosto") || raw.includes("first wort") || raw.includes("first_wort")) return "primeiro_mosto";
      return "fervura";
    };

    const fermentables = Array.isArray(payload.fermentables) && payload.fermentables.length > 0
      ? payload.fermentables.map((item: Record<string, unknown>, index: number) => ({
          id: String(item.id ?? `${uid()}-${index}`),
          name: String(item.name ?? defaultFermentable.name),
          kg: Number(item.kg ?? item.amount ?? 0),
          potential: Number(item.potential ?? item.yield ?? 80) > 0
            ? (Number(item.potential ?? item.yield ?? 80) < 2 ? Number(item.potential ?? item.yield) : 1 + (((Number(item.potential ?? item.yield ?? 80) / 100) * 0.046)))
            : defaultFermentable.potential,
          color: Number(item.color ?? 0),
          type: String(item.type ?? "grao"),
          price: Number(item.price ?? 0),
        }))
      : [defaultFermentable];

    const hops = Array.isArray(payload.hops) && payload.hops.length > 0
      ? payload.hops.map((item: Record<string, unknown>, index: number) => ({
          id: String(item.id ?? `${uid()}-${index}`),
          name: String(item.name ?? defaultHop.name),
          grams: Number(item.grams ?? item.amount ?? 0),
          alpha: Number(item.alpha ?? 5),
          minutes: Number(item.minutes ?? item.time ?? 60),
          use: normalizeUse(item.use),
          price: Number(item.price ?? 0),
        }))
      : [defaultHop];

    const yeasts = Array.isArray(payload.yeasts) && payload.yeasts.length > 0
      ? payload.yeasts.map((item: Record<string, unknown>, index: number) => ({
          id: String(item.id ?? `${uid()}-${index}`),
          name: String(item.name ?? defaultYeast.name),
          attenuation: Number(item.attenuation ?? 75),
          packs: Number(item.packs ?? 1),
          price: Number(item.price ?? 0),
        }))
      : [defaultYeast];

    const finalRecipe: Recipe = {
      id: String(payload.id ?? uid()),
      name: String(payload.name ?? "Nova Receita IA").trim() || "Nova Receita IA",
      styleCode: String(payload.styleCode ?? payload.style ?? "Sem Estilo").trim(),
      author: String(payload.author ?? "IA Assistant"),
      notes: String(payload.notes ?? `Receita gerada automaticamente pela IA em ${new Date().toLocaleString("pt-BR")}`),
      equipment,
      mashSteps: Array.isArray(payload.mashSteps) ? payload.mashSteps.map((step: Record<string, unknown>, index: number) => ({
        name: String(step.name ?? `Etapa ${index + 1}`),
        tempC: Number(step.tempC ?? 66),
        minutes: Number(step.minutes ?? 60),
      })) : [{ name: "Sacarificação", tempC: 66, minutes: 60 }],
      fermentationTempC: Number(payload.fermentationTempC ?? 19),
      fermentationDays: Number(payload.fermentationDays ?? 14),
      fermentables,
      hops,
      yeasts,
      miscs: Array.isArray(payload.miscs) ? payload.miscs.map((item: Record<string, unknown>, index: number) => ({
        id: String(item.id ?? `${uid()}-${index}`),
        name: String(item.name ?? "Adjunto"),
        amount: Number(item.amount ?? 0),
        unit: String(item.unit ?? "un"),
        use: String(item.use ?? "Fervura"),
        price: Number(item.price ?? 0),
      })) : [],
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
        </div>
        <div className="flex w-full flex-row flex-wrap gap-2 md:w-auto">
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

      {!apiKey && (
        <Card className="mb-4 border-destructive bg-destructive/10">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="text-destructive" />
            <div>
              <p className="font-semibold text-destructive">API Key não configurada</p>
              <p className="text-sm">VITE_GEMINI_API_KEY não foi encontrada. O assistente não funcionará sem uma chave válida.</p>
            </div>
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
    </div>
  );
}
