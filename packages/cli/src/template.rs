use crate::scripts::script_invokes_localapp_dev;
use crate::version::cli_version;
use include_dir::{Dir, DirEntry, include_dir};
use std::fs;
use std::path::Path;

/// CLI 二进制内嵌的 init-repo 模板。
///
/// staging 阶段（build.rs）已经把：
/// - init-repo 源码（用户领地 + runtime/ CLI 领地源码）
/// - packages/sdk-{core,react,agent} 和 packages/backend 复制到 staging/runtime/sdk/{core,react,agent,backend}/
/// - 生成 staging/runtime/version.json
///
/// 都包含在此 Dir 中，由 user_zone 和 cli_zone 分别抽取到用户项目。
pub static BUILTIN_TEMPLATE: Dir = include_dir!("$INIT_REPO_DIR");

/// 用户领地排除的顶层目录。
const USER_ZONE_EXCLUDES: &[&str] = &[
    "node_modules",
    "dist",
    ".next",
    ".DS_Store",
    "runtime", // CLI 领地
    ".claude", // CLI 领地（skills）；用户后续可在此目录加自己的内容
];

const POSTINSTALL_SYNC_SCRIPT: &str = "node -e \"try{require('child_process').spawnSync('localapp',['sync','--quiet'],{stdio:'ignore',shell:true})}catch{}process.exit(0)\"";

/// 抽取「用户领地」到目标目录。
///
/// 用户领地 = init-repo 模板根的所有用户拥有文件
/// （manifest.json、package.json、vite.config.ts、tsconfig.json、src/App.tsx、tests/ 等）。
/// 排除 node_modules/dist 等 build 产物，以及 runtime/ 和 .claude/（CLI 领地）。
pub fn extract_user_zone(target_dir: &Path) -> Result<(), String> {
    extract_dir(&BUILTIN_TEMPLATE, target_dir, USER_ZONE_EXCLUDES)
}

pub fn extract_backend_seed_if_missing(target_dir: &Path) -> Result<(), String> {
    let dst = target_dir.join("backend");
    if dst.exists() {
        return Ok(());
    }
    if let Some(backend_dir) = BUILTIN_TEMPLATE.get_dir("backend") {
        fs::create_dir_all(&dst).map_err(|e| format!("Failed to create backend dir: {e}"))?;
        extract_dir(backend_dir, &dst, &[])?;
    }
    Ok(())
}

/// 抽取「CLI 领地」到目标目录的 `.localapp/runtime/` 和 `.claude/skills/localapp*` 等。
///
/// CLI 领地是「我们的」代码，sync 时整体覆盖。包括：
/// - `.localapp/runtime/`：vite-plugin、dev-shell、SDK 源码、tsconfig.base、styles、version.json
/// - `.claude/skills/localapp*/` 和 `.claude/skills/agent-tool-patterns/`：AI 指引文档
pub fn extract_cli_zone(target_dir: &Path) -> Result<(), String> {
    // 1. runtime/ → .localapp/runtime/
    if let Some(runtime_dir) = BUILTIN_TEMPLATE.get_dir("runtime") {
        let dst = target_dir.join(".localapp/runtime");
        fs::create_dir_all(&dst).map_err(|e| format!("Failed to create .localapp/runtime: {e}"))?;
        extract_dir(runtime_dir, &dst, &[])?;
    }

    // 2. .claude/skills/localapp* and agent-tool-patterns → .claude/skills/<name>/
    if let Some(skills_dir) = BUILTIN_TEMPLATE.get_dir(".claude/skills") {
        let dst_skills = target_dir.join(".claude/skills");
        fs::create_dir_all(&dst_skills)
            .map_err(|e| format!("Failed to create .claude/skills: {e}"))?;
        for entry in skills_dir.entries() {
            if let DirEntry::Dir(sub_dir) = entry {
                let name = sub_dir
                    .path()
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| sub_dir.path().to_string_lossy().to_string());
                if name == "agent-tool-patterns" || name.starts_with("localapp") {
                    let skill_dst = dst_skills.join(&name);
                    fs::create_dir_all(&skill_dst)
                        .map_err(|e| format!("Failed to create skill dir: {e}"))?;
                    extract_dir(sub_dir, &skill_dst, &[])?;
                }
            }
        }
    }

    Ok(())
}

