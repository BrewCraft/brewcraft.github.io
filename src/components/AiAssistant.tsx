import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  User,
  Loader2,
  PlusCircle,
  Trash2,
  Image as ImageIcon,
  AlertCircle,
  Mic,
  MicOff,
  Settings2,
  Brain,
  Key,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  HelpCircle,
  Save,
  RotateCcw,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { GeminiService, geminiLimiter, type Message, GEMINI_3_LIVE_MODELS, GEMINI_3_FALLBACK_MODELS, DEFAULT_GEMINI_3_MODEL, supportsImages } from "@/lib/gemini";
import { useGeminiLive } from "@/hooks/use-gemini-live";
import { prepareCopilotTurn, proposeRecipeCreate, proposeRecipeUpdate, proposeInventoryAdd, applyProposal, executeCalculator, extractJsonObject, shouldAllowCopilotMutation, type Proposal } from "@/lib/ai-copilot";
import { MarkdownContent } from "@/components/MarkdownContent";
import { readSettings, saveSettings, useSettings } from "@/lib/settings";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AI_SYNC_ENABLED_STORAGE_KEY,
  getSizeMB,
  readStoredAiChats,
  syncAiChats,
  writeStoredAiChats,
  type ChatSession,
} from "@/lib/cloud-sync";
import { read, useInventory, useRecipes, uid } from "@/lib/store";
import { type Recipe, defaultEquipment, recipeStats, type InventoryItem, type HopUse } from "@/lib/recipe-calc";
import { fmt } from "@/lib/store";
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

const MODEL_OPTIONS = [
  ...GEMINI_3_LIVE_MODELS,
  ...GEMINI_3_FALLBACK_MODELS.filter(m => !(GEMINI_3_LIVE_MODELS as readonly string[]).includes(m)),
] as const;

const MODEL_LABELS: Record<string, string> = {
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash Lite",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.8-live": "Gemini 3.8 Live",
  "gemini-3.8-live-extended-thinking": "Gemini 3.8 Live Extended Thinking",
};

