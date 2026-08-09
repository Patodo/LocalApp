//! Studio agent 编排:把用户需求 → 接入 coding agent → 流式事件。
//!
//! 两种路径:
//! - **opencode**(默认/推荐):走 HTTP+SSE(`opencode serve`),支持多轮对话、
//!   token 级流式、工具调用事件、abort。用 `send_studio_message` 继续对话。
//! - **其他 agent**(claude/codex/zcode):走一次性 stdio(兼容保留)。

use crate::AppState;
use crate::agent::opencode_server::OpencodeServer;
use crate::agent::session::{AgentSession, AgentSessionStatus};
use crate::agent::spawn::{AgentCli, AgentRequest};
use crate::agent::AgentSessionRegistry;
use crate::runner::protocol::LogStream;
use crate::studio_projects::StudioProjectRepository;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// 启动 agent 会话的结果(返回 session_id 给前端订阅事件)。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedAgentSession {
    pub session_id: String,
    pub app_id: String,
    pub agent_kind: String,
    pub status: AgentSessionStatus,
    /// 是否支持多轮对话(前端据此决定是否常驻输入框)。
    pub supports_continuation: bool,
}

/// 探测到的 agent 摘要(给前端选择器用)。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableAgent {
    pub kind: String,
    pub binary: String,
    pub is_default: bool,
}

/// 列出系统里所有已装的 agent CLI,供前端选择。
#[tauri::command]
pub(crate) fn list_available_agents() -> Vec<AvailableAgent> {
    AgentCli::discover_all()
        .into_iter()
        .enumerate()
        .map(|(index, agent)| AvailableAgent {
            kind: agent.kind,
            binary: agent.binary.to_string_lossy().to_string(),
            is_default: index == 0,
        })
        .collect()
}

/// 启动一个 Studio agent 会话。
///
/// opencode 走 HTTP+SSE(支持后续 send_studio_message 多轮对话);
/// 其他 agent 走一次性 stdio。
#[tauri::command]
pub(crate) async fn run_studio_agent(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    app_id: String,
    prompt: String,
    agent_kind: Option<String>,
) -> Result<StartedAgentSession, String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err("Prompt must not be empty".into());
    }
    let discovered = AgentCli::resolve(agent_kind.as_deref())?;
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    let project = repo
        .find(&app_id)?
        .ok_or_else(|| format!("Studio project not found: {app_id}"))?;
    if !project.present_on_disk {
        return Err(format!(
            "Project source directory is missing: {}",
            project.source_path.display()
        ));
    }
    if state.agent_sessions.is_app_busy(&app_id).await {
        return Err(format!(
            "Another session is running for {app_id}. Cancel it first."
        ));
    }

    let session_id = format!("agent-{}", Uuid::new_v4());
    let cancellation = CancellationToken::new();
    let tasks_root = state.local_store.paths().tasks();
    let session_dir = tasks_root.join(&session_id);
    std::fs::create_dir_all(&session_dir)
        .map_err(|e| format!("session dir: {e}"))?;
    let stdout_path = session_dir.join("stdout.log");

    // opencode 路径
    if discovered.kind == "opencode" {
        return run_opencode_session(
            app_handle, state, app_id, session_id, trimmed.to_string(), stdout_path,
            project.source_path.to_string_lossy().to_string(),
            cancellation, &discovered.kind,
        )
        .await;
    }

    // stdio 路径(claude/codex/zcode)—— 保留旧行为
    run_stdio_session(
        app_handle, state, app_id, session_id, trimmed.to_string(), stdout_path,
        project.source_path, discovered, cancellation,
    )
    .await
}

