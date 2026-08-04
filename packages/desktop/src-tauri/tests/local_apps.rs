use localapp_core::{AppPackageMetadata, build_app_package};
use localapp_desktop::local_apps::{InstallOutcome, LocalAppRepository};
use localapp_desktop::paths::DesktopPaths;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

#[test]
fn desktop_paths_separate_packages_data_backups_and_runtime_registry() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().to_path_buf());
    paths.ensure().unwrap();

    assert_eq!(paths.apps(), root.path().join("apps"));
    assert_eq!(paths.app_data(), root.path().join("app-data"));
    assert_eq!(
        paths.local_app_registry(),
        root.path().join("local-apps.json")
    );
    assert_eq!(
        paths.local_runtime_registry(),
        root.path().join("local-runtime-registry.json")
    );
    assert!(paths.apps().is_dir());
    assert!(paths.app_data().is_dir());
}

#[test]
fn installs_upgrades_and_uninstalls_without_mixing_package_and_user_data() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let v1 = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT);",
    );

    let installed = repository.install(&v1).unwrap();
    assert_eq!(
        installed,
        InstallOutcome {
            app_id: "notes-app".into(),
            version: "1.0.0".into(),
            upgraded: false,
            openable: false,
        }
    );
    let app = repository.list().unwrap().pop().unwrap();
    assert_eq!(app.current_version, "1.0.0");
    assert!(app.version_root.join("dist/index.html").is_file());
    assert!(app.data_root.join("app.db").is_file());
    fs::write(app.data_root.join("files/kept.txt"), b"user data").unwrap();

    let broken = build_package(
        root.path(),
        "notes-app",
        "2.0.0",
        "ALTER TABLE notes ADD COLUMN title TEXT;\nTHIS IS NOT SQL;",
    );
    assert!(repository.install(&broken).is_err());
    assert_eq!(
        repository.list().unwrap()[0].current_version,
        "1.0.0",
        "failed migration must not switch the active version"
    );
    assert!(!paths.apps().join("notes-app/versions/2.0.0").exists());
    assert_eq!(
        fs::read(app.data_root.join("files/kept.txt")).unwrap(),
        b"user data"
    );

    repository.uninstall("notes-app").unwrap();
    assert!(repository.list().unwrap().is_empty());
    assert!(paths.app_data().join("notes-app/files/kept.txt").is_file());
    assert!(!paths.apps().join("notes-app").exists());

    repository.install(&v1).unwrap();
    repository.delete_permanently("notes-app").unwrap();
    assert!(!paths.app_data().join("notes-app").exists());
}

#[test]
fn rejects_corrupt_packages_without_changing_the_registry() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths);
    let package = root.path().join("corrupt.localapp");
    fs::write(&package, b"not a zip").unwrap();

    assert!(repository.install(&package).is_err());
    assert!(repository.list().unwrap().is_empty());
}

#[test]
fn restores_the_previous_version_and_database_when_startup_health_fails() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let v1 = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&v1).unwrap();
    let database = paths.app_data().join("notes-app/app.db");
    rusqlite::Connection::open(&database)
        .unwrap()
        .execute(
            "INSERT INTO notes(id, title) VALUES ('one', 'before upgrade')",
            [],
        )
        .unwrap();
    let v2 = build_package_with_migrations(
        root.path(),
        "notes-app",
        "2.0.0",
        &[
            (
                "001_init.sql",
                "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
            ),
            (
                "002_detail.sql",
                "ALTER TABLE notes ADD COLUMN detail TEXT;",
            ),
        ],
    );

    let error = repository
        .install_with_health(&v2, |candidate| {
            assert_eq!(candidate.current_version, "2.0.0");
            Err("Runtime initialization failed: invalid backend contract".into())
        })
        .unwrap_err();

    assert!(error.contains("invalid backend contract"));
    let restored = repository.list().unwrap().pop().unwrap();
    assert_eq!(restored.current_version, "1.0.0");
    assert!(!paths.apps().join("notes-app/versions/2.0.0").exists());
    let connection = rusqlite::Connection::open(database).unwrap();
    let title: String = connection
        .query_row("SELECT title FROM notes WHERE id = 'one'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "before upgrade");
    assert!(
        connection.prepare("SELECT detail FROM notes").is_err(),
        "database schema must be restored to its pre-upgrade state"
    );
}

