import { describe, expect, it } from "vitest";
import { detectIntentRegex } from "./mcpBrain";

describe("MCP intent routing", () => {
  it.each([
    ["clear pending queue", "clear_pending"],
    ["create a note for tomorrow", "create_sticky"],
    ["create a kanban card for the release", "create_kanban"],
    ["delete the kanban card", "update_kanban"],
    ["delete the daily note", "update_daily_note"],
    ["delete the launch idea", "delete_idea"],
    ["show my ideas", "read_ideas"],
  ])("routes %j to %s", (message, expectedTool) => {
    expect(detectIntentRegex(message)).toBe(expectedTool);
  });
});
