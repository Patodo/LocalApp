use localapp_core::{AppPackageMetadata, build_app_package};
use localapp_desktop::local_apps::LocalAppRepository;
use localapp_desktop::local_runtime::{
    LocalRuntimeController, LocalRuntimeLaunch, LocalRuntimeStatus,
};
use localapp_desktop::paths::DesktopPaths;
use reqwest::header::{COOKIE, HOST, SET_COOKIE};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::TempDir;

const CONTROL_TOKEN: &str = "desktop-local-runtime-e2e";

#[test]
fn rejects_corrupt_and_traversing_packages_without_touching_installed_state() {
    let fixture = DesktopFixture::new();
    let installed = fixture.package("notes-app", "1.0.0", &[valid_migration()]);
    fixture.repository.install(&installed).unwrap();
    let data_file = fixture
        .paths
        .app_data()
        .join("notes-app/files/existing.txt");
    fs::write(&data_file, "keep me").unwrap();
    let registry_before = fs::read(fixture.paths.local_app_registry()).unwrap();

    let corrupt = fixture.package("notes-app", "2.0.0", &[valid_migration()]);
    corrupt_zip_entry(&corrupt, "dist/assets/app.js");
    let corrupt_error = fixture.repository.install(&corrupt).unwrap_err();
    assert!(
        corrupt_error.contains("checksum")
            || corrupt_error.contains("CRC")
            || corrupt_error.contains("corrupt")
            || corrupt_error.contains("invalid"),
        "corrupt package should return an actionable validation error: {corrupt_error}"
    );

    let traversing = fixture.package("notes-app", "2.0.1", &[valid_migration()]);
    rewrite_zip_entry_name(&traversing, "dist/index.html", "../x/index.html");
    let traversal_error = fixture.repository.install(&traversing).unwrap_err();
    assert!(
        traversal_error.contains("unsafe package path"),
        "path traversal should be identified: {traversal_error}"
    );

    assert_eq!(
        fs::read(fixture.paths.local_app_registry()).unwrap(),
        registry_before
    );
    assert_eq!(fs::read_to_string(data_file).unwrap(), "keep me");
    let apps = fixture.repository.list().unwrap();
    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0].current_version, "1.0.0");
    assert!(
        !fixture
            .paths
            .apps()
            .join("notes-app/versions/2.0.0")
            .exists()
    );
    assert!(
        !fixture
            .paths
            .apps()
            .join("notes-app/versions/2.0.1")
            .exists()
    );
}

