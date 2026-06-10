use std::path::Path;
use std::sync::Arc;
use std::fs;

use tauri::{Emitter, Manager};
use tokio::sync::RwLock;

use crate::db::{settings_repo, Database};
use crate::models::config::ActiveModel;
use crate::services::{
    bridge_server::BridgeServer, config_service::ConfigService,
    sidecar_manager::SidecarManager,
};

pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod services;

/// 递归复制目录
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[derive(Debug, Default)]
pub struct AppState {
    pub config_service: ConfigService,
    pub sidecar_manager: Arc<SidecarManager>,
    pub bridge_server: Arc<BridgeServer>,
    pub active_model: Arc<RwLock<Option<ActiveModel>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Initialize database
            let db_dir_str: Option<String> = match app.path().app_data_dir() {
                Ok(data_dir) => {
                    let db_path = data_dir.join("ai-sheet.db");
                    let db_dir_str = data_dir.to_string_lossy().to_string();
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
                    Some(db_dir_str)
                }
                Err(e) => {
                    eprintln!("Failed to resolve app data dir: {}", e);
                    None
                }
            };

            // 首次运行：将 .pi/ 资源复制到 app_data_dir
            if let Ok(data_dir) = app.path().app_data_dir() {
                let pi_dest = data_dir.join(".pi");
                if !pi_dest.exists() {
                    let pi_src = None::<std::path::PathBuf>
                        // 生产模式：从捆绑资源目录查找
                        .into_iter()
                        .chain(
                            app.path()
                                .resource_dir()
                                .ok()
                                .map(|d| d.join(".pi")),
                        )
                        // 开发模式：从项目根目录查找
                        .chain(
                            std::env::current_dir()
                                .ok()
                                .and_then(|cwd| {
                                    let root = if cwd.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
                                        cwd.parent()?.to_path_buf()
                                    } else {
                                        cwd
                                    };
                                    Some(root.join(".pi"))
                                }),
                        )
                        .find(|p| p.exists());
                    if let Some(src) = pi_src {
                        eprintln!("[setup] copying .pi/ from {:?} to {:?}", src, pi_dest);
                        if let Err(e) = copy_dir_all(&src, &pi_dest) {
                            eprintln!("[setup] failed to copy .pi/ resources: {}", e);
                        }
                    } else {
                        eprintln!("[setup] no .pi/ source found (skills will be empty)");
                    }
                }
            }

            // 从 settings 表恢复 active_model 到内存
            let state = app.state::<AppState>();
            if let Some(db) = app.try_state::<Arc<Database>>() {
                let db_inner = db.inner().clone();
                match tauri::async_runtime::block_on(async {
                    let conn = db_inner.get_conn().await;
                    settings_repo::get_setting(&conn, "active_model")
                }) {
                    Ok(Some(json)) => {
                        if let Ok(model) = serde_json::from_str::<ActiveModel>(&json) {
                            let mut guard = tauri::async_runtime::block_on(state.active_model.write());
                            *guard = Some(model);
                        }
                    }
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("Failed to restore active_model: {}", e);
                    }
                }
            }

            let state = app.state::<AppState>();
            let bridge_server = state.bridge_server.clone();

            // 设置 sidecar 的默认工作目录为 DB 数据目录
            if let Some(dir) = db_dir_str {
                state.sidecar_manager.set_db_dir(dir);
            }

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
            commands::config::set_active_model,
            commands::config::clear_active_model,
            commands::excel::get_excel_info,
            commands::excel::get_sheet_names,
            commands::excel::get_column_names,
            commands::excel::get_sample_data,
            commands::excel::get_column_data,
            commands::excel::write_excel_results,
            commands::excel::apply_excel_formula,
            commands::excel::preview_formula,
            commands::excel::get_excel_processing_status,
            commands::sidecar::get_agent_status,
            commands::sidecar::restart_sidecar,
            commands::sidecar::send_agent_message,
            commands::sidecar::steer_agent,
            commands::sidecar::clear_agent_context,
            commands::sidecar::stop_agent_stream,
            commands::sidecar::set_agent_cwd,
            commands::system::get_app_status,
            commands::system::get_app_data_dir,
            commands::config::get_user_models,
            commands::config::add_user_model,
            commands::config::update_user_model,
            commands::config::delete_user_model,
            commands::prompt::get_all_prompts,
            commands::prompt::save_prompt,
            commands::prompt::update_prompt,
            commands::prompt::delete_prompt,
            commands::llm::llm_chat_completions,
            commands::llm::llm_test_connection,
            commands::formula_cache::get_formula_history,
            commands::formula_cache::save_formula_cache,
            commands::formula_cache::touch_formula_cache,
            commands::pinned_formula::get_pinned_formulas,
            commands::pinned_formula::add_pinned_formula,
            commands::pinned_formula::delete_pinned_formula,
            commands::skill::list_skills,
            commands::skill::read_skill,
            commands::skill::read_skill_file,
            commands::skill::list_skill_files,
            commands::skill::create_skill,
            commands::skill::delete_skill,
            commands::skill::update_skill_file,
            commands::skill::delete_skill_file,
            commands::skill::create_skill_file,
            commands::skill::import_skill_from_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
