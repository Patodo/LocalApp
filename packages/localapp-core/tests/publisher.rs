use httpmock::Method::{GET, POST};
use httpmock::MockServer;
use localapp_core::{ResolvedTarget, ResolvedTargetSource, publish_app_version};
use std::fs;
use tempfile::TempDir;

#[tokio::test]
async fn publishes_one_installed_version_to_one_fixed_target_without_local_data() {
    let root = TempDir::new().unwrap();
    let version = root.path().join("apps/notes/versions/1.0.0");
    fs::create_dir_all(version.join("dist")).unwrap();
    fs::create_dir_all(version.join("migrations")).unwrap();
    fs::create_dir_all(version.join("backend")).unwrap();
    fs::write(
        version.join("manifest.json"),
        r#"{"name":"notes","description":"Local notes","platformVersion":"^1.0"}"#,
    )
    .unwrap();
    fs::write(version.join("dist/index.html"), "<main>published-ui</main>").unwrap();
    fs::write(
        version.join("migrations/001_init.sql"),
        "CREATE TABLE notes(id TEXT);",
    )
    .unwrap();
    fs::write(
        version.join("backend/queries.json"),
        r#"{"$schema":"https://localapp.dev/schemas/backend/queries.schema.json","queries":{}}"#,
    )
    .unwrap();
    fs::create_dir_all(root.path().join("app-data/notes/files")).unwrap();
    fs::write(
        root.path().join("app-data/notes/files/private.txt"),
        "private-local-data-must-not-upload",
    )
    .unwrap();

    let selected = MockServer::start();
    let other = MockServer::start();
    let capability = selected.mock(|when, then| {
        when.method(GET)
            .path("/api/platform/capabilities")
            .header("x-api-key", "test-selected-secret");
        then.status(200)
            .json_body(serde_json::json!({"success": true, "data": {"platformVersion": "1.0.0"}}));
    });
    let snapshot = selected.mock(|when, then| {
        when.method(GET)
            .path("/api/db/snapshot")
            .query_param("name", "notes")
            .header("x-api-key", "test-selected-secret");
        then.status(404);
    });
    let registration = selected.mock(|when, then| {
        when.method(POST)
            .path("/api/pages")
            .header("x-api-key", "test-selected-secret")
            .json_body(serde_json::json!({"name": "notes"}));
        then.status(200)
            .json_body(serde_json::json!({"success": true, "data": {"name": "notes"}}));
    });
    let upload = selected.mock(|when, then| {
        when.method(POST)
            .path("/api/upload")
            .header("x-api-key", "test-selected-secret")
            .body_contains("published-ui")
            .body_contains("001_init.sql")
            .body_contains("backend/queries.json");
        then.status(200).json_body(serde_json::json!({
            "success": true,
            "data": {
                "name": "notes",
                "url": format!("{}/example-user/notes/", selected.base_url()),
                "rawUrl": format!("{}/serve/example-user/notes/", selected.base_url()),
                "version": 7
            }
        }));
    });
    let deployed_page = selected.mock(|when, then| {
        when.method(GET)
            .path("/api/pages/notes")
            .header("x-api-key", "test-selected-secret");
        then.status(200).json_body(serde_json::json!({
            "success": true,
            "data": {
                "name": "notes",
                "userId": "example-user",
                "url": "/example-user/notes/",
                "rawUrl": "/serve/example-user/notes/",
                "currentVersion": 7
            }
        }));
    });
    let verification_session = selected.mock(|when, then| {
        when.method(POST)
            .path("/api/verification/sessions")
            .header("x-api-key", "test-selected-secret")
            .json_body(serde_json::json!({
                "owner": "example-user",
                "app": "notes",
                "version": 7,
                "identity": "owner"
            }));
        then.status(201).json_body(serde_json::json!({
            "success": true,
            "data": {
                "id": "verify-7",
                "owner": "example-user",
                "app": "notes",
                "version": 7,
                "identity": "owner",
                "openUrl": format!("{}/api/verification/open/token-7", selected.base_url())
            }
        }));
    });
    let open_session = selected.mock(|when, then| {
        when.method(GET).path("/api/verification/open/token-7");
        then.status(302)
            .header("location", "/example-user/notes/")
            .header("set-cookie", "localapp_verify=verification-cookie; Path=/");
    });
    let formal_entry = selected.mock(|when, then| {
        when.method(GET).path("/example-user/notes/");
        then.status(200).body("<html>platform shell</html>");
    });
    let raw_entry = selected.mock(|when, then| {
        when.method(GET).path("/serve/example-user/notes/");
        then.status(200).body("<main>published-ui</main>");
    });
    let api_smoke = selected.mock(|when, then| {
        when.method(GET).path("/serve/example-user/notes/api/time");
        then.status(200).json_body(serde_json::json!({
            "success": true,
            "data": {"iso": "2026-07-30T00:00:00.000Z"}
        }));
    });
    let leaked_data = selected.mock(|when, then| {
        when.method(POST)
            .path("/api/upload")
            .body_contains("private-local-data-must-not-upload");
        then.status(500);
    });
    let wrong_target = other.mock(|when, then| {
        when.method(POST).path("/api/upload");
        then.status(500);
    });
    let target = ResolvedTarget {
        server_url: selected.base_url(),
        api_key: "test-selected-secret".into(),
        profile_name: Some("production".into()),
        source: ResolvedTargetSource::ExplicitProfile,
    };

    let result = publish_app_version(&version, &target).await.unwrap();

    assert_eq!(result.name, "notes");
    assert_eq!(result.version, 7);
    assert_eq!(result.profile.as_deref(), Some("production"));
    assert_eq!(result.server_url, selected.base_url());
    capability.assert();
    snapshot.assert();
    registration.assert();
    upload.assert();
    deployed_page.assert();
    verification_session.assert();
    open_session.assert();
    formal_entry.assert();
    raw_entry.assert();
    api_smoke.assert();
    leaked_data.assert_hits(0);
    wrong_target.assert_hits(0);
}

