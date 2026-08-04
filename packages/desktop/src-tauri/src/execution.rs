use crate::actions::{ActionError, ActionStatus, ActionStatusUpdate};
use crate::local_store::DesktopSettingsRow;
use crate::paths::DesktopPaths;
use crate::runner::environment::{
    CommandInstaller, EnvironmentDescriptor, EnvironmentError, EnvironmentRepository,
    InstallControl,
};
use crate::runner::process::{
    ExecutionOutcome, ExecutionRequest, FailureClassification, LogCallback, run,
};
use crate::task_repository::LocalTask;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

const DEFAULT_NPM_REGISTRY: &str = "https://registry.npmjs.org/";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimePaths {
    pub node: PathBuf,
    pub npm_cli: PathBuf,
    pub runner: PathBuf,
}

impl RuntimePaths {
    pub fn discover(resource_directory: &Path) -> Result<Self, String> {
        if !resource_directory.is_absolute() {
            return Err("Desktop runtime resource directory must be absolute".to_string());
        }
        let paths = Self {
            node: resource_directory.join(if cfg!(windows) { "node.exe" } else { "node" }),
            npm_cli: resource_directory.join("npm/bin/npm-cli.js"),
            runner: resource_directory.join("runner/localapp-runner.mjs"),
        };
        for (label, path) in [
            ("Node.js", &paths.node),
            ("npm CLI", &paths.npm_cli),
            ("LocalApp runner", &paths.runner),
        ] {
            if !path.is_file() {
                return Err(format!(
                    "Bundled {label} is unavailable: {}",
                    path.display()
                ));
            }
        }
        Ok(paths)
    }
}

#[derive(Default)]
pub struct ExecutionRegistry {
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl ExecutionRegistry {
    pub fn register(&self, request_id: &str) -> Result<CancellationToken, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Desktop execution registry is unavailable".to_string())?;
        if active.contains_key(request_id) {
            return Err("Local task is already running".to_string());
        }
        let token = CancellationToken::new();
        active.insert(request_id.to_string(), token.clone());
        Ok(token)
    }

    pub fn cancel(&self, request_id: &str) -> Result<bool, String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Desktop execution registry is unavailable".to_string())?;
        let Some(token) = active.get(request_id) else {
            return Ok(false);
        };
        token.cancel();
        Ok(true)
    }

    pub fn contains(&self, request_id: &str) -> Result<bool, String> {
        self.active
            .lock()
            .map(|active| active.contains_key(request_id))
            .map_err(|_| "Desktop execution registry is unavailable".to_string())
    }

    pub fn with_idle<T>(&self, operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "Desktop execution registry is unavailable".to_string())?;
        if !active.is_empty() {
            return Err("Dependency cache cannot be cleared while tasks are active".to_string());
        }
        operation()
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(request_id);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum TaskExecutionOutcome {
    Succeeded(Value),
    Failed {
        status: ActionStatus,
        code: String,
        message: String,
    },
}

impl TaskExecutionOutcome {
    pub fn server_update(&self) -> ActionStatusUpdate {
        match self {
            Self::Succeeded(result) => ActionStatusUpdate {
                status: ActionStatus::Succeeded,
                result: Some(result.clone()),
                error: None,
            },
            Self::Failed {
                status,
                code,
                message,
            } => ActionStatusUpdate {
                status: status.clone(),
                result: None,
                error: Some(ActionError {
                    message: message.clone(),
                    code: Some(code.clone()),
                }),
            },
        }
    }
}

pub struct PreparedExecution {
    task: LocalTask,
    runtime_paths: RuntimePaths,
    environment_path: PathBuf,
    child_env: BTreeMap<String, String>,
    deadline: Instant,
}

