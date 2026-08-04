use crate::actions::{ActionStatus, ClaimedAction, validate_request_id};
use crate::local_store::LocalStore;
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Serialize, Serializer, ser::Error as _};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const TASK_COLUMNS: &str = "request_id, server_origin, app_owner, app_name, app_version,
    publisher_user_id, publisher_display_name, title, description, script,
    dependencies_json, input_json, working_directory, timeout_seconds, status,
    result_json, error_code, error_summary, stdout_path, stderr_path, pinned,
    created_at, started_at, completed_at, updated_at";
const MAX_UI_LOG_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLogs {
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTask {
    #[serde(rename = "id")]
    pub request_id: String,
    pub server_origin: String,
    pub app_owner: String,
    pub app_name: String,
    pub app_version: Option<String>,
    pub publisher_user_id: String,
    pub publisher_display_name: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub script: String,
    pub dependencies: BTreeMap<String, String>,
    pub input: Value,
    #[serde(serialize_with = "serialize_path")]
    pub working_directory: PathBuf,
    pub timeout_seconds: u32,
    pub status: ActionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
    #[serde(serialize_with = "serialize_path")]
    pub stdout_path: PathBuf,
    #[serde(serialize_with = "serialize_path")]
    pub stderr_path: PathBuf,
    pub pinned: bool,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub updated_at: i64,
}

pub struct TaskRepository<'a> {
    store: &'a LocalStore,
}

impl<'a> TaskRepository<'a> {
    pub fn new(store: &'a LocalStore) -> Self {
        Self { store }
    }

    pub fn persist_claim(
        &self,
        action: &ClaimedAction,
        persisted_at: i64,
    ) -> Result<LocalTask, String> {
        validate_request_id(&action.id)?;
        let task_directory = self.store.paths().tasks().join(&action.id);
        let working_directory = task_directory.join("work");
        let stdout_path = task_directory.join("stdout.log");
        let stderr_path = task_directory.join("stderr.log");
        let working_directory_value = path_to_utf8(&working_directory)?;
        let stdout_path_value = path_to_utf8(&stdout_path)?;
        let stderr_path_value = path_to_utf8(&stderr_path)?;
        fs::create_dir_all(&working_directory).map_err(|error| {
            format!(
                "Could not create task working directory {}: {error}",
                working_directory.display()
            )
        })?;
        create_log_file(&stdout_path)?;
        create_log_file(&stderr_path)?;

        let dependencies_json = serde_json::to_string(&action.dependencies)
            .map_err(|error| format!("Could not serialize task dependencies: {error}"))?;
        let input_json = serde_json::to_string(&action.input)
            .map_err(|error| format!("Could not serialize task input: {error}"))?;
        let status = status_name(&action.status);
        let persisted_at = encode_timestamp(persisted_at);
        let started_at = matches!(action.status, ActionStatus::Running).then_some(&persisted_at);
        let completed_at = is_terminal(&action.status).then_some(&persisted_at);

        self.store.with_connection(|connection| {
            connection
                .execute(
                    "INSERT OR IGNORE INTO local_tasks (
                        request_id, server_origin, app_owner, app_name, app_version,
                        publisher_user_id, publisher_display_name, title, description, script,
                        dependencies_json, input_json, working_directory, timeout_seconds, status,
                        stdout_path, stderr_path, created_at, started_at, completed_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params![
                        action.id,
                        action.server_origin,
                        action.app_owner,
                        action.app_name,
                        action.app_version,
                        action.publisher_user_id,
                        action.publisher_display_name,
                        action.title,
                        action.description,
                        action.script,
                        dependencies_json,
                        input_json,
                        working_directory_value,
                        action.timeout_seconds,
                        status,
                        stdout_path_value,
                        stderr_path_value,
                        &persisted_at,
                        started_at,
                        completed_at,
                        &persisted_at,
                    ],
                )
                .map_err(|error| format!("Could not persist claimed task: {error}"))?;
            Ok(())
        })?;

        self.find(&action.id)?
            .ok_or_else(|| "Claimed task was not persisted".to_string())
    }

