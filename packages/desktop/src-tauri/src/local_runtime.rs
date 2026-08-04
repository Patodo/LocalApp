use serde::{Deserialize, Serialize};
use std::future::Future;
use std::net::{SocketAddr, ToSocketAddrs};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct LocalRuntimeController {
    launch: LocalRuntimeLaunch,
    state: Arc<Mutex<ControllerState>>,
    maintenance: Arc<Mutex<()>>,
}

#[derive(Clone)]
pub struct LocalRuntimeLaunch {
    pub node: PathBuf,
    pub script: PathBuf,
    pub registry: PathBuf,
    pub control_token: String,
    pub port: u16,
    pub ready_timeout: Duration,
    pub restart_delay: Duration,
    pub restart_limit: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRuntimeReady {
    pub host: String,
    pub port: u16,
    pub pid: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalRuntimeStatus {
    Stopped,
    Starting,
    Running,
    Restarting,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRuntimeSnapshot {
    pub status: LocalRuntimeStatus,
    pub ready: Option<LocalRuntimeReady>,
    pub restart_count: u32,
    pub error: Option<String>,
    pub apps: Vec<LocalAppRuntimeStatus>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAppRuntimeStatus {
    pub app_id: String,
    pub status: LocalAppHealthStatus,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalAppHealthStatus {
    Ready,
    Unavailable,
    Error,
}

struct ControllerState {
    snapshot: LocalRuntimeSnapshot,
    cancellation: Option<CancellationToken>,
}

#[derive(Deserialize)]
struct ReadyFrame {
    #[serde(rename = "type")]
    kind: String,
    host: String,
    port: u16,
    pid: u32,
}

#[derive(Deserialize)]
struct AppStatusResponse {
    data: AppStatusData,
}

#[derive(Deserialize)]
struct AppStatusData {
    apps: Vec<LocalAppRuntimeStatus>,
}

#[derive(Deserialize)]
struct AppHealthResponse {
    data: LocalAppRuntimeStatus,
}

impl LocalRuntimeController {
    pub fn new(launch: LocalRuntimeLaunch) -> Self {
        Self {
            launch,
            state: Arc::new(Mutex::new(ControllerState {
                snapshot: LocalRuntimeSnapshot {
                    status: LocalRuntimeStatus::Stopped,
                    ready: None,
                    restart_count: 0,
                    error: None,
                    apps: Vec::new(),
                },
                cancellation: None,
            })),
            maintenance: Arc::new(Mutex::new(())),
        }
    }

    pub async fn start(&self) -> Result<LocalRuntimeReady, String> {
        let cancellation = {
            let mut state = self.state.lock().await;
            if matches!(
                state.snapshot.status,
                LocalRuntimeStatus::Starting
                    | LocalRuntimeStatus::Running
                    | LocalRuntimeStatus::Restarting
            ) {
                return state
                    .snapshot
                    .ready
                    .clone()
                    .ok_or_else(|| "Local Runtime is already starting".to_string());
            }
            let cancellation = CancellationToken::new();
            state.snapshot = LocalRuntimeSnapshot {
                status: LocalRuntimeStatus::Starting,
                ready: None,
                restart_count: 0,
                error: None,
                apps: Vec::new(),
            };
            state.cancellation = Some(cancellation.clone());
            cancellation
        };

        let (child, ready) = match launch_child(&self.launch).await {
            Ok(process) => process,
            Err(error) => {
                let mut state = self.state.lock().await;
                state.snapshot.status = LocalRuntimeStatus::Failed;
                state.snapshot.error = Some(error.clone());
                state.cancellation = None;
                return Err(error);
            }
        };
        {
            let mut state = self.state.lock().await;
            state.snapshot.status = LocalRuntimeStatus::Running;
            state.snapshot.ready = Some(ready.clone());
        }
        let launch = self.launch.clone();
        let state = Arc::clone(&self.state);
        tokio::spawn(async move {
            supervise(launch, state, cancellation, child).await;
        });
        Ok(ready)
    }

    pub async fn stop(&self) -> Result<(), String> {
        let cancellation = {
            let mut state = self.state.lock().await;
            if state.snapshot.status == LocalRuntimeStatus::Stopped {
                return Ok(());
            }
            if state.cancellation.is_none() {
                state.snapshot.status = LocalRuntimeStatus::Stopped;
                state.snapshot.ready = None;
                state.snapshot.apps.clear();
                return Ok(());
            }
            state.cancellation.clone()
        };
        if let Some(cancellation) = cancellation {
            cancellation.cancel();
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            if self.state.lock().await.snapshot.status == LocalRuntimeStatus::Stopped {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err("Timed out stopping Local Runtime".into());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    pub fn request_stop(&self) {
        if let Ok(state) = self.state.try_lock()
            && let Some(cancellation) = &state.cancellation
        {
            cancellation.cancel();
        }
    }

    pub async fn snapshot(&self) -> LocalRuntimeSnapshot {
        let snapshot = self.state.lock().await.snapshot.clone();
        if snapshot.status == LocalRuntimeStatus::Running
            && let Ok(apps) = self.fetch_app_statuses().await
        {
            let mut state = self.state.lock().await;
            state.snapshot.apps = apps;
            return state.snapshot.clone();
        }
        snapshot
    }

    pub async fn with_quiesced_runtime<F, Fut, T>(&self, operation: F) -> Result<T, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let _maintenance = self.maintenance.lock().await;
        let should_resume = matches!(
            self.state.lock().await.snapshot.status,
            LocalRuntimeStatus::Starting
                | LocalRuntimeStatus::Running
                | LocalRuntimeStatus::Restarting
        );
        self.stop().await?;
        let result = operation().await;
        let resume_result = if should_resume {
            self.start().await.map(|_| ())
        } else {
            self.stop().await
        };
        match (result, resume_result) {
            (Ok(value), Ok(())) => Ok(value),
            (Err(error), Ok(())) => Err(error),
            (Ok(_), Err(resume_error)) => Err(resume_error),
            (Err(error), Err(resume_error)) => Err(format!(
                "{error}; additionally failed to restore Local Runtime: {resume_error}"
            )),
        }
    }

    pub async fn with_runtime_access<F, Fut, T>(&self, operation: F) -> Result<T, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let _maintenance = self.maintenance.lock().await;
        operation().await
    }

    pub async fn check_app_health(&self, app_id: &str) -> Result<LocalAppRuntimeStatus, String> {
        let ready = self
            .state
            .lock()
            .await
            .snapshot
            .ready
            .clone()
            .ok_or_else(|| "Local Runtime did not report a ready address".to_string())?;
        let response = self
            .control_client()?
            .post(format!(
                "http://127.0.0.1:{}/control/apps/{app_id}/health",
                ready.port
            ))
            .header(
                reqwest::header::HOST,
                format!("control.localhost:{}", ready.port),
            )
            .bearer_auth(&self.launch.control_token)
            .send()
            .await
            .map_err(|error| format!("Local Runtime health check failed: {error}"))?;
        let status = response.status();
        let body: AppHealthResponse = response
            .json()
            .await
            .map_err(|error| format!("Local Runtime returned invalid app health: {error}"))?;
        if !status.is_success() || body.data.status != LocalAppHealthStatus::Ready {
            return Err(body
                .data
                .error
                .unwrap_or_else(|| format!("Local application {app_id} is unavailable")));
        }
        Ok(body.data)
    }

    async fn fetch_app_statuses(&self) -> Result<Vec<LocalAppRuntimeStatus>, String> {
        let ready = self
            .state
            .lock()
            .await
            .snapshot
            .ready
            .clone()
            .ok_or_else(|| "Local Runtime did not report a ready address".to_string())?;
        let response = self
            .control_client()?
            .get(format!("http://127.0.0.1:{}/control/apps", ready.port))
            .header(
                reqwest::header::HOST,
                format!("control.localhost:{}", ready.port),
            )
            .bearer_auth(&self.launch.control_token)
            .send()
            .await
            .map_err(|error| format!("Could not read Local Runtime app states: {error}"))?;
        if !response.status().is_success() {
            return Err("Local Runtime rejected the app status request".into());
        }
        response
            .json::<AppStatusResponse>()
            .await
            .map(|body| body.data.apps)
            .map_err(|error| format!("Local Runtime returned invalid app states: {error}"))
    }

    fn control_client(&self) -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("Could not create Local Runtime client: {error}"))
    }
}

impl LocalRuntimeLaunch {
    pub fn bundled(
        resource_directory: &std::path::Path,
        registry: PathBuf,
        control_token: String,
    ) -> Result<Self, String> {
        if !resource_directory.is_absolute() {
            return Err("Desktop runtime resource directory must be absolute".into());
        }
        let node = resource_directory.join(if cfg!(windows) { "node.exe" } else { "node" });
        let script = resource_directory.join("local-runtime/localapp-local-runtime.mjs");
        for (label, path) in [("Node.js", &node), ("Local Runtime", &script)] {
            if !path.is_file() {
                return Err(format!(
                    "Bundled {label} is unavailable: {}",
                    path.display()
                ));
            }
        }
        Ok(Self {
            node,
            script,
            registry,
            control_token,
            port: 0,
            ready_timeout: Duration::from_secs(10),
            restart_delay: Duration::from_millis(500),
            restart_limit: 3,
        })
    }
}

async fn supervise(
    launch: LocalRuntimeLaunch,
    state: Arc<Mutex<ControllerState>>,
    cancellation: CancellationToken,
    mut child: Child,
) {
    loop {
        let outcome = tokio::select! {
            _ = cancellation.cancelled() => {
                terminate_child(&mut child).await;
                let mut state = state.lock().await;
                state.snapshot.status = LocalRuntimeStatus::Stopped;
                state.snapshot.ready = None;
                state.snapshot.error = None;
                state.cancellation = None;
                return;
            }
            status = child.wait() => status,
        };
        if cancellation.is_cancelled() {
            let mut state = state.lock().await;
            state.snapshot.status = LocalRuntimeStatus::Stopped;
            state.snapshot.ready = None;
            state.snapshot.error = None;
            state.cancellation = None;
            return;
        }

        let (restart_count, error) = {
            let mut state = state.lock().await;
            if state.snapshot.restart_count >= launch.restart_limit {
                state.snapshot.status = LocalRuntimeStatus::Failed;
                state.snapshot.ready = None;
                state.snapshot.error = Some(format!(
                    "Local Runtime restart limit reached after {} attempts",
                    state.snapshot.restart_count
                ));
                state.cancellation = None;
                return;
            }
            state.snapshot.restart_count += 1;
            state.snapshot.status = LocalRuntimeStatus::Restarting;
            state.snapshot.ready = None;
            (
                state.snapshot.restart_count,
                outcome
                    .map(|status| format!("Local Runtime exited with {status}"))
                    .unwrap_or_else(|error| format!("Local Runtime wait failed: {error}")),
            )
        };
        let delay = launch.restart_delay.saturating_mul(restart_count);
        tokio::select! {
            _ = cancellation.cancelled() => {
                let mut state = state.lock().await;
                state.snapshot.status = LocalRuntimeStatus::Stopped;
                state.snapshot.error = None;
                state.cancellation = None;
                return;
            }
            _ = tokio::time::sleep(delay) => {}
        }
        match launch_child(&launch).await {
            Ok((next_child, ready)) => {
                child = next_child;
                let mut state = state.lock().await;
                state.snapshot.status = LocalRuntimeStatus::Running;
                state.snapshot.ready = Some(ready);
                state.snapshot.error = Some(error);
            }
            Err(launch_error) => {
                let mut state = state.lock().await;
                state.snapshot.status = LocalRuntimeStatus::Failed;
                state.snapshot.error = Some(launch_error);
                state.cancellation = None;
                return;
            }
        }
    }
}

async fn launch_child(launch: &LocalRuntimeLaunch) -> Result<(Child, LocalRuntimeReady), String> {
    if launch.control_token.trim().is_empty() {
        return Err("Local Runtime control token is required".into());
    }
    validate_localhost_resolution("localapp-probe")?;
    let mut command = Command::new(&launch.node);
    command
        .arg(&launch.script)
        .env("LOCALAPP_LOCAL_REGISTRY", &launch.registry)
        .env("LOCALAPP_LOCAL_CONTROL_TOKEN", &launch.control_token)
        .env("LOCALAPP_LOCAL_PORT", launch.port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Local Runtime: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Local Runtime stdout is unavailable".to_string())?;
    let mut lines = BufReader::new(stdout).lines();
    let line = tokio::time::timeout(launch.ready_timeout, lines.next_line())
        .await
        .map_err(|_| "Local Runtime ready timeout".to_string())?
        .map_err(|error| format!("Could not read Local Runtime ready frame: {error}"))?
        .ok_or_else(|| "Local Runtime exited before ready".to_string())?;
    let frame: ReadyFrame = serde_json::from_str(&line)
        .map_err(|error| format!("Invalid Local Runtime ready frame: {error}"))?;
    if frame.kind != "ready" || frame.host != "127.0.0.1" || frame.port == 0 {
        let _ = child.kill().await;
        return Err("Local Runtime returned an invalid ready frame".into());
    }
    if child.id() != Some(frame.pid) {
        let _ = child.kill().await;
        return Err("Local Runtime ready PID does not match the child process".into());
    }
    tokio::spawn(async move { while let Ok(Some(_)) = lines.next_line().await {} });
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });
    }
    Ok((
        child,
        LocalRuntimeReady {
            host: frame.host,
            port: frame.port,
            pid: frame.pid,
        },
    ))
}

pub fn validate_localhost_resolution(app_id: &str) -> Result<(), String> {
    validate_localhost_resolution_with(app_id, |hostname| {
        (hostname, 0)
            .to_socket_addrs()
            .map(|addresses| addresses.collect())
            .map_err(|error| error.to_string())
    })
}

pub fn validate_localhost_resolution_with(
    app_id: &str,
    resolver: impl FnOnce(&str) -> Result<Vec<SocketAddr>, String>,
) -> Result<(), String> {
    let hostname = format!("{app_id}.localhost");
    let Ok(addresses) = resolver(&hostname) else {
        return Ok(());
    };
    if addresses.iter().any(|address| !address.ip().is_loopback()) {
        return Err(format!(
            "Local application hostname {hostname} resolved to a non-loopback address. \
Remove the DNS, VPN, or hosts-file override before opening this application."
        ));
    }
    Ok(())
}

async fn terminate_child(child: &mut Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = child.start_kill();
    }
    if tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
}
