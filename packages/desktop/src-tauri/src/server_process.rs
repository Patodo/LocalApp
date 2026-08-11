use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use url::Url;

#[derive(Clone, Debug)]
pub struct ServerLaunch {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub environment: BTreeMap<String, String>,
    pub ready_timeout: Duration,
}

impl ServerLaunch {
    pub fn command(executable: PathBuf, args: Vec<String>, ready_timeout: Duration) -> Self {
        Self {
            executable,
            args,
            environment: BTreeMap::new(),
            ready_timeout,
        }
    }

    pub fn bundled(
        resource_directory: &Path,
        data_directory: PathBuf,
        control_token: String,
    ) -> Result<Self, String> {
        if !resource_directory.is_absolute() || !data_directory.is_absolute() {
            return Err("Server resources and data directory must be absolute".into());
        }
        if control_token.trim().is_empty() {
            return Err("Server control token is required".into());
        }
        let target = bundled_runtime_target();
        let node = resource_directory
            .join("node")
            .join(target)
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        let entrypoint = resource_directory.join("server/bin/localapp-server.mjs");
        if !node.is_file() {
            return Err(format!("Bundled Node.js runtime is unavailable: {}", node.display()));
        }
        if !entrypoint.is_file() {
            return Err(format!("Bundled Server is unavailable: {}", entrypoint.display()));
        }
        let mut launch = Self::command(
            node,
            vec![
                entrypoint.to_string_lossy().into_owned(),
                "start".into(),
                "--data-dir".into(),
                data_directory.to_string_lossy().into_owned(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                "0".into(),
            ],
            Duration::from_secs(20),
        );
        launch.environment.insert("LOCALAPP_DEVICE_CONTROL_TOKEN".into(), control_token);
        Ok(launch)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerReady {
    pub url: String,
    pub pid: u32,
}

#[derive(Debug)]
pub struct ServerProcess {
    launch: ServerLaunch,
    child: Child,
    ready: ServerReady,
}

#[derive(Deserialize)]
struct ReadyFrame {
    #[serde(rename = "type")]
    kind: String,
    url: String,
}

impl ServerProcess {
    pub async fn start(launch: ServerLaunch) -> Result<Self, String> {
        if launch.args.is_empty() {
            return Err("Server launch command is empty".into());
        }
        let mut command = Command::new(&launch.executable);
        command
            .args(&launch.args)
            .envs(&launch.environment)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start Server: {error}"))?;
        let pid = child.id().ok_or("Server child has no process ID")?;
        let stdout = child.stdout.take().ok_or("Server stdout is unavailable")?;
        let mut lines = BufReader::new(stdout).lines();
        let ready_frame = tokio::time::timeout(launch.ready_timeout, async {
            loop {
                let line = lines
                    .next_line()
                    .await
                    .map_err(|error| format!("Could not read Server readiness: {error}"))?
                    .ok_or("Server exited before readiness")?;
                let Ok(frame) = serde_json::from_str::<ReadyFrame>(&line) else {
                    continue;
                };
                if frame.kind == "ready" {
                    break Ok::<ReadyFrame, String>(frame);
                }
            }
        })
        .await
        .map_err(|_| "Server readiness timed out".to_string())??;
        let url = validate_ready_url(&ready_frame.url)?;
        tokio::spawn(async move { while lines.next_line().await.ok().flatten().is_some() {} });
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while lines.next_line().await.ok().flatten().is_some() {}
            });
        }
        Ok(Self {
            launch,
            child,
            ready: ServerReady { url, pid },
        })
    }

    pub async fn ready(&self) -> Result<ServerReady, String> {
        Ok(self.ready.clone())
    }

    pub fn open_home(&self) -> String {
        self.ready.url.clone()
    }

    pub fn is_running(&mut self) -> bool {
        self.child.try_wait().ok().flatten().is_none()
    }

    pub async fn restart_after_failure(&mut self) -> Result<(), String> {
        self.stop().await?;
        let replacement = Self::start(self.launch.clone()).await?;
        *self = replacement;
        Ok(())
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        if self.child.try_wait().map_err(|error| error.to_string())?.is_some() {
            return Ok(());
        }
        terminate_child(&mut self.child).await;
        Ok(())
    }
}

fn validate_ready_url(value: &str) -> Result<String, String> {
    let url = Url::parse(value).map_err(|_| "Server returned an invalid ready URL")?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "::1"))
        || url.username() != ""
        || url.password().is_some()
        || url.path() != "" && url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port().is_none()
    {
        return Err("Server returned an invalid ready URL".into());
    }
    Ok(url.origin().ascii_serialization())
}

fn bundled_runtime_target() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("windows", "x86_64") => "win-x64",
        ("linux", "x86_64") => "linux-x64",
        _ => "unsupported",
    }
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
    if tokio::time::timeout(Duration::from_secs(3), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
}
