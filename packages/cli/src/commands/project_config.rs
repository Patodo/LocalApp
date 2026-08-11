use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const PROJECT_CONFIG: &str = ".localapp/project-config.json";
const DEV_CONFIG: &str = ".localapp/dev-config.json";

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ProjectConfig {
    pub(crate) auto_sync: Option<bool>,
    pub(crate) ejected: bool,
}

/// Load durable project policy and finish any interrupted migration from the
/// legacy dev-config fields. The durable file is published first, so a crash
/// between the two atomic writes can leave duplicate markers but cannot lose
/// the user's choice. A later load safely completes the cleanup.
pub(crate) fn load(project_dir: &Path) -> Result<ProjectConfig, String> {
    let project_path = project_dir.join(PROJECT_CONFIG);
    let dev_path = project_dir.join(DEV_CONFIG);
    let mut project = read_object(&project_path, "project-config.json")?.unwrap_or_default();
    let mut dev = read_object(&dev_path, "dev-config.json")?.unwrap_or_default();

    let project_auto_sync = optional_bool(&project, "autoSync", "project-config.json")?;
    let project_ejected = optional_bool(&project, "ejected", "project-config.json")?;
    let legacy_auto_sync = optional_bool(&dev, "autoSync", "dev-config.json")?;
    let legacy_ejected = optional_bool(&dev, "ejected", "dev-config.json")?;
    let has_legacy_markers = dev.contains_key("autoSync") || dev.contains_key("ejected");

    if has_legacy_markers {
        if project_auto_sync.is_none() {
            if let Some(value) = legacy_auto_sync {
                project.insert("autoSync".to_string(), Value::Bool(value));
            }
        }
        if project_ejected.unwrap_or(false) || legacy_ejected.unwrap_or(false) {
            project.insert("ejected".to_string(), Value::Bool(true));
        }

        // Commit durable state before removing legacy state. This ordering is
        // what makes an interrupted migration idempotent and lossless.
        atomic_write_object(&project_path, &project, "project-config.json")?;
        dev.remove("autoSync");
        dev.remove("ejected");
        atomic_write_object(&dev_path, &dev, "dev-config.json")?;
    }

    Ok(ProjectConfig {
        auto_sync: optional_bool(&project, "autoSync", "project-config.json")?,
        ejected: optional_bool(&project, "ejected", "project-config.json")?.unwrap_or(false),
    })
}

pub(crate) fn set_auto_sync(project_dir: &Path, enabled: bool) -> Result<(), String> {
    // Complete a legacy migration before applying the new choice.
    load(project_dir)?;
    let path = project_dir.join(PROJECT_CONFIG);
    let mut project = read_object(&path, "project-config.json")?.unwrap_or_default();
    if enabled {
        project.remove("autoSync");
    } else {
        project.insert("autoSync".to_string(), Value::Bool(false));
    }
    atomic_write_object(&path, &project, "project-config.json")
}

pub(crate) fn mark_ejected(project_dir: &Path) -> Result<(), String> {
    // `ejected` is monotonic. Loading first ORs any legacy true marker into the
    // durable file before this function reinforces it.
    load(project_dir)?;
    let path = project_dir.join(PROJECT_CONFIG);
    let mut project = read_object(&path, "project-config.json")?.unwrap_or_default();
    project.insert("ejected".to_string(), Value::Bool(true));
    atomic_write_object(&path, &project, "project-config.json")
}

fn read_object(path: &Path, label: &str) -> Result<Option<Map<String, Value>>, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to read {label}: {error}")),
    };
    let value: Value =
        serde_json::from_str(&content).map_err(|error| format!("Invalid {label}: {error}"))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("{label} must be an object"))
        .map(Some)
}

fn optional_bool(
    object: &Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<Option<bool>, String> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(format!("{label} field '{key}' must be a boolean")),
    }
}

fn atomic_write_object(
    path: &Path,
    object: &Map<String, Value>,
    label: &str,
) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(&Value::Object(object.clone()))
        .map_err(|error| format!("Failed to serialize {label}: {error}"))?;
    atomic_write(path, &content, label)
}

fn atomic_write(path: &Path, content: &[u8], label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Failed to resolve {label} directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {label} directory: {error}"))?;
    let temporary = temporary_path(parent, path.file_name(), label)?;
    let write_result = (|| -> Result<(), String> {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| format!("Failed to create temporary {label}: {error}"))?;
        file.write_all(content)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Failed to write temporary {label}: {error}"))?;
        drop(file);
        fs::rename(&temporary, path)
            .map_err(|error| format!("Failed to publish {label} atomically: {error}"))?;
        sync_directory(parent)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn temporary_path(
    parent: &Path,
    file_name: Option<&std::ffi::OsStr>,
    label: &str,
) -> Result<PathBuf, String> {
    let file_name = file_name
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid {label} file name"))?;
    let mut random = [0_u8; 8];
    getrandom::fill(&mut random)
        .map_err(|error| format!("Failed to obtain randomness for {label}: {error}"))?;
    let suffix = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        suffix
    )))
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Failed to flush project config directory: {error}"))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_preserves_unknown_fields_and_prefers_durable_auto_sync() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp.path().join(".localapp")).unwrap();
        fs::write(
            temp.path().join(PROJECT_CONFIG),
            r#"{"autoSync":false,"custom":"kept"}"#,
        )
        .unwrap();
        fs::write(
            temp.path().join(DEV_CONFIG),
            r#"{"serverUrl":"http://127.0.0.1:3000","autoSync":true,"ejected":true}"#,
        )
        .unwrap();

        let config = load(temp.path()).unwrap();

        assert_eq!(config.auto_sync, Some(false));
        assert!(config.ejected);
        let project: Value =
            serde_json::from_str(&fs::read_to_string(temp.path().join(PROJECT_CONFIG)).unwrap())
                .unwrap();
        assert_eq!(project["custom"], "kept");
        assert_eq!(project["autoSync"], false);
        assert_eq!(project["ejected"], true);
        let dev: Value =
            serde_json::from_str(&fs::read_to_string(temp.path().join(DEV_CONFIG)).unwrap())
                .unwrap();
        assert!(dev.get("autoSync").is_none());
        assert!(dev.get("ejected").is_none());
        assert_eq!(dev["serverUrl"], "http://127.0.0.1:3000");
    }
}
