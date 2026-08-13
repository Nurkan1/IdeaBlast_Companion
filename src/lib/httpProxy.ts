import { invoke } from "@tauri-apps/api/core";

interface HttpProxyRequest {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

interface HttpProxyResponse {
  status: number;
  body: string;
}

/**
 * Routes HTTP requests through the Rust backend to bypass CORS.
 * Only allows requests to whitelisted localhost ports (11434, 3456).
 */
export async function httpProxy<T = unknown>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: T }> {
  const request: HttpProxyRequest = {
    url,
    method: options.method ?? "GET",
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: options.headers,
  };

  const response = await invoke<HttpProxyResponse>("http_proxy", { request });

  let data: T;
  try {
    data = JSON.parse(response.body) as T;
  } catch {
    data = response.body as unknown as T;
  }

  return { status: response.status, data };
}

// ── Convenience wrappers ──

const MCP_BASE = "http://127.0.0.1:3456";
const OLLAMA_BASE = "http://127.0.0.1:11434";

/** GET from the local MCP bridge. */
export async function mcpGet<T = unknown>(
  path: string
): Promise<{ status: number; data: T }> {
  return httpProxy<T>(`${MCP_BASE}${path}`);
}

/** DELETE from the local MCP bridge. */
export async function mcpDelete<T = unknown>(
  path: string
): Promise<{ status: number; data: T }> {
  return httpProxy<T>(`${MCP_BASE}${path}`, { method: "DELETE" });
}

/** POST to the local MCP server */
export async function mcpRequest<T = unknown>(
  path: string,
  body: unknown
): Promise<{ status: number; data: T }> {
  return httpProxy<T>(`${MCP_BASE}${path}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

/** POST to local Ollama (e.g. /api/chat, /api/generate) */
export async function ollamaRequest<T = unknown>(
  path: string,
  body: unknown
): Promise<{ status: number; data: T }> {
  return httpProxy<T>(`${OLLAMA_BASE}${path}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}
