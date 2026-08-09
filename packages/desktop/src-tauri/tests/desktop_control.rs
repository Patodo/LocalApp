use localapp_core::{AppPackageMetadata, build_app_package};
use localapp_desktop::desktop_control::DesktopControlServer;
use localapp_desktop::local_apps::LocalAppRepository;
use localapp_desktop::local_runtime::{
    LocalRuntimeController, LocalRuntimeLaunch, LocalRuntimeStatus,
};
use localapp_desktop::paths::DesktopPaths;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tempfile::TempDir;

#[tokio::test]
async fn publishes_authenticated_loopback_install_control_and_cleans_up() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let control_file = root.path().join("config/desktop-control.json");
    let package = build_package(root.path());
    repository.ensure_registry().unwrap();
    let runtime = local_runtime(&paths);
    runtime.start().await.unwrap();

    let server = DesktopControlServer::start(
        repository.clone(),
        Some(runtime.clone()),
        "test-private-control-token".into(),
        control_file.clone(),
    )
    .await
    .unwrap();
    let published: serde_json::Value =
        serde_json::from_slice(&fs::read(&control_file).unwrap()).unwrap();
    assert_eq!(published["endpoint"], server.endpoint());
    assert_eq!(published["token"], "test-private-control-token");
    assert!(server.endpoint().starts_with("http://127.0.0.1:"));

    let client = reqwest::Client::new();
    let unauthorized = client
        .post(format!("{}/control/apps/install", server.endpoint()))
        .json(&serde_json::json!({ "packagePath": package }))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);
    assert!(repository.list().unwrap().is_empty());

    let installed: serde_json::Value = client
        .post(format!("{}/control/apps/install", server.endpoint()))
        .bearer_auth("test-private-control-token")
        .json(&serde_json::json!({ "packagePath": package }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(installed["success"], true);
    assert_eq!(installed["data"]["appId"], "desktop-control-test");
    assert_eq!(installed["data"]["version"], "1.0.0");
    assert_eq!(installed["data"]["openable"], true);
    assert_eq!(repository.list().unwrap().len(), 1);

    server.stop().await;
    runtime.stop().await.unwrap();
    assert!(!control_file.exists());
}

#[tokio::test]
async fn online_upgrade_uses_actual_runtime_health_and_restores_version_and_database() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    repository.ensure_registry().unwrap();
    let runtime = local_runtime(&paths);
    runtime.start().await.unwrap();
    let server = DesktopControlServer::start(
        repository.clone(),
        Some(runtime.clone()),
        "test-desktop-control-token".into(),
        root.path().join("desktop-control.json"),
    )
    .await
    .unwrap();
    let client = reqwest::Client::new();
    let v1 = build_versioned_package(root.path(), "1.0.0", false);
    let installed = client
        .post(format!("{}/control/apps/install", server.endpoint()))
        .bearer_auth("test-desktop-control-token")
        .json(&serde_json::json!({ "packagePath": v1 }))
        .send()
        .await
        .unwrap();
    assert_eq!(installed.status(), reqwest::StatusCode::OK);

    runtime.stop().await.unwrap();
    let database = paths.app_data().join("desktop-control-test/app.db");
    rusqlite::Connection::open(&database)
        .unwrap()
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS user_state(value TEXT);
             INSERT INTO user_state(value) VALUES ('before upgrade');",
        )
        .unwrap();
    runtime.start().await.unwrap();
    runtime
        .check_app_health("desktop-control-test")
        .await
        .unwrap();

    let broken_v2 = build_versioned_package(root.path(), "2.0.0", true);
    let rejected = client
        .post(format!("{}/control/apps/install", server.endpoint()))
        .bearer_auth("test-desktop-control-token")
        .json(&serde_json::json!({ "packagePath": broken_v2 }))
        .send()
        .await
        .unwrap();
    assert_eq!(rejected.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(repository.list().unwrap()[0].current_version, "1.0.0");
    let value: String = rusqlite::Connection::open(&database)
        .unwrap()
        .query_row("SELECT value FROM user_state", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "before upgrade");
    assert_eq!(runtime.snapshot().await.status, LocalRuntimeStatus::Running);
    runtime
        .check_app_health("desktop-control-test")
        .await
        .unwrap();

    let upgrade_a = build_versioned_package(root.path(), "2.0.0", false);
    let upgrade_b = build_versioned_package(root.path(), "3.0.0", false);
    let endpoint = format!("{}/control/apps/install", server.endpoint());
    let first = client
        .post(&endpoint)
        .bearer_auth("test-desktop-control-token")
        .json(&serde_json::json!({ "packagePath": upgrade_a }))
        .send();
    let second = client
        .post(&endpoint)
        .bearer_auth("test-desktop-control-token")
        .json(&serde_json::json!({ "packagePath": upgrade_b }))
        .send();
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.unwrap().status(), reqwest::StatusCode::OK);
    assert_eq!(second.unwrap().status(), reqwest::StatusCode::OK);
    let upgraded = repository.list().unwrap().pop().unwrap();
    assert!(upgraded.installed_versions.contains(&"2.0.0".to_string()));
    assert!(upgraded.installed_versions.contains(&"3.0.0".to_string()));
    assert_eq!(runtime.snapshot().await.status, LocalRuntimeStatus::Running);
    runtime
        .check_app_health("desktop-control-test")
        .await
        .unwrap();

    server.stop().await;
    runtime.stop().await.unwrap();
}

