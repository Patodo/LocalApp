#[path = "../src/process_util.rs"]
mod process_util;

#[path = "../src/runner/mod.rs"]
mod runner;

use localapp_core::{AppPackageMetadata, build_app_package};
use localapp_desktop::local_apps::LocalAppRepository;
use localapp_desktop::paths::DesktopPaths;
use runner::environment::{
    CommandInstaller, EnvironmentDescriptor, EnvironmentRepository, InstallControl,
};
use runner::process::{ExecutionOutcome, ExecutionRequest, run};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

#[tokio::test]
#[ignore = "requires a Tauri no-bundle build with the pinned runtime"]
async fn packaged_node_npm_and_fixed_runner_execute_without_system_node() {
    let resources = PathBuf::from(
        std::env::var_os("LOCALAPP_BUNDLED_RESOURCE_DIR")
            .expect("LOCALAPP_BUNDLED_RESOURCE_DIR must point at a Tauri release directory"),
    );
    let node = resources.join(if cfg!(windows) { "node.exe" } else { "node" });
    let npm_cli = resources.join("npm/bin/npm-cli.js");
    let fixed_runner = resources.join("runner/localapp-runner.mjs");
    for path in [&node, &npm_cli, &fixed_runner] {
        assert!(
            path.is_file(),
            "packaged runtime asset missing: {}",
            path.display()
        );
    }

    let root = TempDir::new().unwrap();
    let cancellation = CancellationToken::new();
    let deadline = Instant::now() + Duration::from_secs(30);
    let repository =
        EnvironmentRepository::new(root.path().join("js-envs"), node.clone(), npm_cli).unwrap();
    let descriptor =
        EnvironmentDescriptor::new("https://registry.npmjs.org", None, BTreeMap::new()).unwrap();
    let installer =
        CommandInstaller::with_control(InstallControl::new(cancellation.clone(), deadline));
    let environment = repository.prepare(&descriptor, None, &installer).unwrap();
    std::fs::create_dir_all(root.path().join("work")).unwrap();

    let outcome = run(
        ExecutionRequest {
            node_executable: node,
            runner_script: fixed_runner,
            task_id: "bundled-runtime-e2e".to_string(),
            script: "return { input, owner: context.app.owner };".to_string(),
            input: json!({ "value": 42 }),
            context: json!({ "app": { "owner": "localapp" } }),
            environment_path: environment.path,
            working_directory: root.path().join("work"),
            stdout_path: root.path().join("stdout.log"),
            stderr_path: root.path().join("stderr.log"),
            timeout: deadline.saturating_duration_since(Instant::now()),
            cancellation,
            child_env: BTreeMap::new(),
        },
        Arc::new(|_| {}),
    )
    .await;

    assert_eq!(
        outcome,
        ExecutionOutcome::Completed {
            result: json!({ "input": { "value": 42 }, "owner": "localapp" }),
        }
    );
}

