use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::db::{models_repo, settings_repo, Database};
use crate::error::AppError;
use crate::models::config::{ActiveModel, ModelConfig};
use crate::AppState;

#[tauri::command]
pub async fn get_active_model(state: State<'_, AppState>) -> Result<Option<ModelConfig>, String> {
    let guard = state.active_model.read().await;
    Ok(guard.as_ref().map(|m| ModelConfig {
        id: None,
        name: m.name.clone(),
        api_key: m.api_key.clone(),
        base_url: m.base_url.clone(),
        model_id: m.model_id.clone(),
        provider_type: m.provider_type.clone(),
        use_proxy: m.use_proxy,
    }))
}

#[tauri::command]
pub async fn set_active_model(
    app: AppHandle,
    state: State<'_, AppState>,
    db: State<'_, Arc<Database>>,
    model: ActiveModel,
) -> Result<(), AppError> {
    {
        let mut guard = state.active_model.write().await;
        *guard = Some(model.clone());
    }
    // 持久化到 settings 表
    {
        let conn = db.get_conn().await;
        let json = serde_json::to_string(&model)
            .map_err(|e| AppError::Database(e.to_string()))?;
        settings_repo::set_setting(&conn, "active_model", &json)
            .map_err(|e| AppError::Database(e.to_string()))?;
    }
    state.sidecar_manager.restart(app).await
}

#[tauri::command]
pub async fn clear_active_model(
    app: AppHandle,
    state: State<'_, AppState>,
    db: State<'_, Arc<Database>>,
) -> Result<(), AppError> {
    {
        let mut guard = state.active_model.write().await;
        *guard = None;
    }
    // 删除持久化的 active_model
    {
        let conn = db.get_conn().await;
        settings_repo::delete_setting(&conn, "active_model")
            .map_err(|e| AppError::Database(e.to_string()))?;
    }
    state.sidecar_manager.restart(app).await
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
