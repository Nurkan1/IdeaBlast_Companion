import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  listConversations,
  deleteConversation,
  renameConversation,
  type ConversationMeta,
} from "../lib/conversationStore";

interface Props {
  folder: string | null;
  currentChatId: string | null;
  refreshKey: number;
  onSelect: (id: string) => void;
}

export function HistorySidebar({ folder, currentChatId, refreshKey, onSelect }: Props) {
  const [items, setItems] = useState<ConversationMeta[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!folder) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const list = await listConversations(folder);
      setItems(list);
    } catch (e) {
      console.warn("[history] list failed:", e);
    } finally {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!folder) return;
    if (!confirm("Delete this conversation?")) return;
    await deleteConversation(folder, id);
    refresh();
  };

  const handleRename = async (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!folder) return;
    const next = prompt("New title", currentTitle);
    if (!next || next === currentTitle) return;
    await renameConversation(folder, id, next);
    refresh();
  };

  const handleOpenFolder = async () => {
    if (!folder) return;
    try {
      await invoke("open_in_explorer", { path: folder });
    } catch (e) {
      console.warn("[history] open folder failed:", e);
    }
  };

  const filtered = items.filter((i) =>
    i.title.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="sidebar-section history-section">
      <div className="sidebar-section-title">
        History
        {folder && (
          <button
            className="history-folder-btn"
            onClick={handleOpenFolder}
            title="Open folder"
          >
            📂
          </button>
        )}
      </div>
      {!folder ? (
        <p className="history-empty">No folder selected.</p>
      ) : (
        <>
          <input
            className="history-search"
            placeholder="Search…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="history-list">
            {loading && <p className="history-empty">Loading…</p>}
            {!loading && filtered.length === 0 && (
              <p className="history-empty">No conversations yet.</p>
            )}
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`history-item ${currentChatId === c.id ? "active" : ""}`}
                onClick={() => onSelect(c.id)}
                title={c.title}
              >
                <div className="history-item-title">{c.title}</div>
                <div className="history-item-actions">
                  <button
                    className="history-item-btn"
                    onClick={(e) => handleRename(c.id, c.title, e)}
                    title="Rename"
                  >
                    ✏️
                  </button>
                  <button
                    className="history-item-btn"
                    onClick={(e) => handleDelete(c.id, e)}
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
