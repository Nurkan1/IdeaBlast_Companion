use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Emitter;

// ── Security: only localhost traffic on known ports ──
const ALLOWED_HOSTS: &[&str] = &["127.0.0.1", "localhost"];
const ALLOWED_PORTS: &[u16] = &[11434, 3456];

fn is_url_allowed(url: &str) -> bool {
    if let Ok(parsed) = reqwest::Url::parse(url) {
        let host = parsed.host_str().unwrap_or("");
        let port = parsed.port().unwrap_or(80);
        ALLOWED_HOSTS.contains(&host) && ALLOWED_PORTS.contains(&port)
    } else {
        false
    }
}

// ══════════════════════════════════════════════════════════════
// Ollama model discovery
// ══════════════════════════════════════════════════════════════

#[derive(Serialize, Clone)]
pub struct OllamaModel {
    pub name: String,
    pub model: String,
    pub modified_at: String,
    pub size: u64,
    pub digest: String,
}

#[derive(Serialize)]
pub struct OllamaTagsResponse {
    pub models: Vec<OllamaModel>,
}

#[tauri::command]
async fn fetch_ollama_tags(base_url: String) -> Result<OllamaTagsResponse, String> {
    let url = format!("{}/api/tags", base_url);
    if !is_url_allowed(&url) {
        return Err("URL not in allowed list".to_string());
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let models = body["models"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|m| OllamaModel {
            name: m["name"].as_str().unwrap_or("").to_string(),
            model: m["model"].as_str().unwrap_or("").to_string(),
            modified_at: m["modified_at"].as_str().unwrap_or("").to_string(),
            size: m["size"].as_u64().unwrap_or(0),
            digest: m["digest"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(OllamaTagsResponse { models })
}

// ══════════════════════════════════════════════════════════════
// Chat with streaming (Ollama /api/chat — NDJSON stream)
// ══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<String>,
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Serialize, Clone)]
pub struct ChatChunk {
    pub content: String,
    pub done: bool,
}

/// Streams a chat completion from Ollama, emitting "chat-chunk" events.
#[tauri::command]
async fn ollama_chat(app: tauri::AppHandle, request: ChatRequest) -> Result<(), String> {
    let url = "http://127.0.0.1:11434/api/chat";

    // Build messages payload
    let messages: Vec<serde_json::Value> = request
        .messages
        .iter()
        .map(|m| {
            let mut msg = serde_json::json!({
                "role": m.role,
                "content": m.content,
            });
            if !m.images.is_empty() {
                msg["images"] = serde_json::json!(m.images);
            }
            msg
        })
        .collect();

    let payload = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", response.status()));
    }

    // Stream NDJSON lines
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        // Process complete lines
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                let content = json["message"]["content"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let done = json["done"].as_bool().unwrap_or(false);

                let _ = app.emit("chat-chunk", ChatChunk { content, done });

                if done {
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}

// ══════════════════════════════════════════════════════════════
// File reading (read file and return base64 for images, text for docs)
// ══════════════════════════════════════════════════════════════

#[derive(Serialize)]
pub struct FileContent {
    pub name: String,
    pub mime_type: String,
    pub content: String,
    pub is_image: bool,
}

// Defense in depth: only allow file extensions that match the frontend dialog
// filter. Even if a future XSS lets attacker code call this command, they
// cannot exfiltrate arbitrary files (.ssh keys, password stores, etc.).
const ALLOWED_FILE_EXTENSIONS: &[&str] = &[
    "txt", "md", "json", "csv", "py", "js", "ts", "tsx",
    "rs", "html", "css", "yaml", "yml", "toml",
    "jsx", "sh", "bat", "ps1", "pdf",
    "png", "jpg", "jpeg", "gif", "webp", "bmp",
];

#[tauri::command]
async fn read_file_content(path: String) -> Result<FileContent, String> {
    let file_path = std::path::Path::new(&path);
    let name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let ext = file_path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    if !ALLOWED_FILE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "File extension '.{}' is not in the allowed list",
            ext
        ));
    }

    let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp");

    // Refuse symlinks — they can point outside the user's intended selection.
    if let Ok(meta) = tokio::fs::symlink_metadata(&path).await {
        if meta.file_type().is_symlink() {
            return Err("Symlinks are not allowed".to_string());
        }
    }

    // Cap at 10 MB to avoid accidentally loading huge files into the prompt.
    const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
    if let Ok(meta) = tokio::fs::metadata(&path).await {
        if meta.len() > MAX_FILE_BYTES {
            return Err(format!(
                "File too large ({} bytes); max is {} bytes",
                meta.len(),
                MAX_FILE_BYTES
            ));
        }
    }

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let mime_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "txt" | "md" | "rs" | "ts" | "tsx" | "js" | "jsx" | "json" | "toml" | "yaml" | "yml"
        | "html" | "css" | "py" | "sh" | "bat" | "ps1" | "csv" => "text/plain",
        _ => "application/octet-stream",
    }
    .to_string();

    let content = if is_image {
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    Ok(FileContent {
        name,
        mime_type,
        content,
        is_image,
    })
}

