#[path = "../src/process_util.rs"]
mod process_util;

#[path = "../src/runner/mod.rs"]
mod runner;

use runner::process::{
    ExecutionOutcome, ExecutionRequest, FailureClassification, LogEvent,
    MAX_CALLBACK_MESSAGE_BYTES, run,
};
use runner::protocol::LogStream;
use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

fn node_executable() -> &'static Path {
    static NODE: OnceLock<PathBuf> = OnceLock::new();
    NODE.get_or_init(|| {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let bundled_name = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            Some("node-aarch64-apple-darwin")
        } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
            Some("node-x86_64-apple-darwin")
        } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
            Some("node-x86_64-pc-windows-msvc.exe")
        } else {
            None
        };
        if let Some(name) = bundled_name {
            let bundled = manifest.join("binaries").join(name);
            if bundled.is_file() {
                return bundled;
            }
        }

        std::env::split_paths(&std::env::var_os("PATH").expect("tests require PATH"))
            .map(|directory| directory.join(if cfg!(windows) { "node.exe" } else { "node" }))
            .find(|candidate| candidate.is_file())
            .expect("tests require a prepared bundled Node or Node on the test PATH")
    })
}

fn request(root: &TempDir, task_id: &str, script: &str) -> ExecutionRequest {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let work = root.path().join("work");
    let environment = root.path().join("environment");
    std::fs::create_dir_all(&work).unwrap();
    std::fs::create_dir_all(&environment).unwrap();
    ExecutionRequest {
        node_executable: node_executable().to_path_buf(),
        runner_script: manifest.join("runner/localapp-runner.mjs"),
        task_id: task_id.into(),
        script: script.into(),
        input: json!({ "value": 7 }),
        context: json!({ "app": { "name": "demo" } }),
        environment_path: environment,
        working_directory: work,
        stdout_path: root.path().join("stdout.log"),
        stderr_path: root.path().join("stderr.log"),
        timeout: Duration::from_secs(5),
        cancellation: CancellationToken::new(),
        child_env: BTreeMap::new(),
    }
}

fn write_runner(root: &TempDir, source: &str) -> PathBuf {
    let path = root.path().join("fixture-runner.mjs");
    std::fs::write(&path, source).unwrap();
    path
}

#[cfg(windows)]
#[test]
fn windows_job_object_support_compiles() {
    runner::process::assert_windows_job_object_support();
}

#[tokio::test]
async fn runs_real_runner_streams_logs_and_returns_result() {
    let root = TempDir::new().unwrap();
    let events = Arc::new(Mutex::new(Vec::<LogEvent>::new()));
    let captured = Arc::clone(&events);

    let outcome = run(
        request(
            &root,
            "task-success",
            "console.log('hello'); console.error('warning'); return { answer: input.value * 6 };",
        ),
        Arc::new(move |event| captured.lock().unwrap().push(event)),
    )
    .await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Completed {
            result: json!({ "answer": 42 })
        }
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("stdout.log")).unwrap(),
        "hello\n"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("stderr.log")).unwrap(),
        "warning\n"
    );
    assert_eq!(
        *events.lock().unwrap(),
        vec![
            LogEvent {
                task_id: "task-success".into(),
                stream: LogStream::Stdout,
                message: "hello\n".into(),
                truncated: false,
            },
            LogEvent {
                task_id: "task-success".into(),
                stream: LogStream::Stderr,
                message: "warning\n".into(),
                truncated: false,
            },
        ]
    );
}

#[tokio::test]
async fn classifies_real_runner_serialization_failure() {
    let root = TempDir::new().unwrap();

    let outcome = run(
        request(&root, "task-serialization", "return 1n;"),
        Arc::new(|_| {}),
    )
    .await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Failed {
            classification: FailureClassification::Serialization,
            code: "result_serialization_failed".into(),
            message: "result_serialization_failed".into(),
        }
    );
}

