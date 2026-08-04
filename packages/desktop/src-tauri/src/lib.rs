pub mod actions;
pub mod bus;
pub mod desktop_control;
pub mod execution;
mod local_app_commands;
pub mod local_apps;
pub mod local_runtime;
pub mod local_store;
pub mod paths;
pub mod platform;
pub mod runner;
mod server_profiles;
mod settings;
pub mod task_repository;
pub mod trust;

use notify_rust::{Notification, NotificationResponse};
use localapp_core::{Config, PlatformClient};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use actions::{
    ActionActivation, ActionError, ActionService, ActionStatus, ActionStatusUpdate,
    ActivationQueue, ClaimedAction, PendingAction,
};
use desktop_control::{DesktopControlServer, default_control_file};
use execution::{ExecutionRegistry, RuntimePaths, TaskExecutionOutcome};
use local_app_commands::{
    delete_local_app, get_local_runtime_status, install_local_app, list_local_apps, open_local_app,
    uninstall_local_app,
};
use local_apps::LocalAppRepository;
use local_runtime::{LocalRuntimeController, LocalRuntimeLaunch};
use local_store::{LocalStore, ScriptEnvironmentUpdate};
use runner::process::LogEvent;
use runner::protocol::LogStream;
use server_profiles::{
    list_server_profiles, publish_local_app, remove_server_profile, save_server_profile,
    use_server_profile,
};

fn reconciliation_target(
    server_status: &ActionStatus,
    local_status: &ActionStatus,
    trusted: bool,
    active: bool,
) -> ActionStatus {
    if active
        && matches!(
            server_status,
            ActionStatus::Preparing | ActionStatus::Running
        )
        && matches!(
            local_status,
            ActionStatus::Preparing | ActionStatus::Running
        )
    {
        return local_status.clone();
    }
    if matches!(
        local_status,
        ActionStatus::Succeeded
            | ActionStatus::Failed
            | ActionStatus::Cancelled
            | ActionStatus::Expired
            | ActionStatus::Interrupted
    ) {
        return local_status.clone();
    }
    match server_status {
        ActionStatus::Claimed | ActionStatus::AwaitingTrust if trusted => ActionStatus::Preparing,
        ActionStatus::Claimed => ActionStatus::AwaitingTrust,
        ActionStatus::Preparing | ActionStatus::Running => ActionStatus::Interrupted,
        status => status.clone(),
    }
}
use bus::{
    BusController, BusObserver, ConnectionState, NativeNotificationAction, NotificationActivation,
    NotificationClickAction, NotificationPayload, notification_activation, notification_click_plan,
};
use platform::{
    Favorite, FavoriteService, InboxListInput, InboxPage, InboxService, normalize_app_path,
};
use settings::SettingsStore;
pub use settings::{PublicSettings, SettingsUpdate};
use task_repository::{LocalTask, TaskLogs, TaskRepository};
use trust::{AppTrust, TrustKeyInput, TrustRepository};

pub struct AppState {
    config: Option<Config>,
    settings: Mutex<SettingsStore>,
    local_store: LocalStore,
    bus: BusController,
    notifications_enabled: Arc<AtomicBool>,
    activations: ActivationQueue,
    executions: ExecutionRegistry,
    local_apps: LocalAppRepository,
    local_runtime: Mutex<Option<LocalRuntimeController>>,
    desktop_control: Mutex<Option<DesktopControlServer>>,
    local_runtime_token: String,
    quitting: AtomicBool,
}

impl AppState {
    fn load() -> Result<Self, String> {
        let settings = SettingsStore::load()?;
        let notifications_enabled = settings.notifications_enabled();
        let local_store = LocalStore::discover()?;
        let local_apps = LocalAppRepository::new(local_store.paths().clone());
        let tasks = TaskRepository::new(&local_store);
        tasks.reconcile_startup(now_millis())?;
        let _ = tasks
            .cleanup_completed_before(now_millis().saturating_sub(30_i64 * 24 * 60 * 60 * 1000));
        Ok(Self {
            config: Config::load(),
            settings: Mutex::new(settings),
            local_store,
            bus: BusController::default(),
            notifications_enabled: Arc::new(AtomicBool::new(notifications_enabled)),
            activations: ActivationQueue::default(),
            executions: ExecutionRegistry::default(),
            local_apps,
            local_runtime: Mutex::new(None),
            desktop_control: Mutex::new(None),
            local_runtime_token: uuid::Uuid::new_v4().to_string(),
            quitting: AtomicBool::new(false),
        })
    }
}

