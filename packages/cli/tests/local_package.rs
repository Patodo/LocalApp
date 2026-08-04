use httpmock::{Method, MockServer};
use std::fs;
use std::process::Command;
use tempfile::tempdir;

#[test]
fn build_package_succeeds_without_server_configuration() {
    let project = tempdir().unwrap();
    let config = tempdir().unwrap();
    fs::create_dir_all(project.path().join("dist")).unwrap();
    fs::write(
        project.path().join("manifest.json"),
        r#"{
          "name": "offline-notes",
          "description": "Offline notes",
          "distDir": "dist",
          "platformVersion": "^1.0"
        }"#,
    )
    .unwrap();
    fs::write(
        project.path().join("package.json"),
        r#"{"name":"offline-notes","version":"1.4.0"}"#,
    )
    .unwrap();
    fs::write(
        project.path().join("dist/index.html"),
        "<div id=\"root\"></div>",
    )
    .unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(["build", "--package", "--output", "offline-notes.localapp"])
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
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["success"], true);
    assert_eq!(response["appId"], "offline-notes");
    assert_eq!(response["version"], "1.4.0");
    assert!(project.path().join("offline-notes.localapp").is_file());
}

#[test]
fn local_install_uses_the_authenticated_desktop_control_channel() {
    let desktop = MockServer::start();
    let install = desktop.mock(|when, then| {
        when.method(Method::POST)
            .path("/control/apps/install")
            .header("authorization", "Bearer desktop-secret")
            .body_contains("offline-notes.localapp");
        then.status(200)
            .header("content-type", "application/json")
            .json_body_obj(&serde_json::json!({
                "success": true,
                "data": {
                    "appId": "offline-notes",
                    "version": "1.4.0",
                    "upgraded": false,
                    "openable": true
                }
            }));
    });
    let config = tempdir().unwrap();
    let project = tempdir().unwrap();
    let package = project.path().join("offline-notes.localapp");
    fs::write(&package, b"package placeholder").unwrap();
    fs::write(
        config.path().join("desktop-control.json"),
        serde_json::to_vec(&serde_json::json!({
            "endpoint": desktop.base_url(),
            "token": "desktop-secret"
        }))
        .unwrap(),
    )
    .unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(["local", "install", package.to_str().unwrap()])
        .env("LOCALAPP_CONFIG_DIR", config.path())
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    install.assert();
    let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["success"], true);
    assert_eq!(response["appId"], "offline-notes");
    assert_eq!(response["version"], "1.4.0");
    assert_eq!(response["openable"], true);
}
