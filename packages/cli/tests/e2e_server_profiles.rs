use httpmock::{Method, MockServer};
use std::fs;
use std::path::Path;
use std::process::{Command, Output};
use std::thread;
use std::time::Duration;
use tempfile::tempdir;

fn cli_command(config_dir: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_localapp"));
    command
        .env("LOCALAPP_CONFIG_DIR", config_dir)
        .env_remove("LOCALAPP_SERVER_URL")
        .env_remove("LOCALAPP_API_KEY")
        .env_remove("LOCALAPP_PROFILE");
    command
}

fn run_cli(config_dir: &Path, arguments: &[&str]) -> Output {
    cli_command(config_dir).args(arguments).output().unwrap()
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn add_profile(config_dir: &Path, name: &str, server_url: &str, api_key: &str) {
    let output = run_cli(
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
    assert_success(&output);
    assert!(!String::from_utf8_lossy(&output.stdout).contains(api_key));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(api_key));
}

#[test]
fn server_commands_manage_multiple_profiles_without_printing_credentials() {
    let config = tempdir().unwrap();
    add_profile(
        config.path(),
        "staging",
        "https://staging.example/",
        "staging-private-key",
    );
    add_profile(
        config.path(),
        "production",
        "https://production.example/",
        "production-private-key",
    );

    let list = run_cli(config.path(), &["server", "list"]);
    assert_success(&list);
    let stdout = String::from_utf8_lossy(&list.stdout);
    assert!(!stdout.contains("staging-private-key"));
    assert!(!stdout.contains("production-private-key"));
    let response: serde_json::Value = serde_json::from_slice(&list.stdout).unwrap();
    assert_eq!(response["activeProfile"], serde_json::Value::Null);
    assert_eq!(
        response["profiles"],
        serde_json::json!([
            {
                "name": "production",
                "serverUrl": "https://production.example",
                "active": false,
                "loggedIn": true
            },
            {
                "name": "staging",
                "serverUrl": "https://staging.example",
                "active": false,
                "loggedIn": true
            }
        ])
    );

    let remove = run_cli(config.path(), &["server", "remove", "staging"]);
    assert_success(&remove);
    let list = run_cli(config.path(), &["server", "list"]);
    assert_success(&list);
    let response: serde_json::Value = serde_json::from_slice(&list.stdout).unwrap();
    assert_eq!(response["profiles"].as_array().unwrap().len(), 1);
    assert_eq!(response["profiles"][0]["name"], "production");
}

#[test]
fn legacy_config_remains_a_working_server_target_without_profiles() {
    let legacy = MockServer::start();
    let pages = legacy.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/pages")
            .header("x-api-key", "legacy-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": [{"name": "legacy-app"}]
            }));
    });
    let config = tempdir().unwrap();
    fs::write(
        config.path().join("config.json"),
        serde_json::to_vec(&serde_json::json!({
            "server_url": legacy.base_url(),
            "api_key": "legacy-key"
        }))
        .unwrap(),
    )
    .unwrap();

    let output = run_cli(config.path(), &["pages", "list"]);

    assert_success(&output);
    pages.assert();
    assert!(!config.path().join("servers.json").exists());
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["data"][0]["name"], "legacy-app");
}

#[test]
fn complete_environment_target_conflicts_with_explicit_profile_before_network() {
    let remote = MockServer::start();
    let unexpected = remote.mock(|_when, then| {
        then.status(500);
    });
    let config = tempdir().unwrap();
    add_profile(config.path(), "staging", &remote.base_url(), "profile-key");
    let project = tempdir().unwrap();
    fs::create_dir_all(project.path().join("dist")).unwrap();
    fs::write(
        project.path().join("manifest.json"),
        r#"{"name":"conflict-app","distDir":"dist","platformVersion":"^1.0"}"#,
    )
    .unwrap();
    fs::write(project.path().join("dist/index.html"), "<div></div>").unwrap();

    let output = cli_command(config.path())
        .args(["check", "--profile", "staging", "--json"])
        .current_dir(project.path())
        .env("LOCALAPP_SERVER_URL", remote.base_url())
        .env("LOCALAPP_API_KEY", "environment-key")
        .output()
        .unwrap();

    assert!(!output.status.success());
    unexpected.assert_hits(0);
    assert!(String::from_utf8_lossy(&output.stderr).contains("cannot be combined"));
}

