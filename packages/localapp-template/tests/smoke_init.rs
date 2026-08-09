#[test]
fn init_real_project_for_smoke() {
    let temp_dir = tempfile::tempdir().unwrap();
    let dir = temp_dir.path();
    localapp_template::extract_user_zone(dir).unwrap();
    localapp_template::extract_cli_zone(dir).unwrap();
    localapp_template::extract_backend_seed_if_missing(dir).unwrap();
    localapp_template::write_runtime_version(dir, "0.1.0").unwrap();
    localapp_template::postprocess_package_json(dir).unwrap();
    // AGENTS.md (复制 CLAUDE.md)
    let claude = dir.join("CLAUDE.md");
    if claude.is_file() {
        std::fs::copy(&claude, dir.join("AGENTS.md")).unwrap();
    }
    // manifest.json
    let manifest = serde_json::json!({
        "name":"面试管理","description":"管理候选人、预览 PDF 简历、跟踪面试流程",
        "distDir":"dist",
        "db":{"mode":"crud","sqlAccess":"authenticated"},
        "backend":{"root":"backend"},
        "requires":{"backend":"named-sql","identity":["currentUser","pageOwner"],"primitives":[]},
        "platformVersion":"^1.2"
    });
    std::fs::write(dir.join("manifest.json"), serde_json::to_string_pretty(&manifest).unwrap()).unwrap();
    println!("INIT_DIR={}", dir.display());
}
