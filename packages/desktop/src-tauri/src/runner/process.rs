use super::protocol::{
    FrameDecoder, HostMessage, LogStream, ProtocolError, RunnerMessage, encode_frame,
};
use crate::process_util::{ProcessTree, configure_process_group};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const PROTOCOL_VERSION: u32 = 1;
const READ_BUFFER_BYTES: usize = 16 * 1024;
const CANCEL_GRACE: Duration = Duration::from_secs(2);
pub const MAX_CALLBACK_MESSAGE_BYTES: usize = 16 * 1024;
pub const MAX_ERROR_MESSAGE_BYTES: usize = 64 * 1024;

#[derive(Clone)]
pub struct ExecutionRequest {
    pub node_executable: PathBuf,
    pub runner_script: PathBuf,
    pub task_id: String,
    pub script: String,
    pub input: Value,
    pub context: Value,
    pub environment_path: PathBuf,
    pub working_directory: PathBuf,
    pub stdout_path: PathBuf,
    pub stderr_path: PathBuf,
    pub timeout: Duration,
    pub cancellation: CancellationToken,
    pub child_env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureClassification {
    Dependency,
    Run,
    Serialization,
    Timeout,
    Cancelled,
    Protocol,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ExecutionOutcome {
    Completed {
        result: Value,
    },
    Failed {
        classification: FailureClassification,
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogEvent {
    pub task_id: String,
    pub stream: LogStream,
    pub message: String,
    pub truncated: bool,
}

pub type LogCallback = Arc<dyn Fn(LogEvent) + Send + Sync>;

enum ChildOutput {
    Frames(Vec<Value>),
    RawStderr(Vec<u8>),
    StdoutEof,
    IoError(String),
    ProtocolError(ProtocolError),
}

#[derive(Clone, Copy)]
enum ShutdownReason {
    Timeout,
    Cancelled,
}

impl ShutdownReason {
    fn outcome(self) -> ExecutionOutcome {
        match self {
            Self::Timeout => failed(
                FailureClassification::Timeout,
                "execution_timeout",
                "Execution timed out",
            ),
            Self::Cancelled => failed(
                FailureClassification::Cancelled,
                "execution_cancelled",
                "Execution cancelled",
            ),
        }
    }
}

pub async fn run(request: ExecutionRequest, on_log: LogCallback) -> ExecutionOutcome {
    match run_inner(&request, &on_log).await {
        Ok(outcome) => outcome,
        Err(outcome) => outcome,
    }
}

async fn run_inner(
    request: &ExecutionRequest,
    on_log: &LogCallback,
) -> Result<ExecutionOutcome, ExecutionOutcome> {
    if !request.node_executable.is_absolute() || !request.runner_script.is_absolute() {
        return Err(interrupted_message(
            "invalid_execution_path",
            "Node executable and runner paths must be absolute",
        ));
    }
    let mut stdout_file = create_log(&request.stdout_path).await?;
    let mut stderr_file = create_log(&request.stderr_path).await?;
    let start = encode_frame(&HostMessage::Start {
        task_id: request.task_id.clone(),
        script: request.script.clone(),
        input: request.input.clone(),
        context: request.context.clone(),
        environment_path: request.environment_path.to_string_lossy().into_owned(),
    })
    .map_err(protocol_outcome)?;

    let mut command = Command::new(&request.node_executable);
    command
        .arg(&request.runner_script)
        .current_dir(&request.working_directory)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    configure_environment(&mut command, &request.child_env);
    configure_process_group(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| interrupted("runner_spawn_failed", error))?;
    let process_tree = match ProcessTree::attach(&child) {
        Ok(process_tree) => process_tree,
        Err(error) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(interrupted("process_tree_setup_failed", error));
        }
    };
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| interrupted_message("runner_stdio_failed", "runner stdin unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| interrupted_message("runner_stdio_failed", "runner stdout unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| interrupted_message("runner_stdio_failed", "runner stderr unavailable"))?;

    let (sender, mut receiver) = mpsc::channel(16);
    let stdout_reader = tokio::spawn(read_protocol(stdout, sender.clone()));
    let stderr_reader = tokio::spawn(read_stderr(stderr, sender));
    let timeout = tokio::time::sleep(request.timeout);
    tokio::pin!(timeout);
    let mut started = false;
    let mut shutdown: Option<(ShutdownReason, std::pin::Pin<Box<tokio::time::Sleep>>)> = None;

    let outcome = loop {
        tokio::select! {
            _ = request.cancellation.cancelled(), if shutdown.is_none() => {
                let reason = ShutdownReason::Cancelled;
                send_cancel(&mut stdin, &request.task_id).await;
                shutdown = Some((reason, Box::pin(tokio::time::sleep(CANCEL_GRACE))));
            }
            _ = &mut timeout, if shutdown.is_none() => {
                let reason = ShutdownReason::Timeout;
                send_cancel(&mut stdin, &request.task_id).await;
                shutdown = Some((reason, Box::pin(tokio::time::sleep(CANCEL_GRACE))));
            }
            _ = async {
                shutdown.as_mut().expect("guarded shutdown timer").1.as_mut().await;
            }, if shutdown.is_some() => {
                break shutdown.as_ref().expect("guarded shutdown reason").0.outcome();
            }
            output = receiver.recv() => {
                let Some(output) = output else {
                    break failed(FailureClassification::Interrupted, "runner_output_closed", "Runner output closed before completion");
                };
                match output {
                    ChildOutput::Frames(frames) => {
                        let mut terminal = None;
                        for value in frames {
                            let message: RunnerMessage = match serde_json::from_value(value) {
                                Ok(message) => message,
                                Err(_) => {
                                    terminal = Some(protocol_failure("protocol_malformed_frame", "Malformed runner message"));
                                    break;
                                }
                            };
                            match message {
                                RunnerMessage::Ready { protocol_version } if !started && protocol_version == PROTOCOL_VERSION => {
                                    if shutdown.is_none() {
                                        if let Err(error) = stdin.write_all(&start).await {
                                            terminal = Some(interrupted("runner_start_failed", error));
                                            break;
                                        }
                                        started = true;
                                    }
                                }
                                RunnerMessage::Ready { .. } => {
                                    terminal = Some(protocol_failure("protocol_invalid_ready", "Invalid runner ready message"));
                                    break;
                                }
                                RunnerMessage::Log { task_id, stream, message } if started => {
                                    if task_id != request.task_id {
                                        terminal = Some(task_id_failure());
                                        break;
                                    }
                                    let file = match stream {
                                        LogStream::Stdout => &mut stdout_file,
                                        LogStream::Stderr => &mut stderr_file,
                                    };
                                    if let Err(error) = file.write_all(message.as_bytes()).await {
                                        terminal = Some(interrupted("log_write_failed", error));
                                        break;
                                    }
                                    on_log(bounded_log_event(&request.task_id, stream, &message));
                                }
                                RunnerMessage::Completed { task_id, result } if started => {
                                    terminal = Some(if task_id != request.task_id {
                                        task_id_failure()
                                    } else if let Some((reason, _)) = shutdown.as_ref() {
                                        reason.outcome()
                                    } else {
                                        ExecutionOutcome::Completed { result }
                                    });
                                    break;
                                }
                                RunnerMessage::Failed { task_id, code, message } if started => {
                                    terminal = Some(if task_id.as_deref() != Some(request.task_id.as_str()) {
                                        task_id_failure()
                                    } else if let Some((reason, _)) = shutdown.as_ref() {
                                        reason.outcome()
                                    } else {
                                        failed(classify_runner_code(&code), &code, &message)
                                    });
                                    break;
                                }
                                RunnerMessage::Cancelled { task_id } if started => {
                                    terminal = Some(if task_id != request.task_id {
                                        task_id_failure()
                                    } else if let Some((reason, _)) = shutdown.as_ref() {
                                        reason.outcome()
                                    } else {
                                        protocol_failure("protocol_unexpected_cancelled", "Runner cancelled without a host request")
                                    });
                                    break;
                                }
                                _ => {
                                    terminal = Some(protocol_failure("protocol_unexpected_message", "Unexpected runner message"));
                                    break;
                                }
                            }
                        }
                        if let Some(terminal) = terminal {
                            break terminal;
                        }
                    }
                    ChildOutput::RawStderr(bytes) => {
                        if let Err(error) = stderr_file.write_all(&bytes).await {
                            break interrupted("log_write_failed", error);
                        }
                        let message = String::from_utf8_lossy(&bytes);
                        on_log(bounded_log_event(&request.task_id, LogStream::Stderr, &message));
                    }
                    ChildOutput::StdoutEof => {
                        break failed(FailureClassification::Interrupted, "runner_exited", "Runner exited before completion");
                    }
                    ChildOutput::IoError(message) => {
                        break failed(FailureClassification::Interrupted, "runner_io_failed", &message);
                    }
                    ChildOutput::ProtocolError(error) => {
                        break protocol_outcome(error);
                    }
                }
            }
        }
    };

    drop(stdin);
    process_tree.terminate_and_reap(&mut child).await;
    stdout_reader.abort();
    stderr_reader.abort();
    let _ = stdout_file.flush().await;
    let _ = stderr_file.flush().await;
    Ok(outcome)
}

async fn send_cancel(stdin: &mut tokio::process::ChildStdin, task_id: &str) {
    if let Ok(frame) = encode_frame(&HostMessage::Cancel {
        task_id: task_id.into(),
    }) {
        let _ = stdin.write_all(&frame).await;
    }
}

async fn create_log(path: &PathBuf) -> Result<File, ExecutionOutcome> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| interrupted("log_create_failed", error))?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .map_err(|error| interrupted("log_create_failed", error))
}

async fn read_protocol(mut stdout: tokio::process::ChildStdout, sender: mpsc::Sender<ChildOutput>) {
    let mut decoder = FrameDecoder::default();
    let mut buffer = vec![0; READ_BUFFER_BYTES];
    loop {
        match stdout.read(&mut buffer).await {
            Ok(0) => {
                let _ = sender.send(ChildOutput::StdoutEof).await;
                return;
            }
            Ok(read) => match decoder.push(&buffer[..read]) {
                Ok(frames) if !frames.is_empty() => {
                    if sender.send(ChildOutput::Frames(frames)).await.is_err() {
                        return;
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    let _ = sender.send(ChildOutput::ProtocolError(error)).await;
                    return;
                }
            },
            Err(error) => {
                let _ = sender.send(ChildOutput::IoError(error.to_string())).await;
                return;
            }
        }
    }
}

async fn read_stderr(mut stderr: tokio::process::ChildStderr, sender: mpsc::Sender<ChildOutput>) {
    let mut buffer = vec![0; READ_BUFFER_BYTES];
    loop {
        match stderr.read(&mut buffer).await {
            Ok(0) => return,
            Ok(read) => {
                if sender
                    .send(ChildOutput::RawStderr(buffer[..read].to_vec()))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            Err(error) => {
                let _ = sender.send(ChildOutput::IoError(error.to_string())).await;
                return;
            }
        }
    }
}

fn configure_environment(command: &mut Command, child_env: &BTreeMap<String, String>) {
    command.env_clear();
    for (key, value) in std::env::vars_os() {
        if !is_secret_environment_key(&key.to_string_lossy())
            && !is_proxy_environment_key(&key.to_string_lossy())
        {
            command.env(key, value);
        }
    }
    for (key, value) in child_env {
        if !is_secret_environment_key(key) {
            command.env(key, value);
        }
    }
}

fn is_proxy_environment_key(key: &str) -> bool {
    matches!(
        key.to_ascii_uppercase().as_str(),
        "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY"
    )
}

fn is_secret_environment_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect();
    (normalized.starts_with("LOCALAPP") || normalized.starts_with("LOCALAPP"))
        && (normalized.contains("APIKEY")
            || normalized.contains("AUTH")
            || normalized.contains("TOKEN"))
}

pub(crate) fn bounded_log_event(task_id: &str, stream: LogStream, message: &str) -> LogEvent {
    let (message, truncated) = truncate_utf8(message, MAX_CALLBACK_MESSAGE_BYTES);
    LogEvent {
        task_id: task_id.into(),
        stream,
        message,
        truncated,
    }
}

pub(crate) fn truncate_utf8(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.into(), false);
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].into(), true)
}

