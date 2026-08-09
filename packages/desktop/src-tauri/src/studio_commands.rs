//! Studio 应用生命周期编排：构建、安装、发布、重载。
//!
//! 这些命令桥接 `studio_projects.rs`（源码管理）与 `localapp-core`（打包）+
//! `local_app_commands.rs`（已安装版本管理）+ `server_profiles.rs`（发布）。
//!
//! 典型闭环：create（studio_projects）→ build（本模块）→ install（复用 install_with_runtime）
//! → publish（复用 publish_app_version）。

use crate::AppState;
use crate::local_app_commands::install_with_runtime;
use crate::local_apps::InstallOutcome;
use crate::studio_projects::StudioProjectRepository;
use tauri::Emitter;
use localapp_core::{AppPackageMetadata, PublishResult, ResolvedTarget, build_app_package, publish_app_version, resolve_target, TargetSelector};
use serde::Deserialize;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

/// 构建结果。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOutcome {
    pub app_id: String,
    pub version: String,
    pub package_path: PathBuf,
    pub sha256: String,
    pub size: u64,
}

/// 从 package.json 读取 version 字段（Studio 项目用）。
#[derive(Deserialize)]
struct ProjectPackage {
    #[serde(default = "default_version")]
    version: String,
}

fn default_version() -> String {
    "0.0.0".to_string()
}

/// 从 manifest.json 读取构建所需的元数据（app_id 来自 manifest.name，platform_version 来自 manifest.platformVersion）。
#[derive(Deserialize)]
struct ManifestMeta {
    name: String,
    #[serde(default)]
    #[serde(rename = "platformVersion")]
    platform_version: Option<String>,
}

/// 创建一个新的 Studio 源码项目。
#[tauri::command]
pub(crate) fn create_studio_project(
    state: State<'_, AppState>,
    name: String,
    app_id: Option<String>,
) -> Result<crate::studio_projects::CreatedStudioProject, String> {
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    repo.create(&name, app_id.as_deref())
}

/// 列出所有 Studio 项目。
#[tauri::command]
pub(crate) fn list_studio_projects(
    state: State<'_, AppState>,
) -> Result<Vec<crate::studio_projects::StudioProject>, String> {
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    repo.list()
}

/// 读取 Studio 项目内的文件（沙箱限制在源码目录内）。
#[tauri::command]
pub(crate) fn read_studio_file(
    state: State<'_, AppState>,
    app_id: String,
    rel_path: String,
) -> Result<Vec<u8>, String> {
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    repo.read_file(&app_id, &rel_path)
}

/// 写入 Studio 项目内的文件。
#[tauri::command]
pub(crate) fn write_studio_file(
    state: State<'_, AppState>,
    app_id: String,
    rel_path: String,
    content: Vec<u8>,
) -> Result<(), String> {
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    repo.write_file(&app_id, &rel_path, &content)
}

/// 列出 Studio 项目内某目录的条目。
#[tauri::command]
pub(crate) fn list_studio_dir(
    state: State<'_, AppState>,
    app_id: String,
    rel_path: String,
) -> Result<Vec<crate::studio_projects::DirEntry>, String> {
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    repo.list_dir(&app_id, &rel_path)
}

/// 删除 Studio 源码项目（不删除已安装的应用版本）。
#[tauri::command]
pub(crate) fn delete_studio_project(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    repo.delete(&app_id)
}