    pub fn find(&self, request_id: &str) -> Result<Option<LocalTask>, String> {
        validate_request_id(request_id)?;
        let raw = self.store.with_connection(|connection| {
            connection
                .query_row(
                    &format!("SELECT {TASK_COLUMNS} FROM local_tasks WHERE request_id = ?"),
                    [request_id],
                    raw_task_from_row,
                )
                .optional()
                .map_err(|error| format!("Could not read local task: {error}"))
        })?;
        raw.map(LocalTask::try_from).transpose()
    }

    pub fn list(&self) -> Result<Vec<LocalTask>, String> {
        let raw = self.store.with_connection(|connection| {
            let mut statement = connection
                .prepare(&format!(
                    "SELECT {TASK_COLUMNS} FROM local_tasks ORDER BY created_at DESC, request_id DESC"
                ))
                .map_err(|error| format!("Could not prepare local task list: {error}"))?;
            statement
                .query_map([], raw_task_from_row)
                .map_err(|error| format!("Could not list local tasks: {error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Could not list local tasks: {error}"))
        })?;
        raw.into_iter().map(LocalTask::try_from).collect()
    }

    pub fn read_logs(&self, request_id: &str) -> Result<TaskLogs, String> {
        let task = self
            .find(request_id)?
            .ok_or_else(|| "Local task was not found".to_string())?;
        let (stdout, stdout_truncated) = read_log_tail(&task.stdout_path)?;
        let (stderr, stderr_truncated) = read_log_tail(&task.stderr_path)?;
        Ok(TaskLogs {
            stdout,
            stderr,
            stdout_truncated,
            stderr_truncated,
        })
    }