#[test]
fn successful_upgrades_create_unique_complete_database_backups() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    repository
        .install(&build_package(
            root.path(),
            "notes-app",
            "1.0.0",
            "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
        ))
        .unwrap();
    repository
        .install(&build_package_with_migrations(
            root.path(),
            "notes-app",
            "2.0.0",
            &[
                (
                    "001_init.sql",
                    "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
                ),
                (
                    "002_detail.sql",
                    "ALTER TABLE notes ADD COLUMN detail TEXT;",
                ),
            ],
        ))
        .unwrap();
    repository
        .install(&build_package_with_migrations(
            root.path(),
            "notes-app",
            "3.0.0",
            &[
                (
                    "001_init.sql",
                    "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
                ),
                (
                    "002_detail.sql",
                    "ALTER TABLE notes ADD COLUMN detail TEXT;",
                ),
                (
                    "003_status.sql",
                    "ALTER TABLE notes ADD COLUMN status TEXT;",
                ),
            ],
        ))
        .unwrap();

    let backups = fs::read_dir(paths.app_data().join("notes-app/backups"))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(backups.len(), 2);
    for backup in backups {
        assert!(
            backup
                .file_name()
                .to_string_lossy()
                .starts_with("pre-upgrade-")
        );
        assert!(
            !backup
                .file_name()
                .to_string_lossy()
                .starts_with(".staging-")
        );
        let connection = rusqlite::Connection::open(backup.path()).unwrap();
        let result: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(result, "ok");
    }
}

#[test]
fn restores_registry_bytes_database_and_version_when_runtime_registry_write_fails() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let v1 = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&v1).unwrap();
    let database = paths.app_data().join("notes-app/app.db");
    rusqlite::Connection::open(&database)
        .unwrap()
        .execute(
            "INSERT INTO notes(id, title) VALUES ('one', 'before failed write')",
            [],
        )
        .unwrap();
    let registry_before = fs::read(paths.local_app_registry()).unwrap();
    fs::remove_file(paths.local_runtime_registry()).unwrap();
    fs::create_dir(paths.local_runtime_registry()).unwrap();
    let v2 = build_package_with_migrations(
        root.path(),
        "notes-app",
        "2.0.0",
        &[
            (
                "001_init.sql",
                "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
            ),
            (
                "002_detail.sql",
                "ALTER TABLE notes ADD COLUMN detail TEXT;",
            ),
        ],
    );

    let error = repository.install(&v2).unwrap_err();

    assert!(!error.is_empty());
    assert_eq!(
        fs::read(paths.local_app_registry()).unwrap(),
        registry_before,
        "the first registry must be restored byte-for-byte"
    );
    let registry: serde_json::Value =
        serde_json::from_slice(&fs::read(paths.local_app_registry()).unwrap()).unwrap();
    assert_eq!(registry["apps"]["notes-app"]["currentVersion"], "1.0.0");
    assert!(!paths.apps().join("notes-app/versions/2.0.0").exists());
    let connection = rusqlite::Connection::open(database).unwrap();
    let title: String = connection
        .query_row("SELECT title FROM notes WHERE id = 'one'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "before failed write");
    assert!(
        connection.prepare("SELECT detail FROM notes").is_err(),
        "database schema must be restored when registry persistence fails"
    );
}

#[test]
fn restores_missing_registry_state_when_first_install_runtime_registry_write_fails() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    fs::create_dir(paths.local_runtime_registry()).unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let package = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );

    let error = repository.install(&package).unwrap_err();

    assert!(!error.is_empty());
    assert!(
        !paths.local_app_registry().exists(),
        "a missing first registry must remain missing"
    );
    assert!(repository.list().unwrap().is_empty());
    assert!(!paths.apps().join("notes-app/versions/1.0.0").exists());
    assert!(!paths.app_data().join("notes-app/app.db").exists());
}

#[test]
fn keeps_installed_version_when_uninstall_registry_write_fails() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let package = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&package).unwrap();
    let version_root = paths.apps().join("notes-app/versions/1.0.0");
    fs::remove_file(paths.local_runtime_registry()).unwrap();
    fs::create_dir(paths.local_runtime_registry()).unwrap();

    let error = repository.uninstall("notes-app").unwrap_err();

    assert!(!error.is_empty());
    assert!(version_root.join("dist/index.html").is_file());
    assert_eq!(
        repository.list().unwrap()[0].current_version,
        "1.0.0",
        "a failed registry transaction must not leave a missing currentVersion"
    );
}

