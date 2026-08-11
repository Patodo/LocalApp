use httpmock::{Method, MockServer};
use localapp_core::{AppPackageMetadata, build_app_package_from_files};
use std::fs;
use std::path::Path;
use std::process::{Command, Output};
use tempfile::tempdir;

fn cli(config_dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(args)
        .env("LOCALAPP_CONFIG_DIR", config_dir)
        .env_remove("LOCALAPP_SERVER_URL")
        .env_remove("LOCALAPP_API_KEY")
        .env_remove("LOCALAPP_PROFILE")
        .output()
        .unwrap()
}

fn add_profile(config_dir: &Path, name: &str, server_url: &str, api_key: &str) {
    let output = cli(
        config_dir,
        &[
            "server",
            "add",
            name,
            "--server-url",
            server_url,
            "--api-key",
            api_key,
        ],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn app_install_posts_the_package_to_the_explicit_server_target() {
    let target = MockServer::start();
    let installed = target.mock(|when, then| {
        when.method(Method::POST)
            .path("/api/me/apps/install")
            .header("x-api-key", "target-key")
            .body_contains("profile-e2e");
        then.status(201)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": { "name": "profile-e2e", "localVersion": 1 }
            }));
    });
    let active = MockServer::start();
    let active_request = active.mock(|_when, then| {
        then.status(500);
    });
    let config = tempdir().unwrap();
    add_profile(config.path(), "active", &active.base_url(), "active-key");
    add_profile(config.path(), "target", &target.base_url(), "target-key");
    assert!(
        cli(config.path(), &["server", "use", "active"])
            .status
            .success()
    );

    let project = tempdir().unwrap();
    let package = project.path().join("profile-e2e.localapp");
    build_app_package_from_files(
        &package,
        AppPackageMetadata {
            schema_version: 1,
            app_id: "profile-e2e".into(),
            version: "1.0.0".into(),
            platform_version: "^1.0".into(),
        },
        vec![
            (
                "manifest.json".into(),
                br#"{"name":"profile-e2e","distDir":"dist"}"#.to_vec(),
            ),
            ("dist/index.html".into(), b"<main>package</main>".to_vec()),
        ],
    )
    .unwrap();

    let output = cli(
        config.path(),
        &[
            "app",
            "install",
            "--target",
            "target",
            "--package",
            package.to_str().unwrap(),
        ],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    installed.assert();
    active_request.assert_hits(0);
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["success"], true);
    assert_eq!(response["serverUrl"], target.base_url());
}

#[test]
fn app_sync_sends_peer_name_and_waits_for_completion() {
    let source = MockServer::start();
    let start = source.mock(|when, then| {
        when.method(Method::POST)
            .path("/api/me/apps/notes/sync")
            .header("x-api-key", "source-key")
            .body_contains("\"peerName\":\"office\"")
            .body_contains("\"withData\":false");
        then.status(202)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": { "id": "sync-1", "status": "queued" }
            }));
    });
    let job = source.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/sync-jobs/sync-1")
            .header("x-api-key", "source-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": { "id": "sync-1", "status": "completed" }
            }));
    });
    let config = tempdir().unwrap();
    add_profile(config.path(), "source", &source.base_url(), "source-key");
    let project = tempdir().unwrap();
    fs::write(
        project.path().join("manifest.json"),
        br#"{"name":"notes","distDir":"dist"}"#,
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(["app", "sync", "--peer", "office", "--target", "source"])
        .current_dir(project.path())
        .env("LOCALAPP_CONFIG_DIR", config.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    start.assert();
    job.assert();
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["status"], "completed");
}
