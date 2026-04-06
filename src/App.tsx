import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useOllamaDiscovery } from "./hooks/useOllamaDiscovery";
import { useChat, setMcpConnected } from "./hooks/useChat";
import { useMcpStatus } from "./hooks/useMcpStatus";
import { ChatPanel } from "./components/ChatPanel";

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
            <span className="status-value">
              {mcpStatus.connected ? "Active" : "Inactive"}
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
          <p className="sidebar-footer-text">
            v1.1.0 · Powered by Ollama
          </p>
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
            modelName={activeModel}
          />
        )}
      </main>
    </div>
  );
}

export default App;
