use std::sync::Arc;

use tauri::{Emitter, Manager};

use crate::db::Database;
use crate::services::{
    bridge_server::BridgeServer, config_service::ConfigService,
    sidecar_manager::SidecarManager,
};

pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod services;

#[derive(Debug, Default)]
pub struct AppState {
    pub config_service: ConfigService,
    pub sidecar_manager: Arc<SidecarManager>,
    pub bridge_server: Arc<BridgeServer>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Initialize database
            match app.path().app_data_dir() {
                Ok(data_dir) => {
                    let db_path = data_dir.join("ai-sheet.db");
                    match Database::open(&db_path) {
                        Ok(database) => {
                            let db = Arc::new(database);
                            let db_clone = db.clone();
                            tauri::async_runtime::block_on(async move {
                                if let Err(e) = db_clone.run_migrations().await {
                                    eprintln!("Database migration failed: {}", e);
                                }
                            });
                            app.manage(db);
                        }
                        Err(e) => {
                            eprintln!("Failed to open database: {}", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to resolve app data dir: {}", e);
                }
            }

            let state = app.state::<AppState>();
            let bridge_server = state.bridge_server.clone();

            let bridge_app_handle = app_handle.clone();
            let sidecar = state.sidecar_manager.clone();
            tauri::async_runtime::spawn(async move {
                match bridge_server.start(bridge_app_handle.clone()).await {
                    Ok(port) => {
                        sidecar.set_bridge_port(port);
                        let _ = bridge_app_handle.emit(
                            "bridge-ready",
                            serde_json::json!({ "port": port }),
                        );

                        if let Err(error) = sidecar.start(app_handle.clone()).await {
                            app_handle
                                .emit(
                                    "sidecar-dead",
                                    serde_json::json!({ "message": error.to_string() }),
                                )
                                .ok();
                        }
                    }
                    Err(e) => {
                        eprintln!("Bridge server failed to start: {}", e);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::get_active_model,
            commands::config::get_fallback_models,
            commands::excel::get_excel_info,
            commands::excel::get_sheet_names,
            commands::excel::get_column_names,
            commands::excel::get_sample_data,
            commands::excel::get_column_data,
            commands::excel::write_excel_results,
            commands::excel::apply_excel_formula,
            commands::excel::get_excel_processing_status,
            commands::sidecar::get_agent_status,
            commands::sidecar::restart_sidecar,
            commands::sidecar::send_agent_message,
            commands::sidecar::steer_agent,
            commands::sidecar::stop_agent_stream,
            commands::system::get_app_status,
            commands::config::get_user_models,
            commands::config::add_user_model,
            commands::config::update_user_model,
            commands::config::delete_user_model,
            commands::prompt::get_all_prompts,
            commands::prompt::save_prompt,
            commands::prompt::update_prompt,
            commands::prompt::delete_prompt,
            commands::formula_cache::get_formula_history,
            commands::formula_cache::save_formula_cache,
            commands::formula_cache::touch_formula_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