#[tokio::test]
async fn cooperative_cancellation_sends_cancel_frame_and_returns_cancelled() {
    let root = TempDir::new().unwrap();
    let marker = root.path().join("cancel-received");
    let start_marker = root.path().join("start-received");
    let fixture = write_runner(
        &root,
        r#"
import { writeFileSync } from "node:fs";
const encode = (message) => {
  const payload = Buffer.from(JSON.stringify(message));
  const frame = Buffer.alloc(8 + payload.length);
  frame.write("LADP"); frame.writeUInt32BE(payload.length, 4); payload.copy(frame, 8);
  return frame;
};
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32BE(4)) {
    const length = buffer.readUInt32BE(4);
    const message = JSON.parse(buffer.subarray(8, 8 + length));
    buffer = buffer.subarray(8 + length);
    if (message.type === "start") {
      writeFileSync(process.env.START_MARKER, message.taskId);
    } else if (message.type === "cancel") {
      writeFileSync(process.env.CANCEL_MARKER, message.taskId);
      process.stdout.write(encode({ type: "cancelled", taskId: message.taskId }));
    }
  }
});
process.stdout.write(encode({ type: "ready", protocolVersion: 1 }));
"#,
    );
    let cancellation = CancellationToken::new();
    let mut execution = request(&root, "task-cancel", "await new Promise(() => {});");
    execution.runner_script = fixture;
    execution.cancellation = cancellation.clone();
    execution.child_env.insert(
        "CANCEL_MARKER".into(),
        marker.to_string_lossy().into_owned(),
    );
    execution.child_env.insert(
        "START_MARKER".into(),
        start_marker.to_string_lossy().into_owned(),
    );

    let handle = tokio::spawn(async move { run(execution, Arc::new(|_| {})).await });
    for _ in 0..100 {
        if start_marker.is_file() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(start_marker.is_file(), "fixture never received start frame");
    cancellation.cancel();
    let outcome = handle.await.unwrap();

    assert_eq!(
        outcome,
        ExecutionOutcome::Failed {
            classification: FailureClassification::Cancelled,
            code: "execution_cancelled".into(),
            message: "Execution cancelled".into(),
        }
    );
    assert_eq!(std::fs::read_to_string(marker).unwrap(), "task-cancel");
}

#[tokio::test]
async fn real_runner_timeout_remains_distinct_from_cooperative_cancel() {
    let root = TempDir::new().unwrap();
    let mut execution = request(
        &root,
        "task-timeout",
        "await new Promise((resolve) => setTimeout(resolve, 10_000)); return 1;",
    );
    execution.timeout = Duration::from_millis(500);

    let outcome = run(execution, Arc::new(|_| {})).await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Failed {
            classification: FailureClassification::Timeout,
            code: "execution_timeout".into(),
            message: "Execution timed out".into(),
        }
    );
}

