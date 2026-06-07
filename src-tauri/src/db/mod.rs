pub mod formula_cache_repo;
pub mod migrations;
pub mod models_repo;
pub mod prompts_repo;

use rusqlite::Connection;
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
        Ok(())
    }

    pub async fn get_conn(&self) -> tokio::sync::MutexGuard<'_, Connection> {
        self.conn.lock().await
    }
}

pub type SharedDatabase = Arc<Database>;
