import { useState, useEffect, useCallback } from "react";
import { fetch } from "@tauri-apps/plugin-http";

/** Shape of a single model entry returned by the Ollama /api/tags endpoint */
export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
}

export interface OllamaDiscoveryState {
  /** Whether the initial probe is still in-flight */
  loading: boolean;
  /** True once Ollama has responded successfully */
  connected: boolean;
  /** List of locally-available models (empty when disconnected) */
  models: OllamaModel[];
  /** Human-readable error when Ollama is unreachable */
  error: string | null;
  /** Re-trigger the discovery (e.g. after the user starts Ollama) */
  retry: () => void;
}

const OLLAMA_BASE = "http://127.0.0.1:11434";
const TAGS_ENDPOINT = `${OLLAMA_BASE}/api/tags`;
const PING_TIMEOUT_MS = 5_000;

/**
 * Auto-discovery hook that probes the local Ollama instance on startup.
 * Uses the Tauri HTTP plugin so the request goes through the Rust side-car
 * and is governed by the capability allow-list.
 */
export function useOllamaDiscovery(): OllamaDiscoveryState {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async () => {
    setLoading(true);
    setError(null);
    setConnected(false);
    setModels([]);

    try {
      // AbortController for timeout guard
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

      const response = await fetch(TAGS_ENDPOINT, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Ollama responded with HTTP ${response.status}`);
      }

      const data = (await response.json()) as { models: OllamaModel[] };

      setModels(data.models ?? []);
      setConnected(true);
    } catch (_err: unknown) {
      const message =
        _err instanceof Error ? _err.message : "Unknown connection error";
      setError(message);
      setConnected(false);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Run on mount
  useEffect(() => {
    probe();
  }, [probe]);

  return { loading, connected, models, error, retry: probe };
}