#[test]
fn keeps_package_and_data_when_permanent_delete_registry_write_fails() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let package = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&package).unwrap();
    let data_file = paths.app_data().join("notes-app/files/kept.txt");
    fs::write(&data_file, b"keep on failed delete").unwrap();
    fs::remove_file(paths.local_runtime_registry()).unwrap();
    fs::create_dir(paths.local_runtime_registry()).unwrap();

    let error = repository.delete_permanently("notes-app").unwrap_err();

    assert!(!error.is_empty());
    assert!(
        paths
            .apps()
            .join("notes-app/versions/1.0.0/dist/index.html")
            .is_file()
    );
    assert_eq!(fs::read(data_file).unwrap(), b"keep on failed delete");
    assert_eq!(repository.list().unwrap()[0].current_version, "1.0.0");
}

#[test]
fn recovers_a_staged_removal_when_the_registry_still_contains_the_app() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let package = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&package).unwrap();
    let operation = paths
        .root()
        .join("app-removals")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&operation).unwrap();
    fs::write(
        operation.join("removal.json"),
        r#"{"appId":"notes-app","removeData":false}"#,
    )
    .unwrap();
    fs::write(
        operation.join("removal.sha256"),
        format!("{}\n", file_checksum(&operation.join("removal.json"))),
    )
    .unwrap();
    fs::rename(paths.apps().join("notes-app"), operation.join("package")).unwrap();

    let apps = repository.list().unwrap();

    assert_eq!(apps[0].current_version, "1.0.0");
    assert!(
        paths
            .apps()
            .join("notes-app/versions/1.0.0/dist/index.html")
            .is_file()
    );
    assert!(!operation.exists());
}

#[test]
fn completes_runtime_registry_after_removal_crashes_between_registry_writes() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    repository
        .install(&build_package(
            root.path(),
            "notes-app",
            "1.0.0",
            "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
        ))
        .unwrap();
    let operation_id = uuid::Uuid::new_v4().to_string();
    let operation = paths.root().join("app-removals").join(&operation_id);
    fs::create_dir_all(&operation).unwrap();
    fs::write(
        operation.join("removal.json"),
        r#"{"appId":"notes-app","removeData":false}"#,
    )
    .unwrap();
    fs::write(
        operation.join("removal.sha256"),
        format!("{}\n", file_checksum(&operation.join("removal.json"))),
    )
    .unwrap();
    fs::rename(paths.apps().join("notes-app"), operation.join("package")).unwrap();
    fs::write(
        paths.local_app_registry(),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "apps": {}
        }))
        .unwrap(),
    )
    .unwrap();
    let stale_runtime: serde_json::Value =
        serde_json::from_slice(&fs::read(paths.local_runtime_registry()).unwrap()).unwrap();
    assert_eq!(stale_runtime["apps"].as_array().unwrap().len(), 1);

    assert!(repository.list().unwrap().is_empty());

    let runtime: serde_json::Value =
        serde_json::from_slice(&fs::read(paths.local_runtime_registry()).unwrap()).unwrap();
    assert!(runtime["apps"].as_array().unwrap().is_empty());
    assert!(!operation.exists());
    assert!(
        paths
            .root()
            .join("app-removal-commits")
            .join(operation_id)
            .is_file()
    );
}

#[test]
fn invalid_or_incomplete_removal_journals_do_not_block_startup_or_escape_storage() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let package = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&package).unwrap();
    let sentinel = paths.tasks().join("keep.txt");
    fs::write(&sentinel, b"untouched").unwrap();
    fs::create_dir_all(paths.root().join("app-removals/.staging-incomplete")).unwrap();
    let invalid = paths.root().join("app-removals/invalid");
    fs::create_dir_all(&invalid).unwrap();
    fs::write(
        invalid.join("removal.json"),
        r#"{"appId":"../tasks","removeData":true}"#,
    )
    .unwrap();

    let apps = repository.list().unwrap();

    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0].app_id, "notes-app");
    assert_eq!(fs::read(&sentinel).unwrap(), b"untouched");
    assert!(
        !paths
            .root()
            .join("app-removals/.staging-incomplete")
            .exists()
    );
    assert!(
        invalid.exists(),
        "invalid journals remain available for diagnosis"
    );
}

