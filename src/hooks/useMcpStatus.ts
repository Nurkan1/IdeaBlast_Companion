import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface McpStatusState {
  connected: boolean;
  checking: boolean;
}

// Try both /api/health and /health to cover all MCP server versions
const MCP_HEALTH_URLS = [
  "http://127.0.0.1:3456/api/health",
  "http://127.0.0.1:3456/health",
];

/**
 * Polls the local MCP server health endpoint every 5 seconds.
 * On first run, if the server is not reachable, tries to auto-launch it.
 */
export function useMcpStatus(): McpStatusState {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const launchAttempted = useRef(false);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    for (const url of MCP_HEALTH_URLS) {
      try {
        const result = await invoke<{ status: number; body: string }>(
          "http_proxy",
          {
            request: { url, method: "GET", body: null, headers: null },
          }
        );
        if (result.status >= 200 && result.status < 400) {
          return true;
        }
      } catch {
        // Try next URL
      }
    }
    return false;
  }, []);

  const check = useCallback(async () => {
    const isUp = await checkHealth();

    if (isUp) {
      setConnected(true);
      setChecking(false);
      return;
    }

    // Auto-launch on first failure only
    if (!launchAttempted.current) {
      launchAttempted.current = true;
      try {
        await invoke("mcp_launch_server");
        // Recheck after launch
        const upNow = await checkHealth();
        setConnected(upNow);
      } catch (err) {
        console.warn("MCP auto-launch failed:", err);
        setConnected(false);
      }
    } else {
      setConnected(false);
    }

    setChecking(false);
  }, [checkHealth]);

  useEffect(() => {
    check();
    const interval = setInterval(check, 5_000);
    return () => clearInterval(interval);
  }, [check]);

  return { connected, checking };
}
