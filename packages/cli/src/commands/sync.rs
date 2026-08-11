use crate::commands::project_config;
use crate::scripts::script_invokes_localapp_dev;
use crate::template::{
    extract_backend_seed_if_missing, extract_cli_zone, postprocess_package_json,
    remove_runtime_compatibility_path, write_runtime_version,
};
use crate::version::cli_version;
use std::fs;
use std::path::Path;

fn read_custom_dev_script(project_dir: &Path) -> Option<serde_json::Value> {
    let content = fs::read_to_string(project_dir.join("package.json")).ok()?;
    let package: serde_json::Value = serde_json::from_str(&content).ok()?;
    let script = package.get("scripts")?.get("dev")?.as_str()?;
    if script.trim().is_empty() || script_invokes_localapp_dev(script) {
        return None;
    }
    Some(serde_json::Value::String(script.to_string()))
}

fn restore_custom_dev_script(
    project_dir: &Path,
    custom_dev_script: Option<serde_json::Value>,
) -> Result<(), String> {
    let Some(custom_dev_script) = custom_dev_script else {
        return Ok(());
    };
    let package_path = project_dir.join("package.json");
    let content = fs::read_to_string(&package_path)
        .map_err(|error| format!("Failed to read package.json: {error}"))?;
    let mut package: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse package.json: {error}"))?;
    let scripts = package
        .get_mut("scripts")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| "package.json scripts must be an object".to_string())?;
    scripts.insert("dev".to_string(), custom_dev_script);
    let serialized = serde_json::to_string_pretty(&package)
        .map_err(|error| format!("Failed to serialize package.json: {error}"))?;
    fs::write(package_path, serialized)
        .map_err(|error| format!("Failed to write package.json: {error}"))
}

/// 旧版 main.tsx 模板（commit a0f72c3 之后、本次变更之前的版本）。
/// 含 DevShell 引用,需要被自动 patch 为新版。
const LEGACY_MAIN_TSX: &str = r#"import React from "react";
import ReactDOM from "react-dom/client";
import { DevShell } from "@localapp/app-kit/dev-shell";
import App from "./App.js";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <DevShell>
      <App />
    </DevShell>
  </React.StrictMode>,
);
"#;

/// 新版 main.tsx 模板:DevShell 由 vite-plugin 虚拟注入,main.tsx 只 render App。
const NEW_MAIN_TSX: &str = r#"import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
"#;

/// 检查并迁移用户项目的 src/main.tsx,移除旧版 DevShell 引用。
///
/// 行为:
/// 1. main.tsx 不存在 → 跳过,不报错
/// 2. main.tsx normalize 后等于 LEGACY_MAIN_TSX → 改写为 NEW_MAIN_TSX,打印迁移信息
/// 3. main.tsx 含 DevShell 关键字但与 LEGACY 不完全相等 → 打印警告,不改写
/// 4. main.tsx 不含 DevShell → 跳过
pub fn patch_legacy_main_tsx(project_dir: &Path, quiet: bool) -> Result<(), String> {
    let main_path = project_dir.join("src/main.tsx");
    if !main_path.exists() {
        return Ok(());
    }
    let content = match fs::read_to_string(&main_path) {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to read src/main.tsx: {e}")),
    };
    let normalized = content.replace("\r\n", "\n").trim().to_string();
    let legacy_normalized = LEGACY_MAIN_TSX.replace("\r\n", "\n").trim().to_string();

    if normalized == legacy_normalized {
        fs::write(&main_path, NEW_MAIN_TSX)
            .map_err(|e| format!("Failed to write src/main.tsx: {e}"))?;
        if !quiet {
            eprintln!("  \u{2713} main.tsx migrated: DevShell reference removed");
        }
        return Ok(());
    }

    if content.contains("DevShell") || content.contains("@localapp/app-kit/dev-shell") {
        if !quiet {
            eprintln!("  ! warning: main.tsx contains DevShell reference but is customized.");
            eprintln!("             Please manually update to: render(<App />)");
        }
    }
    Ok(())
}

