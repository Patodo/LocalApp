use httpmock::{Method, MockServer};
use std::fs;
use std::process::Command;
use tempfile::tempdir;

fn localapp(config_dir: &std::path::Path, arguments: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(arguments)
        .env("LOCALAPP_CONFIG_DIR", config_dir)
        .env_remove("LOCALAPP_SERVER_URL")
        .env_remove("LOCALAPP_API_KEY")
        .env_remove("LOCALAPP_PROFILE")
        .output()
        .unwrap()
}

#[test]
fn server_profiles_can_be_added_listed_selected_and_removed_without_leaking_keys() {
    let config = tempdir().unwrap();

    let add = localapp(
        config.path(),
        &[
            "server",
            "add",
            "staging",
            "--server-url",
            "https://staging.example/",
            "--api-key",
            "do-not-print",
        ],
    );
    assert!(
        add.status.success(),
        "{}",
        String::from_utf8_lossy(&add.stderr)
    );
    assert!(!String::from_utf8_lossy(&add.stdout).contains("do-not-print"));

    let list = localapp(config.path(), &["server", "list"]);
    assert!(list.status.success());
    let response: serde_json::Value = serde_json::from_slice(&list.stdout).unwrap();
    assert_eq!(response["profiles"][0]["name"], "staging");
    assert_eq!(
        response["profiles"][0]["serverUrl"],
        "https://staging.example"
    );
    assert!(response["profiles"][0].get("apiKey").is_none());

    let selected = localapp(config.path(), &["server", "use", "staging"]);
    assert!(selected.status.success());
    let removed = localapp(config.path(), &["server", "remove", "staging"]);
    assert!(removed.status.success());
}

#[test]
fn explicit_profile_conflicts_with_complete_environment_target_before_network() {
    let config = tempdir().unwrap();
    let project = tempdir().unwrap();
    fs::create_dir_all(project.path().join("dist")).unwrap();
    fs::write(
        project.path().join("manifest.json"),
        r#"{"name":"target-test","distDir":"dist","platformVersion":"^1.0"}"#,
    )
    .unwrap();
    fs::write(project.path().join("dist/index.html"), "<div></div>").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(["check", "--profile", "staging", "--json"])
        .current_dir(project.path())
        .env("LOCALAPP_CONFIG_DIR", config.path())
        .env("LOCALAPP_SERVER_URL", "http://127.0.0.1:9")
        .env("LOCALAPP_API_KEY", "temporary")
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("cannot be combined"));
}

#[test]
fn upload_uses_the_explicit_profile_instead_of_the_active_server() {
    let active = MockServer::start();
    let target = MockServer::start();
    let register = target.mock(|when, then| {
        when.method(Method::POST)
            .path("/api/pages")
            .header("x-api-key", "target-key");
        then.status(409)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": false,
                "error": "Page name already exists"
            }));
    });
    let upload = target.mock(|when, then| {
        when.method(Method::POST)
            .path("/api/upload")
            .header("x-api-key", "target-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": {
                    "name": "target-test",
                    "url": "https://target.example/example-user/target-test/",
                    "rawUrl": "https://target.example/serve/example-user/target-test/",
                    "version": 1
                }
            }));
    });
    let active_register = active.mock(|when, then| {
        when.method(Method::POST).path("/api/pages");
        then.status(500);
    });
    let active_upload = active.mock(|when, then| {
        when.method(Method::POST).path("/api/upload");
        then.status(500);
    });
    let config = tempdir().unwrap();
    for (name, server_url, api_key) in [
        ("active", active.base_url(), "active-key"),
        ("target", target.base_url(), "target-key"),
    ] {
        let output = localapp(
            config.path(),
            &[
                "server",
                "add",
                name,
                "--server-url",
                &server_url,
                "--api-key",
                api_key,
            ],
        );
        assert!(output.status.success());
    }
    assert!(
        localapp(config.path(), &["server", "use", "active"])
            .status
            .success()
    );

    let project = tempdir().unwrap();
    fs::create_dir_all(project.path().join("dist")).unwrap();
    fs::write(
        project.path().join("manifest.json"),
        r#"{"name":"target-test","distDir":"dist","platformVersion":"^1.0"}"#,
    )
    .unwrap();
    fs::write(project.path().join("dist/index.html"), "<div></div>").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args([
            "upload",
            "./dist",
            "--skip-validate",
            "--confirm-project-name",
            "target-test",
            "--profile",
            "target",
        ])
        .current_dir(project.path())
        .env("LOCALAPP_CONFIG_DIR", config.path())
        .env_remove("LOCALAPP_SERVER_URL")
        .env_remove("LOCALAPP_API_KEY")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    register.assert();
    upload.assert();
    active_register.assert_hits(0);
    active_upload.assert_hits(0);
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["profile"], "target");
    assert_eq!(response["serverUrl"], target.base_url());
}
