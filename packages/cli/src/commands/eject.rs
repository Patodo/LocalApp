use crate::project::Manifest;
use crate::scripts::script_invokes_localapp_dev;
use std::fs;
use std::path::Path;

#[derive(clap::Args)]
pub struct EjectCommand {}

pub async fn run(_cmd: EjectCommand) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    eject_at(&cwd, StdinPrompt)
}

/// eject 核心逻辑。抽出此函数便于单测。
pub fn eject_at(project_dir: &Path, prompt: impl Prompt) -> Result<(), String> {
    // 1. 校验是 localapp 项目
    let dev_config_path = project_dir.join(".localapp/dev-config.json");
    if !dev_config_path.exists() {
        return Err("Not a localapp project. Run 'localapp init' first.".to_string());
    }

    // 2. 读 manifest.json 取 name（用于二次确认）
    let manifest = Manifest::read(project_dir)
        .ok_or_else(|| "Failed to read manifest.json. Run 'localapp init' first.".to_string())?;

    // 3. 警告 + 输入项目名确认
    eprintln!("⚠️  Eject is irreversible.");
    eprintln!("   This will move .localapp/runtime/ to src/_localapp_runtime/,");
    eprintln!("   rename .claude/skills/localapp-* to custom-localapp-*,");
    eprintln!("   and disable automatic sync (postinstall hook removed).");
    eprintln!("   You will lose auto-updates for SDK, DevShell, and skills.");
    eprintln!();
    eprintln!("Type '{}' to confirm eject:", manifest.name);

    let input = prompt.read_line()?;
    if input.trim() != manifest.name {
        return Err("Project name mismatch. Eject cancelled.".to_string());
    }

    // 4. 移动 runtime/ 到 src/_localapp_runtime/
    let runtime_src = project_dir.join(".localapp/runtime");
    let runtime_dst = project_dir.join("src/_localapp_runtime");
    if runtime_src.exists() {
        if runtime_dst.exists() {
            return Err(format!(
                "Target directory already exists: {}",
                runtime_dst.display()
            ));
        }
        // 确保 src/ 存在
        if let Some(parent) = runtime_dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create src/: {e}"))?;
        }
        fs::rename(&runtime_src, &runtime_dst)
            .map_err(|e| format!("Failed to move runtime: {e}"))?;
    }

    // 5. 重命名 .claude/skills/localapp* 和 agent-tool-patterns 为 custom-* 前缀
    let skills_dir = project_dir.join(".claude/skills");
    if skills_dir.exists() {
        let entries: Vec<_> = fs::read_dir(&skills_dir)
            .map_err(|e| format!("Failed to read skills: {e}"))?
            .filter_map(|e| e.ok())
            .collect();
        for entry in entries {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "agent-tool-patterns" || name.starts_with("localapp") {
                let new_name = if name == "agent-tool-patterns" {
                    "custom-agent-tool-patterns".to_string()
                } else {
                    format!("custom-{}", name)
                };
                let new_path = skills_dir.join(&new_name);
                if new_path.exists() {
                    eprintln!(
                        "  \u{26a0} Skip rename {} → {} (target exists)",
                        name, new_name
                    );
                    continue;
                }
                fs::rename(entry.path(), &new_path)
                    .map_err(|e| format!("Failed to rename skill {name}: {e}"))?;
            }
        }
    }

    // 6. 更新 package.json：替换 file: 引用路径 + 移除 postinstall
    update_package_json_for_eject(project_dir)?;

    // 7. 写入 ejected: true
    write_ejected_flag(&dev_config_path)?;

    println!(r#"{{"success": true, "ejected": true, "runtimePath": "src/_localapp_runtime"}}"#);
    eprintln!();
    eprintln!("  \u{2713} Eject complete.");
    eprintln!("  Next: run 'npm install' to refresh symlinks.");
    Ok(())
}

fn update_package_json_for_eject(project_dir: &Path) -> Result<(), String> {
    let pkg_path = project_dir.join("package.json");
    let content =
        fs::read_to_string(&pkg_path).map_err(|e| format!("Failed to read package.json: {e}"))?;

    let updated = content
        .replace(
            "file:./.localapp/runtime/sdk/core",
            "file:./src/_localapp_runtime/sdk/core",
        )
        .replace(
            "file:./.localapp/runtime/sdk/react",
            "file:./src/_localapp_runtime/sdk/react",
        )
        .replace(
            "file:./.localapp/runtime/sdk/agent",
            "file:./src/_localapp_runtime/sdk/agent",
        )
        .replace("file:./.localapp/runtime", "file:./src/_localapp_runtime");

    let mut pkg: serde_json::Value =
        serde_json::from_str(&updated).map_err(|e| format!("Failed to parse package.json: {e}"))?;

    if let Some(scripts) = pkg.get_mut("scripts").and_then(|s| s.as_object_mut()) {
        let dev_vite = scripts
            .get("dev:vite")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string());
        let dev_invokes_localapp = scripts
            .get("dev")
            .and_then(|value| value.as_str())
            .map(script_invokes_localapp_dev)
            .unwrap_or(false);
        if let (true, Some(vite_script)) = (dev_invokes_localapp, dev_vite) {
            scripts.insert("dev".to_string(), serde_json::Value::String(vite_script));
        }
        scripts.remove("dev:vite");
        scripts.remove("postinstall");
    }

    let serialized = serde_json::to_string_pretty(&pkg).unwrap_or_default();
    fs::write(&pkg_path, serialized).map_err(|e| format!("Failed to write package.json: {e}"))?;
    Ok(())
}

