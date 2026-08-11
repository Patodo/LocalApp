//! Staging 行为测试：验证 localapp-template crate 生成的嵌入模板 staging 结构。
//!
//! 这些测试依赖 build.rs 已运行（cargo test 会自动先跑 build.rs）。

use std::path::Path;

fn staging_dir() -> std::path::PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    Path::new(manifest_dir).join("../localapp-template/target/init-repo-staging")
}

#[test]
fn staging_runtime_sdk_core_package_json_exists() {
    let path = staging_dir().join("runtime/sdk/core/package.json");
    assert!(
        path.exists(),
        "expected staging/runtime/sdk/core/package.json to exist at {} — build.rs should inject SDK into staging",
        path.display()
    );
}

#[test]
fn staging_runtime_sdk_react_package_json_exists() {
    let path = staging_dir().join("runtime/sdk/react/package.json");
    assert!(
        path.exists(),
        "expected staging/runtime/sdk/react/package.json to exist at {}",
        path.display()
    );
}

#[test]
fn staging_runtime_sdk_agent_package_json_exists() {
    let path = staging_dir().join("runtime/sdk/agent/package.json");
    assert!(
        path.exists(),
        "expected staging/runtime/sdk/agent/package.json to exist at {}",
        path.display()
    );
}

#[test]
fn staging_runtime_version_json_exists_and_contains_cli_version() {
    let path = staging_dir().join("runtime/version.json");
    assert!(path.exists(), "version.json missing at {}", path.display());

    let content = std::fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value =
        serde_json::from_str(&content).expect("version.json should be valid JSON");

    let cli_version = parsed
        .get("cliVersion")
        .and_then(|v| v.as_str())
        .expect("version.json should contain 'cliVersion' string");

    assert!(!cli_version.is_empty(), "cliVersion must not be empty");
}

#[test]
fn staging_runtime_platform_capabilities_match_the_canonical_contract() {
    let staged_path = staging_dir().join("runtime/platform-capabilities.json");
    assert!(
        staged_path.exists(),
        "platform-capabilities.json missing at {}",
        staged_path.display()
    );

    let canonical_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../platform/capabilities.json");
    let staged: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(staged_path).expect("staged capabilities should be readable"),
    )
    .expect("staged capabilities should be valid JSON");
    let canonical: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(canonical_path)
            .expect("canonical capabilities should be readable"),
    )
    .expect("canonical capabilities should be valid JSON");

    assert_eq!(staged, canonical);
}

#[test]
fn staging_runtime_sdk_excludes_node_modules() {
    let node_modules = staging_dir().join("runtime/sdk/core/node_modules");
    assert!(
        !node_modules.exists(),
        "staging should exclude node_modules from runtime/sdk/"
    );
}

#[test]
fn staging_agent_skill_requires_the_full_delivery_loop() {
    let path = staging_dir().join(".claude/skills/localapp/SKILL.md");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));

    assert!(content.contains("localapp check --json"));
    assert!(content.contains("localapp build --package"));
    assert!(content.contains("localapp app install --target <name>"));
    assert!(content.contains("localapp app sync --peer <name>"));
    assert!(content.contains("localapp verify --as member --json"));
    assert!(content.contains("deployment.status=deployed"));
    assert!(content.contains("verification.status=pending-browser"));
    assert!(content.contains("正式验收通过"));
    assert!(content.contains("--security-profile owner --identity-field created_by"));
}
