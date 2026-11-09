import { useEffect, useRef, useState, useCallback } from "react";

export interface UseGeminiLiveOptions {
  apiKey: string;
  model: string;
  systemInstruction?: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onResponse?: (text: string) => void;
}

export function useGeminiLive({
  apiKey,
  model,
  systemInstruction,
  onConnected,
  onDisconnected,
  onError,
  onResponse,
}: UseGeminiLiveOptions) {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInterrupted, setIsInterrupted] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  const stopAudio = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      // Don't close context to avoid issues with multiple sessions, just suspend if needed
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopAudio();
    setIsActive(false);
    setIsConnecting(false);
    onDisconnected?.();
  }, [onDisconnected, stopAudio]);

  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0 || isPlayingRef.current || !audioContextRef.current) {
      if (audioQueueRef.current.length === 0) setIsSpeaking(false);
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    
    const audioData = audioQueueRef.current.shift()!;
    const float32Data = new Float32Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      float32Data[i] = audioData[i] / 32768.0;
    }

    const buffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      isPlayingRef.current = false;
      playNextInQueue();
    };
    
    source.start();
  }, []);

  const connect = useCallback(async () => {
    if (isActive || isConnecting) return;
    
    setIsConnecting(true);
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsActive(true);
        setIsConnecting(false);
        onConnected?.();

        // Send setup
        const setup = {
          setup: {
            model: `models/${model}`,
            generation_config: {
              response_modalities: ["AUDIO"],
            },
            system_instruction: systemInstruction ? {
              parts: [{ text: systemInstruction }]
            } : undefined,
          }
        };
        ws.send(JSON.stringify(setup));
      };

      ws.onmessage = async (event) => {
        let data;
        if (event.data instanceof Blob) {
           const text = await event.data.text();
           data = JSON.parse(text);
        } else {
           data = JSON.parse(event.data);
        }

        if (data.serverContent) {
          if (data.serverContent.modelDraft) {
             onResponse?.(data.serverContent.modelDraft);
          }
          if (data.serverContent.inlineOutput) {
            const audioB64 = data.serverContent.inlineOutput.data;
            const binaryString = atob(audioB64);
            const len = binaryString.length;
            const bytes = new Int16Array(len / 2);
            const view = new DataView(new ArrayBuffer(len));
            for (let i = 0; i < len; i++) {
              view.setUint8(i, binaryString.charCodeAt(i));
            }
            for (let i = 0; i < len / 2; i++) {
              bytes[i] = view.getInt16(i * 2, true);
            }
            audioQueueRef.current.push(bytes);
            playNextInQueue();
          }
          if (data.serverContent.interrupted) {
            audioQueueRef.current = [];
            setIsInterrupted(true);
            setTimeout(() => setIsInterrupted(false), 1000);
          }
        }
      };

      ws.onerror = (ev) => {
        console.error("WebSocket Error:", ev);
        onError?.(new Error("WebSocket connection error"));
        disconnect();
      };

      ws.onclose = () => {
        disconnect();
      };

      // Start Microphone
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      processorRef.current.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert Float32 to Int16
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
          }
          
          const b64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
          ws.send(JSON.stringify({
            realtime_input: {
              media_chunks: [{
                mime_type: "audio/pcm;rate=24000",
                data: b64Data
              }]
            }
          }));
        }
      };

      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

    } catch (err) {
      console.error("Failed to connect to Gemini Live:", err);
      setIsConnecting(false);
      onError?.(err instanceof Error ? err : new Error("Failed to initialize audio or websocket"));
    }
  }, [apiKey, model, systemInstruction, isActive, isConnecting, onConnected, onDisconnected, onError, onResponse, playNextInQueue, disconnect]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isActive,
    isConnecting,
    isSpeaking,
    isInterrupted,
    connect,
    disconnect,
  };
}