#[test]
fn failed_named_login_preserves_all_profile_and_compatibility_config_bytes() {
    let rejected = MockServer::start();
    let login = rejected.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/me")
            .header("x-api-key", "rejected-key");
        then.status(401)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": false,
                "error": "invalid API key"
            }));
    });
    let config = tempdir().unwrap();
    add_profile(
        config.path(),
        "staging",
        "https://old-staging.example",
        "old-staging-key",
    );
    add_profile(
        config.path(),
        "production",
        "https://production.example",
        "production-key",
    );
    assert_success(&run_cli(config.path(), &["server", "use", "production"]));
    let profiles_before = fs::read(config.path().join("servers.json")).unwrap();
    let compatibility_before = fs::read(config.path().join("config.json")).unwrap();

    let output = run_cli(
        config.path(),
        &[
            "login",
            "--profile",
            "staging",
            "--server-url",
            &rejected.base_url(),
            "--api-key",
            "rejected-key",
        ],
    );

    assert!(!output.status.success());
    login.assert();
    assert_eq!(
        fs::read(config.path().join("servers.json")).unwrap(),
        profiles_before
    );
    assert_eq!(
        fs::read(config.path().join("config.json")).unwrap(),
        compatibility_before
    );
}

#[test]
fn server_use_updates_the_active_profile_and_legacy_config_mirror() {
    let config = tempdir().unwrap();
    add_profile(
        config.path(),
        "staging",
        "https://staging.example/",
        "staging-key",
    );
    add_profile(
        config.path(),
        "production",
        "https://production.example/",
        "production-key",
    );

    let output = run_cli(config.path(), &["server", "use", "production"]);

    assert_success(&output);
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["activeProfile"], "production");
    assert_eq!(response["serverUrl"], "https://production.example");
    let profiles: serde_json::Value =
        serde_json::from_slice(&fs::read(config.path().join("servers.json")).unwrap()).unwrap();
    assert_eq!(profiles["activeProfile"], "production");
    let compatibility: serde_json::Value =
        serde_json::from_slice(&fs::read(config.path().join("config.json")).unwrap()).unwrap();
    assert_eq!(
        compatibility,
        serde_json::json!({
            "server_url": "https://production.example",
            "api_key": "production-key"
        })
    );
}