#[tokio::test]
async fn commit_failure_stops_candidate_runtime_before_rollback_and_restarts_old_version() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    repository.ensure_registry().unwrap();
    let runtime = local_runtime(&paths);
    runtime.start().await.unwrap();
    let server = DesktopControlServer::start(
        repository.clone(),
        Some(runtime.clone()),
        "test-desktop-control-token".into(),
        root.path().join("desktop-control.json"),
    )
    .await
    .unwrap();
    let client = reqwest::Client::new();
    let v1 = build_versioned_package(root.path(), "1.0.0", false);
    let installed = client
        .post(format!("{}/control/apps/install", server.endpoint()))
        .bearer_auth("test-desktop-control-token")
        .json(&serde_json::json!({ "packagePath": v1 }))
        .send()
        .await
        .unwrap();
    assert_eq!(installed.status(), reqwest::StatusCode::OK);

    let journals = paths.root().join("app-installs");
    let injector = tokio::spawn(async move {
        for _ in 0..500 {
            if let Ok(entries) = fs::read_dir(&journals) {
                for entry in entries.flatten() {
                    if !entry.file_name().to_string_lossy().starts_with(".staging-") {
                        let receipts = journals.parent().unwrap().join("app-install-commits");
                        fs::create_dir_all(&receipts).unwrap();
                        let committed = receipts.join(entry.file_name());
                        if !committed.exists() {
                            fs::create_dir(&committed).unwrap();
                            return;
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("install transaction journal did not appear");
    });
    let v2 = build_versioned_package(root.path(), "2.0.0", false);
    let rejected = client
        .post(format!("{}/control/apps/install", server.endpoint()))
        .bearer_auth("test-desktop-control-token")
        .json(&serde_json::json!({ "packagePath": v2 }))
        .send()
        .await
        .unwrap();
    injector.await.unwrap();

    assert_eq!(rejected.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(repository.list().unwrap()[0].current_version, "1.0.0");
    assert_eq!(runtime.snapshot().await.status, LocalRuntimeStatus::Running);
    runtime
        .check_app_health("desktop-control-test")
        .await
        .unwrap();

    server.stop().await;
    runtime.stop().await.unwrap();
}

fn local_runtime(paths: &DesktopPaths) -> LocalRuntimeController {
    LocalRuntimeController::new(LocalRuntimeLaunch {
        node: PathBuf::from("node"),
        script: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/local-runtime/localapp-local-runtime.mjs"),
        registry: paths.local_runtime_registry(),
        control_token: "test-runtime-control-token".into(),
        port: 0,
        ready_timeout: Duration::from_secs(10),
        restart_delay: Duration::from_millis(100),
        restart_limit: 1,
        resources: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/local-runtime"),
    })
}

fn build_package(root: &std::path::Path) -> std::path::PathBuf {
    build_versioned_package(root, "1.0.0", false)
}

fn build_versioned_package(
    root: &std::path::Path,
    version: &str,
    invalid_backend: bool,
) -> std::path::PathBuf {
    let project = root.join(format!("project-{version}"));
    fs::create_dir_all(project.join("dist")).unwrap();
    fs::create_dir_all(project.join("backend/resources/items")).unwrap();
    fs::write(
        project.join("manifest.json"),
        r#"{"name":"desktop-control-test","platformVersion":"^1.0"}"#,
    )
    .unwrap();
    fs::write(project.join("dist/index.html"), "<main>ready</main>").unwrap();
    fs::write(
        project.join("backend/resources/items/schema.json"),
        if invalid_backend {
            "{not-json".to_string()
        } else {
            serde_json::json!({
                "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
                "name": "items",
                "fields": { "id": { "type": "text" } }
            })
            .to_string()
        },
    )
    .unwrap();
    let package = root.join(format!("desktop-control-test-{version}.localapp"));
    build_app_package(
        &project,
        &package,
        AppPackageMetadata {
            schema_version: 1,
            app_id: "desktop-control-test".into(),
            version: version.into(),
            platform_version: "^1.0".into(),
        },
    )
    .unwrap();
    package
}
