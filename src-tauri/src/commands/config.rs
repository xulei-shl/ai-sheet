use std::sync::Arc;

use tauri::State;

use crate::db::{models_repo, Database};
use crate::{models::config::ModelConfig, AppState};

#[tauri::command]
pub async fn get_active_model(state: State<'_, AppState>) -> Result<ModelConfig, String> {
    Ok(state.config_service.get_active_model())
}

#[tauri::command]
pub async fn get_fallback_models(state: State<'_, AppState>) -> Result<Vec<ModelConfig>, String> {
    Ok(state.config_service.get_fallback_chain())
}

#[tauri::command]
pub async fn get_user_models(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<ModelConfig>, String> {
    let conn = db.get_conn().await;
    models_repo::get_all_models(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_user_model(
    db: State<'_, Arc<Database>>,
    model: ModelConfig,
) -> Result<ModelConfig, String> {
    let conn = db.get_conn().await;
    models_repo::insert_model(&conn, &model).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_user_model(
    db: State<'_, Arc<Database>>,
    index: usize,
    model: ModelConfig,
) -> Result<(), String> {
    let conn = db.get_conn().await;
    let existing = models_repo::get_model_by_index(&conn, index)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Model not found at index".to_string())?;
    let id = existing.id.ok_or_else(|| "Invalid model id".to_string())?;
    models_repo::update_model(&conn, id, &model).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_user_model(
    db: State<'_, Arc<Database>>,
    index: usize,
) -> Result<(), String> {
    let conn = db.get_conn().await;
    let existing = models_repo::get_model_by_index(&conn, index)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Model not found at index".to_string())?;
    let id = existing.id.ok_or_else(|| "Invalid model id".to_string())?;
    models_repo::delete_model(&conn, id).map_err(|e| e.to_string())
}
