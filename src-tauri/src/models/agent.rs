use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub ready: bool,
    pub is_streaming: bool,
    pub last_heartbeat_age_secs: Option<u64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub name: String,
    pub version: String,
}

// --- Direct LLM DTOs ---

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectLlmRequest {
    pub request_id: String,
    pub action: String,
    pub content: String,
    pub context: DirectLlmContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectLlmContext {
    pub file_name: String,
    pub sheets: Vec<DirectLlmSheet>,
    pub sample_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectLlmSheet {
    pub sheet: String,
    pub columns: Vec<String>,
}
