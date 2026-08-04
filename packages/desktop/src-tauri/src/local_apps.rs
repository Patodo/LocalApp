use crate::local_runtime::LocalAppHealthStatus;
use crate::paths::DesktopPaths;
use localapp_core::{extract_app_package, inspect_app_package};
use rusqlite::{Connection, OptionalExtension, params};
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const REGISTRY_SCHEMA_VERSION: u32 = 1;
const LOCAL_PLATFORM_VERSION: &str = "1.0.0";

#[derive(Clone)]
pub struct LocalAppRepository {
    paths: DesktopPaths,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub app_id: String,
    pub version: String,
    pub upgraded: bool,
    pub openable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalApp {
    pub app_id: String,
    pub current_version: String,
    pub installed_versions: Vec<String>,
    pub version_root: PathBuf,
    pub data_root: PathBuf,
    pub status: LocalAppHealthStatus,
    pub error: Option<String>,
}

#[derive(Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    schema_version: u32,
    apps: BTreeMap<String, RegistryApp>,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistryApp {
    current_version: String,
    installed_versions: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeRegistry {
    schema_version: u32,
    apps: Vec<RuntimeRegistration>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeRegistration {
    id: String,
    version: String,
    version_root: PathBuf,
    data_root: PathBuf,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemovalRecord {
    app_id: String,
    remove_data: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallRecord {
    app_id: String,
    target_version: String,
    database_existed: bool,
    local_registry: PersistentSnapshotKind,
    local_registry_sha256: Option<String>,
    runtime_registry: PersistentSnapshotKind,
    runtime_registry_sha256: Option<String>,
    database_sha256: Option<String>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum PersistentSnapshotKind {
    Missing,
    File,
    Directory,
}

impl LocalAppRepository {
    pub fn new(paths: DesktopPaths) -> Self {
        Self { paths }
    }

    pub fn list(&self) -> Result<Vec<LocalApp>, String> {
        let registry = self.load_registry()?;
        Ok(registry
            .apps
            .into_iter()
            .map(|(app_id, app)| self.to_local_app(app_id, app))
            .collect())
    }

    pub fn ensure_registry(&self) -> Result<(), String> {
        self.paths.ensure()?;
        let registry = self.load_registry()?;
        self.save_registry(&registry)
    }

    pub fn install(&self, package: &Path) -> Result<InstallOutcome, String> {
        self.install_inner(package, |_| Ok(false))
    }

    pub fn install_with_health(
        &self,
        package: &Path,
        health_check: impl FnOnce(&LocalApp) -> Result<(), String>,
    ) -> Result<InstallOutcome, String> {
        self.install_inner(package, |candidate| {
            health_check(candidate)?;
            Ok(true)
        })
    }

    fn install_inner(
        &self,
        package: &Path,
        readiness_check: impl FnOnce(&LocalApp) -> Result<bool, String>,
    ) -> Result<InstallOutcome, String> {
        self.paths.ensure()?;
        let inspection = inspect_app_package(package).map_err(|error| error.to_string())?;
        let version = Version::parse(&inspection.metadata.version)
            .map_err(|_| "Application package version must be valid semver".to_string())?;
        let platform = VersionReq::parse(&inspection.metadata.platform_version)
            .map_err(|_| "Application package platformVersion is invalid".to_string())?;
        let local_platform = Version::parse(LOCAL_PLATFORM_VERSION).expect("valid local version");
        if !platform.matches(&local_platform) {
            return Err(format!(
                "Application requires platform {}, local runtime is {LOCAL_PLATFORM_VERSION}",
                inspection.metadata.platform_version
            ));
        }
        let app_id = inspection.metadata.app_id;
        validate_local_app_id(&app_id)?;
        let version_text = version.to_string();
        let mut registry = self.load_registry()?;
        let previous = registry.apps.get(&app_id).cloned();
        let upgraded = previous.is_some();
        let target = self.version_root(&app_id, &version_text);
        if target.exists() {
            return Err(format!(
                "Application version is already installed: {app_id} {version_text}"
            ));
        }

        let staging = self
            .paths
            .apps()
            .join(".staging")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(&staging).map_err(io_error)?;
        let result = (|| {
            extract_app_package(package, &staging).map_err(|error| error.to_string())?;
            validate_entry_point(&staging)?;
            let data_root = self.prepare_data_root(&app_id)?;
            if previous.is_some() && !data_root.join("app.db").is_file() {
                return Err(format!(
                    "Installed application database is missing and cannot be upgraded: {app_id}"
                ));
            }
            self.preflight_migrations(&staging, &data_root)?;
            sync_tree(&staging)?;

            let versions = self.paths.apps().join(&app_id).join("versions");
            fs::create_dir_all(&versions).map_err(io_error)?;
            let transaction = InstallTransaction::prepare(
                &self.paths,
                &app_id,
                &version_text,
                &data_root.join("app.db"),
            )?;
            if let Err(error) = fs::rename(&staging, &target).map_err(io_error) {
                return Err(transaction.rollback(&self.paths, error));
            }
            if let Err(error) = sync_directory(&versions) {
                return Err(transaction.rollback(&self.paths, error));
            }
            if let Err(error) =
                apply_migrations(&data_root.join("app.db"), &target.join("migrations"))
            {
                return Err(transaction.rollback(&self.paths, error));
            }

            let mut installed_versions = previous
                .as_ref()
                .map(|app| app.installed_versions.clone())
                .unwrap_or_default();
            installed_versions.push(version_text.clone());
            installed_versions
                .sort_by(|left, right| Version::parse(left).ok().cmp(&Version::parse(right).ok()));
            installed_versions.dedup();
            let next_app = RegistryApp {
                current_version: version_text.clone(),
                installed_versions,
            };
            registry.apps.insert(app_id.clone(), next_app.clone());
            if let Err(error) = self.save_registry(&registry) {
                return Err(transaction.rollback(&self.paths, error));
            }
            let candidate = self.to_local_app(app_id.clone(), next_app);
            let openable = readiness_check(&candidate)
                .map_err(|error| transaction.rollback(&self.paths, error))?;
            if let Err(error) = transaction.commit(&self.paths) {
                return Err(transaction.rollback(&self.paths, error));
            }
            Ok(InstallOutcome {
                app_id,
                version: version_text,
                upgraded,
                openable,
            })
        })();
        match result {
            Ok(outcome) => Ok(outcome),
            Err(error) => Err(merge_errors(
                error,
                [(
                    "staging directory rollback",
                    remove_directory_if_present(&staging),
                )],
            )),
        }
    }

    pub fn uninstall(&self, app_id: &str) -> Result<(), String> {
        validate_local_app_id(app_id)?;
        let mut registry = self.load_registry()?;
        if registry.apps.remove(app_id).is_none() {
            return Err(format!("Local application not found: {app_id}"));
        }
        self.commit_removal(app_id, false, registry)
    }

    pub fn delete_permanently(&self, app_id: &str) -> Result<(), String> {
        validate_local_app_id(app_id)?;
        let mut registry = self.load_registry()?;
        registry.apps.remove(app_id);
        self.commit_removal(app_id, true, registry)
    }

    fn prepare_data_root(&self, app_id: &str) -> Result<PathBuf, String> {
        let data_root = self.paths.app_data().join(app_id);
        for directory in [
            data_root.clone(),
            data_root.join("files"),
            data_root.join("backups"),
        ] {
            fs::create_dir_all(directory).map_err(io_error)?;
        }
        Ok(data_root)
    }

    fn preflight_migrations(&self, version_root: &Path, data_root: &Path) -> Result<(), String> {
        let temporary = tempfile::NamedTempFile::new_in(data_root).map_err(io_error)?;
        let active = data_root.join("app.db");
        if active.is_file() {
            fs::copy(&active, temporary.path()).map_err(io_error)?;
        }
        apply_migrations(temporary.path(), &version_root.join("migrations"))
    }

    fn load_registry(&self) -> Result<Registry, String> {
        let mut registry = read_registry_file(&self.paths.local_app_registry(), &self.paths)?;
        self.recover_pending_installs(&mut registry)?;
        self.recover_pending_removals(&registry)?;
        Ok(registry)
    }

    fn commit_removal(
        &self,
        app_id: &str,
        remove_data: bool,
        registry: Registry,
    ) -> Result<(), String> {
        let staged = StagedRemoval::prepare(&self.paths, app_id, remove_data)?;
        if let Err(error) = self.save_registry(&registry) {
            return Err(merge_errors(
                error,
                [("application files rollback", staged.rollback(&self.paths))],
            ));
        }
        if let Err(error) = staged.commit() {
            eprintln!("LocalApp deferred cleanup for removed local application {app_id}: {error}");
        }
        Ok(())
    }

    fn recover_pending_removals(&self, registry: &Registry) -> Result<(), String> {
        let root = self.paths.root().join("app-removals");
        let root_metadata = match fs::symlink_metadata(&root) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => metadata,
            Ok(_) => {
                eprintln!(
                    "LocalApp ignored unsafe application removal journal root {}",
                    root.display()
                );
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                eprintln!(
                    "LocalApp ignored unreadable application removal journal root {}: {error}",
                    root.display()
                );
                return Ok(());
            }
        };
        if !root_metadata.is_dir() {
            return Ok(());
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(error) => {
                eprintln!(
                    "LocalApp ignored unreadable application removal journal root {}: {error}",
                    root.display()
                );
                return Ok(());
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    eprintln!("LocalApp ignored unreadable application removal journal: {error}");
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    eprintln!("LocalApp ignored unreadable application removal journal: {error}");
                    continue;
                }
            };
            if !metadata.is_dir() {
                eprintln!(
                    "LocalApp ignored non-directory application removal journal: {}",
                    path.display()
                );
                continue;
            }
            if entry.file_name().to_string_lossy().starts_with(".staging-") {
                if let Err(error) = remove_directory_if_present(&path) {
                    eprintln!(
                        "LocalApp could not clean incomplete application removal journal {}: {error}",
                        path.display()
                    );
                }
                continue;
            }
            if transaction_is_committed(&path, "app-removal-commits") {
                if let Err(error) = remove_transaction_directory(&path) {
                    eprintln!(
                        "LocalApp deferred cleanup for committed application removal journal {}: {error}",
                        path.display()
                    );
                }
                continue;
            }
            let staged = match StagedRemoval::load(path.clone()) {
                Ok(staged) => staged,
                Err(error) => {
                    eprintln!(
                        "LocalApp ignored invalid application removal journal {}: {error}",
                        path.display()
                    );
                    continue;
                }
            };
            if registry.apps.contains_key(&staged.record.app_id) {
                staged.restore(&self.paths)?;
                self.save_registry(registry)?;
                staged.cleanup()?;
            } else {
                self.save_registry(registry)?;
                if let Err(error) = staged.commit() {
                    eprintln!(
                        "LocalApp deferred cleanup for removed local application {}: {error}",
                        staged.record.app_id
                    );
                }
            }
        }
        Ok(())
    }

    fn recover_pending_installs(&self, registry: &mut Registry) -> Result<(), String> {
        let root = self.paths.root().join("app-installs");
        let root_metadata = match fs::symlink_metadata(&root) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => metadata,
            Ok(_) => {
                eprintln!(
                    "LocalApp ignored unsafe application install journal root {}",
                    root.display()
                );
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                eprintln!(
                    "LocalApp ignored unreadable application install journal root {}: {error}",
                    root.display()
                );
                return Ok(());
            }
        };
        if !root_metadata.is_dir() {
            return Ok(());
        }
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(error) => {
                eprintln!(
                    "LocalApp ignored unreadable application install journal root {}: {error}",
                    root.display()
                );
                return Ok(());
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    eprintln!("LocalApp ignored unreadable application install journal: {error}");
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    eprintln!("LocalApp ignored unreadable application install journal: {error}");
                    continue;
                }
            };
            if !metadata.is_dir() {
                eprintln!(
                    "LocalApp ignored non-directory application install journal: {}",
                    path.display()
                );
                continue;
            }
            if entry.file_name().to_string_lossy().starts_with(".staging-") {
                if let Err(error) = remove_directory_if_present(&path) {
                    eprintln!(
                        "LocalApp could not clean incomplete application install journal {}: {error}",
                        path.display()
                    );
                }
                continue;
            }
            if transaction_is_committed(&path, "app-install-commits") {
                if let Err(error) = remove_transaction_directory(&path) {
                    eprintln!(
                        "LocalApp deferred cleanup for committed application install journal {}: {error}",
                        path.display()
                    );
                }
                continue;
            }
            let transaction = match InstallTransaction::load(path.clone(), &self.paths) {
                Ok(transaction) => transaction,
                Err(error) => {
                    eprintln!(
                        "LocalApp ignored invalid application install journal {}: {error}",
                        path.display()
                    );
                    continue;
                }
            };
            transaction.recover(&self.paths)?;
            *registry = read_registry_file(&self.paths.local_app_registry(), &self.paths)?;
        }
        Ok(())
    }

    fn save_registry(&self, registry: &Registry) -> Result<(), String> {
        let snapshot = RegistrySnapshot::capture(&self.paths)?;
        atomic_write_json(
            &self.paths.local_app_registry(),
            registry,
            "local application registry",
        )?;
        let runtime = RuntimeRegistry {
            schema_version: REGISTRY_SCHEMA_VERSION,
            apps: registry
                .apps
                .iter()
                .map(|(id, app)| RuntimeRegistration {
                    id: id.clone(),
                    version: app.current_version.clone(),
                    version_root: self.version_root(id, &app.current_version),
                    data_root: self.paths.app_data().join(id),
                })
                .collect(),
        };
        if let Err(error) = atomic_write_json(
            &self.paths.local_runtime_registry(),
            &runtime,
            "local runtime registry",
        ) {
            return Err(merge_errors(
                error,
                [("registry transaction rollback", snapshot.restore())],
            ));
        }
        Ok(())
    }

    fn to_local_app(&self, app_id: String, app: RegistryApp) -> LocalApp {
        LocalApp {
            version_root: self.version_root(&app_id, &app.current_version),
            data_root: self.paths.app_data().join(&app_id),
            app_id,
            current_version: app.current_version,
            installed_versions: app.installed_versions,
            status: LocalAppHealthStatus::Unavailable,
            error: None,
        }
    }

    fn version_root(&self, app_id: &str, version: &str) -> PathBuf {
        self.paths
            .apps()
            .join(app_id)
            .join("versions")
            .join(version)
    }
}

struct StagedRemoval {
    root: PathBuf,
    record: RemovalRecord,
}

impl StagedRemoval {
    fn prepare(paths: &DesktopPaths, app_id: &str, remove_data: bool) -> Result<Self, String> {
        validate_local_app_id(app_id)?;
        let journals = paths.root().join("app-removals");
        fs::create_dir_all(&journals).map_err(io_error)?;
        let id = Uuid::new_v4().to_string();
        let temporary = journals.join(format!(".staging-{id}"));
        let root = journals.join(id);
        fs::create_dir(&temporary).map_err(io_error)?;
        let record = RemovalRecord {
            app_id: app_id.to_string(),
            remove_data,
        };
        if let Err(error) = atomic_write_json(
            &temporary.join("removal.json"),
            &record,
            "application removal journal",
        ) {
            return Err(merge_errors(
                error,
                [(
                    "application removal journal cleanup",
                    remove_directory_if_present(&temporary),
                )],
            ));
        }
        if let Err(error) = write_checksum_sidecar(
            &temporary.join("removal.json"),
            &temporary.join("removal.sha256"),
        ) {
            return Err(merge_errors(
                error,
                [(
                    "application removal journal cleanup",
                    remove_directory_if_present(&temporary),
                )],
            ));
        }
        if let Err(error) = fs::rename(&temporary, &root).map_err(io_error) {
            return Err(merge_errors(
                error,
                [(
                    "application removal journal cleanup",
                    remove_directory_if_present(&temporary),
                )],
            ));
        }
        sync_directory(&journals)?;
        let staged = Self {
            root,
            record: RemovalRecord {
                app_id: app_id.to_string(),
                remove_data,
            },
        };
        let result = (|| {
            move_if_present(&paths.apps().join(app_id), &staged.root.join("package"))?;
            if remove_data {
                move_if_present(&paths.app_data().join(app_id), &staged.root.join("data"))?;
            }
            sync_directory(&staged.root)?;
            sync_directory(&paths.apps())?;
            if remove_data {
                sync_directory(&paths.app_data())?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => Ok(staged),
            Err(error) => Err(merge_errors(
                error,
                [(
                    "application removal staging rollback",
                    staged.rollback(paths),
                )],
            )),
        }
    }

    fn load(root: PathBuf) -> Result<Self, String> {
        validate_transaction_id(&root)?;
        let record_path = root.join("removal.json");
        validate_checksum_sidecar(&record_path, &root.join("removal.sha256"))?;
        let record: RemovalRecord = serde_json::from_slice(
            &fs::read(&record_path)
                .map_err(|error| format!("Could not read application removal journal: {error}"))?,
        )
        .map_err(|error| format!("Invalid application removal journal: {error}"))?;
        validate_local_app_id(&record.app_id)?;
        Ok(Self { root, record })
    }

    fn restore(&self, paths: &DesktopPaths) -> Result<(), String> {
        let mut results = Vec::new();
        if self.record.remove_data {
            results.push((
                "application data",
                restore_moved_path(
                    &self.root.join("data"),
                    &paths.app_data().join(&self.record.app_id),
                ),
            ));
        }
        results.push((
            "application package",
            restore_moved_path(
                &self.root.join("package"),
                &paths.apps().join(&self.record.app_id),
            ),
        ));
        let restore = merge_dynamic_results(results);
        restore
    }

    fn rollback(&self, paths: &DesktopPaths) -> Result<(), String> {
        self.restore(paths)?;
        self.cleanup()
    }

    fn cleanup(&self) -> Result<(), String> {
        remove_transaction_directory(&self.root)
    }

    fn commit(&self) -> Result<(), String> {
        persist_transaction_receipt(&self.root, "app-removal-commits")?;
        self.cleanup()
    }
}

struct InstallTransaction {
    root: PathBuf,
    record: InstallRecord,
}

impl InstallTransaction {
    fn prepare(
        paths: &DesktopPaths,
        app_id: &str,
        target_version: &str,
        database: &Path,
    ) -> Result<Self, String> {
        validate_local_app_id(app_id)?;
        Version::parse(target_version)
            .map_err(|_| "Application install journal version is invalid".to_string())?;
        let journals = paths.root().join("app-installs");
        fs::create_dir_all(&journals).map_err(io_error)?;
        let id = Uuid::new_v4().to_string();
        let temporary = journals.join(format!(".staging-{id}"));
        let root = journals.join(id);
        fs::create_dir(&temporary).map_err(io_error)?;

        let result = (|| {
            let local_registry = persist_snapshot(
                &paths.local_app_registry(),
                &temporary.join("local-registry.before"),
            )?;
            let local_registry_sha256 =
                snapshot_checksum(&temporary.join("local-registry.before"), local_registry)?;
            let runtime_registry = persist_snapshot(
                &paths.local_runtime_registry(),
                &temporary.join("runtime-registry.before"),
            )?;
            let runtime_registry_sha256 =
                snapshot_checksum(&temporary.join("runtime-registry.before"), runtime_registry)?;
            let database_existed = database.is_file();
            if database_existed {
                copy_and_sync(database, &temporary.join("database.before"))?;
                create_unique_backup(database)?;
            }
            let record = InstallRecord {
                app_id: app_id.to_string(),
                target_version: target_version.to_string(),
                database_existed,
                local_registry,
                local_registry_sha256,
                runtime_registry,
                runtime_registry_sha256,
                database_sha256: database_existed
                    .then(|| sha256_file(&temporary.join("database.before")))
                    .transpose()?,
            };
            atomic_write_json(
                &temporary.join("install.json"),
                &record,
                "application install journal",
            )?;
            write_checksum_sidecar(
                &temporary.join("install.json"),
                &temporary.join("install.sha256"),
            )?;
            sync_directory(&temporary)?;
            fs::rename(&temporary, &root).map_err(io_error)?;
            sync_directory(&journals)?;
            Ok(Self { root, record })
        })();
        match result {
            Ok(transaction) => Ok(transaction),
            Err(error) => Err(merge_errors(
                error,
                [(
                    "application install journal cleanup",
                    remove_directory_if_present(&temporary),
                )],
            )),
        }
    }

    fn load(root: PathBuf, paths: &DesktopPaths) -> Result<Self, String> {
        validate_transaction_id(&root)?;
        validate_checksum_sidecar(&root.join("install.json"), &root.join("install.sha256"))?;
        let record: InstallRecord = serde_json::from_slice(
            &fs::read(root.join("install.json"))
                .map_err(|error| format!("Could not read application install journal: {error}"))?,
        )
        .map_err(|error| format!("Invalid application install journal: {error}"))?;
        validate_local_app_id(&record.app_id)?;
        Version::parse(&record.target_version)
            .map_err(|_| "Application install journal version is invalid".to_string())?;
        validate_persistent_snapshot(
            &root,
            "local-registry.before",
            record.local_registry,
            record.local_registry_sha256.as_deref(),
        )?;
        validate_persistent_snapshot(
            &root,
            "runtime-registry.before",
            record.runtime_registry,
            record.runtime_registry_sha256.as_deref(),
        )?;
        if record.database_existed {
            validate_regular_file(
                &root.join("database.before"),
                "Application install journal database snapshot is missing or unsafe",
            )?;
            validate_checksum(
                &root.join("database.before"),
                record.database_sha256.as_deref(),
            )?;
            validate_sqlite_snapshot(&root.join("database.before"))?;
        } else if record.database_sha256.is_some()
            || fs::symlink_metadata(root.join("database.before")).is_ok()
        {
            return Err("Application install journal database metadata is inconsistent".into());
        }
        let previous_registry = validate_registry_snapshot(&root, paths, &record)?;
        validate_install_recovery_metadata(paths, &record, &previous_registry)?;
        Ok(Self { root, record })
    }

    fn target(&self, paths: &DesktopPaths) -> PathBuf {
        paths
            .apps()
            .join(&self.record.app_id)
            .join("versions")
            .join(&self.record.target_version)
    }

    fn database(&self, paths: &DesktopPaths) -> PathBuf {
        paths.app_data().join(&self.record.app_id).join("app.db")
    }

    fn restore_state(&self, paths: &DesktopPaths) -> Result<(), String> {
        let database = self.database(paths);
        let database_result = if self.record.database_existed {
            copy_and_sync(&self.root.join("database.before"), &database)
        } else {
            remove_path_if_present(&database)
        };
        merge_results([
            ("database rollback", database_result),
            (
                "local application registry rollback",
                restore_persistent_snapshot(
                    &paths.local_app_registry(),
                    &self.root.join("local-registry.before"),
                    self.record.local_registry,
                ),
            ),
            (
                "local runtime registry rollback",
                restore_persistent_snapshot(
                    &paths.local_runtime_registry(),
                    &self.root.join("runtime-registry.before"),
                    self.record.runtime_registry,
                ),
            ),
            (
                "version directory rollback",
                remove_directory_if_present(&self.target(paths)),
            ),
        ])
    }

    fn rollback(&self, paths: &DesktopPaths, error: String) -> String {
        let restored = self.restore_state(paths);
        let cleanup = if restored.is_ok() {
            remove_transaction_directory(&self.root)
        } else {
            Ok(())
        };
        merge_errors(
            error,
            [
                ("install transaction rollback", restored),
                ("install transaction journal cleanup", cleanup),
            ],
        )
    }

    fn recover(&self, paths: &DesktopPaths) -> Result<(), String> {
        self.restore_state(paths)?;
        remove_transaction_directory(&self.root)
    }

    fn commit(&self, paths: &DesktopPaths) -> Result<(), String> {
        sync_tree(&self.target(paths))?;
        sync_file_if_present(&self.database(paths))?;
        sync_file_if_present(&paths.local_app_registry())?;
        sync_file_if_present(&paths.local_runtime_registry())?;
        persist_transaction_receipt(&self.root, "app-install-commits")?;
        if let Err(error) = remove_transaction_directory(&self.root) {
            eprintln!(
                "LocalApp deferred cleanup for committed application install journal {}: {error}",
                self.root.display()
            );
        }
        Ok(())
    }
}

struct RegistrySnapshot {
    local: PathSnapshot,
    runtime: PathSnapshot,
}

impl RegistrySnapshot {
    fn capture(paths: &DesktopPaths) -> Result<Self, String> {
        Ok(Self {
            local: PathSnapshot::capture(&paths.local_app_registry())?,
            runtime: PathSnapshot::capture(&paths.local_runtime_registry())?,
        })
    }

    fn restore(&self) -> Result<(), String> {
        merge_results([
            ("local application registry", self.local.restore()),
            ("local runtime registry", self.runtime.restore()),
        ])
    }
}

enum PathSnapshot {
    Missing(PathBuf),
    File { path: PathBuf, bytes: Vec<u8> },
    Directory(PathBuf),
}

impl PathSnapshot {
    fn capture(path: &Path) -> Result<Self, String> {
        match fs::metadata(path) {
            Ok(metadata) if metadata.is_file() => Ok(Self::File {
                path: path.to_path_buf(),
                bytes: fs::read(path).map_err(io_error)?,
            }),
            Ok(metadata) if metadata.is_dir() => Ok(Self::Directory(path.to_path_buf())),
            Ok(_) => Err(format!(
                "Registry path is neither a file nor directory: {}",
                path.display()
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(Self::Missing(path.to_path_buf()))
            }
            Err(error) => Err(io_error(error)),
        }
    }

    fn restore(&self) -> Result<(), String> {
        match self {
            Self::Missing(path) => remove_path_if_present(path),
            Self::File { path, bytes } => atomic_write(path, bytes),
            Self::Directory(path) if path.is_dir() => Ok(()),
            Self::Directory(path) => Err(format!(
                "Could not restore registry directory: {}",
                path.display()
            )),
        }
    }
}

fn persist_snapshot(path: &Path, snapshot: &Path) -> Result<PersistentSnapshotKind, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "Registry path must not be a symbolic link: {}",
            path.display()
        )),
        Ok(metadata) if metadata.is_file() => {
            copy_and_sync(path, snapshot)?;
            Ok(PersistentSnapshotKind::File)
        }
        Ok(metadata) if metadata.is_dir() => Ok(PersistentSnapshotKind::Directory),
        Ok(_) => Err(format!(
            "Registry path is neither a file nor directory: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(PersistentSnapshotKind::Missing)
        }
        Err(error) => Err(io_error(error)),
    }
}

fn validate_persistent_snapshot(
    root: &Path,
    filename: &str,
    kind: PersistentSnapshotKind,
    expected_checksum: Option<&str>,
) -> Result<(), String> {
    let snapshot = root.join(filename);
    match kind {
        PersistentSnapshotKind::File => {
            validate_regular_file(
                &snapshot,
                "Application install journal snapshot is missing or unsafe",
            )?;
            validate_checksum(&snapshot, expected_checksum)
        }
        PersistentSnapshotKind::Missing | PersistentSnapshotKind::Directory
            if expected_checksum.is_none() =>
        {
            Ok(())
        }
        PersistentSnapshotKind::Missing | PersistentSnapshotKind::Directory => {
            Err("Application install journal has an unexpected snapshot checksum".into())
        }
    }
}

fn validate_regular_file(path: &Path, message: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) | Err(_) => Err(format!("{message}: {}", path.display())),
    }
}

