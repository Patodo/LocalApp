use localapp_desktop::local_store::{LOCAL_SCHEMA_VERSION, LocalStore};
use localapp_desktop::paths::DesktopPaths;
use localapp_desktop::task_repository::TaskRepository;
use rusqlite::Connection;
use std::fs;

#[test]
fn desktop_paths_use_the_explicit_test_root() {
    let directory = tempfile::tempdir().unwrap();
    let paths = DesktopPaths::from_root(directory.path().join("LocalApp"));

    assert_eq!(
        paths.database(),
        directory.path().join("LocalApp/desktop.sqlite3")
    );
    assert_eq!(paths.tasks(), directory.path().join("LocalApp/tasks"));
    assert_eq!(
        paths.js_environments(),
        directory.path().join("LocalApp/js-envs")
    );
    paths.ensure().unwrap();
    assert!(paths.tasks().is_dir());
    assert!(paths.js_environments().is_dir());
}

#[test]
fn empty_database_migrates_idempotently_with_required_tables() {
    let directory = tempfile::tempdir().unwrap();
    let paths = DesktopPaths::from_root(directory.path().join("data"));
    let store = LocalStore::open(paths.clone()).unwrap();
    assert_eq!(store.schema_version().unwrap(), LOCAL_SCHEMA_VERSION);
    drop(store);

    let reopened = LocalStore::open(paths.clone()).unwrap();
    assert_eq!(reopened.schema_version().unwrap(), LOCAL_SCHEMA_VERSION);
    let connection = Connection::open(paths.database()).unwrap();
    let tables: Vec<String> = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    for required in [
        "app_trusts",
        "desktop_settings",
        "js_environments",
        "local_tasks",
    ] {
        assert!(
            tables.iter().any(|table| table == required),
            "missing {required}"
        );
    }
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(journal_mode.to_ascii_lowercase(), "wal");
}

#[test]
fn version_two_upgrade_preserves_settings_trust_and_task_history() {
    let directory = tempfile::tempdir().unwrap();
    let paths = DesktopPaths::from_root(directory.path().join("data"));
    paths.ensure().unwrap();
    let connection = Connection::open(paths.database()).unwrap();
    connection
        .execute_batch(concat!(
            include_str!("../src/migrations/001_local_state.sql"),
            include_str!("../src/migrations/002_js_environments.sql"),
            "PRAGMA user_version = 2;"
        ))
        .unwrap();
    connection
        .execute(
            "INSERT INTO desktop_settings
         (id, installation_id, launch_at_login, notifications_enabled, updated_at)
         VALUES (1, '11111111-1111-4111-8111-111111111111', 1, 0, 'old')",
            [],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO app_trusts
         (server_origin, app_owner, app_name, publisher_user_id, trusted_at)
         VALUES ('https://work.example', 'alice', 'reports', 'publisher-1', 'old')",
            [],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO local_tasks (
           request_id, server_origin, app_owner, app_name, publisher_user_id,
           title, script, dependencies_json, input_json, working_directory,
           timeout_seconds, status, stdout_path, stderr_path, created_at, updated_at
         ) VALUES (
           '550e8400-e29b-41d4-a716-446655440000', 'https://work.example',
           'alice', 'reports', 'publisher-1', 'Old task', 'return 1', '{}', 'null',
           '/tmp/work', 30, 'succeeded', '/tmp/stdout.log', '/tmp/stderr.log',
           '09223372036854775808', '09223372036854775808'
         )",
            [],
        )
        .unwrap();
    drop(connection);

    let store = LocalStore::open(paths.clone()).unwrap();
    assert_eq!(store.schema_version().unwrap(), LOCAL_SCHEMA_VERSION);
    assert_eq!(
        store.desktop_settings().unwrap().installation_id,
        "11111111-1111-4111-8111-111111111111"
    );
    assert_eq!(
        TaskRepository::new(&store)
            .find("550e8400-e29b-41d4-a716-446655440000")
            .unwrap()
            .unwrap()
            .title,
        "Old task"
    );
    drop(store);

    let connection = Connection::open(paths.database()).unwrap();
    let trust_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM app_trusts", [], |row| row.get(0))
        .unwrap();
    let pending: i64 = connection
        .query_row(
            "SELECT server_sync_pending FROM local_tasks WHERE request_id = '550e8400-e29b-41d4-a716-446655440000'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(trust_count, 1);
    assert_eq!(pending, 0);
}

#[test]
fn ignores_standalone_settings_file_on_first_start() {
    let directory = tempfile::tempdir().unwrap();
    let paths = DesktopPaths::from_root(directory.path().join("data"));
    fs::create_dir_all(paths.root()).unwrap();
    fs::write(
        paths.root().join("desktop-settings.json"),
        r#"{"installationId":"11111111-1111-4111-8111-111111111111","launchAtLogin":true,"notificationsEnabled":false}"#,
    )
    .unwrap();

    let store = LocalStore::open(paths.clone()).unwrap();
    let settings = store.desktop_settings().unwrap();
    assert!(settings.installation_id.is_empty());
    assert!(!settings.launch_at_login);
    assert!(settings.notifications_enabled);
}

#[test]
fn script_environment_secrets_are_write_only_in_public_state_and_clearable() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(DesktopPaths::from_root(directory.path().join("data"))).unwrap();

    store
        .update_script_environment(localapp_desktop::local_store::ScriptEnvironmentUpdate {
            npm_registry: Some("https://npm.internal.example/".into()),
            http_proxy: Some("http://user:secret@proxy.example:8080".into()),
            https_proxy: None,
            clear_http_proxy: false,
            clear_https_proxy: false,
        })
        .unwrap();
    let public = store.script_environment_settings().unwrap();
    assert_eq!(
        public.npm_registry.as_deref(),
        Some("https://npm.internal.example/")
    );
    assert!(public.http_proxy_configured);
    assert!(!public.https_proxy_configured);
    assert!(!serde_json::to_string(&public).unwrap().contains("secret"));

    store
        .update_script_environment(localapp_desktop::local_store::ScriptEnvironmentUpdate {
            npm_registry: None,
            http_proxy: None,
            https_proxy: None,
            clear_http_proxy: true,
            clear_https_proxy: false,
        })
        .unwrap();
    assert!(
        !store
            .script_environment_settings()
            .unwrap()
            .http_proxy_configured
    );
}

#[test]
fn script_environment_rejects_registry_credentials_and_invalid_proxy_protocols() {
    let directory = tempfile::tempdir().unwrap();
    let store = LocalStore::open(DesktopPaths::from_root(directory.path().join("data"))).unwrap();

    for update in [
        localapp_desktop::local_store::ScriptEnvironmentUpdate {
            npm_registry: Some("https://user:secret@npm.example/".into()),
            http_proxy: None,
            https_proxy: None,
            clear_http_proxy: false,
            clear_https_proxy: false,
        },
        localapp_desktop::local_store::ScriptEnvironmentUpdate {
            npm_registry: None,
            http_proxy: Some("file:///tmp/proxy".into()),
            https_proxy: None,
            clear_http_proxy: false,
            clear_https_proxy: false,
        },
    ] {
        assert!(store.update_script_environment(update).is_err());
    }
}
