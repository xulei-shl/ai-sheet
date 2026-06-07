use std::sync::Arc;

use tauri::State;

use crate::db::{formula_cache_repo, Database};
use crate::models::formula_cache::FormulaCacheEntry;

#[tauri::command]
pub async fn get_formula_history(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<FormulaCacheEntry>, String> {
    let conn = db.get_conn().await;
    formula_cache_repo::get_all(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_formula_cache(
    db: State<'_, Arc<Database>>,
    requirement: String,
    columns_key: String,
    formula: String,
    explanation: Option<String>,
) -> Result<i64, String> {
    let conn = db.get_conn().await;
    formula_cache_repo::insert(
        &conn,
        &requirement,
        &columns_key,
        &formula,
        &explanation.unwrap_or_default(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn touch_formula_cache(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    let conn = db.get_conn().await;
    formula_cache_repo::touch(&conn, id).map_err(|e| e.to_string())
}
