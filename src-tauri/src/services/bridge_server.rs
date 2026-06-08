use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::error::AppResult;

#[derive(Debug, Default)]
pub struct BridgeServer {
    pub port: Arc<Mutex<Option<u16>>>,
}

impl BridgeServer {
    pub async fn start(self: &Arc<Self>, app: AppHandle) -> AppResult<u16> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        *self.port.lock().await = Some(port);

        let server = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((mut stream, _)) => {
                        let _ = server.handle_connection(&mut stream, &app).await;
                    }
                    Err(e) => {
                        eprintln!("Bridge accept error: {}", e);
                        break;
                    }
                }
            }
        });

        Ok(port)
    }

    async fn handle_connection(
        &self,
        stream: &mut tokio::net::TcpStream,
        app: &AppHandle,
    ) -> AppResult<()> {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let mut reader = BufReader::new(stream);
        let mut request_line = String::new();
        reader.read_line(&mut request_line).await?;

        let mut content_length = 0usize;
        loop {
            let mut header = String::new();
            reader.read_line(&mut header).await?;
            if header.trim().is_empty() {
                break;
            }
            if let Some(len) = header
                .to_lowercase()
                .strip_prefix("content-length:")
            {
                content_length = len.trim().parse().unwrap_or(0);
            }
        }

        let mut body = vec![0u8; content_length];
        if content_length > 0 {
            reader.read_exact(&mut body).await?;
        }

        let path = request_line
            .split_whitespace()
            .nth(1)
            .unwrap_or("/")
            .to_string();

        let body_str = String::from_utf8_lossy(&body).to_string();
        let response = self.route(&path, &body_str, app).await;

        let status_line = "HTTP/1.1 200 OK";
        let response_body = serde_json::to_string(&response).unwrap_or_default();
        let response = format!(
            "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
            response_body.len(),
            response_body
        );

        let stream = reader.into_inner();
        stream.write_all(response.as_bytes()).await.ok();

        Ok(())
    }

    async fn route(
        &self,
        path: &str,
        body: &str,
        app: &AppHandle,
    ) -> Value {
        let body_value: Value = serde_json::from_str(body).unwrap_or_default();

        match path {
            "/api/excel/info" => {
                let path = body_value["path"].as_str().unwrap_or("");
                match crate::services::excel_service::ExcelService::get_info(path) {
                    Ok(info) => serde_json::to_value(info).unwrap_or_default(),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/excel/columns" => {
                let path = body_value["path"].as_str().unwrap_or("");
                let sheet = body_value["sheet"].as_str().unwrap_or("");
                match crate::services::excel_service::ExcelService::get_column_names(path, sheet) {
                    Ok(cols) => serde_json::to_value(cols).unwrap_or_default(),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/excel/sample" => {
                let path = body_value["path"].as_str().unwrap_or("");
                let sheet = body_value["sheet"].as_str().unwrap_or("");
                let rows = body_value["rows"].as_u64().unwrap_or(10) as usize;
                match crate::services::excel_service::ExcelService::get_sample_data(
                    path, sheet, rows,
                ) {
                    Ok(data) => serde_json::to_value(data).unwrap_or_default(),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/excel/write" => {
                let req: crate::models::excel::WriteResultsRequest =
                    serde_json::from_str(body).unwrap_or_else(|_| {
                        crate::models::excel::WriteResultsRequest {
                            path: String::new(),
                            sheet: String::new(),
                            column: String::new(),
                            results: vec![],
                        }
                    });
                match crate::services::excel_service::ExcelService::write_results(&req) {
                    Ok(_) => serde_json::json!({"success": true}),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/excel/apply-formula" => {
                let req: crate::models::excel::ApplyFormulaRequest =
                    serde_json::from_str(body).unwrap_or_else(|_| {
                        crate::models::excel::ApplyFormulaRequest {
                            path: String::new(),
                            sheet: String::new(),
                            column: String::new(),
                            formula: String::new(),
                            strategy: "overwrite".to_string(),
                        }
                    });
                match crate::services::excel_service::ExcelService::apply_formula(&req) {
                    Ok(_) => serde_json::json!({"success": true}),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/excel/processing-status" => {
                let path = body_value["path"].as_str().unwrap_or("");
                let sheet = body_value["sheet"].as_str().unwrap_or("");
                let column = body_value["resultColumn"].as_str().unwrap_or("");
                match crate::services::excel_service::ExcelService::get_processing_status(
                    path, sheet, column,
                ) {
                    Ok(status) => serde_json::to_value(status).unwrap_or_default(),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/config/default" => {
                let state = app.state::<crate::AppState>();
                let active = state.active_model.read().await.clone();
                if let Some(m) = active {
                    serde_json::json!({
                        "name": m.name,
                        "providerType": m.provider_type,
                        "modelId": m.model_id,
                        "apiKey": m.api_key,
                        "baseUrl": m.base_url,
                    })
                } else {
                    serde_json::json!({"error": "no active model configured"})
                }
            }
            "/api/config/models" => {
                serde_json::json!([])
            }
            "/api/config/test" => {
                serde_json::json!({"success": false, "error": "not implemented"})
            }
            "/api/batch/start" => {
                let state = app.state::<crate::AppState>();
                let extra = body_value.as_object().cloned().unwrap_or_default();
                match state.sidecar_manager.send_batch_command("batch_start", extra).await {
                    Ok(_) => serde_json::json!({"success": true}),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/batch/pause" => {
                let state = app.state::<crate::AppState>();
                let extra = body_value.as_object().cloned().unwrap_or_default();
                match state.sidecar_manager.send_batch_command("batch_pause", extra).await {
                    Ok(_) => serde_json::json!({"success": true}),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/batch/resume" => {
                let state = app.state::<crate::AppState>();
                let extra = body_value.as_object().cloned().unwrap_or_default();
                match state.sidecar_manager.send_batch_command("batch_resume", extra).await {
                    Ok(_) => serde_json::json!({"success": true}),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/batch/stop" => {
                let state = app.state::<crate::AppState>();
                let extra = body_value.as_object().cloned().unwrap_or_default();
                match state.sidecar_manager.send_batch_command("batch_stop", extra).await {
                    Ok(_) => serde_json::json!({"success": true}),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/batch/status" => {
                let state = app.state::<crate::AppState>();
                let extra = body_value.as_object().cloned().unwrap_or_default();
                match state.sidecar_manager.send_batch_command("batch_status", extra).await {
                    Ok(_) => serde_json::json!({"success": true}),
                    Err(e) => serde_json::json!({"error": e.to_string()}),
                }
            }
            "/api/prompts" if body_value.get("name").is_some() && body_value.get("content").is_some() => {
                let input = crate::models::prompt::PromptInput {
                    name: body_value["name"].as_str().unwrap_or("").to_string(),
                    content: body_value["content"].as_str().unwrap_or("").to_string(),
                    category: body_value.get("category").and_then(|c| c.as_str()).map(String::from),
                };
                match app.try_state::<std::sync::Arc<crate::db::Database>>() {
                    Some(db) => {
                        let conn = db.get_conn().await;
                        match crate::db::prompts_repo::insert_prompt(&conn, &input) {
                            Ok(p) => serde_json::to_value(p).unwrap_or_default(),
                            Err(e) => serde_json::json!({"error": e.to_string()}),
                        }
                    }
                    None => {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();
                        serde_json::json!({"success": true, "id": format!("prompt-{}", now)})
                    }
                }
            }
            "/api/prompts" => {
                match app.try_state::<std::sync::Arc<crate::db::Database>>() {
                    Some(db) => {
                        let conn = db.get_conn().await;
                        match crate::db::prompts_repo::get_all_prompts(&conn) {
                            Ok(prompts) => serde_json::to_value(prompts).unwrap_or_default(),
                            Err(e) => serde_json::json!({"error": e.to_string()}),
                        }
                    }
                    None => serde_json::json!([])
                }
            }
            "/api/events/notify" => {
                let _ = app.emit("bridge-notification", &body_value);
                serde_json::json!({"success": true})
            }
            _ => serde_json::json!({"error": "unknown endpoint"}),
        }
    }
}
