#[test]
fn init_real_project_for_smoke() {
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = repo_root
        .join("tmp")
        .join(format!("template-smoke-{}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    std::fs::create_dir_all(&dir).unwrap();
    localapp_template::extract_user_zone(&dir).unwrap();
    localapp_template::extract_cli_zone(&dir).unwrap();
    localapp_template::extract_backend_seed_if_missing(&dir).unwrap();
    localapp_template::write_runtime_version(&dir, "0.1.0").unwrap();
    localapp_template::postprocess_package_json(&dir).unwrap();

    assert_eq!(
        std::fs::read(dir.join("AGENTS.md")).unwrap(),
        std::fs::read(repo_root.join("init-repo/AGENTS.md")).unwrap()
    );
    assert_eq!(
        std::fs::read(dir.join(".npmrc")).unwrap(),
        std::fs::read(repo_root.join("init-repo/.npmrc")).unwrap()
    );
    assert_eq!(
        std::fs::read(dir.join(".claude/skills/localapp-device-actions/SKILL.md")).unwrap(),
        std::fs::read(repo_root.join("init-repo/.claude/skills/localapp-device-actions/SKILL.md"))
            .unwrap()
    );

    let package: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("package.json")).unwrap()).unwrap();
    assert_eq!(package["dependencies"]["react-pdf"], "10.4.1");
    assert_eq!(package["dependencies"]["pdfjs-dist"], "5.4.296");
    assert_eq!(
        package["dependencies"]["yet-another-react-lightbox"],
        "3.32.1"
    );
    assert!(dir.join("migrations/001_work_items.sql").is_file());
    assert!(dir.join(".localapp/runtime/vite-plugin.mjs").is_file());

    // manifest.json
    let manifest = serde_json::json!({
        "name":"面试管理","description":"管理候选人、预览 PDF 简历、跟踪面试流程",
        "distDir":"dist",
        "db":{"mode":"crud","sqlAccess":"authenticated"},
        "backend":{"root":"backend"},
        "requires":{"backend":"named-sql","identity":["currentUser","pageOwner"],"primitives":[]},
        "platformVersion":"^1.2"
    });
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
    println!("INIT_DIR={}", dir.display());
    std::fs::remove_dir_all(&dir).unwrap();
}