// ══════════════════════════════════════════════════════════════
// Generic HTTP proxy for MCP and other local services
// ══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub body: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
pub struct HttpProxyResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
async fn http_proxy(request: HttpProxyRequest) -> Result<HttpProxyResponse, String> {
    if !is_url_allowed(&request.url) {
        return Err(format!(
            "Blocked: {} is not in the allowed host/port list",
            request.url
        ));
    }

    let client = reqwest::Client::new();

    let mut builder = match request.method.to_uppercase().as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "PATCH" => client.patch(&request.url),
        _ => return Err(format!("Unsupported HTTP method: {}", request.method)),
    };

    if let Some(headers) = request.headers {
        for (key, value) in headers {
            builder = builder.header(&key, &value);
        }
    }

    if let Some(body) = request.body {
        builder = builder
            .header("Content-Type", "application/json")
            .body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(HttpProxyResponse { status, body })
}

// ══════════════════════════════════════════════════════════════
// MCP Data: direct file I/O on inbox.json / snapshot.json / actions.json
// The HTTP bridge doesn't expose POST /api/inbox — tools write to files directly.
// We replicate the exact same behavior as the MCP tools.
// ══════════════════════════════════════════════════════════════

/// Resolve the MCP data directory
fn mcp_data_dir() -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
        let dir = std::path::PathBuf::from(appdata)
            .join("npm")
            .join("node_modules")
            .join("ideablast-mcp-server")
            .join("data");
        if dir.exists() {
            return Ok(dir);
        }
        // Fallback: npm root -g
    }
    // Generic fallback using npm root -g (sync is fine for one-off)
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("npm")
            .args(["root", "-g"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("npm root failed: {}", e))?
    };
    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("npm")
        .args(["root", "-g"])
        .output()
        .map_err(|e| format!("npm root failed: {}", e))?;
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let dir = std::path::PathBuf::from(root)
        .join("ideablast-mcp-server")
        .join("data");
    Ok(dir)
}

/// Read snapshot.json — the browser pushes ideas/daily/kanban state here
#[tauri::command]
async fn mcp_read_snapshot() -> Result<String, String> {
    let data_dir = mcp_data_dir()?;
    let snapshot_path = data_dir.join("snapshot.json");
    if !snapshot_path.exists() {
        return Ok("{}".to_string());
    }
    tokio::fs::read_to_string(&snapshot_path)
        .await
        .map_err(|e| format!("Failed to read snapshot: {}", e))
}