#[tokio::test]
#[ignore = "requires a Tauri no-bundle build with the pinned runtime"]
async fn packaged_local_runtime_serves_two_isolated_apps_without_system_node() {
    let resources = PathBuf::from(
        std::env::var_os("LOCALAPP_BUNDLED_RESOURCE_DIR")
            .expect("LOCALAPP_BUNDLED_RESOURCE_DIR must point at a Tauri release directory"),
    );
    let node = resources.join(if cfg!(windows) { "node.exe" } else { "node" });
    let runtime = resources.join("local-runtime/localapp-local-runtime.mjs");
    let wasm = resources.join("local-runtime/node_modules/sql.js/dist/sql-wasm.wasm");
    for path in [&node, &runtime, &wasm] {
        assert!(
            path.is_file(),
            "packaged Local Runtime asset missing: {}",
            path.display()
        );
    }

    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    repository.ensure_registry().unwrap();
    for app_id in ["notes-one", "notes-two", "broken-app"] {
        repository
            .install(&build_local_package(root.path(), app_id))
            .unwrap();
    }
    let broken = repository
        .list()
        .unwrap()
        .into_iter()
        .find(|app| app.app_id == "broken-app")
        .unwrap();
    fs::write(
        broken.version_root.join("migrations/002_broken.sql"),
        "CREATE TABL broken(",
    )
    .unwrap();
    let registry = paths.local_runtime_registry();
    let mut child = Command::new(node)
        .arg(runtime)
        .env_clear()
        .env("LOCALAPP_LOCAL_REGISTRY", &registry)
        .env("LOCALAPP_LOCAL_CONTROL_TOKEN", "bundled-local-token")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let ready: serde_json::Value = serde_json::from_str(
        &tokio::time::timeout(
            Duration::from_secs(10),
            BufReader::new(stdout).lines().next_line(),
        )
        .await
        .expect("Local Runtime ready timeout")
        .unwrap()
        .expect("Local Runtime exited before ready"),
    )
    .unwrap();
    let port = ready["port"].as_u64().unwrap() as u16;
    assert_eq!(ready["type"], "ready");

    let first = open_local_asset(port, "notes-one").await;
    let second = open_local_asset(port, "notes-two").await;
    assert!(first.contains("notes-one"));
    assert!(!first.contains("notes-two"));
    assert!(second.contains("notes-two"));
    assert!(!second.contains("notes-one"));
    let broken = request_local_asset(port, "broken-app").await;
    assert_eq!(broken.0, reqwest::StatusCode::SERVICE_UNAVAILABLE);
    assert!(broken.1.contains("app_unavailable"));
    assert!(
        open_local_asset(port, "notes-one")
            .await
            .contains("notes-one")
    );
    assert!(paths.app_data().join("notes-one/app.db").is_file());
    assert!(paths.app_data().join("notes-two/app.db").is_file());
    let health: serde_json::Value = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/health"))
        .header("host", format!("control.localhost:{port}"))
        .bearer_auth("bundled-local-token")
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["data"]["registeredApps"], 3);
    assert_eq!(health["data"]["initializedApps"], 2);
    assert_eq!(health["data"]["failedApps"], 1);
    eprintln!(
        "packaged Local Runtime pid={} stats={}",
        child.id().unwrap(),
        health["data"]
    );

    let _ = child.kill().await;
    let _ = child.wait().await;
}

fn build_local_package(root: &std::path::Path, app_id: &str) -> PathBuf {
    let project = root.join(format!("{app_id}-source"));
    fs::create_dir_all(project.join("dist/assets")).unwrap();
    fs::create_dir_all(project.join("migrations")).unwrap();
    fs::create_dir_all(project.join("backend/resources/items")).unwrap();
    fs::write(
        project.join("manifest.json"),
        format!(r#"{{"name":"{app_id}","platformVersion":"^1.0"}}"#),
    )
    .unwrap();
    fs::write(
        project.join("dist/index.html"),
        r#"<main id="root"></main><script src="/assets/app.js"></script>"#,
    )
    .unwrap();
    fs::write(
        project.join("dist/assets/app.js"),
        format!("document.body.textContent = {app_id:?};"),
    )
    .unwrap();
    fs::write(
        project.join("migrations/001_init.sql"),
        "CREATE TABLE items(id TEXT PRIMARY KEY);",
    )
    .unwrap();
    fs::write(
        project.join("backend/resources/items/schema.json"),
        json!({
            "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
            "name": "items",
            "fields": {
                "id": { "type": "text" }
            }
        })
        .to_string(),
    )
    .unwrap();
    let package = root.join(format!("{app_id}.localapp"));
    build_app_package(
        &project,
        &package,
        AppPackageMetadata {
            schema_version: 1,
            app_id: app_id.into(),
            version: "1.0.0".into(),
            platform_version: "^1.0".into(),
        },
    )
    .unwrap();
    package
}

async fn open_local_asset(port: u16, app_id: &str) -> String {
    let (status, body) = request_local_asset(port, app_id).await;
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "failed to open {app_id} asset: {body}"
    );
    body
}

async fn request_local_asset(port: u16, app_id: &str) -> (reqwest::StatusCode, String) {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let endpoint = format!("http://127.0.0.1:{port}");
    let ticket: serde_json::Value = client
        .post(format!("{endpoint}/control/tickets"))
        .header("host", format!("control.localhost:{port}"))
        .bearer_auth("bundled-local-token")
        .json(&json!({ "appId": app_id }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ticket = ticket["data"]["ticket"].as_str().unwrap();
    let session = client
        .get(format!("{endpoint}/?ticket={ticket}"))
        .header("host", format!("{app_id}.localhost:{port}"))
        .send()
        .await
        .unwrap();
    assert_eq!(session.status(), reqwest::StatusCode::FOUND);
    let cookie = session
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let response = client
        .get(format!("{endpoint}/assets/app.js"))
        .header("host", format!("{app_id}.localhost:{port}"))
        .header(reqwest::header::COOKIE, cookie)
        .send()
        .await
        .unwrap();
    let status = response.status();
    let body = response.text().await.unwrap();
    (status, body)
}
