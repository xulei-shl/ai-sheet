use rusqlite::Connection;

use crate::error::AppResult;
use crate::models::config::ModelConfig;

pub fn get_all_models(conn: &Connection) -> AppResult<Vec<ModelConfig>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, api_key, base_url, model_id, provider_type, use_proxy
         FROM models ORDER BY id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ModelConfig {
            id: Some(row.get::<_, i64>(0)?),
            name: row.get(1)?,
            api_key: row.get(2)?,
            base_url: row.get(3)?,
            model_id: row.get(4)?,
            provider_type: row.get(5)?,
            use_proxy: row.get::<_, i64>(6)? != 0,
        })
    })?;
    let mut models = Vec::new();
    for row in rows {
        models.push(row?);
    }
    Ok(models)
}

pub fn insert_model(conn: &Connection, model: &ModelConfig) -> AppResult<ModelConfig> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO models (name, api_key, base_url, model_id, provider_type, use_proxy, is_default, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            model.name,
            model.api_key,
            model.base_url,
            model.model_id,
            model.provider_type,
            model.use_proxy as i64,
            0,
            now,
            now,
        ],
    )?;
    let id = conn.last_insert_rowid();
    Ok(ModelConfig {
        id: Some(id),
        name: model.name.clone(),
        api_key: model.api_key.clone(),
        base_url: model.base_url.clone(),
        model_id: model.model_id.clone(),
        provider_type: model.provider_type.clone(),
        use_proxy: model.use_proxy,
    })
}

pub fn update_model(conn: &Connection, id: i64, model: &ModelConfig) -> AppResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE models SET name=?1, api_key=?2, base_url=?3, model_id=?4, provider_type=?5, use_proxy=?6, updated_at=?7
         WHERE id=?8",
        rusqlite::params![
            model.name,
            model.api_key,
            model.base_url,
            model.model_id,
            model.provider_type,
            model.use_proxy as i64,
            now,
            id,
        ],
    )?;
    Ok(())
}

pub fn delete_model(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM models WHERE id=?1", rusqlite::params![id])?;
    Ok(())
}

pub fn get_model_by_index(conn: &Connection, index: usize) -> AppResult<Option<ModelConfig>> {
    let models = get_all_models(conn)?;
    Ok(models.into_iter().nth(index))
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

    fn sample_model() -> ModelConfig {
        ModelConfig {
            id: None,
            name: "Test Model".into(),
            api_key: "sk-test-123".into(),
            base_url: "https://api.test.com/v1".into(),
            model_id: "test-model".into(),
            provider_type: "openai-completions".into(),
            use_proxy: true,
        }
    }

    #[test]
    fn test_insert_and_get_all() {
        let conn = setup_db();
        let model = sample_model();
        let created = insert_model(&conn, &model).unwrap();
        assert!(created.id.is_some());
        assert_eq!(created.name, "Test Model");

        let all = get_all_models(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Test Model");
        assert_eq!(all[0].api_key, "sk-test-123");
    }

    #[test]
    fn test_get_model_by_index() {
        let conn = setup_db();
        insert_model(&conn, &sample_model()).unwrap();
        let found = get_model_by_index(&conn, 0).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "Test Model");
        let not_found = get_model_by_index(&conn, 5).unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_update_model() {
        let conn = setup_db();
        let created = insert_model(&conn, &sample_model()).unwrap();
        let id = created.id.unwrap();

        let mut updated = sample_model();
        updated.name = "Updated Model".into();
        updated.api_key = "new-key".into();
        update_model(&conn, id, &updated).unwrap();

        let all = get_all_models(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Updated Model");
        assert_eq!(all[0].api_key, "new-key");
    }

    #[test]
    fn test_delete_model() {
        let conn = setup_db();
        let created = insert_model(&conn, &sample_model()).unwrap();
        assert_eq!(get_all_models(&conn).unwrap().len(), 1);

        delete_model(&conn, created.id.unwrap()).unwrap();
        assert_eq!(get_all_models(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_insert_multiple() {
        let conn = setup_db();
        for i in 0..3 {
            let mut m = sample_model();
            m.name = format!("Model {}", i);
            insert_model(&conn, &m).unwrap();
        }
        assert_eq!(get_all_models(&conn).unwrap().len(), 3);
    }

    #[test]
    fn test_empty_db() {
        let conn = setup_db();
        assert_eq!(get_all_models(&conn).unwrap().len(), 0);
        assert!(get_model_by_index(&conn, 0).unwrap().is_none());
    }
}
