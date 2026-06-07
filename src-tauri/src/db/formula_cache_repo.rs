use rusqlite::Connection;

use crate::error::AppResult;
use crate::models::formula_cache::FormulaCacheEntry;

pub fn get_all(conn: &Connection) -> AppResult<Vec<FormulaCacheEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, requirement, columns_key, formula, explanation, accessed_at, created_at
         FROM formula_cache ORDER BY accessed_at DESC LIMIT 50",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(FormulaCacheEntry {
            id: row.get(0)?,
            requirement: row.get(1)?,
            columns_key: row.get(2)?,
            formula: row.get(3)?,
            explanation: row.get(4)?,
            accessed_at: row.get(5)?,
            created_at: row.get(6)?,
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
    requirement: &str,
    columns_key: &str,
    formula: &str,
    explanation: &str,
) -> AppResult<i64> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO formula_cache (requirement, columns_key, formula, explanation, model_id, accessed_at, created_at)
         VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)",
        rusqlite::params![requirement, columns_key, formula, explanation, now, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn touch(conn: &Connection, id: i64) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE formula_cache SET accessed_at=?1 WHERE id=?2",
        rusqlite::params![now, id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    #[test]
    fn test_insert_and_get_all() {
        let conn = setup_db();
        let id = insert(&conn, "sum column A", "cols:A", "=SUM(A:A)", "Sum all values").unwrap();
        assert!(id > 0);

        let all = get_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].formula, "=SUM(A:A)");
        assert_eq!(all[0].requirement, "sum column A");
    }

    #[test]
    fn test_touch_updates_accessed_at() {
        let conn = setup_db();
        let id = insert(&conn, "test", "k", "=A1", "").unwrap();
        let entry_before = get_all(&conn).unwrap().remove(0);
        std::thread::sleep(std::time::Duration::from_millis(10));
        touch(&conn, id).unwrap();
        let entry_after = get_all(&conn).unwrap().remove(0);
        assert_ne!(entry_before.accessed_at, entry_after.accessed_at);
    }

    #[test]
    fn test_multiple_entries() {
        let conn = setup_db();
        insert(&conn, "req1", "k1", "=A1", "").unwrap();
        insert(&conn, "req2", "k2", "=B1", "").unwrap();
        assert_eq!(get_all(&conn).unwrap().len(), 2);
    }

    #[test]
    fn test_empty_cache() {
        let conn = setup_db();
        assert!(get_all(&conn).unwrap().is_empty());
    }
}