#[test]
fn explicit_profile_upload_stays_on_one_server_and_excludes_local_application_data() {
    let active = MockServer::start();
    let target = MockServer::start();
    let active_request = active.mock(|_when, then| {
        then.status(500);
    });
    let capabilities: serde_json::Value =
        serde_json::from_str(include_str!("../../../platform/capabilities.json")).unwrap();
    let capability_check = target.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/platform/capabilities")
            .header("x-api-key", "target-key");
        then.status(200)
            .delay(Duration::from_millis(250))
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": capabilities
            }));
    });
    let snapshot = target.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/db/snapshot")
            .query_param("name", "profile-e2e")
            .header("x-api-key", "target-key");
        then.status(404);
    });
    let register = target.mock(|when, then| {
        when.method(Method::POST)
            .path("/api/pages")
            .header("x-api-key", "target-key")
            .json_body_obj(&serde_json::json!({"name": "profile-e2e"}));
        then.status(409)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": false,
                "error": "Page name already exists"
            }));
    });
    let forbidden_local_data = target.mock(|when, then| {
        when.method(Method::POST)
            .path("/api/upload")
            .body_contains("LOCAL_PRIVATE_DATA_SENTINEL");
        then.status(500)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": false,
                "error": "local application data leaked"
            }));
    });
    let upload = target.mock(|when, then| {
        when.method(Method::POST)
            .path("/api/upload")
            .header("x-api-key", "target-key")
            .body_contains("PUBLISHED_CODE_SENTINEL");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": {
                    "name": "profile-e2e",
                    "url": target.url("/owner/profile-e2e/"),
                    "rawUrl": target.url("/serve/owner/profile-e2e/"),
                    "version": 7
                }
            }));
    });
    let deployed_page = target.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/pages/profile-e2e")
            .header("x-api-key", "target-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": {
                    "userId": "owner",
                    "currentVersion": 7
                }
            }));
    });
    let verification_sessions = target.mock(|when, then| {
        when.method(Method::POST)
            .path("/api/verification/sessions")
            .header("x-api-key", "target-key")
            .body_contains("\"app\":\"profile-e2e\"")
            .body_contains("\"version\":7");
        then.status(201)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": {
                    "id": "verification-session",
                    "openUrl": target.url("/verification/open")
                }
            }));
    });
    let exchange = target.mock(|when, then| {
        when.method(Method::GET).path("/verification/open");
        then.status(302)
            .header("location", "/owner/profile-e2e/")
            .header(
                "set-cookie",
                "localapp_verify=verification-cookie; Path=/; HttpOnly; SameSite=Strict",
            );
    });
    let shell = target.mock(|when, then| {
        when.method(Method::GET).path("/owner/profile-e2e/");
        then.status(200).body("<main>formal shell</main>");
    });
    let raw_entry = target.mock(|when, then| {
        when.method(Method::GET).path("/serve/owner/profile-e2e/");
        then.status(200).body("<div>PUBLISHED_CODE_SENTINEL</div>");
    });
    let time_api = target.mock(|when, then| {
        when.method(Method::GET)
            .path("/serve/owner/profile-e2e/api/time");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({"success": true, "data": {"now": 1}}));
    });
    let verification_identity = target.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/me")
            .header("referer", target.url("/owner/profile-e2e/"));
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": {"id": "verification-owner"}
            }));
    });
    let smoke_report = target.mock(|when, then| {
        when.method(Method::POST)
            .path("/serve/owner/profile-e2e/api/_verification/report")
            .body_contains("\"status\":\"passed\"");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({"success": true}));
    });

    let config = tempdir().unwrap();
    add_profile(config.path(), "active", &active.base_url(), "active-key");
    add_profile(config.path(), "target", &target.base_url(), "target-key");
    assert_success(&run_cli(config.path(), &["server", "use", "target"]));

    let project = tempdir().unwrap();
    fs::create_dir_all(project.path().join("dist")).unwrap();
    fs::write(
        project.path().join("manifest.json"),
        r#"{
          "name": "profile-e2e",
          "description": "Profile E2E",
          "distDir": "dist",
          "platformVersion": "^1.0"
        }"#,
    )
    .unwrap();
    fs::write(
        project.path().join("dist/index.html"),
        "<div>PUBLISHED_CODE_SENTINEL</div>",
    )
    .unwrap();
    for (path, contents) in [
        (".localapp/dev.db", "LOCAL_PRIVATE_DATA_SENTINEL"),
        (
            "app-data/profile-e2e/files/private.txt",
            "LOCAL_PRIVATE_DATA_SENTINEL",
        ),
        (
            "app-data/profile-e2e/backups/v1.db",
            "LOCAL_PRIVATE_DATA_SENTINEL",
        ),
        (
            "app-data/profile-e2e/manifest.platform.json",
            "LOCAL_PRIVATE_DATA_SENTINEL",
        ),
    ] {
        let target = project.path().join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, contents).unwrap();
    }

    let config_path = config.path().to_path_buf();
    let switch_active = thread::spawn(move || {
        thread::sleep(Duration::from_millis(75));
        let output = run_cli(&config_path, &["server", "use", "active"]);
        assert_success(&output);
    });
    let output = cli_command(config.path())
        .args(["upload", "./dist", "--profile", "target", "--verify"])
        .current_dir(project.path())
        .output()
        .unwrap();
    switch_active.join().unwrap();

    assert_success(&output);
    active_request.assert_hits(0);
    capability_check.assert_hits(2);
    snapshot.assert();
    register.assert();
    forbidden_local_data.assert_hits(0);
    upload.assert();
    deployed_page.assert();
    verification_sessions.assert_hits(2);
    exchange.assert();
    shell.assert();
    raw_entry.assert();
    time_api.assert();
    verification_identity.assert();
    smoke_report.assert();
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["success"], true);
    assert_eq!(response["status"], "pending-browser");
    assert_eq!(response["profile"], "target");
    assert_eq!(response["serverUrl"], target.base_url());
    assert_eq!(response["url"], target.url("/owner/profile-e2e/"));
    let profiles: serde_json::Value =
        serde_json::from_slice(&fs::read(config.path().join("servers.json")).unwrap()).unwrap();
    assert_eq!(profiles["activeProfile"], "active");
}
