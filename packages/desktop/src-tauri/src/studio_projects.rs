//! Studio 源码项目管理。
//!
//! 管理本地应用源码项目（区别于 `local_apps.rs` 管理的已安装版本产物）。
//! 每个源码项目位于 `<DesktopPaths>/projects/<app-id>/`，包含完整的用户领地
//! （manifest.json + src/ + backend/）和 CLI 领地（.localapp/runtime/ + .claude/skills/）。
//!
//! 源码是 source of truth：构建产物（.localapp）和已安装版本都是派生物。
//! 删除已安装应用默认保留源码，需显式调用 `delete_source` 才会移除源码。

use crate::local_apps::{io_error, validate_local_app_id};
use crate::paths::DesktopPaths;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// 当前 Studio 注册表 schema 版本。
const STUDIO_REGISTRY_VERSION: u32 = 1;

/// 兜底 AGENTS.md（当项目无 CLAUDE.md 可复制时）。
/// 正常情况下 init-repo 模板带 CLAUDE.md，会被复制为 AGENTS.md，不会用到这份。
const DEFAULT_AGENTS_MD: &str = "# LocalApp App\n\n\
本应用运行在 LocalApp 平台（React + TypeScript + Vite + native shell）。\n\n\
开发约定见 `.claude/skills/` 下的 skill 文档：\n\
- `localapp` — 平台总览、manifest.json、开发/构建/验收闭环\n\
- `localapp-data` — schema CRUD、backend named SQL、SDK 数据 hooks\n\
- `localapp-ui` — shadcn/ui 组件用法\n\
- `localapp-auth` — 用户身份与权限\n\
- `localapp-transitions` — 业务状态机\n\
- `localapp-business` — 业务应用建模\n\
- `localapp-notify` — 通知\n\
- `localapp-upload` — 文件上传\n\
- `agent-tool-patterns` — agent 自定义工具编写规范\n\n\
实现需求时编辑 `src/`（前端）、`backend/`（named SQL 契约）、`migrations/`（建表）。\n\
不要自行运行 build/install/upload —— 用户会通过 Studio UI 执行这些动作。\n";

/// 一个 Studio 源码项目的元数据（持久化在 studio-projects.json）。
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioProjectRecord {
    pub app_id: String,
    pub name: String,
    pub source_path: PathBuf,
    pub created_at: i64,
    pub last_built_at: Option<i64>,
}

/// 暴露给前端的 Studio 项目视图（合并注册表元数据 + 磁盘存在性）。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioProject {
    pub app_id: String,
    pub name: String,
    pub source_path: PathBuf,
    pub created_at: i64,
    pub last_built_at: Option<i64>,
    /// 源码目录是否仍存在于磁盘（可能被外部删除）。
    pub present_on_disk: bool,
}

/// 创建项目的结果。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedStudioProject {
    pub app_id: String,
    pub source_path: PathBuf,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct Registry {
    #[serde(default = "default_registry_version")]
    schema_version: u32,
    #[serde(default)]
    projects: BTreeMap<String, StudioProjectRecord>,
}

fn default_registry_version() -> u32 {
    STUDIO_REGISTRY_VERSION
}

#[derive(Clone)]
pub struct StudioProjectRepository {
    paths: DesktopPaths,
}

impl StudioProjectRepository {
    pub fn new(paths: DesktopPaths) -> Self {
        Self { paths }
    }