fn restore_persistent_snapshot(
    path: &Path,
    snapshot: &Path,
    kind: PersistentSnapshotKind,
) -> Result<(), String> {
    match kind {
        PersistentSnapshotKind::Missing => remove_path_if_present(path),
        PersistentSnapshotKind::File => {
            remove_path_if_present(path)?;
            copy_and_sync(snapshot, path)
        }
        PersistentSnapshotKind::Directory => {
            remove_path_if_present(path)?;
            fs::create_dir_all(path).map_err(io_error)
        }
    }
}

fn copy_and_sync(source: &Path, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", target.display()))?;
    fs::create_dir_all(parent).map_err(io_error)?;
    fs::copy(source, target).map_err(io_error)?;
    fs::File::open(target)
        .and_then(|file| file.sync_all())
        .map_err(io_error)
}

fn read_registry_file(path: &Path, paths: &DesktopPaths) -> Result<Registry, String> {
    let registry = if !path.exists() {
        Registry {
            schema_version: REGISTRY_SCHEMA_VERSION,
            apps: BTreeMap::new(),
        }
    } else {
        serde_json::from_slice(&fs::read(path).map_err(io_error)?)
            .map_err(|error| format!("Invalid local application registry: {error}"))?
    };
    if registry.schema_version != REGISTRY_SCHEMA_VERSION {
        return Err("Unsupported local application registry schema".into());
    }
    validate_registry(&registry, paths)?;
    Ok(registry)
}

