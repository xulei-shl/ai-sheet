use rusqlite::Connection;

use crate::error::AppResult;

const MIGRATIONS: &[&str] = &[
    // v1: Initial schema
    "CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
    );",
    "INSERT OR IGNORE INTO schema_version (version) VALUES (1);",
    // v2: models table
    "CREATE TABLE IF NOT EXISTS models (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        api_key     TEXT NOT NULL DEFAULT '',
        base_url    TEXT NOT NULL,
        model_id    TEXT NOT NULL,
        provider_type TEXT NOT NULL DEFAULT 'openai-completions',
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );",
    // v3: prompts table
    "CREATE TABLE IF NOT EXISTS prompts (
        id          TEXT NOT NULL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        content     TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT '',
        is_system   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );",
    // v4: formula_cache table
    "CREATE TABLE IF NOT EXISTS formula_cache (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        requirement TEXT NOT NULL,
        columns_key TEXT NOT NULL,
        formula     TEXT NOT NULL,
        explanation TEXT NOT NULL DEFAULT '',
        model_id    TEXT NOT NULL DEFAULT '',
        accessed_at TEXT NOT NULL,
        created_at  TEXT NOT NULL
    );",
    // v5: settings table
    "CREATE TABLE IF NOT EXISTS settings (
        key         TEXT NOT NULL PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );",
    // v6: use_proxy column for per-model proxy toggle
    "ALTER TABLE models ADD COLUMN use_proxy INTEGER NOT NULL DEFAULT 1;",
    // v7: pinned_formulas table
    "CREATE TABLE IF NOT EXISTS pinned_formulas (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        formula     TEXT NOT NULL,
        columns_key TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL
    );",
];

pub fn run(conn: &Connection) -> AppResult<()> {
    for sql in MIGRATIONS {
        if let Err(e) = conn.execute(sql, []) {
            eprintln!("Migration warning (non-fatal): {}", e);
        }
    }
    Ok(())
}