struct TrayState {
    pause_item: MenuItem<tauri::Wry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountState {
    id: String,
    display_name: String,
    server_url: String,
    connection: &'static str,
    unread_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateInfo {
    available: bool,
    version: Option<String>,
    notes: Option<String>,
}

impl AccountState {
    fn offline() -> Self {
        Self {
            id: String::new(),
            display_name: "未登录".into(),
            server_url: String::new(),
            connection: "offline",
            unread_count: 0,
        }
    }

    fn connected(
        config: &Config,
        account: PlatformAccount,
        connection: &'static str,
    ) -> Result<Self, String> {
        Ok(Self {
            id: account.id,
            display_name: account.display_name.unwrap_or(account.name),
            server_url: public_server_url(config)?,
            connection,
            unread_count: 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_url_credentials_do_not_reach_account_state() {
        let config = Config {
            server_url: "https://user:password@work.example/".into(),
            api_key: "desktop-secret".into(),
        };
        let account = PlatformAccount {
            id: "user-id".into(),
            name: "Ada".into(),
            display_name: None,
        };

        assert!(AccountState::connected(&config, account, "connected").is_err());
    }

    #[test]
    fn claimed_tasks_wait_for_trust_or_prepare_when_the_exact_app_is_trusted() {
        assert_eq!(
            reconciliation_target(&ActionStatus::Claimed, &ActionStatus::Claimed, false, false),
            ActionStatus::AwaitingTrust
        );
        assert_eq!(
            reconciliation_target(&ActionStatus::Claimed, &ActionStatus::Claimed, true, false),
            ActionStatus::Preparing
        );
    }

    #[test]
    fn startup_never_replays_unverifiable_active_or_terminal_local_work() {
        assert_eq!(
            reconciliation_target(&ActionStatus::Running, &ActionStatus::Running, true, false),
            ActionStatus::Interrupted
        );
        assert_eq!(
            reconciliation_target(
                &ActionStatus::Preparing,
                &ActionStatus::Preparing,
                true,
                false
            ),
            ActionStatus::Interrupted
        );
        assert_eq!(
            reconciliation_target(
                &ActionStatus::Claimed,
                &ActionStatus::Succeeded,
                false,
                false
            ),
            ActionStatus::Succeeded
        );
    }

    #[test]
    fn reconnect_preserves_work_still_owned_by_the_execution_registry() {
        assert_eq!(
            reconciliation_target(
                &ActionStatus::Preparing,
                &ActionStatus::Preparing,
                true,
                true
            ),
            ActionStatus::Preparing
        );
        assert_eq!(
            reconciliation_target(&ActionStatus::Running, &ActionStatus::Running, true, true),
            ActionStatus::Running
        );
        assert_eq!(
            reconciliation_target(&ActionStatus::Running, &ActionStatus::Preparing, true, true),
            ActionStatus::Preparing
        );
    }

    #[test]
    fn trusted_awaiting_task_resumes_after_a_transient_status_upload_failure() {
        assert_eq!(
            reconciliation_target(
                &ActionStatus::AwaitingTrust,
                &ActionStatus::AwaitingTrust,
                true,
                false
            ),
            ActionStatus::Preparing
        );
    }

    #[test]
    fn dependency_cache_clear_requires_an_idle_execution_registry() {
        let root = tempfile::TempDir::new().unwrap();
        let paths = crate::paths::DesktopPaths::from_root(root.path().to_path_buf());
        paths.ensure().unwrap();
        fs::write(paths.js_environments().join("cached"), b"data").unwrap();
        let executions = ExecutionRegistry::default();

        clear_js_environment_cache(&paths, &executions).unwrap();
        assert!(paths.js_environments().is_dir());
        assert!(
            fs::read_dir(paths.js_environments())
                .unwrap()
                .next()
                .is_none()
        );

        executions.register("active-task").unwrap();
        assert!(clear_js_environment_cache(&paths, &executions).is_err());
    }
}

#[derive(Deserialize)]
struct PlatformAccount {
    id: String,
    name: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

#[tauri::command]
async fn get_account(state: State<'_, AppState>) -> Result<AccountState, String> {
    let Some(config) = state.config.clone() else {
        return Ok(AccountState::offline());
    };
    if config.api_key.trim().is_empty() {
        return Ok(AccountState::offline());
    }
    configured_server_url(&config)?;
    let account: PlatformAccount = PlatformClient::new(config.clone())
        .get("/api/me")
        .await
        .map_err(|_| "Could not load the LocalApp account".to_string())?;

    AccountState::connected(&config, account, state.bus.connection_state().as_str())
}

fn inbox_service(state: &AppState) -> Result<InboxService, String> {
    let config = state
        .config
        .clone()
        .ok_or_else(|| "LocalApp is not configured".to_string())?;
    configured_server_url(&config)?;
    Ok(InboxService::new(config))
}

fn favorites_service(state: &AppState) -> Result<FavoriteService, String> {
    let config = state
        .config
        .clone()
        .ok_or_else(|| "LocalApp is not configured".to_string())?;
    configured_server_url(&config)?;
    Ok(FavoriteService::new(config))
}

#[tauri::command]
async fn list_inbox(
    state: State<'_, AppState>,
    input: Option<InboxListInput>,
) -> Result<InboxPage, String> {
    let service = inbox_service(&state)?;
    let input = input.unwrap_or_default();
    service
        .list(input.cursor.as_deref(), input.unread_only)
        .await
}

#[tauri::command]
async fn get_unread_count(state: State<'_, AppState>) -> Result<u32, String> {
    inbox_service(&state)?.unread_count().await
}

#[tauri::command]
async fn mark_notification_read(
    app: AppHandle,
    state: State<'_, AppState>,
    notification_id: String,
) -> Result<platform::InboxItem, String> {
    let item = inbox_service(&state)?.mark_read(&notification_id).await?;
    emit_current_unread_count(&app, &state).await;
    Ok(item)
}

#[tauri::command]
async fn delete_notification(
    app: AppHandle,
    state: State<'_, AppState>,
    notification_id: String,
) -> Result<(), String> {
    inbox_service(&state)?.delete(&notification_id).await?;
    emit_current_unread_count(&app, &state).await;
    Ok(())
}

#[tauri::command]
async fn mark_all_read(app: AppHandle, state: State<'_, AppState>) -> Result<u32, String> {
    let changed = inbox_service(&state)?.mark_all_read().await?;
    let _ = app.emit("desktop://unread-count", 0_u32);
    Ok(changed)
}

async fn emit_current_unread_count(app: &AppHandle, state: &AppState) {
    if let Ok(service) = inbox_service(state)
        && let Ok(count) = service.unread_count().await
    {
        let _ = app.emit("desktop://unread-count", count);
    }
}

#[tauri::command]
async fn list_favorites(state: State<'_, AppState>) -> Result<Vec<Favorite>, String> {
    favorites_service(&state)?.list().await
}

#[tauri::command]
async fn remove_favorite(
    state: State<'_, AppState>,
    stored_page_path: String,
) -> Result<(), String> {
    favorites_service(&state)?.remove(&stored_page_path).await
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<PublicSettings, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Desktop settings are unavailable".to_string())?;
    let public = settings.public(state.config.as_ref())?;
    drop(settings);
    merge_script_environment(public, &state.local_store)
}

#[tauri::command]
fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SettingsUpdate,
) -> Result<PublicSettings, String> {
    let previous_launch_at_login = state
        .settings
        .lock()
        .map_err(|_| "Desktop settings are unavailable".to_string())?
        .launch_at_login();
    let launch_at_login = input.launch_at_login;
    if let Some(enabled) = launch_at_login {
        set_autostart(&app, enabled)?;
    }

    let notifications_enabled = input.notifications_enabled;
    let environment_update = ScriptEnvironmentUpdate {
        npm_registry: input.npm_registry.clone(),
        http_proxy: input.http_proxy.clone(),
        https_proxy: input.https_proxy.clone(),
        clear_http_proxy: input.clear_http_proxy,
        clear_https_proxy: input.clear_https_proxy,
    };
    let result = state
        .settings
        .lock()
        .map_err(|_| "Desktop settings are unavailable".to_string())?
        .update(state.config.as_ref(), input);
    if result.is_err() && launch_at_login.is_some() {
        let _ = set_autostart(&app, previous_launch_at_login);
    }
    let settings = result?;
    state
        .local_store
        .update_script_environment(environment_update)?;
    let settings = merge_script_environment(settings, &state.local_store)?;

    if let Some(enabled) = notifications_enabled {
        state
            .notifications_enabled
            .store(enabled, Ordering::Release);
        update_pause_label(&app, enabled);
    }
    Ok(settings)
}

fn merge_script_environment(
    mut settings: PublicSettings,
    store: &LocalStore,
) -> Result<PublicSettings, String> {
    let environment = store.script_environment_settings()?;
    settings.npm_registry = environment.npm_registry;
    settings.http_proxy_configured = environment.http_proxy_configured;
    settings.https_proxy_configured = environment.https_proxy_configured;
    Ok(settings)
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<DesktopUpdateInfo, String> {
    let update = app
        .updater()
        .map_err(|error| format!("Desktop updater is unavailable: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Could not check for desktop updates: {error}"))?;
    Ok(match update {
        Some(update) => DesktopUpdateInfo {
            available: true,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
        },
        None => DesktopUpdateInfo {
            available: false,
            version: None,
            notes: None,
        },
    })
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| format!("Desktop updater is unavailable: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Could not check for desktop updates: {error}"))?
        .ok_or_else(|| "No desktop update is available".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Could not install the desktop update: {error}"))
}

fn clear_js_environment_cache(
    paths: &crate::paths::DesktopPaths,
    executions: &ExecutionRegistry,
) -> Result<(), String> {
    executions.with_idle(|| {
        let directory = paths.js_environments();
        if directory.exists() {
            fs::remove_dir_all(&directory)
                .map_err(|_| "Could not clear the dependency cache".to_string())?;
        }
        fs::create_dir_all(&directory)
            .map_err(|_| "Could not recreate the dependency cache".to_string())
    })
}

#[tauri::command]
fn clear_dependency_cache(state: State<'_, AppState>) -> Result<(), String> {
    clear_js_environment_cache(state.local_store.paths(), &state.executions)
}

#[tauri::command]
async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if std::env::var_os("LOCALAPP_API_KEY").is_some() {
        return Err("Logout is disabled while LOCALAPP_API_KEY is configured".to_string());
    }
    let mut config = Config::load().ok_or_else(|| "Already logged out".to_string())?;
    config.api_key.clear();
    config.save()?;
    state.bus.stop().await;
    app.restart()
}

#[tauri::command]
async fn quit_app(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.quitting.store(true, Ordering::Release);
    state.bus.stop().await;
    stop_desktop_control(&state).await?;
    if let Ok(controller) = local_runtime_controller(&state) {
        let _ = controller.stop().await;
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn disconnect_bus(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.bus.stop().await;
    let _ = app.emit(
        "desktop://connection",
        ConnectionPayload { status: "offline" },
    );
    Ok(())
}

#[tauri::command]
fn reconnect_bus(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let config = state
        .config
        .clone()
        .ok_or_else(|| "LocalApp is not configured".to_string())?;
    configured_server_url(&config)?;
    let installation_id = state
        .settings
        .lock()
        .map_err(|_| "Desktop settings are unavailable".to_string())?
        .installation_id()
        .to_string();
    let observer = TauriBusObserver {
        app,
        config: config.clone(),
        installation_id: installation_id.clone(),
        notifications_enabled: Arc::clone(&state.notifications_enabled),
    };
    state.bus.start(config, installation_id, observer);
    Ok(())
}

#[tauri::command]
fn open_external(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let config = state
        .config
        .as_ref()
        .ok_or_else(|| "LocalApp is not configured".to_string())?;
    let url = validate_external_url(config, &url)?;

    open_configured_url(url)
}

#[tauri::command]
async fn open_notification(
    state: State<'_, AppState>,
    notification_id: Option<String>,
    url: String,
) -> Result<Option<platform::InboxItem>, String> {
    let config = state
        .config
        .clone()
        .ok_or_else(|| "LocalApp is not configured".to_string())?;
    execute_notification_click(config, notification_id.as_deref(), &url).await
}

#[tauri::command]
fn take_pending_activations(state: State<'_, AppState>) -> Vec<ActionActivation> {
    state.activations.take_pending()
}

fn action_service(state: &AppState) -> Result<ActionService, String> {
    let config = state
        .config
        .clone()
        .ok_or_else(|| "LocalApp is not configured".to_string())?;
    configured_server_url(&config)?;
    let installation_id = state
        .settings
        .lock()
        .map_err(|_| "Desktop settings are unavailable".to_string())?
        .installation_id()
        .to_string();
    Ok(ActionService::new(config, installation_id))
}

#[tauri::command]
async fn list_pending_actions(state: State<'_, AppState>) -> Result<Vec<PendingAction>, String> {
    action_service(&state)?.list_pending().await
}

#[tauri::command]
async fn list_recoverable_actions(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<LocalTask>, String> {
    flush_pending_server_syncs(&state).await?;
    let actions = action_service(&state)?.list_recoverable().await?;
    let mut tasks = Vec::with_capacity(actions.len());
    for action in actions {
        tasks.push(persist_and_reconcile_action(&app, &state, action).await?);
    }
    Ok(tasks)
}

async fn flush_pending_server_syncs(state: &AppState) -> Result<(), String> {
    let repository = TaskRepository::new(&state.local_store);
    let pending = repository.pending_server_syncs()?;
    if pending.is_empty() {
        return Ok(());
    }
    let service = action_service(state)?;
    for task in pending {
        let status = task.status.clone();
        let update = ActionStatusUpdate {
            status: status.clone(),
            result: matches!(status, ActionStatus::Succeeded)
                .then(|| task.result.clone())
                .flatten(),
            error: task.error_summary.clone().map(|message| ActionError {
                message,
                code: task.error_code.clone(),
            }),
        };
        service.update_status(&task.request_id, update).await?;
        repository.mark_server_synced(&task.request_id, status)?;
    }
    Ok(())
}

#[tauri::command]
async fn claim_action(
    app: AppHandle,
    state: State<'_, AppState>,
    activation: ActionActivation,
) -> Result<LocalTask, String> {
    let action = action_service(&state)?.claim(&activation).await?;
    persist_and_reconcile_action(&app, &state, action).await
}

async fn persist_and_reconcile_action(
    app: &AppHandle,
    state: &AppState,
    action: ClaimedAction,
) -> Result<LocalTask, String> {
    let repository = TaskRepository::new(&state.local_store);
    let local = repository.persist_claim(&action, now_millis())?;
    let trusted = TrustRepository::new(&state.local_store)
        .find_trusted(&action)?
        .is_some();
    let active = state.executions.contains(&action.id)?;
    let target = reconciliation_target(&action.status, &local.status, trusted, active);
    let local = if local.status == target {
        local
    } else if target == ActionStatus::Interrupted
        && !matches!(
            local.status,
            ActionStatus::Preparing | ActionStatus::Running
        )
    {
        repository.update_status(&action.id, ActionStatus::Preparing, now_millis())?;
        repository.update_status(&action.id, ActionStatus::Interrupted, now_millis())?
    } else {
        repository.update_status(&action.id, target.clone(), now_millis())?
    };
    if action.status != target {
        action_service(state)?
            .update_status(
                &action.id,
                ActionStatusUpdate {
                    status: target,
                    result: None,
                    error: None,
                },
            )
            .await?;
        repository.mark_server_synced(&action.id, local.status.clone())?;
    }
    if local.status == ActionStatus::Preparing && !active {
        start_task_execution(app, state, &action.id)?;
    }
    Ok(local)
}

#[tauri::command]
fn list_local_tasks(state: State<'_, AppState>) -> Result<Vec<LocalTask>, String> {
    TaskRepository::new(&state.local_store).list()
}

#[tauri::command]
fn read_local_task_logs(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<TaskLogs, String> {
    TaskRepository::new(&state.local_store).read_logs(&request_id)
}

#[tauri::command]
async fn trust_and_run_task(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
) -> Result<LocalTask, String> {
    let repository = TaskRepository::new(&state.local_store);
    let task = repository
        .find(&request_id)?
        .ok_or_else(|| "Local task was not found".to_string())?;
    TrustRepository::new(&state.local_store).trust(&claimed_action_from_task(&task))?;
    action_service(&state)?
        .update_status(
            &request_id,
            ActionStatusUpdate {
                status: ActionStatus::Preparing,
                result: None,
                error: None,
            },
        )
        .await?;
    let task = repository.update_status(&request_id, ActionStatus::Preparing, now_millis())?;
    repository.mark_server_synced(&request_id, ActionStatus::Preparing)?;
    start_task_execution(&app, &state, &request_id)?;
    Ok(task)
}

#[tauri::command]
async fn reject_local_task(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<LocalTask, String> {
    transition_local_and_server(&state, &request_id, ActionStatus::Cancelled).await
}

#[tauri::command]
async fn cancel_local_task(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<LocalTask, String> {
    if state.executions.cancel(&request_id)? {
        return TaskRepository::new(&state.local_store)
            .find(&request_id)?
            .ok_or_else(|| "Local task was not found".to_string());
    }
    transition_local_and_server(&state, &request_id, ActionStatus::Cancelled).await
}

fn start_task_execution(
    app: &AppHandle,
    state: &AppState,
    request_id: &str,
) -> Result<LocalTask, String> {
    let task = TaskRepository::new(&state.local_store)
        .find(request_id)?
        .ok_or_else(|| "Local task was not found".to_string())?;
    if task.status != ActionStatus::Preparing {
        return Err("Local task is not ready for execution".to_string());
    }
    let cancellation = state.executions.register(request_id)?;
    let app = app.clone();
    let request_id = request_id.to_string();
    tauri::async_runtime::spawn(async move {
        run_registered_task(app.clone(), request_id.clone(), cancellation).await;
        app.state::<AppState>().executions.finish(&request_id);
    });
    Ok(task)
}

async fn run_registered_task(
    app: AppHandle,
    request_id: String,
    cancellation: tokio_util::sync::CancellationToken,
) {
    let setup = {
        let state = app.state::<AppState>();
        let repository = TaskRepository::new(&state.local_store);
        let task = repository.find(&request_id);
        let settings = state.local_store.desktop_settings();
        let desktop_paths = state.local_store.paths().clone();
        let runtime_paths = app
            .path()
            .resource_dir()
            .map_err(|error| format!("Could not locate bundled runtime resources: {error}"))
            .and_then(|directory| RuntimePaths::discover(&directory));
        task.and_then(|task| task.ok_or_else(|| "Local task was not found".to_string()))
            .and_then(|task| settings.map(|settings| (task, settings)))
            .and_then(|(task, settings)| {
                runtime_paths.map(|runtime_paths| (task, settings, desktop_paths, runtime_paths))
            })
    };
    let (task, settings, desktop_paths, runtime_paths) = match setup {
        Ok(setup) => setup,
        Err(message) => {
            finish_task(
                &app,
                &request_id,
                TaskExecutionOutcome::Failed {
                    status: ActionStatus::Failed,
                    code: "runner_runtime_unavailable".to_string(),
                    message,
                },
            )
            .await;
            return;
        }
    };

    let deadline = Instant::now() + Duration::from_secs(u64::from(task.timeout_seconds));
    let prepared = match execution::prepare(
        task,
        settings,
        desktop_paths,
        runtime_paths,
        cancellation.clone(),
        deadline,
    )
    .await
    {
        Ok(prepared) => prepared,
        Err(outcome) => {
            finish_task(&app, &request_id, outcome).await;
            return;
        }
    };
    if cancellation.is_cancelled() {
        finish_task(
            &app,
            &request_id,
            TaskExecutionOutcome::Failed {
                status: ActionStatus::Cancelled,
                code: "execution_cancelled".to_string(),
                message: "Execution cancelled".to_string(),
            },
        )
        .await;
        return;
    }

    let state = app.state::<AppState>();
    let running_update = ActionStatusUpdate {
        status: ActionStatus::Running,
        result: None,
        error: None,
    };
    let running_service = match action_service(&state) {
        Ok(service) => service,
        Err(message) => {
            drop(state);
            finish_task(
                &app,
                &request_id,
                TaskExecutionOutcome::Failed {
                    status: ActionStatus::Failed,
                    code: "status_sync_failed".to_string(),
                    message,
                },
            )
            .await;
            return;
        }
    };
    drop(state);
    if let Err(message) = running_service
        .update_status(&request_id, running_update)
        .await
    {
        finish_task(
            &app,
            &request_id,
            TaskExecutionOutcome::Failed {
                status: ActionStatus::Failed,
                code: "status_sync_failed".to_string(),
                message,
            },
        )
        .await;
        return;
    }
    let state = app.state::<AppState>();
    let repository = TaskRepository::new(&state.local_store);
    let running = match repository.update_status(&request_id, ActionStatus::Running, now_millis()) {
        Ok(task) => task,
        Err(message) => {
            drop(state);
            finish_task(
                &app,
                &request_id,
                TaskExecutionOutcome::Failed {
                    status: ActionStatus::Interrupted,
                    code: "local_status_persist_failed".to_string(),
                    message,
                },
            )
            .await;
            return;
        }
    };
    let _ = repository.mark_server_synced(&request_id, ActionStatus::Running);
    let _ = app.emit("desktop://task-updated", running);
    drop(state);

    let log_app = app.clone();
    let on_log = Arc::new(move |event: LogEvent| {
        let stream = match event.stream {
            LogStream::Stdout => "stdout",
            LogStream::Stderr => "stderr",
        };
        let _ = log_app.emit(
            "desktop://task-log",
            serde_json::json!({
                "requestId": event.task_id,
                "stream": stream,
                "message": event.message,
                "truncated": event.truncated,
            }),
        );
    });
    let outcome = execution::run_prepared(prepared, cancellation, on_log).await;
    finish_task(&app, &request_id, outcome).await;
}

async fn finish_task(app: &AppHandle, request_id: &str, outcome: TaskExecutionOutcome) {
    let state = app.state::<AppState>();
    let service = action_service(&state).ok();
    let repository = TaskRepository::new(&state.local_store);
    let completed = match &outcome {
        TaskExecutionOutcome::Succeeded(result) => repository.complete(
            request_id,
            ActionStatus::Succeeded,
            Some(result),
            None,
            None,
            now_millis(),
        ),
        TaskExecutionOutcome::Failed {
            status,
            code,
            message,
        } => repository.complete(
            request_id,
            status.clone(),
            None,
            Some(code),
            Some(message),
            now_millis(),
        ),
    };
    let Ok(completed) = completed else {
        return;
    };
    let _ = app.emit("desktop://task-updated", completed.clone());
    let update = outcome.server_update();
    let status = update.status.clone();
    drop(state);
    if let Some(service) = service {
        if service.update_status(request_id, update).await.is_ok() {
            let state = app.state::<AppState>();
            let _ = TaskRepository::new(&state.local_store).mark_server_synced(request_id, status);
        }
    }
}

async fn transition_local_and_server(
    state: &AppState,
    request_id: &str,
    status: ActionStatus,
) -> Result<LocalTask, String> {
    let repository = TaskRepository::new(&state.local_store);
    let task = repository.update_status(request_id, status.clone(), now_millis())?;
    action_service(state)?
        .update_status(
            request_id,
            ActionStatusUpdate {
                status,
                result: None,
                error: None,
            },
        )
        .await?;
    repository.mark_server_synced(request_id, task.status.clone())?;
    Ok(task)
}

#[tauri::command]
fn set_local_task_pinned(
    state: State<'_, AppState>,
    request_id: String,
    pinned: bool,
) -> Result<LocalTask, String> {
    let repository = TaskRepository::new(&state.local_store);
    repository.set_pinned(&request_id, pinned, now_millis())?;
    repository
        .find(&request_id)?
        .ok_or_else(|| "Local task was not found".to_string())
}

#[tauri::command]
fn list_trusted_apps(state: State<'_, AppState>) -> Result<Vec<AppTrust>, String> {
    TrustRepository::new(&state.local_store).list_trusted()
}

#[tauri::command]
fn revoke_app_trust(state: State<'_, AppState>, key: TrustKeyInput) -> Result<(), String> {
    TrustRepository::new(&state.local_store).revoke(&key)?;
    Ok(())
}

fn claimed_action_from_task(task: &LocalTask) -> ClaimedAction {
    ClaimedAction {
        id: task.request_id.clone(),
        server_origin: task.server_origin.clone(),
        app_owner: task.app_owner.clone(),
        app_name: task.app_name.clone(),
        app_version: task.app_version.clone(),
        publisher_user_id: task.publisher_user_id.clone(),
        publisher_display_name: task.publisher_display_name.clone(),
        title: task.title.clone(),
        description: task.description.clone(),
        script: task.script.clone(),
        dependencies: task.dependencies.clone(),
        input: task.input.clone(),
        timeout_seconds: task.timeout_seconds,
        status: task.status.clone(),
    }
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

async fn execute_notification_click(
    config: Config,
    notification_id: Option<&str>,
    url: &str,
) -> Result<Option<platform::InboxItem>, String> {
    let actions = notification_click_plan(&config, notification_id, url)?;
    let service = InboxService::new(config);
    let mut updated = None;

    for action in actions {
        match action {
            NotificationClickAction::MarkRead(notification_id) => {
                updated = Some(service.mark_read(&notification_id).await?);
            }
            NotificationClickAction::Open(url) => {
                let url = Url::parse(&url)
                    .map_err(|_| "Could not open the notification URL".to_string())?;
                open_configured_url(url)?;
            }
        }
    }
    Ok(updated)
}

#[tauri::command]
fn open_app(state: State<'_, AppState>, app_path: String) -> Result<(), String> {
    let config = state
        .config
        .as_ref()
        .ok_or_else(|| "LocalApp is not configured".to_string())?;
    open_configured_url(configured_app_url(config, &app_path)?)
}

fn local_runtime_controller(state: &AppState) -> Result<LocalRuntimeController, String> {
    state
        .local_runtime
        .lock()
        .map_err(|_| "Local Runtime controller is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "Local Runtime resources are unavailable".to_string())
}

async fn stop_desktop_control(state: &AppState) -> Result<(), String> {
    let server = state
        .desktop_control
        .lock()
        .map_err(|_| "Desktop control server is unavailable".to_string())?
        .take();
    if let Some(server) = server {
        server.stop().await;
    }
    Ok(())
}

fn open_configured_url(url: Url) -> Result<(), String> {
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Could not open the configured LocalApp URL".to_string())
}

pub fn configured_app_url(config: &Config, page_path: &str) -> Result<Url, String> {
    if !page_path.starts_with('/') || page_path.starts_with("//") {
        return Err("App path must be a normalized absolute path".to_string());
    }
    match normalize_app_path(page_path) {
        Ok(normalized) if normalized == page_path => {}
        _ => return Err("App path must be a normalized absolute path".to_string()),
    }

    let configured = configured_server_url(config)?;
    let mut app_url = Url::parse(&configured.origin().ascii_serialization())
        .map_err(|_| "LocalApp server URL is invalid".to_string())?;
    app_url.set_path(page_path);
    Ok(app_url)
}

pub fn validate_external_url(config: &Config, candidate: &str) -> Result<Url, String> {
    let configured = configured_server_url(config)?;
    let url = Url::parse(candidate).map_err(|_| "External URL is invalid".to_string())?;

    if !matches!(url.scheme(), "http" | "https")
        || !matches!(configured.scheme(), "http" | "https")
        || url.origin() != configured.origin()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("External URL must use the configured LocalApp server".to_string());
    }

    Ok(url)
}

pub fn resolve_notification_url(config: &Config, candidate: &str) -> Result<Url, String> {
    let encoded = candidate.to_ascii_lowercase();
    if !candidate.starts_with('/')
        || candidate.starts_with("//")
        || candidate.contains('\\')
        || encoded.contains("%5c")
        || candidate.chars().any(char::is_control)
    {
        return Err("Notification URL must be a same-origin relative path".to_string());
    }

    let configured = configured_server_url(config)?;
    let origin = Url::parse(&configured.origin().ascii_serialization())
        .map_err(|_| "LocalApp server URL is invalid".to_string())?;
    let resolved = origin
        .join(candidate)
        .map_err(|_| "Notification URL is invalid".to_string())?;

    if resolved.origin() != configured.origin()
        || !resolved.username().is_empty()
        || resolved.password().is_some()
    {
        return Err("Notification URL must use the configured LocalApp server".to_string());
    }

    Ok(resolved)
}

pub(crate) fn configured_server_url(config: &Config) -> Result<Url, String> {
    let url =
        Url::parse(config.base_url()).map_err(|_| "LocalApp server URL is invalid".to_string())?;

    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(
            "LocalApp server URL must be an http(s) origin without credentials".to_string(),
        );
    }

    Ok(url)
}

pub(crate) fn public_server_url(config: &Config) -> Result<String, String> {
    Ok(configured_server_url(config)?
        .as_str()
        .trim_end_matches('/')
        .to_string())
}

#[derive(Clone, Serialize)]
struct ConnectionPayload {
    status: &'static str,
}

#[derive(Clone, Serialize)]
struct MissedPayload {
    count: u32,
}

#[derive(Clone)]
struct TauriBusObserver {
    app: AppHandle,
    config: Config,
    installation_id: String,
    notifications_enabled: Arc<AtomicBool>,
}

impl BusObserver for TauriBusObserver {
    fn connection_changed(&self, state: ConnectionState) {
        let _ = self.app.emit(
            "desktop://connection",
            ConnectionPayload {
                status: state.as_str(),
            },
        );
        if state == ConnectionState::Connected {
            reconcile_pending_actions(
                self.app.clone(),
                self.config.clone(),
                self.installation_id.clone(),
            );
        }
    }

    fn notification_received(&self, notification: NotificationPayload) {
        let _ = self
            .app
            .emit("desktop://notification", notification.clone());
        if !self.notifications_enabled.load(Ordering::Acquire) {
            return;
        }

        show_native_notification(self.app.clone(), self.config.clone(), notification);
    }

    fn notifications_missed(&self, announced_count: u32) {
        let app = self.app.clone();
        let config = self.config.clone();
        tauri::async_runtime::spawn(async move {
            let service = InboxService::new(config);
            let (page, count) = tokio::join!(service.list(None, false), service.unread_count(),);
            let reconciled_count = if page.is_ok() {
                count.unwrap_or(announced_count)
            } else {
                announced_count
            };
            let _ = app.emit(
                "desktop://missed",
                MissedPayload {
                    count: reconciled_count,
                },
            );
        });
    }

    fn action_requested(&self, _request_id: String) {
        reconcile_pending_actions(
            self.app.clone(),
            self.config.clone(),
            self.installation_id.clone(),
        );
    }
}

fn reconcile_pending_actions(app: AppHandle, config: Config, installation_id: String) {
    tauri::async_runtime::spawn(async move {
        let Ok(pending) = ActionService::new(config, installation_id)
            .list_pending()
            .await
        else {
            return;
        };
        let accepted = app
            .state::<AppState>()
            .activations
            .push_activations(pending.into_iter().map(Into::into));
        if accepted > 0 {
            show_main_window(&app);
            let _ = app.emit("desktop://action-activation", ());
        }
    });
}

fn native_notification_action(response: &NotificationResponse) -> NativeNotificationAction {
    match response {
        NotificationResponse::Default => NativeNotificationAction::Default,
        NotificationResponse::Action(action) => NativeNotificationAction::Named(action.clone()),
        NotificationResponse::Reply(reply) => NativeNotificationAction::Reply(reply.clone()),
        NotificationResponse::Closed(_) => NativeNotificationAction::Closed,
    }
}

fn show_native_notification(app: AppHandle, config: Config, notification: NotificationPayload) {
    let mut native = Notification::new();
    native
        .appname("LocalApp")
        .summary(&notification.title)
        .action("default", "Open");
    if let Some(body) = notification.body.as_deref() {
        native.body(body);
    }
    #[cfg(target_os = "windows")]
    native.app_id("com.localapp.desktop");

    let Ok(handle) = native.show() else {
        return;
    };
    let notification_id = (!notification.id.is_empty()).then_some(notification.id);
    let notification_url = notification.url;
    tauri::async_runtime::spawn(async move {
        let action = tauri::async_runtime::spawn_blocking(move || {
            let mut action = NativeNotificationAction::Closed;
            let _ = handle.wait_for_response(|response: &NotificationResponse| {
                action = native_notification_action(response);
            });
            action
        })
        .await
        .unwrap_or(NativeNotificationAction::Closed);

        if notification_activation(&action) != NotificationActivation::Activate {
            return;
        }

        show_main_window(&app);
        if let Some(url) = notification_url {
            let _ = execute_notification_click(config, notification_id.as_deref(), &url).await;
        } else if let Some(notification_id) = notification_id {
            let _ = InboxService::new(config).mark_read(&notification_id).await;
        }
    });
}

fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|_| "Could not update launch-at-login settings".to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn queue_activation_urls<I, S>(app: &AppHandle, urls: I)
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let accepted = app.state::<AppState>().activations.push_urls(urls);
    if accepted > 0 {
        show_main_window(app);
        let _ = app.emit("desktop://action-activation", ());
    }
}

fn update_pause_label(app: &AppHandle, notifications_enabled: bool) {
    if let Some(tray) = app.try_state::<TrayState>() {
        let label = if notifications_enabled {
            "Pause notifications"
        } else {
            "Resume notifications"
        };
        let _ = tray.pause_item.set_text(label);
    }
}

fn toggle_notifications(app: &AppHandle) {
    let state = app.state::<AppState>();
    let enabled = !state.notifications_enabled.load(Ordering::Acquire);
    let update = SettingsUpdate {
        launch_at_login: None,
        notifications_enabled: Some(enabled),
        npm_registry: None,
        http_proxy: None,
        https_proxy: None,
        clear_http_proxy: false,
        clear_https_proxy: false,
    };
    let updated = state
        .settings
        .lock()
        .map_err(|_| ())
        .and_then(|mut settings| {
            settings
                .update(state.config.as_ref(), update)
                .map_err(|_| ())
        });
    if updated.is_ok() {
        state
            .notifications_enabled
            .store(enabled, Ordering::Release);
        update_pause_label(app, enabled);
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let notifications_enabled = app
        .state::<AppState>()
        .notifications_enabled
        .load(Ordering::Acquire);
    let open = MenuItem::with_id(app, "tray-open", "Open", true, None::<&str>)?;
    let pause = MenuItem::with_id(
        app,
        "tray-pause",
        if notifications_enabled {
            "Pause notifications"
        } else {
            "Resume notifications"
        },
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &quit])?;
    app.manage(TrayState {
        pause_item: pause.clone(),
    });

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("LocalApp")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main_window(app),
            "tray-pause" => toggle_notifications(app),
            "tray-quit" => {
                let state = app.state::<AppState>();
                state.quitting.store(true, Ordering::Release);
                let controller = state.bus.clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    controller.stop().await;
                    let _ = stop_desktop_control(&app.state::<AppState>()).await;
                    if let Ok(runtime) = local_runtime_controller(&app.state::<AppState>()) {
                        let _ = runtime.stop().await;
                    }
                    app.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn run() {
    let state = AppState::load().expect("failed to load LocalApp desktop settings");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _| {
            queue_activation_urls(app, argv);
            show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .setup(|app| {
            setup_tray(app)?;
            if let Some(urls) = app.deep_link().get_current()? {
                queue_activation_urls(app.handle(), urls.iter().map(Url::as_str));
            }
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                queue_activation_urls(&app_handle, event.urls().iter().map(Url::as_str));
            });
            let state = app.state::<AppState>();
            state.local_apps.ensure_registry()?;
            let resource_directory = app
                .path()
                .resource_dir()
                .map_err(|error| format!("Could not locate bundled runtime resources: {error}"))?;
            if let Ok(launch) = LocalRuntimeLaunch::bundled(
                &resource_directory,
                state.local_store.paths().local_runtime_registry(),
                state.local_runtime_token.clone(),
            ) {
                let controller = LocalRuntimeController::new(launch);
                *state
                    .local_runtime
                    .lock()
                    .map_err(|_| "Local Runtime controller is unavailable")? =
                    Some(controller.clone());
                tauri::async_runtime::spawn(async move {
                    let _ = controller.start().await;
                });
            }
            let runtime = state
                .local_runtime
                .lock()
                .map_err(|_| "Local Runtime controller is unavailable")?
                .clone();
            let control = tauri::async_runtime::block_on(DesktopControlServer::start(
                state.local_apps.clone(),
                runtime,
                state.local_runtime_token.clone(),
                default_control_file(),
            ))?;
            *state
                .desktop_control
                .lock()
                .map_err(|_| "Desktop control server is unavailable")? = Some(control);
            let launch_at_login = state
                .settings
                .lock()
                .map(|settings| settings.launch_at_login())
                .unwrap_or(false);
            let _ = set_autostart(app.handle(), launch_at_login);

            if let Some(config) = state
                .config
                .clone()
                .filter(|config| !config.api_key.trim().is_empty())
            {
                let installation_id = state
                    .settings
                    .lock()
                    .map(|settings| settings.installation_id().to_string())
                    .map_err(|_| "Desktop settings are unavailable")?;
                let observer = TauriBusObserver {
                    app: app.handle().clone(),
                    config: config.clone(),
                    installation_id: installation_id.clone(),
                    notifications_enabled: Arc::clone(&state.notifications_enabled),
                };
                state.bus.start(config, installation_id, observer);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_account,
            list_inbox,
            get_unread_count,
            mark_notification_read,
            delete_notification,
            mark_all_read,
            list_favorites,
            remove_favorite,
            get_settings,
            update_settings,
            check_for_updates,
            install_update,
            clear_dependency_cache,
            logout,
            quit_app,
            disconnect_bus,
            reconnect_bus,
            open_external,
            open_notification,
            take_pending_activations,
            list_pending_actions,
            list_recoverable_actions,
            list_local_tasks,
            read_local_task_logs,
            claim_action,
            trust_and_run_task,
            reject_local_task,
            cancel_local_task,
            set_local_task_pinned,
            list_trusted_apps,
            revoke_app_trust,
            open_app,
            list_local_apps,
            get_local_runtime_status,
            install_local_app,
            uninstall_local_app,
            delete_local_app,
            open_local_app,
            list_server_profiles,
            save_server_profile,
            remove_server_profile,
            use_server_profile,
            publish_local_app
        ])
        .build(tauri::generate_context!())
        .expect("failed to build LocalApp desktop");

    app.run(|app, event| match event {
        RunEvent::ExitRequested {
            code: None, api, ..
        } if !app.state::<AppState>().quitting.load(Ordering::Acquire) => {
            api.prevent_exit();
        }
        RunEvent::Exit => {
            let state = app.state::<AppState>();
            state.bus.request_stop();
            if let Ok(control) = state.desktop_control.lock()
                && let Some(control) = control.as_ref()
            {
                control.request_stop();
            }
            if let Ok(controller) = local_runtime_controller(&state) {
                controller.request_stop();
            }
        }
        _ => {}
    });
}