fn validate_registry(registry: &Registry, paths: &DesktopPaths) -> Result<(), String> {
    for (app_id, app) in &registry.apps {
        validate_local_app_id(app_id)?;
        let current = Version::parse(&app.current_version)
            .map_err(|_| format!("Invalid current version for local application {app_id}"))?;
        if current.to_string() != app.current_version {
            return Err(format!(
                "Local application {app_id} current version is not canonical semver"
            ));
        }
        if app.installed_versions.is_empty() {
            return Err(format!(
                "Local application {app_id} has no installed versions"
            ));
        }
        let mut previous: Option<Version> = None;
        let mut contains_current = false;
        for version_text in &app.installed_versions {
            let version = Version::parse(version_text)
                .map_err(|_| format!("Invalid installed version for local application {app_id}"))?;
            if version.to_string() != *version_text {
                return Err(format!(
                    "Local application {app_id} has a non-canonical installed version"
                ));
            }
            if previous.as_ref().is_some_and(|value| value >= &version) {
                return Err(format!(
                    "Local application {app_id} installed versions are not strictly ordered"
                ));
            }
            contains_current |= version_text == &app.current_version;
            previous = Some(version);
        }
        if !contains_current {
            return Err(format!(
                "Local application {app_id} current version is not installed"
            ));
        }
        let version_root = paths
            .apps()
            .join(app_id)
            .join("versions")
            .join(&app.current_version);
        if !version_root.starts_with(paths.apps().join(app_id).join("versions")) {
            return Err(format!(
                "Local application {app_id} version path escapes managed storage"
            ));
        }
    }
    Ok(())
}

