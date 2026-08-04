use crate::public_server_url;
use fs2::FileExt;
use localapp_core::Config;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub server_url: String,
    pub launch_at_login: bool,
    pub notifications_enabled: bool,
    pub npm_registry: Option<String>,
    pub http_proxy_configured: bool,
    pub https_proxy_configured: bool,
}

impl PublicSettings {
    pub fn from_config(config: &Config) -> Result<Self, String> {
        Ok(Self {
            server_url: public_server_url(config)?,
            launch_at_login: false,
            notifications_enabled: true,
            npm_registry: None,
            http_proxy_configured: false,
            https_proxy_configured: false,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub launch_at_login: Option<bool>,
    pub notifications_enabled: Option<bool>,
    pub npm_registry: Option<String>,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    #[serde(default)]
    pub clear_http_proxy: bool,
    #[serde(default)]
    pub clear_https_proxy: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredSettings {
    #[serde(default, rename = "installationId")]
    installation_id: String,
    #[serde(default)]
    launch_at_login: bool,
    #[serde(default = "default_notifications_enabled")]
    notifications_enabled: bool,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            installation_id: String::new(),
            launch_at_login: false,
            notifications_enabled: true,
        }
    }
}

impl StoredSettings {
    fn apply(&mut self, update: &SettingsUpdate) {
        if let Some(value) = update.launch_at_login {
            self.launch_at_login = value;
        }
        if let Some(value) = update.notifications_enabled {
            self.notifications_enabled = value;
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    stored: StoredSettings,
}

impl SettingsStore {
    pub fn load() -> Result<Self, String> {
        Self::from_path(settings_path())
    }

    fn from_path(path: PathBuf) -> Result<Self, String> {
        let mut stored = read_stored_settings(&path);
        let installation_id_is_valid = uuid::Uuid::parse_str(&stored.installation_id)
            .is_ok_and(|id| id.to_string() == stored.installation_id);
        if !installation_id_is_valid {
            stored.installation_id = uuid::Uuid::new_v4().to_string();
            let parent = path
                .parent()
                .ok_or_else(|| "Could not save desktop settings".to_string())?;
            fs::create_dir_all(parent)
                .map_err(|_| "Could not save desktop settings".to_string())?;
            write_stored_settings(&path, &stored)?;
        }
        Ok(Self { path, stored })
    }

    pub fn installation_id(&self) -> &str {
        &self.stored.installation_id
    }

    pub fn launch_at_login(&self) -> bool {
        self.stored.launch_at_login
    }

    pub fn notifications_enabled(&self) -> bool {
        self.stored.notifications_enabled
    }

    pub fn public(&self, config: Option<&Config>) -> Result<PublicSettings, String> {
        Ok(PublicSettings {
            server_url: config
                .map(public_server_url)
                .transpose()?
                .unwrap_or_default(),
            launch_at_login: self.stored.launch_at_login,
            notifications_enabled: self.stored.notifications_enabled,
            npm_registry: None,
            http_proxy_configured: false,
            https_proxy_configured: false,
        })
    }

    pub fn update(
        &mut self,
        config: Option<&Config>,
        update: SettingsUpdate,
    ) -> Result<PublicSettings, String> {
        if let Some(config) = config {
            public_server_url(config)?;
        }
        let next = self.persist_update(&update)?;
        self.stored = next;
        self.public(config)
    }

    fn persist_update(&self, update: &SettingsUpdate) -> Result<StoredSettings, String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "Could not save desktop settings".to_string())?;
        fs::create_dir_all(parent).map_err(|_| "Could not save desktop settings".to_string())?;
        let lock_path = parent.join(".desktop-settings.lock");
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(lock_path)
            .map_err(|_| "Could not save desktop settings".to_string())?;
        lock.lock_exclusive()
            .map_err(|_| "Could not save desktop settings".to_string())?;

        let mut next = read_stored_settings(&self.path);
        if !uuid::Uuid::parse_str(&next.installation_id)
            .is_ok_and(|id| id.to_string() == next.installation_id)
        {
            next.installation_id
                .clone_from(&self.stored.installation_id);
        }
        next.apply(update);
        write_stored_settings(&self.path, &next)?;
        Ok(next)
    }
}

fn read_stored_settings(path: &PathBuf) -> StoredSettings {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn write_stored_settings(path: &PathBuf, settings: &StoredSettings) -> Result<(), String> {
    write_stored_settings_with(path, settings, atomic_replace)
}

fn write_stored_settings_with<F>(
    path: &PathBuf,
    settings: &StoredSettings,
    replace: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> Result<(), String>,
{
    let parent = path
        .parent()
        .ok_or_else(|| "Could not save desktop settings".to_string())?;
    let temporary = parent.join(format!(
        ".desktop-settings.{}.{}.tmp",
        std::process::id(),
        TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "Could not save desktop settings".to_string())?;
        serde_json::to_writer_pretty(&mut file, settings)
            .map_err(|_| "Could not save desktop settings".to_string())?;
        file.write_all(b"\n")
            .map_err(|_| "Could not save desktop settings".to_string())?;
        file.sync_all()
            .map_err(|_| "Could not save desktop settings".to_string())?;
        replace(&temporary, path)
    })();

    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(not(target_os = "windows"))]
fn atomic_replace(temporary: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temporary, target).map_err(|_| "Could not save desktop settings".to_string())
}

#[cfg(target_os = "windows")]
fn atomic_replace(temporary: &Path, target: &Path) -> Result<(), String> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_WRITE_THROUGH, MoveFileExW, ReplaceFileW,
    };

