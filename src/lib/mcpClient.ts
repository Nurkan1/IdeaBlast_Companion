/**
 * MCP Client — reads from the active local HTTP bridge.
 *
 * Queue writes still use the installed MCP package commands because the bridge
 * exposes read and acknowledgement routes but no POST route for queue items.
 */

import { invoke } from "@tauri-apps/api/core";
import { mcpDelete, mcpGet } from "./httpProxy";

// ── Public Types ────────────────────────────────────────────

export interface McpIdea {
  id: string;
  text: string;
  tags?: string[];
  status?: string;
  isFavorite?: boolean;
  isDone?: boolean;
  createdAt?: string;
  deadline?: string;
}

export interface McpSnapshot {
  ideas?: McpIdea[];
  dailyNotes?: unknown[];
  kanbanCards?: unknown[];
  boardroomSessions?: unknown[];
  updatedAt?: string;
}

// ── READ Operations (from snapshot.json) ────────────────────

/** Get the current snapshot — IdeaBlast browser pushes state here every 5s */
export async function mcpGetSnapshot(): Promise<McpSnapshot> {
  const response = await mcpGet<McpSnapshot | {
    error?: { code?: string; message?: string } | string;
  }>("/api/snapshot");

  if (response.status === 404) {
    throw new Error("No IdeaBlast snapshot is available. Enable MCP Sync in IdeaBlast.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`MCP snapshot returned HTTP ${response.status}`);
  }
  if (
    !response.data
    || typeof response.data !== "object"
    || Array.isArray(response.data)
    || !Array.isArray((response.data as McpSnapshot).ideas)
  ) {
    throw new Error("MCP snapshot response is invalid");
  }

  return response.data as McpSnapshot;
}

/** Get pending inbox items */
export async function mcpGetInbox(): Promise<unknown[]> {
  const response = await mcpGet<{ items?: unknown[] }>("/api/inbox");
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`MCP inbox returned HTTP ${response.status}`);
  }
  return Array.isArray(response.data.items) ? response.data.items : [];
}

/** Clear every pending inbox item through the MCP bridge. */
export async function mcpClearInbox(): Promise<number> {
  const items = await mcpGetInbox();
  const ids = items
    .map((item) => item && typeof item === "object" ? (item as { id?: unknown }).id : undefined)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  for (const id of ids) {
    const response = await mcpDelete(`/api/inbox/${encodeURIComponent(id)}`);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`MCP failed to clear inbox item ${id}: HTTP ${response.status}`);
    }
  }

  return ids.length;
}

// ── CREATE Operations (write to inbox.json) ─────────────────
// Replicates the exact format used by MCP tools like create_idea, brainstorm, etc.

/** Create a single idea — writes to inbox.json like create_idea tool */
export async function mcpCreateIdea(text: string, tags?: string[], deadline?: string): Promise<string> {
  const item = {
    type: "idea",
    text: text.trim(),
    tags: tags ?? [],
    ...(deadline ? { deadline } : {}),
    source: "companion",
  };
  return invoke<string>("mcp_add_to_inbox", { itemJson: JSON.stringify(item) });
}

/** Create multiple ideas — writes each to inbox.json like brainstorm tool */
export async function mcpBrainstorm(ideas: { text: string; tags?: string[] }[]): Promise<void> {
  for (const idea of ideas) {
    await mcpCreateIdea(idea.text, idea.tags);
  }
}

/** Create a sticky note — writes to inbox.json like create_sticky_note tool */
export async function mcpCreateStickyNote(text: string, color?: string): Promise<string> {
  const item = {
    type: "daily_note",
    text: text.trim(),
    color: color ?? "yellow",
    source: "companion",
  };
  return invoke<string>("mcp_add_to_inbox", { itemJson: JSON.stringify(item) });
}

/** Create a Kanban card — writes to inbox.json like create_kanban_card tool */
export async function mcpCreateKanbanCard(
  title: string,
  column?: string,
  description?: string,
  priority?: string
): Promise<string> {
  const item = {
    type: "kanban_card",
    title: title.trim(),
    column: column ?? "todo",
    ...(description ? { description } : {}),
    ...(priority ? { priority } : {}),
    source: "companion",
  };
  return invoke<string>("mcp_add_to_inbox", { itemJson: JSON.stringify(item) });
}

// ── UPDATE Operations (write to actions.json) ───────────────

/** Queue an action — writes to actions.json for IdeaBlast to apply.
 *  Format must match ActionItem: { action, targetId, payload? }
 *  The Rust command adds id + createdAt automatically. */
export async function mcpQueueAction(params: {
  targetId: string;
  action: string;
  payload?: string;
}): Promise<string> {
  // Only pass fields that ActionItem expects — no extra "type" field
  const actionObj: Record<string, string> = {
    action: params.action,
    targetId: params.targetId,
  };
  if (params.payload) actionObj.payload = params.payload;
  return invoke<string>("mcp_add_action", { actionJson: JSON.stringify(actionObj) });
}
