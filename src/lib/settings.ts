import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  conversationsFolder: string | null;
  theme: "dark" | "light";
  autoSave: boolean;
}

const DEFAULTS: AppSettings = {
  conversationsFolder: null,
  theme: "dark",
  autoSave: true,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await invoke<string>("load_app_settings");
        const parsed = raw && raw !== "{}" ? JSON.parse(raw) : {};
        setSettings({ ...DEFAULTS, ...parsed });
      } catch (e) {
        console.warn("[settings] load failed:", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Apply theme to document
  useEffect(() => {
    if (loaded) {
      document.documentElement.setAttribute("data-theme", settings.theme);
    }
  }, [settings.theme, loaded]);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      invoke("save_app_settings", { json: JSON.stringify(next) }).catch((e) =>
        console.warn("[settings] save failed:", e)
      );
      return next;
    });
  }, []);

  return { settings, loaded, update };
}