/// 写入 `.localapp/runtime/version.json`，内容为 `{"cliVersion": "<version>"}`。
///
/// 用于 sync 比对：用户项目的 runtime 版本号 vs 当前 CLI 版本号。
pub fn write_runtime_version(target_dir: &Path) -> Result<(), String> {
    let version_path = target_dir.join(".localapp/runtime/version.json");
    if let Some(parent) = version_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create version.json parent: {e}"))?;
    }
    let content = format!("{{\n  \"cliVersion\": \"{}\"\n}}\n", cli_version());
    fs::write(&version_path, content).map_err(|e| format!("Failed to write version.json: {e}"))?;
    Ok(())
}

/// 后处理用户项目 `package.json`：
/// - 将 `workspace:*` 引用替换为 `file:./.localapp/runtime/...`
/// - 将 mini-server 所需的 `@localapp/server-core` 指向内置 runtime 包
/// - 兼容旧架构：把 `file:./vendor/sdk-*` 迁移到 `file:./.localapp/runtime/sdk/*`
/// - 注入跨平台 postinstall 钩子，安装后静默尝试刷新 CLI 领地
/// - 清理 runtime/sdk/ 内残留的 `workspace:*` 引用
pub fn postprocess_package_json(target_dir: &Path) -> Result<(), String> {
    let pkg_path = target_dir.join("package.json");
    let content =
        fs::read_to_string(&pkg_path).map_err(|e| format!("Failed to read package.json: {e}"))?;

    let updated = content
        .replace(
            "\"@localapp/server-core\": \"workspace:*\"",
            "\"@localapp/server-core\": \"file:./.localapp/runtime/server-core\"",
        )
        .replace(
            "\"@localapp/sdk\": \"workspace:*\"",
            "\"@localapp/sdk\": \"file:./.localapp/runtime/sdk/core\"",
        )
        .replace(
            "\"@localapp/sdk-react\": \"workspace:*\"",
            "\"@localapp/sdk-react\": \"file:./.localapp/runtime/sdk/react\"",
        )
        .replace(
            "\"@localapp/sdk-agent\": \"workspace:*\"",
            "\"@localapp/sdk-agent\": \"file:./.localapp/runtime/sdk/agent\"",
        )
        .replace(
            "\"@localapp/app-kit\": \"workspace:*\"",
            "\"@localapp/app-kit\": \"file:./.localapp/runtime\"",
        )
        // 旧架构迁移：vendor/sdk-* → .localapp/runtime/sdk/*
        .replace(
            "\"@localapp/sdk\": \"file:./vendor/sdk-core\"",
            "\"@localapp/sdk\": \"file:./.localapp/runtime/sdk/core\"",
        )
        .replace(
            "\"@localapp/sdk-react\": \"file:./vendor/sdk-react\"",
            "\"@localapp/sdk-react\": \"file:./.localapp/runtime/sdk/react\"",
        )
        .replace(
            "\"@localapp/sdk-agent\": \"file:./vendor/sdk-agent\"",
            "\"@localapp/sdk-agent\": \"file:./.localapp/runtime/sdk/agent\"",
        );

    let mut pkg: serde_json::Value =
        serde_json::from_str(&updated).map_err(|e| format!("Failed to parse package.json: {e}"))?;

    // 旧架构项目 package.json 可能缺少后来新增的 CLI 领地依赖，sync 时补上。
    fn ensure_file_dep(
        obj: &mut serde_json::Map<String, serde_json::Value>,
        name: &str,
        target: &str,
    ) {
        if !obj.contains_key(name) {
            obj.insert(
                name.to_string(),
                serde_json::Value::String(target.to_string()),
            );
        }
    }
    if let Some(deps) = pkg.get_mut("dependencies").and_then(|d| d.as_object_mut()) {
        ensure_file_dep(deps, "@localapp/app-kit", "file:./.localapp/runtime");
        ensure_file_dep(
            deps,
            "@localapp/server-core",
            "file:./.localapp/runtime/server-core",
        );
        ensure_file_dep(deps, "unified", "^11.0.5");
        ensure_file_dep(deps, "remark-parse", "^11.0.0");
    }

    if let Some(scripts) = pkg.get_mut("scripts").and_then(|s| s.as_object_mut()) {
        ensure_localapp_dev_scripts(scripts);
        scripts.insert(
            "postinstall".to_string(),
            serde_json::Value::String(POSTINSTALL_SYNC_SCRIPT.to_string()),
        );
    } else if let Some(obj) = pkg.as_object_mut() {
        let mut scripts = serde_json::Map::new();
        ensure_localapp_dev_scripts(&mut scripts);
        scripts.insert(
            "postinstall".to_string(),
            serde_json::Value::String(POSTINSTALL_SYNC_SCRIPT.to_string()),
        );
        obj.insert("scripts".to_string(), serde_json::Value::Object(scripts));
    }

    let serialized = serde_json::to_string_pretty(&pkg).unwrap_or_default();
    fs::write(&pkg_path, serialized).map_err(|e| format!("Failed to write package.json: {e}"))?;

    clean_runtime_sdk_workspace_refs(&target_dir.join(".localapp/runtime/sdk"))?;

    // 旧架构遗留的 vendor/ 目录已无引用，删除以避免 pnpm 缓存命中
    let vendor_dir = target_dir.join("vendor");
    if vendor_dir.exists() {
        fs::remove_dir_all(&vendor_dir)
            .map_err(|e| format!("Failed to remove stale vendor/: {e}"))?;
    }

    Ok(())
}