    pub fn update_status(
        &self,
        request_id: &str,
        status: ActionStatus,
        updated_at: i64,
    ) -> Result<LocalTask, String> {
        validate_request_id(request_id)?;
        let status_value = status_name(&status);
        let updated_at = encode_timestamp(updated_at);
        let started_at = matches!(status, ActionStatus::Running).then_some(&updated_at);
        let completed_at = is_terminal(&status).then_some(&updated_at);
        let changed = self.store.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE local_tasks
                     SET status = ?1,
                         started_at = COALESCE(started_at, ?2),
                         completed_at = COALESCE(completed_at, ?3),
                         updated_at = ?4,
                         server_sync_pending = 1
                     WHERE request_id = ?5
                       AND status <> ?1
                       AND (
                         (?1 = 'awaiting_trust' AND status = 'claimed')
                         OR (?1 = 'preparing' AND status IN ('claimed', 'awaiting_trust'))
                         OR (?1 = 'running' AND status = 'preparing')
                         OR (?1 = 'failed' AND status IN ('preparing', 'running'))
                         OR (?1 = 'cancelled' AND status IN ('claimed', 'awaiting_trust', 'preparing', 'running'))
                         OR (?1 = 'interrupted' AND status IN ('preparing', 'running'))
                         OR (?1 = 'succeeded' AND status = 'running')
                       )",
                    params![
                        status_value,
                        started_at,
                        completed_at,
                        &updated_at,
                        request_id
                    ],
                )
                .map_err(|error| format!("Could not update local task status: {error}"))
        })?;
        let current = self
            .find(request_id)?
            .ok_or_else(|| "Local task was not found".to_string())?;
        if changed == 1 || current.status == status {
            Ok(current)
        } else {
            Err(format!(
                "Illegal local task status transition from {} to {}",
                status_name(&current.status),
                status_value
            ))
        }
    }

    pub fn complete(
        &self,
        request_id: &str,
        status: ActionStatus,
        result: Option<&Value>,
        error_code: Option<&str>,
        error_summary: Option<&str>,
        updated_at: i64,
    ) -> Result<LocalTask, String> {
        validate_request_id(request_id)?;
        if !matches!(
            status,
            ActionStatus::Succeeded
                | ActionStatus::Failed
                | ActionStatus::Cancelled
                | ActionStatus::Interrupted
        ) {
            return Err("Local task outcome status is not terminal".to_string());
        }
        if matches!(status, ActionStatus::Succeeded) {
            if error_code.is_some() || error_summary.is_some() {
                return Err("Successful local task cannot contain an error".to_string());
            }
        } else if result.is_some() {
            return Err("Unsuccessful local task cannot contain a result".to_string());
        }

        let status_value = status_name(&status);
        let result_json = result
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| format!("Could not serialize local task result: {error}"))?;
        let updated_at = encode_timestamp(updated_at);
        let changed = self.store.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE local_tasks
                     SET status = ?1,
                         result_json = ?2,
                         error_code = ?3,
                         error_summary = ?4,
                         completed_at = ?5,
                         updated_at = ?5,
                         server_sync_pending = 1
                     WHERE request_id = ?6
                       AND (
                         (?1 = 'succeeded' AND status = 'running')
                         OR (?1 = 'failed' AND status IN ('preparing', 'running'))
                         OR (?1 = 'cancelled' AND status IN ('claimed', 'awaiting_trust', 'preparing', 'running'))
                         OR (?1 = 'interrupted' AND status IN ('preparing', 'running'))
                       )",
                    params![
                        status_value,
                        result_json,
                        error_code,
                        error_summary,
                        &updated_at,
                        request_id
                    ],
                )
                .map_err(|error| format!("Could not complete local task: {error}"))
        })?;
        let current = self
            .find(request_id)?
            .ok_or_else(|| "Local task was not found".to_string())?;
        if changed == 1 || current.status == status {
            Ok(current)
        } else {
            Err(format!(
                "Illegal local task status transition from {} to {}",
                status_name(&current.status),
                status_value
            ))
        }
    }

    pub fn pending_server_syncs(&self) -> Result<Vec<LocalTask>, String> {
        let raw = self.store.with_connection(|connection| {
            let mut statement = connection
                .prepare(&format!(
                    "SELECT {TASK_COLUMNS} FROM local_tasks
                     WHERE server_sync_pending = 1
                     ORDER BY updated_at, request_id"
                ))
                .map_err(|error| format!("Could not prepare pending task sync list: {error}"))?;
            statement
                .query_map([], raw_task_from_row)
                .map_err(|error| format!("Could not list pending task syncs: {error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Could not list pending task syncs: {error}"))
        })?;
        raw.into_iter().map(LocalTask::try_from).collect()
    }

    pub fn mark_server_synced(&self, request_id: &str, status: ActionStatus) -> Result<(), String> {
        validate_request_id(request_id)?;
        let changed = self.store.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE local_tasks
                     SET server_sync_pending = 0
                     WHERE request_id = ?1 AND status = ?2 AND server_sync_pending = 1",
                    params![request_id, status_name(&status)],
                )
                .map_err(|error| format!("Could not mark local task server sync complete: {error}"))
        })?;
        if changed == 1 {
            Ok(())
        } else {
            Err("Local task server sync state changed before acknowledgement".to_string())
        }
    }

    pub fn set_pinned(
        &self,
        request_id: &str,
        pinned: bool,
        updated_at: i64,
    ) -> Result<(), String> {
        validate_request_id(request_id)?;
        let updated_at = encode_timestamp(updated_at);
        let changed = self.store.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE local_tasks SET pinned = ?, updated_at = ? WHERE request_id = ?",
                    params![i64::from(pinned), updated_at, request_id],
                )
                .map_err(|error| format!("Could not pin local task: {error}"))
        })?;
        if changed == 0 {
            return Err("Local task was not found".to_string());
        }
        Ok(())
    }

    pub fn reconcile_startup(&self, reconciled_at: i64) -> Result<usize, String> {
        self.recover_trash()?;
        let reconciled_at = encode_timestamp(reconciled_at);
        self.store.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE local_tasks
                     SET status = 'interrupted', completed_at = ?, updated_at = ?
                     WHERE status IN ('preparing', 'running')",
                    params![reconciled_at, reconciled_at],
                )
                .map_err(|error| format!("Could not reconcile local tasks: {error}"))
        })
    }

    pub fn cleanup_completed_before(&self, cutoff: i64) -> Result<usize, String> {
        self.recover_trash()?;
        let cutoff = encode_timestamp(cutoff);
        let trash_root = self.store.paths().tasks().join(".trash");
        fs::create_dir_all(&trash_root).map_err(|error| {
            format!(
                "Could not create local task trash {}: {error}",
                trash_root.display()
            )
        })?;
        let request_ids = self.store.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT request_id FROM local_tasks
                     WHERE pinned = 0
                       AND completed_at < ?
                       AND status IN ('succeeded', 'failed', 'cancelled', 'expired', 'interrupted')",
                )
                .map_err(|error| format!("Could not prepare local task cleanup: {error}"))?;
            statement
                .query_map([&cutoff], |row| row.get::<_, String>(0))
                .map_err(|error| format!("Could not inspect local task cleanup: {error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Could not inspect local task cleanup: {error}"))
        })?;

        let mut removed = 0;
        for request_id in request_ids {
            removed += self.cleanup_task(&request_id, &cutoff, &trash_root)?;
        }
        Ok(removed)
    }

    fn cleanup_task(
        &self,
        request_id: &str,
        cutoff: &str,
        trash_root: &Path,
    ) -> Result<usize, String> {
        let task_directory = self.store.paths().tasks().join(request_id);
        let trash_directory = trash_root.join(request_id);
        self.store.with_connection(|connection| {
            let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
                .map_err(|error| format!("Could not claim local task cleanup: {error}"))?;
            let eligible = transaction
                .query_row(
                    "SELECT 1 FROM local_tasks
                     WHERE request_id = ?1
                       AND pinned = 0
                       AND completed_at < ?2
                       AND status IN ('succeeded', 'failed', 'cancelled', 'expired', 'interrupted')",
                    params![request_id, cutoff],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|error| format!("Could not verify local task cleanup: {error}"))?
                .is_some();
            if !eligible {
                return Ok(0);
            }
            if trash_directory.exists() {
                return Err(format!(
                    "Local task cleanup trash already exists: {}",
                    trash_directory.display()
                ));
            }
            let moved = task_directory.exists();
            if moved {
                fs::rename(&task_directory, &trash_directory).map_err(|error| {
                    format!(
                        "Could not move local task to trash {}: {error}",
                        task_directory.display()
                    )
                })?;
            }
            let changed = transaction
                .execute(
                    "DELETE FROM local_tasks
                     WHERE request_id = ?1
                       AND pinned = 0
                       AND completed_at < ?2
                       AND status IN ('succeeded', 'failed', 'cancelled', 'expired', 'interrupted')",
                    params![request_id, cutoff],
                )
                .map_err(|error| format!("Could not clean up local task: {error}"))?;
            if changed != 1 {
                if moved {
                    fs::rename(&trash_directory, &task_directory).map_err(|error| {
                        format!("Could not restore local task after losing cleanup ownership: {error}")
                    })?;
                }
                return Ok(0);
            }
            transaction
                .commit()
                .map_err(|error| format!("Could not commit local task cleanup: {error}"))?;
            if moved {
                fs::remove_dir_all(&trash_directory).map_err(|error| {
                    format!(
                        "Could not remove local task trash {}: {error}",
                        trash_directory.display()
                    )
                })?;
            }
            Ok(1)
        })
    }

    fn recover_trash(&self) -> Result<(), String> {
        let trash_root = self.store.paths().tasks().join(".trash");
        if !trash_root.exists() {
            return Ok(());
        }
        let entries = fs::read_dir(&trash_root).map_err(|error| {
            format!(
                "Could not inspect local task trash {}: {error}",
                trash_root.display()
            )
        })?;
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Could not inspect local task trash: {error}"))?;
            let request_id = entry
                .file_name()
                .into_string()
                .map_err(|_| "Local task trash name is not valid UTF-8".to_string())?;
            validate_request_id(&request_id)?;
            let trash_directory = entry.path();
            let task_directory = self.store.paths().tasks().join(&request_id);
            self.store.with_connection(|connection| {
                let transaction =
                    Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
                        .map_err(|error| {
                            format!("Could not claim local task trash recovery: {error}")
                        })?;
                let row_exists = transaction
                    .query_row(
                        "SELECT 1 FROM local_tasks WHERE request_id = ?",
                        [&request_id],
                        |_| Ok(()),
                    )
                    .optional()
                    .map_err(|error| {
                        format!("Could not inspect local task trash metadata: {error}")
                    })?
                    .is_some();
                if row_exists {
                    if task_directory.exists() {
                        return Err(format!(
                            "Local task and recovery trash both exist for {request_id}"
                        ));
                    }
                    fs::rename(&trash_directory, &task_directory).map_err(|error| {
                        format!("Could not restore local task trash for {request_id}: {error}")
                    })?;
                } else if trash_directory.is_dir() {
                    fs::remove_dir_all(&trash_directory).map_err(|error| {
                        format!("Could not remove stale local task trash for {request_id}: {error}")
                    })?;
                } else {
                    fs::remove_file(&trash_directory).map_err(|error| {
                        format!("Could not remove stale local task trash for {request_id}: {error}")
                    })?;
                }
                transaction
                    .commit()
                    .map_err(|error| format!("Could not commit local task trash recovery: {error}"))
            })?;
        }
        Ok(())
    }
}

