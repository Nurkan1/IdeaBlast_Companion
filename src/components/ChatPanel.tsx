import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  dirty?: boolean;
  canPersist?: boolean;
  onSave?: () => void;
  onExportMd?: () => void;
}

const QUICK_PROMPTS = [
  { icon: "\u{1F4A1}", text: "Show me my ideas", desc: "Read ideas from IdeaBlast" },
  { icon: "\u{1F4CB}", text: "Create a plan to learn React in 2 weeks", desc: "Plan with dates" },
  { icon: "\u2728", text: "Brainstorm ideas about productivity", desc: "Generate & save ideas" },
  { icon: "\u{1F4CA}", text: "Show my stats and progress", desc: "Productivity overview" },
];

/** Copy text to clipboard with visual feedback */
function useCopyFeedback(): [Set<string>, (id: string, text: string) => void] {
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());

  const copyText = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIds((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setCopiedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2000);
    });
  }, []);

  return [copiedIds, copyText];
}

export function ChatPanel({
  messages,
  isStreaming,
  error,
  onSend,
  onClear,
  mcpConnected,
  modelName,
  dirty,
  canPersist,
  onSave,
  onExportMd,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copiedIds, copyText] = useCopyFeedback();

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

  const handleOpenIdeaBlast = () => {
    openUrl("https://ideablast.app/").catch(console.error);
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="chat-container">
      {/* ── Chat Toolbar (visible when conversation exists) ── */}
      {!isEmpty && (
        <div className="chat-toolbar">
          <div className="chat-toolbar-inner">
            <span className="chat-toolbar-title">
              {mcpConnected && <span className="mcp-badge">MCP</span>}
              {modelName}
            </span>
            <div className="chat-toolbar-actions">
              {canPersist && onSave && (
                <button
                  className="toolbar-btn"
                  onClick={onSave}
                  disabled={isStreaming || messages.length === 0}
                  title={dirty ? "Unsaved changes" : "Saved"}
                >
                  💾 {dirty ? "Save*" : "Saved"}
                </button>
              )}
              {canPersist && onExportMd && (
                <button
                  className="toolbar-btn"
                  onClick={onExportMd}
                  disabled={isStreaming || messages.length === 0}
                  title="Export to Markdown"
                >
                  📤 Export MD
                </button>
              )}
              <button
                className="toolbar-btn"
                onClick={onClear}
                disabled={isStreaming}
                title="New conversation"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                New Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Messages or Welcome ── */}
      {isEmpty ? (
        <div className="chat-welcome">
          <img src="/logo.svg" alt="IdeaBlast" className="chat-welcome-logo" />
          <h2>IdeaBlast Companion</h2>
          <p>
            Your local AI assistant connected to{" "}
            <a className="ideablast-link" onClick={handleOpenIdeaBlast}>
              IdeaBlast
            </a>
            .
            {mcpConnected
              ? " MCP Sync active \u2014 I can manage your ideas."
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
                  <div className="msg-header">
                    <div className="msg-name">
                      {msg.role === "user" ? "You" : modelName || "AI"}
                    </div>
                    {/* ── Action buttons ── */}
                    {msg.content && (
                      <div className="msg-actions">
                        <button
                          className={`msg-action-btn ${copiedIds.has(msg.id) ? "copied" : ""}`}
                          onClick={() => copyText(msg.id, msg.content)}
                          title={copiedIds.has(msg.id) ? "Copied!" : "Copy message"}
                        >
                          {copiedIds.has(msg.id) ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {msg.mcpTool && (
                    <div className={`mcp-tool-call ${
                      msg.mcpTool.statusMessage.includes("confirm") || msg.mcpTool.statusMessage.includes("\u26A0\uFE0F")
                        ? "mcp-confirm"
                        : msg.mcpTool.statusMessage.includes("\u2705")
                        ? "mcp-success"
                        : msg.mcpTool.statusMessage.includes("\u274C")
                        ? "mcp-cancelled"
                        : ""
                    }`}>
                      <div className="mcp-tool-header">
                        {"\u26A1"} MCP: {msg.mcpTool.statusMessage}
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
                    {msg.content ? (
                      msg.role === "assistant" ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, children }) => {
                              const safe =
                                typeof href === "string" &&
                                /^https?:\/\//i.test(href);
                              return (
                                <a
                                  href={safe ? href : undefined}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (safe) openUrl(href!).catch(console.error);
                                  }}
                                  style={{ cursor: safe ? "pointer" : "default" }}
                                >
                                  {children}
                                </a>
                              );
                            },
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      ) : (
                        msg.content
                      )
                    ) : (
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
                <div className="chat-error-inner">{"\u26A0"} {error}</div>
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
                  <span>{att.isImage ? "\u{1F5BC}" : "\u{1F4C4}"} {att.name}</span>
                  <button
                    className="att-chip-remove"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    {"\u00D7"}
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
                {"\uD83D\uDCCE"}
              </button>
            </div>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                mcpConnected
                  ? "Ask anything \u2014 I understand natural language..."
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
                  {"\uD83D\uDDD1"}
                </button>
              )}
              <button
                className="input-btn send-btn"
                onClick={() => handleSubmit()}
                disabled={isStreaming || (!input.trim() && attachments.length === 0)}
                title="Send"
              >
                {"\u25B6"}
              </button>
            </div>
          </div>

          <div className="input-hint">
            <span>{modelName} {"\u00B7"} Shift+Enter for new line{mcpConnected && " \u00B7 MCP Sync active"}</span>
            <span className="input-hint-separator">{"\u00B7"}</span>
            <a className="input-hint-link" onClick={handleOpenIdeaBlast}>ideablast.app</a>
          </div>
        </div>
      </div>
    </div>
  );
}