fn ensure_localapp_dev_scripts(scripts: &mut serde_json::Map<String, serde_json::Value>) {
    if !scripts.contains_key("dev:vite") {
        let vite_script = scripts
            .get("dev")
            .and_then(|value| value.as_str())
            .filter(|value| !script_invokes_localapp_dev(value))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("vite")
            .to_string();
        scripts.insert(
            "dev:vite".to_string(),
            serde_json::Value::String(vite_script),
        );
    }

    scripts.insert(
        "dev".to_string(),
        serde_json::Value::String("localapp dev".to_string()),
    );
}

/// 遍历 `.localapp/runtime/sdk/` 下每个子包，将 `package.json` 中残留的 `workspace:*` 替换为 `*`。
pub fn clean_runtime_sdk_workspace_refs(sdk_dir: &Path) -> Result<(), String> {
    if !sdk_dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(sdk_dir).map_err(|e| format!("Failed to read sdk dir: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let pkg_path = entry.path().join("package.json");
        if pkg_path.exists() {
            let content = fs::read_to_string(&pkg_path)
                .map_err(|e| format!("Failed to read {}: {e}", pkg_path.display()))?;
            let updated = content.replace("\"workspace:*\"", "\"*\"");
            if updated != content {
                fs::write(&pkg_path, updated)
                    .map_err(|e| format!("Failed to write {}: {e}", pkg_path.display()))?;
            }
        }
    }
    Ok(())
}

fn extract_dir(dir: &Dir, target_dir: &Path, exclude_dirs: &[&str]) -> Result<(), String> {
    for entry in dir.entries() {
        match entry {
            DirEntry::Dir(sub_dir) => {
                let dir_name = sub_dir
                    .path()
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| sub_dir.path().to_string_lossy().to_string());
                if exclude_dirs.iter().any(|e| dir_name == *e) {
                    continue;
                }
                let dir_path = target_dir.join(&dir_name);
                fs::create_dir_all(&dir_path)
                    .map_err(|e| format!("Failed to create dir {}: {e}", dir_path.display()))?;
                extract_dir(sub_dir, &dir_path, exclude_dirs)?;
            }
            DirEntry::File(file) => {
                let file_name = file
                    .path()
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| file.path().to_string_lossy().to_string());
                let file_path = target_dir.join(&file_name);
                if let Some(parent) = file_path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create dir {}: {e}", parent.display()))?;
                }
                fs::write(&file_path, file.contents())
                    .map_err(|e| format!("Failed to write {}: {e}", file_path.display()))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_template_contains_package_json() {
        let file = BUILTIN_TEMPLATE
            .get_file("package.json")
            .expect("package.json should exist in builtin template");
        let content = file.contents_utf8().expect("should be valid utf8");
        assert!(content.contains("localapp-app"));
    }

    #[test]
    fn builtin_template_contains_src_dir() {
        BUILTIN_TEMPLATE
            .get_dir("src")
            .expect("src/ directory should exist in builtin template");
    }

    #[test]
    fn builtin_template_contains_runtime_dir() {
        BUILTIN_TEMPLATE
            .get_dir("runtime")
            .expect("runtime/ directory should exist in builtin template (CLI zone)");
    }

    #[test]
    fn builtin_template_contains_runtime_sdk_core() {
        BUILTIN_TEMPLATE.get_dir("runtime/sdk/core").expect(
            "runtime/sdk/core/ should exist in builtin template (staged from packages/sdk-core)",
        );
        BUILTIN_TEMPLATE.get_dir("runtime/sdk/backend").expect(
            "runtime/sdk/backend/ should exist in builtin template (staged from packages/backend)",
        );
    }

    #[test]
    fn builtin_template_contains_runtime_server_core() {
        BUILTIN_TEMPLATE
            .get_file("runtime/server-core/package.json")
            .expect("runtime/server-core/package.json should exist in builtin template");
        BUILTIN_TEMPLATE
            .get_file("runtime/server-core/dist/index.js")
            .expect("runtime/server-core/dist/index.js should exist in builtin template");
    }

    #[test]
    fn builtin_template_contains_shadcn_ui_files() {
        BUILTIN_TEMPLATE
            .get_file("components.json")
            .expect("components.json should exist");
        BUILTIN_TEMPLATE
            .get_file("src/lib/utils.ts")
            .expect("src/lib/utils.ts should exist");
        BUILTIN_TEMPLATE
            .get_file("src/components/ui/button.tsx")
            .expect("shadcn button component should exist");
        BUILTIN_TEMPLATE
            .get_file(".claude/skills/localapp-ui/SKILL.md")
            .expect("localapp-ui skill (directory form) should exist");
    }

    #[test]
    fn extract_user_zone_creates_user_files() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("test-project");
        fs::create_dir_all(&target).unwrap();

        extract_user_zone(&target).unwrap();

        // 用户领地有 package.json、src/App.tsx、tests/ 等
        assert!(target.join("package.json").exists());
        assert!(target.join("src/App.tsx").exists());
        assert!(target.join("src/main.tsx").exists());
        assert!(target.join("tests").is_dir());
        // 用户领地不应包含 runtime/ 或 .claude/
        assert!(!target.join("runtime").exists());
        assert!(!target.join(".claude").exists());
        assert!(!target.join("node_modules").exists());
    }

    #[test]
    fn extract_cli_zone_creates_runtime_and_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("test-project");
        fs::create_dir_all(&target).unwrap();

        extract_cli_zone(&target).unwrap();

        // CLI 领地有 .localapp/runtime/
        assert!(target.join(".localapp/runtime").is_dir());
        assert!(target.join(".localapp/runtime/dev-shell.tsx").exists());
        assert!(target.join(".localapp/runtime/vite-plugin.mjs").exists());
        assert!(
            target
                .join(".localapp/runtime/sdk/core/package.json")
                .exists()
        );
        assert!(
            target
                .join(".localapp/runtime/sdk/backend/package.json")
                .exists()
        );
        assert!(
            target
                .join(".localapp/runtime/sdk/react/package.json")
                .exists()
        );
        assert!(
            target
                .join(".localapp/runtime/sdk/agent/package.json")
                .exists()
        );

        // CLI 领地有 .claude/skills/localapp-*
        assert!(target.join(".claude/skills/localapp/SKILL.md").exists());
        assert!(target.join(".claude/skills/localapp-ui/SKILL.md").exists());
        assert!(target.join(".claude/skills/agent-tool-patterns").is_dir());

        // CLI 领地不应包含用户文件
        assert!(!target.join("package.json").exists());
        assert!(!target.join("src/App.tsx").exists());
    }

    #[test]
    fn write_runtime_version_writes_current_cli_version() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("test-project");
        fs::create_dir_all(&target).unwrap();

        write_runtime_version(&target).unwrap();

        let version_path = target.join(".localapp/runtime/version.json");
        assert!(version_path.exists());

        let content = fs::read_to_string(&version_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["cliVersion"].as_str(), Some(cli_version()));
    }

    #[test]
    fn postprocess_replaces_workspace_refs_and_adds_postinstall() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("test-project");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(target.join(".localapp/runtime/sdk/core")).unwrap();

        let pkg_json = r#"{
  "scripts": {
    "dev": "vite"
  },
  "dependencies": {
    "@localapp/server-core": "workspace:*",
    "@localapp/sdk": "workspace:*",
    "@localapp/sdk-react": "workspace:*",
    "@localapp/app-kit": "workspace:*",
    "react": "^18.3.0"
  },
  "optionalDependencies": {
    "@localapp/sdk-agent": "workspace:*"
  }
}"#;
        fs::write(target.join("package.json"), pkg_json).unwrap();

        postprocess_package_json(&target).unwrap();

        let result = fs::read_to_string(target.join("package.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(
            result.contains("\"@localapp/server-core\": \"file:./.localapp/runtime/server-core\"")
        );
        assert!(result.contains("\"@localapp/sdk\": \"file:./.localapp/runtime/sdk/core\""));
        assert!(!result.contains("\"@localapp/backend\""));
        assert!(result.contains("\"@localapp/sdk-react\": \"file:./.localapp/runtime/sdk/react\""));
        assert!(result.contains("\"@localapp/sdk-agent\": \"file:./.localapp/runtime/sdk/agent\""));
        assert!(result.contains("\"@localapp/app-kit\": \"file:./.localapp/runtime\""));
        assert_eq!(
            parsed["scripts"]["postinstall"].as_str(),
            Some(
                "node -e \"try{require('child_process').spawnSync('localapp',['sync','--quiet'],{stdio:'ignore',shell:true})}catch{}process.exit(0)\""
            ),
        );
        assert!(!result.contains("workspace:*"));
    }

    #[test]
    fn postprocess_makes_dev_script_enter_localapp_dev_and_preserves_vite_script() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("test-project");
        fs::create_dir_all(&target).unwrap();

        let pkg_json = r#"{
  "scripts": {
    "dev": "vite --host 127.0.0.1"
  },
  "dependencies": {
    "@localapp/app-kit": "file:./.localapp/runtime"
  }
}"#;
        fs::write(target.join("package.json"), pkg_json).unwrap();

        postprocess_package_json(&target).unwrap();

        let result = fs::read_to_string(target.join("package.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["scripts"]["dev"].as_str(), Some("localapp dev"));
        assert_eq!(
            parsed["scripts"]["dev:vite"].as_str(),
            Some("vite --host 127.0.0.1"),
        );
    }

    #[test]
    fn postprocess_does_not_overwrite_existing_dev_vite_script() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("test-project");
        fs::create_dir_all(&target).unwrap();

        let pkg_json = r#"{
  "scripts": {
    "dev": "localapp dev",
    "dev:vite": "vite --debug"
  },
  "dependencies": {
    "@localapp/app-kit": "file:./.localapp/runtime"
  }
}"#;
        fs::write(target.join("package.json"), pkg_json).unwrap();

        postprocess_package_json(&target).unwrap();

        let result = fs::read_to_string(target.join("package.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["scripts"]["dev"].as_str(), Some("localapp dev"));
        assert_eq!(parsed["scripts"]["dev:vite"].as_str(), Some("vite --debug"));
    }

    #[test]
    fn postprocess_does_not_preserve_recursive_dev_as_dev_vite() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("test-project");
        fs::create_dir_all(&target).unwrap();

        let pkg_json = r#"{
  "scripts": {
    "dev": "cross-env NODE_ENV=development localapp dev --host 0.0.0.0"
  },
  "dependencies": {
    "@localapp/app-kit": "file:./.localapp/runtime"
  }
}"#;
        fs::write(target.join("package.json"), pkg_json).unwrap();

        postprocess_package_json(&target).unwrap();

        let result = fs::read_to_string(target.join("package.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["scripts"]["dev"].as_str(), Some("localapp dev"));
        assert_eq!(parsed["scripts"]["dev:vite"].as_str(), Some("vite"));
    }

    #[test]
    fn postprocess_adds_missing_mini_server_dependencies() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("test-project");
        fs::create_dir_all(&target).unwrap();

        let pkg_json = r#"{
  "dependencies": {
    "@localapp/app-kit": "file:./.localapp/runtime"
  },
  "scripts": {
    "dev": "vite"
  }
}"#;
        fs::write(target.join("package.json"), pkg_json).unwrap();

        postprocess_package_json(&target).unwrap();

        let result = fs::read_to_string(target.join("package.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(
            parsed["dependencies"]["@localapp/server-core"].as_str(),
            Some("file:./.localapp/runtime/server-core"),
        );
        assert_eq!(
            parsed["dependencies"]["unified"].as_str(),
            Some("^11.0.5"),
        );
        assert_eq!(
            parsed["dependencies"]["remark-parse"].as_str(),
            Some("^11.0.0"),
        );
    }

    #[test]
    fn clean_runtime_sdk_workspace_refs_cleans_nested() {
        let tmp = tempfile::tempdir().unwrap();
        let sdk = tmp.path().join(".localapp/runtime/sdk/react");
        fs::create_dir_all(&sdk).unwrap();

        let nested_pkg = r#"{
  "peerDependencies": {
    "@localapp/sdk": "workspace:*",
    "react": ">=18"
  }
}"#;
        fs::write(sdk.join("package.json"), nested_pkg).unwrap();

        clean_runtime_sdk_workspace_refs(&tmp.path().join(".localapp/runtime/sdk")).unwrap();

        let result = fs::read_to_string(sdk.join("package.json")).unwrap();
        assert!(result.contains("\"@localapp/sdk\": \"*\""));
        assert!(!result.contains("workspace:*"));
    }

    #[test]
    fn clean_runtime_sdk_workspace_refs_handles_missing_dir() {
        let result = clean_runtime_sdk_workspace_refs(Path::new("/nonexistent/path"));
        assert!(result.is_ok(), "should silently handle missing dir");
    }
}