/// 向一个 opencode 会话发送后续消息(多轮对话)。
///
/// 仅对 opencode 会话有效;stdio agent 返回错误。
#[tauri::command]
pub(crate) async fn send_studio_message(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    let trimmed = prompt.trim().to_string();
    if trimmed.is_empty() {
        return Err("Prompt must not be empty".into());
    }
    let session = state
        .agent_sessions
        .get(&session_id)
        .await
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    let oc_session_id = session
        .opencode_session_id
        .clone()
        .ok_or_else(|| "This session does not support continuation (opencode only)".to_string())?;
    if session.status != AgentSessionStatus::Running && session.status != AgentSessionStatus::Pending {
        return Err(format!("Session is {}, cannot send message", serde_json::to_string(&session.status).unwrap_or_default()));
    }

    // 标记 busy
    state
        .agent_sessions
        .update(&session_id, |s| {
            s.status = AgentSessionStatus::Running;
        })
        .await;

    let app_handle_for_task = app_handle.clone();
    let session_id_clone = session_id.clone();
    let oc_session_id_clone = oc_session_id.clone();
    let registry_for_task = state.agent_sessions.clone();
    // 为本轮轮询创建新的 cancellation(存入 registry 替换旧的)
    let cancellation = CancellationToken::new();
    state
        .agent_sessions
        .set_cancellation(&session_id, cancellation.clone())
        .await;
    let cancellation_for_task = cancellation.clone();
    tokio::spawn(async move {
        let server = match OpencodeServer::ensure_started().await {
            Ok(s) => s,
            Err(e) => {
                emit_session_error(&app_handle_for_task, &session_id_clone, &e);
                return;
            }
        };
        if let Err(e) = server.send_message(&oc_session_id_clone, &trimmed).await {
            emit_session_error(&app_handle_for_task, &session_id_clone, &e);
            return;
        }
        // 重新启动轮询 listener(上一轮的已退出)
        listen_opencode_sse(
            app_handle_for_task,
            registry_for_task,
            server,
            session_id_clone,
            oc_session_id_clone,
            cancellation_for_task,
        )
        .await;
    });
    Ok(())
}

/// 取消一个 agent 会话。
#[tauri::command]
pub(crate) async fn cancel_studio_agent(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    // opencode 会话:先调 server abort
    if let Some(session) = state.agent_sessions.get(&session_id).await {
        if let Some(oc_id) = &session.opencode_session_id {
            if let Ok(server) = OpencodeServer::ensure_started().await {
                let _ = server.abort_session(oc_id).await;
            }
        }
    }
    state.agent_sessions.cancel(&session_id).await
}

#[tauri::command]
pub(crate) async fn list_studio_agents(
    state: State<'_, AppState>,
) -> Result<Vec<AgentSession>, String> {
    Ok(state.agent_sessions.list().await)
}