struct RawTask {
    request_id: String,
    server_origin: String,
    app_owner: String,
    app_name: String,
    app_version: Option<String>,
    publisher_user_id: String,
    publisher_display_name: Option<String>,
    title: String,
    description: Option<String>,
    script: String,
    dependencies_json: String,
    input_json: String,
    working_directory: String,
    timeout_seconds: i64,
    status: String,
    result_json: Option<String>,
    error_code: Option<String>,
    error_summary: Option<String>,
    stdout_path: String,
    stderr_path: String,
    pinned: i64,
    created_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
    updated_at: String,
}

impl TryFrom<RawTask> for LocalTask {
    type Error = String;

    fn try_from(raw: RawTask) -> Result<Self, Self::Error> {
        Ok(Self {
            request_id: raw.request_id,
            server_origin: raw.server_origin,
            app_owner: raw.app_owner,
            app_name: raw.app_name,
            app_version: raw.app_version,
            publisher_user_id: raw.publisher_user_id,
            publisher_display_name: raw.publisher_display_name,
            title: raw.title,
            description: raw.description,
            script: raw.script,
            dependencies: serde_json::from_str(&raw.dependencies_json)
                .map_err(|error| format!("Could not decode local task dependencies: {error}"))?,
            input: serde_json::from_str(&raw.input_json)
                .map_err(|error| format!("Could not decode local task input: {error}"))?,
            working_directory: PathBuf::from(raw.working_directory),
            timeout_seconds: u32::try_from(raw.timeout_seconds)
                .map_err(|_| "Local task timeout is invalid".to_string())?,
            status: parse_status(&raw.status)?,
            result: raw
                .result_json
                .as_deref()
                .map(serde_json::from_str)
                .transpose()
                .map_err(|error| format!("Could not decode local task result: {error}"))?,
            error_code: raw.error_code,
            error_summary: raw.error_summary,
            stdout_path: PathBuf::from(raw.stdout_path),
            stderr_path: PathBuf::from(raw.stderr_path),
            pinned: raw.pinned != 0,
            created_at: decode_timestamp(&raw.created_at)?,
            started_at: raw
                .started_at
                .as_deref()
                .map(decode_timestamp)
                .transpose()?,
            completed_at: raw
                .completed_at
                .as_deref()
                .map(decode_timestamp)
                .transpose()?,
            updated_at: decode_timestamp(&raw.updated_at)?,
        })
    }
}