fn validate_registry_snapshot(
    root: &Path,
    paths: &DesktopPaths,
    record: &InstallRecord,
) -> Result<Registry, String> {
    let local = match record.local_registry {
        PersistentSnapshotKind::Missing => Registry {
            schema_version: REGISTRY_SCHEMA_VERSION,
            apps: BTreeMap::new(),
        },
        PersistentSnapshotKind::File => {
            let registry: Registry = serde_json::from_slice(
                &fs::read(root.join("local-registry.before")).map_err(io_error)?,
            )
            .map_err(|error| {
                format!("Invalid local registry in application install journal: {error}")
            })?;
            if registry.schema_version != REGISTRY_SCHEMA_VERSION {
                return Err(
                    "Unsupported local registry schema in application install journal".into(),
                );
            }
            registry
        }
        PersistentSnapshotKind::Directory => {
            return Err("Local registry snapshot cannot be a directory".into());
        }
    };
    validate_registry(&local, paths)?;

    match (record.local_registry, record.runtime_registry) {
        (PersistentSnapshotKind::Missing, PersistentSnapshotKind::Missing) => {}
        (PersistentSnapshotKind::File, PersistentSnapshotKind::File) => {
            let runtime: RuntimeRegistry = serde_json::from_slice(
                &fs::read(root.join("runtime-registry.before")).map_err(io_error)?,
            )
            .map_err(|error| {
                format!("Invalid runtime registry in application install journal: {error}")
            })?;
            validate_runtime_registry(&runtime, &local, paths)?;
        }
        _ => {
            return Err(
                "Application install journal registry snapshot types are inconsistent".into(),
            );
        }
    }
    Ok(local)
}