#[cfg(unix)]
#[tokio::test]
async fn forced_cancellation_terminates_real_runner_descendants() {
    let root = TempDir::new().unwrap();
    let pid_path = root.path().join("descendant.pid");
    let cancellation = CancellationToken::new();
    let mut execution = request(
        &root,
        "task-tree",
        r#"
const { spawn } = await import("node:child_process");
const { writeFile } = await import("node:fs/promises");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
await writeFile(process.env.DESCENDANT_PID_PATH, String(child.pid));
await new Promise(() => {});
"#,
    );
    execution.cancellation = cancellation.clone();
    execution.child_env.insert(
        "DESCENDANT_PID_PATH".into(),
        pid_path.to_string_lossy().into_owned(),
    );

    let handle = tokio::spawn(async move { run(execution, Arc::new(|_| {})).await });
    for _ in 0..100 {
        if pid_path.is_file() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let pid: i32 = std::fs::read_to_string(&pid_path)
        .expect("runner should create descendant pid file")
        .parse()
        .unwrap();
    cancellation.cancel();
    let outcome = handle.await.unwrap();
    assert_eq!(
        outcome,
        ExecutionOutcome::Failed {
            classification: FailureClassification::Cancelled,
            code: "execution_cancelled".into(),
            message: "Execution cancelled".into(),
        }
    );

    let mut alive = true;
    for _ in 0..100 {
        alive = unsafe { libc::kill(pid, 0) == 0 };
        if !alive {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    if alive {
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
    assert!(
        !alive,
        "descendant process {pid} survived supervisor shutdown"
    );
}

#[tokio::test]
async fn rejects_malformed_and_oversized_runner_frames() {
    for (name, source, expected_code) in [
        (
            "malformed",
            "process.stdout.write(Buffer.from('NOPE0000'));",
            "protocol_malformed_frame",
        ),
        (
            "oversized",
            r#"
const frame = Buffer.alloc(8);
frame.write("LADP");
frame.writeUInt32BE(2 * 1024 * 1024 + 1, 4);
process.stdout.write(frame);
"#,
            "protocol_frame_too_large",
        ),
    ] {
        let root = TempDir::new().unwrap();
        let mut execution = request(&root, &format!("task-{name}"), "return 1;");
        execution.runner_script = write_runner(&root, source);

        let outcome = run(execution, Arc::new(|_| {})).await;

        assert!(
            matches!(
                outcome,
                ExecutionOutcome::Failed {
                    classification: FailureClassification::Protocol,
                    ref code,
                    ..
                } if code == expected_code
            ),
            "unexpected {name} outcome: {outcome:?}"
        );
    }
}

#[tokio::test]
async fn rejects_terminal_frame_with_a_different_task_id() {
    let root = TempDir::new().unwrap();
    let fixture = write_runner(
        &root,
        r#"
const encode = (message) => {
  const payload = Buffer.from(JSON.stringify(message));
  const frame = Buffer.alloc(8 + payload.length);
  frame.write("LADP"); frame.writeUInt32BE(payload.length, 4); payload.copy(frame, 8);
  return frame;
};
process.stdin.once("data", () => {
  process.stdout.write(encode({ type: "completed", taskId: "other-task", result: 42 }));
});
process.stdout.write(encode({ type: "ready", protocolVersion: 1 }));
"#,
    );
    let mut execution = request(&root, "expected-task", "return 42;");
    execution.runner_script = fixture;

    let outcome = run(execution, Arc::new(|_| {})).await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Failed {
            classification: FailureClassification::Protocol,
            code: "protocol_task_id_mismatch".into(),
            message: "Runner task ID did not match request".into(),
        }
    );
}

#[tokio::test]
async fn keeps_full_log_on_disk_but_bounds_callback_event_memory() {
    let root = TempDir::new().unwrap();
    let events = Arc::new(Mutex::new(Vec::<LogEvent>::new()));
    let captured = Arc::clone(&events);
    let message_bytes = MAX_CALLBACK_MESSAGE_BYTES * 4;

    let outcome = run(
        request(
            &root,
            "task-large-log",
            &format!("console.log('x'.repeat({message_bytes})); return true;"),
        ),
        Arc::new(move |event| captured.lock().unwrap().push(event)),
    )
    .await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Completed {
            result: json!(true)
        }
    );
    let disk_log = std::fs::read(root.path().join("stdout.log")).unwrap();
    assert_eq!(disk_log.len(), message_bytes + 1);
    assert!(disk_log[..message_bytes].iter().all(|byte| *byte == b'x'));
    assert_eq!(disk_log[message_bytes], b'\n');
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].message.len(), MAX_CALLBACK_MESSAGE_BYTES);
    assert!(events[0].truncated);
}