#[tauri::command]
pub(crate) fn read_studio_agent_logs(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<AgentSessionLogs, String> {
    let session = state.agent_sessions.sessions_snapshot(&session_id)?;
    Ok(AgentSessionLogs {
        session_id,
        stdout: read_log_tail(&session.stdout_path),
        stderr: session
            .stderr_path
            .as_ref()
            .map(|p| read_log_tail(p))
            .unwrap_or_default(),
    })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionLogs {
    pub session_id: String,
    pub stdout: String,
    pub stderr: String,
}

// ── opencode 路径 ──

#[allow(clippy::too_many_arguments)]
async fn run_opencode_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    app_id: String,
    session_id: String,
    prompt: String,
    stdout_path: PathBuf,
    project_directory: String,
    cancellation: CancellationToken,
    agent_kind: &str,
) -> Result<StartedAgentSession, String> {
    // 1. 确保 server 运行
    let server = OpencodeServer::ensure_started().await?;

    // 2. 创建 opencode session(directory = 项目源码目录)
    let oc_session_id = server
        .create_session(&project_directory, &format!("Studio · {app_id}"))
        .await?;

    // 3. 注册会话
    let now = now_millis();
    let session = AgentSession {
        id: session_id.clone(),
        app_id: app_id.clone(),
        agent_kind: agent_kind.to_string(),
        status: AgentSessionStatus::Pending,
        started_at: now,
        completed_at: None,
        exit_code: None,
        error: None,
        stdout_path: stdout_path.clone(),
        stderr_path: None,
        opencode_session_id: Some(oc_session_id.clone()),
    };
    state
        .agent_sessions
        .register(session_id.clone(), session, cancellation.clone())
        .await;

    // 4. 启动 SSE 监听任务(在后台过滤属于本会话的事件,emit 给前端)
    let app_for_sse = app_handle.clone();
    let oc_session_id_for_sse = oc_session_id.clone();
    let session_id_for_sse = session_id.clone();
    let registry_for_sse = state.agent_sessions.clone();
    let cancellation_for_sse = cancellation.clone();
    let server_for_sse = server.clone();
    tokio::spawn(async move {
        listen_opencode_sse(
            app_for_sse,
            registry_for_sse,
            server_for_sse,
            session_id_for_sse,
            oc_session_id_for_sse,
            cancellation_for_sse,
        )
        .await;
    });

    // 5. 发送第一条消息(触发 agent 运行)
    let full_prompt = compose_prompt(&prompt, agent_kind);
    if let Err(e) = server.send_message(&oc_session_id, &full_prompt).await {
        // 发送失败,标记会话失败
        state
            .agent_sessions
            .update(&session_id, |s| {
                s.status = AgentSessionStatus::Failed;
                s.error = Some(e.clone());
                s.completed_at = Some(now_millis());
            })
            .await;
        return Err(e);
    }

    Ok(StartedAgentSession {
        session_id,
        app_id,
        agent_kind: agent_kind.to_string(),
        status: AgentSessionStatus::Pending,
        supports_continuation: true,
    })
}

/// 监听 opencode SSE 事件流,过滤本会话事件,emit 给前端 + 更新会话状态。
/// 轮询 opencode 会话状态(每 1.5 秒拉一次 message list)。
///
/// 用轮询替代 SSE 全局流:更可靠、更简单、不依赖时序。
/// 每次拉取后比对上次的消息 part 数,emit 新增的 text/tool part 给前端。
async fn listen_opencode_sse(
    app: AppHandle,
    registry: std::sync::Arc<AgentSessionRegistry>,
    server: OpencodeServer,
    session_id: String,
    oc_session_id: String,
    cancellation: CancellationToken,
) {
    registry
        .update(&session_id, |s| {
            s.status = AgentSessionStatus::Running;
        })
        .await;
    let _ = app.emit(
        "desktop://agent-updated",
        serde_json::json!({ "sessionId": session_id, "status": "running" }),
    );

    let mut last_part_count: usize = 0;

    loop {
        tokio::select! {
            _ = cancellation.cancelled() => break,
            _ = tokio::time::sleep(std::time::Duration::from_millis(1500)) => {}
        }
        if cancellation.is_cancelled() {
            break;
        }

        let messages = match server.list_messages(&oc_session_id).await {
            Ok(m) => m,
            Err(_) => continue,
        };

        let all_parts = flatten_parts(&messages);
        let total = all_parts.len();

        if total > last_part_count {
            for part in &all_parts[last_part_count..] {
                emit_part(&app, &session_id, part);
            }
            last_part_count = total;
        }

        // 判断当前轮是否完成:最后有 step-finish part
        if let Some(last) = all_parts.last() {
            if part_type_is(last, "step-finish") {
                let reason = last.get("reason").and_then(|r| r.as_str()).unwrap_or("");
                if reason == "stop" {
                    emit_agent_log(&app, &session_id, LogStream::Stdout, "\n[完成]\n");
                    break;
                }
            }
        }
    }

    let final_status = if cancellation.is_cancelled() {
        AgentSessionStatus::Cancelled
    } else {
        AgentSessionStatus::Completed
    };
    registry
        .update(&session_id, |s| {
            s.status = final_status.clone();
            s.completed_at = Some(now_millis());
        })
        .await;
    let _ = app.emit(
        "desktop://agent-updated",
        serde_json::json!({ "sessionId": session_id, "status": serde_json::to_string(&final_status).unwrap_or_default() }),
    );
}

/// 把 message list 响应扁平化成 part 引用数组。
fn flatten_parts(messages: &serde_json::Value) -> Vec<&serde_json::Value> {
    let arr = messages
        .get("data")
        .and_then(|d| d.as_array())
        .or_else(|| messages.as_array());
    let mut out = Vec::new();
    if let Some(msgs) = arr {
        for msg in msgs {
            if let Some(parts) = msg.get("parts").and_then(|p| p.as_array()) {
                for part in parts {
                    out.push(part);
                }
            }
        }
    }
    out
}

fn part_type_is(part: &serde_json::Value, expected: &str) -> bool {
    part.get("type")
        .and_then(|t| t.as_str())
        .is_some_and(|t| t == expected)
}

/// 把单个 opencode part emit 给前端。
fn emit_part(app: &AppHandle, session_id: &str, part: &serde_json::Value) {
    let part_type = part.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match part_type {
        "text" => {
            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                emit_agent_log(app, session_id, LogStream::Stdout, text);
                emit_agent_log(app, session_id, LogStream::Stdout, "\n");
            }
        }
        "tool" => {
            let tool = part.get("tool").and_then(|t| t.as_str()).unwrap_or("tool");
            let title = part.get("state").and_then(|s| s.get("title")).and_then(|t| t.as_str()).unwrap_or("");
            let status = part.get("state").and_then(|s| s.get("status")).and_then(|t| t.as_str()).unwrap_or("");
            let icon = match status { "completed" => "✓", "running" => "▸", _ => "•" };
            emit_agent_log(app, session_id, LogStream::Stdout, &format!("{icon} {tool}: {title} [{status}]\n"));
        }
        "step-start" => {
            emit_agent_log(app, session_id, LogStream::Stdout, "\n");
        }
        _ => {}
    }
}