#[derive(clap::Args)]
pub struct SyncCommand {
    /// 静默模式（postinstall 用）：不输出进度，错误不阻断
    #[arg(long)]
    quiet: bool,

    /// 交互模式：显示版本对比和变更清单，询问用户确认
    #[arg(long)]
    interactive: bool,

    /// 关闭自动同步（写入 project-config.json autoSync: false）
    #[arg(long)]
    off: bool,

    /// 开启自动同步（移除 autoSync 字段）
    #[arg(long)]
    on: bool,

    /// 强制刷新 CLI 领地，即使 runtime 版本一致或 autoSync 已关闭
    #[arg(long)]
    force: bool,
}

pub async fn run(cmd: SyncCommand) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;

    if cmd.off {
        return set_auto_sync(&cwd, false);
    }
    if cmd.on {
        return set_auto_sync(&cwd, true);
    }

    sync_at_force(&cwd, cmd.quiet, cmd.interactive, cmd.force, PromptStdin)
}

/// sync 核心逻辑。project_dir 是用户项目根；accepts quiet/interactive 模式参数。
/// 抽出此函数便于单测：测试可以传入临时目录、控制 prompt 行为。
pub fn sync_at(
    project_dir: &Path,
    quiet: bool,
    interactive: bool,
    prompt: impl Prompt,
) -> Result<(), String> {
    sync_at_force(project_dir, quiet, interactive, false, prompt)
}

