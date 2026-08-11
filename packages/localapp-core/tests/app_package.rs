use localapp_core::{
    AppPackageMetadata, AppPackageValidationError, build_app_package, inspect_app_package,
};
use std::fs;
use std::io::Write;

fn fixture_project() -> tempfile::TempDir {
    let project = tempfile::tempdir().unwrap();
    fs::create_dir_all(project.path().join("dist/assets")).unwrap();
    fs::create_dir_all(project.path().join("migrations")).unwrap();
    fs::create_dir_all(project.path().join("backend/resources/items")).unwrap();
    fs::create_dir_all(project.path().join(".localapp/uploads")).unwrap();
    fs::create_dir_all(project.path().join("tmp/localapp-schema")).unwrap();
    fs::write(
        project.path().join("manifest.json"),
        r#"{"name":"local-notes","platformVersion":">=0.1.0"}"#,
    )
    .unwrap();
    fs::write(
        project.path().join("dist/index.html"),
        "<div id=\"root\"></div>",
    )
    .unwrap();
    fs::write(
        project.path().join("dist/assets/app.js"),
        "console.log('ok')",
    )
    .unwrap();
    fs::write(
        project.path().join("migrations/001_notes.sql"),
        "CREATE TABLE notes(id TEXT PRIMARY KEY);",
    )
    .unwrap();
    fs::write(
        project.path().join("backend/resources/items/queries.json"),
        r#"{"$schema":"https://localapp.dev/schemas/backend/queries.schema.json","queries":{}}"#,
    )
    .unwrap();
    fs::write(
        project.path().join("tmp/localapp-schema/schema.db"),
        b"private database",
    )
    .unwrap();
    fs::write(
        project.path().join(".localapp/uploads/private.txt"),
        b"private file",
    )
    .unwrap();
    fs::write(
        project.path().join("manifest.platform.json"),
        br#"{"llmApiKey":"secret"}"#,
    )
    .unwrap();
    fs::write(project.path().join(".env"), b"API_KEY=secret").unwrap();
    project
}

fn metadata() -> AppPackageMetadata {
    AppPackageMetadata {
        schema_version: 1,
        app_id: "local-notes".into(),
        version: "1.2.3".into(),
        platform_version: ">=0.1.0".into(),
    }
}

#[test]
fn package_is_deterministic_and_only_contains_publishable_files() {
    let project = fixture_project();
    let first = project.path().join("first.localapp");
    let second = project.path().join("second.localapp");

    let first_summary = build_app_package(project.path(), &first, metadata()).unwrap();
    let second_summary = build_app_package(project.path(), &second, metadata()).unwrap();

    assert_eq!(first_summary.sha256, second_summary.sha256);
    assert_eq!(fs::read(first).unwrap(), fs::read(second).unwrap());

    let inspection = inspect_app_package(&project.path().join("second.localapp")).unwrap();
    assert_eq!(
        inspection.files,
        vec![
            "backend/resources/items/queries.json",
            "dist/assets/app.js",
            "dist/index.html",
            "manifest.json",
            "migrations/001_notes.sql",
        ]
    );
    assert!(!inspection.files.iter().any(|path| {
        path.contains(".localapp")
            || path.contains("manifest.platform")
            || path.contains(".env")
            || path.contains("node_modules")
    }));
}

#[test]
fn inspection_rejects_archive_path_traversal_before_extracting() {
    let project = fixture_project();
    let package = project.path().join("invalid.localapp");
    let file = fs::File::create(&package).unwrap();
    let mut archive = zip::ZipWriter::new(file);
    archive
        .start_file(
            "../outside.txt",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
    archive.write_all(b"outside").unwrap();
    archive.finish().unwrap();

    let error = inspect_app_package(&package).unwrap_err();

    assert!(matches!(
        error,
        AppPackageValidationError::UnsafePath(path) if path == "../outside.txt"
    ));
    assert!(!project.path().join("outside.txt").exists());
}

#[test]
fn inspection_rejects_manifest_identity_mismatch() {
    let project = fixture_project();
    let package = project.path().join("mismatch.localapp");
    build_app_package(
        project.path(),
        &package,
        AppPackageMetadata {
            app_id: "different-app".into(),
            ..metadata()
        },
    )
    .unwrap();

    let error = inspect_app_package(&package).unwrap_err();

    assert!(matches!(
        error,
        AppPackageValidationError::InvalidMetadata(message)
            if message.contains("manifest name")
    ));
}