/// 构建一个 Studio 项目，产出 `.localapp` 包。
///
/// 流程：`npm run build`（生成 dist/）→ 读 manifest.json/package.json 元数据
/// → 调 `localapp_core::build_app_package` 打包。
#[tauri::command]
pub(crate) async fn build_studio_project(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<BuildOutcome, String> {
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    let project = repo
        .find(&app_id)?
        .ok_or_else(|| format!("Studio project not found: {app_id}"))?;
    if !project.present_on_disk {
        return Err(format!(
            "Project source directory is missing on disk: {}",
            project.source_path.display()
        ));
    }
    let source_path = project.source_path.clone();

    // 1. npm install（若 node_modules 不存在）
    ensure_dependencies(&source_path).await?;

    // 2. npm run build（生成 dist/）
    run_npm_build(&source_path).await?;

    // 3. 读 manifest.json + package.json 提取 metadata
    let manifest = read_manifest_meta(&source_path)?;
    let version = read_project_version(&source_path)?;

    // 4. 打包
    let builds_dir = source_path.join(".localapp/builds");
    std::fs::create_dir_all(&builds_dir)
        .map_err(|e| format!("Failed to create builds dir: {e}"))?;
    let package_path = builds_dir.join(format!("{}-{}.localapp", &app_id, &version));

    let metadata = AppPackageMetadata {
        schema_version: 1,
        // app_id 用 Studio 项目的英文 slug(注册表里的),
        // 而非 manifest.name(可能是中文显示名,不符合 app_id 校验规则)。
        app_id: app_id.clone(),
        version: version.clone(),
        platform_version: manifest
            .platform_version
            .clone()
            .unwrap_or_else(|| "^1.0".to_string()),
    };

    let summary = build_app_package(&source_path, &package_path, metadata)
        .map_err(|e| e.to_string())?;

    // 5. 标记构建时间
    repo.mark_built(&app_id)?;

    Ok(BuildOutcome {
        app_id,
        version,
        package_path,
        sha256: summary.sha256,
        size: summary.size,
    })
}

/// 安装一个 Studio 项目（取最新构建产物安装到本地应用库）。
///
/// 先 build 再 install，复用 `install_with_runtime`（含 Local Runtime 健康检查）。
#[tauri::command]
pub(crate) async fn install_studio_project(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    app_id: String,
) -> Result<InstallOutcome, String> {
    let repo = StudioProjectRepository::new(state.local_store.paths().clone());
    let project = repo
        .find(&app_id)?
        .ok_or_else(|| format!("Studio project not found: {app_id}"))?;

    // 找最新的 .localapp 构建产物
    let builds_dir = project.source_path.join(".localapp/builds");
    let package_path = find_latest_package(&builds_dir)?;

    let controller = crate::local_runtime_controller(&state)?;
    let outcome = install_with_runtime(state.local_apps.clone(), Some(controller), package_path).await?;
    // 通知前端"应用"视图刷新本地应用列表
    let _ = app_handle.emit("desktop://local-apps-changed", ());
    Ok(outcome)
}

/// 发布一个 Studio 项目（已安装版本）到指定 server profile。
///
/// 必须先 install（生成 version_root），再 publish。复用 publish_app_version。
#[tauri::command]
pub(crate) async fn publish_studio_project(
    state: State<'_, AppState>,
    app_id: String,
    profile_name: String,
) -> Result<PublishResult, String> {
    // 找到已安装版本的 version_root
    let app = state
        .local_apps
        .list()?
        .into_iter()
        .find(|app| app.app_id == app_id)
        .ok_or_else(|| {
            format!(
                "Application must be installed before publishing. Run install for: {app_id}"
            )
        })?;

    let target = resolve_publish_target(&profile_name)?;
    publish_app_version(&app.version_root, &target).await
}

/// 重载 Studio 项目（build + install + 健康检查），返回 preview URL。
///
/// 适合 agent 改完代码后快速验证。不发布到远程。
#[tauri::command]
pub(crate) async fn reload_studio_project(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    app_id: String,
) -> Result<String, String> {
    // build
    build_studio_project(state.clone(), app_id.clone()).await?;

    // install（覆盖版本）
    install_studio_project(app_handle, state.clone(), app_id.clone()).await?;

    // 通过 open_local_app 的路径打开（触发 Local Runtime 健康检查 + 浏览器打开）
    crate::local_app_commands::open_local_app(state, app_id.clone()).await?;

    Ok(app_id)
}

/// 确保 Studio 项目的依赖已安装（若 node_modules 不存在则 npm install）。
async fn ensure_dependencies(source_path: &std::path::Path) -> Result<(), String> {
    if source_path.join("node_modules").is_dir() {
        return Ok(());
    }
    if !source_path.join("package.json").is_file() {
        return Err("package.json not found in project".into());
    }
    let npm = find_npm().await?;
    let mut cmd = tokio::process::Command::new(&npm);
    cmd.current_dir(source_path)
        .arg("install")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    configure_process_group(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn npm install: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "npm install failed (exit {:?}): {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// 运行 `npm run build` 生成 dist/。
async fn run_npm_build(source_path: &std::path::Path) -> Result<(), String> {
    let npm = find_npm().await?;
    let mut cmd = tokio::process::Command::new(&npm);
    cmd.current_dir(source_path)
        .arg("run")
        .arg("build")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    configure_process_group(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn npm run build: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "npm run build failed (exit {:?}): {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    // 校验 dist/index.html 已生成（build_app_package 会要求它）
    if !source_path.join("dist/index.html").is_file() {
        return Err(format!(
            "Build completed but dist/index.html is missing. stdout: {}",
            String::from_utf8_lossy(&output.stdout)
        ));
    }
    Ok(())
}

/// 探测 npm 可执行文件路径（npm / npm.cmd / npm.exe）。
async fn find_npm() -> Result<String, String> {
    // 简单探测：依赖 PATH 中的 npm。未来可用 which crate 增强。
    for candidate in ["npm", "npm.cmd"] {
        let mut cmd = tokio::process::Command::new(candidate);
        cmd.arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        if cmd.output().await.is_ok() {
            return Ok(candidate.to_string());
        }
    }
    Err("npm not found in PATH; please install Node.js".into())
}

fn read_manifest_meta(source_path: &std::path::Path) -> Result<ManifestMeta, String> {
    let path = source_path.join("manifest.json");
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read manifest.json: {e}"))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Invalid manifest.json: {e}"))
}

fn read_project_version(source_path: &std::path::Path) -> Result<String, String> {
    let path = source_path.join("package.json");
    if !path.exists() {
        return Ok(default_version());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read package.json: {e}"))?;
    let pkg: ProjectPackage =
        serde_json::from_str(&content).map_err(|e| format!("Invalid package.json: {e}"))?;
    if pkg.version.trim().is_empty() {
        Ok(default_version())
    } else {
        Ok(pkg.version)
    }
}

/// 在 builds_dir 下找最新的 .localapp 文件（按修改时间）。
fn find_latest_package(builds_dir: &std::path::Path) -> Result<PathBuf, String> {
    if !builds_dir.is_dir() {
        return Err(format!(
            "No builds found. Run build first. Expected: {}",
            builds_dir.display()
        ));
    }
    let mut latest: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
    for entry in std::fs::read_dir(builds_dir).map_err(|e| format!("read_dir failed: {e}"))? {
        let entry = entry.map_err(|e| format!("read_dir entry failed: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("localapp") {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        if latest.as_ref().is_none_or(|(_, t)| mtime > *t) {
            latest = Some((path, mtime));
        }
    }
    latest
        .map(|(path, _)| path)
        .ok_or_else(|| "No .localapp build artifact found. Run build first.".to_string())
}

fn resolve_publish_target(profile_name: &str) -> Result<ResolvedTarget, String> {
    if profile_name.trim().is_empty() {
        return Err("Select a Server profile before publishing".into());
    }
    resolve_target(TargetSelector {
        profile: Some(profile_name.to_string()),
        project_default_profile: None,
    })
}

/// 为子进程设置独立进程组（unix），便于整组信号清理。
#[cfg(unix)]
fn configure_process_group(command: &mut tokio::process::Command) {
    use std::os::unix::process::CommandExt;
    command.as_std_mut().process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut tokio::process::Command) {}
