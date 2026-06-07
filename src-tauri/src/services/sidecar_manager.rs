use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, RwLock},
};

use crate::{
    error::{AppError, AppResult},
    models::agent::AgentStatus,
};

const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(15);
const SEND_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Default)]
pub struct SidecarManager {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    last_heartbeat: RwLock<Option<Instant>>,
    is_streaming: RwLock<bool>,
    bridge_port: std::sync::RwLock<Option<u16>>,
}

impl SidecarManager {
    pub fn set_bridge_port(&self, port: u16) {
        if let Ok(mut guard) = self.bridge_port.write() {
            *guard = Some(port);
        }
    }

    pub async fn start(self: &Arc<Self>, app: AppHandle) -> AppResult<()> {
        self.stop().await.ok();

        let agent_entry = resolve_agent_entry()?;
        let mut cmd = Command::new("node");
        cmd.arg(&agent_entry);

        let bridge_port = self.bridge_port.read().ok().and_then(|guard| *guard);
        if let Some(port) = bridge_port {
            cmd.arg("--bridge-port").arg(port.to_string());
        }

        let mut child = cmd
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Sidecar("failed to open sidecar stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Sidecar("failed to open sidecar stdout".into()))?;

        *self.stdin.lock().await = Some(stdin);
        *self.child.lock().await = Some(child);
        *self.last_heartbeat.write().await = Some(Instant::now());
        *self.is_streaming.write().await = false;

        self.spawn_stdout_reader(app.clone(), stdout);
        self.spawn_heartbeat_monitor(app);

        Ok(())
    }

    pub async fn stop(&self) -> AppResult<()> {
        *self.stdin.lock().await = None;

        if let Some(mut child) = self.child.lock().await.take() {
            child.kill().await.ok();
        }

        *self.is_streaming.write().await = false;
        Ok(())
    }

    pub async fn restart(self: &Arc<Self>, app: AppHandle) -> AppResult<()> {
        self.start(app.clone()).await?;
        app.emit("sidecar-restarted", json!({ "message": "AI Agent 已重新连接" }))
            .ok();
        Ok(())
    }

    pub async fn send_user_message(&self, content: String) -> AppResult<()> {
        let id = format!("msg-{}", current_millis());
        let payload = json!({
            "id": id,
            "type": "user_message",
            "content": content,
        });

        *self.is_streaming.write().await = true;
        self.write_json_line(payload).await
    }

    pub async fn steer(&self, context: String) -> AppResult<()> {
        let id = format!("steer-{}", current_millis());
        let payload: Value =
            serde_json::from_str(&context).unwrap_or_else(|_| json!({ "raw": context }));
        let payload = json!({
            "id": id,
            "type": "steer",
            "context": payload,
        });

        self.write_json_line(payload).await
    }

    pub async fn stop_stream(&self) -> AppResult<()> {
        *self.is_streaming.write().await = false;
        let id = format!("stop-{}", current_millis());
        let payload = json!({
            "id": id,
            "type": "stop",
        });

        self.write_json_line(payload).await.ok();
        Ok(())
    }

    pub async fn send_batch_command(
        &self,
        command_type: &str,
        extra_fields: serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<()> {
        let id = format!("batch-{}", current_millis());
        let mut payload = serde_json::json!({
            "id": id,
            "type": command_type,
        });
        if let Some(obj) = payload.as_object_mut() {
            for (k, v) in extra_fields {
                obj.insert(k, v);
            }
        }
        self.write_json_line(payload).await
    }

    pub async fn status(&self) -> AgentStatus {
        let last_heartbeat = *self.last_heartbeat.read().await;
        let last_heartbeat_age_secs = last_heartbeat.map(|instant| instant.elapsed().as_secs());
        let ready = last_heartbeat_age_secs
            .map(|age| age < HEARTBEAT_TIMEOUT.as_secs())
            .unwrap_or(false);

        AgentStatus {
            ready,
            is_streaming: *self.is_streaming.read().await,
            last_heartbeat_age_secs,
            message: if ready {
                "Sidecar online".to_string()
            } else {
                "Sidecar offline".to_string()
            },
        }
    }

    async fn write_json_line(&self, payload: Value) -> AppResult<()> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard.as_mut().ok_or(AppError::SidecarUnavailable)?;
        let mut line = serde_json::to_vec(&payload)?;
        line.push(b'\n');

        tokio::time::timeout(SEND_TIMEOUT, stdin.write_all(&line))
            .await
            .map_err(|_| AppError::SidecarTimeout)??;
        tokio::time::timeout(SEND_TIMEOUT, stdin.flush())
            .await
            .map_err(|_| AppError::SidecarTimeout)??;

        Ok(())
    }

    fn spawn_stdout_reader(
        self: &Arc<Self>,
        app: AppHandle,
        stdout: tokio::process::ChildStdout,
    ) {
        let manager = Arc::clone(self);

        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();

            while let Ok(Some(line)) = lines.next_line().await {
                match serde_json::from_str::<Value>(&line) {
                    Ok(value) => manager.handle_sidecar_event(&app, value).await,
                    Err(error) => {
                        app.emit(
                            "agent-event",
                            json!({ "type": "agent_error", "message": error.to_string() }),
                        )
                        .ok();
                    }
                }
            }

            *manager.is_streaming.write().await = false;
            app.emit("sidecar-dead", json!({ "message": "Sidecar 进程已退出" }))
                .ok();
        });
    }

    fn spawn_heartbeat_monitor(self: &Arc<Self>, app: AppHandle) {
        let manager = Arc::clone(self);

        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));

            loop {
                interval.tick().await;
                let status = manager.status().await;

                if !status.ready {
                    app.emit(
                        "sidecar-dead",
                        json!({
                            "message": "Sidecar 进程失去响应",
                            "elapsedSecs": status.last_heartbeat_age_secs,
                        }),
                    )
                    .ok();
                    break;
                }
            }
        });
    }

    async fn handle_sidecar_event(&self, app: &AppHandle, value: Value) {
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or_default();

        if event_type == "heartbeat" {
            *self.last_heartbeat.write().await = Some(Instant::now());
            app.emit("sidecar-heartbeat", value).ok();
            return;
        }

        if matches!(event_type, "agent_done" | "agent_error") {
            *self.is_streaming.write().await = false;
        }

        app.emit("agent-event", value).ok();
    }
}

fn resolve_agent_entry() -> AppResult<PathBuf> {
    let cwd = std::env::current_dir()?;
    let root = if cwd.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        cwd.parent()
            .ok_or_else(|| AppError::Sidecar("failed to resolve project root".into()))?
            .to_path_buf()
    } else {
        cwd
    };

    Ok(root.join("src-agent").join("dist").join("main.js"))
}

fn current_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
