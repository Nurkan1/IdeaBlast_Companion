import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../hooks/useChat";

export interface SavedConversation {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ConversationMeta {
  id: string;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
  size: number;
}

/** Build a filename-safe id from a title + timestamp */
export function makeChatId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `chat-${Date.now()}-${slug || "untitled"}`;
}

/** First user message, truncated, used as title */
export function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = (first?.content ?? "Untitled").trim().replace(/\s+/g, " ");
  return text.length > 60 ? text.slice(0, 57) + "..." : text || "Untitled";
}

export async function saveConversation(
  folder: string,
  conv: SavedConversation
): Promise<void> {
  const payload = JSON.stringify(conv, null, 2);
  await invoke("save_conversation", {
    folder,
    filename: conv.id,
    json: payload,
  });
}

export async function loadConversation(
  folder: string,
  id: string
): Promise<SavedConversation> {
  const raw = await invoke<string>("load_conversation", { folder, filename: id });
  return JSON.parse(raw) as SavedConversation;
}

export async function listConversations(folder: string): Promise<ConversationMeta[]> {
  return invoke<ConversationMeta[]>("list_conversations", { folder });
}

export async function deleteConversation(folder: string, id: string): Promise<void> {
  await invoke("delete_conversation", { folder, filename: id });
}

export async function renameConversation(
  folder: string,
  oldId: string,
  newTitle: string
): Promise<void> {
  const newId = makeChatId(newTitle);
  await invoke("rename_conversation", {
    folder,
    oldFilename: oldId,
    newFilename: newId,
  });
}

export async function exportConversationMd(
  folder: string,
  id: string,
  markdown: string
): Promise<string> {
  return invoke<string>("export_conversation_md", {
    folder,
    filename: id,
    markdown,
  });
}
