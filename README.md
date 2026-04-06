# IdeaBlast Companion

> The native desktop AI assistant for **[IdeaBlast](https://ideablast.app)** — connects your local AI models (Ollama) to IdeaBlast via MCP (Model Context Protocol).

<p align="center">
  <img src="public/ideblastapp.png" alt="IdeaBlast Companion" width="100%" />
</p>

## What is this?

IdeaBlast Companion is a **free, open-source desktop app** that turns any local AI model into a powerful assistant for IdeaBlast. It runs 100% locally — zero cloud, zero tracking, zero subscriptions.

**You bring your own AI.** Any model running on Ollama works: Gemma, Llama, Mistral, Qwen, Phi, DeepSeek, etc.

## Quick Start (3 steps)

### 1. Install Ollama
Download from [ollama.ai](https://ollama.ai/) and pull a model:
```bash
ollama pull gemma3:4b
```

### 2. Install IdeaBlast Companion
Download the latest installer from [Releases](https://github.com/Nurkan1/IdeaBlast_Companion/releases):
- **Windows**: `.exe` installer (recommended) or `.msi`

### 3. Connect to IdeaBlast
1. Open [IdeaBlast](https://ideablast.app) in your browser
2. Click the MCP Sync icon in the header to enable it
3. Open IdeaBlast Companion — it connects automatically

That's it. Start chatting with your local AI to manage your ideas.

## Features

### AI Chat with Local Models
- Auto-discovers Ollama on `localhost:11434`
- Switch between any installed model instantly
- Streaming responses in real-time
- Attach local files (code, text, images) as context

### Full IdeaBlast Integration via MCP

Every IdeaBlast feature is accessible from the chat:

| Command | What it does |
|---------|-------------|
| "show my ideas" | Read all ideas from IdeaBlast |
| "search ideas about React" | Search by text or tags |
| "create an idea about..." | Create a new idea card |
| "create a plan to learn Tauri in 2 weeks" | Generate a plan with dated steps |
| "brainstorm ideas about productivity" | Generate 5-8 ideas and save them |
| "delete them" / "borra las ideas" | Preview + confirm before deleting |
| "mark as done" / "mark all as done" | Toggle done status |
| "add tags: frontend, react" | Add tags to ideas |
| "set deadline to friday" | Set deadlines (supports Spanish dates) |
| "show my kanban board" | Read kanban cards |
| "create kanban card: Fix login bug" | Create cards in any column |
| "show my daily notes" | Read sticky notes |
| "plan my day: meeting, code review, deploy" | Create daily plan with colored notes |
| "show my stats" | Productivity overview |
| "weekly summary" | Last 7 days review |
| "create a mind map for this idea" | Inject diagram into Nexus canvas |

### Smart Safety for Dangerous Actions

Delete operations always show a preview first and ask for confirmation:

```
User: "delete all my ideas"

AI: ⚠️ DELETE PREVIEW — 12 ideas will be permanently deleted:
  1. Learn React hooks [#frontend] 📅8 apr
  2. Design new landing page [#design]
  3. Fix authentication bug [#backend, #urgent]
  ...

Say "yes" to confirm or "no" to cancel.

User: "yes"

AI: ✅ 12 ideas deleted
```

### Works with Any Language
Full support for English and Spanish commands, dates, and responses. The AI responds in whatever language you write in.

### Attach Local Files
Click the 📎 button to attach files as context:
- **Code**: `.js`, `.ts`, `.py`, `.rs`, `.json`, `.html`, `.css`, etc.
- **Documents**: `.txt`, `.md`, `.csv`, `.yaml`, `.toml`
- **Images**: `.png`, `.jpg`, `.gif`, `.webp`

Example: Attach a `requirements.txt` and say "create a plan for this project" — the AI reads the file and generates a specific plan based on its contents.

## Supported Models

Any Ollama model works. Recommended:

| Model | Size | Best for |
|-------|------|----------|
| `gemma3:4b` | 3.1 GB | Fast responses, good for planning |
| `gemma3:12b` | 8.1 GB | Better quality, still fast |
| `llama3.1:8b` | 4.7 GB | Great all-round model |
| `mistral:7b` | 4.1 GB | Good for creative brainstorming |
| `qwen2.5:7b` | 4.7 GB | Strong reasoning |
| `deepseek-r1:8b` | 4.9 GB | Advanced reasoning |

Pull any model with:
```bash
ollama pull gemma3:4b
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Tauri v2 (Rust) |
| Frontend | React 18 + TypeScript |
| Bundler | Vite 5 |
| AI Backend | Ollama (local) |
| Integration | MCP (Model Context Protocol) |
| Styling | Custom Cyberpunk CSS |

## Development

### Requirements
- **Node.js** >= 20.x
- **Rust** (latest stable) — [Install via rustup](https://rustup.rs/)

### Setup
```bash
git clone https://github.com/Nurkan1/IdeaBlast_Companion.git
cd IdeaBlast_Companion
npm install
npm run tauri dev
```

### Build
```bash
# Produces .msi and .exe installers in src-tauri/target/release/bundle/
npm run tauri build
```

## Project Structure

```
IdeaBlast_Companion/
├── src/
│   ├── components/
│   │   ├── ChatPanel.tsx          # Main chat UI with file attachments
│   │   ├── ChatView.tsx           # Standalone chat view
│   │   ├── ModelSwitcher.tsx      # Model selector dropdown
│   │   └── OllamaOfflineBanner.tsx
│   ├── hooks/
│   │   ├── useChat.ts             # Chat + MCP integration hook
│   │   ├── useOllamaDiscovery.ts  # Ollama auto-detection
│   │   └── useMcpStatus.ts        # MCP server health polling
│   ├── lib/
│   │   ├── mcpBrain.ts            # Intent detection + tool orchestration
│   │   ├── mcpClient.ts           # MCP file I/O (inbox, snapshot, actions)
│   │   └── httpProxy.ts           # CORS bypass via Rust
│   ├── App.tsx
│   └── styles.css                 # Cyberpunk neon theme
├── src-tauri/
│   ├── src/lib.rs                 # Rust backend (Ollama, MCP, file reading)
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

## Architecture

```
User Input → ChatPanel → useChat hook
                            ↓
                     mcpBrain.processWithMcp()
                     ├── Detect intent (regex patterns)
                     ├── Check pending confirmations
                     ├── Execute MCP tool
                     │   ├── Read snapshot.json
                     │   ├── Write inbox.json (create)
                     │   └── Write actions.json (update/delete)
                     └── Build system prompt with context
                            ↓
                     Ollama (streaming via Tauri)
                            ↓
                     postProcess (if needed)
                     ├── Parse LLM response
                     ├── Create ideas/plans/diagrams
                     └── Emit progress updates to UI
```

## Privacy & Security

- All AI processing happens locally on your machine
- HTTP requests restricted to `localhost` only (ports 11434 and 3456)
- No telemetry, no analytics, no cloud services
- MCP data stays in local files on your filesystem
- Open source — audit the code yourself

## License

MIT

---

<p align="center">
  Built with Tauri + Ollama + MCP by <a href="https://github.com/Nurkan1">PYSBG</a>
</p>
