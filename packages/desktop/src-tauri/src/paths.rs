use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const DATA_DIR_ENV: &str = "LOCALAPP_DESKTOP_DATA_DIR";
/// 覆盖 Studio 源码项目根目录（测试用）。
const PROJECTS_DIR_ENV: &str = "LOCALAPP_STUDIO_PROJECTS_DIR";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopPaths {
    root: PathBuf,
    /// Studio 源码项目根：默认在用户可见的 Documents 下，
    /// 让用户和 coding agent 能自然访问（不像 app data 目录会被 agent 当外部目录拦截）。
    /// 用 LOCALAPP_STUDIO_PROJECTS_DIR 环境变量覆盖（测试用）。
    projects_root: PathBuf,
}

impl DesktopPaths {
    pub fn discover() -> Result<Self, String> {
        let root = match env::var_os(DATA_DIR_ENV) {
            Some(path) if !path.is_empty() => PathBuf::from(path),
            _ => {
                let base = dirs::data_local_dir()
                    .ok_or_else(|| "Could not locate the desktop data directory".to_string())?;
                default_data_root(base, cfg!(windows))
            }
        };
        let projects_root = match env::var_os(PROJECTS_DIR_ENV) {
            Some(path) if !path.is_empty() => PathBuf::from(path),
            _ => default_projects_root(),
        };
        Ok(Self { root, projects_root })
    }

    pub fn from_root(root: PathBuf) -> Self {
        // from_root 主要给测试用：projects_root 跟随 root（不走 Documents），
        // 保证测试隔离。可用 PROJECTS_DIR_ENV 覆盖。
        let projects_root = match env::var_os(PROJECTS_DIR_ENV) {
            Some(path) if !path.is_empty() => PathBuf::from(path),
            _ => root.join("studio"),
        };
        Self { root, projects_root }
    }

    pub fn ensure(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|_| {
            format!(
                "Could not create desktop data directory: {}",
                self.root.display()
            )
        })?;
        for path in [
            self.tasks(),
            self.js_environments(),
            self.apps(),
            self.app_data(),
            self.projects(),
        ] {
            fs::create_dir_all(&path).map_err(|_| {
                format!(
                    "Could not create desktop data directory: {}",
                    path.display()
                )
            })?;
        }
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn database(&self) -> PathBuf {
        self.root.join("desktop.sqlite3")
    }

    pub fn tasks(&self) -> PathBuf {
        self.root.join("tasks")
    }

    pub fn js_environments(&self) -> PathBuf {
        self.root.join("js-envs")
    }

    pub fn apps(&self) -> PathBuf {
        self.root.join("apps")
    }

    pub fn app_data(&self) -> PathBuf {
        self.root.join("app-data")
    }

    pub fn local_app_registry(&self) -> PathBuf {
        self.root.join("local-apps.json")
    }

    pub fn local_runtime_registry(&self) -> PathBuf {
        self.root.join("local-runtime-registry.json")
    }

    /// Studio 源码项目根目录：每个应用源码位于 `projects/<app-id>/`。
    ///
    /// 默认在用户可见的 Documents/LocalApp/projects 下（不走 app data），
    /// 让用户和 coding agent 能自然访问。与 `apps/`（已安装版本产物）分离：
    /// 源码是 source of truth，构建产物是派生物。
    pub fn projects(&self) -> PathBuf {
        self.projects_root.join("projects")
    }

    /// Studio 项目注册表：记录 app_id → source_path 映射 + 元数据。
    pub fn studio_registry(&self) -> PathBuf {
        self.root.join("studio-projects.json")
    }

}

fn default_data_root(base: PathBuf, windows: bool) -> PathBuf {
    if windows {
        base.join("com.localapp.desktop")
    } else {
        base.join("LocalApp")
    }
}

/// Studio 源码项目默认根目录：用户可见的 Documents/LocalApp/。
///
/// 不放 app data（~/Library/Application Support/）的原因：
/// 1. 用户能在 Finder 里自然看到、编辑源码；
/// 2. coding agent（opencode/claude）把 app data 目录当作"外部目录"拦截，
///    导致 Read/Write 被拒绝；
/// 3. 源码是用户资产，不该藏在系统数据目录里。
fn default_projects_root() -> PathBuf {
    if let Some(docs) = dirs::document_dir() {
        return docs.join("LocalApp");
    }
    // 兜底：home/LocalApp
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LocalApp")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_data_root_has_no_legacy_fallback() {
        let base = PathBuf::from(r"C:\Users")
            .join("Example")
            .join("AppData")
            .join("Local");
        let root = default_data_root(base.clone(), true);
        assert_eq!(root, base.join("com.localapp.desktop"));
    }
}
