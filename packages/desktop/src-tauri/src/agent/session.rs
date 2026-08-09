//! Agent 会话管理：注册表 + 生命周期 + 流式日志读取。

use crate::agent::spawn::{AgentRequest, SpawnedAgent, write_prompt_and_close};
use crate::runner::process::LogEvent;
use crate::runner::protocol::LogStream;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// 单条 stdout/stderr 读取缓冲。
const READ_BUFFER_BYTES: usize = 16 * 1024;
/// agent 默认超时（30 分钟）。
const DEFAULT_AGENT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Agent 会话状态。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentSessionStatus {
    /// 已创建但尚未 spawn。
    Pending,
    /// 进程运行中。
    Running,
    /// 正常退出（exit code 0）。
    Completed,
    /// 异常退出（非 0 exit code）。
    Failed,
    /// 被用户取消。
    Cancelled,
    /// 超时。
    TimedOut,
}

/// 一个 agent 会话的元数据快照（序列化给前端）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub app_id: String,
    pub agent_kind: String,
    pub status: AgentSessionStatus,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    /// stdout 日志文件路径(前端通过 read_studio_agent_logs 拉取全量)。
    pub stdout_path: PathBuf,
    /// stderr 日志文件路径(仅 stdio agent 有;opencode 不用)。
    pub stderr_path: Option<PathBuf>,
    /// opencode 会话 ID(仅 opencode agent 有效,用于多轮对话)。
    /// 其他 agent(stdio 一次性)为 None。
    pub opencode_session_id: Option<String>,
}

/// Agent 会话注册表（线程安全）。
#[derive(Default)]
pub struct AgentSessionRegistry {
    sessions: Mutex<BTreeMap<String, AgentSession>>,
    cancellation_tokens: Mutex<BTreeMap<String, CancellationToken>>,
}

impl AgentSessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 注册一个新会话，返回它的 cancellation token（调用方持有，用于执行循环监听取消）。
    pub async fn register(
        &self,
        id: String,
        session: AgentSession,
        cancellation: CancellationToken,
    ) {
        self.sessions.lock().await.insert(id.clone(), session);
        self.cancellation_tokens
            .lock()
            .await
            .insert(id, cancellation);
    }

    /// 更新会话状态。
    pub async fn update(&self, id: &str, mut update_fn: impl FnMut(&mut AgentSession)) {
        if let Some(session) = self.sessions.lock().await.get_mut(id) {
            update_fn(session);
        }
    }

    /// 获取会话快照。
    pub async fn get(&self, id: &str) -> Option<AgentSession> {
        self.sessions.lock().await.get(id).cloned()
    }

    /// 列出所有会话。
    pub async fn list(&self) -> Vec<AgentSession> {
        self.sessions.lock().await.values().cloned().collect()
    }

    /// 取消一个会话（发 cancel 信号；实际终止由执行循环的 terminate_and_reap 完成）。
    pub async fn cancel(&self, id: &str) -> Result<(), String> {
        let token = self
            .cancellation_tokens
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| format!("Agent session not found: {id}"))?;
        token.cancel();
        Ok(())
    }

    /// 会话结束后清理其 cancellation token（保留 session 记录供历史查看）。
    pub async fn finish(&self, id: &str) {
        self.cancellation_tokens.lock().await.remove(id);
    }

    /// 替换某会话的 cancellation token（用于多轮对话重启 listener）。
    pub async fn set_cancellation(&self, id: &str, token: CancellationToken) {
        self.cancellation_tokens.lock().await.insert(id.to_string(), token);
    }

    /// 检查某 app_id 是否已有运行中的会话（用于 MVP 的串行约束）。
    pub async fn is_app_busy(&self, app_id: &str) -> bool {
        self.sessions
            .lock()
            .await
            .values()
            .any(|s| s.app_id == app_id && s.status == AgentSessionStatus::Running)
    }

    /// 同步获取会话快照（用 try_lock，失败返回错误）。
    /// 给同步 Tauri command（如 read_studio_agent_logs）用。
    pub fn sessions_snapshot(&self, id: &str) -> Result<AgentSession, String> {
        self.sessions
            .try_lock()
            .map_err(|_| "Agent session registry is busy".to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| format!("Agent session not found: {id}"))
    }
}

