//! 管理 opencode serve 子进程(共享单例)。
//!
//! Studio 的所有 agent 会话复用同一个 opencode serve 进程,
//! 通过 HTTP + SSE 通信。每个项目用 `?directory=<path>` 区分。
//!
//! 生命周期:
//! - 首次调用 `ensure_started()` 时 spawn "opencode serve --port <随机>"
//! - Desktop 退出时 `shutdown()` kill 进程
//! - 进程异常退出时下次调用自动重启

use crate::process_util::configure_process_group;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// opencode serve 进程的健康检查超时。
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);

/// 一个已启动的 opencode serve 实例。
#[derive(Clone)]
pub struct OpencodeServer {
    base_url: String,
    _child: Arc<Mutex<Option<Child>>>,
    cancellation: CancellationToken,
}

#[derive(Debug, Deserialize)]
struct SessionCreateResponse {
    id: String,
    #[allow(dead_code)]
    directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedSession {
    pub session_id: String,
}

impl OpencodeServer {
    /// 确保 opencode serve 已启动并返回一个 handle。
    ///
    /// 内部用 Arc<Mutex> 保证全局单例:第一个调用者 spawn 进程,后续调用复用。
    /// 进程已死时自动重启。
    pub async fn ensure_started() -> Result<Self, String> {
        let mut guard = global_mutex().lock().await;

        // 检查现有进程是否健康
        if let Some(ref server) = *guard {
            if server.health().await.is_ok() {
                return Ok(server.clone());
            }
            // 不健康,清理重启
            server.shutdown().await;
        }

        let server = spawn_server().await?;
        *guard = Some(server.clone());
        Ok(server)
    }

    /// 健康检查:GET /health 返回 200。
    async fn health(&self) -> Result<(), String> {
        let resp = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|e| format!("http client: {e}"))?
            .get(format!("{}/health", self.base_url))
            .send()
            .await
            .map_err(|e| format!("health check failed: {e}"))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("health check status: {}", resp.status()))
        }
    }

    /// 创建一个会话,工作目录为 `directory`。
    pub async fn create_session(&self, directory: &str, title: &str) -> Result<String, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("http client: {e}"))?;
        let url = format!(
            "{}/session?directory={}",
            self.base_url,
            urlencoding::encode_path(directory)
        );
        let resp = client
            .post(&url)
            .json(&serde_json::json!({ "title": title }))
            .send()
            .await
            .map_err(|e| format!("create session failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "create session status {}: {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        let body: SessionCreateResponse = resp
            .json()
            .await
            .map_err(|e| format!("create session parse: {e}"))?;
        Ok(body.id)
    }

    /// 向会话发送消息(多轮对话:同一 session 累积上下文)。
    pub async fn send_message(&self, session_id: &str, text: &str) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("http client: {e}"))?;
        let url = format!("{}/session/{}/message", self.base_url, session_id);
        let resp = client
            .post(&url)
            .json(&serde_json::json!({ "parts": [{ "type": "text", "text": text }] }))
            .send()
            .await
            .map_err(|e| format!("send message failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "send message status {}: {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(())
    }

    /// 中止会话当前运行的任务。
    pub async fn abort_session(&self, session_id: &str) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("http client: {e}"))?;
        let url = format!("{}/session/{}/abort", self.base_url, session_id);
        let _ = client.post(&url).send().await;
        Ok(())
    }

    /// 拉取一个会话的所有消息(`GET /session/{id}/message`)。
    ///
    /// 返回原始 JSON(opencode 的消息结构,含 info.role + parts[])。
    /// 调用方比对上次拉取的差异,emit 新增的 part。
    pub async fn list_messages(&self, session_id: &str) -> Result<serde_json::Value, String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("http client: {e}"))?;
        let url = format!("{}/session/{}/message", self.base_url, session_id);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("list messages failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("list messages status: {}", resp.status()));
        }
        resp.json()
            .await
            .map_err(|e| format!("list messages parse: {e}"))
    }

    /// 建立 SSE 事件流(`GET /event`)。
    ///
    /// 返回一个 `reqwest::Response`,调用方用 `bytes_stream()` 逐行读取 `data: {...}` 行。
    /// 注意:这是一个长连接,会持续到 server 关闭或调用方 drop。
    pub async fn event_stream(&self) -> Result<reqwest::Response, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|e| format!("http client: {e}"))?;
        let resp = client
            .get(format!("{}/event", self.base_url))
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .send()
            .await
            .map_err(|e| format!("event stream failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("event stream status: {}", resp.status()));
        }
        Ok(resp)
    }

    /// 关闭 server 进程。
    async fn shutdown(&self) {
        self.cancellation.cancel();
        let mut guard = self._child.lock().await;
        if let Some(mut child) = guard.take() {
            // 先尝试 SIGTERM,再 SIGKILL
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
            let _ = child.kill().await;
        }
    }
}