    /// 创建一个新的 Studio 源码项目。
    ///
    /// 在 `projects/<app-id>/` 下抽取 init-repo 模板的用户领地 + CLI 领地，
    /// 并写入注册表。`app_id` 由调用方提供（需通过 validate_local_app_id），
    /// 若未提供则生成一个基于 name 的 app_id。
    pub fn create(&self, name: &str, app_id: Option<&str>) -> Result<CreatedStudioProject, String> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Project name must not be empty".into());
        }
        let app_id = match app_id {
            Some(id) => {
                validate_local_app_id(id)?;
                id.to_string()
            }
            None => derive_app_id(trimmed_name)?,
        };

        self.paths.ensure()?;
        let mut registry = self.load_registry()?;
        if registry.projects.contains_key(&app_id) {
            return Err(format!("Studio project already exists: {app_id}"));
        }

        let source_path = self.paths.projects().join(&app_id);
        if source_path.exists() {
            return Err(format!(
                "Project directory already exists on disk: {}",
                source_path.display()
            ));
        }

        // 抽取 init-repo 模板：先用户领地，再 CLI 领地，最后后处理 package.json
        fs::create_dir_all(&source_path)
            .map_err(|e| format!("Failed to create project dir: {e}"))?;
        localapp_template::extract_user_zone(&source_path)?;
        localapp_template::extract_cli_zone(&source_path)?;
        localapp_template::extract_backend_seed_if_missing(&source_path)?;
        localapp_template::write_runtime_version(&source_path, env!("CARGO_PKG_VERSION"))?;
        localapp_template::postprocess_package_json(&source_path)?;

        // 写入 manifest.json（init-repo 模板不含 manifest，参考 CLI write_project_files 生成默认值）。
        // manifest.name 是 Local Runtime 注册时使用的内部身份，必须与 app_id 一致；
        // 用户输入的显示名只保存在 Studio 注册表中。
        self.write_default_manifest(&source_path, &app_id)?;

        // 生成 AGENTS.md（opencode / Codex / ZCode 读这个；Claude Code 读 CLAUDE.md）。
        // 内容复用 init-repo 的 CLAUDE.md（通用 AI 助手开发指南，非 Claude 专有）。
        // 仅在 AGENTS.md 不存在时创建，避免覆盖用户后续修改。
        self.ensure_agents_md(&source_path)?;

        let now = now_millis();
        let record = StudioProjectRecord {
            app_id: app_id.clone(),
            name: trimmed_name.to_string(),
            source_path: source_path.clone(),
            created_at: now,
            last_built_at: None,
        };
        registry.projects.insert(app_id.clone(), record);
        self.save_registry(&registry)?;

        Ok(CreatedStudioProject {
            app_id,
            source_path,
        })
    }

    /// 列出所有 Studio 项目（合并注册表与磁盘存在性检查）。
    pub fn list(&self) -> Result<Vec<StudioProject>, String> {
        let registry = self.load_registry()?;
        Ok(registry
            .projects
            .into_values()
            .map(|record| StudioProject {
                present_on_disk: record.source_path.is_dir(),
                app_id: record.app_id,
                name: record.name,
                source_path: record.source_path,
                created_at: record.created_at,
                last_built_at: record.last_built_at,
            })
            .collect())
    }

    /// 查找单个项目。
    pub fn find(&self, app_id: &str) -> Result<Option<StudioProject>, String> {
        Ok(self.list()?.into_iter().find(|p| p.app_id == app_id))
    }

    /// 读取项目内的文件（沙箱限制：rel_path 必须解析到 source_path 内）。
    pub fn read_file(&self, app_id: &str, rel_path: &str) -> Result<Vec<u8>, String> {
        let project = self.require_project(app_id)?;
        let safe_path = resolve_safe_path(&project.source_path, rel_path)?;
        if !safe_path.is_file() {
            return Err(format!("File not found: {}", safe_path.display()));
        }
        fs::read(&safe_path).map_err(io_error)
    }

    /// 写入项目内的文件（沙箱限制同 read_file）。自动创建父目录。
    pub fn write_file(&self, app_id: &str, rel_path: &str, content: &[u8]) -> Result<(), String> {
        let project = self.require_project(app_id)?;
        let safe_path = resolve_safe_path(&project.source_path, rel_path)?;
        if let Some(parent) = safe_path.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        fs::write(&safe_path, content).map_err(io_error)
    }

    /// 列出项目内某目录的条目（沙箱限制同 read_file）。
    pub fn list_dir(&self, app_id: &str, rel_path: &str) -> Result<Vec<DirEntry>, String> {
        let project = self.require_project(app_id)?;
        let safe_path = resolve_safe_path(&project.source_path, rel_path)?;
        if !safe_path.is_dir() {
            return Err(format!("Not a directory: {}", safe_path.display()));
        }
        let mut entries = Vec::new();
        for entry in fs::read_dir(&safe_path).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let metadata = entry.metadata().map_err(io_error)?;
            entries.push(DirEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: if metadata.is_file() {
                    Some(metadata.len())
                } else {
                    None
                },
            });
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    /// 标记项目最后一次构建时间。
    pub fn mark_built(&self, app_id: &str) -> Result<(), String> {
        let mut registry = self.load_registry()?;
        let record = registry
            .projects
            .get_mut(app_id)
            .ok_or_else(|| format!("Studio project not found: {app_id}"))?;
        record.last_built_at = Some(now_millis());
        self.save_registry(&registry)
    }

    /// 删除项目源码（同时移除注册表条目）。不删除已安装的应用版本。
    pub fn delete(&self, app_id: &str) -> Result<(), String> {
        let mut registry = self.load_registry()?;
        let record = registry
            .projects
            .remove(app_id)
            .ok_or_else(|| format!("Studio project not found: {app_id}"))?;
        if record.source_path.exists() {
            fs::remove_dir_all(&record.source_path).map_err(io_error)?;
        }
        self.save_registry(&registry)
    }

    fn require_project(&self, app_id: &str) -> Result<StudioProjectRecord, String> {
        let registry = self.load_registry()?;
        registry
            .projects
            .get(app_id)
            .cloned()
            .ok_or_else(|| format!("Studio project not found: {app_id}"))
    }

    /// 确保 AGENTS.md 存在（opencode / Codex / ZCode 的项目级指引约定）。
    ///
    /// init-repo 模板只带 CLAUDE.md（Claude Code 约定）。opencode 等读 AGENTS.md。
    /// CLAUDE.md 的内容是通用的 AI 助手开发指南（平台契约、SDK 用法、构建流程），
    /// 不含 Claude 专有内容，直接复制为 AGENTS.md 即可。
    /// 若 AGENTS.md 已存在则不覆盖（尊重用户后续修改）。
    fn ensure_agents_md(&self, source_path: &Path) -> Result<(), String> {
        let agents_md = source_path.join("AGENTS.md");
        if agents_md.is_file() {
            return Ok(());
        }
        let claude_md = source_path.join("CLAUDE.md");
        if claude_md.is_file() {
            fs::copy(&claude_md, &agents_md)
                .map_err(|e| format!("Failed to copy CLAUDE.md → AGENTS.md: {e}"))?;
        }
        // 若 CLAUDE.md 也不存在（非标准模板），写一份最小 AGENTS.md 占位，
        // 至少告诉 agent 这里是 LocalApp 项目 + skills 位置。
        if !agents_md.is_file() {
            fs::write(&agents_md, DEFAULT_AGENTS_MD)
                .map_err(|e| format!("Failed to write AGENTS.md: {e}"))?;
        }
        Ok(())
    }

    /// 写入默认 manifest.json（若不存在）。
    ///
    /// 模板抽取后不含 manifest.json，参考 CLI `write_project_files` 的默认值生成。
    /// 字段含义见 init-repo/.claude/skills/localapp/SKILL.md。
    fn write_default_manifest(&self, source_path: &Path, name: &str) -> Result<(), String> {
        let manifest_path = source_path.join("manifest.json");
        if manifest_path.is_file() {
            return Ok(()); // 已存在则不覆盖
        }
        let manifest = serde_json::json!({
            "name": name,
            "description": "",
            "distDir": "dist",
            "db": {
                "mode": "crud",
                "sqlAccess": "authenticated"
            },
            "backend": {
                "root": "backend"
            },
            "requires": {
                "backend": "named-sql",
                "identity": ["currentUser", "pageOwner"],
                "primitives": []
            },
            "platformVersion": "^1.2"
        });
        let serialized = serde_json::to_string_pretty(&manifest).map_err(io_error)?;
        fs::write(&manifest_path, serialized).map_err(io_error)
    }

    fn load_registry(&self) -> Result<Registry, String> {
        let path = self.paths.studio_registry();
        if !path.exists() {
            return Ok(Registry::default());
        }
        let content = fs::read_to_string(&path).map_err(io_error)?;
        let registry: Registry =
            serde_json::from_str(&content).map_err(|e| format!("Invalid studio registry: {e}"))?;
        Ok(registry)
    }

    fn save_registry(&self, registry: &Registry) -> Result<(), String> {
        let path = self.paths.studio_registry();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        let serialized = serde_json::to_string_pretty(registry).map_err(io_error)?;
        // 原子写：先写临时文件再 rename
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serialized).map_err(io_error)?;
        fs::rename(&tmp, &path).map_err(io_error)
    }
}