fn classify_runner_code(code: &str) -> FailureClassification {
    if code.starts_with("dependency_") {
        FailureClassification::Dependency
    } else if code == "result_serialization_failed" {
        FailureClassification::Serialization
    } else if code.starts_with("protocol_") {
        FailureClassification::Protocol
    } else {
        FailureClassification::Run
    }
}

fn failed(classification: FailureClassification, code: &str, message: &str) -> ExecutionOutcome {
    ExecutionOutcome::Failed {
        classification,
        code: code.into(),
        message: truncate_utf8(message, MAX_ERROR_MESSAGE_BYTES).0,
    }
}

fn protocol_outcome(error: ProtocolError) -> ExecutionOutcome {
    protocol_failure(error.code(), error.code())
}

fn protocol_failure(code: &str, message: &str) -> ExecutionOutcome {
    failed(FailureClassification::Protocol, code, message)
}

fn task_id_failure() -> ExecutionOutcome {
    protocol_failure(
        "protocol_task_id_mismatch",
        "Runner task ID did not match request",
    )
}

fn interrupted(code: &str, error: impl std::fmt::Display) -> ExecutionOutcome {
    interrupted_message(code, &error.to_string())
}

fn interrupted_message(code: &str, message: &str) -> ExecutionOutcome {
    failed(FailureClassification::Interrupted, code, message)
}

#[cfg(windows)]
pub fn assert_windows_job_object_support() {
    use windows_sys::Win32::System::JobObjects::{
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JobObjectExtendedLimitInformation,
    };
    let _ = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let _ = JobObjectExtendedLimitInformation;
}