#[tokio::test]
async fn rejects_invalid_migrations_before_registering_or_uploading() {
    let root = TempDir::new().unwrap();
    let version = root.path().join("version");
    fs::create_dir_all(version.join("dist")).unwrap();
    fs::create_dir_all(version.join("migrations")).unwrap();
    fs::write(version.join("manifest.json"), r#"{"name":"notes"}"#).unwrap();
    fs::write(version.join("dist/index.html"), "ready").unwrap();
    fs::write(
        version.join("migrations/001_invalid.sql"),
        "CREATE TABLE notes(",
    )
    .unwrap();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/api/platform/capabilities");
        then.status(200)
            .json_body(serde_json::json!({"success": true, "data": {}}));
    });
    let snapshot = server.mock(|when, then| {
        when.method(GET)
            .path("/api/db/snapshot")
            .query_param("name", "notes");
        then.status(404);
    });
    let registration = server.mock(|when, then| {
        when.method(POST).path("/api/pages");
        then.status(200)
            .json_body(serde_json::json!({"success": true, "data": {}}));
    });
    let upload = server.mock(|when, then| {
        when.method(POST).path("/api/upload");
        then.status(200).json_body(serde_json::json!({
            "success": true,
            "data": {
                "name": "notes",
                "url": format!("{}/owner/notes/", server.base_url()),
                "rawUrl": format!("{}/serve/owner/notes/", server.base_url()),
                "version": 1
            }
        }));
    });
    let target = ResolvedTarget {
        server_url: server.base_url(),
        api_key: "test-selected-secret".into(),
        profile_name: Some("production".into()),
        source: ResolvedTargetSource::ExplicitProfile,
    };

    let error = publish_app_version(&version, &target).await.unwrap_err();

    assert!(error.contains("Fresh migration validation failed"));
    snapshot.assert();
    registration.assert_hits(0);
    upload.assert_hits(0);
}

