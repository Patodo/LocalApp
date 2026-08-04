use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Config {
    pub server_url: String,
    pub api_key: String,
}

impl Config {
    pub fn config_path() -> PathBuf {
        if let Ok(config_dir) = std::env::var("LOCALAPP_CONFIG_DIR") {
            return PathBuf::from(config_dir).join("config.json");
        }
        let home = dirs_home();
        home.join(".localapp").join("config.json")
    }

    pub fn load() -> Option<Config> {
        let env_url = std::env::var("LOCALAPP_SERVER_URL").ok();
        let env_key = std::env::var("LOCALAPP_API_KEY").ok();

        if let (Some(url), Some(key)) = (&env_url, &env_key) {
            return Some(Config {
                server_url: url.clone(),
                api_key: key.clone(),
            });
        }

        let path = Self::config_path();
        if !path.exists() {
            return None;
        }

        let content = fs::read_to_string(&path).ok()?;
        let mut cfg: Config = serde_json::from_str(&content).ok()?;

        if let Some(url) = env_url {
            cfg.server_url = url;
        }
        if let Some(key) = env_key {
            cfg.api_key = key;
        }

        Some(cfg)
    }

    pub fn save(&self) -> Result<(), String> {
        atomic_write_json(&Self::config_path(), self, "config")
    }

