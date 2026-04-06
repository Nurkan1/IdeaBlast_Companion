/**
 * MCP Client — Uses Rust commands for direct file I/O on the MCP server's
 * data directory (inbox.json, snapshot.json, actions.json).
 *
 * This replicates the exact behavior of the MCP tools (create_idea, brainstorm, etc.)
 * which write directly to these files. The HTTP bridge only serves GET/DELETE endpoints.
 */

import { invoke } from "@tauri-apps/api/core";

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
}

// ── READ Operations (from snapshot.json) ────────────────────

/** Get the current snapshot — IdeaBlast browser pushes state here every 5s */
export async function mcpGetSnapshot(): Promise<McpSnapshot> {
  const raw = await invoke<string>("mcp_read_snapshot");
  try {
    return JSON.parse(raw) as McpSnapshot;
  } catch {
    return {};
  }
}

/** Get pending inbox items */
export async function mcpGetInbox(): Promise<unknown[]> {
  const raw = await invoke<string>("mcp_read_inbox");
  try {
    const data = JSON.parse(raw);
    return data.items ?? [];
  } catch {
    return [];
  }
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