#[test]
fn installs_rolls_back_failed_upgrade_and_uninstalls_without_deleting_user_data() {
    let fixture = DesktopFixture::new();
    let notes_v1 = fixture.package("notes-app", "1.0.0", &[valid_migration()]);
    let calendar_v1 = fixture.package("calendar-app", "1.0.0", &[valid_migration()]);

    let outcome = fixture.repository.install(&notes_v1).unwrap();
    fixture.repository.install(&calendar_v1).unwrap();
    assert_eq!(outcome.app_id, "notes-app");
    assert_eq!(outcome.version, "1.0.0");
    assert!(!outcome.upgraded);

    let notes = fixture
        .repository
        .list()
        .unwrap()
        .into_iter()
        .find(|app| app.app_id == "notes-app")
        .unwrap();
    assert!(notes.version_root.join("dist/index.html").is_file());
    assert!(notes.data_root.join("app.db").is_file());
    assert!(notes.data_root.join("files").is_dir());
    assert!(notes.data_root.join("backups").is_dir());

    let database = notes.data_root.join("app.db");
    Connection::open(&database)
        .unwrap()
        .execute(
            "INSERT INTO items(id, title) VALUES ('one', 'before upgrade')",
            [],
        )
        .unwrap();
    fs::write(notes.data_root.join("files/attachment.txt"), "user file").unwrap();
    fs::write(notes.data_root.join("backups/manual.db"), "backup").unwrap();
    let calendar_database = fixture.paths.app_data().join("calendar-app/app.db");
    let calendar_before = fs::read(&calendar_database).unwrap();

    let broken_upgrade = fixture.package(
        "notes-app",
        "2.0.0",
        &[
            valid_migration(),
            (
                "002_broken.sql",
                "ALTER TABLE items ADD COLUMN detail TEXT; THIS IS NOT SQL;",
            ),
        ],
    );
    let error = fixture.repository.install(&broken_upgrade).unwrap_err();
    assert!(error.contains("migration failed"), "{error}");

    let restored = fixture
        .repository
        .list()
        .unwrap()
        .into_iter()
        .find(|app| app.app_id == "notes-app")
        .unwrap();
    assert_eq!(restored.current_version, "1.0.0");
    assert!(
        !fixture
            .paths
            .apps()
            .join("notes-app/versions/2.0.0")
            .exists()
    );
    let title: String = Connection::open(&database)
        .unwrap()
        .query_row("SELECT title FROM items WHERE id = 'one'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "before upgrade");
    assert_eq!(fs::read(&calendar_database).unwrap(), calendar_before);

    fixture.repository.uninstall("notes-app").unwrap();
    assert!(
        fixture
            .repository
            .list()
            .unwrap()
            .iter()
            .all(|app| app.app_id != "notes-app")
    );
    assert!(!fixture.paths.apps().join("notes-app").exists());
    assert!(database.is_file());
    assert!(notes.data_root.join("files/attachment.txt").is_file());
    assert!(notes.data_root.join("backups/manual.db").is_file());
}

#[tokio::test]
async fn one_runtime_opens_two_apps_and_restores_them_after_desktop_restart() {
    let fixture = DesktopFixture::new();
    for app_id in ["notes-app", "calendar-app"] {
        let package = fixture.package(app_id, "1.0.0", &[valid_migration()]);
        fixture.repository.install(&package).unwrap();
    }

    let controller = fixture.runtime();
    let first_ready = controller.start().await.unwrap();
    let notes = open_app(first_ready.port, "notes-app").await;
    let calendar = open_app(first_ready.port, "calendar-app").await;

    assert_eq!(
        controller.snapshot().await.ready.unwrap().pid,
        first_ready.pid,
        "both applications must be hosted by the same runtime process"
    );
    assert!(notes.url.starts_with(&format!(
        "http://notes-app.localhost:{}/?ticket=",
        first_ready.port
    )));
    assert!(calendar.url.starts_with(&format!(
        "http://calendar-app.localhost:{}/?ticket=",
        first_ready.port
    )));
    assert!(notes.shell.contains("data-localapp-local-shell=\"true\""));
    assert!(notes.shell.contains("<strong>notes-app</strong>"));
    assert_eq!(notes.identity["data"]["id"], "local-user");
    assert_eq!(calendar.identity["data"]["id"], "local-user");
    assert_ne!(
        fixture.paths.app_data().join("notes-app"),
        fixture.paths.app_data().join("calendar-app")
    );
    assert!(fixture.paths.app_data().join("notes-app/app.db").is_file());
    assert!(
        fixture
            .paths
            .app_data()
            .join("calendar-app/app.db")
            .is_file()
    );

    controller.stop().await.unwrap();
    drop(controller);

    let restored_repository = LocalAppRepository::new(fixture.paths.clone());
    let restored = restored_repository.list().unwrap();
    assert_eq!(
        restored
            .iter()
            .map(|app| app.app_id.as_str())
            .collect::<Vec<_>>(),
        ["calendar-app", "notes-app"]
    );

    let restarted = fixture.runtime();
    let second_ready = restarted.start().await.unwrap();
    assert_ne!(second_ready.pid, first_ready.pid);
    let reopened = open_app(second_ready.port, "notes-app").await;
    assert_eq!(reopened.identity["data"]["id"], "local-user");
    restarted.stop().await.unwrap();
}

#[tokio::test]
async fn runtime_survives_a_hidden_window_and_stops_only_on_explicit_exit() {
    let fixture = DesktopFixture::new();
    let package = fixture.package("tray-app", "1.0.0", &[valid_migration()]);
    fixture.repository.install(&package).unwrap();
    let window_controller = fixture.runtime();
    let ready = window_controller.start().await.unwrap();

    let tray_controller = window_controller.clone();
    drop(window_controller);
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        tray_controller.snapshot().await.status,
        LocalRuntimeStatus::Running
    );
    assert_control_health(ready.port).await;

    tray_controller.stop().await.unwrap();
    assert_eq!(
        tray_controller.snapshot().await.status,
        LocalRuntimeStatus::Stopped
    );
    let unavailable = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{}/health", ready.port))
        .header(HOST, format!("control.localhost:{}", ready.port))
        .timeout(Duration::from_millis(300))
        .send()
        .await;
    assert!(
        unavailable.is_err(),
        "explicit exit must stop the runtime listener"
    );
}

