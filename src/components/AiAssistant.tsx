import React, { useState, useRef, useEffect } from "react";
import { 
  Send, 
  User, 
  Loader2, 
  PlusCircle, 
  Trash2, 
  Image as ImageIcon, 
  Download,
  AlertCircle
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
import { useRecipes, uid } from "@/lib/store";
import { type Recipe, defaultEquipment } from "@/lib/recipe-calc";
import { useNavigate } from "react-router-dom";
import geminiLogo from "../../gemini-svg.svg";

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
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<{ text: string; image?: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window === "undefined") return "gemini-1.5-flash";
    const savedModel = localStorage.getItem("brewcraft-ai-model");
    const allowedModels = [
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];
    return allowedModels.includes(savedModel ?? "") ? savedModel! : "gemini-1.5-flash";
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const [recipes, setRecipes] = useRecipes();
  const navigate = useNavigate();

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const totalHistorySizeMB = history.reduce((total, chat) => total + Number(getSizeMB(chat)), 0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    localStorage.setItem("brewcraft-ai-model", selectedModel);
  }, [selectedModel]);

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
    };
  }, []);

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
      const gemini = new GeminiService(apiKey, selectedModel);

      const context = {
        recipeCount: recipes.length,
        recipes: recipes.map(r => ({ name: r.name, style: r.styleCode })),
      };

      const streamResult = await gemini.chatStream([...messages, userMessage], context, nextAbortController.signal);
      let streamedText = "";

      for await (const chunk of streamResult.stream) {
        const chunkText = await chunk.text();
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

      if (!streamedText.trim()) {
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
      }
    } catch (error: any) {
      if (error?.name === "AbortError" || error?.message?.includes("aborted")) {
        return;
      }

      toast({
        title: "Erro",
        description: error.message || "Não foi possível obter resposta da IA",
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

  const handleImportRecipe = (content: string) => {
    const recipeData = parseRecipeMarkdown(content)?.recipe ?? GeminiService.extractRecipe(content);
    if (!recipeData) {
      toast({
        title: "Erro",
        description: "Não foi possível extrair os dados da receita.",
        variant: "destructive",
      });
      return;
    }

    const newRecipe: Recipe = {
      id: uid(),
      name: recipeData.name || "Nova Receita IA",
      styleCode: recipeData.styleCode || "",
      author: "IA Assistant",
      notes: recipeData.notes || "",
      equipment: recipeData.equipment || { ...defaultEquipment },
      mashSteps: recipeData.mashSteps || [],
      fermentationTempC: recipeData.fermentationTempC || 20,
      fermentationDays: recipeData.fermentationDays || 14,
      fermentables: recipeData.fermentables?.map(f => ({ ...f, id: uid(), price: 0 })) || [],
      hops: recipeData.hops?.map(h => ({ ...h, id: uid(), price: 0 })) || [],
      yeasts: recipeData.yeasts?.map(y => ({ ...y, id: uid(), price: 0 })) || [],
      miscs: recipeData.miscs?.map(m => ({ ...m, id: uid(), price: 0 })) || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (confirm(`Deseja importar a receita "${newRecipe.name}"?`)) {
      setRecipes([newRecipe, ...recipes]);
      toast({
        title: "Sucesso",
        description: "Receita importada com sucesso!",
      });
      navigate(`/recipes/${newRecipe.id}`);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <img src={geminiLogo} alt="Assistente IA" className="w-16 h-16 object-contain" />
          <h1 className="text-2xl font-bold">Assistente IA</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-md border border-slate-600/70 bg-[#111827]/85 px-2.5 py-1.5 text-xs text-slate-200 shadow-sm backdrop-blur-sm">
            <span className="font-medium text-slate-300">Modelo</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="min-w-[220px] rounded-md border border-slate-600/80 bg-[#0f172a] px-2 py-1.5 text-xs text-slate-100 outline-none ring-0 transition focus:border-primary focus:ring-2 focus:ring-primary/30"
              aria-label="Selecionar modelo de IA"
            >
              <option value="gemini-1.5-flash" className="bg-[#0f172a] text-slate-100">1.5 Flash - Padrão / Rápido</option>
              <option value="gemini-1.5-pro" className="bg-[#0f172a] text-slate-100">1.5 Pro - Raciocínio Avançado</option>
            </select>
          </label>
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
                  const recipePreview = m.role === "model" ? parseRecipeMarkdown(m.content) : null;

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
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="w-full gap-2 justify-center"
                                  onClick={() => handleImportRecipe(m.content)}
                                >
                                  <Download className="w-4 h-4" />
                                  Importar Receita: {recipePreview.recipe?.name || "Sem nome"}
                                </Button>
                              </div>
                            ) : (
                              <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
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