/// 目录条目信息（给前端展示用）。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

/// 将 rel_path 解析到 base 目录内，拒绝路径穿越（`..`、绝对路径、符号链接逃逸）。
///
/// 返回 canonicalize 后的绝对路径。若 rel_path 为空则返回 base 本身。
fn resolve_safe_path(base: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let trimmed = rel_path.trim();
    if trimmed.is_empty() {
        return Ok(base.to_path_buf());
    }
    let candidate = base.join(trimmed);
    // 标准化路径（不要求文件存在）：用 components 重组，过滤 `.`
    let normalized = normalize_path(&candidate);
    // 必须仍在 base 之下（或等于 base）
    let base_normalized = normalize_path(base);
    if normalized == base_normalized {
        return Ok(normalized);
    }
    if !normalized.starts_with(&base_normalized) {
        return Err(format!(
            "Path escapes project directory: {}",
            trimmed
        ));
    }
    // 若文件存在，进一步用 canonicalize 校验符号链接不逃逸
    if normalized.exists() {
        let canonical = normalized.canonicalize().map_err(io_error)?;
        let base_canonical = base_normalized.canonicalize().map_err(io_error)?;
        if canonical != base_canonical && !canonical.starts_with(&base_canonical) {
            return Err(format!(
                "Path escapes project directory (symlink): {}",
                trimmed
            ));
        }
        return Ok(canonical);
    }
    Ok(normalized)
}