/// Read inbox.json — pending items to be consumed by IdeaBlast browser
#[tauri::command]
async fn mcp_read_inbox() -> Result<String, String> {
    let data_dir = mcp_data_dir()?;
    let inbox_path = data_dir.join("inbox.json");
    if !inbox_path.exists() {
        return Ok(r#"{"items":[]}"#.to_string());
    }
    tokio::fs::read_to_string(&inbox_path)
        .await
        .map_err(|e| format!("Failed to read inbox: {}", e))
}

/// Add an item to inbox.json — replicates the `add()` function from inbox.js
#[tauri::command]
async fn mcp_add_to_inbox(item_json: String) -> Result<String, String> {
    let data_dir = mcp_data_dir()?;
    let inbox_path = data_dir.join("inbox.json");

    // Ensure data dir exists
    if !data_dir.exists() {
        tokio::fs::create_dir_all(&data_dir)
            .await
            .map_err(|e| format!("Cannot create data dir: {}", e))?;
    }

    // Read current inbox
    let mut inbox: serde_json::Value = if inbox_path.exists() {
        let raw = tokio::fs::read_to_string(&inbox_path)
            .await
            .map_err(|e| format!("Read error: {}", e))?;
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({"items": [], "lastModified": ""}))
    } else {
        serde_json::json!({"items": [], "lastModified": ""})
    };

    // Parse the new item
    let mut new_item: serde_json::Value =
        serde_json::from_str(&item_json).map_err(|e| format!("Invalid JSON: {}", e))?;

    // Add id and createdAt (like inbox.js does)
    let id = uuid::Uuid::new_v4().to_string();
    new_item["id"] = serde_json::json!(id);
    new_item["createdAt"] = serde_json::json!(chrono::Utc::now().to_rfc3339());

    // Append to items
    if let Some(items) = inbox["items"].as_array_mut() {
        items.push(new_item.clone());
    } else {
        inbox["items"] = serde_json::json!([new_item.clone()]);
    }

    inbox["lastModified"] = serde_json::json!(chrono::Utc::now().to_rfc3339());

    // Write back
    let content = serde_json::to_string_pretty(&inbox)
        .map_err(|e| format!("Serialize error: {}", e))?;
    tokio::fs::write(&inbox_path, content)
        .await
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(serde_json::to_string(&new_item).unwrap_or_default())
}

/// Add an action to actions.json — for updates/deletes
#[tauri::command]
async fn mcp_add_action(action_json: String) -> Result<String, String> {
    let data_dir = mcp_data_dir()?;
    let actions_path = data_dir.join("actions.json");

    if !data_dir.exists() {
        tokio::fs::create_dir_all(&data_dir)
            .await
            .map_err(|e| format!("Cannot create data dir: {}", e))?;
    }

    let mut actions: serde_json::Value = if actions_path.exists() {
        let raw = tokio::fs::read_to_string(&actions_path)
            .await
            .map_err(|e| format!("Read error: {}", e))?;
        serde_json::from_str(&raw)
            .unwrap_or(serde_json::json!({"items": [], "lastModified": ""}))
    } else {
        serde_json::json!({"items": [], "lastModified": ""})
    };

    let mut new_action: serde_json::Value =
        serde_json::from_str(&action_json).map_err(|e| format!("Invalid JSON: {}", e))?;

    let id = uuid::Uuid::new_v4().to_string();
    new_action["id"] = serde_json::json!(id);
    new_action["createdAt"] = serde_json::json!(chrono::Utc::now().to_rfc3339());

    if let Some(items) = actions["items"].as_array_mut() {
        items.push(new_action.clone());
    }

    actions["lastModified"] = serde_json::json!(chrono::Utc::now().to_rfc3339());

    let content = serde_json::to_string_pretty(&actions)
        .map_err(|e| format!("Serialize error: {}", e))?;
    tokio::fs::write(&actions_path, content)
        .await
        .map_err(|e| format!("Write error: {}", e))?;

    Ok(serde_json::to_string(&new_action).unwrap_or_default())
}

// ══════════════════════════════════════════════════════════════
// MCP Server lifecycle (detect, install, launch ideablast-mcp-server)
// ══════════════════════════════════════════════════════════════

#[derive(Serialize)]
pub struct McpServerStatus {
    pub installed: bool,
    pub running: bool,
}