#[tokio::test]
async fn scrubs_localapp_secrets_and_uses_only_explicit_proxy_environment() {
    let root = TempDir::new().unwrap();
    let mut execution = request(
        &root,
        "task-environment",
        r#"
return {
  apiKey: process.env.LOCALAPP_API_KEY ?? null,
  auth: process.env.LOCALAPP_AUTH_TOKEN ?? null,
  proxy: process.env.HTTPS_PROXY ?? null,
  marker: process.env.SAFE_MARKER ?? null,
};
"#,
    );
    execution
        .child_env
        .insert("LOCALAPP_API_KEY".into(), "top-secret".into());
    execution
        .child_env
        .insert("LOCALAPP_AUTH_TOKEN".into(), "auth-secret".into());
    execution
        .child_env
        .insert("HTTPS_PROXY".into(), "http://proxy.example:8080".into());
    execution
        .child_env
        .insert("SAFE_MARKER".into(), "visible".into());

    let outcome = run(execution, Arc::new(|_| {})).await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Completed {
            result: json!({
                "apiKey": null,
                "auth": null,
                "proxy": "http://proxy.example:8080",
                "marker": "visible",
            })
        }
    );
}

#[tokio::test]
async fn cancellation_before_ready_never_starts_the_script() {
    let root = TempDir::new().unwrap();
    let marker = root.path().join("start-received");
    let fixture = write_runner(
        &root,
        r#"
import { writeFileSync } from "node:fs";
const encode = (message) => {
  const payload = Buffer.from(JSON.stringify(message));
  const frame = Buffer.alloc(8 + payload.length);
  frame.write("LADP"); frame.writeUInt32BE(payload.length, 4); payload.copy(frame, 8);
  return frame;
};
process.stdin.on("data", (frame) => {
  const length = frame.readUInt32BE(4);
  const message = JSON.parse(frame.subarray(8, 8 + length));
  if (message.type === "start") writeFileSync(process.env.START_MARKER, message.taskId);
});
setTimeout(() => process.stdout.write(encode({ type: "ready", protocolVersion: 1 })), 250);
"#,
    );
    let cancellation = CancellationToken::new();
    let mut execution = request(&root, "task-early-cancel", "return 1;");
    execution.runner_script = fixture;
    execution.cancellation = cancellation.clone();
    execution
        .child_env
        .insert("START_MARKER".into(), marker.to_string_lossy().into_owned());

    let handle = tokio::spawn(async move { run(execution, Arc::new(|_| {})).await });
    tokio::time::sleep(Duration::from_millis(30)).await;
    cancellation.cancel();
    let outcome = handle.await.unwrap();

    assert_eq!(
        outcome,
        ExecutionOutcome::Failed {
            classification: FailureClassification::Cancelled,
            code: "execution_cancelled".into(),
            message: "Execution cancelled".into(),
        }
    );
    assert!(!marker.exists(), "cancelled task received a start frame");
}

#[tokio::test]
async fn rejects_non_absolute_executable_without_path_lookup() {
    let root = TempDir::new().unwrap();
    let mut execution = request(&root, "task-relative-node", "return 1;");
    execution.node_executable = PathBuf::from("node");

    let outcome = run(execution, Arc::new(|_| {})).await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Failed {
            classification: FailureClassification::Interrupted,
            code: "invalid_execution_path".into(),
            message: "Node executable and runner paths must be absolute".into(),
        }
    );
}

#[tokio::test]
async fn appends_log_frames_without_truncating_existing_files() {
    let root = TempDir::new().unwrap();
    std::fs::write(root.path().join("stdout.log"), "existing stdout\n").unwrap();
    std::fs::write(root.path().join("stderr.log"), "existing stderr\n").unwrap();

    let outcome = run(
        request(
            &root,
            "task-append",
            "console.log('new stdout'); console.error('new stderr'); return true;",
        ),
        Arc::new(|_| {}),
    )
    .await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Completed {
            result: json!(true)
        }
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("stdout.log")).unwrap(),
        "existing stdout\nnew stdout\n"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("stderr.log")).unwrap(),
        "existing stderr\nnew stderr\n"
    );
}