fn validate_install_recovery_metadata(
    paths: &DesktopPaths,
    record: &InstallRecord,
    previous: &Registry,
) -> Result<(), String> {
    if !record.database_existed
        && (record.database_sha256.is_some() || previous.apps.contains_key(&record.app_id))
    {
        return Err("Application install journal database metadata is inconsistent".into());
    }
    let current = read_registry_file(&paths.local_app_registry(), paths)?;
    if &current == previous {
        if !record.database_existed
            && paths
                .app_data()
                .join(&record.app_id)
                .join("app.db")
                .is_file()
        {
            return Err("Application install journal database state is inconsistent".into());
        }
        return Ok(());
    }
    let mut expected = previous.clone();
    let mut installed_versions = expected
        .apps
        .get(&record.app_id)
        .map(|app| app.installed_versions.clone())
        .unwrap_or_default();
    installed_versions.push(record.target_version.clone());
    installed_versions
        .sort_by(|left, right| Version::parse(left).ok().cmp(&Version::parse(right).ok()));
    installed_versions.dedup();
    expected.apps.insert(
        record.app_id.clone(),
        RegistryApp {
            current_version: record.target_version.clone(),
            installed_versions,
        },
    );
    if current == expected {
        Ok(())
    } else {
        Err("Application install journal does not match the active registry state".into())
    }
}