fn emit_agent_log(app: &AppHandle, session_id: &str, stream: LogStream, message: &str) {
    let stream_str = match stream {
        LogStream::Stdout => "stdout",
        LogStream::Stderr => "stderr",
    };
    let _ = app.emit(
        "desktop://agent-log",
        serde_json::json!({
            "sessionId": session_id,
            "stream": stream_str,
            "message": message,
            "truncated": false,
        }),
    );
}

fn emit_session_error(app: &AppHandle, session_id: &str, error: &str) {
    emit_agent_log(app, session_id, LogStream::Stderr, error);
    let _ = app.emit(
        "desktop://agent-error",
        serde_json::json!({ "sessionId": session_id, "error": error }),
    );
}

// ── stdio 路径(claude/codex/zcode,保留兼容)──

#[allow(clippy::too_many_arguments)]
async fn run_stdio_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    app_id: String,
    session_id: String,
    prompt: String,
    stdout_path: PathBuf,
    source_path: std::path::PathBuf,
    discovered: crate::agent::spawn::DiscoveredAgent,
    cancellation: CancellationToken,
) -> Result<StartedAgentSession, String> {
    let full_prompt = compose_prompt(&prompt, &discovered.kind);
    let now = now_millis();
    let session = AgentSession {
        id: session_id.clone(),
        app_id: app_id.clone(),
        agent_kind: discovered.kind.clone(),
        status: AgentSessionStatus::Pending,
        started_at: now,
        completed_at: None,
        exit_code: None,
        error: None,
        stdout_path: stdout_path.clone(),
        stderr_path: None,
        opencode_session_id: None,
    };
    state
        .agent_sessions
        .register(session_id.clone(), session, cancellation.clone())
        .await;

    let request = AgentRequest {
        binary: discovered.binary.clone(),
        args: discovered.default_args.clone(),
        cwd: source_path,
        prompt: full_prompt,
        prompt_mode: discovered.prompt_mode,
        env: BTreeMap::new(),
    };
    let registry = state.agent_sessions.clone();
    let kind = discovered.kind.clone();
    let stderr_path = stdout_path.with_file_name("stderr.log");
    let session_id_for_task = session_id.clone();
    let app_id_for_task = app_id.clone();

    tokio::spawn(async move {
        crate::agent::session::run_agent_session(
            app_handle,
            registry,
            session_id_for_task,
            request,
            kind,
            app_id_for_task,
            cancellation,
            stdout_path,
            stderr_path,
        )
        .await;
    });

    Ok(StartedAgentSession {
        session_id,
        app_id,
        agent_kind: discovered.kind,
        status: AgentSessionStatus::Pending,
        supports_continuation: false,
    })
}

// ── 工具函数 ──

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

const MAX_UI_LOG_BYTES: usize = 256 * 1024;

fn read_log_tail(path: &std::path::Path) -> String {
    match std::fs::read(path) {
        Ok(bytes) => {
            if bytes.len() <= MAX_UI_LOG_BYTES {
                String::from_utf8_lossy(&bytes).to_string()
            } else {
                let start = bytes.len() - MAX_UI_LOG_BYTES;
                String::from_utf8_lossy(&bytes[start..]).to_string()
            }
        }
        Err(_) => String::new(),
    }
}

/// 组装首条 prompt:平台契约上下文 + 用户需求。
///
/// opencode 读 AGENTS.md、claude 读 .claude/skills,这里只强化 Studio 约束。
fn compose_prompt(user_prompt: &str, agent_kind: &str) -> String {
    let guide_ref = if agent_kind == "claude" {
        ".claude/skills/*/SKILL.md"
    } else {
        "AGENTS.md and .claude/skills/*/SKILL.md"
    };
    format!(
        "You are working inside a LocalApp Studio project.\n\n\
         IMPORTANT — read {guide_ref} first: it describes the platform contract \
         (manifest.json, schema, backend named SQL, SDK hooks, UI).\n\n\
         Studio rules (OVERRIDE the guide's build commands):\n\
         1. ONLY edit files (src/, backend/, migrations/, manifest.json).\n\
         2. Do NOT run localapp/npm build/install/upload — user does that via Studio UI.\n\
         3. Do NOT modify .localapp/runtime/ or .claude/skills/.\n\
         4. Summarize files changed when done.\n\n---\n\n{user_prompt}"
    )
}
