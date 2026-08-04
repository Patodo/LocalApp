use httpmock::{Method, MockServer};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::tempdir;

fn existing_config(config_dir: &std::path::Path) -> Vec<u8> {
    let content = br#"{
  "server_url": "https://old.example",
  "api_key": "old-secret"
}"#
    .to_vec();
    fs::write(config_dir.join("config.json"), &content).unwrap();
    content
}

fn login(server_url: &str, api_key: &str, config_dir: &std::path::Path) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(["login", "--server-url", server_url, "--api-key", api_key])
        .env("LOCALAPP_CONFIG_DIR", config_dir)
        .output()
        .unwrap()
}

#[test]
fn complete_arguments_validate_identity_before_saving() {
    let server = MockServer::start();
    let request = server.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/me")
            .header("x-api-key", "valid-key")
            .header_exists("x-cli-version");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": { "id": "alice", "name": "alice", "role": "user" }
            }));
    });
    let config_dir = tempdir().unwrap();

    let output = login(&server.base_url(), "valid-key", config_dir.path());

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    request.assert();
    let saved: Value =
        serde_json::from_slice(&fs::read(config_dir.path().join("config.json")).unwrap()).unwrap();
    assert_eq!(saved["server_url"], server.base_url());
    assert_eq!(saved["api_key"], "valid-key");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["success"], true);
    assert_eq!(response["user"]["name"], "alice");
}

#[test]
fn named_login_saves_only_the_selected_profile_after_validation() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/me")
            .header("x-api-key", "profile-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": { "id": "alice", "name": "alice", "role": "user" }
            }));
    });
    let config_dir = tempdir().unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args([
            "login",
            "--profile",
            "staging",
            "--server-url",
            &server.base_url(),
            "--api-key",
            "profile-key",
        ])
        .env("LOCALAPP_CONFIG_DIR", config_dir.path())
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!config_dir.path().join("config.json").exists());
    let profiles: Value =
        serde_json::from_slice(&fs::read(config_dir.path().join("servers.json")).unwrap()).unwrap();
    assert_eq!(profiles["profiles"]["staging"]["api_key"], "profile-key");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["profile"], "staging");
    assert!(!String::from_utf8_lossy(&output.stdout).contains("profile-key"));
}

#[test]
fn no_arguments_complete_an_interactive_login_before_saving() {
    let server = MockServer::start();
    let request = server.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/me")
            .header("x-api-key", "interactive-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": { "id": "interactive-user", "name": "interactive-user", "role": "user" }
            }));
    });
    let config_dir = tempdir().unwrap();
    let pty = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut command = CommandBuilder::new(env!("CARGO_BIN_EXE_localapp"));
    command.arg("login");
    command.env("LOCALAPP_CONFIG_DIR", config_dir.path());
    let mut child = pty.slave.spawn_command(command).unwrap();
    drop(pty.slave);
    let mut output_reader = pty.master.try_clone_reader().unwrap();
    let terminal_output = Arc::new(Mutex::new(String::new()));
    let reader_output = Arc::clone(&terminal_output);
    let output_thread = thread::spawn(move || {
        let mut bytes = [0_u8; 1024];
        while let Ok(count) = output_reader.read(&mut bytes) {
            if count == 0 {
                break;
            }
            reader_output
                .lock()
                .unwrap()
                .push_str(&String::from_utf8_lossy(&bytes[..count]));
        }
    });
    let mut input_writer = pty.master.take_writer().unwrap();
    wait_for_terminal_text(&terminal_output, "Server URL");
    input_writer
        .write_all(format!("{}\r", server.base_url()).as_bytes())
        .unwrap();
    input_writer.flush().unwrap();
    wait_for_terminal_text(&terminal_output, "API Key");
    input_writer.write_all(b"interactive-key\r").unwrap();
    input_writer.flush().unwrap();

    let status = child.wait().unwrap();
    drop(input_writer);
    drop(pty.master);
    output_thread.join().unwrap();
    let terminal_output = terminal_output.lock().unwrap().clone();

    assert!(status.success(), "{}", terminal_output);
    request.assert();
    let saved: Value =
        serde_json::from_slice(&fs::read(config_dir.path().join("config.json")).unwrap()).unwrap();
    assert_eq!(saved["server_url"], server.base_url());
    assert_eq!(saved["api_key"], "interactive-key");
}

fn wait_for_terminal_text(output: &Arc<Mutex<String>>, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if output.lock().unwrap().contains(expected) {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!(
        "terminal did not display {expected:?}; output: {}",
        output.lock().unwrap()
    );
}

#[test]
fn invalid_api_key_preserves_existing_config() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(Method::GET).path("/api/me");
        then.status(401)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": false,
                "error": "Authentication required"
            }));
    });
    let config_dir = tempdir().unwrap();
    let before = existing_config(config_dir.path());

    let output = login(&server.base_url(), "wrong-key", config_dir.path());

    assert!(!output.status.success());
    assert_eq!(
        fs::read(config_dir.path().join("config.json")).unwrap(),
        before
    );
    let error = String::from_utf8_lossy(&output.stderr);
    let error_json: Value = serde_json::from_str(error.trim()).unwrap();
    assert_eq!(error_json["success"], false);
    assert_eq!(error_json["code"], "LOGIN_INVALID_API_KEY");
    assert!(error.contains("管理员"), "{error}");
}

#[test]
fn connection_failure_preserves_existing_config() {
    let config_dir = tempdir().unwrap();
    let before = existing_config(config_dir.path());

    let output = login("http://127.0.0.1:9", "unreachable-key", config_dir.path());

    assert!(!output.status.success());
    assert_eq!(
        fs::read(config_dir.path().join("config.json")).unwrap(),
        before
    );
    assert!(String::from_utf8_lossy(&output.stderr).contains("LOGIN_CONNECTION_FAILED"));
}

#[test]
fn incompatible_response_preserves_existing_config() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(Method::GET).path("/api/me");
        then.status(200)
            .header("content-type", "text/plain")
            .body("not a LocalApp response");
    });
    let config_dir = tempdir().unwrap();
    let before = existing_config(config_dir.path());

    let output = login(&server.base_url(), "candidate-key", config_dir.path());

    assert!(!output.status.success());
    assert_eq!(
        fs::read(config_dir.path().join("config.json")).unwrap(),
        before
    );
    assert!(String::from_utf8_lossy(&output.stderr).contains("LOGIN_PROTOCOL_ERROR"));
}

#[test]
fn partial_arguments_fall_back_to_interactive_input_without_saving() {
    for arguments in [
        vec!["login", "--server-url", "http://127.0.0.1:9"],
        vec!["login", "--api-key", "hidden-key"],
    ] {
        let config_dir = tempdir().unwrap();
        let before = existing_config(config_dir.path());
        let output = Command::new(env!("CARGO_BIN_EXE_localapp"))
            .args(arguments)
            .env("LOCALAPP_CONFIG_DIR", config_dir.path())
            .stdin(Stdio::null())
            .output()
            .unwrap();

        assert!(!output.status.success());
        assert_eq!(
            fs::read(config_dir.path().join("config.json")).unwrap(),
            before
        );
        assert!(!String::from_utf8_lossy(&output.stderr).contains("hidden-key"));
    }
}

#[test]
fn build_script_has_no_registration_secret_input() {
    let build_script = include_str!("../build.rs");

    assert!(!build_script.contains("REGISTRATION_KEY"));
    assert!(!build_script.contains(".registration-key"));
    assert!(!build_script.contains("bump_cli_version"));
    assert!(!build_script.contains("version-bump-stamp"));
}