fn validate_runtime_registry(
    runtime: &RuntimeRegistry,
    local: &Registry,
    paths: &DesktopPaths,
) -> Result<(), String> {
    if runtime.schema_version != REGISTRY_SCHEMA_VERSION {
        return Err("Unsupported local runtime registry schema".into());
    }
    if runtime.apps.len() != local.apps.len() {
        return Err("Local runtime registry does not match the application registry".into());
    }
    let mut seen = BTreeMap::new();
    for registration in &runtime.apps {
        validate_local_app_id(&registration.id)?;
        if seen.insert(registration.id.clone(), ()).is_some() {
            return Err("Local runtime registry contains duplicate applications".into());
        }
        let Some(app) = local.apps.get(&registration.id) else {
            return Err("Local runtime registry contains an unknown application".into());
        };
        if registration.version != app.current_version
            || registration.version_root
                != paths
                    .apps()
                    .join(&registration.id)
                    .join("versions")
                    .join(&registration.version)
            || registration.data_root != paths.app_data().join(&registration.id)
        {
            return Err(format!(
                "Local runtime registry path or version is invalid for {}",
                registration.id
            ));
        }
    }
    Ok(())
}

fn snapshot_checksum(
    snapshot: &Path,
    kind: PersistentSnapshotKind,
) -> Result<Option<String>, String> {
    match kind {
        PersistentSnapshotKind::File => sha256_file(snapshot).map(Some),
        PersistentSnapshotKind::Missing | PersistentSnapshotKind::Directory => Ok(None),
    }
}