pub fn sync_at_force(
    project_dir: &Path,
    quiet: bool,
    interactive: bool,
    force: bool,
    prompt: impl Prompt,
) -> Result<(), String> {
    validate_project_dir(project_dir)?;

    let project_config = project_config::load(project_dir)?;
    if project_config.ejected {
        return Err(
            "Project has been ejected. sync is permanently disabled for this project.".to_string(),
        );
    }

    let current_version = read_runtime_version(project_dir);
    let target_version = cli_version().to_string();
    let is_up_to_date = current_version.as_ref() == Some(&target_version);

    if quiet && !force && project_config.auto_sync == Some(false) {
        println!(r#"{{"success": true, "skipped": "autoSync disabled"}}"#);
        return Ok(());
    }

    if quiet && !force && is_up_to_date {
        println!(r#"{{"success": true, "message": "Already up to date"}}"#);
        return Ok(());
    }

    if interactive {
        let prev = current_version
            .clone()
            .unwrap_or_else(|| "none".to_string());
        eprintln!("Current: {} → Target: {}", prev, target_version);
        eprintln!("This will overwrite .localapp/runtime/ and .claude/skills/localapp*/");
        if !prompt.confirm()? {
            println!(r#"{{"success": false, "cancelled": true}}"#);
            return Ok(());
        }
    }

    refresh_cli_owned_files(project_dir, quiet)?;

    let result = if force {
        serde_json::json!({
            "success": true,
            "version": target_version,
            "message": "Runtime refreshed",
            "force": true,
        })
    } else if is_up_to_date {
        serde_json::json!({
            "success": true,
            "version": target_version,
            "message": "Already up to date",
        })
    } else {
        serde_json::json!({
            "success": true,
            "version": target_version,
            "previousVersion": current_version.unwrap_or_else(|| "none".to_string()),
        })
    };
    println!("{}", serde_json::to_string(&result).unwrap());

    if !quiet {
        eprintln!("  \u{2713} Run 'npm install' to refresh SDK symlinks");
    }
    Ok(())
}

/// `localapp dev` 在启动前刷新 CLI 拥有的 runtime 与技能。
///
/// 发布版通常通过 CLI 版本号触发同步，但开发构建可能在版本号不变时更新内嵌模板，
/// 因此 dev 必须按实际内嵌内容刷新。显式关闭 autoSync 或 eject 的项目仍保留其选择。
pub fn refresh_for_dev(project_dir: &Path) -> Result<(), String> {
    validate_project_dir(project_dir)?;
    let project_config = project_config::load(project_dir)?;
    if project_config.ejected || project_config.auto_sync == Some(false) {
        return Ok(());
    }
    refresh_cli_owned_files(project_dir, true)
}

fn refresh_cli_owned_files(project_dir: &Path, quiet: bool) -> Result<(), String> {
    let custom_dev_script = read_custom_dev_script(project_dir);

    if !quiet {
        eprintln!("  \u{2713} Removing CLI zones...");
    }
    remove_cli_zones(project_dir)?;

    if !quiet {
        eprintln!("  \u{2713} Extracting runtime...");
        eprintln!("  \u{2713} Extracting skills...");
    }
    extract_cli_zone(project_dir)?;
    extract_backend_seed_if_missing(project_dir)?;
    write_runtime_version(project_dir)?;
    postprocess_package_json(project_dir)?;
    restore_custom_dev_script(project_dir, custom_dev_script)?;
    patch_legacy_main_tsx(project_dir, quiet)
}

pub trait Prompt {
    fn confirm(&self) -> Result<bool, String>;
}

struct PromptStdin;
impl Prompt for PromptStdin {
    fn confirm(&self) -> Result<bool, String> {
        use std::io::Write;
        print!("Proceed? (y/n): ");
        std::io::stdout()
            .flush()
            .map_err(|e| format!("flush error: {e}"))?;
        let mut input = String::new();
        std::io::stdin()
            .read_line(&mut input)
            .map_err(|e| format!("read error: {e}"))?;
        Ok(input.trim().eq_ignore_ascii_case("y") || input.trim().eq_ignore_ascii_case("yes"))
    }
}

fn validate_project_dir(project_dir: &Path) -> Result<(), String> {
    let dev_config = project_dir.join(".localapp/dev-config.json");
    if !dev_config.exists() {
        return Err("Not a localapp project. Run 'localapp init' first.".to_string());
    }
    Ok(())
}

fn read_runtime_version(project_dir: &Path) -> Option<String> {
    let path = project_dir.join(".localapp/runtime/version.json");
    let content = fs::read_to_string(&path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    parsed
        .get("cliVersion")
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn remove_cli_zones(project_dir: &Path) -> Result<(), String> {
    remove_runtime_compatibility_path(project_dir)?;
    let runtime = project_dir.join(".localapp/runtime");
    if runtime.exists() {
        fs::remove_dir_all(&runtime).map_err(|e| format!("Failed to remove runtime: {e}"))?;
    }

    let skills = project_dir.join(".claude/skills");
    if skills.exists() {
        for entry in fs::read_dir(&skills).map_err(|e| format!("Failed to read skills: {e}"))? {
            let entry = entry.map_err(|e| format!("Failed to read skill entry: {e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "agent-tool-patterns" || name.starts_with("localapp") {
                let path = entry.path();
                let meta =
                    fs::metadata(&path).map_err(|e| format!("Failed to stat skill {name}: {e}"))?;
                let removal = if meta.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
                removal.map_err(|e| format!("Failed to remove skill {name}: {e}"))?;
            }
        }
    }
    Ok(())
}

pub fn set_auto_sync(project_dir: &Path, enabled: bool) -> Result<(), String> {
    validate_project_dir(project_dir)?;
    project_config::set_auto_sync(project_dir, enabled)?;
    println!(r#"{{"success": true, "autoSync": {}}}"#, enabled);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// 创建一个临时 localapp 项目（含 dev-config.json、runtime、skills）。
    fn make_fake_project() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("test-app");
        fs::create_dir_all(project.join(".localapp")).unwrap();
        fs::write(
            project.join(".localapp/dev-config.json"),
            r#"{"serverUrl": "http://localhost:3000"}"#,
        )
        .unwrap();

        fs::create_dir_all(project.join(".localapp/runtime")).unwrap();
        fs::write(
            project.join(".localapp/runtime/version.json"),
            r#"{"cliVersion": "0.0.1-fake"}"#,
        )
        .unwrap();
        fs::write(project.join(".localapp/runtime/dev-shell.tsx"), "// old").unwrap();

        fs::create_dir_all(project.join(".claude/skills/localapp")).unwrap();
        fs::write(
            project.join(".claude/skills/localapp/SKILL.md"),
            "old content",
        )
        .unwrap();
        fs::create_dir_all(project.join(".claude/skills/my-custom")).unwrap();
        fs::write(
            project.join(".claude/skills/my-custom/SKILL.md"),
            "user skill",
        )
        .unwrap();

        // 用户代码
        fs::write(project.join("manifest.json"), r#"{"name": "test-app"}"#).unwrap();
        fs::write(
            project.join("package.json"),
            r#"{"name": "test-app", "dependencies": {"@localapp/app-kit": "file:./.localapp/runtime"}}"#,
        )
        .unwrap();
        fs::create_dir_all(project.join("src")).unwrap();
        fs::write(project.join("src/App.tsx"), "// user app").unwrap();
        fs::create_dir_all(project.join("tests")).unwrap();
        fs::write(project.join("tests/x.test.ts"), "// user test").unwrap();

        // 把 tmp "所有权" 转交测试，返回 tempdir 而非 project 路径
        // 测试通过 tmp.path().join("test-app") 访问
        tmp
    }

    fn project_path(tmp: &tempfile::TempDir) -> PathBuf {
        tmp.path().join("test-app")
    }

    struct PromptYes;
    impl Prompt for PromptYes {
        fn confirm(&self) -> Result<bool, String> {
            Ok(true)
        }
    }

    struct PromptNo;
    impl Prompt for PromptNo {
        fn confirm(&self) -> Result<bool, String> {
            Ok(false)
        }
    }

    #[test]
    fn dev_refresh_replaces_cli_owned_runtime_even_when_version_marker_matches() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);
        fs::write(
            project.join(".localapp/runtime/version.json"),
            format!(r#"{{"cliVersion":"{}"}}"#, cli_version()),
        )
        .unwrap();
        fs::write(
            project.join(".localapp/runtime/vite-plugin.mjs"),
            "// stale runtime from an earlier build",
        )
        .unwrap();
        fs::write(
            project.join(".localapp/runtime/removed-file.mjs"),
            "// stale CLI-owned file",
        )
        .unwrap();

        refresh_for_dev(&project).unwrap();

        let expected = crate::template::BUILTIN_TEMPLATE
            .get_file("runtime/vite-plugin.mjs")
            .unwrap()
            .contents();
        assert_eq!(
            fs::read(project.join(".localapp/runtime/vite-plugin.mjs")).unwrap(),
            expected,
        );
        assert!(!project.join(".localapp/runtime/removed-file.mjs").exists());
        assert!(project.join(".claude/skills/my-custom/SKILL.md").is_file());
    }

    #[test]
    fn sync_is_idempotent() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        sync_at(&project, true, false, PromptYes).unwrap();
        let after_first =
            fs::read_to_string(project.join(".localapp/runtime/dev-shell.tsx")).unwrap();

        sync_at(&project, true, false, PromptYes).unwrap();
        let after_second =
            fs::read_to_string(project.join(".localapp/runtime/dev-shell.tsx")).unwrap();

        assert_eq!(after_first, after_second, "sync should be idempotent");
    }

    #[test]
    fn sync_does_not_touch_user_files() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        let manifest_before = fs::metadata(project.join("manifest.json"))
            .unwrap()
            .modified()
            .unwrap();
        let app_before = fs::metadata(project.join("src/App.tsx"))
            .unwrap()
            .modified()
            .unwrap();
        let test_before = fs::metadata(project.join("tests/x.test.ts"))
            .unwrap()
            .modified()
            .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(20));
        sync_at(&project, true, false, PromptYes).unwrap();

        let manifest_after = fs::metadata(project.join("manifest.json"))
            .unwrap()
            .modified()
            .unwrap();
        let app_after = fs::metadata(project.join("src/App.tsx"))
            .unwrap()
            .modified()
            .unwrap();
        let test_after = fs::metadata(project.join("tests/x.test.ts"))
            .unwrap()
            .modified()
            .unwrap();

        assert_eq!(
            manifest_before, manifest_after,
            "manifest.json mtime must not change"
        );
        assert_eq!(app_before, app_after, "src/App.tsx mtime must not change");
        assert_eq!(
            test_before, test_after,
            "tests/x.test.ts mtime must not change"
        );
    }

    #[test]
    fn sync_preserves_a_custom_local_dev_entrypoint() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);
        fs::write(
            project.join("package.json"),
            r#"{"name":"test-app","scripts":{"dev":"node scripts/dev.mjs","dev:vite":"vite --host 127.0.0.1"},"dependencies":{"@localapp/app-kit":"file:./.localapp/runtime"}}"#,
        )
        .unwrap();

        sync_at(&project, true, false, PromptYes).unwrap();

        let package: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(project.join("package.json")).unwrap())
                .unwrap();
        assert_eq!(package["scripts"]["dev"], "node scripts/dev.mjs");
        assert_eq!(package["scripts"]["dev:vite"], "vite --host 127.0.0.1");
    }

    #[test]
    fn sync_adds_backend_seed_when_missing() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        sync_at(&project, true, false, PromptYes).unwrap();

        assert!(
            project
                .join("backend/resources/work_items/schema.json")
                .exists()
        );
        assert!(
            project
                .join("backend/resources/work_items/queries.json")
                .exists()
        );
        assert!(
            project
                .join("backend/resources/work_items/mutations.json")
                .exists()
        );
        assert!(
            project
                .join("backend/schemas/resource-schema.schema.json")
                .exists()
        );
        assert!(project.join("backend/schemas/queries.schema.json").exists());
        assert!(
            project
                .join("backend/schemas/mutations.schema.json")
                .exists()
        );
    }

    #[test]
    fn sync_does_not_overwrite_existing_backend() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);
        fs::create_dir_all(project.join("backend/resources/custom")).unwrap();
        fs::write(
            project.join("backend/resources/custom/schema.json"),
            "custom",
        )
        .unwrap();

        sync_at(&project, true, false, PromptYes).unwrap();

        assert_eq!(
            fs::read_to_string(project.join("backend/resources/custom/schema.json")).unwrap(),
            "custom"
        );
        assert!(
            !project
                .join("backend/resources/work_items/schema.json")
                .exists()
        );
    }

    #[test]
    fn sync_preserves_user_custom_skill() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        sync_at(&project, true, false, PromptYes).unwrap();

        let user_skill = project.join(".claude/skills/my-custom/SKILL.md");
        assert!(user_skill.exists(), "user's custom skill must be preserved");
        assert_eq!(fs::read_to_string(&user_skill).unwrap(), "user skill");
    }

    #[test]
    fn sync_rejects_non_project_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let empty_dir = tmp.path();

        let result = sync_at(empty_dir, true, false, PromptYes);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Not a localapp project"), "got: {err}");
    }

    #[test]
    fn sync_rejects_ejected_project() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);
        fs::write(
            project.join(".localapp/dev-config.json"),
            r#"{"ejected": true}"#,
        )
        .unwrap();

        let result = sync_at(&project, true, false, PromptYes);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("ejected"), "got: {err}");
        assert!(
            !err.starts_with("{\"error\""),
            "error should be plain string, not JSON-encoded"
        );
        let project_config =
            fs::read_to_string(project.join(".localapp/project-config.json")).unwrap();
        assert!(project_config.contains("\"ejected\": true"));
        let dev_config = fs::read_to_string(project.join(".localapp/dev-config.json")).unwrap();
        assert!(!dev_config.contains("ejected"));
    }

    #[test]
    fn sync_quiet_when_up_to_date_returns_already_message() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        // 先做一次完整 sync 让版本对齐
        sync_at(&project, true, false, PromptYes).unwrap();

        // 再次 sync --quiet，版本一致
        // 这里我们无法捕获 stdout（println），但可以验证它返回 Ok
        // 真实验证由 e2e 测试覆盖
        let result = sync_at(&project, true, false, PromptYes);
        assert!(result.is_ok());
    }

    #[test]
    fn sync_updates_version_after_old_marker() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        // version.json 是 "0.0.1-fake"，当前 CLI 版本不同
        sync_at(&project, true, false, PromptYes).unwrap();

        let after = fs::read_to_string(project.join(".localapp/runtime/version.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&after).unwrap();
        assert_eq!(
            parsed["cliVersion"].as_str(),
            Some(cli_version()),
            "version.json should be updated to current CLI version"
        );
    }

    #[test]
    fn sync_interactive_yes_proceeds() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        let result = sync_at(&project, true, true, PromptYes);
        assert!(result.is_ok());
        // version.json 应被更新
        let v = fs::read_to_string(project.join(".localapp/runtime/version.json")).unwrap();
        assert!(v.contains(cli_version()));
    }

    #[test]
    fn sync_interactive_no_cancels() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        let original = fs::read_to_string(project.join(".localapp/runtime/dev-shell.tsx")).unwrap();

        let result = sync_at(&project, true, true, PromptNo);
        assert!(result.is_ok());

        let after = fs::read_to_string(project.join(".localapp/runtime/dev-shell.tsx")).unwrap();
        assert_eq!(
            original, after,
            "sync should not modify files when user declines"
        );
    }

    #[test]
    fn sync_off_survives_canonical_dev_config_replacement() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        set_auto_sync(&project, false).unwrap();

        let config = fs::read_to_string(project.join(".localapp/project-config.json")).unwrap();
        assert!(config.contains("\"autoSync\": false"));
        let dev_config = project.join(".localapp/dev-config.json");
        fs::write(
            &dev_config,
            r#"{"serverUrl":"http://127.0.0.1:43123","userId":"dev-user","pageName":"test-app","apiKey":"secret","appServerPort":5173}"#,
        )
        .unwrap();
        fs::write(
            project.join(".localapp/runtime/dev-shell.tsx"),
            "// user kept runtime",
        )
        .unwrap();

        refresh_for_dev(&project).unwrap();
        assert_eq!(
            fs::read_to_string(project.join(".localapp/runtime/dev-shell.tsx")).unwrap(),
            "// user kept runtime",
        );
        let dev_config = fs::read_to_string(dev_config).unwrap();
        assert!(!dev_config.contains("autoSync"));

        // 后续 sync --quiet 应该跳过
        let result = sync_at(&project, true, false, PromptYes);
        assert!(result.is_ok());
    }

    #[test]
    fn sync_force_refreshes_runtime_even_when_auto_sync_is_off_and_version_matches() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        sync_at(&project, true, false, PromptYes).unwrap();
        set_auto_sync(&project, false).unwrap();
        fs::write(
            project.join(".localapp/runtime/dev-shell.tsx"),
            "// patched by app",
        )
        .unwrap();
        let dev_db = b"local issue database";
        fs::write(project.join(".localapp/user-owned.db"), dev_db).unwrap();
        let attachment = project.join(".localapp/issues/attachments/attachment-1");
        fs::create_dir_all(attachment.parent().unwrap()).unwrap();
        fs::write(&attachment, b"local issue attachment").unwrap();

        sync_at_force(&project, true, false, true, PromptYes).unwrap();

        let runtime = fs::read_to_string(project.join(".localapp/runtime/dev-shell.tsx")).unwrap();
        assert!(
            !runtime.contains("patched by app"),
            "sync --force should restore CLI-managed runtime files"
        );
        assert!(
            project
                .join(".localapp/runtime/server-core/dist/index.js")
                .exists(),
            "sync --force should restore the embedded server-core artifact"
        );
        assert_eq!(
            fs::read(project.join(".localapp/user-owned.db")).unwrap(),
            dev_db,
            "sync --force must preserve user-owned files outside CLI runtime zones"
        );
        assert_eq!(
            fs::read(attachment).unwrap(),
            b"local issue attachment",
            "sync --force must preserve local Issue attachments"
        );
    }

    #[test]
    fn sync_on_removes_auto_sync_field() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        // 先 --off
        set_auto_sync(&project, false).unwrap();
        // 再 --on
        set_auto_sync(&project, true).unwrap();

        let config = fs::read_to_string(project.join(".localapp/project-config.json")).unwrap();
        assert!(!config.contains("autoSync"), "autoSync should be removed");
    }

    #[test]
    fn patch_main_tsx_migrates_legacy_template() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        fs::create_dir_all(project.join("src")).unwrap();
        // 写入旧版 main.tsx
        let legacy = "import React from \"react\";\nimport ReactDOM from \"react-dom/client\";\nimport { DevShell } from \"@localapp/app-kit/dev-shell\";\nimport App from \"./App.js\";\nimport \"./index.css\";\n\nconst root = ReactDOM.createRoot(document.getElementById(\"root\")!);\nroot.render(\n  <React.StrictMode>\n    <DevShell>\n      <App />\n    </DevShell>\n  </React.StrictMode>,\n);\n";
        fs::write(project.join("src/main.tsx"), legacy).unwrap();

        patch_legacy_main_tsx(project, true).unwrap();

        let after = fs::read_to_string(project.join("src/main.tsx")).unwrap();
        assert!(!after.contains("DevShell"), "DevShell should be removed");
        assert!(after.contains("<App />"), "App should be rendered");
        assert!(after.contains("import App"), "App import should be present");
    }

    #[test]
    fn patch_main_tsx_warns_on_customized_with_devshell() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        fs::create_dir_all(project.join("src")).unwrap();
        // 自定义 main.tsx,含 DevShell 但与旧模板不完全相同
        let custom = "import React from \"react\";\nimport { DevShell } from \"@localapp/app-kit/dev-shell\";\nimport App from \"./App.js\";\n\n// 用户自定义注释\nrender(<DevShell><App /></DevShell>);\n";
        fs::write(project.join("src/main.tsx"), custom).unwrap();

        // 应该不报错(返回 Ok)
        patch_legacy_main_tsx(project, false).unwrap();

        // 文件未被改写
        let after = fs::read_to_string(project.join("src/main.tsx")).unwrap();
        assert_eq!(after, custom, "custom main.tsx should not be modified");
    }

    #[test]
    fn patch_main_tsx_skips_new_version() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        fs::create_dir_all(project.join("src")).unwrap();
        // 新版 main.tsx (无 DevShell)
        let fresh = "import React from \"react\";\nimport ReactDOM from \"react-dom/client\";\nimport App from \"./App.js\";\nimport \"./index.css\";\n\nReactDOM.createRoot(document.getElementById(\"root\")!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);\n";
        fs::write(project.join("src/main.tsx"), fresh).unwrap();

        patch_legacy_main_tsx(project, false).unwrap();

        let after = fs::read_to_string(project.join("src/main.tsx")).unwrap();
        assert_eq!(after, fresh, "new main.tsx should be unchanged");
    }

    #[test]
    fn patch_main_tsx_handles_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path();
        // 不创建 src/main.tsx

        // 应该不报错
        let result = patch_legacy_main_tsx(project, false);
        assert!(result.is_ok(), "missing main.tsx should not error");
    }

    #[test]
    fn sync_invokes_patch_main_tsx_for_legacy_project() {
        let tmp = make_fake_project();
        let project = project_path(&tmp);

        // 写入旧版 main.tsx
        let legacy = "import React from \"react\";\nimport ReactDOM from \"react-dom/client\";\nimport { DevShell } from \"@localapp/app-kit/dev-shell\";\nimport App from \"./App.js\";\nimport \"./index.css\";\n\nconst root = ReactDOM.createRoot(document.getElementById(\"root\")!);\nroot.render(\n  <React.StrictMode>\n    <DevShell>\n      <App />\n    </DevShell>\n  </React.StrictMode>,\n);\n";
        fs::write(project.join("src/main.tsx"), legacy).unwrap();

        sync_at(&project, true, false, PromptYes).unwrap();

        let after = fs::read_to_string(project.join("src/main.tsx")).unwrap();
        assert!(
            !after.contains("DevShell"),
            "sync should migrate legacy main.tsx"
        );
    }
}
