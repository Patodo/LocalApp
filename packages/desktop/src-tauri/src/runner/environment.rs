use fs2::FileExt;
use percent_encoding::percent_decode_str;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::env;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;

pub const NODE_MAJOR: u8 = 24;
const INSTALL_POLL_INTERVAL: Duration = Duration::from_millis(20);
const INSTALL_CANCELLED_MESSAGE: &str = "Dependency installation cancelled";
const INSTALL_TIMED_OUT_MESSAGE: &str = "Dependency installation timed out";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentDescriptor {
    pub node_major: u8,
    pub registry: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_identity: Option<String>,
    pub dependencies: BTreeMap<String, String>,
}

#[derive(Debug)]
pub struct EnvironmentError(String);

impl EnvironmentError {
    fn cancelled() -> Self {
        Self(INSTALL_CANCELLED_MESSAGE.into())
    }

    fn timed_out() -> Self {
        Self(INSTALL_TIMED_OUT_MESSAGE.into())
    }

    pub fn is_cancelled(&self) -> bool {
        self.0 == INSTALL_CANCELLED_MESSAGE
    }

    pub fn is_timed_out(&self) -> bool {
        self.0 == INSTALL_TIMED_OUT_MESSAGE
    }
}

impl fmt::Display for EnvironmentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for EnvironmentError {}

impl From<std::io::Error> for EnvironmentError {
    fn from(_: std::io::Error) -> Self {
        Self("Dependency environment filesystem operation failed".into())
    }
}

#[derive(Clone)]
pub struct CommandPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub install_directory: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub clear_environment: bool,
}

impl fmt::Debug for CommandPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let environment = self
            .environment
            .keys()
            .map(|key| (key, "[REDACTED]"))
            .collect::<BTreeMap<_, _>>();
        formatter
            .debug_struct("CommandPlan")
            .field("program", &self.program)
            .field("args", &self.args)
            .field("install_directory", &self.install_directory)
            .field("clear_environment", &self.clear_environment)
            .field("environment", &environment)
            .finish()
    }
}

pub struct InstallOutput {
    success: bool,
    stderr: String,
}

impl InstallOutput {
    pub fn success(_stdout: &str, stderr: &str) -> Self {
        Self {
            success: true,
            stderr: stderr.into(),
        }
    }

    pub fn failure(_stdout: &str, stderr: &str) -> Self {
        Self {
            success: false,
            stderr: stderr.into(),
        }
    }
}

pub trait Installer: Send + Sync {
    fn check_interruption(&self) -> Result<(), EnvironmentError> {
        Ok(())
    }

    fn install(
        &self,
        plan: &CommandPlan,
        log: &mut InstallLogger,
    ) -> Result<InstallOutput, EnvironmentError>;
}

#[derive(Clone)]
pub struct InstallControl {
    cancellation: CancellationToken,
    deadline: Instant,
}

impl InstallControl {
    pub fn new(cancellation: CancellationToken, deadline: Instant) -> Self {
        Self {
            cancellation,
            deadline,
        }
    }

    fn interruption(&self) -> Option<InstallInterruption> {
        if self.cancellation.is_cancelled() {
            Some(InstallInterruption::Cancelled)
        } else if Instant::now() >= self.deadline {
            Some(InstallInterruption::TimedOut)
        } else {
            None
        }
    }
}

#[derive(Copy, Clone)]
enum InstallInterruption {
    Cancelled,
    TimedOut,
}

impl InstallInterruption {
    fn error(self) -> EnvironmentError {
        match self {
            Self::Cancelled => EnvironmentError::cancelled(),
            Self::TimedOut => EnvironmentError::timed_out(),
        }
    }
}

pub struct CommandInstaller;

pub struct ControlledCommandInstaller {
    control: InstallControl,
}

impl CommandInstaller {
    pub fn with_control(control: InstallControl) -> ControlledCommandInstaller {
        ControlledCommandInstaller { control }
    }
}

impl Installer for CommandInstaller {
    fn install(
        &self,
        plan: &CommandPlan,
        log: &mut InstallLogger,
    ) -> Result<InstallOutput, EnvironmentError> {
        install_command(plan, log, None)
    }
}

impl Installer for ControlledCommandInstaller {
    fn check_interruption(&self) -> Result<(), EnvironmentError> {
        match self.control.interruption() {
            Some(interruption) => Err(interruption.error()),
            None => Ok(()),
        }
    }