pub async fn prepare(
    task: LocalTask,
    settings: DesktopSettingsRow,
    desktop_paths: DesktopPaths,
    runtime_paths: RuntimePaths,
    cancellation: CancellationToken,
    deadline: Instant,
) -> Result<PreparedExecution, TaskExecutionOutcome> {
    if let Some(outcome) = preparation_interruption(&cancellation, deadline) {
        return Err(outcome);
    }
    let registry = settings
        .npm_registry
        .as_deref()
        .unwrap_or(DEFAULT_NPM_REGISTRY);
    let proxy = proxy_for_registry(registry, &settings);
    let descriptor = match EnvironmentDescriptor::new(registry, proxy, task.dependencies.clone()) {
        Ok(descriptor) => descriptor,
        Err(error) => return Err(dependency_failure(error.to_string())),
    };
    let environments = match EnvironmentRepository::new(
        desktop_paths.js_environments(),
        runtime_paths.node.clone(),
        runtime_paths.npm_cli.clone(),
    ) {
        Ok(environments) => environments,
        Err(error) => return Err(dependency_failure(error.to_string())),
    };
    let proxy_owned = proxy.map(str::to_string);
    let installer =
        CommandInstaller::with_control(InstallControl::new(cancellation.clone(), deadline));
    let prepared = match tokio::task::spawn_blocking(move || {
        environments.prepare(&descriptor, proxy_owned.as_deref(), &installer)
    })
    .await
    {
        Ok(Ok(prepared)) => prepared,
        Ok(Err(error)) => return Err(environment_failure(error)),
        Err(_) => {
            return Err(dependency_failure(
                "Dependency preparation worker stopped".to_string(),
            ));
        }
    };

    Ok(PreparedExecution {
        task,
        runtime_paths,
        environment_path: prepared.path,
        child_env: explicit_proxy_environment(&settings),
        deadline,
    })
}

pub async fn run_prepared(
    prepared: PreparedExecution,
    cancellation: CancellationToken,
    on_log: LogCallback,
) -> TaskExecutionOutcome {
    let Some(timeout) = prepared.deadline.checked_duration_since(Instant::now()) else {
        return execution_timeout();
    };
    if timeout.is_zero() {
        return execution_timeout();
    }
    let task = prepared.task;
    let context = json!({
        "serverOrigin": task.server_origin,
        "app": {
            "owner": task.app_owner,
            "name": task.app_name,
            "version": task.app_version,
            "publisherUserId": task.publisher_user_id,
        },
        "task": {
            "id": task.request_id,
            "workingDirectory": task.working_directory,
        }
    });
    let outcome = run(
        ExecutionRequest {
            node_executable: prepared.runtime_paths.node,
            runner_script: prepared.runtime_paths.runner,
            task_id: task.request_id,
            script: task.script,
            input: task.input,
            context,
            environment_path: prepared.environment_path,
            working_directory: task.working_directory,
            stdout_path: task.stdout_path,
            stderr_path: task.stderr_path,
            timeout,
            cancellation,
            child_env: prepared.child_env,
        },
        on_log,
    )
    .await;
    map_execution_outcome(outcome)
}

fn proxy_for_registry<'a>(registry: &str, settings: &'a DesktopSettingsRow) -> Option<&'a str> {
    if registry.starts_with("http://") {
        settings
            .http_proxy
            .as_deref()
            .or(settings.https_proxy.as_deref())
    } else {
        settings
            .https_proxy
            .as_deref()
            .or(settings.http_proxy.as_deref())
    }
}

fn explicit_proxy_environment(settings: &DesktopSettingsRow) -> BTreeMap<String, String> {
    let mut environment = BTreeMap::new();
    if let Some(proxy) = &settings.http_proxy {
        environment.insert("HTTP_PROXY".to_string(), proxy.clone());
    }
    if let Some(proxy) = &settings.https_proxy {
        environment.insert("HTTPS_PROXY".to_string(), proxy.clone());
    }
    environment
}

fn dependency_failure(message: String) -> TaskExecutionOutcome {
    TaskExecutionOutcome::Failed {
        status: ActionStatus::Failed,
        code: "dependency_prepare_failed".to_string(),
        message,
    }
}

fn environment_failure(error: EnvironmentError) -> TaskExecutionOutcome {
    if error.is_cancelled() {
        TaskExecutionOutcome::Failed {
            status: ActionStatus::Cancelled,
            code: "execution_cancelled".to_string(),
            message: "Execution cancelled".to_string(),
        }
    } else if error.is_timed_out() {
        execution_timeout()
    } else {
        dependency_failure(error.to_string())
    }
}

fn preparation_interruption(
    cancellation: &CancellationToken,
    deadline: Instant,
) -> Option<TaskExecutionOutcome> {
    if cancellation.is_cancelled() {
        Some(TaskExecutionOutcome::Failed {
            status: ActionStatus::Cancelled,
            code: "execution_cancelled".to_string(),
            message: "Execution cancelled".to_string(),
        })
    } else if Instant::now() >= deadline {
        Some(execution_timeout())
    } else {
        None
    }
}

