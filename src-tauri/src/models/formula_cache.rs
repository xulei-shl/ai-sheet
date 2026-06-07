use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaCacheEntry {
    pub id: i64,
    pub requirement: String,
    pub columns_key: String,
    pub formula: String,
    pub explanation: String,
    pub accessed_at: String,
    pub created_at: String,
}
