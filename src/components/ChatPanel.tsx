import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ChatMessage } from "../hooks/useChat";

interface FileAttachment {
  name: string;
  content: string;
  isImage: boolean;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSend: (content: string, images?: string[]) => void;
  onClear: () => void;
  mcpConnected: boolean;
  modelName: string;
}

const QUICK_PROMPTS = [
  { icon: "💡", text: "Show me my ideas", desc: "Read ideas from IdeaBlast" },
  { icon: "📋", text: "Create a plan to learn React in 2 weeks", desc: "Plan with dates" },
  { icon: "✨", text: "Brainstorm ideas about productivity", desc: "Generate & save ideas" },
  { icon: "📊", text: "Show my stats and progress", desc: "Productivity overview" },
];

export function ChatPanel({
  messages,
  isStreaming,
  error,
  onSend,
  onClear,
  mcpConnected,
  modelName,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  const handleAttach = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Files",
            extensions: [
              "txt", "md", "json", "csv", "py", "js", "ts", "tsx",
              "rs", "html", "css", "yaml", "yml", "toml",
              "png", "jpg", "jpeg", "gif", "webp",
            ],
          },
        ],
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      for (const filePath of paths) {
        try {
          const result = await invoke<{
            name: string;
            content: string;
            is_image: boolean;
          }>("read_file_content", { path: filePath });
          setAttachments((prev) => [
            ...prev,
            { name: result.name, content: result.content, isImage: result.is_image },
          ]);
        } catch (err) {
          console.error("Failed to read file:", err);
        }
      }
    } catch (err) {
      console.error("File dialog error:", err);
    }
  };

  const handleSubmit = (text?: string) => {
    const content = text ?? input.trim();
    if (!content && attachments.length === 0) return;
    if (isStreaming) return;

    const images = attachments.filter((a) => a.isImage).map((a) => a.content);
    const textFiles = attachments.filter((a) => !a.isImage);

    let fullContent = content;
    if (textFiles.length > 0) {
      const ctx = textFiles.map((f) => `--- ${f.name} ---\n${f.content}`).join("\n\n");
      fullContent = `${ctx}\n\n${fullContent}`;
    }

    onSend(fullContent, images.length > 0 ? images : undefined);
    setInput("");
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="chat-container">
      {/* ── Messages or Welcome ── */}
      {isEmpty ? (
        <div className="chat-welcome">
          <img src="/logo.svg" alt="IdeaBlast" className="chat-welcome-logo" />
          <h2>IdeaBlast Companion</h2>
          <p>
            Your local AI assistant connected to IdeaBlast.
            {mcpConnected
              ? " MCP Sync active — I can manage your ideas."
              : " Start MCP Sync in IdeaBlast to manage ideas."}
          </p>
          <div className="quick-prompts">
            {QUICK_PROMPTS.map((qp, i) => (
              <button
                key={i}
                className="quick-prompt"
                onClick={() => handleSubmit(qp.text)}
              >
                <span className="quick-prompt-icon">{qp.icon}</span>
                {qp.desc}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat-messages">
          <div className="chat-messages-inner">
            {messages.map((msg) => (
              <div key={msg.id} className={`msg-row ${msg.role}`}>
                <div className={`msg-avatar ${msg.role}`}>
                  {msg.role === "user" ? "U" : "AI"}
                </div>
                <div className="msg-body">
                  <div className="msg-name">
                    {msg.role === "user" ? "You" : modelName || "AI"}
                  </div>
                  {msg.mcpTool && (
                    <div className={`mcp-tool-call ${
                      msg.mcpTool.statusMessage.includes("confirm") || msg.mcpTool.statusMessage.includes("⚠️")
                        ? "mcp-confirm"
                        : msg.mcpTool.statusMessage.includes("✅")
                        ? "mcp-success"
                        : msg.mcpTool.statusMessage.includes("❌")
                        ? "mcp-cancelled"
                        : ""
                    }`}>
                      <div className="mcp-tool-header">
                        ⚡ MCP: {msg.mcpTool.statusMessage}
                      </div>
                      {msg.mcpTool.progressSteps && msg.mcpTool.progressSteps.length > 0 && (
                        <div className="mcp-progress-log">
                          {msg.mcpTool.progressSteps.map((step, idx) => (
                            <div key={idx} className="mcp-progress-step">{step}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="msg-content">
                    {msg.content || (
                      <span className="typing-dots">
                        <span />
                        <span />
                        <span />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {error && (
              <div className="chat-error">
                <div className="chat-error-inner">⚠ {error}</div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* ── Input Area ── */}
      <div className="input-area">
        <div className="input-area-inner">
          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="attachments-row">
              {attachments.map((att, i) => (
                <div key={i} className="att-chip">
                  <span>{att.isImage ? "🖼" : "📄"} {att.name}</span>
                  <button
                    className="att-chip-remove"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input box */}
          <div className="input-box">
            <div className="input-actions">
              <button
                className="input-btn"
                onClick={handleAttach}
                disabled={isStreaming}
                title="Attach file"
              >
                📎
              </button>
            </div>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mcpConnected
                  ? "Type a message or ask to manage your ideas..."
                  : "Type a message..."
              }
              disabled={isStreaming}
              rows={1}
            />

            <div className="input-actions">
              {messages.length > 0 && (
                <button
                  className="input-btn"
                  onClick={onClear}
                  disabled={isStreaming}
                  title="Clear chat"
                >
                  🗑
                </button>
              )}
              <button
                className="input-btn send-btn"
                onClick={() => handleSubmit()}
                disabled={isStreaming || (!input.trim() && attachments.length === 0)}
                title="Send"
              >
                ▶
              </button>
            </div>
          </div>

          <div className="input-hint">
            {modelName} · Shift+Enter for new line
            {mcpConnected && " · MCP Sync active"}
          </div>
        </div>
      </div>
    </div>
  );
}