/// Check if ideablast-mcp-server is installed globally via npm
#[tauri::command]
async fn mcp_check_installed() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("npm")
            .args(["list", "-g", "ideablast-mcp-server", "--depth=0"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to run npm: {}", e))?
    };
    #[cfg(not(target_os = "windows"))]
    let output = tokio::process::Command::new("npm")
        .args(["list", "-g", "ideablast-mcp-server", "--depth=0"])
        .output()
        .await
        .map_err(|e| format!("Failed to run npm: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("ideablast-mcp-server"))
}

/// Install ideablast-mcp-server globally.
///
/// Supply-chain note: we pin to ^1.x to accept minor/patch updates but reject
/// a sudden 2.x major bump (which could be hijacked). Bump this range
/// deliberately in each Companion release after auditing the new major.
const MCP_SERVER_VERSION_RANGE: &str = "^1.3.2";

#[tauri::command]
async fn mcp_install(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("mcp-install-status", "installing");

    let spec = format!("ideablast-mcp-server@{}", MCP_SERVER_VERSION_RANGE);

    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("npm")
            .args(["install", "-g", &spec])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("npm install failed: {}", e))?
    };
    #[cfg(not(target_os = "windows"))]
    let output = tokio::process::Command::new("npm")
        .args(["install", "-g", &spec])
        .output()
        .await
        .map_err(|e| format!("npm install failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = app.emit("mcp-install-status", "error");
        return Err(format!("Install failed: {}", stderr));
    }

    let _ = app.emit("mcp-install-status", "installed");
    Ok(())
}

/// Launch the MCP server as a background process using node directly.
/// The .cmd wrapper uses stdio which blocks; we need the HTTP bridge on :3456.
#[tauri::command]
async fn mcp_launch_server() -> Result<(), String> {
    // First check if already running
    let check = reqwest::get("http://127.0.0.1:3456/api/health").await;
    if let Ok(resp) = check {
        if resp.status().is_success() {
            return Ok(()); // Already running
        }
    }

    // Find the entry point of ideablast-mcp-server
    #[cfg(target_os = "windows")]
    let entry_point = {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let path = format!(
            "{}\\npm\\node_modules\\ideablast-mcp-server\\dist\\index.js",
            appdata
        );
        if std::path::Path::new(&path).exists() {
            path
        } else {
            // Fallback: try global npm prefix (hidden window)
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let output = std::process::Command::new("npm")
                .args(["root", "-g"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("Cannot find npm root: {}", e))?;
            let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
            format!("{}\\ideablast-mcp-server\\dist\\index.js", root)
        }
    };

    #[cfg(not(target_os = "windows"))]
    let entry_point = {
        let output = tokio::process::Command::new("npm")
            .args(["root", "-g"])
            .output()
            .await
            .map_err(|e| format!("Cannot find npm root: {}", e))?;
        let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        format!("{}/ideablast-mcp-server/dist/index.js", root)
    };

    if !std::path::Path::new(&entry_point).exists() {
        return Err(format!(
            "ideablast-mcp-server not found at {}. Install with: npm install -g ideablast-mcp-server",
            entry_point
        ));
    }

    // Launch node directly as a hidden background process (no visible console window)
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("node")
            .arg(&entry_point)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to launch MCP server: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        tokio::process::Command::new("node")
            .arg(&entry_point)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to launch MCP server: {}", e))?;
    }

    // Wait up to 8 seconds for the server to become healthy
    for _ in 0..16 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Ok(resp) = reqwest::get("http://127.0.0.1:3456/api/health").await {
            if resp.status().is_success() {
                return Ok(());
            }
        }
    }

    Err("MCP server started but health check timed out after 8s".to_string())
}

// ══════════════════════════════════════════════════════════════
// Conversation persistence + app settings
// User picks the folder via the dialog plugin from the frontend.
// Settings (incl. that folder + theme) live in %APPDATA%/IdeaBlast_Companion.
// ══════════════════════════════════════════════════════════════

fn settings_dir() -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
        Ok(std::path::PathBuf::from(appdata).join("IdeaBlast_Companion"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        Ok(std::path::PathBuf::from(home).join(".config").join("ideablast-companion"))
    }
}

fn settings_path() -> Result<std::path::PathBuf, String> {
    Ok(settings_dir()?.join("settings.json"))
}

#[tauri::command]
async fn load_app_settings() -> Result<String, String> {
    let p = settings_path()?;
    if !p.exists() {
        return Ok("{}".to_string());
    }
    tokio::fs::read_to_string(&p)
        .await
        .map_err(|e| format!("Failed to read settings: {}", e))
}

