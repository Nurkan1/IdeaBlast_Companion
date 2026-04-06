import type { OllamaModel } from "../hooks/useOllamaDiscovery";

interface ModelSwitcherProps {
  models: OllamaModel[];
  selected: string;
  onSelect: (model: string) => void;
}

/** Controlled dropdown selector for locally available Ollama models */
export function ModelSwitcher({ models, selected, onSelect }: ModelSwitcherProps) {
  if (models.length === 0) return null;

  return (
    <div className="model-switcher">
      <label htmlFor="model-select" className="model-label">
        ⚡ Model
      </label>
      <select
        id="model-select"
        className="model-select"
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
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
