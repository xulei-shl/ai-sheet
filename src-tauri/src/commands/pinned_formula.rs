use std::sync::Arc;

use tauri::State;

use crate::db::{pinned_formula_repo, Database};
use crate::models::pinned_formula::PinnedFormula;

#[tauri::command]
pub async fn get_pinned_formulas(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<PinnedFormula>, String> {
    let conn = db.get_conn().await;
    pinned_formula_repo::get_all(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_pinned_formula(
    db: State<'_, Arc<Database>>,
    name: String,
    formula: String,
    columns_key: String,
) -> Result<i64, String> {
    let conn = db.get_conn().await;
    pinned_formula_repo::insert(&conn, &name, &formula, &columns_key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_pinned_formula(
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    let conn = db.get_conn().await;
    pinned_formula_repo::delete(&conn, id).map_err(|e| e.to_string())
}
