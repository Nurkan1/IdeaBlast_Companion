import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { processWithMcp, setProgressCallback, setCurrentModel, type McpToolResult, type FileContext } from "../lib/mcpBrain";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  /** MCP tool call indicator shown in the UI */
  mcpTool?: McpToolResult;
  timestamp: number;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string, images?: string[]) => Promise<void>;
  clearChat: () => void;
}

/** Whether MCP connection is available — set by App */
let _mcpConnected = false;
export function setMcpConnected(value: boolean): void {
  _mcpConnected = value;
}

let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

/**
 * Chat hook with MCP Brain integration.
 * Detects IdeaBlast intents, calls MCP tools, injects data as context
 * for Ollama, and streams the response.
 */
export function useChat(model: string): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamBuffer = useRef("");

  const sendMessage = useCallback(
    async (content: string, images?: string[]) => {
      if (!content.trim() || isStreaming) return;

      setError(null);

      // Add user message
      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        content: content.trim(),
        images,
        timestamp: Date.now(),
      };

      // ── Keep mcpBrain aware of current model (for LLM classification) ──
      setCurrentModel(model);

      // ── Extract file contexts from message (files prepended as "--- name ---\n...") ──
      const fileContexts: FileContext[] = [];
      const filePattern = /---\s+(.+?)\s+---\n([\s\S]*?)(?=\n---\s|$)/g;
      let fileMatch: RegExpExecArray | null;
      while ((fileMatch = filePattern.exec(content.trim())) !== null) {
        fileContexts.push({ name: fileMatch[1], content: fileMatch[2].trim() });
      }

      // ── MCP Brain: detect intent and call tools ──
      const { systemPrompt, toolResult } = await processWithMcp(
        content.trim(),
        _mcpConnected,
        fileContexts.length > 0 ? fileContexts : undefined
      );

      // Prepare assistant placeholder (with optional MCP tool indicator)
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        mcpTool: toolResult ?? undefined,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      streamBuffer.current = "";

      // Build message history: system prompt + conversation
      const systemMsg = { role: "system", content: systemPrompt, images: [] as string[] };
      const history = [
        systemMsg,
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
          images: m.images ?? [],
        })),
        { role: userMsg.role, content: userMsg.content, images: userMsg.images ?? [] },
      ];

      // Listen for streaming chunks
      const unlisten = await listen<{ content: string; done: boolean }>(
        "chat-chunk",
        (event) => {
          streamBuffer.current += event.payload.content;
          const currentContent = streamBuffer.current;

          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: currentContent,
              };
            }
            return updated;
          });

          if (event.payload.done) {
            setIsStreaming(false);
          }
        }
      );

      try {
        await invoke("ollama_chat", {
          request: { model, messages: history },
        });

        // Post-process: if the MCP tool has a postProcess callback,
        // run it with the full LLM response to create ideas/plans in IdeaBlast
        if (toolResult?.postProcess && streamBuffer.current) {
          try {
            // Set up progress callback to update UI in real-time
            setProgressCallback((step: string) => {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant" && last.mcpTool) {
                  const prevSteps = last.mcpTool.progressSteps ?? [];
                  updated[updated.length - 1] = {
                    ...last,
                    mcpTool: {
                      ...last.mcpTool,
                      statusMessage: step,
                      progressSteps: [...prevSteps, step],
                    },
                  };
                }
                return updated;
              });
            });

            await toolResult.postProcess(streamBuffer.current);
            setProgressCallback(null);
          } catch (e) {
            console.warn("[useChat] postProcess failed:", e);
            setProgressCallback(null);
          }
        }
      } catch (err: unknown) {
        const message = typeof err === "string" ? err : "Chat request failed";
        setError(message);
        setIsStreaming(false);

        // Remove empty assistant message on error
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && !last.content) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      } finally {
        unlisten();
      }
    },
    [model, messages, isStreaming]
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
    streamBuffer.current = "";
  }, []);

  return { messages, isStreaming, error, sendMessage, clearChat };
}
