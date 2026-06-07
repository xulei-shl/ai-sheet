use std::sync::Arc;

use tauri::State;

use crate::db::{prompts_repo, Database};
use crate::models::prompt::{Prompt, PromptInput};

#[tauri::command]
pub async fn get_all_prompts(db: State<'_, Arc<Database>>) -> Result<Vec<Prompt>, String> {
    let conn = db.get_conn().await;
    prompts_repo::get_all_prompts(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_prompt(
    db: State<'_, Arc<Database>>,
    input: PromptInput,
) -> Result<Prompt, String> {
    let conn = db.get_conn().await;
    prompts_repo::insert_prompt(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_prompt(
    db: State<'_, Arc<Database>>,
    id: String,
    input: PromptInput,
) -> Result<(), String> {
    let conn = db.get_conn().await;
    prompts_repo::update_prompt(&conn, &id, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_prompt(
    db: State<'_, Arc<Database>>,
    id: String,
) -> Result<(), String> {
    let conn = db.get_conn().await;
    prompts_repo::delete_prompt(&conn, &id).map_err(|e| e.to_string())
}
