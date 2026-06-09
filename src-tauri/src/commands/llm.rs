use serde::{Deserialize, Serialize};

/// 全局 HTTP 客户端，连接池复用
fn http_client() -> reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_default()
        })
        .clone()
}

// ── 请求/响应类型 ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatRequest {
    pub base_url: String,
    pub api_key: String,
    pub model_id: String,
    pub messages: Vec<LlmMessage>,
    pub temperature: f64,
}

#[derive(Deserialize, Serialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct LlmChatResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmTestRequest {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Serialize)]
pub struct LlmTestResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Commands ──

/// 调用 OpenAI-compatible chat/completions 接口（走 Rust 后端，绕过 CORS）
#[tauri::command]
pub async fn llm_chat_completions(req: LlmChatRequest) -> Result<LlmChatResponse, String> {
    if req.base_url.is_empty() || req.model_id.is_empty() {
        return Ok(LlmChatResponse {
            success: false,
            content: None,
            error: Some("baseUrl and modelId are required".into()),
        });
    }

    let url = format!("{}/chat/completions", req.base_url.trim_end_matches('/'));
    let client = http_client();

    let mut builder = client.post(&url).json(&serde_json::json!({
        "model": req.model_id,
        "messages": req.messages,
        "temperature": req.temperature,
        "stream": false,
    }));

    if !req.api_key.is_empty() {
        builder = builder.header("Authorization", format!("Bearer {}", req.api_key));
    }

    match builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            match resp.json::<serde_json::Value>().await {
                Ok(data) => {
                    if (200..300).contains(&status) {
                        let content = data["choices"][0]["message"]["content"]
                            .as_str()
                            .unwrap_or("")
                            .to_string();
                        Ok(LlmChatResponse {
                            success: true,
                            content: Some(content),
                            error: None,
                        })
                    } else {
                        let err = serde_json::to_string(&data).unwrap_or_default();
                        Ok(LlmChatResponse {
                            success: false,
                            content: None,
                            error: Some(format!("HTTP {}: {}", status, &err[..err.len().min(300)])),
                        })
                    }
                }
                Err(e) => Ok(LlmChatResponse {
                    success: false,
                    content: None,
                    error: Some(format!("解析响应失败: {}", e)),
                }),
            }
        }
        Err(e) => Ok(LlmChatResponse {
            success: false,
            content: None,
            error: Some(format!("请求失败: {}", e)),
        }),
    }
}

/// 测试 LLM API 连接（走 Rust 后端，绕过 CORS）
#[tauri::command]
pub async fn llm_test_connection(req: LlmTestRequest) -> Result<LlmTestResponse, String> {
    if req.base_url.is_empty() {
        return Ok(LlmTestResponse {
            success: false,
            error: Some("baseUrl is required".into()),
        });
    }

    let url = format!("{}/models", req.base_url.trim_end_matches('/'));
    let client = http_client();

    let mut builder = client.get(&url);
    if !req.api_key.is_empty() {
        builder = builder.header("Authorization", format!("Bearer {}", req.api_key));
    }

    match builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            if (200..300).contains(&status) {
                Ok(LlmTestResponse {
                    success: true,
                    error: None,
                })
            } else {
                let text = resp.text().await.unwrap_or_default();
                let truncated = &text[..text.len().min(200)];
                Ok(LlmTestResponse {
                    success: false,
                    error: Some(format!("HTTP {}: {}", status, truncated)),
                })
            }
        }
        Err(e) => Ok(LlmTestResponse {
            success: false,
            error: Some(format!("连接失败: {}", e)),
        }),
    }
}