#[tauri::command]
async fn save_app_settings(json: String) -> Result<(), String> {
    let dir = settings_dir()?;
    if !dir.exists() {
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("Cannot create settings dir: {}", e))?;
    }
    tokio::fs::write(settings_path()?, json)
        .await
        .map_err(|e| format!("Failed to write settings: {}", e))
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{is_url_allowed, sanitize_filename};

    #[test]
    fn url_allowlist_accepts_only_expected_local_services() {
        assert!(is_url_allowed("http://127.0.0.1:11434/api/tags"));
        assert!(is_url_allowed("http://localhost:3456/api/health"));
    }

    #[test]
    fn url_allowlist_rejects_external_hosts_and_unapproved_ports() {
        assert!(!is_url_allowed("https://example.com/api/tags"));
        assert!(!is_url_allowed("http://127.0.0.1:8080/api/tags"));
        assert!(!is_url_allowed("http://localhost/api/tags"));
        assert!(!is_url_allowed("not-a-url"));
    }

    #[test]
    fn sanitize_filename_replaces_path_and_shell_metacharacters() {
        assert_eq!(
            sanitize_filename("../chat:name?.json"),
            ".._chat_name_.json"
        );
        assert_eq!(sanitize_filename("safe-name_1.2"), "safe-name_1.2");
    }
}

/// Defense in depth: refuse any folder that looks like a system path or that
/// the user did not actually choose via the dialog. Returns the canonical
/// absolute path on success.
///
/// The `conversationsFolder` is normally selected via Tauri's native folder
/// dialog, so this validation only kicks in for tampered settings.json files
/// or future XSS bugs.
fn validate_user_folder(folder: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::PathBuf::from(folder);
    if !p.exists() {
        return Err(format!("Folder does not exist: {}", folder));
    }
    if !p.is_dir() {
        return Err(format!("Not a directory: {}", folder));
    }

    // Canonicalize to resolve any `..` segments and symlinks before comparing
    // against the blocklist. Otherwise `~/safe/../Windows` would slip through.
    let canon = std::fs::canonicalize(&p)
        .map_err(|e| format!("Cannot canonicalize path: {}", e))?;
    let canon_str = canon.to_string_lossy().to_lowercase().replace('\\', "/");

    // Substrings that should NEVER host user conversation files. Each entry is
    // matched against the lowercased forward-slash form of the path.
    const BLOCKED_SUBSTRINGS: &[&str] = &[
        // Windows
        "/windows/system32",
        "/windows/syswow64",
        "/windows/winsxs",
        "/program files/",
        "/program files (x86)/",
        "/programdata/microsoft",
        // Unix-like core
        "/etc/",
        "/bin/",
        "/sbin/",
        "/boot/",
        "/dev/",
        "/proc/",
        "/sys/",
        "/usr/bin",
        "/usr/sbin",
        "/usr/lib",
        "/usr/local/bin",
        "/usr/local/sbin",
        // macOS
        "/system/",
        "/library/system",
        "/private/etc",
        "/private/var",
    ];

    // Match either as a substring or as a prefix (so `/etc` matches root `/etc`
    // not just `/etc/`).
    for blocked in BLOCKED_SUBSTRINGS {
        let trimmed = blocked.trim_end_matches('/');
        if canon_str == trimmed || canon_str.starts_with(trimmed) && {
            // Avoid false positives: only match if next char is `/` or end-of-string.
            let next = canon_str.as_bytes().get(trimmed.len()).copied();
            next.is_none() || next == Some(b'/')
        } {
            return Err("System paths are not allowed for conversation storage".to_string());
        }
    }

    Ok(canon)
}

#[tauri::command]
async fn save_conversation(folder: String, filename: String, json: String) -> Result<(), String> {
    let dir = validate_user_folder(&folder)?;
    let safe = sanitize_filename(&filename);
    let path = dir.join(format!("{}.json", safe));
    tokio::fs::write(&path, json)
        .await
        .map_err(|e| format!("Failed to write conversation: {}", e))
}

#[tauri::command]
async fn load_conversation(folder: String, filename: String) -> Result<String, String> {
    let dir = validate_user_folder(&folder)?;
    let safe = sanitize_filename(&filename);
    let path = dir.join(format!("{}.json", safe));
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read conversation: {}", e))
}

#[derive(Serialize)]
pub struct ConversationMeta {
    pub id: String,
    pub title: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub size: u64,
}

