use crate::models::agent::AppStatus;

#[tauri::command]
pub async fn get_app_status() -> AppStatus {
    AppStatus {
        name: "AI-Sheet".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}
