use httpmock::{Method, MockServer};
use localapp_core::{extract_app_package, inspect_app_package};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::tempdir;

fn run_cli(project: &Path, config_dir: &Path, arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(arguments)
        .current_dir(project)
        .env("LOCALAPP_CONFIG_DIR", config_dir)
        .env_remove("LOCALAPP_SERVER_URL")
        .env_remove("LOCALAPP_API_KEY")
        .env_remove("LOCALAPP_PROFILE")
        .output()
        .unwrap()
}

fn write_project(project: &Path) {
    fs::create_dir_all(project.join("dist/assets")).unwrap();
    fs::write(
        project.join("manifest.json"),
        r#"{
          "name": "offline-notes",
          "description": "Offline notes",
          "distDir": "dist",
          "platformVersion": "^1.0"
        }"#,
    )
    .unwrap();
    fs::write(
        project.join("package.json"),
        r#"{"name":"offline-notes","version":"1.4.0"}"#,
    )
    .unwrap();
    fs::write(
        project.join("dist/index.html"),
        "<div id=\"root\">OFFLINE_PACKAGE_ENTRY</div>",
    )
    .unwrap();
    fs::write(
        project.join("dist/assets/app.js"),
        "globalThis.offlineNotes = true;",
    )
    .unwrap();
}

