import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  onPicked: (folder: string) => void;
}

export function FolderPickerModal({ onPicked }: Props) {
  const [error, setError] = useState<string | null>(null);

  const handlePick = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose a folder for your conversations",
      });
      if (typeof selected === "string" && selected.length > 0) {
        onPicked(selected);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2>📁 Choose conversations folder</h2>
        <p>
          Pick a folder where IdeaBlast Companion will save and load your chat
          conversations. You can change this later in settings.
        </p>
        <button className="btn-primary" onClick={handlePick}>
          Choose folder…
        </button>
        {error && <p className="modal-error">{error}</p>}
      </div>
    </div>
  );
}
