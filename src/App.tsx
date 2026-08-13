import { useState, useEffect, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useOllamaDiscovery } from "./hooks/useOllamaDiscovery";
import { useChat, setMcpConnected } from "./hooks/useChat";
import { useMcpStatus } from "./hooks/useMcpStatus";
import { ChatPanel } from "./components/ChatPanel";
import { HistorySidebar } from "./components/HistorySidebar";
import { FolderPickerModal } from "./components/FolderPickerModal";
import { useSettings } from "./lib/settings";
import {
  saveConversation,
  loadConversation,
  deriveTitle,
  makeChatId,
  exportConversationMd,
  type SavedConversation,
} from "./lib/conversationStore";
import { conversationToMarkdown } from "./lib/markdownExport";

function App() {
  const { loading, connected, models, error, retry } = useOllamaDiscovery();
  const [selectedModel, setSelectedModel] = useState<string>("");
  const mcpStatus = useMcpStatus();

  // Auto-select first model
  const activeModel = selectedModel || models[0]?.name || "";
  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0].name);
    }
  }, [models, selectedModel]);

  // Sync MCP status with the chat hook's brain
  useEffect(() => {
    setMcpConnected(mcpStatus.connected);
  }, [mcpStatus.connected]);

  const chat = useChat(activeModel);
  const { settings, loaded: settingsLoaded, update: updateSettings } = useSettings();
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const handleSaveCurrent = useCallback(async () => {
    if (!settings.conversationsFolder || chat.messages.length === 0) return;
    const id = chat.currentChatId ?? makeChatId(deriveTitle(chat.messages));
    const now = Date.now();
    const conv: SavedConversation = {
      id,
      title: deriveTitle(chat.messages),
      model: activeModel,
      createdAt: now,
      updatedAt: now,
      messages: chat.messages,
    };
    await saveConversation(settings.conversationsFolder, conv);
    chat.markSaved(id);
    setHistoryRefresh((n) => n + 1);
  }, [settings.conversationsFolder, chat, activeModel]);

  const handleLoadChat = useCallback(
    async (id: string) => {
      if (!settings.conversationsFolder) return;
      try {
        const conv = await loadConversation(settings.conversationsFolder, id);
        chat.loadMessages(conv.id, conv.messages);
      } catch (e) {
        console.warn("[app] load chat failed:", e);
      }
    },
    [settings.conversationsFolder, chat]
  );

  const handleExportMd = useCallback(async () => {
    if (!settings.conversationsFolder || chat.messages.length === 0) return;
    const id = chat.currentChatId ?? makeChatId(deriveTitle(chat.messages));
    const md = conversationToMarkdown(deriveTitle(chat.messages), activeModel, chat.messages);
    await exportConversationMd(settings.conversationsFolder, id, md);
  }, [settings.conversationsFolder, chat, activeModel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "n") {
        e.preventDefault();
        chat.clearChat();
      } else if (e.key === "s") {
        e.preventDefault();
        handleSaveCurrent().catch(() => {});
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chat, handleSaveCurrent]);

  // Auto-save after each assistant turn finishes
  useEffect(() => {
    if (
      settings.autoSave &&
      settings.conversationsFolder &&
      !chat.isStreaming &&
      chat.dirty &&
      chat.messages.length > 0
    ) {
      handleSaveCurrent().catch((e) => console.warn("[autosave]", e));
    }
  }, [chat.isStreaming, chat.dirty, chat.messages.length, settings.autoSave, settings.conversationsFolder, handleSaveCurrent]);

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="/logo.svg" alt="IdeaBlast" className="sidebar-logo" />
          <span className="sidebar-title">IdeaBlast Companion</span>
        </div>

        <button className="sidebar-new-chat" onClick={chat.clearChat}>
          + New Chat
        </button>

        <HistorySidebar
          folder={settings.conversationsFolder}
          currentChatId={chat.currentChatId}
          refreshKey={historyRefresh}
          onSelect={handleLoadChat}
        />

        {/* Connection status */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Connections</div>

          <div className="status-card">
            <span className={`status-indicator ${connected ? "online" : "offline"}`} />
            <span className="status-label">Ollama</span>
            <span className="status-value">
              {loading ? "..." : connected ? "Online" : "Offline"}
            </span>
          </div>

          <div className="status-card">
            <span className={`status-indicator ${mcpStatus.connected ? "online" : "offline"}`} />
            <span className="status-label">MCP Sync</span>
            <span className="status-value" title={mcpStatus.message ?? undefined}>
              {mcpStatus.checking
                ? "..."
                : mcpStatus.status === "active"
                  ? "Active"
                  : mcpStatus.status === "stale"
                    ? "Stale"
                    : mcpStatus.status === "waiting"
                      ? "Waiting"
                      : "Inactive"}
            </span>
          </div>
        </div>

        {/* Model selector */}
        {connected && models.length > 0 && (
          <div className="model-select-wrap">
            <div className="sidebar-section-title">AI Model</div>
            <select
              className="model-select"
              value={activeModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              aria-label="Select AI model"
            >
              {models.map((m) => (
                <option key={m.digest} value={m.name}>
                  {m.name} ({(m.size / 1_073_741_824).toFixed(1)}GB)
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="sidebar-footer">
          <a
            className="sidebar-footer-brand"
            onClick={() => openUrl("https://ideablast.app/").catch(console.error)}
          >
            <img src="/logo.svg" alt="IdeaBlast" className="sidebar-footer-logo" />
            ideablast.app
          </a>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <button
              className="theme-toggle"
              onClick={() =>
                updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" })
              }
              title="Toggle theme"
            >
              {settings.theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
            <p className="sidebar-footer-text" style={{ margin: 0 }}>
              v1.2.3
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main Panel ── */}
      <main className="main-panel">
        {loading && (
          <div className="center-state">
            <div className="loader-ring" />
            <p>Connecting to Ollama...</p>
          </div>
        )}

        {!loading && !connected && (
          <div className="center-state">
            <div className="offline-card">
              <h2>Ollama not detected</h2>
              <p>Make sure Ollama is running on <code>localhost:11434</code></p>
              {error && <p className="offline-error">{error}</p>}
              <button className="btn-outline" onClick={retry}>Retry Connection</button>
            </div>
          </div>
        )}

        {!loading && connected && (
          <ChatPanel
            messages={chat.messages}
            isStreaming={chat.isStreaming}
            error={chat.error}
            onSend={chat.sendMessage}
            onClear={chat.clearChat}
            mcpConnected={mcpStatus.connected}
            mcpStatusMessage={mcpStatus.message}
            modelName={activeModel}
            dirty={chat.dirty}
            canPersist={!!settings.conversationsFolder}
            onSave={handleSaveCurrent}
            onExportMd={handleExportMd}
          />
        )}
      </main>

      {settingsLoaded && !settings.conversationsFolder && (
        <FolderPickerModal
          onPicked={(folder) => updateSettings({ conversationsFolder: folder })}
        />
      )}
    </div>
  );
}

export default App;
