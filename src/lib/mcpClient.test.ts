import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { mcpGetSnapshot } from "./mcpClient";

describe("MCP snapshot client", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("reads the snapshot from the active HTTP bridge", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        ideas: [{ id: "idea-1", text: "Published by IdeaBlast" }],
        updatedAt: "2026-08-13T11:31:10.000Z",
      }),
    });

    await expect(mcpGetSnapshot()).resolves.toMatchObject({
      ideas: [{ id: "idea-1", text: "Published by IdeaBlast" }],
    });
    expect(invokeMock).toHaveBeenCalledWith("http_proxy", {
      request: expect.objectContaining({
        url: "http://127.0.0.1:3456/api/snapshot",
        method: "GET",
      }),
    });
  });

  it("surfaces a missing snapshot instead of returning invented empty data", async () => {
    invokeMock.mockResolvedValue({
      status: 404,
      body: JSON.stringify({
        success: false,
        error: { code: "SNAPSHOT_NOT_FOUND", message: "No snapshot is available yet" },
      }),
    });

    await expect(mcpGetSnapshot()).rejects.toThrow("No IdeaBlast snapshot is available");
  });

  it("rejects a malformed successful snapshot response", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ updatedAt: "2026-08-13T11:31:10.000Z" }),
    });

    await expect(mcpGetSnapshot()).rejects.toThrow("MCP snapshot response is invalid");
  });
});