    fn wide(path: &Path) -> Result<Vec<u16>, String> {
        let encoded: Vec<u16> = path.as_os_str().encode_wide().collect();
        if encoded.contains(&0) {
            return Err("Could not save desktop settings".to_string());
        }
        Ok(encoded.into_iter().chain(once(0)).collect())
    }

    let temporary = wide(temporary)?;
    let target_wide = wide(target)?;
    let replaced = unsafe {
        if target.exists() {
            ReplaceFileW(
                target_wide.as_ptr(),
                temporary.as_ptr(),
                null(),
                0,
                null(),
                null(),
            )
        } else {
            MoveFileExW(
                temporary.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        }
    };
    if replaced == 0 {
        Err("Could not save desktop settings".to_string())
    } else {
        Ok(())
    }
}

fn default_notifications_enabled() -> bool {
    true
}

fn settings_path() -> PathBuf {
    Config::config_path()
        .parent()
        .map(|parent| parent.join("desktop-settings.json"))
        .unwrap_or_else(|| PathBuf::from("desktop-settings.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn update(
        launch_at_login: Option<bool>,
        notifications_enabled: Option<bool>,
    ) -> SettingsUpdate {
        SettingsUpdate {
            launch_at_login,
            notifications_enabled,
            npm_registry: None,
            http_proxy: None,
            https_proxy: None,
            clear_http_proxy: false,
            clear_https_proxy: false,
        }
    }

    #[test]
    fn failed_persistence_does_not_change_memory() {
        let directory = tempfile::tempdir().unwrap();
        let blocker = directory.path().join("not-a-directory");
        fs::write(&blocker, "block settings directory").unwrap();
        let mut store = SettingsStore {
            path: blocker.join("desktop-settings.json"),
            stored: StoredSettings::default(),
        };

        assert!(store.update(None, update(Some(true), None)).is_err());
        assert!(!store.public(None).unwrap().launch_at_login);
    }

    #[test]
    fn reloads_persisted_settings_after_an_update() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("desktop-settings.json");
        let mut writer = SettingsStore::from_path(path.clone()).unwrap();

        writer
            .update(None, update(Some(true), Some(false)))
            .unwrap();

        let reloaded = SettingsStore::from_path(path).unwrap();
        assert!(reloaded.public(None).unwrap().launch_at_login);
        assert!(!reloaded.public(None).unwrap().notifications_enabled);
    }

    #[test]
    fn concurrent_writers_merge_the_latest_disk_state() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("desktop-settings.json");
        let barrier = Arc::new(Barrier::new(2));
        let first_path = path.clone();
        let first_barrier = Arc::clone(&barrier);
        let first = std::thread::spawn(move || {
            let mut store = SettingsStore::from_path(first_path).unwrap();
            first_barrier.wait();
            store.update(None, update(Some(true), None)).unwrap();
        });
        let second_path = path.clone();
        let second = std::thread::spawn(move || {
            let mut store = SettingsStore::from_path(second_path).unwrap();
            barrier.wait();
            store.update(None, update(None, Some(false))).unwrap();
        });

        first.join().unwrap();
        second.join().unwrap();

        let reloaded = SettingsStore::from_path(path).unwrap();
        assert!(reloaded.public(None).unwrap().launch_at_login);
        assert!(!reloaded.public(None).unwrap().notifications_enabled);
    }

    #[test]
    fn generates_and_persists_a_private_installation_id() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("desktop-settings.json");
        let first = SettingsStore::from_path(path.clone()).unwrap();
        let installation_id = first.installation_id().to_string();

        assert_eq!(
            uuid::Uuid::parse_str(&installation_id).unwrap().to_string(),
            installation_id
        );
        let disk: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(disk["installationId"], installation_id);

        let reloaded = SettingsStore::from_path(path).unwrap();
        assert_eq!(reloaded.installation_id(), installation_id);
        let public = serde_json::to_value(reloaded.public(None).unwrap()).unwrap();
        assert!(public.get("installationId").is_none());
    }

    #[test]
    fn replacement_failure_preserves_existing_settings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("desktop-settings.json");
        fs::write(&path, "old settings\n").unwrap();
        let settings = StoredSettings {
            installation_id: uuid::Uuid::new_v4().to_string(),
            launch_at_login: true,
            notifications_enabled: false,
        };

        let result = write_stored_settings_with(&path, &settings, |_, _| {
            Err("simulated replacement failure".to_string())
        });

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "old settings\n");
    }
}