#[test]
fn permanent_delete_rejects_path_traversal_without_touching_desktop_state() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let sentinel = paths.tasks().join("keep.txt");
    fs::write(&sentinel, b"untouched").unwrap();

    let error = repository.delete_permanently("../tasks").unwrap_err();

    assert!(error.contains("Invalid local application ID"));
    assert_eq!(fs::read(&sentinel).unwrap(), b"untouched");
}

#[test]
fn invalid_registry_identifiers_and_versions_are_rejected_before_path_derivation() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let sentinel = paths.tasks().join("keep.txt");
    fs::write(&sentinel, b"untouched").unwrap();
    fs::write(
        paths.local_app_registry(),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "apps": {
                "../tasks": {
                    "currentVersion": "/tmp/outside",
                    "installedVersions": ["/tmp/outside"]
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let error = repository.list().unwrap_err();

    assert!(error.contains("Invalid local application ID"), "{error}");
    assert_eq!(fs::read(&sentinel).unwrap(), b"untouched");

    fs::write(
        paths.local_app_registry(),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "apps": {
                "notes-app": {
                    "currentVersion": "/tmp/outside",
                    "installedVersions": ["/tmp/outside"]
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let error = repository.list().unwrap_err();
    assert!(error.contains("Invalid current version"), "{error}");
    assert_eq!(fs::read(sentinel).unwrap(), b"untouched");
}

#[test]
fn corrupt_install_snapshots_and_committed_journals_do_not_block_startup() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let package = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&package).unwrap();
    let database = paths.app_data().join("notes-app/app.db");
    let invalid = paths
        .root()
        .join("app-installs")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&invalid).unwrap();
    fs::write(invalid.join("local-registry.before"), b"not json").unwrap();
    fs::write(
        invalid.join("install.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "appId": "notes-app",
            "targetVersion": "2.0.0",
            "databaseExisted": false,
            "localRegistry": "file",
            "localRegistrySha256": file_checksum(&invalid.join("local-registry.before")),
            "runtimeRegistry": "missing",
            "runtimeRegistrySha256": null,
            "databaseSha256": null
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        invalid.join("install.sha256"),
        format!("{}\n", file_checksum(&invalid.join("install.json"))),
    )
    .unwrap();
    let committed_id = uuid::Uuid::new_v4().to_string();
    let committed = paths.root().join("app-installs").join(&committed_id);
    fs::create_dir_all(&committed).unwrap();
    fs::write(committed.join("install.json"), b"invalid but irrelevant").unwrap();
    fs::create_dir_all(paths.root().join("app-install-commits")).unwrap();
    fs::write(
        paths.root().join("app-install-commits").join(committed_id),
        b"committed\n",
    )
    .unwrap();

    let apps = repository.list().unwrap();

    assert_eq!(apps[0].current_version, "1.0.0");
    assert!(database.is_file());
    assert!(
        invalid.exists(),
        "invalid uncommitted journals remain available for diagnosis"
    );
    assert!(!committed.exists());
}

#[test]
fn false_missing_snapshot_metadata_cannot_delete_retained_application_data() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    repository
        .install(&build_package(
            root.path(),
            "notes-app",
            "1.0.0",
            "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
        ))
        .unwrap();
    repository.uninstall("notes-app").unwrap();
    let database = paths.app_data().join("notes-app/app.db");
    assert!(database.is_file());
    let operation = paths
        .root()
        .join("app-installs")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&operation).unwrap();
    fs::write(
        operation.join("install.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "appId": "notes-app",
            "targetVersion": "2.0.0",
            "databaseExisted": false,
            "localRegistry": "missing",
            "localRegistrySha256": null,
            "runtimeRegistry": "missing",
            "runtimeRegistrySha256": null,
            "databaseSha256": null
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        operation.join("install.sha256"),
        format!("{}\n", file_checksum(&operation.join("install.json"))),
    )
    .unwrap();

    assert!(repository.list().unwrap().is_empty());
    assert!(database.is_file());
    assert!(operation.exists());
}

#[test]
fn recovers_database_registries_and_version_after_an_interrupted_upgrade() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let package = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&package).unwrap();
    let database = paths.app_data().join("notes-app/app.db");
    rusqlite::Connection::open(&database)
        .unwrap()
        .execute(
            "INSERT INTO notes(id, title) VALUES ('one', 'before crash')",
            [],
        )
        .unwrap();
    let local_before = fs::read(paths.local_app_registry()).unwrap();
    let runtime_before = fs::read(paths.local_runtime_registry()).unwrap();
    let operation = paths
        .root()
        .join("app-installs")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&operation).unwrap();
    fs::write(operation.join("local-registry.before"), &local_before).unwrap();
    fs::write(operation.join("runtime-registry.before"), &runtime_before).unwrap();
    fs::copy(&database, operation.join("database.before")).unwrap();
    let local_checksum = file_checksum(&operation.join("local-registry.before"));
    let runtime_checksum = file_checksum(&operation.join("runtime-registry.before"));
    let database_checksum = file_checksum(&operation.join("database.before"));
    fs::write(
        operation.join("install.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "appId": "notes-app",
            "targetVersion": "2.0.0",
            "databaseExisted": true,
            "localRegistry": "file",
            "localRegistrySha256": local_checksum,
            "runtimeRegistry": "file",
            "runtimeRegistrySha256": runtime_checksum,
            "databaseSha256": database_checksum
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        operation.join("install.sha256"),
        format!("{}\n", file_checksum(&operation.join("install.json"))),
    )
    .unwrap();
    let target = paths.apps().join("notes-app/versions/2.0.0");
    fs::create_dir_all(target.join("2.0.0/dist")).unwrap();
    fs::write(target.join("2.0.0/dist/index.html"), "<main>v2</main>").unwrap();
    rusqlite::Connection::open(&database)
        .unwrap()
        .execute("ALTER TABLE notes ADD COLUMN detail TEXT", [])
        .unwrap();
    let mut local: serde_json::Value = serde_json::from_slice(&local_before).unwrap();
    local["apps"]["notes-app"]["currentVersion"] = "2.0.0".into();
    local["apps"]["notes-app"]["installedVersions"] = serde_json::json!(["1.0.0", "2.0.0"]);
    fs::write(
        paths.local_app_registry(),
        serde_json::to_vec_pretty(&local).unwrap(),
    )
    .unwrap();
    let mut runtime: serde_json::Value = serde_json::from_slice(&runtime_before).unwrap();
    runtime["apps"][0]["version"] = "2.0.0".into();
    fs::write(
        paths.local_runtime_registry(),
        serde_json::to_vec_pretty(&runtime).unwrap(),
    )
    .unwrap();

    let apps = repository.list().unwrap();

    assert_eq!(apps[0].current_version, "1.0.0");
    assert_eq!(fs::read(paths.local_app_registry()).unwrap(), local_before);
    assert_eq!(
        fs::read(paths.local_runtime_registry()).unwrap(),
        runtime_before
    );
    assert!(!target.exists());
    assert!(!operation.exists());
    let connection = rusqlite::Connection::open(database).unwrap();
    let title: String = connection
        .query_row("SELECT title FROM notes WHERE id = 'one'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "before crash");
    assert!(connection.prepare("SELECT detail FROM notes").is_err());
    assert_eq!(repository.list().unwrap()[0].current_version, "1.0.0");
}

#[cfg(unix)]
#[test]
fn keeps_registry_and_package_when_removal_cannot_enter_managed_storage() {
    use std::os::unix::fs::PermissionsExt;

    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let package = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&package).unwrap();
    fs::set_permissions(
        paths.apps().join("notes-app"),
        fs::Permissions::from_mode(0o000),
    )
    .unwrap();

    let error = repository.uninstall("notes-app").unwrap_err();

    assert!(!error.is_empty());
    assert_eq!(repository.list().unwrap()[0].current_version, "1.0.0");
    fs::set_permissions(
        paths.apps().join("notes-app"),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    assert!(
        paths
            .apps()
            .join("notes-app/versions/1.0.0/dist/index.html")
            .is_file()
    );
}

#[test]
fn restores_retained_data_when_reinstall_health_fails_without_a_registry_entry() {
    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let v1 = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&v1).unwrap();
    let database = paths.app_data().join("notes-app/app.db");
    rusqlite::Connection::open(&database)
        .unwrap()
        .execute(
            "INSERT INTO notes(id, title) VALUES ('retained', 'before reinstall')",
            [],
        )
        .unwrap();
    repository.uninstall("notes-app").unwrap();
    assert!(repository.list().unwrap().is_empty());
    assert!(database.is_file());

    let v2 = build_package_with_migrations(
        root.path(),
        "notes-app",
        "2.0.0",
        &[
            (
                "001_init.sql",
                "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
            ),
            (
                "002_detail.sql",
                "ALTER TABLE notes ADD COLUMN detail TEXT;",
            ),
        ],
    );
    let error = repository
        .install_with_health(&v2, |_| Err("Runtime health failed after reinstall".into()))
        .unwrap_err();

    assert!(error.contains("health failed"));
    assert!(repository.list().unwrap().is_empty());
    assert!(!paths.apps().join("notes-app/versions/2.0.0").exists());
    let connection = rusqlite::Connection::open(database).unwrap();
    let title: String = connection
        .query_row("SELECT title FROM notes WHERE id = 'retained'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "before reinstall");
    assert!(
        connection.prepare("SELECT detail FROM notes").is_err(),
        "retained database schema must be restored after failed reinstall"
    );
}

#[cfg(unix)]
#[test]
fn reports_database_and_version_failures_while_repairing_the_registry() {
    use std::os::unix::fs::PermissionsExt;

    let root = TempDir::new().unwrap();
    let paths = DesktopPaths::from_root(root.path().join("desktop"));
    paths.ensure().unwrap();
    let repository = LocalAppRepository::new(paths.clone());
    let v1 = build_package(
        root.path(),
        "notes-app",
        "1.0.0",
        "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
    );
    repository.install(&v1).unwrap();
    let v2 = build_package_with_migrations(
        root.path(),
        "notes-app",
        "2.0.0",
        &[
            (
                "001_init.sql",
                "CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT);",
            ),
            (
                "002_detail.sql",
                "ALTER TABLE notes ADD COLUMN detail TEXT;",
            ),
        ],
    );
    let versions = paths.apps().join("notes-app/versions");

    let error = repository
        .install_with_health(&v2, |candidate| {
            let database = candidate.data_root.join("app.db");
            fs::remove_file(&database).unwrap();
            fs::create_dir(&database).unwrap();
            fs::remove_file(paths.local_app_registry()).unwrap();
            fs::create_dir(paths.local_app_registry()).unwrap();
            fs::set_permissions(
                candidate.version_root.parent().unwrap(),
                fs::Permissions::from_mode(0o500),
            )
            .unwrap();
            Err("injected Runtime health failure".into())
        })
        .unwrap_err();
    fs::set_permissions(&versions, fs::Permissions::from_mode(0o700)).unwrap();

    assert!(error.contains("injected Runtime health failure"), "{error}");
    assert!(error.contains("database rollback"), "{error}");
    assert!(error.contains("version directory rollback"), "{error}");
    let registry: serde_json::Value =
        serde_json::from_slice(&fs::read(paths.local_app_registry()).unwrap()).unwrap();
    assert_eq!(registry["apps"]["notes-app"]["currentVersion"], "1.0.0");
}

fn build_package(root: &Path, app_id: &str, version: &str, migration: &str) -> PathBuf {
    build_package_with_migrations(root, app_id, version, &[("001_init.sql", migration)])
}

fn build_package_with_migrations(
    root: &Path,
    app_id: &str,
    version: &str,
    migrations: &[(&str, &str)],
) -> PathBuf {
    let project = root.join(format!("project-{app_id}-{version}"));
    fs::create_dir_all(project.join("dist")).unwrap();
    fs::create_dir_all(project.join("migrations")).unwrap();
    fs::write(
        project.join("manifest.json"),
        serde_json::json!({
            "name": app_id,
            "platformVersion": "^1.0"
        })
        .to_string(),
    )
    .unwrap();
    fs::write(project.join("dist/index.html"), "<main>notes</main>").unwrap();
    for (name, migration) in migrations {
        fs::write(project.join("migrations").join(name), migration).unwrap();
    }
    let package = root.join(format!("{app_id}-{version}.localapp"));
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

fn file_checksum(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(fs::read(path).unwrap()))
}