fn write_ejected_flag(dev_config_path: &Path) -> Result<(), String> {
    let content = fs::read_to_string(dev_config_path).unwrap_or_default();
    let mut parsed: serde_json::Value = if content.is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(&content).map_err(|e| format!("Invalid dev-config.json: {e}"))?
    };
    let obj = parsed
        .as_object_mut()
        .ok_or_else(|| "dev-config.json must be an object".to_string())?;
    obj.insert("ejected".to_string(), serde_json::Value::Bool(true));
    let serialized = serde_json::to_string_pretty(&parsed).unwrap();
    fs::write(dev_config_path, serialized)
        .map_err(|e| format!("Failed to write dev-config: {e}"))?;
    Ok(())
}

pub trait Prompt {
    fn read_line(&self) -> Result<String, String>;
}

struct StdinPrompt;
impl Prompt for StdinPrompt {
    fn read_line(&self) -> Result<String, String> {
        let mut input = String::new();
        std::io::stdin()
            .read_line(&mut input)
            .map_err(|e| format!("read error: {e}"))?;
        Ok(input)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn make_fake_project(name: &str) -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("test-app");
        fs::create_dir_all(project.join(".localapp/runtime")).unwrap();
        fs::write(
            project.join(".localapp/dev-config.json"),
            r#"{"serverUrl": "http://localhost:3000"}"#,
        )
        .unwrap();
        fs::write(
            project.join(".localapp/runtime/version.json"),
            r#"{"cliVersion": "0.1.0"}"#,
        )
        .unwrap();
        fs::write(
            project.join(".localapp/runtime/dev-shell.tsx"),
            "// dev-shell",
        )
        .unwrap();
        fs::create_dir_all(project.join(".localapp/runtime/sdk/core")).unwrap();
        fs::write(
            project.join(".localapp/runtime/sdk/core/package.json"),
            r#"{"name": "@localapp/sdk"}"#,
        )
        .unwrap();

        // manifest.json
        fs::write(
            project.join("manifest.json"),
            format!(
                r#"{{"name": "{}", "description": "", "distDir": "dist"}}"#,
                name
            ),
        )
        .unwrap();

        // package.json (post-eject state from init)
        let pkg = r#"{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "postinstall": "localapp sync --quiet 2>/dev/null || true"
  },
  "dependencies": {
    "@localapp/sdk": "file:./.localapp/runtime/sdk/core",
    "@localapp/sdk-react": "file:./.localapp/runtime/sdk/react",
    "@localapp/app-kit": "file:./.localapp/runtime"
  }
}"#;
        fs::create_dir_all(project.join("src")).unwrap();
        fs::write(project.join("package.json"), pkg).unwrap();
        fs::write(project.join("src/App.tsx"), "// user code").unwrap();

        // Skills
        fs::create_dir_all(project.join(".claude/skills/localapp")).unwrap();
        fs::write(project.join(".claude/skills/localapp/SKILL.md"), "skill").unwrap();
        fs::create_dir_all(project.join(".claude/skills/localapp-ui")).unwrap();
        fs::write(
            project.join(".claude/skills/localapp-ui/SKILL.md"),
            "ui skill",
        )
        .unwrap();
        fs::create_dir_all(project.join(".claude/skills/agent-tool-patterns")).unwrap();
        fs::write(
            project.join(".claude/skills/agent-tool-patterns/SKILL.md"),
            "agent skill",
        )
        .unwrap();
        fs::create_dir_all(project.join(".claude/skills/my-custom")).unwrap();
        fs::write(
            project.join(".claude/skills/my-custom/SKILL.md"),
            "user skill",
        )
        .unwrap();

        tmp
    }

    fn project_path(tmp: &tempfile::TempDir) -> PathBuf {
        tmp.path().join("test-app")
    }

    struct PromptCorrect;
    impl Prompt for PromptCorrect {
        fn read_line(&self) -> Result<String, String> {
            Ok("test-app\n".to_string())
        }
    }

    struct PromptWrong;
    impl Prompt for PromptWrong {
        fn read_line(&self) -> Result<String, String> {
            Ok("wrong-name\n".to_string())
        }
    }

    #[test]
    fn eject_moves_runtime_to_src() {
        let tmp = make_fake_project("test-app");
        let project = project_path(&tmp);

        eject_at(&project, PromptCorrect).unwrap();

        assert!(!project.join(".localapp/runtime").exists());
        assert!(project.join("src/_localapp_runtime").is_dir());
        assert!(project.join("src/_localapp_runtime/dev-shell.tsx").exists());
        assert!(
            project
                .join("src/_localapp_runtime/sdk/core/package.json")
                .exists()
        );
        assert!(project.join("src/_localapp_runtime/version.json").exists());
    }

    #[test]
    fn eject_renames_localapp_skills_to_custom_prefix() {
        let tmp = make_fake_project("test-app");
        let project = project_path(&tmp);

        eject_at(&project, PromptCorrect).unwrap();

        assert!(
            project
                .join(".claude/skills/custom-localapp/SKILL.md")
                .exists()
        );
        assert!(
            project
                .join(".claude/skills/custom-localapp-ui/SKILL.md")
                .exists()
        );
        assert!(
            project
                .join(".claude/skills/custom-agent-tool-patterns/SKILL.md")
                .exists()
        );
        // 用户自定义 skill 保持不变
        assert!(project.join(".claude/skills/my-custom/SKILL.md").exists());
        // 原 localapp-* 不存在
        assert!(!project.join(".claude/skills/localapp").exists());
        assert!(!project.join(".claude/skills/localapp-ui").exists());
        assert!(!project.join(".claude/skills/agent-tool-patterns").exists());
    }

    #[test]
    fn eject_updates_package_json_paths_and_removes_postinstall() {
        let tmp = make_fake_project("test-app");
        let project = project_path(&tmp);

        eject_at(&project, PromptCorrect).unwrap();

        let pkg = fs::read_to_string(project.join("package.json")).unwrap();
        assert!(pkg.contains("file:./src/_localapp_runtime/sdk/core"));
        assert!(pkg.contains("file:./src/_localapp_runtime/sdk/react"));
        assert!(pkg.contains("file:./src/_localapp_runtime\""));
        assert!(!pkg.contains("postinstall"));
        assert!(!pkg.contains(".localapp/runtime"));
    }

    #[test]
    fn eject_restores_dev_script_from_dev_vite() {
        let tmp = make_fake_project("test-app");
        let project = project_path(&tmp);
        fs::write(
            project.join("package.json"),
            r#"{
  "scripts": {
    "dev": "cross-env NODE_ENV=development localapp dev --host 0.0.0.0",
    "dev:vite": "vite --host 127.0.0.1",
    "postinstall": "localapp sync --quiet 2>/dev/null || true"
  },
  "dependencies": {
    "@localapp/sdk": "file:./.localapp/runtime/sdk/core",
    "@localapp/sdk-react": "file:./.localapp/runtime/sdk/react",
    "@localapp/app-kit": "file:./.localapp/runtime"
  }
}"#,
        )
        .unwrap();

        eject_at(&project, PromptCorrect).unwrap();

        let pkg = fs::read_to_string(project.join("package.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&pkg).unwrap();
        assert_eq!(
            parsed["scripts"]["dev"].as_str(),
            Some("vite --host 127.0.0.1"),
        );
        assert!(parsed["scripts"].get("dev:vite").is_none());
        assert!(parsed["scripts"].get("postinstall").is_none());
    }

    #[test]
    fn eject_writes_ejected_flag() {
        let tmp = make_fake_project("test-app");
        let project = project_path(&tmp);

        eject_at(&project, PromptCorrect).unwrap();

        let config = fs::read_to_string(project.join(".localapp/dev-config.json")).unwrap();
        assert!(config.contains("\"ejected\": true"));
    }

    #[test]
    fn eject_wrong_name_cancels_no_modification() {
        let tmp = make_fake_project("test-app");
        let project = project_path(&tmp);

        let runtime_before = project.join(".localapp/runtime/dev-shell.tsx");
        let runtime_existed_before = runtime_before.exists();

        let result = eject_at(&project, PromptWrong);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Project name mismatch"));
        assert!(
            !err.starts_with("{\"error\""),
            "error should be plain string, not JSON-encoded"
        );

        // 无文件被修改
        assert_eq!(runtime_existed_before, runtime_before.exists());
        assert!(project.join(".localapp/runtime").exists());
        assert!(!project.join("src/_localapp_runtime").exists());
    }

    #[test]
    fn eject_rejects_non_project_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let result = eject_at(tmp.path(), PromptCorrect);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Not a localapp project"));
        assert!(
            !err.starts_with("{\"error\""),
            "error should be plain string"
        );
    }
}
