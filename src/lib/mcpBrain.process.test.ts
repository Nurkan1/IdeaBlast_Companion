import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getInbox: vi.fn(),
  clearInbox: vi.fn(),
  createIdea: vi.fn(),
  createStickyNote: vi.fn(),
  createKanbanCard: vi.fn(),
  queueAction: vi.fn(),
  ollamaRequest: vi.fn(),
}));

vi.mock("./mcpClient", () => ({
  mcpGetSnapshot: mocks.getSnapshot,
  mcpGetInbox: mocks.getInbox,
  mcpClearInbox: mocks.clearInbox,
  mcpCreateIdea: mocks.createIdea,
  mcpCreateStickyNote: mocks.createStickyNote,
  mcpCreateKanbanCard: mocks.createKanbanCard,
  mcpQueueAction: mocks.queueAction,
}));

vi.mock("./httpProxy", () => ({ ollamaRequest: mocks.ollamaRequest }));

import { processWithMcp } from "./mcpBrain";

describe("MCP tool results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the exact snapshot result as a direct response", async () => {
    mocks.getSnapshot.mockResolvedValue({
      ideas: [{ id: "idea-12345678", text: "Unique snapshot result" }],
    });

    const result = await processWithMcp("show my ideas", true);

    expect(result.toolResult?.responseText).toContain("Unique snapshot result");
    expect(result.toolResult?.toolName).toBe("read_ideas");
    expect(mocks.ollamaRequest).not.toHaveBeenCalled();
  });

  it("clears the queue instead of only listing it", async () => {
    mocks.clearInbox.mockResolvedValue(3);

    const result = await processWithMcp("clear pending queue", true);

    expect(mocks.clearInbox).toHaveBeenCalledOnce();
    expect(mocks.getInbox).not.toHaveBeenCalled();
    expect(result.toolResult?.responseText).toContain("Cleared 3");
  });

  it("previews only the specifically named idea for deletion", async () => {
    mocks.getSnapshot.mockResolvedValue({
      ideas: [
        { id: "idea-launch", text: "Prepare product launch" },
        { id: "idea-budget", text: "Review annual budget" },
      ],
    });

    const result = await processWithMcp("delete the product launch idea", true);

    expect(result.toolResult?.responseText).toContain("Prepare product launch");
    expect(result.toolResult?.responseText).not.toContain("Review annual budget");
  });
});