struct DesktopFixture {
    _root: TempDir,
    paths: DesktopPaths,
    repository: LocalAppRepository,
    packages: PathBuf,
}

impl DesktopFixture {
    fn new() -> Self {
        let root = TempDir::new().unwrap();
        let paths = DesktopPaths::from_root(root.path().join("desktop"));
        paths.ensure().unwrap();
        let repository = LocalAppRepository::new(paths.clone());
        repository.ensure_registry().unwrap();
        Self {
            packages: root.path().join("packages"),
            _root: root,
            paths,
            repository,
        }
    }

    fn package(&self, app_id: &str, version: &str, migrations: &[(&str, &str)]) -> PathBuf {
        let project = self.packages.join(format!("{app_id}-{version}-source"));
        fs::create_dir_all(project.join("dist/assets")).unwrap();
        fs::create_dir_all(project.join("migrations")).unwrap();
        fs::create_dir_all(project.join("backend/resources/items")).unwrap();
        fs::write(
            project.join("manifest.json"),
            json!({ "name": app_id, "platformVersion": "^1.0" }).to_string(),
        )
        .unwrap();
        fs::write(
            project.join("dist/index.html"),
            format!(
                "<!doctype html><html><body><main id=\"root\">{app_id}</main>\
                 <script src=\"/assets/app.js\"></script></body></html>"
            ),
        )
        .unwrap();
        fs::write(
            project.join("dist/assets/app.js"),
            format!("document.body.dataset.app = {app_id:?};"),
        )
        .unwrap();
        fs::write(
            project.join("backend/resources/items/schema.json"),
            json!({
                "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
                "name": "items",
                "fields": {
                    "id": { "type": "text" },
                    "title": { "type": "text", "constraints": { "required": true } }
                }
            })
            .to_string(),
        )
        .unwrap();
        for (name, sql) in migrations {
            fs::write(project.join("migrations").join(name), sql).unwrap();
        }
        let package = self.packages.join(format!("{app_id}-{version}.localapp"));
        build_app_package(
            &project,
            &package,
            AppPackageMetadata {
                schema_version: 1,
                app_id: app_id.into(),
                version: version.into(),
                platform_version: "^1.0".into(),
            },
        )
        .unwrap();
        package
    }

    fn runtime(&self) -> LocalRuntimeController {
        let manifest_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let script = manifest_directory.join("resources/local-runtime/localapp-local-runtime.mjs");
        assert!(
            script.is_file(),
            "build the Desktop Local Runtime bundle before running this test: {}",
            script.display()
        );
        LocalRuntimeController::new(LocalRuntimeLaunch {
            node: PathBuf::from("node"),
            script,
            registry: self.paths.local_runtime_registry(),
            control_token: CONTROL_TOKEN.into(),
            port: 0,
            ready_timeout: Duration::from_secs(10),
            restart_delay: Duration::from_millis(100),
            restart_limit: 1,
        })
    }
}

struct OpenedApp {
    url: String,
    shell: String,
    identity: Value,
}

