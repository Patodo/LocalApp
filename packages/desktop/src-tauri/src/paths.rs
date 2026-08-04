use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const DATA_DIR_ENV: &str = "LOCALAPP_DESKTOP_DATA_DIR";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopPaths {
    root: PathBuf,
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
        Ok(Self { root })
    }

    pub fn from_root(root: PathBuf) -> Self {
        Self { root }
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

}

fn default_data_root(base: PathBuf, windows: bool) -> PathBuf {
    if windows {
        base.join("com.localapp.desktop")
    } else {
        base.join("LocalApp")
    }
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
