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
    pub is_default: bool,
    pub source: ModelSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelSource {
    BuiltInFallback,
    User,
}

#[derive(Debug, Clone, Copy)]
pub struct DefaultModel {
    pub name: &'static str,
    pub base_url: &'static str,
    pub model_id: &'static str,
    pub provider_type: &'static str,
}

impl DefaultModel {
    pub fn to_model_config(self, is_default: bool) -> ModelConfig {
        ModelConfig {
            id: None,
            name: self.name.to_string(),
            api_key: String::new(),
            base_url: self.base_url.to_string(),
            model_id: self.model_id.to_string(),
            provider_type: self.provider_type.to_string(),
            is_default,
            source: ModelSource::BuiltInFallback,
        }
    }
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