const ApiKeySetupCard: React.FC<{
  currentKey: string;
  onSave: (key: string) => void;
  onTest: (key: string) => Promise<void>;
  onClose: () => void;
  testing: boolean;
  showTutorial: boolean;
  onToggleTutorial: () => void;
}> = ({ currentKey, onSave, onTest, onClose, testing, showTutorial, onToggleTutorial }) => {
  const [key, setKey] = useState(currentKey);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialKey = currentKey;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSave = () => {
    if (key.trim()) {
      onSave(key.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleTest = async () => {
    if (key.trim()) {
      await onTest(key.trim());
    }
  };

  const hasChanges = key !== initialKey;

  return (
    <Card className="mb-4 border-primary/50 bg-primary/5 dark:bg-primary/10 animate-slide-in relative">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 z-10"
        onClick={onClose}
        aria-label="Fechar"
      >
        <XCircle className="w-5 h-5 text-muted-foreground hover:text-foreground" />
      </Button>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
            <Key className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-foreground">
              {initialKey ? "Trocar chave da API Gemini" : "Chave da API Gemini necessária"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {initialKey
                ? "Insira a nova chave da API do Google AI Studio. A chave atual será substituída."
                : "Insira sua chave da API do Google AI Studio para usar o assistente de IA."}
              A chave é salva localmente no seu navegador e sincronizada com seu Dropbox (se configurado).
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Input
                  ref={inputRef}
                  type={showKey ? "text" : "password"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder="Cole sua chave API aqui (ex: AIza...)"
                  className="pr-10"
                  disabled={testing}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {key && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowKey(!showKey)}
                      aria-label={showKey ? "Ocultar chave" : "Mostrar chave"}
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  )}
                  {key && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setKey("")}
                      aria-label="Limpar chave"
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
              <Button
                onClick={handleSave}
                disabled={!key.trim() || testing || !hasChanges}
                className="whitespace-nowrap"
              >
                {saved ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Salvo
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Salvar chave
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={!key.trim() || testing}
                className="whitespace-nowrap"
              >
                {testing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testando...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Testar
                  </>
                )}
              </Button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleTutorial}
                className="gap-1"
              >
                <HelpCircle className="w-4 h-4" />
                {showTutorial ? "Ocultar tutorial" : "Como criar uma chave"}
              </Button>
              <span className="text-xs text-muted-foreground">
                A chave nunca sai do seu navegador, exceto para sincronização criptografada no seu Dropbox.
              </span>
            </div>
          </div>
        </div>

        {showTutorial && (
          <div className="mt-6 p-4 bg-muted/50 rounded-xl border animate-fade-in">
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Passo a passo para criar sua chave da API Gemini
            </h4>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">1</span>
                <div>
                  <p className="font-medium">Acesse o Google AI Studio</p>
                  <p>Entre em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80 flex items-center gap-1">aistudio.google.com/apikey <ExternalLink className="w-3 h-3" /></a></p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">2</span>
                <div>
                  <p className="font-medium">Faça login com sua conta Google</p>
                  <p>Use a mesma conta que deseja associar à chave da API.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">3</span>
                <div>
                  <p className="font-medium">Clique em "Create API Key" (Criar chave da API)</p>
                  <p>Escolha "Create API key in new project" ou selecione um projeto existente.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">4</span>
                <div>
                  <p className="font-medium">Copie a chave gerada</p>
                  <p>A chave começa com <code className="bg-muted px-1 rounded">AIza...</code>. Copie e cole no campo acima.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-medium">5</span>
                <div>
                  <p className="font-medium">(Opcional) Ative o faturamento para cotas maiores</p>
                  <p>No <a href="https://console.cloud.google.com/billing" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80 flex items-center gap-1">Google Cloud Console <ExternalLink className="w-3 h-3" /></a>, ative o faturamento no projeto para aumentar os limites de requisições por minuto.</p>
                </div>
              </li>
            </ol>
            <div className="mt-4 p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50 rounded-lg">
              <p className="text-xs text-amber-800 dark:text-amber-200 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                <strong>Dica:</strong> O plano gratuito tem limite de 60 requisições/minuto. Se receber erro 429, aguarde alguns segundos ou ative o faturamento.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ModelSelector: React.FC<{
  model: string;
  onChange: (model: string) => void;
}> = ({ model, onChange }) => {
  return (
    <div className="flex items-center gap-1.5">
      <Select value={model} onValueChange={onChange}>
        <SelectTrigger className="h-9 min-w-[190px] max-w-[240px] text-xs font-medium gap-2">
          <div className="flex items-center gap-2 truncate">
            <Brain className="w-4 h-4 text-primary shrink-0" />
            <span className="truncate">{MODEL_LABELS[model] || model}</span>
          </div>
        </SelectTrigger>
        <SelectContent align="end" className="max-h-72">
          {MODEL_OPTIONS.map((m) => (
            <SelectItem key={m} value={m} className="text-xs py-2 cursor-pointer">
              <div className="flex items-center gap-2">
                <Brain className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span>{MODEL_LABELS[m] || m}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const KeyManagementButton: React.FC<{
  apiKey: string;
  onChangeKey: () => void;
  onTestKey: () => Promise<void>;
  testing: boolean;
  showKeySetup: boolean;
}> = ({ apiKey, onChangeKey, onTestKey, testing, showKeySetup }) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={onChangeKey}
            className="gap-2 transition-all hover:shadow-lg hover:shadow-primary/10"
            aria-label="Gerenciar chave da API"
          >
            <Key className="w-4 h-4" />
            <span>Chave API</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center">
          <p className="text-xs">Gerenciar chave da API</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
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
  const [actualModelUsed, setActualModelUsed] = useState<string | null>(null);
  const [fallbackOccurred, setFallbackOccurred] = useState(false);
  const [liveModel, setLiveModel] = useState<string>("gemini-3.8-live");
  const [pendingProposal, setPendingProposal] = useState<Proposal | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [showKeyTutorial, setShowKeyTutorial] = useState(false);
  const [testingKey, setTestingKey] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sendLockRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const { toast } = useToast();
  const [recipes, setRecipes] = useRecipes();
  const [inventory, setInventory] = useInventory();
  const [settings, saveSettingsHook] = useSettings();

  const apiKey = settings.geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY || "";
  const selectedModel = settings.geminiModel || DEFAULT_GEMINI_3_MODEL;

  const live = useGeminiLive({
    apiKey: apiKey || "",
    model: liveModel,
    onResponse: (text) => {},
    onError: (err) => {
      toast({
        title: "Erro no Gemini Live",
        description: err.message,
        variant: "destructive",
      });
    }
  });
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

  const persistChatHistory = useCallback((nextMessages: Message[], chatIdOverride?: string) => {
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
  }, [activeChatId]);

  const retryLastRequest = () => {
    if (!retryMessage) return;
    setInput(retryMessage.text);
    setSelectedImage(retryMessage.image ?? null);
    window.setTimeout(() => {
      void handleSend();
    }, 0);
  };

  const handleSaveKey = useCallback((key: string) => {
    saveSettingsHook({ geminiApiKey: key });
    toast({ title: "Chave salva", description: "Sua chave da API foi salva e sincronizada." });
  }, [saveSettingsHook, toast]);

  const handleTestKey = useCallback(async (key?: string) => {
    const keyToTest = key || apiKey;
    if (!keyToTest) return;
    setTestingKey(true);
    try {
      const gemini = new GeminiService(keyToTest);
      await gemini.chat([{ role: "user", content: "Olá" }], undefined, new AbortController().signal);
      toast({ title: "Conexão OK", description: "A chave da API está funcionando corretamente." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar chave";
      toast({ title: "Erro na conexão", description: message, variant: "destructive" });
      throw error;
    } finally {
      setTestingKey(false);
    }
  }, [apiKey, toast]);

  const handleChangeKey = useCallback(() => {
    setShowKeyTutorial(true);
  }, []);

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
        description: "Insira sua chave da API no painel acima para usar o assistente.",
        variant: "destructive",
      });
      return;
    }

    if (selectedImage && !supportsImages(selectedModel)) {
      toast({
        title: "Imagem ignorada",
        description: `O modelo ${selectedModel} não suporta imagens. Selecione um modelo multimodal (gemini-3.6-flash, gemini-3.5-flash, gemini-3.7-flash, gemini-3.8-flash ou gemini-3.8-live) para enviar imagens.`,
        variant: "default",
      });
    }

    if (isLoading || sendLockRef.current) return;
    const waitMs = geminiLimiter.waitTime();
    if (waitMs > 0) {
      toast({ title: "Aguarde um instante", description: `Para não estourar o limite da IA, envie novamente em ${Math.ceil(waitMs / 1000)}s.` });
      return;
    }
    sendLockRef.current = true;

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
    setPendingProposal(null);
    setProposalError(null);
    setIsLoading(true);
    setFallbackOccurred(false);
    setActualModelUsed(null);

    try {
      const gemini = new GeminiService(apiKey, selectedModel);

      const turnPlan = prepareCopilotTurn(
        currentText,
        messages,
        {
          getRecipes: () => recipes,
          getInventory: () => inventory,
          getSettings: () => readSettings(),
        },
        { hasImage: Boolean(currentImage), currentUserMessage: userMessage },
      );

      const streamResult = await gemini.chatStream(
        turnPlan.messagesForModel,
        turnPlan.context,
        nextAbortController.signal,
      );
      let streamedText = "";

      setActualModelUsed(streamResult.modelUsed);
      setFallbackOccurred(streamResult.isFallback);

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
            content: streamedText,
          };

          return next;
        });
      }

      const finalText = streamedText.trim();
      if (!finalText) {
        const emptyMsg = "A IA respondeu sem conteúdo. Tente novamente com outra pergunta ou ajuste o contexto da sua mensagem.";
        const updated = [...messages, userMessage, { role: "model" as const, content: emptyMsg }];
        setMessages(updated);
        persistChatHistory(updated, currentChatId);
      } else {
        const action = extractJsonObject(finalText);
        if (action && typeof action.action === "string") {
          const act = String(action.action).toUpperCase();
          if (act === "CALCULATE" || act === "RUN_CALCULATOR") {
            const actionPayload = (action.payload && typeof action.payload === "object" ? action.payload : {}) as Record<string, unknown>;
            const calcId = String(actionPayload.calculatorId ?? actionPayload.id ?? action.calculatorId ?? "");
            const values = (actionPayload.values ?? action.values ?? {}) as Record<string, string>;
            const res = executeCalculator(calcId, values);
            const actionMsg = typeof action.message === "string" ? action.message : "";
            const msg = res.ok
              ? `${actionMsg || "Cálculo executado pelo BrewCraft."}\n\n**${res.calculator} (função real):**\n` + res.results.map(r => `- ${r.label}: ${fmt(r.value, r.digits ?? 2)} ${r.unit || ""}`).join("\n")
              : `${actionMsg || "Falha ao executar cálculo."}\n\nErro: ${(res as { error: string }).error}`;
            const updated = [...messages, userMessage, { role: "model" as const, content: msg }];
            setMessages(updated);
            persistChatHistory(updated, currentChatId);
          } else if (!shouldAllowCopilotMutation(currentText, messages, act)) {
            const plainMessage =
              typeof action.message === "string" && action.message.trim()
                ? action.message.trim()
                : finalText.replace(/```(?:json)?[\s\S]*?```/gi, "").trim() ||
                  "Posso ajudar com dúvidas ou análises. Se quiser que eu crie ou altere uma receita no aplicativo, peça explicitamente (ex.: \"crie uma receita de IPA de 20L\").";
            const updated = [...messages, userMessage, { role: "model" as const, content: plainMessage }];
            setMessages(updated);
            persistChatHistory(updated, currentChatId);
          } else {
            const result = handleAiActionObject(action);
            const updated = [...messages, userMessage, { role: "model" as const, content: result.displayMessage }];
            setMessages(updated);
            persistChatHistory(updated, currentChatId);
          }
        } else {
          const updated = [...messages, userMessage, { role: "model" as const, content: streamedText }];
          setMessages(updated);
          persistChatHistory(updated, currentChatId);
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
      sendLockRef.current = false;
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
    setPendingProposal(null);
    setProposalError(null);
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
    setPendingProposal(null);
    setProposalError(null);
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
      notes: String(payload.notes ?? ""),
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
    } as Recipe & { og: number; fg: number; abv: number; ibu: number; srm: number };
  };

  const handleAiActionObject = (action: unknown): { displayMessage: string } => {
    try {
      const a = (action && typeof action === "object" ? action : {}) as Record<string, unknown>;
      const kind = String(a.action ?? "").toUpperCase();
      const payload = (a.payload && typeof a.payload === "object") ? a.payload as Record<string, unknown> : {};
      const baseMsg = typeof a.message === "string" ? a.message : "Proposta gerada pela IA.";
      const settings = readSettings();

      if (kind === "PROPOSE_CREATE_RECIPE" || kind === "CREATE_RECIPE") {
        const p = proposeRecipeCreate(payload.recipe && typeof payload.recipe === "object" ? payload.recipe as Record<string, unknown> : payload, { settings, inventory });
        if (!p.ok) { const err = p as { error: string; missingInfo?: string[] }; setPendingProposal(null); setProposalError(err.error); return { displayMessage: `${baseMsg}\n\n⚠️ Não foi possível preparar a proposta: ${err.error}${err.missingInfo?.length ? `\nFaltam: ${err.missingInfo.join(", ")}.` : ""}\nResponda com as informações necessárias para eu montar a proposta.` }; }
        setPendingProposal(p.proposal); setProposalError(null);
        return { displayMessage: `${baseMsg}\n\n📋 Proposta pronta para confirmação (nenhuma alteração aplicada ainda). Revise antes/depois e aprove ou rejeite abaixo.` };
      }
      if (kind === "PROPOSE_UPDATE_RECIPE" || kind === "UPDATE_RECIPE") {
        const p = proposeRecipeUpdate(payload.recipe && typeof payload.recipe === "object" ? payload.recipe as Record<string, unknown> : payload, recipes, { settings, inventory });
        if (!p.ok) { const err = p as { error: string; missingInfo?: string[] }; setPendingProposal(null); setProposalError(err.error); return { displayMessage: `${baseMsg}\n\n⚠️ Não foi possível preparar a alteração: ${err.error}${err.missingInfo?.length ? `\nFaltam: ${err.missingInfo.join(", ")}.` : ""}` }; }
        setPendingProposal(p.proposal); setProposalError(null);
        return { displayMessage: `${baseMsg}\n\n📋 Alteração proposta (não aplicada). Revise antes/depois e confirme para aplicar.` };
      }
      if (kind === "PROPOSE_ADD_INVENTORY" || kind === "ADD_INVENTORY") {
        const p = proposeInventoryAdd(payload, inventory);
        if (!p.ok) { const err = p as { error: string; missingInfo?: string[] }; setPendingProposal(null); setProposalError(err.error); return { displayMessage: `${baseMsg}\n\n⚠️ Não foi possível preparar a alteração de inventário: ${err.error}${err.missingInfo?.length ? `\nFaltam: ${err.missingInfo.join(", ")}.` : ""}` }; }
        setPendingProposal(p.proposal); setProposalError(null);
        return { displayMessage: `${baseMsg}\n\n📋 Alteração de inventário proposta (não aplicada). Confirme para aplicar.` };
      }
      if (kind === "UPDATE_SETTING") {
        try { saveSettings(payload as Record<string, unknown>); return { displayMessage: baseMsg || "Configurações atualizadas." }; }
        catch (e) { return { displayMessage: `Falha ao atualizar configurações: ${e instanceof Error ? e.message : "erro desconhecido"}` }; }
      }
      return { displayMessage: baseMsg };
    } catch (e) {
      const err = e instanceof Error ? e.message : "erro ao processar ação";
      setProposalError(err);
      return { displayMessage: `Não foi possível processar a ação da IA: ${err}` };
    }
  };

  const approveProposal = () => {
    if (!pendingProposal) return;
    const latestRecipes = read("recipes");
    const latestInventory = read("inventory");
    const result = applyProposal(pendingProposal, { recipes: latestRecipes, inventory: latestInventory });
    if (!result.ok) {
      const err = result as { error: string };
      toast({ title: "Operação não aplicada", description: err.error, variant: "destructive" });
      const msg: Message = { role: "model", content: `❌ Alteração não aplicada: ${err.error}` };
      const next = [...messages, msg]; setMessages(next); persistChatHistory(next, activeChatId ?? undefined);
      setPendingProposal(null);
      setProposalError(err.error);
      return;
    }
    if (pendingProposal.kind === "CREATE_RECIPE" || pendingProposal.kind === "UPDATE_RECIPE") setRecipes(result.recipes);
    if (pendingProposal.kind === "ADD_INVENTORY") setInventory(result.inventory);
    const msg: Message = { role: "model", content: `✅ ${result.message} (aplicado após sua confirmação).` };
    const next = [...messages, msg]; setMessages(next); persistChatHistory(next, activeChatId ?? undefined);
    toast({ title: "Alteração aplicada", description: result.message });
    setPendingProposal(null); setProposalError(null);
  };

  const rejectProposal = useCallback(() => {
    if (!pendingProposal) return;
    const msg: Message = { role: "model", content: "Proposta rejeitada. Nenhuma alteração foi aplicada." };
    const next = [...messages, msg];
    setMessages(next);
    persistChatHistory(next, activeChatId ?? undefined);
    setPendingProposal(null);
    setProposalError(null);
  }, [pendingProposal, messages, activeChatId, persistChatHistory]);

  // Escape key to dismiss proposals and API key card
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingProposal) {
          rejectProposal();
        } else if (proposalError) {
          setProposalError(null);
        } else if (showKeyTutorial) {
          setShowKeyTutorial(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingProposal, proposalError, showKeyTutorial, rejectProposal]);

  const applyAiAction = (content: string) => {
    const obj = extractJsonObject(content);
    if (!obj) return false;
    handleAiActionObject(obj);
    return true;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto">
      <style>{`
        @keyframes slide-in {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-down {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-slide-in { animation: slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-slide-up { animation: slide-up 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-slide-down { animation: slide-down 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
      `}</style>

      <div className="mb-4 flex w-full flex-col flex-wrap items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="flex w-full flex-row flex-wrap items-center gap-2 md:w-auto">
          <img src={geminiLogo} alt="Assistente IA" className="w-16 h-16 object-contain" />
          <div>
            <h1 className="text-2xl font-bold">Assistente IA</h1>
            {fallbackOccurred && (
              <div className="mt-1">
                <Badge variant="outline" className="text-[10px] py-0 h-5 border-amber-500 text-amber-600 bg-amber-50">
                  Fallback Ativo
                </Badge>
              </div>
            )}
          </div>
        </div>
        <div className="flex w-full flex-row flex-wrap gap-2 md:w-auto">
          <ModelSelector
            model={selectedModel}
            onChange={(m) => saveSettingsHook({ geminiModel: m })}
          />
          {apiKey && (
            <KeyManagementButton
              apiKey={apiKey}
              onChangeKey={handleChangeKey}
              onTestKey={handleTestKey}
              testing={testingKey}
              showKeySetup={showKeyTutorial}
            />
          )}
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
            setPendingProposal(null);
            setProposalError(null);
            setRetryMessage(null);
            setSelectedImage(null);
          }}>
            <PlusCircle className="w-4 h-4 mr-2" />
            Nova Conversa
          </Button>
        </div>
      </div>

      {(!apiKey || showKeyTutorial) && (
        <ApiKeySetupCard
          currentKey={apiKey}
          onSave={handleSaveKey}
          onTest={handleTestKey}
          onClose={() => setShowKeyTutorial(false)}
          testing={testingKey}
          showTutorial={showKeyTutorial}
          onToggleTutorial={() => setShowKeyTutorial(!showKeyTutorial)}
        />
      )}

      <div className="flex flex-1 gap-4 min-h-0">
        {isHistoryOpen && (
          <aside className="w-80 shrink-0 rounded-xl border border-slate-700/80 bg-slate-900/90 text-slate-100 shadow-lg backdrop-blur-sm overflow-hidden animate-slide-in">
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

        <Card className="flex-1 overflow-hidden flex flex-col bg-slate-50/50 dark:bg-slate-900/50 min-h-0 relative">
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            {live.isActive && (
              <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 animate-pulse flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-600" />
                Gemini Live Ativo
                {live.isSpeaking && " (Falando)"}
              </Badge>
            )}
          </div>
          <ScrollArea className="flex-1 min-h-0 p-4" ref={scrollRef}>
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
                                  <MarkdownContent
                                    content={recipePreview.explanation}
                                    className="text-slate-700 dark:text-slate-200"
                                  />
                                )}
                              </div>
                            ) : m.role === "model" ? (
                              <MarkdownContent content={displayContent} />
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

          {(pendingProposal || proposalError) && (
            <div className="shrink-0 max-h-[55%] flex flex-col border-t bg-amber-50/90 dark:bg-amber-950/30 animate-slide-in">
              <div className="shrink-0 flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-amber-200/60 dark:border-amber-800/50">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">
                    {pendingProposal
                      ? "Confirmação necessária (nenhuma alteração aplicada automaticamente)"
                      : "Não foi possível preparar a ação"}
                  </p>
                  {pendingProposal && (
                    <Badge variant="outline">
                      {pendingProposal.kind === "CREATE_RECIPE"
                        ? "Criar receita"
                        : pendingProposal.kind === "UPDATE_RECIPE"
                          ? "Editar receita"
                          : "Alterar inventário"}
                    </Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => {
                    if (pendingProposal) {
                      rejectProposal();
                    } else {
                      setProposalError(null);
                    }
                  }}
                  aria-label="Fechar painel de confirmação"
                >
                  <XCircle className="w-4 h-4" />
                </Button>
              </div>
              <div className="overflow-y-auto min-h-0 p-4 space-y-3 text-sm">
                {proposalError && <p className="text-sm text-destructive">{proposalError}</p>}
                {pendingProposal && (
                  <>
                    <div>
                      <p className="font-medium">Ingredientes/itens afetados</p>
                      <p className="text-muted-foreground">{pendingProposal.affectedIngredients.length ? pendingProposal.affectedIngredients.join(", ") : "—"}</p>
                    </div>
                    {pendingProposal.kind !== "ADD_INVENTORY" && (() => {
                      const p = pendingProposal;
                      const rows: [string, string, string][] = [
                        ["Receita", p.before?.name || "—", p.after.name],
                        ["OG", p.before ? fmt(p.before.results.og, 3) : "—", fmt(p.after.results.og, 3)],
                        ["FG", p.before ? fmt(p.before.results.fg, 3) : "—", fmt(p.after.results.fg, 3)],
                        ["ABV", p.before ? `${fmt(p.before.results.abv)}%` : "—", `${fmt(p.after.results.abv)}%`],
                        ["IBU", p.before ? fmt(p.before.results.ibu, 1) : "—", fmt(p.after.results.ibu, 1)],
                        ["EBC/SRM", p.before ? `${fmt(p.before.results.ebc, 1)} / ${fmt(p.before.results.srm, 1)}` : "—", `${fmt(p.after.results.ebc, 1)} / ${fmt(p.after.results.srm, 1)}`],
                        ["Volume (L)", p.before ? String(p.before.batchSizeL) : "—", String(p.after.batchSizeL)],
                        ["Eficiência", p.before ? `${p.before.efficiency}%` : "—", `${p.after.efficiency}%`],
                      ];
                      return (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border border-border rounded-md">
                              <thead className="bg-muted/50"><tr><th className="text-left p-2">Métrica</th><th className="text-left p-2">Antes</th><th className="text-left p-2">Depois</th></tr></thead>
                              <tbody>
                                {rows.map(([k, a, b]) => (<tr key={k} className="border-t border-border"><td className="p-2 font-medium">{k}</td><td className="p-2">{a}</td><td className="p-2">{b}</td></tr>))}
                              </tbody>
                            </table>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p><b>Fermentáveis:</b> {p.after.fermentables.map((f) => `${f.kg} kg ${f.name}`).join("; ") || "—"}</p>
                            <p><b>Lúpulos:</b> {p.after.hops.map((h) => `${h.grams} g ${h.name} (${h.use}${h.minutes ? ` ${h.minutes}min` : ""})`).join("; ") || "—"}</p>
                            <p><b>Leveduras:</b> {p.after.yeasts.map((y) => `${y.packs}x ${y.name}`).join("; ") || "—"}</p>
                            {p.after.miscs?.length ? <p><b>Outros:</b> {p.after.miscs.map((m) => `${m.amount} ${m.unit} ${m.name}`).join("; ")}</p> : null}
                          </div>
                          {p.inventoryCheck?.some((x) => x.missing > 0) && (
                            <div className="text-xs text-amber-700 dark:text-amber-300"><b>Faltas no estoque (respeitando quantidades disponíveis):</b> {p.inventoryCheck.filter((x) => x.missing > 0).map((x) => `${x.name}: faltam ${fmt(x.missing, 2)} ${x.unit}`).join("; ")}</div>
                          )}
                        </>
                      );
                    })()}
                    {pendingProposal.kind === "ADD_INVENTORY" && (
                      <div className="text-xs space-y-1">
                        <p><b>Antes:</b> {pendingProposal.before ? `${pendingProposal.before.amount} ${pendingProposal.before.unit} ${pendingProposal.before.name}` : "Item novo"}</p>
                        <p><b>Depois:</b> {pendingProposal.after.amount} {pendingProposal.after.unit} {pendingProposal.after.name}</p>
                      </div>
                    )}
                    {pendingProposal.warnings?.length ? <div className="text-xs text-amber-700">Avisos: {pendingProposal.warnings.join("; ")}</div> : null}
                  </>
                )}
              </div>
              {pendingProposal && (
                <div className="shrink-0 flex gap-2 flex-wrap px-4 py-3 border-t border-amber-200/60 dark:border-amber-800/50 bg-amber-50/95 dark:bg-amber-950/40">
                  <Button type="button" size="sm" onClick={approveProposal}>Aprovar e aplicar</Button>
                  <Button type="button" size="sm" variant="destructive" onClick={rejectProposal}>Rejeitar</Button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSend} className="shrink-0 p-4 bg-white dark:bg-slate-800 border-t">
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
                onClick={live.isActive ? live.disconnect : live.connect}
                disabled={isLoading || live.isConnecting}
                className={live.isActive ? "bg-red-50 border-red-200 text-red-600 hover:bg-red-100" : ""}
                aria-label={live.isActive ? "Encerrar conversa Live" : "Iniciar Gemini Live"}
              >
                {live.isConnecting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : live.isActive ? (
                  <MicOff className="w-5 h-5" />
                ) : (
                  <Brain className="w-5 h-5" />
                )}
              </Button>
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={toggleRecording}
                  disabled={isLoading || live.isActive}
                  aria-label={isRecording ? "Parar gravação de voz" : "Gravar por voz"}
                >
                  <Mic className={`w-5 h-5 ${isRecording ? "text-red-500 animate-pulse" : ""}`} />
                </Button>
                {live.isActive && (
                  <select
                    value={liveModel}
                    onChange={(e) => setLiveModel(e.target.value)}
                    className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 border rounded text-[10px] px-1 shadow-sm"
                  >
                    {GEMINI_3_LIVE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={apiKey ? "Pergunte sobre sua cerveja..." : "Configure a chave da API para começar"}
                disabled={isLoading || !apiKey}
                className="flex-1"
              />
              <Button type="submit" disabled={isLoading || (!input.trim() && !selectedImage) || !apiKey}>
                <Send className="w-5 h-5" />
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}