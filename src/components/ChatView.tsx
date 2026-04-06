import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ChatMessage } from "../hooks/useChat";

interface FileAttachment {
  name: string;
  content: string;
  isImage: boolean;
}

interface ChatViewProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSend: (content: string, images?: string[]) => void;
  onClear: () => void;
}

export function ChatView({
  messages,
  isStreaming,
  error,
  onSend,
  onClear,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  const handleAttachFile = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Files",
            extensions: [
              "txt", "md", "json", "csv", "py", "js", "ts", "tsx",
              "rs", "html", "css", "yaml", "yml", "toml", "sh",
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
            mime_type: string;
          }>("read_file_content", { path: filePath });

          setAttachments((prev) => [
            ...prev,
            {
              name: result.name,
              content: result.content,
              isImage: result.is_image,
            },
          ]);
        } catch (err) {
          console.error("Failed to read file:", err);
        }
      }
    } catch (err) {
      console.error("File dialog error:", err);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!input.trim() && attachments.length === 0) return;
    if (isStreaming) return;

    // Gather images (base64) for multimodal
    const images = attachments
      .filter((a) => a.isImage)
      .map((a) => a.content);

    // Gather text files and prepend to message
    const textFiles = attachments.filter((a) => !a.isImage);
    let fullContent = input.trim();

    if (textFiles.length > 0) {
      const fileContext = textFiles
        .map((f) => `--- ${f.name} ---\n${f.content}`)
        .join("\n\n");
      fullContent = `${fileContext}\n\n${fullContent}`;
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

  return (
    <div className="chat-view">
      {/* Messages area */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">⚡</div>
            <h2>IdeaBlast Companion</h2>
            <p>Type a message or attach a file to get started.</p>
            <div className="chat-hints">
              <span className="hint-chip">💬 Chat with local AI</span>
              <span className="hint-chip">📎 Attach documents</span>
              <span className="hint-chip">🖼️ Send images</span>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble ${msg.role}`}>
            <div className="bubble-header">
              <span className="bubble-role">
                {msg.role === "user" ? "You" : "AI"}
              </span>
            </div>
            <div className="bubble-content">
              {msg.content || (
                <span className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </div>
          </div>
        ))}

        {error && (
          <div className="chat-error">
            <span>⚠ {error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="attachments-bar">
          {attachments.map((att, i) => (
            <div key={i} className="attachment-chip">
              <span>{att.isImage ? "🖼️" : "📄"} {att.name}</span>
              <button
                className="attachment-remove"
                onClick={() => removeAttachment(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-bar">
        <button
          className="attach-btn"
          onClick={handleAttachFile}
          disabled={isStreaming}
          title="Attach file"
        >
          📎
        </button>

        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Shift+Enter for new line)"
          disabled={isStreaming}
          rows={1}
        />

        <button
          className="send-btn"
          onClick={handleSubmit}
          disabled={isStreaming || (!input.trim() && attachments.length === 0)}
        >
          {isStreaming ? "⏳" : "▶"}
        </button>

        {messages.length > 0 && (
          <button
            className="clear-btn"
            onClick={onClear}
            disabled={isStreaming}
            title="Clear chat"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}