fn execution_timeout() -> TaskExecutionOutcome {
    TaskExecutionOutcome::Failed {
        status: ActionStatus::Failed,
        code: "execution_timeout".to_string(),
        message: "Execution timed out".to_string(),
    }
}

fn map_execution_outcome(outcome: ExecutionOutcome) -> TaskExecutionOutcome {
    match outcome {
        ExecutionOutcome::Completed { result } => TaskExecutionOutcome::Succeeded(result),
        ExecutionOutcome::Failed {
            classification,
            code,
            message,
        } => TaskExecutionOutcome::Failed {
            status: match classification {
                FailureClassification::Cancelled => ActionStatus::Cancelled,
                FailureClassification::Interrupted => ActionStatus::Interrupted,
                FailureClassification::Dependency
                | FailureClassification::Run
                | FailureClassification::Serialization
                | FailureClassification::Timeout
                | FailureClassification::Protocol => ActionStatus::Failed,
            },
            code,
            message,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn registry_prevents_duplicate_execution_and_cancels_only_known_tasks() {
        let registry = ExecutionRegistry::default();
        let token = registry.register("task-a").unwrap();
        assert!(registry.contains("task-a").unwrap());
        assert!(registry.register("task-a").is_err());
        assert!(registry.cancel("task-a").unwrap());
        assert!(token.is_cancelled());
        assert!(!registry.cancel("task-b").unwrap());
        registry.finish("task-a");
        assert!(!registry.contains("task-a").unwrap());
        assert!(registry.register("task-a").is_ok());
    }

    #[test]
    fn outcome_mapping_keeps_timeout_failure_and_user_cancellation_distinct() {
        let timeout = map_execution_outcome(ExecutionOutcome::Failed {
            classification: FailureClassification::Timeout,
            code: "execution_timeout".into(),
            message: "Execution timed out".into(),
        });
        assert!(matches!(
            timeout,
            TaskExecutionOutcome::Failed { status: ActionStatus::Failed, ref code, .. }
                if code == "execution_timeout"
        ));
        let cancelled = map_execution_outcome(ExecutionOutcome::Failed {
            classification: FailureClassification::Cancelled,
            code: "execution_cancelled".into(),
            message: "Execution cancelled".into(),
        });
        assert!(matches!(
            cancelled,
            TaskExecutionOutcome::Failed {
                status: ActionStatus::Cancelled,
                ..
            }
        ));
    }

    #[test]
    fn preparation_observes_cancellation_before_deadline_and_deadline_as_timeout() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        assert!(matches!(
            preparation_interruption(&cancellation, Instant::now() + std::time::Duration::from_secs(1)),
            Some(TaskExecutionOutcome::Failed {
                status: ActionStatus::Cancelled,
                ref code,
                ..
            }) if code == "execution_cancelled"
        ));

        assert!(matches!(
            preparation_interruption(&CancellationToken::new(), Instant::now()),
            Some(TaskExecutionOutcome::Failed {
                status: ActionStatus::Failed,
                ref code,
                ..
            }) if code == "execution_timeout"
        ));
    }

    #[test]
    fn maintenance_holds_registration_gate_until_the_operation_finishes() {
        let registry = Arc::new(ExecutionRegistry::default());
        let (entered_sender, entered_receiver) = std::sync::mpsc::channel();
        let (release_sender, release_receiver) = std::sync::mpsc::channel();
        let maintenance_registry = Arc::clone(&registry);
        let maintenance = std::thread::spawn(move || {
            maintenance_registry.with_idle(|| {
                entered_sender.send(()).unwrap();
                release_receiver.recv().unwrap();
                Ok(())
            })
        });
        entered_receiver.recv().unwrap();

        let (registered_sender, registered_receiver) = std::sync::mpsc::channel();
        let registration_registry = Arc::clone(&registry);
        let registration = std::thread::spawn(move || {
            let result = registration_registry.register("after-maintenance");
            registered_sender.send(result.is_ok()).unwrap();
        });
        assert!(
            registered_receiver
                .recv_timeout(std::time::Duration::from_millis(100))
                .is_err()
        );

        release_sender.send(()).unwrap();
        assert!(maintenance.join().unwrap().is_ok());
        assert!(registered_receiver.recv().unwrap());
        registration.join().unwrap();
    }
}
