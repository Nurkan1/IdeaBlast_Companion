interface OllamaOfflineBannerProps {
  error: string | null;
  onRetry: () => void;
}

/**
 * Neon-themed banner shown when Ollama is unreachable.
 * Encourages the user to start their local engine.
 */
export function OllamaOfflineBanner({ error, onRetry }: OllamaOfflineBannerProps) {
  return (
    <div className="offline-banner">
      <div className="offline-icon">⚠</div>
      <h2 className="offline-title glitch" data-text="OFFLINE">
        OFFLINE
      </h2>
      <p className="offline-message">
        Ollama no detectado en el puerto <code>11434</code>.
        <br />
        Enciende los motores locales para continuar.
      </p>
      {error && <p className="offline-detail">{error}</p>}
      <button className="retry-btn" onClick={onRetry}>
        ↻ Reintentar conexión
      </button>
    </div>
  );
}