/// 标准化路径：去除 `.` 分量，折叠 `..`。
///
/// 与 canonicalize 不同，不要求路径存在，也不解析符号链接。
/// 若 `..` 逃逸到根之上，保留它（让调用方的 starts_with 检查拒绝）。
fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out: Vec<String> = Vec::new();
    let mut prefix: Option<PathBuf> = None;
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::RootDir => {
                prefix = Some(PathBuf::from("/"));
                out.clear();
            }
            Component::Prefix(p) => {
                prefix = Some(PathBuf::from(p.as_os_str()));
                out.clear();
            }
            Component::Normal(s) => {
                out.push(s.to_string_lossy().to_string());
            }
        }
    }
    let mut result = prefix.unwrap_or_else(|| PathBuf::from("."));
    for part in out {
        result.push(part);
    }
    result
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 从用户输入的 name 派生一个合法的 app_id。
///
/// 规则：转小写、非 [a-z0-9-] 字符替换为 `-`、折叠连续 `-`、
/// 去除首尾 `-`、不足 3 字符则加随机后缀、冲突时加随机后缀。
fn derive_app_id(name: &str) -> Result<String, String> {
    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() { c } else { '-' })
        .collect();
    let mut collapsed = String::new();
    let mut prev_dash = true; // 开头也视为 dash，避免前导 -
    for ch in base.chars() {
        if ch == '-' {
            if !prev_dash {
                collapsed.push('-');
                prev_dash = true;
            }
        } else {
            collapsed.push(ch);
            prev_dash = false;
        }
    }
    let trimmed = collapsed.trim_matches('-');
    let candidate = if trimmed.len() < 3 || trimmed.is_empty() {
        format!("app-{}", short_random_suffix())
    } else {
        trimmed.to_string()
    };
    validate_local_app_id(&candidate)?;
    Ok(candidate)
}