    pub fn base_url(&self) -> &str {
        self.server_url.trim_end_matches('/')
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerProfile {
    pub name: String,
    pub server_url: String,
    pub api_key: String,
}

impl fmt::Debug for ServerProfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ServerProfile")
            .field("name", &self.name)
            .field("server_url", &self.server_url)
            .field("api_key", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStore {
    pub schema_version: u32,
    pub active_profile: Option<String>,
    pub profiles: BTreeMap<String, ServerProfile>,
}

impl Default for ProfileStore {
    fn default() -> Self {
        Self {
            schema_version: 1,
            active_profile: None,
            profiles: BTreeMap::new(),
        }
    }
}

impl ProfileStore {
    pub fn profiles_path() -> PathBuf {
        Config::config_path().with_file_name("servers.json")
    }

    pub fn load() -> Result<Self, String> {
        let path = Self::profiles_path();
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = fs::read_to_string(path)
            .map_err(|error| format!("Failed to read profiles: {error}"))?;
        let store: Self = serde_json::from_str(&content)
            .map_err(|error| format!("Failed to parse profiles: {error}"))?;
        if store.schema_version != 1 {
            return Err(format!(
                "Unsupported server profile schema version {}",
                store.schema_version
            ));
        }
        for (name, profile) in &store.profiles {
            validate_profile_name(name)?;
            if profile.name != *name {
                return Err(format!("Server profile key does not match name: {name}"));
            }
            validate_server_url(&profile.server_url)?;
        }
        if let Some(active) = &store.active_profile
            && !store.profiles.contains_key(active)
        {
            return Err(format!("Active server profile does not exist: {active}"));
        }
        Ok(store)
    }

    pub fn upsert(&mut self, mut profile: ServerProfile) -> Result<(), String> {
        validate_profile_name(&profile.name)?;
        profile.server_url = normalize_server_url(&profile.server_url)?;
        if profile.api_key.trim().is_empty() {
            return Err("Server profile API key cannot be empty".into());
        }
        let mut candidate = self.clone();
        candidate.profiles.insert(profile.name.clone(), profile);
        candidate.save()?;
        *self = candidate;
        Ok(())
    }

    pub fn remove(&mut self, name: &str) -> Result<(), String> {
        validate_profile_name(name)?;
        let mut candidate = self.clone();
        if candidate.profiles.remove(name).is_none() {
            return Err(format!("Server profile not found: {name}"));
        }
        if candidate.active_profile.as_deref() == Some(name) {
            candidate.active_profile = None;
            save_profile_and_legacy(&candidate, LegacyUpdate::Remove)?;
        } else {
            candidate.save()?;
        }
        *self = candidate;
        Ok(())
    }

    pub fn use_profile(&mut self, name: &str) -> Result<(), String> {
        validate_profile_name(name)?;
        let profile = self
            .profiles
            .get(name)
            .cloned()
            .ok_or_else(|| format!("Server profile not found: {name}"))?;
        let mut candidate = self.clone();
        candidate.active_profile = Some(name.to_string());
        let legacy = Config {
            server_url: profile.server_url,
            api_key: profile.api_key,
        };
        save_profile_and_legacy(&candidate, LegacyUpdate::Set(&legacy))?;
        *self = candidate;
        Ok(())
    }

    pub fn save(&self) -> Result<(), String> {
        atomic_write_json(&Self::profiles_path(), self, "profiles")
    }
}

enum LegacyUpdate<'a> {
    Set(&'a Config),
    Remove,
}

fn save_profile_and_legacy(store: &ProfileStore, legacy: LegacyUpdate<'_>) -> Result<(), String> {
    let profiles_path = ProfileStore::profiles_path();
    let config_path = Config::config_path();
    let snapshot = ConfigPairSnapshot::capture(&profiles_path, &config_path)?;
    let result = (|| {
        atomic_write_json(&profiles_path, store, "profiles")?;
        match legacy {
            LegacyUpdate::Set(config) => atomic_write_json(&config_path, config, "config"),
            LegacyUpdate::Remove => remove_config_file(&config_path),
        }
    })();
    match result {
        Ok(()) => Ok(()),
        Err(error) => match snapshot.restore() {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error}; config rollback failed: {rollback}")),
        },
    }
}

struct ConfigPairSnapshot {
    profiles: ConfigPathSnapshot,
    legacy: ConfigPathSnapshot,
}

impl ConfigPairSnapshot {
    fn capture(profiles: &Path, legacy: &Path) -> Result<Self, String> {
        Ok(Self {
            profiles: ConfigPathSnapshot::capture(profiles)?,
            legacy: ConfigPathSnapshot::capture(legacy)?,
        })
    }

    fn restore(&self) -> Result<(), String> {
        let mut failures = Vec::new();
        if let Err(error) = self.profiles.restore() {
            failures.push(format!("profiles: {error}"));
        }
        if let Err(error) = self.legacy.restore() {
            failures.push(format!("config: {error}"));
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    }
}

enum ConfigPathSnapshot {
    Missing(PathBuf),
    File { path: PathBuf, bytes: Vec<u8> },
    Directory(PathBuf),
}

impl ConfigPathSnapshot {
    fn capture(path: &Path) -> Result<Self, String> {
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
                "Refusing to update symlinked config path: {}",
                path.display()
            )),
            Ok(metadata) if metadata.is_file() => Ok(Self::File {
                path: path.to_path_buf(),
                bytes: fs::read(path)
                    .map_err(|error| format!("Failed to snapshot config: {error}"))?,
            }),
            Ok(metadata) if metadata.is_dir() => Ok(Self::Directory(path.to_path_buf())),
            Ok(_) => Err(format!("Unsupported config path: {}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(Self::Missing(path.to_path_buf()))
            }
            Err(error) => Err(format!("Failed to inspect config path: {error}")),
        }
    }

    fn restore(&self) -> Result<(), String> {
        match self {
            Self::Missing(path) => remove_config_path(path),
            Self::File { path, bytes } => atomic_write_bytes(path, bytes, "config rollback"),
            Self::Directory(path) if path.is_dir() => Ok(()),
            Self::Directory(path) => Err(format!(
                "Could not restore config directory: {}",
                path.display()
            )),
        }
    }
}

fn remove_config_file(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => {
            fs::remove_file(path)
                .map_err(|error| format!("Failed to remove legacy config: {error}"))?;
            sync_directory(
                path.parent()
                    .ok_or_else(|| "Failed to resolve config directory".to_string())?,
            )
        }
        Ok(_) => Err("Legacy config path is not a file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect legacy config: {error}")),
    }
}

