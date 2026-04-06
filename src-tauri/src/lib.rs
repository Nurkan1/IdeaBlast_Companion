use serde::{Deserialize, Serialize};

// ── Allowed local hosts (security: only localhost traffic) ──
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

// ── Ollama-specific command ──

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

/// Fetches the list of available models from a local Ollama instance.
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

// ── Generic HTTP proxy for local services (Ollama + MCP) ──

#[derive(Deserialize)]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub body: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
}

#[derive(Serialize)]
pub struct HttpProxyResponse {
    pub status: u16,
    pub body: String,
}

/// Generic HTTP proxy command — routes requests through Rust to bypass CORS.
/// Only allows requests to whitelisted localhost ports (11434, 3456).
#[tauri::command]
async fn http_proxy(request: HttpProxyRequest) -> Result<HttpProxyResponse, String> {
    if !is_url_allowed(&request.url) {
        return Err(format!("Blocked: {} is not in the allowed host/port list", request.url));
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

    // Attach custom headers
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            builder = builder.header(&key, &value);
        }
    }

    // Attach body for methods that support it
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fetch_ollama_tags, http_proxy])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