#[tokio::test]
async fn rejects_migrations_that_do_not_match_the_selected_servers_snapshot() {
    let root = TempDir::new().unwrap();
    let version = root.path().join("version");
    fs::create_dir_all(version.join("dist")).unwrap();
    fs::create_dir_all(version.join("migrations")).unwrap();
    fs::write(version.join("manifest.json"), r#"{"name":"notes"}"#).unwrap();
    fs::write(version.join("dist/index.html"), "ready").unwrap();
    fs::write(
        version.join("migrations/001_init.sql"),
        "CREATE TABLE notes(id TEXT);",
    )
    .unwrap();

    let snapshot_file = tempfile::NamedTempFile::new().unwrap();
    let connection = rusqlite::Connection::open(snapshot_file.path()).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE _localapp_applied_migrations (
                filename TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );
            INSERT INTO _localapp_applied_migrations
                (filename, checksum, applied_at)
            VALUES ('001_init.sql', 'production-checksum', datetime('now'));",
        )
        .unwrap();
    drop(connection);
    let snapshot_bytes = fs::read(snapshot_file.path()).unwrap();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/api/platform/capabilities");
        then.status(200)
            .json_body(serde_json::json!({"success": true, "data": {}}));
    });
    let snapshot = server.mock(|when, then| {
        when.method(GET)
            .path("/api/db/snapshot")
            .query_param("name", "notes");
        then.status(200).body(snapshot_bytes);
    });
    let registration = server.mock(|when, then| {
        when.method(POST).path("/api/pages");
        then.status(500);
    });
    let upload = server.mock(|when, then| {
        when.method(POST).path("/api/upload");
        then.status(500);
    });
    let target = ResolvedTarget {
        server_url: server.base_url(),
        api_key: "test-selected-secret".into(),
        profile_name: Some("production".into()),
        source: ResolvedTargetSource::ExplicitProfile,
    };

    let error = publish_app_version(&version, &target).await.unwrap_err();

    assert!(error.contains("different checksum"));
    snapshot.assert();
    registration.assert_hits(0);
    upload.assert_hits(0);
}

#[tokio::test]
async fn rejects_cross_origin_deployment_verification_without_leaking_the_key() {
    let root = TempDir::new().unwrap();
    let version = root.path().join("version");
    fs::create_dir_all(version.join("dist")).unwrap();
    fs::write(version.join("manifest.json"), r#"{"name":"notes"}"#).unwrap();
    fs::write(version.join("dist/index.html"), "ready").unwrap();

    let selected = MockServer::start();
    let external = MockServer::start();
    selected.mock(|when, then| {
        when.method(GET).path("/api/platform/capabilities");
        then.status(200)
            .json_body(serde_json::json!({"success": true, "data": {}}));
    });
    selected.mock(|when, then| {
        when.method(GET).path("/api/db/snapshot");
        then.status(404);
    });
    selected.mock(|when, then| {
        when.method(POST).path("/api/pages");
        then.status(200)
            .json_body(serde_json::json!({"success": true, "data": {}}));
    });
    selected.mock(|when, then| {
        when.method(POST).path("/api/upload");
        then.status(200).json_body(serde_json::json!({
            "success": true,
            "data": {
                "name": "notes",
                "url": format!("{}/owner/notes/", selected.base_url()),
                "rawUrl": format!("{}/serve/owner/notes/", selected.base_url()),
                "version": 1
            }
        }));
    });
    selected.mock(|when, then| {
        when.method(GET).path("/api/pages/notes");
        then.status(200).json_body(serde_json::json!({
            "success": true,
            "data": {
                "name": "notes",
                "userId": "owner",
                "url": "/owner/notes/",
                "rawUrl": "/serve/owner/notes/",
                "currentVersion": 1
            }
        }));
    });
    selected.mock(|when, then| {
        when.method(POST).path("/api/verification/sessions");
        then.status(201).json_body(serde_json::json!({
            "success": true,
            "data": {
                "openUrl": format!("{}/steal", external.base_url())
            }
        }));
    });
    let leaked = external.mock(|when, then| {
        when.method(GET).path("/steal");
        then.status(500);
    });
    let target = ResolvedTarget {
        server_url: selected.base_url(),
        api_key: "test-selected-secret".into(),
        profile_name: Some("production".into()),
        source: ResolvedTargetSource::ExplicitProfile,
    };

    let error = publish_app_version(&version, &target).await.unwrap_err();

    assert!(error.contains("different Server"));
    assert!(!error.contains("test-selected-secret"));
    leaked.assert_hits(0);
}

#[tokio::test]
async fn redacts_the_selected_profile_key_from_server_errors() {
    let root = TempDir::new().unwrap();
    let version = root.path().join("version");
    fs::create_dir_all(version.join("dist")).unwrap();
    fs::write(version.join("manifest.json"), r#"{"name":"notes"}"#).unwrap();
    fs::write(version.join("dist/index.html"), "ready").unwrap();
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/api/platform/capabilities");
        then.status(403).json_body(serde_json::json!({
            "success": false,
            "error": "Rejected test-secret-key-value"
        }));
    });
    let target = ResolvedTarget {
        server_url: server.base_url(),
        api_key: "test-secret-key-value".into(),
        profile_name: Some("staging".into()),
        source: ResolvedTargetSource::ExplicitProfile,
    };

    let error = publish_app_version(&version, &target).await.unwrap_err();

    assert!(!error.contains("test-secret-key-value"));
    assert!(error.contains("[REDACTED]"));
}
