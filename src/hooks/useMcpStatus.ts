import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export type McpConnectionStatus = "checking" | "active" | "stale" | "waiting" | "offline";

interface McpStatusState {
  connected: boolean;
  checking: boolean;
  status: McpConnectionStatus;
  message: string | null;
}

interface McpHealthResponse {
  status?: string;
  version?: string;
  snapshotAvailable?: boolean;
  snapshotUpdatedAt?: string | null;
}

export interface McpProbeResult {
  connected: boolean;
  serverReachable: boolean;
  status: Exclude<McpConnectionStatus, "checking">;
  message: string | null;
}

const MCP_HEALTH_URLS = [
  "http://127.0.0.1:3456/api/health",
  "http://127.0.0.1:3456/health",
];

const MCP_SNAPSHOT_MAX_AGE_MS = 120_000;

export function formatMcpSnapshotAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds} seconds`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours`;

  return `${Math.round(hours / 24)} days`;
}

export async function probeMcp(): Promise<McpProbeResult> {
  for (const url of MCP_HEALTH_URLS) {
    try {
      const result = await invoke<{ status: number; body: string }>("http_proxy", {
        request: { url, method: "GET", body: null, headers: null },
      });
      if (result.status < 200 || result.status >= 400) continue;

      let health: McpHealthResponse;
      try {
        health = JSON.parse(result.body) as McpHealthResponse;
      } catch (error) {
        console.warn("MCP health response is invalid:", error);
        return {
          connected: false,
          serverReachable: true,
          status: "waiting",
          message: "MCP bridge returned an invalid health response.",
        };
      }

      if (!health || typeof health !== "object" || health.status !== "ok") {
        return {
          connected: false,
          serverReachable: true,
          status: "waiting",
          message: "MCP bridge returned an invalid health response.",
        };
      }

      if (!("snapshotAvailable" in health) || !("snapshotUpdatedAt" in health)) {
        return {
          connected: false,
          serverReachable: true,
          status: "waiting",
          message: "Update ideablast-mcp-server to version 1.3.3 or newer.",
        };
      }
      if (!health.snapshotAvailable || !health.snapshotUpdatedAt) {
        return {
          connected: false,
          serverReachable: true,
          status: "waiting",
          message: "Open IdeaBlast and enable MCP Sync to publish its current data.",
        };
      }

      const updatedAt = Date.parse(health.snapshotUpdatedAt);
      if (!Number.isFinite(updatedAt)) {
        return {
          connected: false,
          serverReachable: true,
          status: "waiting",
          message: "MCP bridge reported an invalid snapshot timestamp.",
        };
      }

      const ageMs = Math.max(0, Date.now() - updatedAt);
      if (ageMs > MCP_SNAPSHOT_MAX_AGE_MS) {
        const age = formatMcpSnapshotAge(ageMs);
        return {
          connected: false,
          serverReachable: true,
          status: "stale",
          message: `MCP bridge is online, but IdeaBlast Sync is stale (${age} old). Re-enable it in IdeaBlast.`,
        };
      }

      return { connected: true, serverReachable: true, status: "active", message: null };
    } catch {
      // Try the compatibility health route before declaring the bridge offline.
    }
  }

  return {
    connected: false,
    serverReachable: false,
    status: "offline",
    message: "MCP bridge is offline.",
  };
}

/**
 * Polls both the local MCP bridge and the browser-published snapshot.
 * A listening port alone is not enough: data must have been refreshed recently.
 */
export function useMcpStatus(): McpStatusState {
  const [state, setState] = useState<McpStatusState>({
    connected: false,
    checking: true,
    status: "checking",
    message: null,
  });
  const launchAttempted = useRef(false);

  const check = useCallback(async () => {
    let result = await probeMcp();

    if (!result.serverReachable && !launchAttempted.current) {
      launchAttempted.current = true;
      try {
        await invoke("mcp_launch_server");
        result = await probeMcp();
      } catch (error) {
        console.warn("MCP auto-launch failed:", error);
      }
    }

    setState({
      connected: result.connected,
      checking: false,
      status: result.status,
      message: result.message,
    });
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 5_000);
    return () => clearInterval(interval);
  }, [check]);

  return state;
}
