import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { formatMcpSnapshotAge, probeMcp } from "./useMcpStatus";

describe("MCP snapshot age", () => {
  it("formats old snapshots in days instead of raw seconds", () => {
    expect(formatMcpSnapshotAge(10_270_266_000)).toBe("119 days");
  });
});

describe("MCP sync probing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("rejects a reachable bridge when its snapshot is stale", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "http_proxy") return {
        status: 200,
        body: JSON.stringify({
          status: "ok",
          version: "1.3.3",
          snapshotAvailable: true,
          snapshotUpdatedAt: new Date(Date.now() - 180_000).toISOString(),
        }),
      };
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(probeMcp()).resolves.toMatchObject({
      connected: false,
      serverReachable: true,
      status: "stale",
      message: "MCP bridge is online, but IdeaBlast Sync is stale (3 minutes old). Re-enable it in IdeaBlast.",
    });
  });

  it("accepts snapshots delayed by browser background throttling", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        status: "ok",
        version: "1.3.3",
        snapshotAvailable: true,
        snapshotUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    });

    await expect(probeMcp()).resolves.toMatchObject({
      connected: true,
      status: "active",
    });
  });

  it("accepts the MCP connection only when the snapshot is fresh", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "http_proxy") return {
        status: 200,
        body: JSON.stringify({
          status: "ok",
          version: "1.3.3",
          snapshotAvailable: true,
          snapshotUpdatedAt: new Date(Date.now() - 2_000).toISOString(),
        }),
      };
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(probeMcp()).resolves.toMatchObject({
      connected: true,
      serverReachable: true,
      status: "active",
    });
  });

  it("requires an MCP server with the HTTP snapshot contract", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "http_proxy") {
        return { status: 200, body: JSON.stringify({ status: "ok", version: "1.3.2" }) };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(probeMcp()).resolves.toMatchObject({
      connected: false,
      serverReachable: true,
      status: "waiting",
      message: expect.stringContaining("1.3.3"),
    });
  });

  it("does not inspect the npm installation filesystem", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        status: "ok",
        version: "1.3.3",
        snapshotAvailable: false,
        snapshotUpdatedAt: null,
      }),
    });

    await probeMcp();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("http_proxy", expect.any(Object));
  });
});