#[tauri::command]
async fn list_conversations(folder: String) -> Result<Vec<ConversationMeta>, String> {
    // Be permissive on first launch (folder may not yet exist if user hasn't
    // picked one), but reject anything that exists in a system location.
    let dir = match validate_user_folder(&folder) {
        Ok(d) => d,
        Err(e) if e.starts_with("Folder does not exist") => return Ok(vec![]),
        Err(e) => return Err(e),
    };
    let mut entries = tokio::fs::read_dir(&dir)
        .await
        .map_err(|e| format!("Read dir failed: {}", e))?;
    let mut out: Vec<ConversationMeta> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let metadata = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = metadata.len();
        let raw = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
        let title = parsed["title"].as_str().unwrap_or(&id).to_string();
        let model = parsed["model"].as_str().unwrap_or("").to_string();
        let created_at = parsed["createdAt"].as_i64().unwrap_or(0);
        let updated_at = parsed["updatedAt"].as_i64().unwrap_or(0);
        out.push(ConversationMeta { id, title, model, created_at, updated_at, size });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

#[tauri::command]
async fn delete_conversation(folder: String, filename: String) -> Result<(), String> {
    let dir = validate_user_folder(&folder)?;
    let safe = sanitize_filename(&filename);
    let json_path = dir.join(format!("{}.json", safe));
    let md_path = dir.join(format!("{}.md", safe));
    if json_path.exists() {
        tokio::fs::remove_file(&json_path)
            .await
            .map_err(|e| format!("Failed to delete: {}", e))?;
    }
    if md_path.exists() {
        let _ = tokio::fs::remove_file(&md_path).await;
    }
    Ok(())
}

#[tauri::command]
async fn rename_conversation(folder: String, old_filename: String, new_filename: String) -> Result<(), String> {
    let dir = validate_user_folder(&folder)?;
    let old_safe = sanitize_filename(&old_filename);
    let new_safe = sanitize_filename(&new_filename);
    let from = dir.join(format!("{}.json", old_safe));
    let to = dir.join(format!("{}.json", new_safe));
    if !from.exists() {
        return Err("Source conversation not found".to_string());
    }
    // If renaming, also update title inside the JSON
    let raw = tokio::fs::read_to_string(&from)
        .await
        .map_err(|e| format!("Read failed: {}", e))?;
    let mut parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Parse failed: {}", e))?;
    parsed["title"] = serde_json::json!(new_filename);
    parsed["updatedAt"] = serde_json::json!(chrono::Utc::now().timestamp_millis());
    let updated = serde_json::to_string_pretty(&parsed).unwrap_or(raw);
    tokio::fs::write(&to, updated)
        .await
        .map_err(|e| format!("Write failed: {}", e))?;
    if from != to {
        let _ = tokio::fs::remove_file(&from).await;
    }
    Ok(())
}

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    // Reject anything that isn't an existing local directory. xdg-open/open
    // resolve URLs and custom protocol handlers — never let a URL reach here.
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }
    if !p.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    // Belt-and-suspenders: refuse anything that smells like a URL or scheme.
    if path.contains("://") || path.starts_with("file:") {
        return Err("URLs are not allowed".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("explorer")
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("explorer failed: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("open failed: {}", e))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("xdg-open failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn export_conversation_md(folder: String, filename: String, markdown: String) -> Result<String, String> {
    let dir = validate_user_folder(&folder)?;
    let safe = sanitize_filename(&filename);
    let path = dir.join(format!("{}.md", safe));
    tokio::fs::write(&path, markdown)
        .await
        .map_err(|e| format!("Write MD failed: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

// ══════════════════════════════════════════════════════════════
// App entry point
// ══════════════════════════════════════════════════════════════

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fetch_ollama_tags,
            ollama_chat,
            read_file_content,
            http_proxy,
            mcp_read_snapshot,
            mcp_read_inbox,
            mcp_add_to_inbox,
            mcp_add_action,
            mcp_check_installed,
            mcp_install,
            mcp_launch_server,
            load_app_settings,
            save_app_settings,
            save_conversation,
            load_conversation,
            list_conversations,
            delete_conversation,
            rename_conversation,
            export_conversation_md,
            open_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