/// 执行一次 agent 会话。
///
/// 这是核心执行循环：spawn → 写 prompt → 并发读 stdout/stderr → 监听取消/超时 → 等退出。
/// 所有日志通过 `app.emit("desktop://agent-log", ...)` 流式推给前端，
/// 同时追加到 stdout.log/stderr.log 文件。
///
/// 调用方需先在 registry.register() 注册会话并拿到 cancellation token，
/// 然后传入此函数执行。
pub async fn run_agent_session(
    app: AppHandle,
    registry: Arc<AgentSessionRegistry>,
    session_id: String,
    request: AgentRequest,
    agent_kind: String,
    app_id: String,
    cancellation: CancellationToken,
    stdout_path: PathBuf,
    stderr_path: PathBuf,
) {
    // 标记 Running
    registry
        .update(&session_id, |s| {
            s.status = AgentSessionStatus::Running;
        })
        .await;

    let outcome = run_agent_session_inner(
        app.clone(),
        &session_id,
        request,
        cancellation,
        &stdout_path,
        &stderr_path,
    )
    .await;

    // 更新会话终态
    let now = now_millis();
    registry
        .update(&session_id, |s| {
            s.completed_at = Some(now);
            match &outcome {
                AgentRunOutcome::Completed(code) => {
                    s.exit_code = *code;
                    s.status = if code.unwrap_or(1) == 0 {
                        AgentSessionStatus::Completed
                    } else {
                        AgentSessionStatus::Failed
                    };
                }
                AgentRunOutcome::Failed(error) => {
                    s.status = AgentSessionStatus::Failed;
                    s.error = Some(error.clone());
                }
                AgentRunOutcome::Cancelled => {
                    s.status = AgentSessionStatus::Cancelled;
                }
                AgentRunOutcome::TimedOut => {
                    s.status = AgentSessionStatus::TimedOut;
                }
            }
        })
        .await;
    registry.finish(&session_id).await;

    // 推送会话结束事件（前端据此停止 spinner 等）
    let _ = app.emit(
        "desktop://agent-updated",
        serde_json::json!({
            "sessionId": session_id,
            "appId": app_id,
            "agentKind": agent_kind,
        }),
    );
}

enum AgentRunOutcome {
    Completed(Option<i32>),
    Failed(String),
    Cancelled,
    TimedOut,
}

async fn run_agent_session_inner(
    app: AppHandle,
    session_id: &str,
    mut request: AgentRequest,
    cancellation: CancellationToken,
    stdout_path: &std::path::Path,
    stderr_path: &std::path::Path,
) -> AgentRunOutcome {
    // 根据 prompt_mode 准备 prompt：Stdin 模式保持原样（spawn 后写）；
    // Arg 模式把 prompt 追加到 args。
    let prompt_mode = request.prompt_mode;
    let prompt = request.prompt.clone();
    if matches!(prompt_mode, crate::agent::spawn::PromptMode::Arg) {
        request.args.push(prompt.clone());
    }

    let SpawnedAgent {
        mut child,
        process_tree,
        mut stdin,
    } = match request.spawn(cancellation.clone()) {
        Ok(spawned) => spawned,
        Err(error) => return AgentRunOutcome::Failed(error),
    };

    // 仅 Stdin 模式需要写 prompt；Arg 模式的 stdin 是 null（None）
    if matches!(prompt_mode, crate::agent::spawn::PromptMode::Stdin) {
        if let Err(error) = write_prompt_and_close(&mut stdin, &prompt).await {
            let _ = process_tree.terminate_and_reap(&mut child).await;
            return AgentRunOutcome::Failed(error);
        }
    }

    // 打开日志文件
    if let Some(parent) = stdout_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut stdout_file = match tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(stdout_path)
        .await
    {
        Ok(f) => f,
        Err(e) => {
            let _ = process_tree.terminate_and_reap(&mut child).await;
            return AgentRunOutcome::Failed(format!("Failed to open stdout log: {e}"));
        }
    };
    let mut stderr_file = match tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(stderr_path)
        .await
    {
        Ok(f) => f,
        Err(e) => {
            let _ = process_tree.terminate_and_reap(&mut child).await;
            return AgentRunOutcome::Failed(format!("Failed to open stderr log: {e}"));
        }
    };

    let mut child_stdout = child.stdout.take();
    let mut child_stderr = child.stderr.take();

    // 并发：读 stdout + 读 stderr + 监听取消/超时
    let stdout_session_id = session_id.to_string();
    let stderr_session_id = session_id.to_string();
    let stdout_app = app.clone();
    let stderr_app = app.clone();

    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = child_stdout.as_mut() {
            let mut buffer = vec![0u8; READ_BUFFER_BYTES];
            loop {
                match stdout.read(&mut buffer).await {
                    Ok(0) => break,
                    Ok(read) => {
                        let bytes = &buffer[..read];
                        let _ = stdout_file.write_all(bytes).await;
                        // 按 UTF-8 行/块推送给前端（复用 bounded_log_event 截断）
                        let text = String::from_utf8_lossy(bytes).to_string();
                        let event = crate::runner::process::bounded_log_event(
                            &stdout_session_id,
                            LogStream::Stdout,
                            &text,
                        );
                        emit_agent_log(&stdout_app, &event);
                    }
                    Err(_) => break,
                }
            }
        }
    });
    let stderr_task = tokio::spawn(async move {
        if let Some(stderr) = child_stderr.as_mut() {
            let mut buffer = vec![0u8; READ_BUFFER_BYTES];
            loop {
                match stderr.read(&mut buffer).await {
                    Ok(0) => break,
                    Ok(read) => {
                        let bytes = &buffer[..read];
                        let _ = stderr_file.write_all(bytes).await;
                        let text = String::from_utf8_lossy(bytes).to_string();
                        let event = crate::runner::process::bounded_log_event(
                            &stderr_session_id,
                            LogStream::Stderr,
                            &text,
                        );
                        emit_agent_log(&stderr_app, &event);
                    }
                    Err(_) => break,
                }
            }
        }
    });

    // 等子进程退出，或取消/超时
    let timeout = tokio::time::sleep(DEFAULT_AGENT_TIMEOUT);
    tokio::pin!(timeout);

    tokio::select! {
        // 取消信号
        _ = cancellation.cancelled() => {
            let _ = process_tree.terminate_and_reap(&mut child).await;
            // 等日志任务结束
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            AgentRunOutcome::Cancelled
        }
        // 超时
        _ = &mut timeout => {
            let _ = process_tree.terminate_and_reap(&mut child).await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            AgentRunOutcome::TimedOut
        }
        // 子进程自然退出
        status = child.wait() => {
            // 等日志 drain 完（子进程退出后管道 EOF）
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            match status {
                Ok(status) => AgentRunOutcome::Completed(status.code()),
                Err(e) => AgentRunOutcome::Failed(format!("Agent process wait failed: {e}")),
            }
        }
    }
}

