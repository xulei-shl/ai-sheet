use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub id: Option<i64>,
    pub name: String,
    pub api_key: String,
    pub base_url: String,
    pub model_id: String,
    pub provider_type: String,
}

/// 用户在 Agent 面板上选中的当前模型（含明文 apiKey），仅驻留在进程内存。
/// 由前端通过 `set_active_model` 写入，Tauri Bridge 的 `/api/config/default` 读取后下发给 sidecar。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveModel {
    pub name: String,
    pub provider_type: String,
    pub model_id: String,
    pub api_key: String,
    pub base_url: String,
}
