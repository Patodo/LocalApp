use std::process::Command;
use tempfile::tempdir;

#[test]
fn verify_json_writes_one_structured_report_even_when_project_resolution_fails() {
    let project = tempdir().unwrap();
    let config = tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_localapp"))
        .args(["verify", "--as", "member", "--json"])
        .current_dir(project.path())
        .env("LOCALAPP_CONFIG_DIR", config.path())
        .output()
        .unwrap();

    assert!(!output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert_eq!(stdout.lines().count(), 1);
    let report: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(report["schemaVersion"], 1);
    assert_eq!(report["success"], false);
    assert_eq!(report["status"], "failed");
    assert_eq!(report["identity"], "member");
    assert_eq!(report["checks"][0]["phase"], "project");
    assert_eq!(report["checks"][0]["status"], "failed");
}