fn emit_agent_log(app: &AppHandle, event: &LogEvent) {
    let stream = match event.stream {
        LogStream::Stdout => "stdout",
        LogStream::Stderr => "stderr",
    };
    let _ = app.emit(
        "desktop://agent-log",
        serde_json::json!({
            "sessionId": event.task_id,
            "stream": stream,
            "message": event.message,
            "truncated": event.truncated,
        }),
    );
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_status_serializes_as_camel_case() {
        let json = serde_json::to_string(&AgentSessionStatus::Running).unwrap();
        assert_eq!(json, "\"running\"");
        let json = serde_json::to_string(&AgentSessionStatus::TimedOut).unwrap();
        assert_eq!(json, "\"timedOut\"");
    }

    #[tokio::test]
    async fn registry_register_and_list() {
        let registry = AgentSessionRegistry::new();
        let id = "sess-1".to_string();
        let session = AgentSession {
            id: id.clone(),
            app_id: "app-1".to_string(),
            agent_kind: "claude".to_string(),
            status: AgentSessionStatus::Pending,
            started_at: 0,
            completed_at: None,
            exit_code: None,
            error: None,
            stdout_path: PathBuf::from("/tmp/out.log"),
            stderr_path: Some(PathBuf::from("/tmp/err.log")),
            opencode_session_id: None,
        };
        let token = CancellationToken::new();
        registry.register(id.clone(), session, token).await;

        let list = registry.list().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "sess-1");
    }

    #[tokio::test]
    async fn registry_is_app_busy_detects_running() {
        let registry = AgentSessionRegistry::new();
        let id = "sess-1".to_string();
        let session = AgentSession {
            id: id.clone(),
            app_id: "app-1".to_string(),
            agent_kind: "claude".to_string(),
            status: AgentSessionStatus::Running,
            started_at: 0,
            completed_at: None,
            exit_code: None,
            error: None,
            stdout_path: PathBuf::from("/tmp/out.log"),
            stderr_path: Some(PathBuf::from("/tmp/err.log")),
            opencode_session_id: None,
        };
        registry
            .register(id, session, CancellationToken::new())
            .await;
        assert!(registry.is_app_busy("app-1").await);
        assert!(!registry.is_app_busy("app-2").await);
    }

    #[tokio::test]
    async fn registry_cancel_finishes_token() {
        let registry = AgentSessionRegistry::new();
        let id = "sess-1".to_string();
        let session = AgentSession {
            id: id.clone(),
            app_id: "app-1".to_string(),
            agent_kind: "claude".to_string(),
            status: AgentSessionStatus::Running,
            started_at: 0,
            completed_at: None,
            exit_code: None,
            error: None,
            stdout_path: PathBuf::from("/tmp/out.log"),
            stderr_path: Some(PathBuf::from("/tmp/err.log")),
            opencode_session_id: None,
        };
        let token = CancellationToken::new();
        registry.register(id.clone(), session, token).await;
        registry.cancel(&id).await.unwrap();
        registry.finish(&id).await;
        // finish 后再 cancel 应报 not found
        assert!(registry.cancel(&id).await.is_err());
    }
}