fn raw_task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawTask> {
    Ok(RawTask {
        request_id: row.get(0)?,
        server_origin: row.get(1)?,
        app_owner: row.get(2)?,
        app_name: row.get(3)?,
        app_version: row.get(4)?,
        publisher_user_id: row.get(5)?,
        publisher_display_name: row.get(6)?,
        title: row.get(7)?,
        description: row.get(8)?,
        script: row.get(9)?,
        dependencies_json: row.get(10)?,
        input_json: row.get(11)?,
        working_directory: row.get(12)?,
        timeout_seconds: row.get(13)?,
        status: row.get(14)?,
        result_json: row.get(15)?,
        error_code: row.get(16)?,
        error_summary: row.get(17)?,
        stdout_path: row.get(18)?,
        stderr_path: row.get(19)?,
        pinned: row.get(20)?,
        created_at: row.get(21)?,
        started_at: row.get(22)?,
        completed_at: row.get(23)?,
        updated_at: row.get(24)?,
    })
}

fn encode_timestamp(timestamp: i64) -> String {
    let sortable = (timestamp as i128 - i64::MIN as i128) as u64;
    format!("{sortable:020}")
}

fn decode_timestamp(encoded: &str) -> Result<i64, String> {
    if encoded.len() != 20 || !encoded.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("Local task timestamp is invalid: {encoded}"));
    }
    let sortable = encoded
        .parse::<u64>()
        .map_err(|_| format!("Local task timestamp is invalid: {encoded}"))?;
    i64::try_from(sortable as i128 + i64::MIN as i128)
        .map_err(|_| format!("Local task timestamp is invalid: {encoded}"))
}

