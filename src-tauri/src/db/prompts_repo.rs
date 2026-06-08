use rusqlite::Connection;

use crate::error::AppResult;
use crate::models::prompt::{Prompt, PromptInput};

pub fn get_all_prompts(conn: &Connection) -> AppResult<Vec<Prompt>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, content, category, is_system, created_at, updated_at
         FROM prompts ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Prompt {
            id: row.get(0)?,
            name: row.get(1)?,
            content: row.get(2)?,
            category: row.get(3)?,
            is_system: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    let mut prompts = Vec::new();
    for row in rows {
        prompts.push(row?);
    }
    Ok(prompts)
}

pub fn insert_prompt(conn: &Connection, input: &PromptInput) -> AppResult<Prompt> {
    let now = chrono::Utc::now().to_rfc3339();
    let id = format!("prompt-{}", chrono::Utc::now().timestamp_millis());
    let category = input.category.clone().unwrap_or_default();
    conn.execute(
        "INSERT INTO prompts (id, name, content, category, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
        rusqlite::params![id, input.name, input.content, category, now, now],
    )?;
    Ok(Prompt {
        id,
        name: input.name.clone(),
        content: input.content.clone(),
        category,
        is_system: false,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn update_prompt(conn: &Connection, id: &str, input: &PromptInput) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let category = input.category.clone().unwrap_or_default();
    conn.execute(
        "UPDATE prompts SET name=?1, content=?2, category=?3, updated_at=?4 WHERE id=?5",
        rusqlite::params![input.name, input.content, category, now, id],
    )?;
    Ok(())
}

pub fn delete_prompt(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM prompts WHERE id=?1", rusqlite::params![id])?;
    Ok(())
}

/// Seed system prompts for quick actions if they don't exist yet.
/// Idempotent — skips if a prompt with the same name already exists.
pub fn seed_system_prompts(conn: &Connection) -> AppResult<()> {
    const QUICK_ACTION_CATEGORY: &str = "快捷操作";

    let seeds: &[(&str, &str)] = &[
        (
            "Excel公式生成",
            include_str!("../../seeds/formula_generation.md"),
        ),
        (
            "提示词生成",
            include_str!("../../seeds/prompt_generation.md"),
        ),
    ];

    for &(name, content) in seeds {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM prompts WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )?;
        if count == 0 {
            let now = chrono::Utc::now().to_rfc3339();
            let id = format!("prompt-seed-{}", name);
            conn.execute(
                "INSERT INTO prompts (id, name, content, category, is_system, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
                rusqlite::params![id, name, content, QUICK_ACTION_CATEGORY, now, now],
            )?;
        }
    }

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

    fn sample_input(name: &str) -> PromptInput {
        PromptInput {
            name: name.into(),
            content: format!("Content for {}", name),
            category: Some("test".into()),
        }
    }

    #[test]
    fn test_insert_and_get_all() {
        let conn = setup_db();
        let prompt = insert_prompt(&conn, &sample_input("Test Prompt")).unwrap();
        assert!(prompt.id.starts_with("prompt-"));
        assert_eq!(prompt.name, "Test Prompt");
        assert!(!prompt.is_system);

        let all = get_all_prompts(&conn).unwrap();
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn test_update_prompt() {
        let conn = setup_db();
        let created = insert_prompt(&conn, &sample_input("Original")).unwrap();

        let updated_input = PromptInput {
            name: "Updated".into(),
            content: "Updated content".into(),
            category: Some("updated".into()),
        };
        update_prompt(&conn, &created.id, &updated_input).unwrap();

        let all = get_all_prompts(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Updated");
        assert_eq!(all[0].content, "Updated content");
    }

    #[test]
    fn test_delete_prompt() {
        let conn = setup_db();
        let p = insert_prompt(&conn, &sample_input("To Delete")).unwrap();
        assert_eq!(get_all_prompts(&conn).unwrap().len(), 1);

        delete_prompt(&conn, &p.id).unwrap();
        assert_eq!(get_all_prompts(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_insert_multiple_prompts() {
        let conn = setup_db();
        insert_prompt(&conn, &sample_input("A")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        insert_prompt(&conn, &sample_input("B")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        insert_prompt(&conn, &sample_input("C")).unwrap();
        assert_eq!(get_all_prompts(&conn).unwrap().len(), 3);
    }
}
