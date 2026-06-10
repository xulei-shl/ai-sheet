use tauri::Manager;

use crate::models::agent::AppStatus;

#[tauri::command]
pub async fn get_app_status() -> AppStatus {
    AppStatus {
        name: "AI-Sheet".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))
}
