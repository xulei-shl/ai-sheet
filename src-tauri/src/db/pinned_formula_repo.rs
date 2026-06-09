use rusqlite::Connection;

use crate::error::AppResult;
use crate::models::pinned_formula::PinnedFormula;

pub fn get_all(conn: &Connection) -> AppResult<Vec<PinnedFormula>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, formula, columns_key, created_at
         FROM pinned_formulas ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PinnedFormula {
            id: row.get(0)?,
            name: row.get(1)?,
            formula: row.get(2)?,
            columns_key: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row?);
    }
    Ok(entries)
}

pub fn insert(
    conn: &Connection,
    name: &str,
    formula: &str,
    columns_key: &str,
) -> AppResult<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO pinned_formulas (name, formula, columns_key, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![name, formula, columns_key, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM pinned_formulas WHERE id=?1", rusqlite::params![id])?;
    Ok(())
}
