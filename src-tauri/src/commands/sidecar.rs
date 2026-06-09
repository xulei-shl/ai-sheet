use tauri::{AppHandle, State};

use crate::{
    error::AppError,
    AppState,
};

#[tauri::command]
pub async fn get_agent_status(state: State<'_, AppState>) -> Result<crate::models::agent::AgentStatus, String> {
    Ok(state.sidecar_manager.status().await)
}

#[tauri::command]
pub async fn send_agent_message(
    state: State<'_, AppState>,
    content: String,
) -> Result<(), AppError> {
    state.sidecar_manager.send_user_message(content).await
}

#[tauri::command]
pub async fn restart_sidecar(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    state.sidecar_manager.restart(app).await
}

#[tauri::command]
pub async fn steer_agent(
    state: State<'_, AppState>,
    context: String,
) -> Result<(), AppError> {
    state.sidecar_manager.steer(context).await
}

#[tauri::command]
pub async fn clear_agent_context(state: State<'_, AppState>) -> Result<(), AppError> {
    state.sidecar_manager.send_reset().await
}

#[tauri::command]
pub async fn stop_agent_stream(state: State<'_, AppState>) -> Result<(), AppError> {
    state.sidecar_manager.stop_stream().await
}

#[tauri::command]
pub async fn set_agent_cwd(state: State<'_, AppState>, cwd: String) -> Result<(), AppError> {
    state.sidecar_manager.send_set_cwd(cwd).await
}
