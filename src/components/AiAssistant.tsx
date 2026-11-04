import React, { useState, useRef, useEffect } from "react";
import { 
  Send, 
  Bot, 
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
import { useRecipes, uid } from "@/lib/store";
import { type Recipe, defaultEquipment } from "@/lib/recipe-calc";
import { useNavigate } from "react-router-dom";

export default function AiAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<{ text: string; image?: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window === "undefined") return "gemini-3.6-flash";
    const savedModel = localStorage.getItem("brewcraft-ai-model");
    const allowedModels = [
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "gemini-3.1-pro",
    ];
    return allowedModels.includes(savedModel ?? "") ? savedModel! : "gemini-3.6-flash";
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const [recipes, setRecipes] = useRecipes();
  const navigate = useNavigate();

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    localStorage.setItem("brewcraft-ai-model", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSelectedImage(null);
    setIsLoading(true);

    try {
      const gemini = new GeminiService(apiKey, selectedModel);

      const context = {
        recipeCount: recipes.length,
        recipes: recipes.map(r => ({ name: r.name, style: r.styleCode })),
      };

      const responseText = await gemini.chat([...messages, userMessage], context, nextAbortController.signal);

      if (!responseText || !responseText.trim()) {
        const fallbackMessage: Message = {
          role: "model",
          content: "A IA respondeu sem conteúdo. Tente novamente com outra pergunta ou ajuste o contexto da sua mensagem.",
        };
        setMessages((prev) => [...prev, fallbackMessage]);
        return;
      }

      const assistantMessage: Message = {
        role: "model",
        content: responseText,
      };

      setMessages((prev) => [...prev, assistantMessage]);
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
  };

  const handleImportRecipe = (content: string) => {
    const recipeData = GeminiService.extractRecipe(content);
    if (!recipeData) {
      toast({
        title: "Erro",
        description: "Não foi possível extrair os dados da receita.",
        variant: "destructive",
      });
      return;
    }

    // Prepare complete recipe object
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

    // Ask for confirmation
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
          <Bot className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Assistente IA</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
            <span>Modelo</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-transparent text-foreground outline-none"
              aria-label="Selecionar modelo de IA"
            >
              <option value="gemini-3.5-flash-lite">3.5 Flash Lite - Rápido</option>
              <option value="gemini-3.6-flash">3.6 Flash - Padrão</option>
              <option value="gemini-3.8-flash">3.8 Flash - Recente</option>
              <option value="gemini-3.1-pro">3.1 Pro - Raciocínio Avançado</option>
            </select>
          </label>

          <Button variant="outline" size="sm" onClick={clearConversation}>
            <Trash2 className="w-4 h-4 mr-2" />
            Limpar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMessages([])}>
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

      <Card className="flex-1 overflow-hidden flex flex-col bg-slate-50/50 dark:bg-slate-900/50">
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 pt-12">
              <Bot className="w-12 h-12 text-muted-foreground opacity-20" />
              <div>
                <p className="text-xl font-medium text-muted-foreground">Como posso ajudar na sua brassagem hoje?</p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  Você pode pedir receitas, tirar dúvidas técnicas ou analisar problemas na sua cerveja.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`flex gap-3 max-w-[85%] ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                    <div className={`mt-1 p-2 rounded-full h-fit ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {m.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
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
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                      </div>
                      
                      {m.role === "model" && GeminiService.extractRecipe(m.content) && (
                        <Button 
                          variant="secondary" 
                          size="sm" 
                          className="w-full gap-2"
                          onClick={() => handleImportRecipe(m.content)}
                        >
                          <Download className="w-4 h-4" />
                          Importar Receita
                        </Button>
                      )}

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
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex gap-3 max-w-[85%]">
                    <div className="mt-1 p-2 rounded-full bg-muted h-fit">
                      <Bot className="w-4 h-4" />
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
  );
}
