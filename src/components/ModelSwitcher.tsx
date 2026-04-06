import { useState } from "react";
import type { OllamaModel } from "../hooks/useOllamaDiscovery";

interface ModelSwitcherProps {
  models: OllamaModel[];
}

/** Dropdown selector for locally available Ollama models */
export function ModelSwitcher({ models }: ModelSwitcherProps) {
  const [selected, setSelected] = useState<string>(
    models[0]?.name ?? ""
  );

  if (models.length === 0) return null;

  return (
    <div className="model-switcher">
      <label htmlFor="model-select" className="model-label">
        ⚡ Modelo Activo
      </label>
      <select
        id="model-select"
        className="model-select"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.digest} value={m.name}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