fn remove_config_path(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path)
            .map_err(|error| format!("Failed to remove config directory: {error}")),
        Ok(_) => fs::remove_file(path).map_err(|error| format!("Failed to remove config: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to inspect config path: {error}")),
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TargetSelector {
    pub profile: Option<String>,
    pub project_default_profile: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedTargetSource {
    Environment,
    ExplicitProfile,
    EnvironmentProfile,
    ProjectDefaultProfile,
    ActiveProfile,
    LegacyConfig,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedTarget {
    pub server_url: String,
    pub api_key: String,
    pub profile_name: Option<String>,
    pub source: ResolvedTargetSource,
}

impl ResolvedTarget {
    pub fn base_url(&self) -> &str {
        self.server_url.trim_end_matches('/')
    }

    pub fn as_config(&self) -> Config {
        Config {
            server_url: self.server_url.clone(),
            api_key: self.api_key.clone(),
        }
    }
}

impl fmt::Debug for ResolvedTarget {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ResolvedTarget")
            .field("server_url", &self.server_url)
            .field("api_key", &"[REDACTED]")
            .field("profile_name", &self.profile_name)
            .field("source", &self.source)
            .finish()
    }
}

pub fn resolve_target(selector: TargetSelector) -> Result<ResolvedTarget, String> {
    let env_url = std::env::var("LOCALAPP_SERVER_URL").ok();
    let env_key = std::env::var("LOCALAPP_API_KEY").ok();
    let complete_environment = env_url.is_some() && env_key.is_some();
    if complete_environment && selector.profile.is_some() {
        return Err(
            "LOCALAPP_SERVER_URL/LOCALAPP_API_KEY cannot be combined with --profile".into(),
        );
    }
    if let (Some(server_url), Some(api_key)) = (env_url, env_key) {
        return Ok(ResolvedTarget {
            server_url: normalize_server_url(&server_url)?,
            api_key,
            profile_name: None,
            source: ResolvedTargetSource::Environment,
        });
    }

    let environment_profile = std::env::var("LOCALAPP_PROFILE").ok();
    let (profile_name, source) = if let Some(name) = selector.profile {
        (Some(name), ResolvedTargetSource::ExplicitProfile)
    } else if let Some(name) = environment_profile {
        (Some(name), ResolvedTargetSource::EnvironmentProfile)
    } else if let Some(name) = selector.project_default_profile {
        (Some(name), ResolvedTargetSource::ProjectDefaultProfile)
    } else {
        let store = ProfileStore::load()?;
        if let Some(name) = store.active_profile {
            (Some(name), ResolvedTargetSource::ActiveProfile)
        } else {
            (None, ResolvedTargetSource::LegacyConfig)
        }
    };

    if let Some(name) = profile_name {
        validate_profile_name(&name)?;
        let store = ProfileStore::load()?;
        let profile = store
            .profiles
            .get(&name)
            .ok_or_else(|| format!("Server profile not found: {name}"))?;
        return Ok(ResolvedTarget {
            server_url: normalize_server_url(&profile.server_url)?,
            api_key: profile.api_key.clone(),
            profile_name: Some(name),
            source,
        });
    }

    let config =
        Config::load().ok_or_else(|| "Not configured. Run 'localapp login' first.".to_string())?;
    Ok(ResolvedTarget {
        server_url: normalize_server_url(&config.server_url)?,
        api_key: config.api_key,
        profile_name: None,
        source,
    })
}

fn validate_profile_name(name: &str) -> Result<(), String> {
    let valid = (1..=63).contains(&name.len())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && name
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        && name
            .as_bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && !name.contains("--");
    if valid {
        Ok(())
    } else {
        Err("Invalid server profile name; use lowercase letters, numbers, and hyphens".into())
    }
}

fn validate_server_url(value: &str) -> Result<(), String> {
    normalize_server_url(value).map(|_| ())
}

fn normalize_server_url(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(value).map_err(|error| format!("Invalid server URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Server URL must use http or https and include a host".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("Server URL cannot include a query or fragment".into());
    }
    Ok(value.to_string())
}

fn atomic_write_json(
    path: &std::path::Path,
    value: &impl Serialize,
    label: &str,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {label}: {error}"))?;
    atomic_write_bytes(path, content.as_bytes(), label)
}

fn atomic_write_bytes(path: &Path, content: &[u8], label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Failed to resolve {label} directory"))?;
    fs::create_dir_all(parent).map_err(|error| format!("Failed to create {label} dir: {error}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Failed to create temporary {label}: {error}"))?;
    temporary
        .write_all(content)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| format!("Failed to write temporary {label}: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("Failed to replace {label}: {}", error.error))?;
    sync_directory(parent)
}

#[cfg(unix)]
fn sync_directory(path: &std::path::Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|e| format!("Failed to flush config directory: {e}"))
}

#[cfg(not(unix))]
fn sync_directory(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

fn dirs_home() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home);
    }
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        return PathBuf::from(userprofile);
    }
    PathBuf::from(".")
}