fn build_package(project: &Path, config_dir: &Path, output_name: &str) -> serde_json::Value {
    let output = run_cli(
        project,
        config_dir,
        &["build", "--package", "--output", output_name],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn failed_build(project: &Path, config_dir: &Path, output_name: &str) -> String {
    let output = run_cli(
        project,
        config_dir,
        &["build", "--package", "--output", output_name],
    );
    assert!(
        !output.status.success(),
        "build unexpectedly succeeded: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn offline_build_ignores_remote_configuration_and_emits_a_valid_package() {
    let remote = MockServer::start();
    let unexpected_remote_request = remote.mock(|_when, then| {
        then.status(500);
    });
    let project = tempdir().unwrap();
    let config = tempdir().unwrap();
    write_project(project.path());
    fs::write(
        config.path().join("config.json"),
        serde_json::to_vec(&serde_json::json!({
            "server_url": remote.base_url(),
            "api_key": "test-remote-key-that-must-not-be-read"
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(config.path().join("servers.json"), b"not valid JSON").unwrap();

    let response = build_package(project.path(), config.path(), "offline-notes.localapp");

    unexpected_remote_request.assert_hits(0);
    assert_eq!(response["success"], true);
    assert_eq!(response["appId"], "offline-notes");
    assert_eq!(response["version"], "1.4.0");
    assert!(
        response["sha256"]
            .as_str()
            .is_some_and(|value| value.len() == 64)
    );
    assert!(response["size"].as_u64().is_some_and(|size| size > 0));
    let package = project.path().join("offline-notes.localapp");
    let reported_package = PathBuf::from(response["path"].as_str().unwrap())
        .canonicalize()
        .unwrap();
    assert_eq!(reported_package, package.canonicalize().unwrap());
    let inspection = inspect_app_package(&package).unwrap();
    assert_eq!(inspection.metadata.app_id, "offline-notes");
    assert_eq!(inspection.metadata.version, "1.4.0");
}

#[test]
fn application_package_excludes_local_data_files_and_platform_configuration() {
    let project = tempdir().unwrap();
    let config = tempdir().unwrap();
    write_project(project.path());
    fs::create_dir_all(project.path().join("migrations")).unwrap();
    fs::write(
        project.path().join("migrations/001_create_notes.sql"),
        "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL);",
    )
    .unwrap();

    for (path, contents) in [
        (".localapp/dev.db", "LOCAL_PRIVATE_DB"),
        (".localapp/files/private.txt", "LOCAL_PRIVATE_FILE"),
        ("app-data/offline-notes/app.db", "LOCAL_PRIVATE_APP_DB"),
        (
            "app-data/offline-notes/files/private.txt",
            "LOCAL_PRIVATE_APP_FILE",
        ),
        (
            "app-data/offline-notes/backups/v1.db",
            "LOCAL_PRIVATE_BACKUP",
        ),
        (
            "app-data/offline-notes/manifest.platform.json",
            "LOCAL_PRIVATE_PLATFORM",
        ),
        ("manifest.platform.json", "LOCAL_PRIVATE_PLATFORM_ROOT"),
        ("credentials.json", "LOCAL_PRIVATE_CREDENTIAL"),
        ("node_modules/private/index.js", "LOCAL_PRIVATE_DEPENDENCY"),
        ("server.mjs", "LOCAL_PRIVATE_SERVER_SCRIPT"),
    ] {
        let target = project.path().join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, contents).unwrap();
    }

    build_package(project.path(), config.path(), "filtered.localapp");

    let inspection = inspect_app_package(&project.path().join("filtered.localapp")).unwrap();
    assert_eq!(
        inspection.files,
        vec![
            "dist/assets/app.js",
            "dist/index.html",
            "manifest.json",
            "migrations/001_create_notes.sql",
        ]
    );
    assert!(inspection.files.iter().all(|path| {
        !path.contains("app-data")
            && !path.contains(".localapp")
            && !path.contains("manifest.platform")
            && !path.contains("credential")
            && !path.contains("node_modules")
            && !path.ends_with(".db")
    }));
}

#[test]
fn custom_manifest_paths_are_packaged_into_the_canonical_layout() {
    let project = tempdir().unwrap();
    let config = tempdir().unwrap();
    fs::create_dir_all(project.path().join("web-output/assets")).unwrap();
    fs::create_dir_all(project.path().join("contracts/resources/root_items")).unwrap();
    fs::create_dir_all(project.path().join("included/resources/included_items")).unwrap();
    fs::write(
        project.path().join("manifest.json"),
        r#"{
          "name": "custom-layout",
          "distDir": "web-output",
          "backend": {
            "root": "contracts",
            "include": [
              "included/resources/**/queries.json",
              "contracts/resources/**/schema.json"
            ]
          },
          "platformVersion": "^1.0"
        }"#,
    )
    .unwrap();
    fs::write(
        project.path().join("package.json"),
        r#"{"name":"custom-layout","version":"2.0.0"}"#,
    )
    .unwrap();
    fs::write(
        project.path().join("web-output/index.html"),
        "<div>CUSTOM_DIST_ENTRY</div>",
    )
    .unwrap();
    fs::write(
        project.path().join("web-output/assets/app.js"),
        "globalThis.customLayout = true;",
    )
    .unwrap();
    fs::write(
        project
            .path()
            .join("contracts/resources/root_items/schema.json"),
        r#"{"$schema":"https://localapp.dev/schemas/backend/resource-schema.schema.json","name":"root_items","fields":{}}"#,
    )
    .unwrap();
    fs::write(
        project
            .path()
            .join("included/resources/included_items/queries.json"),
        r#"{"$schema":"https://localapp.dev/schemas/backend/queries.schema.json","queries":{}}"#,
    )
    .unwrap();

    build_package(project.path(), config.path(), "custom-layout.localapp");

    let package = project.path().join("custom-layout.localapp");
    let inspection = inspect_app_package(&package).unwrap();
    assert_eq!(
        inspection.files,
        vec![
            "backend/included/resources/included_items/queries.json",
            "backend/resources/root_items/schema.json",
            "dist/assets/app.js",
            "dist/index.html",
            "manifest.json",
        ]
    );
    let extracted = tempdir().unwrap();
    extract_app_package(&package, extracted.path()).unwrap();
    let packaged_manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(extracted.path().join("manifest.json")).unwrap()).unwrap();
    assert_eq!(packaged_manifest["distDir"], "dist");
    assert_eq!(packaged_manifest["backend"]["root"], "backend");
    assert!(
        packaged_manifest["backend"]
            .get("include")
            .is_none_or(serde_json::Value::is_null)
    );
}

#[test]
fn package_build_rejects_dist_dir_outside_the_project() {
    let project = tempdir().unwrap();
    let config = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("index.html"), "<div>outside</div>").unwrap();
    fs::write(
        project.path().join("manifest.json"),
        serde_json::to_vec(&serde_json::json!({
            "name": "outside-dist",
            "distDir": outside.path(),
            "platformVersion": "^1.0"
        }))
        .unwrap(),
    )
    .unwrap();

    let error = failed_build(project.path(), config.path(), "outside-dist.localapp");

    assert!(error.contains("distDir"));
    assert!(error.contains("project"));
    assert!(!project.path().join("outside-dist.localapp").exists());
}

#[cfg(unix)]
#[test]
fn package_build_rejects_symlinks_in_custom_sources() {
    use std::os::unix::fs::symlink;

    let project = tempdir().unwrap();
    let config = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::create_dir_all(project.path().join("web-output")).unwrap();
    fs::write(
        project.path().join("manifest.json"),
        r#"{
          "name": "linked-source",
          "distDir": "web-output",
          "platformVersion": "^1.0"
        }"#,
    )
    .unwrap();
    fs::write(outside.path().join("index.html"), "<div>outside</div>").unwrap();
    symlink(
        outside.path().join("index.html"),
        project.path().join("web-output/index.html"),
    )
    .unwrap();

    let error = failed_build(project.path(), config.path(), "linked-source.localapp");

    assert!(error.contains("symlink"));
    assert!(!project.path().join("linked-source.localapp").exists());
}

#[test]
fn cli_builds_then_installs_through_the_authenticated_desktop_control_channel() {
    let desktop = MockServer::start();
    let project = tempdir().unwrap();
    let config = tempdir().unwrap();
    write_project(project.path());
    build_package(project.path(), config.path(), "offline-notes.localapp");
    let package = project
        .path()
        .join("offline-notes.localapp")
        .canonicalize()
        .unwrap();
    let install = desktop.mock(|when, then| {
        when.method(Method::POST)
            .path("/control/apps/install")
            .header("authorization", "Bearer test-desktop-control-secret")
            .body_contains(package.to_string_lossy().as_ref());
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
    fs::write(
        config.path().join("desktop-control.json"),
        serde_json::to_vec(&serde_json::json!({
            "endpoint": desktop.base_url(),
            "token": "test-desktop-control-secret"
        }))
        .unwrap(),
    )
    .unwrap();

    let output = run_cli(
        project.path(),
        config.path(),
        &["local", "install", package.to_str().unwrap()],
    );

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