fn validate_checksum(path: &Path, expected: Option<&str>) -> Result<(), String> {
    let expected = expected
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "Application install journal snapshot checksum is invalid".to_string())?;
    let actual = sha256_file(path)?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "Application install journal snapshot checksum mismatch: {}",
            path.display()
        ))
    }
}

fn write_checksum_sidecar(path: &Path, sidecar: &Path) -> Result<(), String> {
    let checksum = format!("{}\n", sha256_file(path)?);
    write_new_and_sync(sidecar, checksum.as_bytes())
}

fn validate_checksum_sidecar(path: &Path, sidecar: &Path) -> Result<(), String> {
    validate_regular_file(
        sidecar,
        "Application transaction journal checksum is missing or unsafe",
    )?;
    let expected = fs::read_to_string(sidecar).map_err(io_error)?;
    validate_checksum(path, Some(expected.trim()))
}

fn validate_transaction_id(root: &Path) -> Result<(), String> {
    let id = root
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Application transaction journal ID is invalid".to_string())?;
    if Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id) {
        Ok(())
    } else {
        Err("Application transaction journal ID is invalid".into())
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(io_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn validate_sqlite_snapshot(path: &Path) -> Result<(), String> {
    use rusqlite::OpenFlags;
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Invalid database in application install journal: {error}"))?;
    let result: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| format!("Invalid database in application install journal: {error}"))?;
    if result == "ok" {
        Ok(())
    } else {
        Err(format!(
            "Invalid database in application install journal: {result}"
        ))
    }
}

fn create_unique_backup(database: &Path) -> Result<PathBuf, String> {
    let data_root = database
        .parent()
        .ok_or_else(|| "Application database path has no parent".to_string())?;
    let backups = data_root.join("backups");
    fs::create_dir_all(&backups).map_err(io_error)?;
    let id = Uuid::new_v4();
    let temporary = backups.join(format!(".staging-{id}"));
    let target = backups.join(format!("pre-upgrade-{}-{id}.db", now_millis()));
    if let Err(error) = copy_new_and_sync(database, &temporary) {
        return Err(merge_errors(
            error,
            [(
                "incomplete database backup cleanup",
                remove_path_if_present(&temporary),
            )],
        ));
    }
    if let Err(error) = validate_sqlite_snapshot(&temporary) {
        return Err(merge_errors(
            error,
            [(
                "invalid database backup cleanup",
                remove_path_if_present(&temporary),
            )],
        ));
    }
    if let Err(error) = fs::rename(&temporary, &target).map_err(io_error) {
        let _ = remove_path_if_present(&temporary);
        return Err(error);
    }
    if let Err(error) = sync_directory(&backups) {
        return Err(merge_errors(
            error,
            [(
                "uncommitted database backup cleanup",
                remove_path_if_present(&target),
            )],
        ));
    }
    Ok(target)
}

fn copy_new_and_sync(source: &Path, target: &Path) -> Result<(), String> {
    use std::io::{Read, Write};
    let mut input = fs::File::open(source).map_err(io_error)?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(io_error)?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        output.write_all(&buffer[..count]).map_err(io_error)?;
    }
    output.sync_all().map_err(io_error)
}

fn sync_file_if_present(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            fs::File::open(path)
                .and_then(|file| file.sync_all())
                .map_err(io_error)
        }
        Ok(_) => Err(format!(
            "Expected a regular file to synchronize: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn sync_tree(root: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(root).map_err(io_error)?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Refusing to synchronize a symbolic link: {}",
            root.display()
        ));
    }
    if metadata.is_file() {
        return fs::File::open(root)
            .and_then(|file| file.sync_all())
            .map_err(io_error);
    }
    if !metadata.is_dir() {
        return Err(format!(
            "Unsupported application transaction path: {}",
            root.display()
        ));
    }
    let entries = fs::read_dir(root)
        .map_err(io_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io_error)?;
    for entry in entries {
        sync_tree(&entry.path())?;
    }
    sync_directory(root)
}

fn write_new_and_sync(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}

fn transaction_receipt_path(root: &Path, receipt_directory: &str) -> Result<PathBuf, String> {
    validate_transaction_id(root)?;
    let id = root.file_name().and_then(|value| value.to_str()).unwrap();
    let state_root = root
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "Application transaction journal root is invalid".to_string())?;
    Ok(state_root.join(receipt_directory).join(id))
}

fn persist_transaction_receipt(root: &Path, receipt_directory: &str) -> Result<(), String> {
    let receipt = transaction_receipt_path(root, receipt_directory)?;
    let receipts = receipt
        .parent()
        .ok_or_else(|| "Application transaction receipt path is invalid".to_string())?;
    fs::create_dir_all(receipts).map_err(io_error)?;
    match write_new_and_sync(&receipt, b"committed\n") {
        Ok(()) => {}
        Err(_) if fs::read(&receipt).is_ok_and(|bytes| bytes == b"committed\n") => {}
        Err(error) => return Err(error),
    }
    if let Err(error) = sync_directory(receipts) {
        eprintln!(
            "LocalApp transaction receipt is visible but its directory sync was deferred: {error}"
        );
    }
    Ok(())
}