fn path_to_utf8(path: &Path) -> Result<&str, String> {
    path.to_str()
        .ok_or_else(|| format!("Local task path is not valid UTF-8: {}", path.display()))
}

fn serialize_path<S>(path: &Path, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(
        path.to_str()
            .ok_or_else(|| S::Error::custom("Local task path is not valid UTF-8"))?,
    )
}

fn create_log_file(path: &PathBuf) -> Result<(), String> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| format!("Could not create task log {}: {error}", path.display()))
}

fn read_log_tail(path: &Path) -> Result<(String, bool), String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Could not open local task log {}: {error}", path.display()))?;
    let length = file
        .metadata()
        .map_err(|error| {
            format!(
                "Could not inspect local task log {}: {error}",
                path.display()
            )
        })?
        .len();
    let truncated = length > MAX_UI_LOG_BYTES;
    if truncated {
        file.seek(SeekFrom::Start(length - MAX_UI_LOG_BYTES))
            .map_err(|error| {
                format!("Could not seek local task log {}: {error}", path.display())
            })?;
    }
    let mut bytes = Vec::with_capacity(length.min(MAX_UI_LOG_BYTES) as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read local task log {}: {error}", path.display()))?;
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

fn is_terminal(status: &ActionStatus) -> bool {
    matches!(
        status,
        ActionStatus::Succeeded
            | ActionStatus::Failed
            | ActionStatus::Cancelled
            | ActionStatus::Expired
            | ActionStatus::Interrupted
    )
}

fn status_name(status: &ActionStatus) -> &'static str {
    match status {
        ActionStatus::Pending => "pending",
        ActionStatus::Claimed => "claimed",
        ActionStatus::AwaitingTrust => "awaiting_trust",
        ActionStatus::Preparing => "preparing",
        ActionStatus::Running => "running",
        ActionStatus::Succeeded => "succeeded",
        ActionStatus::Failed => "failed",
        ActionStatus::Cancelled => "cancelled",
        ActionStatus::Expired => "expired",
        ActionStatus::Interrupted => "interrupted",
    }
}

fn parse_status(status: &str) -> Result<ActionStatus, String> {
    match status {
        "pending" => Ok(ActionStatus::Pending),
        "claimed" => Ok(ActionStatus::Claimed),
        "awaiting_trust" => Ok(ActionStatus::AwaitingTrust),
        "preparing" => Ok(ActionStatus::Preparing),
        "running" => Ok(ActionStatus::Running),
        "succeeded" => Ok(ActionStatus::Succeeded),
        "failed" => Ok(ActionStatus::Failed),
        "cancelled" => Ok(ActionStatus::Cancelled),
        "expired" => Ok(ActionStatus::Expired),
        "interrupted" => Ok(ActionStatus::Interrupted),
        _ => Err(format!("Local task status is invalid: {status}")),
    }
}
