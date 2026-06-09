use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedFormula {
    pub id: i64,
    pub name: String,
    pub formula: String,
    pub columns_key: String,
    pub created_at: String,
}
