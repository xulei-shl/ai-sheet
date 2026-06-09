pub mod formula_cache_repo;
pub mod pinned_formula_repo;
pub mod migrations;
pub mod models_repo;
pub mod prompts_repo;
pub mod settings_repo;

use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::error::AppResult;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Clean stale WAL/SHM files from previous instances to prevent corruption
        // e.g. ai-sheet.db → ai-sheet.db-wal, ai-sheet.db-shm
        if path.exists() {
            let path_str = path.to_string_lossy().to_string();
            let _ = fs::remove_file(format!("{}-wal", path_str));
            let _ = fs::remove_file(format!("{}-shm", path_str));
        }

        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub async fn run_migrations(&self) -> AppResult<()> {
        let conn = self.conn.lock().await;
        migrations::run(&conn)?;
        prompts_repo::seed_system_prompts(&conn)?;
        Ok(())
    }

    pub async fn get_conn(&self) -> tokio::sync::MutexGuard<'_, Connection> {
        self.conn.lock().await
    }
}

pub type SharedDatabase = Arc<Database>;
