use crate::local_app_commands::install_with_runtime;
use crate::local_apps::{InstallOutcome, LocalAppRepository};
use crate::local_runtime::LocalRuntimeController;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use localapp_core::Config;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const MAX_CONTROL_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
struct ControlState {
    repository: LocalAppRepository,
    runtime: Option<LocalRuntimeController>,
    token: Arc<str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallRequest {
    package_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlFile<'a> {
    endpoint: &'a str,
    token: &'a str,
}

#[derive(Serialize)]
struct Success<T: Serialize> {
    success: bool,
    data: T,
}

#[derive(Serialize)]
struct Failure {
    success: bool,
    error: String,
}

pub struct DesktopControlServer {
    endpoint: String,
    token: String,
    control_file: PathBuf,
    cancellation: CancellationToken,
    task: JoinHandle<()>,
}

impl DesktopControlServer {
    pub async fn start(
        repository: LocalAppRepository,
        runtime: Option<LocalRuntimeController>,
        token: String,
        control_file: PathBuf,
    ) -> Result<Self, String> {
        if token.trim().is_empty() {
            return Err("Desktop control token must not be empty".into());
        }
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|error| format!("Could not bind Desktop control server: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("Could not read Desktop control address: {error}"))?;
        let endpoint = format!("http://127.0.0.1:{}", address.port());
        write_control_file(&control_file, &endpoint, &token)?;

        let state = ControlState {
            repository,
            runtime,
            token: Arc::from(token.as_str()),
        };
        let router = Router::new()
            .route("/control/apps/install", post(install_app))
            .layer(DefaultBodyLimit::max(MAX_CONTROL_BODY_BYTES))
            .with_state(state);
        let cancellation = CancellationToken::new();
        let shutdown = cancellation.clone();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await;
        });

        Ok(Self {
            endpoint,
            token,
            control_file,
            cancellation,
            task,
        })
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn request_stop(&self) {
        self.cancellation.cancel();
        remove_own_control_file(&self.control_file, &self.endpoint, &self.token);
    }

    pub async fn stop(self) {
        self.request_stop();
        let _ = self.task.await;
    }
}

pub fn default_control_file() -> PathBuf {
    Config::config_path().with_file_name("desktop-control.json")
}

async fn install_app(
    State(state): State<ControlState>,
    headers: HeaderMap,
    Json(request): Json<InstallRequest>,
) -> Result<Json<Success<InstallOutcome>>, (StatusCode, Json<Failure>)> {
    let expected = format!("Bearer {}", state.token);
    if headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        != Some(expected.as_str())
    {
        return Err(failure(StatusCode::UNAUTHORIZED, "Unauthorized"));
    }
    if !request.package_path.is_absolute()
        || request
            .package_path
            .extension()
            .and_then(|value| value.to_str())
            != Some("localapp")
        || !request.package_path.is_file()
    {
        return Err(failure(
            StatusCode::BAD_REQUEST,
            "packagePath must reference an existing absolute .localapp file",
        ));
    }

    let outcome = install_with_runtime(state.repository, state.runtime, request.package_path)
        .await
        .map_err(|error| failure(StatusCode::UNPROCESSABLE_ENTITY, &error))?;
    Ok(Json(Success {
        success: true,
        data: outcome,
    }))
}

fn failure(status: StatusCode, message: &str) -> (StatusCode, Json<Failure>) {
    (
        status,
        Json(Failure {
            success: false,
            error: message.to_string(),
        }),
    )
}

fn write_control_file(path: &Path, endpoint: &str, token: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Desktop control path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create Desktop control directory: {error}"))?;
    let temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Could not create Desktop control file: {error}"))?;
    serde_json::to_writer(temporary.as_file(), &ControlFile { endpoint, token })
        .map_err(|error| format!("Could not serialize Desktop control file: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Could not sync Desktop control file: {error}"))?;
    set_owner_only(temporary.path())?;
    temporary
        .persist(path)
        .map_err(|error| format!("Could not publish Desktop control file: {}", error.error))?;
    Ok(())
}

fn remove_own_control_file(path: &Path, endpoint: &str, token: &str) {
    let matches = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .is_some_and(|value| {
            value["endpoint"].as_str() == Some(endpoint) && value["token"].as_str() == Some(token)
        });
    if matches {
        let _ = fs::remove_file(path);
    }
}

#[cfg(unix)]
fn set_owner_only(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Could not secure Desktop control file: {error}"))
}

#[cfg(not(unix))]
fn set_owner_only(_path: &Path) -> Result<(), String> {
    Ok(())
}
