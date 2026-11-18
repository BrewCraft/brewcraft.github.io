import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 max-w-lg mx-auto text-center space-y-4 my-12 bg-destructive/5 border border-destructive/20 rounded-xl">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-foreground">
            {this.props.fallbackTitle || "Ocorreu um erro inesperado nesta página"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {this.state.error?.message || "Erro desconhecido ao carregar este módulo."}
          </p>
          <div className="flex gap-3 pt-2">
            <Button onClick={this.handleReset} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Recarregar página
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.hash = "#/";
              }}
            >
              Ir para o Início
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
export default ErrorBoundary;
