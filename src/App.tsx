import { useOllamaDiscovery } from "./hooks/useOllamaDiscovery";
import { ModelSwitcher } from "./components/ModelSwitcher";
import { OllamaOfflineBanner } from "./components/OllamaOfflineBanner";

function App() {
  const { loading, connected, models, error, retry } = useOllamaDiscovery();

  return (
    <div className="app-shell">
      {/* ── Top Bar ── */}
      <header className="top-bar">
        <div className="brand">
          <img src="/logo.svg" alt="IdeaBlast" className="brand-logo" />
          <span className="brand-name">IdeaBlast Companion</span>
        </div>

        <div className="top-bar-right">
          {connected && <ModelSwitcher models={models} />}
          <span className={`status-dot ${connected ? "online" : "offline"}`} />
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="main-content">
        {loading && (
          <div className="loader-container">
            <div className="loader-ring" />
            <p className="loader-text">Escaneando red local…</p>
          </div>
        )}

        {!loading && !connected && (
          <OllamaOfflineBanner error={error} onRetry={retry} />
        )}

        {!loading && connected && (
          <div className="connected-view">
            <h1 className="hero-title">
              Motores <span className="neon-accent">encendidos</span>
            </h1>
            <p className="hero-sub">
              {models.length} modelo{models.length !== 1 ? "s" : ""} local
              {models.length !== 1 ? "es" : ""} detectado
              {models.length !== 1 ? "s" : ""}.
            </p>
            <ul className="model-list">
              {models.map((m) => (
                <li key={m.digest} className="model-card">
                  <span className="model-name">{m.name}</span>
                  <span className="model-size">
                    {(m.size / 1_073_741_824).toFixed(1)} GB
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