/// 全局共享的 opencode serve 实例(整个 Desktop 生命周期一个)。
static GLOBAL_SERVER: std::sync::OnceLock<Mutex<Option<OpencodeServer>>> =
    std::sync::OnceLock::new();

fn global_mutex() -> &'static Mutex<Option<OpencodeServer>> {
    GLOBAL_SERVER.get_or_init(|| Mutex::new(None))
}

async fn spawn_server() -> Result<OpencodeServer, String> {
    let opencode_bin = discover_opencode_binary()?;
    let port = pick_free_port()?;

    let mut command = Command::new(&opencode_bin);
    command
        .arg("serve")
        .arg("--port")
        .arg(port.to_string())
        .arg("--hostname")
        .arg("127.0.0.1")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    configure_process_group(&mut command);

    let child = command
        .spawn()
        .map_err(|e| format!("Failed to spawn opencode serve: {e}"))?;

    let base_url = format!("http://127.0.0.1:{}", port);
    let cancellation = CancellationToken::new();

    // 等 server ready(轮询 health)
    let server = OpencodeServer {
        base_url: base_url.clone(),
        _child: Arc::new(Mutex::new(Some(child))),
        cancellation,
    };

    let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;
    loop {
        if tokio::time::Instant::now() > deadline {
            server.shutdown().await;
            return Err(format!(
                "opencode serve did not become healthy within {:?} at {base_url}",
                STARTUP_TIMEOUT
            ));
        }
        match server.health().await {
            Ok(()) => return Ok(server),
            Err(_) => tokio::time::sleep(Duration::from_millis(300)).await,
        }
    }
}

/// 探测 opencode 二进制路径。
fn discover_opencode_binary() -> Result<std::path::PathBuf, String> {
    which::which("opencode")
        .map_err(|e| format!("opencode binary not found in PATH: {e}"))
}

/// 选一个空闲端口(从内核分配,避免硬编码)。
fn pick_free_port() -> Result<u16, String> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("pick port: {e}"))?
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| format!("local addr: {e}"))
}

/// URL path 段编码(简化版:处理多字节 UTF-8)。
mod urlencoding {
    pub fn encode_path(s: &str) -> String {
        let mut out = String::new();
        for byte in s.bytes() {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/') {
                out.push(byte as char);
            } else {
                out.push_str(&format!("%{:02X}", byte));
            }
        }
        out
    }
}

/// Desktop 退出时调用,干净关闭 server。
pub async fn shutdown_global() {
    let mut guard = global_mutex().lock().await;
    if let Some(server) = guard.take() {
        server.shutdown().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_port_returns_valid_port() {
        let port = pick_free_port().unwrap();
        assert!(port > 1024 || port == 0);
    }

    #[test]
    fn urlencoding_handles_spaces_and_special() {
        assert_eq!(urlencoding::encode_path("/tmp/hello world"), "/tmp/hello%20world");
        assert_eq!(urlencoding::encode_path("/Users/a/b"), "/Users/a/b");
        assert_eq!(urlencoding::encode_path("/中文"), "/%E4%B8%AD%E6%96%87");
    }
}

#[cfg(test)]
mod poll_e2e {
    use super::*;

    /// 端到端验证轮询链路:create_session → send_message → 轮询 list_messages 直到拿到 assistant text。
    /// cargo test poll_e2e_works -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn poll_e2e_works() {
        let server = OpencodeServer::ensure_started().await.expect("server start");
        let dir = "/tmp/json-smoke";
        std::fs::create_dir_all(dir).unwrap();

        let sid = server.create_session(dir, "poll-e2e").await.expect("create session");
        eprintln!("session: {sid}");

        server
            .send_message(&sid, "说 hi，只回一个字")
            .await
            .expect("send message");

        // 轮询,最多 30 秒
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        let mut got_text = false;
        loop {
            if tokio::time::Instant::now() > deadline {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            let msgs = match server.list_messages(&sid).await {
                Ok(m) => m,
                Err(_) => continue,
            };
            // 扁平化找 assistant text
            let arr = msgs.get("data").and_then(|d| d.as_array()).or_else(|| msgs.as_array());
            if let Some(msgs_arr) = arr {
                for m in msgs_arr {
                    let role = m.get("info").and_then(|i| i.get("role")).and_then(|r| r.as_str())
                        .or_else(|| m.get("role").and_then(|r| r.as_str()))
                        .unwrap_or("");
                    if role == "assistant" {
                        if let Some(parts) = m.get("parts").and_then(|p| p.as_array()) {
                            for p in parts {
                                if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    let text = p.get("text").and_then(|t| t.as_str()).unwrap_or("");
                                    eprintln!("✓ assistant text: {text}");
                                    got_text = true;
                                }
                            }
                        }
                    }
                }
            }
            if got_text {
                break;
            }
        }
        assert!(got_text, "should get assistant text via polling");
        eprintln!("POLL E2E PASS");
    }
}
