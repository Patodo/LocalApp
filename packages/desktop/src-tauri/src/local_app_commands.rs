use crate::AppState;
use crate::local_apps::LocalAppRepository;
use crate::local_apps::{InstallOutcome, LocalApp};
use crate::local_runtime::{
    LocalRuntimeController, LocalRuntimeSnapshot, LocalRuntimeStatus, validate_localhost_resolution,
};
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;
use url::Url;

#[tauri::command]
pub(crate) async fn list_local_apps(state: State<'_, AppState>) -> Result<Vec<LocalApp>, String> {
    let mut apps = state.local_apps.list()?;
    if let Ok(controller) = crate::local_runtime_controller(&state) {
        let snapshot = controller.snapshot().await;
        for app in &mut apps {
            if let Some(runtime_app) = snapshot
                .apps
                .iter()
                .find(|candidate| candidate.app_id == app.app_id)
            {
                app.status = runtime_app.status;
                app.error.clone_from(&runtime_app.error);
            }
        }
    }
    Ok(apps)
}

#[tauri::command]
pub(crate) async fn get_local_runtime_status(
    state: State<'_, AppState>,
) -> Result<LocalRuntimeSnapshot, String> {
    let controller = crate::local_runtime_controller(&state)?;
    Ok(controller.snapshot().await)
}

#[tauri::command]
pub(crate) async fn install_local_app(
    state: State<'_, AppState>,
    package_path: PathBuf,
) -> Result<InstallOutcome, String> {
    let controller = crate::local_runtime_controller(&state)?;
    install_with_runtime(state.local_apps.clone(), Some(controller), package_path).await
}

#[tauri::command]
pub(crate) async fn uninstall_local_app(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    let repository = state.local_apps.clone();
    let controller = crate::local_runtime_controller(&state)?;
    controller
        .with_quiesced_runtime(move || async move {
            tauri::async_runtime::spawn_blocking(move || repository.uninstall(&app_id))
                .await
                .map_err(|error| format!("Local application uninstall failed: {error}"))?
        })
        .await
}

#[tauri::command]
pub(crate) async fn delete_local_app(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    let repository = state.local_apps.clone();
    let controller = crate::local_runtime_controller(&state)?;
    controller
        .with_quiesced_runtime(move || async move {
            tauri::async_runtime::spawn_blocking(move || repository.delete_permanently(&app_id))
                .await
                .map_err(|error| format!("Local application deletion failed: {error}"))?
        })
        .await
}

#[tauri::command]
pub(crate) async fn open_local_app(
    state: State<'_, AppState>,
    app_id: String,
) -> Result<(), String> {
    if !state
        .local_apps
        .list()?
        .iter()
        .any(|app| app.app_id == app_id)
    {
        return Err(format!("Local application not found: {app_id}"));
    }
    validate_localhost_resolution(&app_id)?;
    let controller = crate::local_runtime_controller(&state)?;
    let access_controller = controller.clone();
    let control_token = state.local_runtime_token.clone();
    let url = controller
        .with_runtime_access(move || async move {
            let snapshot = access_controller.snapshot().await;
            let ready = if snapshot.status == LocalRuntimeStatus::Running {
                snapshot.ready
            } else {
                Some(access_controller.start().await?)
            }
            .ok_or_else(|| "Local Runtime did not report a ready address".to_string())?;
            access_controller.check_app_health(&app_id).await?;
            let endpoint = format!("http://127.0.0.1:{}/control/tickets", ready.port);
            let response = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|error| format!("Could not create Local Runtime client: {error}"))?
                .post(endpoint)
                .header(
                    reqwest::header::HOST,
                    format!("control.localhost:{}", ready.port),
                )
                .bearer_auth(control_token)
                .json(&serde_json::json!({ "appId": app_id }))
                .send()
                .await
                .map_err(|_| "Local Runtime is unavailable".to_string())?;
            let status = response.status();
            let body: serde_json::Value = response
                .json()
                .await
                .map_err(|error| format!("Local Runtime returned an invalid response: {error}"))?;
            if !status.is_success() || body["success"].as_bool() != Some(true) {
                return Err(body["error"]
                    .as_str()
                    .unwrap_or("Local Runtime rejected the application")
                    .to_string());
            }
            let raw_url = body["data"]["url"]
                .as_str()
                .ok_or_else(|| "Local Runtime did not return an application URL".to_string())?;
            validate_local_app_url(raw_url, &app_id, ready.port)
        })
        .await?;
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
        .map_err(|_| "Could not open the local application".to_string())
}

fn validate_local_app_url(raw_url: &str, app_id: &str, port: u16) -> Result<Url, String> {
    let url = Url::parse(raw_url)
        .map_err(|_| "Local Runtime returned an invalid application URL".to_string())?;
    if url.scheme() != "http"
        || url.host_str() != Some(&format!("{app_id}.localhost"))
        || url.port() != Some(port)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Local Runtime returned an unsafe application URL".into());
    }
    Ok(url)
}

pub(crate) async fn install_with_runtime(
    repository: LocalAppRepository,
    runtime: Option<LocalRuntimeController>,
    package_path: PathBuf,
) -> Result<InstallOutcome, String> {
    let Some(runtime) = runtime else {
        return Err(
            "Local Runtime is unavailable; the application cannot be installed safely".into(),
        );
    };
    let maintenance_runtime = runtime.clone();
    runtime
        .with_quiesced_runtime(move || async move {
            let health_runtime = maintenance_runtime.clone();
            let handle = tokio::runtime::Handle::current();
            tauri::async_runtime::spawn_blocking(move || {
                repository.install_with_health(&package_path, |candidate| {
                    handle.block_on(async {
                        health_runtime.start().await?;
                        let health_result = health_runtime
                            .check_app_health(&candidate.app_id)
                            .await
                            .map(|_| ());
                        let stop_result = health_runtime.stop().await;
                        match (health_result, stop_result) {
                            (Ok(()), Ok(())) => Ok(()),
                            (Err(error), Ok(())) => Err(error),
                            (Ok(()), Err(stop_error)) => Err(format!(
                                "Local Runtime health check passed but it could not be stopped before commit: {stop_error}"
                            )),
                            (Err(error), Err(stop_error)) => Err(format!(
                                "{error}; failed to stop unhealthy Local Runtime: {stop_error}"
                            )),
                        }
                    })
                })
            })
            .await
            .map_err(|error| format!("Local application installer failed: {error}"))?
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_application_urls_are_bound_to_the_expected_app_and_port() {
        assert!(
            validate_local_app_url("http://notes.localhost:3210/?ticket=one", "notes", 3210)
                .is_ok()
        );
        for candidate in [
            "https://notes.localhost:3210/",
            "http://other.localhost:3210/",
            "http://notes.localhost:3211/",
            "http://user@notes.localhost:3210/",
        ] {
            assert!(validate_local_app_url(candidate, "notes", 3210).is_err());
        }
    }
}