fn transaction_is_committed(root: &Path, receipt_directory: &str) -> bool {
    transaction_receipt_path(root, receipt_directory)
        .ok()
        .and_then(|receipt| fs::read(receipt).ok())
        .is_some_and(|bytes| bytes == b"committed\n")
}

fn remove_transaction_directory(path: &Path) -> Result<(), String> {
    let parent = path.parent().map(Path::to_path_buf);
    remove_directory_if_present(path)?;
    if let Some(parent) = parent {
        sync_directory(&parent)?;
    }
    Ok(())
}

fn validate_local_app_id(value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let valid = (3..=63).contains(&bytes.len())
        && bytes.first().is_some_and(|byte| byte.is_ascii_lowercase())
        && bytes
            .last()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
        && !value.contains("--");
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid local application ID: {value}"))
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(io_error)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn merge_results<const N: usize>(results: [(&str, Result<(), String>); N]) -> Result<(), String> {
    let failures = results
        .into_iter()
        .filter_map(|(label, result)| result.err().map(|error| format!("{label}: {error}")))
        .collect::<Vec<_>>();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn merge_errors<const N: usize>(
    primary: String,
    results: [(&str, Result<(), String>); N],
) -> String {
    match merge_results(results) {
        Ok(()) => primary,
        Err(rollback) => format!("{primary}; rollback failed: {rollback}"),
    }
}

fn merge_dynamic_results(results: Vec<(&str, Result<(), String>)>) -> Result<(), String> {
    let failures = results
        .into_iter()
        .filter_map(|(label, result)| result.err().map(|error| format!("{label}: {error}")))
        .collect::<Vec<_>>();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn move_if_present(source: &Path, target: &Path) -> Result<(), String> {
    match fs::symlink_metadata(source) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    }
    match fs::symlink_metadata(target) {
        Ok(_) => {
            return Err(format!(
                "Application removal target already exists: {}",
                target.display()
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error(error)),
    }
    fs::rename(source, target).map_err(io_error)
}

fn restore_moved_path(staged: &Path, original: &Path) -> Result<(), String> {
    match fs::symlink_metadata(staged) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    }
    match fs::symlink_metadata(original) {
        Ok(_) => {
            return Err(format!(
                "Could not restore application path because it already exists: {}",
                original.display()
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error(error)),
    }
    fs::rename(staged, original).map_err(io_error)
}

fn remove_directory_if_present(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(io_error)?;
    }
    Ok(())
}

fn remove_path_if_present(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path).map_err(io_error),
        Ok(_) => fs::remove_file(path).map_err(io_error),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn validate_entry_point(version_root: &Path) -> Result<(), String> {
    let entry = version_root.join("dist/index.html");
    if !entry.is_file() {
        return Err("Application package is missing dist/index.html".into());
    }
    fs::read_to_string(&entry)
        .map(|_| ())
        .map_err(|error| format!("Application entry point is unreadable: {error}"))
}

fn apply_migrations(database: &Path, migrations: &Path) -> Result<(), String> {
    let mut connection = Connection::open(database)
        .map_err(|error| format!("Could not open local application database: {error}"))?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS _localapp_applied_migrations(
                filename TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )
        .map_err(migration_error)?;
    let has_legacy_ledger = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = '_localapp_migrations'
            )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(migration_error)?;
    if has_legacy_ledger {
        connection
            .execute_batch(
                "INSERT OR IGNORE INTO _localapp_applied_migrations(
                    filename, checksum, applied_at
                )
                SELECT filename, checksum, CAST(applied_at AS TEXT)
                FROM _localapp_migrations;",
            )
            .map_err(migration_error)?;
    }
    if !migrations.is_dir() {
        return Ok(());
    }
    let mut files = fs::read_dir(migrations)
        .map_err(io_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io_error)?;
    files.sort_by_key(|entry| entry.file_name());
    for entry in files {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("sql") {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().into_owned();
        let sql = fs::read_to_string(&path).map_err(io_error)?;
        let checksum = format!("{:x}", Sha256::digest(sql.as_bytes()));
        let applied: Option<String> = connection
            .query_row(
                "SELECT checksum FROM _localapp_applied_migrations WHERE filename = ?1",
                [&filename],
                |row| row.get(0),
            )
            .optional()
            .map_err(migration_error)?;
        if let Some(applied) = applied {
            if applied != checksum {
                return Err(format!("Migration checksum changed: {filename}"));
            }
            continue;
        }
        let transaction = connection.transaction().map_err(migration_error)?;
        transaction.execute_batch(&sql).map_err(migration_error)?;
        transaction
            .execute(
                "INSERT INTO _localapp_applied_migrations(filename, checksum, applied_at)
                 VALUES (?1, ?2, datetime('now'))",
                params![filename, checksum],
            )
            .map_err(migration_error)?;
        transaction.commit().map_err(migration_error)?;
    }
    Ok(())
}

fn atomic_write_json(path: &Path, value: &impl Serialize, label: &str) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Could not serialize {label}: {error}"))?;
    atomic_write(path, &bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Registry path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(io_error)?;
    let temporary = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    use std::io::Write;
    let mut file = temporary.as_file();
    file.write_all(bytes).map_err(io_error)?;
    temporary.as_file().sync_all().map_err(io_error)?;
    temporary
        .persist(path)
        .map_err(|error| io_error(error.error))?;
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(io_error)?;
    sync_directory(parent)
}

fn now_millis() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

fn migration_error(error: impl std::fmt::Display) -> String {
    format!("Local application migration failed: {error}")
}

fn io_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