async fn open_app(port: u16, app_id: &str) -> OpenedApp {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let endpoint = format!("http://127.0.0.1:{port}");
    let ticket_response = client
        .post(format!("{endpoint}/control/tickets"))
        .header(HOST, format!("control.localhost:{port}"))
        .bearer_auth(CONTROL_TOKEN)
        .json(&json!({ "appId": app_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(ticket_response.status(), reqwest::StatusCode::OK);
    let ticket: Value = ticket_response.json().await.unwrap();
    let ticket_value = ticket["data"]["ticket"].as_str().unwrap();
    let url = ticket["data"]["url"].as_str().unwrap().to_string();

    let exchange = client
        .get(format!("{endpoint}/?ticket={ticket_value}"))
        .header(HOST, format!("{app_id}.localhost:{port}"))
        .send()
        .await
        .unwrap();
    assert_eq!(exchange.status(), reqwest::StatusCode::FOUND);
    let cookie = exchange
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();

    let replay = client
        .get(format!("{endpoint}/?ticket={ticket_value}"))
        .header(HOST, format!("{app_id}.localhost:{port}"))
        .send()
        .await
        .unwrap();
    assert_eq!(replay.status(), reqwest::StatusCode::UNAUTHORIZED);

    let shell = client
        .get(format!("{endpoint}/"))
        .header(HOST, format!("{app_id}.localhost:{port}"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .unwrap();
    let shell_status = shell.status();
    let shell = shell.text().await.unwrap();
    assert_eq!(
        shell_status,
        reqwest::StatusCode::OK,
        "Local Platform Shell failed for {app_id}: {shell}"
    );
    let identity = client
        .get(format!("{endpoint}/api/me"))
        .header(HOST, format!("{app_id}.localhost:{port}"))
        .header(COOKIE, cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(identity.status(), reqwest::StatusCode::OK);

    OpenedApp {
        url,
        shell,
        identity: identity.json().await.unwrap(),
    }
}

async fn assert_control_health(port: u16) {
    let response = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/health"))
        .header(HOST, format!("control.localhost:{port}"))
        .bearer_auth(CONTROL_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(response.json::<Value>().await.unwrap()["success"], true);
}

fn valid_migration() -> (&'static str, &'static str) {
    (
        "001_init.sql",
        "CREATE TABLE items(id TEXT PRIMARY KEY, title TEXT NOT NULL);",
    )
}

fn rewrite_zip_entry_name(package: &Path, from: &str, to: &str) {
    assert_eq!(from.len(), to.len());
    let mut bytes = fs::read(package).unwrap();
    let mut replacements = 0;
    let mut offset = 0;
    while offset + 46 <= bytes.len() {
        let (name_length_offset, name_offset) = if bytes[offset..].starts_with(b"PK\x03\x04") {
            (offset + 26, offset + 30)
        } else if bytes[offset..].starts_with(b"PK\x01\x02") {
            (offset + 28, offset + 46)
        } else {
            offset += 1;
            continue;
        };
        let name_length =
            u16::from_le_bytes([bytes[name_length_offset], bytes[name_length_offset + 1]]) as usize;
        let name_end = name_offset + name_length;
        if name_end <= bytes.len() && &bytes[name_offset..name_end] == from.as_bytes() {
            bytes[name_offset..name_end].copy_from_slice(to.as_bytes());
            replacements += 1;
        }
        offset = name_end;
    }
    assert_eq!(replacements, 2, "expected local and central ZIP headers");
    fs::write(package, bytes).unwrap();
}

fn corrupt_zip_entry(package: &Path, target: &str) {
    let mut bytes = fs::read(package).unwrap();
    let mut offset = 0;
    while offset + 30 <= bytes.len() {
        if !bytes[offset..].starts_with(b"PK\x03\x04") {
            offset += 1;
            continue;
        }
        let compressed_size = u32::from_le_bytes([
            bytes[offset + 18],
            bytes[offset + 19],
            bytes[offset + 20],
            bytes[offset + 21],
        ]) as usize;
        let name_length = u16::from_le_bytes([bytes[offset + 26], bytes[offset + 27]]) as usize;
        let extra_length = u16::from_le_bytes([bytes[offset + 28], bytes[offset + 29]]) as usize;
        let name_start = offset + 30;
        let name_end = name_start + name_length;
        let data_start = name_end + extra_length;
        let data_end = data_start + compressed_size;
        if data_end > bytes.len() {
            break;
        }
        if &bytes[name_start..name_end] == target.as_bytes() {
            assert!(compressed_size > 2);
            bytes[data_start + compressed_size / 2] ^= 0xff;
            fs::write(package, bytes).unwrap();
            return;
        }
        offset = data_end;
    }
    panic!("ZIP entry not found: {target}");
}