fn short_random_suffix() -> String {
    Uuid::new_v4()
        .to_string()
        .split('-')
        .next()
        .unwrap_or("app")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_repo(tmp: &tempfile::TempDir) -> StudioProjectRepository {
        let paths = DesktopPaths::from_root(tmp.path().to_path_buf());
        StudioProjectRepository::new(paths)
    }

    #[test]
    fn create_extracts_template_and_registers() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = setup_repo(&tmp);

        let created = repo.create("Leave Form", None).unwrap();
        assert_eq!(created.app_id, "leave-form");
        assert!(created.source_path.is_dir());
        // 用户领地文件
        assert!(created.source_path.join("package.json").is_file());
        assert!(created.source_path.join("manifest.json").is_file());
        assert!(created.source_path.join("src").is_dir());
        // CLI 领地文件
        assert!(created.source_path.join(".localapp/runtime").is_dir());
        assert!(created
            .source_path
            .join(".claude/skills/localapp/SKILL.md")
            .is_file());

        // AGENTS.md 由 CLAUDE.md 复制而来（opencode / Codex / ZCode 读这个）
        assert!(created.source_path.join("AGENTS.md").is_file());
        let agents_md =
            fs::read_to_string(created.source_path.join("AGENTS.md")).unwrap();
        let claude_md =
            fs::read_to_string(created.source_path.join("CLAUDE.md")).unwrap();
        assert_eq!(agents_md, claude_md, "AGENTS.md should mirror CLAUDE.md");

        // manifest.json 的 name 被更新
        let manifest =
            fs::read_to_string(created.source_path.join("manifest.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(parsed["name"].as_str(), Some(created.app_id.as_str()));

        // 注册表
        let list = repo.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Leave Form");
        assert!(list[0].present_on_disk);
    }

    #[test]
    fn create_with_explicit_app_id_validates() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = setup_repo(&tmp);

        let created = repo.create("Test", Some("my-app")).unwrap();
        assert_eq!(created.app_id, "my-app");

        // 非法 app_id 被拒
        let err = repo.create("Bad", Some("UPPER")).unwrap_err();
        assert!(err.contains("Invalid local application ID"));
    }

    #[test]
    fn create_rejects_duplicate() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = setup_repo(&tmp);

        repo.create("First", Some("dup-app")).unwrap();
        let err = repo.create("Second", Some("dup-app")).unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn read_write_file_respects_sandbox() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = setup_repo(&tmp);
        let created = repo.create("App", Some("sandbox-app")).unwrap();

        // 写入合法文件
        repo.write_file(&created.app_id, "src/new-file.ts", b"export const x = 1;")
            .unwrap();
        let read = repo
            .read_file(&created.app_id, "src/new-file.ts")
            .unwrap();
        assert_eq!(read, b"export const x = 1;");

        // 路径穿越被拒
        let err = repo
            .write_file(&created.app_id, "../escape.txt", b"evil")
            .unwrap_err();
        assert!(err.contains("escapes project directory"));

        let err = repo
            .read_file(&created.app_id, "../../etc/passwd")
            .unwrap_err();
        assert!(err.contains("escapes") || err.contains("not found"));
    }

    #[test]
    fn list_dir_returns_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = setup_repo(&tmp);
        let created = repo.create("App", Some("dir-app")).unwrap();

        let entries = repo.list_dir(&created.app_id, "src").unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"App.tsx"));
    }

    #[test]
    fn delete_removes_source_and_registry() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = setup_repo(&tmp);
        let created = repo.create("To Delete", Some("del-app")).unwrap();

        repo.delete(&created.app_id).unwrap();
        assert!(!created.source_path.exists());
        assert!(repo.list().unwrap().is_empty());
    }

    #[test]
    fn mark_built_updates_timestamp() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = setup_repo(&tmp);
        let created = repo.create("App", Some("build-app")).unwrap();

        assert!(repo.find(&created.app_id).unwrap().unwrap().last_built_at.is_none());
        repo.mark_built(&created.app_id).unwrap();
        assert!(repo.find(&created.app_id).unwrap().unwrap().last_built_at.is_some());
    }

    #[test]
    fn derive_app_id_handles_special_chars() {
        assert_eq!(derive_app_id("Leave Form").unwrap(), "leave-form");
        assert_eq!(derive_app_id("My App!@#").unwrap(), "my-app");
        // 中文等非 ASCII 被替换为 -，太短则加随机后缀
        let id = derive_app_id("测试").unwrap();
        assert!(id.len() >= 3);
        assert!(validate_local_app_id(&id).is_ok());
    }

    #[test]
    fn resolve_safe_path_rejects_absolute_and_traversal() {
        let base = Path::new("/tmp/fake-project");
        assert!(resolve_safe_path(base, "").is_ok());
        assert!(resolve_safe_path(base, "src/file.ts").is_ok());
        assert!(resolve_safe_path(base, "../escape").is_err());
        assert!(resolve_safe_path(base, "src/../../escape").is_err());
    }

    /// 端到端 smoke：创建真实项目到固定路径，供 opencode 手动验证。
    /// 用 `cargo test create_real_project_for_smoke -- --nocapture --ignored` 跑。
    #[test]
    #[ignore]
    fn create_real_project_for_smoke() {
        // 已存在,只查找不重建
        let root = "/Users/patodo/Documents/LocalApp";
        let paths = DesktopPaths::from_root(std::path::PathBuf::from(root));
        let repo = StudioProjectRepository::new(paths);
        let created = repo.find("interview-manager").unwrap().unwrap();
        let created = crate::studio_projects::CreatedStudioProject {
            app_id: created.app_id,
            source_path: created.source_path,
        };

        // 关键产物
        assert!(created.source_path.join("AGENTS.md").is_file());
        assert!(created.source_path.join("CLAUDE.md").is_file());
        assert!(created.source_path.join("manifest.json").is_file());
        assert!(created.source_path.join(".claude/skills/localapp/SKILL.md").is_file());

        eprintln!("SMOKE_PROJECT_DIR={}", created.source_path.display());
    }
}