    fn install(
        &self,
        plan: &CommandPlan,
        log: &mut InstallLogger,
    ) -> Result<InstallOutput, EnvironmentError> {
        install_command(plan, log, Some(&self.control))
    }
}

fn install_command(
    plan: &CommandPlan,
    log: &mut InstallLogger,
    control: Option<&InstallControl>,
) -> Result<InstallOutput, EnvironmentError> {
    if let Some(interruption) = control.and_then(InstallControl::interruption) {
        return Err(interruption.error());
    }

    let mut command = Command::new(&plan.program);
    command
        .args(&plan.args)
        .current_dir(&plan.install_directory)
        .env_clear()
        .envs(&plan.environment)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_npm_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| EnvironmentError("Could not start bundled npm".into()))?;
    let process_tree = match NpmProcessTree::attach(&child) {
        Ok(process_tree) => process_tree,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(EnvironmentError(
                "Could not supervise bundled npm process tree".into(),
            ));
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_and_reap(&process_tree, &mut child);
            return Err(EnvironmentError(
                "Could not capture bundled npm stdout".into(),
            ));
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_and_reap(&process_tree, &mut child);
            return Err(EnvironmentError(
                "Could not capture bundled npm stderr".into(),
            ));
        }
    };
    let (sender, receiver) = mpsc::channel();
    let stdout_reader = stream_pipe(stdout, StreamKind::Stdout, sender.clone());
    let stderr_reader = stream_pipe(stderr, StreamKind::Stderr, sender);
    let mut stderr_summary = Vec::new();
    let mut status = None;
    let mut terminal_error = None;

    loop {
        if let Some(interruption) = control.and_then(InstallControl::interruption) {
            terminal_error = Some(interruption.error());
            terminate_and_reap(&process_tree, &mut child);
            break;
        }

        if status.is_none() {
            match child.try_wait() {
                Ok(Some(exit_status)) => {
                    status = Some(exit_status);
                    process_tree.terminate();
                }
                Ok(None) => {}
                Err(_) => {
                    terminal_error = Some(EnvironmentError(
                        "Could not inspect bundled npm status".into(),
                    ));
                    terminate_and_reap(&process_tree, &mut child);
                    break;
                }
            }
        }

        match receiver.recv_timeout(INSTALL_POLL_INTERVAL) {
            Ok((kind, chunk)) => {
                if let Err(error) = record_install_chunk(log, kind, &chunk, &mut stderr_summary) {
                    terminal_error = Some(error);
                    terminate_and_reap(&process_tree, &mut child);
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    if status.is_none() && terminal_error.is_none() {
        status = child
            .try_wait()
            .map_err(|_| EnvironmentError("Could not inspect bundled npm status".into()))?;
    }
    if status.is_none() {
        terminate_and_reap(&process_tree, &mut child);
    }
    let stdout_result = join_stream_reader(stdout_reader, "stdout");
    let stderr_result = join_stream_reader(stderr_reader, "stderr");
    if let Some(error) = terminal_error {
        return Err(error);
    }
    stdout_result?;
    stderr_result?;
    let status = match status {
        Some(status) => status,
        None => child
            .wait()
            .map_err(|_| EnvironmentError("Could not wait for bundled npm".into()))?,
    };
    Ok(InstallOutput {
        success: status.success(),
        stderr: String::from_utf8_lossy(&stderr_summary).into_owned(),
    })
}

fn record_install_chunk(
    log: &mut InstallLogger,
    kind: StreamKind,
    chunk: &[u8],
    stderr_summary: &mut Vec<u8>,
) -> Result<(), EnvironmentError> {
    match kind {
        StreamKind::Stdout => log.write_stdout(chunk),
        StreamKind::Stderr => {
            if stderr_summary.len() < 8_192 {
                let remaining = 8_192 - stderr_summary.len();
                stderr_summary.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            }
            log.write_stderr(chunk)
        }
    }
}

fn join_stream_reader(
    reader: thread::JoinHandle<Result<(), EnvironmentError>>,
    stream: &str,
) -> Result<(), EnvironmentError> {
    reader
        .join()
        .map_err(|_| EnvironmentError(format!("Could not read bundled npm {stream}")))?
}

#[cfg(unix)]
fn configure_npm_process(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_npm_process(_command: &mut Command) {}

#[cfg(unix)]
struct NpmProcessTree {
    process_group_id: i32,
}

#[cfg(unix)]
impl NpmProcessTree {
    fn attach(child: &std::process::Child) -> std::io::Result<Self> {
        Ok(Self {
            process_group_id: child.id() as i32,
        })
    }

    fn terminate(&self) {
        unsafe {
            libc::kill(-self.process_group_id, libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
struct NpmProcessTree {
    job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl NpmProcessTree {
    fn attach(child: &std::process::Child) -> std::io::Result<Self> {
        use std::mem::{size_of, zeroed};
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };

        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(information).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        let process = child.as_raw_handle().cast();
        let assigned = configured != 0 && unsafe { AssignProcessToJobObject(job, process) } != 0;
        if !assigned {
            let error = std::io::Error::last_os_error();
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(job);
            }
            return Err(error);
        }
        Ok(Self { job })
    }

    fn terminate(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for NpmProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(not(any(unix, windows)))]
struct NpmProcessTree;

#[cfg(not(any(unix, windows)))]
impl NpmProcessTree {
    fn attach(_child: &std::process::Child) -> std::io::Result<Self> {
        Ok(Self)
    }

    fn terminate(&self) {}
}

fn terminate_and_reap(process_tree: &NpmProcessTree, child: &mut std::process::Child) {
    process_tree.terminate();
    let _ = child.wait();
}

#[cfg(windows)]
pub fn assert_windows_job_object_support() {
    use windows_sys::Win32::System::JobObjects::{
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JobObjectExtendedLimitInformation,
    };
    let _ = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let _ = JobObjectExtendedLimitInformation;
}

#[derive(Copy, Clone)]
enum StreamKind {
    Stdout,
    Stderr,
}

fn stream_pipe(
    mut pipe: impl Read + Send + 'static,
    kind: StreamKind,
    sender: mpsc::Sender<(StreamKind, Vec<u8>)>,
) -> thread::JoinHandle<Result<(), EnvironmentError>> {
    thread::spawn(move || {
        let mut buffer = [0; 8_192];
        loop {
            let count = pipe.read(&mut buffer)?;
            if count == 0 {
                return Ok(());
            }
            if sender.send((kind, buffer[..count].to_vec())).is_err() {
                return Ok(());
            }
        }
    })
}

#[derive(Clone)]
pub struct EnvironmentRepository {
    root: PathBuf,
    node_path: PathBuf,
    npm_cli_path: PathBuf,
}

#[derive(Debug, Eq, PartialEq)]
pub struct PreparedEnvironment {
    pub key: String,
    pub path: PathBuf,
    pub reused: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyMarker {
    key: String,
    descriptor: EnvironmentDescriptor,
    tree_digest: String,
}

#[derive(Deserialize)]
struct InstalledPackage {
    name: String,
    version: String,
}

impl EnvironmentRepository {
    pub fn new(
        root: impl AsRef<Path>,
        node_path: PathBuf,
        npm_cli_path: PathBuf,
    ) -> Result<Self, EnvironmentError> {
        if !node_path.is_absolute() || !npm_cli_path.is_absolute() {
            return Err(EnvironmentError(
                "Bundled Node and npm CLI paths must be absolute".into(),
            ));
        }
        Ok(Self {
            root: root.as_ref().to_path_buf(),
            node_path,
            npm_cli_path,
        })
    }

    pub fn prepare(
        &self,
        descriptor: &EnvironmentDescriptor,
        proxy: Option<&str>,
        installer: &dyn Installer,
    ) -> Result<PreparedEnvironment, EnvironmentError> {
        descriptor.validate()?;
        validate_proxy(descriptor, proxy)?;
        fs::create_dir_all(self.root.join(".locks"))?;
        let key = descriptor.key();
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(self.root.join(".locks").join(format!("{key}.lock")))?;
        loop {
            installer.check_interruption()?;
            match FileExt::try_lock_exclusive(&lock) {
                Ok(()) => break,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(INSTALL_POLL_INTERVAL);
                }
                Err(_) => {
                    return Err(EnvironmentError(
                        "Could not lock dependency environment".into(),
                    ));
                }
            }
        }

        let final_directory = self.root.join(&key);
        if ready_environment_is_valid(&final_directory, descriptor, &key) {
            return Ok(PreparedEnvironment {
                key,
                path: final_directory,
                reused: true,
            });
        }
        if final_directory.exists() {
            archive_nonready(&self.root, &final_directory, &key)?;
        }

        let staging = self.root.join(format!(".staging-{key}-{}", Uuid::new_v4()));
        fs::create_dir_all(&staging)?;
        sync_directory(&self.root)?;
        write_root_package_json(&staging)?;
        write_isolated_npm_config(&staging)?;
        let redactor = Redactor::new(proxy);
        let plan = self.command_plan(descriptor, proxy, staging.clone())?;
        let mut log = InstallLogger::new(&staging.join("install.log"), redactor)?;
        let output = match installer.install(&plan, &mut log) {
            Ok(output) => output,
            Err(error) => {
                let cancelled = error.is_cancelled();
                let timed_out = error.is_timed_out();
                let detail = log.redact(&error.to_string());
                log.write_stderr(detail.as_bytes())?;
                finish_failed_install(log, &staging)?;
                if cancelled {
                    return Err(EnvironmentError::cancelled());
                }
                if timed_out {
                    return Err(EnvironmentError::timed_out());
                }
                return Err(EnvironmentError(format!(
                    "Dependency installation failed: {detail}"
                )));
            }
        };
        let detail = log.redact(output.stderr.trim());
        if !output.success {
            finish_failed_install(log, &staging)?;
            return Err(EnvironmentError(if detail.is_empty() {
                "Dependency installation failed".into()
            } else {
                format!("Dependency installation failed: {detail}")
            }));
        }
        log.finish()?;
        fs::create_dir_all(staging.join("node_modules"))?;
        verify_direct_dependencies(&staging, descriptor)?;
        let tree_digest = dependency_tree_digest(&staging)?;
        write_ready_marker(&staging, descriptor, &key, &tree_digest)?;
        sync_tree(&staging)?;
        fs::rename(&staging, &final_directory)?;
        sync_directory(&self.root)?;
        Ok(PreparedEnvironment {
            key,
            path: final_directory,
            reused: false,
        })
    }

    fn command_plan(
        &self,
        descriptor: &EnvironmentDescriptor,
        proxy: Option<&str>,
        install_directory: PathBuf,
    ) -> Result<CommandPlan, EnvironmentError> {
        let npm_cli = self
            .npm_cli_path
            .to_str()
            .ok_or_else(|| EnvironmentError("Bundled npm CLI path is invalid".into()))?;
        let mut args = vec![
            npm_cli.into(),
            "install".into(),
            "--ignore-scripts".into(),
            "--no-audit".into(),
            "--no-fund".into(),
            "--save-exact".into(),
            "--package-lock=false".into(),
            format!("--registry={}", descriptor.registry),
        ];
        args.extend(
            descriptor
                .dependencies
                .iter()
                .map(|(name, version)| format!("{name}@{version}")),
        );
        let mut environment = allowed_parent_environment();
        environment.insert("NPM_CONFIG_REGISTRY".into(), descriptor.registry.clone());
        environment.insert(
            "NPM_CONFIG_USERCONFIG".into(),
            install_directory
                .join(".npmrc")
                .to_string_lossy()
                .into_owned(),
        );
        environment.insert(
            "NPM_CONFIG_GLOBALCONFIG".into(),
            install_directory
                .join(".npmrc-global")
                .to_string_lossy()
                .into_owned(),
        );
        environment.insert(
            "NPM_CONFIG_CACHE".into(),
            install_directory
                .join(".npm-cache")
                .to_string_lossy()
                .into_owned(),
        );
        for (key, value) in [
            ("NPM_CONFIG_IGNORE_SCRIPTS", "true"),
            ("NPM_CONFIG_AUDIT", "false"),
            ("NPM_CONFIG_FUND", "false"),
            ("NPM_CONFIG_PACKAGE_LOCK", "false"),
            ("NPM_CONFIG_SAVE_EXACT", "true"),
        ] {
            environment.insert(key.into(), value.into());
        }
        if let Some(proxy) = proxy {
            environment.insert("NPM_CONFIG_PROXY".into(), proxy.into());
            environment.insert("NPM_CONFIG_HTTPS_PROXY".into(), proxy.into());
        }
        Ok(CommandPlan {
            program: self.node_path.clone(),
            args,
            install_directory,
            environment,
            clear_environment: true,
        })
    }
}

impl EnvironmentDescriptor {
    pub fn new(
        registry: &str,
        proxy: Option<&str>,
        dependencies: BTreeMap<String, String>,
    ) -> Result<Self, EnvironmentError> {
        let registry = normalize_endpoint(registry, "registry")?;
        let proxy_identity = proxy
            .map(|value| normalize_endpoint(value, "proxy"))
            .transpose()?
            .map(|value| sha256(value.as_bytes()));
        let descriptor = Self {
            node_major: NODE_MAJOR,
            registry,
            proxy_identity,
            dependencies,
        };
        descriptor.validate()?;
        Ok(descriptor)
    }

    pub fn key(&self) -> String {
        sha256(&serde_json::to_vec(self).expect("environment descriptor is serializable"))
    }

    fn validate(&self) -> Result<(), EnvironmentError> {
        if self.node_major != NODE_MAJOR {
            return Err(EnvironmentError("Unsupported Node.js major version".into()));
        }
        if normalize_endpoint(&self.registry, "registry")? != self.registry {
            return Err(EnvironmentError("Npm registry URL is not canonical".into()));
        }
        for (name, version) in &self.dependencies {
            if !valid_package_name(name) {
                return Err(EnvironmentError(format!(
                    "Invalid npm package name: {name}"
                )));
            }
            if !valid_exact_version(version) {
                return Err(EnvironmentError(format!(
                    "Dependency {name} must use an exact semantic version"
                )));
            }
        }
        Ok(())
    }
}

fn normalize_endpoint(value: &str, label: &str) -> Result<String, EnvironmentError> {
    let mut url =
        Url::parse(value).map_err(|_| EnvironmentError(format!("Invalid npm {label} URL")))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(EnvironmentError(format!("Invalid npm {label} URL")));
    }
    if label == "registry" && (!url.username().is_empty() || url.password().is_some()) {
        return Err(EnvironmentError(
            "Npm registry URL must not contain credentials".into(),
        ));
    }
    url.set_username("")
        .map_err(|_| EnvironmentError(format!("Invalid npm {label} URL")))?;
    url.set_password(None)
        .map_err(|_| EnvironmentError(format!("Invalid npm {label} URL")))?;
    url.set_query(None);
    url.set_fragment(None);
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url.to_string())
}

fn valid_package_name(name: &str) -> bool {
    fn valid_part(part: &str) -> bool {
        !part.is_empty()
            && !part.starts_with(['.', '_'])
            && part.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-._~".contains(&byte)
            })
    }

    if name.len() > 214 || matches!(name, "." | ".." | "node_modules" | "favicon.ico") {
        return false;
    }
    if let Some(scoped) = name.strip_prefix('@') {
        let Some((scope, package)) = scoped.split_once('/') else {
            return false;
        };
        !package.contains('/') && valid_part(scope) && valid_part(package)
    } else {
        !name.contains('/') && valid_part(name)
    }
}

fn valid_exact_version(value: &str) -> bool {
    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

    let Ok(version) = Version::parse(value) else {
        return false;
    };
    version.major <= MAX_SAFE_INTEGER
        && version.minor <= MAX_SAFE_INTEGER
        && version.patch <= MAX_SAFE_INTEGER
        && (version.pre.is_empty()
            || version.pre.as_str().split('.').all(|identifier| {
                !identifier.bytes().all(|byte| byte.is_ascii_digit())
                    || identifier
                        .parse::<u64>()
                        .is_ok_and(|number| number <= MAX_SAFE_INTEGER)
            }))
}

fn sha256(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

fn validate_proxy(
    descriptor: &EnvironmentDescriptor,
    proxy: Option<&str>,
) -> Result<(), EnvironmentError> {
    let supplied_identity = proxy
        .map(|value| normalize_endpoint(value, "proxy"))
        .transpose()?
        .map(|value| sha256(value.as_bytes()));
    if supplied_identity != descriptor.proxy_identity {
        return Err(EnvironmentError(
            "Proxy does not match dependency environment descriptor".into(),
        ));
    }
    Ok(())
}

fn write_root_package_json(directory: &Path) -> Result<(), EnvironmentError> {
    let contents = serde_json::to_vec(&serde_json::json!({
        "name": "localapp-dependency-environment",
        "private": true,
        "version": "0.0.0"
    }))
    .map_err(|_| EnvironmentError("Could not serialize dependency manifest".into()))?;
    durable_write(&directory.join("package.json"), &contents)
}

fn write_isolated_npm_config(directory: &Path) -> Result<(), EnvironmentError> {
    durable_write(&directory.join(".npmrc"), &[])?;
    durable_write(&directory.join(".npmrc-global"), &[])?;
    Ok(())
}

fn allowed_parent_environment() -> BTreeMap<String, String> {
    #[cfg(unix)]
    const ALLOWED: &[&str] = &[
        "HOME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
        "TEMP",
        "TMP",
        "TMPDIR",
    ];
    #[cfg(windows)]
    const ALLOWED: &[&str] = &[
        "APPDATA",
        "COMSPEC",
        "HOMEDRIVE",
        "HOMEPATH",
        "LOCALAPPDATA",
        "PATHEXT",
        "PROGRAMDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "PROGRAMW6432",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
    ];

    env::vars()
        .filter(|(key, _)| {
            ALLOWED
                .iter()
                .any(|allowed| key.eq_ignore_ascii_case(allowed))
        })
        .collect()
}

fn verify_direct_dependencies(
    directory: &Path,
    descriptor: &EnvironmentDescriptor,
) -> Result<(), EnvironmentError> {
    let canonical_directory = canonical_plain_path(directory, directory, "environment")?;
    for (name, expected) in &descriptor.dependencies {
        let package_directory = directory.join("node_modules").join(name);
        let canonical_package =
            canonical_plain_path(directory, &package_directory, "package directory")?;
        if !canonical_package.starts_with(&canonical_directory) {
            return Err(EnvironmentError(format!(
                "Installed dependency {name} escapes the environment"
            )));
        }
        let package_path = package_directory.join("package.json");
        let canonical_manifest =
            canonical_plain_path(&package_directory, &package_path, "package.json")?;
        if !canonical_manifest.starts_with(&canonical_package) {
            return Err(EnvironmentError(format!(
                "Installed dependency {name} package.json escapes its package directory"
            )));
        }
        let package: InstalledPackage = fs::read(&package_path)
            .map_err(|_| {
                EnvironmentError(format!(
                    "Installed dependency {name} is missing package.json"
                ))
            })
            .and_then(|contents| {
                serde_json::from_slice(&contents).map_err(|_| {
                    EnvironmentError(format!(
                        "Installed dependency {name} has invalid package.json"
                    ))
                })
            })?;
        if package.name != *name {
            return Err(EnvironmentError(format!(
                "Dependency {name} package identity mismatch"
            )));
        }
        if package.version != *expected {
            return Err(EnvironmentError(format!(
                "Dependency {name} resolved version mismatch: expected {expected}, received {}",
                package.version
            )));
        }
    }
    Ok(())
}

fn canonical_plain_path(
    base: &Path,
    path: &Path,
    label: &str,
) -> Result<PathBuf, EnvironmentError> {
    let relative = path
        .strip_prefix(base)
        .map_err(|_| EnvironmentError(format!("Invalid installed dependency {label}")))?;
    let mut current = base.to_path_buf();
    reject_reparse_point(&current, label)?;
    for component in relative.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err(EnvironmentError(format!(
                "Invalid installed dependency {label}"
            )));
        }
        current.push(component.as_os_str());
        reject_reparse_point(&current, label)?;
    }
    fs::canonicalize(path)
        .map_err(|_| EnvironmentError(format!("Invalid installed dependency {label}")))
}

fn reject_reparse_point(path: &Path, label: &str) -> Result<(), EnvironmentError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| EnvironmentError(format!("Invalid installed dependency {label}")))?;
    if metadata.file_type().is_symlink() || windows_reparse_point(&metadata) {
        return Err(EnvironmentError(format!(
            "Installed dependency {label} must not use links"
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
fn windows_reparse_point(_: &fs::Metadata) -> bool {
    false
}

#[cfg(windows)]
fn windows_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

fn write_ready_marker(
    directory: &Path,
    descriptor: &EnvironmentDescriptor,
    key: &str,
    tree_digest: &str,
) -> Result<(), EnvironmentError> {
    let marker = ReadyMarker {
        key: key.into(),
        descriptor: descriptor.clone(),
        tree_digest: tree_digest.into(),
    };
    let contents = serde_json::to_vec_pretty(&marker)
        .map_err(|_| EnvironmentError("Could not serialize dependency ready marker".into()))?;
    let temporary = directory.join(format!(".ready-{}.tmp", Uuid::new_v4()));
    durable_write(&temporary, &contents)?;
    fs::rename(temporary, directory.join(".ready.json"))?;
    sync_directory(directory)?;
    Ok(())
}

fn ready_environment_is_valid(
    directory: &Path,
    descriptor: &EnvironmentDescriptor,
    key: &str,
) -> bool {
    let marker_path = directory.join(".ready.json");
    if canonical_plain_path(directory, &marker_path, "ready marker").is_err() {
        return false;
    }
    let marker = fs::read(marker_path)
        .ok()
        .and_then(|contents| serde_json::from_slice::<ReadyMarker>(&contents).ok());
    matches!(marker, Some(marker)
        if marker.key == key
            && marker.descriptor == *descriptor
            && dependency_tree_digest(directory).is_ok_and(|digest| digest == marker.tree_digest))
        && verify_direct_dependencies(directory, descriptor).is_ok()
}

fn dependency_tree_digest(directory: &Path) -> Result<String, EnvironmentError> {
    let root = directory.join("node_modules");
    let mut digest = Sha256::new();
    hash_dependency_entry(&root, &root, &mut digest)?;
    Ok(format!("{:x}", digest.finalize()))
}

fn hash_dependency_entry(
    root: &Path,
    path: &Path,
    digest: &mut Sha256,
) -> Result<(), EnvironmentError> {
    let metadata = dependency_metadata(path)?;
    let relative = path
        .strip_prefix(root)
        .map_err(|_| EnvironmentError("Dependency environment contains an invalid path".into()))?;

    if metadata.is_dir() {
        hash_entry_header(digest, b'd', relative);
        let mut children = fs::read_dir(path)
            .map_err(|_| EnvironmentError("Dependency environment tree could not be read".into()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| {
                EnvironmentError("Dependency environment tree could not be read".into())
            })?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            hash_dependency_entry(root, &child.path(), digest)?;
        }
        return Ok(());
    }

    if !metadata.is_file() {
        return Err(EnvironmentError(
            "Dependency environment contains a non-regular entry".into(),
        ));
    }
    if path
        .extension()
        .is_some_and(|extension| extension == "node")
    {
        return Err(EnvironmentError(
            "Dependency environment contains a native addon".into(),
        ));
    }

    hash_entry_header(digest, b'f', relative);
    digest.update(metadata.len().to_le_bytes());
    let mut file = File::open(path)
        .map_err(|_| EnvironmentError("Dependency environment file could not be read".into()))?;
    let mut buffer = [0; 8_192];
    let mut length = 0_u64;
    loop {
        let count = file.read(&mut buffer).map_err(|_| {
            EnvironmentError("Dependency environment file could not be read".into())
        })?;
        if count == 0 {
            break;
        }
        length = length.saturating_add(count as u64);
        digest.update(&buffer[..count]);
    }
    if length != metadata.len() {
        return Err(EnvironmentError(
            "Dependency environment changed while it was inspected".into(),
        ));
    }
    Ok(())
}

fn dependency_metadata(path: &Path) -> Result<fs::Metadata, EnvironmentError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| EnvironmentError("Dependency environment tree could not be read".into()))?;
    if metadata.file_type().is_symlink() || windows_reparse_point(&metadata) {
        return Err(EnvironmentError(
            "Dependency environment must not contain links".into(),
        ));
    }
    Ok(metadata)
}

fn hash_entry_header(digest: &mut Sha256, kind: u8, relative: &Path) {
    digest.update([kind]);
    let components = relative.components().collect::<Vec<_>>();
    digest.update((components.len() as u64).to_le_bytes());
    for component in components {
        let bytes = path_component_bytes(component.as_os_str());
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    }
}

#[cfg(unix)]
fn path_component_bytes(component: &std::ffi::OsStr) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    component.as_bytes().to_vec()
}

#[cfg(windows)]
fn path_component_bytes(component: &std::ffi::OsStr) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    component.encode_wide().flat_map(u16::to_le_bytes).collect()
}

fn archive_nonready(root: &Path, directory: &Path, key: &str) -> Result<(), EnvironmentError> {
    fs::rename(
        directory,
        root.join(format!(".nonready-{key}-{}", Uuid::new_v4())),
    )?;
    sync_directory(root)?;
    Ok(())
}

fn durable_write(path: &Path, contents: &[u8]) -> Result<(), EnvironmentError> {
    let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
    file.write_all(contents)?;
    file.sync_all()?;
    Ok(())
}

fn finish_failed_install(log: InstallLogger, staging: &Path) -> Result<(), EnvironmentError> {
    log.finish()?;
    sync_directory(staging)
}

fn sync_tree(directory: &Path) -> Result<(), EnvironmentError> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let metadata = entry.file_type()?;
        if metadata.is_dir() {
            sync_tree(&entry.path())?;
        } else if metadata.is_file() {
            File::open(entry.path())?.sync_all()?;
        }
    }
    sync_directory(directory)
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> Result<(), EnvironmentError> {
    File::open(directory)?.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn sync_directory(directory: &Path) -> Result<(), EnvironmentError> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;

    OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(directory)?
        .sync_all()?;
    Ok(())
}

struct Redactor {
    secrets: Vec<String>,
}

impl Redactor {
    fn new(proxy: Option<&str>) -> Self {
        let mut secrets: Vec<String> = Vec::new();
        if let Some(proxy) = proxy {
            secrets.push(proxy.into());
            if let Ok(url) = Url::parse(proxy) {
                if !url.username().is_empty() {
                    secrets.push(url.username().into());
                    secrets.push(
                        percent_decode_str(url.username())
                            .decode_utf8_lossy()
                            .into_owned(),
                    );
                }
                if let Some(password) = url.password().filter(|password| !password.is_empty()) {
                    secrets.push(password.into());
                    secrets.push(
                        percent_decode_str(password)
                            .decode_utf8_lossy()
                            .into_owned(),
                    );
                }
            }
        }
        secrets.retain(|secret| !secret.is_empty());
        secrets.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
        secrets.dedup();
        Self { secrets }
    }

    fn redact(&self, value: &str) -> String {
        self.secrets
            .iter()
            .fold(value.to_string(), |redacted, secret| {
                redacted.replace(secret, "[REDACTED]")
            })
    }

    fn pending_secret_prefix_len(&self, value: &str) -> usize {
        self.secrets
            .iter()
            .flat_map(|secret| {
                secret
                    .char_indices()
                    .map(|(index, _)| index)
                    .chain(std::iter::once(secret.len()))
                    .filter(|length| *length > 0 && *length <= value.len())
                    .filter(|length| {
                        value.is_char_boundary(value.len() - *length)
                            && secret.starts_with(&value[value.len() - *length..])
                    })
            })
            .max()
            .unwrap_or(0)
    }
}

pub struct InstallLogger {
    file: File,
    redactor: Redactor,
    stdout_pending: String,
    stderr_pending: String,
}

impl InstallLogger {
    fn new(path: &Path, redactor: Redactor) -> Result<Self, EnvironmentError> {
        let file = OpenOptions::new().create_new(true).write(true).open(path)?;
        Ok(Self {
            file,
            redactor,
            stdout_pending: String::new(),
            stderr_pending: String::new(),
        })
    }

    pub fn write_stdout(&mut self, chunk: &[u8]) -> Result<(), EnvironmentError> {
        self.write_chunk(StreamKind::Stdout, chunk)
    }

    pub fn write_stderr(&mut self, chunk: &[u8]) -> Result<(), EnvironmentError> {
        self.write_chunk(StreamKind::Stderr, chunk)
    }

    fn write_chunk(&mut self, kind: StreamKind, chunk: &[u8]) -> Result<(), EnvironmentError> {
        let pending = match kind {
            StreamKind::Stdout => &mut self.stdout_pending,
            StreamKind::Stderr => &mut self.stderr_pending,
        };
        pending.push_str(&String::from_utf8_lossy(chunk));
        let redacted = self.redactor.redact(pending);
        let retained = self.redactor.pending_secret_prefix_len(&redacted);
        let split = redacted.len() - retained;
        if split > 0 {
            let label = match kind {
                StreamKind::Stdout => "stdout: ",
                StreamKind::Stderr => "stderr: ",
            };
            self.file.write_all(label.as_bytes())?;
            self.file.write_all(redacted[..split].as_bytes())?;
            self.file.flush()?;
            self.file.sync_data()?;
        }
        *pending = redacted[split..].to_string();
        Ok(())
    }

    fn redact(&self, value: &str) -> String {
        self.redactor.redact(value)
    }

    fn finish(mut self) -> Result<(), EnvironmentError> {
        for (label, pending) in [
            ("stdout: ", self.stdout_pending.as_str()),
            ("stderr: ", self.stderr_pending.as_str()),
        ] {
            if !pending.is_empty() {
                self.file.write_all(label.as_bytes())?;
                self.file
                    .write_all(self.redactor.redact(pending).as_bytes())?;
            }
        }
        self.file.flush()?;
        self.file.sync_all()?;
        Ok(())
    }
}
