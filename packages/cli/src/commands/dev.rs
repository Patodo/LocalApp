use crate::client::Client;
use crate::commands::build;
use crate::commands::sync;
use crate::config::Config;
use crate::pm;
use crate::project::Manifest;
use std::ffi::OsStr;
use std::fs;
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus, Stdio};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child as TokioChild, Command as TokioCommand};

fn directory_contains_same_files(source: &Path, installed: &Path) -> bool {
    if !source.is_dir() || !installed.is_dir() {
        return false;
    }
    let entries = match fs::read_dir(source) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return false,
        };
        let source_path = entry.path();
        let installed_path = installed.join(entry.file_name());
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => return false,
        };
        if file_type.is_dir() {
            if !directory_contains_same_files(&source_path, &installed_path) {
                return false;
            }
        } else if file_type.is_file() {
            let source_bytes = match fs::read(&source_path) {
                Ok(bytes) => bytes,
                Err(_) => return false,
            };
            let installed_bytes = match fs::read(&installed_path) {
                Ok(bytes) => bytes,
                Err(_) => return false,
            };
            if source_bytes != installed_bytes {
                return false;
            }
        }
    }
    let installed_entries = match fs::read_dir(installed) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in installed_entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return false,
        };
        if !source.join(entry.file_name()).exists() {
            return false;
        }
    }
    true
}

fn directory_contains_same_files_except(
    source: &Path,
    installed: &Path,
    excluded_top_level_entries: &[&str],
) -> bool {
    if !source.is_dir() || !installed.is_dir() {
        return false;
    }
    let is_excluded = |entry: &fs::DirEntry| {
        let name = entry.file_name();
        excluded_top_level_entries
            .iter()
            .any(|excluded| name == std::ffi::OsStr::new(excluded))
    };
    let source_entries = match fs::read_dir(source) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in source_entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return false,
        };
        if is_excluded(&entry) {
            continue;
        }
        let source_path = entry.path();
        let installed_path = installed.join(entry.file_name());
        let matches = match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => {
                directory_contains_same_files(&source_path, &installed_path)
            }
            Ok(file_type) if file_type.is_file() => {
                files_contain_same_bytes(&source_path, &installed_path)
            }
            _ => false,
        };
        if !matches {
            return false;
        }
    }
    let installed_entries = match fs::read_dir(installed) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in installed_entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return false,
        };
        if !is_excluded(&entry) && !source.join(entry.file_name()).exists() {
            return false;
        }
    }
    true
}

fn files_contain_same_bytes(source: &Path, installed: &Path) -> bool {
    match (fs::read(source), fs::read(installed)) {
        (Ok(source_bytes), Ok(installed_bytes)) => source_bytes == installed_bytes,
        _ => false,
    }
}

fn runtime_dependencies_stale(cwd: &Path) -> bool {
    let comparisons = [
        (
            ".localapp/runtime/server-core",
            "node_modules/@localapp/server-core",
        ),
        (".localapp/runtime/sdk/core", "node_modules/@localapp/sdk"),
        (
            ".localapp/runtime/sdk/react",
            "node_modules/@localapp/sdk-react",
        ),
        (
            ".localapp/runtime/sdk/agent",
            "node_modules/@localapp/sdk-agent",
        ),
    ];
    let stale_directory = comparisons.iter().any(|(source, installed)| {
        !directory_contains_same_files(&cwd.join(source), &cwd.join(installed))
    });
    stale_directory
        || !directory_contains_same_files_except(
            &cwd.join(".localapp/runtime"),
            &cwd.join("node_modules/@localapp/app-kit"),
            &["server-core", "sdk"],
        )
}

fn clear_vite_dependency_cache(cwd: &Path) -> Result<(), String> {
    let cache_dir = cwd.join("node_modules/.vite");
    if !cache_dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to clear stale Vite dependency cache: {e}"))
}

fn refresh_installed_runtime_packages(cwd: &Path) -> Result<(), String> {
    let mappings = [
        (".localapp/runtime", "node_modules/@localapp/app-kit"),
        (
            ".localapp/runtime/server-core",
            "node_modules/@localapp/server-core",
        ),
        (".localapp/runtime/sdk/core", "node_modules/@localapp/sdk"),
        (
            ".localapp/runtime/sdk/react",
            "node_modules/@localapp/sdk-react",
        ),
        (
            ".localapp/runtime/sdk/agent",
            "node_modules/@localapp/sdk-agent",
        ),
    ];
    for (source, target) in mappings {
        let source = cwd.join(source);
        if source.is_dir() {
            sync_directory_exact(&source, &cwd.join(target))?;
        }
    }
    Ok(())
}

fn sync_directory_exact(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("Failed to create runtime package directory: {error}"))?;
    for entry in fs::read_dir(target)
        .map_err(|error| format!("Failed to read installed runtime package: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to read installed runtime package entry: {error}"))?;
        let source_entry = source.join(entry.file_name());
        if !source_entry.exists() {
            remove_runtime_path(&entry.path())?;
        }
    }
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read project runtime package: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to read project runtime package entry: {error}"))?;
        let source_entry = entry.path();
        let target_entry = target.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| format!("Failed to inspect project runtime package entry: {error}"))?
            .is_dir()
        {
            if target_entry.exists() && !target_entry.is_dir() {
                remove_runtime_path(&target_entry)?;
            }
            sync_directory_exact(&source_entry, &target_entry)?;
        } else {
            if target_entry.exists() && target_entry.is_dir() {
                remove_runtime_path(&target_entry)?;
            }
            // pnpm may represent local file dependencies with hard links. Copying a
            // source file onto another name for the same inode truncates both names.
            // Unchanged files do not need refreshing and must be left intact.
            if !files_contain_same_bytes(&source_entry, &target_entry) {
                fs::copy(&source_entry, &target_entry).map_err(|error| {
                    format!("Failed to refresh installed runtime file: {error}")
                })?;
            }
        }
    }
    Ok(())
}

fn remove_runtime_path(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect stale runtime path: {error}"))?;
    if metadata.file_type().is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
    .map_err(|error| format!("Failed to remove stale runtime path: {error}"))
}

const DEFAULT_DEV_USER_ID: &str = "dev-user";

struct LocalServerCommand {
    program: String,
    args: Vec<String>,
}

fn pick_app_server_port() -> Result<u16, String> {
    for port in 5173..=5200 {
        let ipv4_in_use = TcpStream::connect(("127.0.0.1", port)).is_ok();
        let ipv6_in_use = TcpStream::connect(("::1", port)).is_ok();
        if ipv4_in_use || ipv6_in_use {
            continue;
        }
        let ipv4 = TcpListener::bind(("127.0.0.1", port));
        let ipv6 = TcpListener::bind(("::1", port));
        if ipv4.is_ok() && ipv6.is_ok() {
            return Ok(port);
        }
    }
    Err("No free port found for app dev server in range 5173-5200".to_string())
}

fn local_server_data_dir(cwd: &Path) -> std::path::PathBuf {
    cwd.join("tmp/localapp-dev/server")
}

fn build_local_server_command(server_program: &str, data_dir: &Path) -> LocalServerCommand {
    let server_path = Path::new(server_program);
    if server_path
        .extension()
        .and_then(|extension| extension.to_str())
        == Some("mjs")
    {
        return LocalServerCommand {
            program: std::env::var("LOCALAPP_NODE_BIN").unwrap_or_else(|_| "node".to_string()),
            args: std::iter::once(server_program.to_string())
                .chain(local_server_args(data_dir))
                .collect(),
        };
    }
    LocalServerCommand {
        program: server_program.to_string(),
        args: local_server_args(data_dir),
    }
}

fn local_server_args(data_dir: &Path) -> Vec<String> {
    vec![
        "start".to_string(),
        "--data-dir".to_string(),
        data_dir.to_string_lossy().to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        "0".to_string(),
    ]
}

fn local_server_program(cwd: &Path) -> Result<String, String> {
    let configured = std::env::var_os("LOCALAPP_SERVER_BIN");
    let current_exe = std::env::current_exe().ok();
    let search_path = std::env::var_os("PATH");
    resolve_local_server_program_from(
        cwd,
        configured.as_deref(),
        current_exe.as_deref(),
        search_path.as_deref(),
    )
}

fn server_launcher_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &[
            "localapp-server.cmd",
            "localapp-server.exe",
            "localapp-server.bat",
            "localapp-server",
        ]
    }
    #[cfg(not(windows))]
    {
        &["localapp-server"]
    }
}

fn first_existing_file(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn find_program_on_path(program: &OsStr, search_path: Option<&OsStr>) -> Option<PathBuf> {
    let program_path = Path::new(program);
    if program_path.components().count() > 1 {
        return program_path.is_file().then(|| program_path.to_path_buf());
    }
    let search_path = search_path?;
    for directory in std::env::split_paths(search_path) {
        #[cfg(windows)]
        let names: Vec<PathBuf> = if program_path.extension().is_some() {
            vec![directory.join(program_path)]
        } else {
            ["cmd", "exe", "bat", ""]
                .into_iter()
                .map(|extension| {
                    if extension.is_empty() {
                        directory.join(program_path)
                    } else {
                        directory.join(format!("{}.{}", program_path.to_string_lossy(), extension))
                    }
                })
                .collect()
        };
        #[cfg(not(windows))]
        let names = vec![directory.join(program_path)];
        if let Some(found) = first_existing_file(names) {
            return Some(found);
        }
    }
    None
}

fn resolve_local_server_program_from(
    cwd: &Path,
    configured: Option<&OsStr>,
    current_exe: Option<&Path>,
    search_path: Option<&OsStr>,
) -> Result<String, String> {
    if let Some(configured) = configured.filter(|value| !value.is_empty()) {
        let configured_path = Path::new(configured);
        let resolved = if configured_path.is_absolute() || configured_path.components().count() > 1
        {
            let candidate = if configured_path.is_absolute() {
                configured_path.to_path_buf()
            } else {
                cwd.join(configured_path)
            };
            candidate.is_file().then_some(candidate)
        } else {
            find_program_on_path(configured, search_path)
        };
        return resolved
            .map(|path| path.to_string_lossy().into_owned())
            .ok_or_else(|| {
                format!(
                    "LOCALAPP_SERVER_BIN does not resolve to a canonical Server executable: {}",
                    configured.to_string_lossy()
                )
            });
    }

    let project_bin = cwd.join("node_modules/.bin");
    let mut project_candidates = server_launcher_names()
        .iter()
        .map(|name| project_bin.join(name))
        .collect::<Vec<_>>();
    project_candidates.push(cwd.join("node_modules/@localapp/server/bin/localapp-server.mjs"));
    if let Some(found) = first_existing_file(project_candidates) {
        return Ok(found.to_string_lossy().into_owned());
    }

    if let Some(executable_dir) = current_exe.and_then(Path::parent) {
        let mut sibling_candidates = server_launcher_names()
            .iter()
            .map(|name| executable_dir.join(name))
            .collect::<Vec<_>>();
        sibling_candidates.extend([
            executable_dir.join("localapp-server.mjs"),
            executable_dir.join("../node_modules/@localapp/server/bin/localapp-server.mjs"),
            executable_dir.join("../lib/node_modules/@localapp/server/bin/localapp-server.mjs"),
        ]);
        if let Some(found) = first_existing_file(sibling_candidates) {
            return Ok(found.to_string_lossy().into_owned());
        }
    }

    for name in server_launcher_names() {
        if let Some(found) = find_program_on_path(OsStr::new(name), search_path) {
            return Ok(found.to_string_lossy().into_owned());
        }
    }

    Err(
        "Cannot find the canonical LocalApp Server. Install @localapp/server in this project (for example, 'pnpm add -D @localapp/server'), install its localapp-server executable on PATH, or set LOCALAPP_SERVER_BIN to the packaged launcher."
            .to_string(),
    )
}

fn validate_node_version_output(output: &str) -> Result<u64, String> {
    let version = output.trim().strip_prefix('v').unwrap_or(output.trim());
    let major = version
        .split('.')
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| format!("Could not parse the Node.js version: {output:?}"))?;
    if major < 24 {
        return Err(format!(
            "The canonical LocalApp Server requires Node.js 24 or newer; found {version}."
        ));
    }
    Ok(major)
}

fn validate_local_server_node() -> Result<(), String> {
    let node = std::env::var("LOCALAPP_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let output = std::process::Command::new(&node)
        .arg("--version")
        .output()
        .map_err(|error| {
            format!(
                "Failed to run Node.js for the canonical LocalApp Server ({node}): {error}. Install Node.js 24+ or set LOCALAPP_NODE_BIN."
            )
        })?;
    if !output.status.success() {
        return Err(format!(
            "Node.js version check failed for {node} with status {}.",
            output.status
        ));
    }
    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| "Node.js version output was not valid UTF-8".to_string())?;
    validate_node_version_output(&stdout).map(|_| ())
}

fn random_hex(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Failed to obtain operating-system randomness: {error}"))?;
    let mut value = String::with_capacity(byte_count * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut value, "{byte:02x}").expect("writing to String cannot fail");
    }
    Ok(value)
}

fn make_private(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to restrict private file permissions: {error}"))?;
    }
    #[cfg(windows)]
    restrict_windows_acl(path, path.is_dir())?;
    Ok(())
}

#[cfg(windows)]
struct CurrentUserSid {
    token: windows_sys::Win32::Foundation::HANDLE,
    buffer: Vec<u8>,
}

#[cfg(windows)]
impl CurrentUserSid {
    fn load() -> Result<Self, String> {
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
        use windows_sys::Win32::Security::{
            GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        let mut token = std::ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == FALSE {
            return Err(format!(
                "Failed to open the current Windows user token: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut required = 0;
        unsafe {
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut required);
        }
        if required < std::mem::size_of::<TOKEN_USER>() as u32 {
            unsafe { CloseHandle(token) };
            return Err("Windows user token did not contain a user SID".to_string());
        }
        let mut buffer = vec![0_u8; required as usize];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                required,
                &mut required,
            )
        } == FALSE
        {
            let error = std::io::Error::last_os_error();
            unsafe { CloseHandle(token) };
            return Err(format!(
                "Failed to read the current Windows user SID: {error}"
            ));
        }
        Ok(Self { token, buffer })
    }

    fn sid(&self) -> windows_sys::Win32::Security::PSID {
        let user =
            unsafe { &*(self.buffer.as_ptr() as *const windows_sys::Win32::Security::TOKEN_USER) };
        user.User.Sid
    }
}

#[cfg(windows)]
impl Drop for CurrentUserSid {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.token);
        }
    }
}

#[cfg(windows)]
fn restrict_windows_acl(path: &Path, directory: bool) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        EXPLICIT_ACCESS_W, SE_FILE_OBJECT, SET_ACCESS, SetEntriesInAclW, SetNamedSecurityInfoW,
        TRUSTEE_IS_SID, TRUSTEE_IS_USER,
    };
    use windows_sys::Win32::Security::{
        DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    };
    use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;

    let identity = CurrentUserSid::load()?;
    let mut access = EXPLICIT_ACCESS_W::default();
    access.grfAccessPermissions = FILE_ALL_ACCESS;
    access.grfAccessMode = SET_ACCESS;
    access.grfInheritance = if directory {
        SUB_CONTAINERS_AND_OBJECTS_INHERIT
    } else {
        0
    };
    access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    access.Trustee.TrusteeType = TRUSTEE_IS_USER;
    access.Trustee.ptstrName = identity.sid().cast();
    let mut acl = std::ptr::null_mut();
    let acl_status = unsafe { SetEntriesInAclW(1, &access, std::ptr::null(), &mut acl) };
    if acl_status != ERROR_SUCCESS {
        return Err(format!(
            "Failed to build a current-user-only Windows ACL: {}",
            std::io::Error::from_raw_os_error(acl_status as i32)
        ));
    }
    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let status = unsafe {
        SetNamedSecurityInfoW(
            wide_path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            acl,
            std::ptr::null(),
        )
    };
    unsafe { LocalFree(acl.cast()) };
    if status != ERROR_SUCCESS {
        return Err(format!(
            "Failed to apply a current-user-only Windows ACL to {}: {}",
            path.display(),
            std::io::Error::from_raw_os_error(status as i32)
        ));
    }
    Ok(())
}

fn write_private_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Private file path has no parent directory")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create private file directory: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(|error| {
            format!("Failed to restrict private directory permissions: {error}")
        })?;
    }
    #[cfg(windows)]
    restrict_windows_acl(parent, true)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Private file name is invalid")?;
    let temporary = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        random_hex(8)?
    ));
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let write_result = (|| -> Result<(), String> {
        let mut file = options
            .open(&temporary)
            .map_err(|error| format!("Failed to create private temporary file: {error}"))?;
        file.write_all(content)
            .map_err(|error| format!("Failed to write private temporary file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Failed to sync private temporary file: {error}"))?;
        drop(file);
        fs::rename(&temporary, path)
            .map_err(|error| format!("Failed to publish private file atomically: {error}"))?;
        make_private(path)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn read_private_value(path: &Path) -> Result<Option<String>, String> {
    if let Ok(value) = fs::read_to_string(&path) {
        let value = value.trim().to_string();
        if !value.is_empty() {
            make_private(path)?;
            return Ok(Some(value));
        }
    }
    Ok(None)
}

fn local_server_api_key(cwd: &Path) -> Result<String, String> {
    let path = cwd.join("tmp/localapp-dev/server-api-key");
    if let Some(value) = read_private_value(&path)? {
        let random = value.strip_prefix("localapp_dev_");
        if !random.is_some_and(|random| {
            random.len() == 64 && random.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err(
                "Found an insecure legacy local development credential. Remove this project's tmp/localapp-dev directory and run 'localapp dev' again."
                    .to_string(),
            );
        }
        return Ok(value);
    }
    let value = format!("localapp_dev_{}", random_hex(32)?);
    write_private_file(&path, format!("{value}\n").as_bytes())?;
    Ok(value)
}

fn local_server_password_path(cwd: &Path) -> PathBuf {
    cwd.join("tmp/localapp-dev/server-password")
}

fn local_server_password(cwd: &Path) -> Result<String, String> {
    let path = local_server_password_path(cwd);
    if let Some(value) = read_private_value(&path)? {
        return Ok(value);
    }
    let value = format!("localapp_dev_password_{}", random_hex(32)?);
    write_private_file(&path, format!("{value}\n").as_bytes())?;
    Ok(value)
}

#[derive(Debug)]
struct LocalServerHandle {
    child: TokioChild,
    base_url: String,
    process_tree: ProcessTree,
}

#[derive(Debug)]
struct ProcessTree {
    root_pid: u32,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

impl ProcessTree {
    fn attach(root_pid: u32) -> Result<Self, String> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
            use windows_sys::Win32::System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            };
            use windows_sys::Win32::System::Threading::{
                OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA,
                PROCESS_TERMINATE,
            };

            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Err(format!(
                    "Failed to create a Windows process-tree job: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            let process = unsafe {
                OpenProcess(
                    PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                    FALSE,
                    root_pid,
                )
            };
            let assigned =
                !process.is_null() && unsafe { AssignProcessToJobObject(job, process) } != 0;
            if !process.is_null() {
                unsafe { CloseHandle(process) };
            }
            if configured == 0 || !assigned {
                let error = std::io::Error::last_os_error();
                unsafe { CloseHandle(job) };
                force_kill_process_tree_fallback(root_pid);
                return Err(format!(
                    "Failed to secure the Windows process tree in a Job Object: {error}"
                ));
            }
            return Ok(Self { root_pid, job });
        }
        #[cfg(not(windows))]
        Ok(Self { root_pid })
    }

    fn spawn_std(command: &mut std::process::Command) -> Result<(Child, Self), String> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::System::Threading::CREATE_SUSPENDED;
            command.creation_flags(CREATE_SUSPENDED);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start supervised process: {error}"))?;
        let root_pid = child.id();
        let process_tree = match Self::attach(root_pid) {
            Ok(process_tree) => process_tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        if let Err(error) = resume_windows_process(root_pid) {
            process_tree.signal(true);
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok((child, process_tree))
    }

    fn spawn_tokio(command: &mut TokioCommand) -> Result<(TokioChild, Self), String> {
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_SUSPENDED);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start supervised process: {error}"))?;
        let Some(root_pid) = child.id() else {
            let _ = child.start_kill();
            return Err("Supervised process did not expose a process identifier".to_string());
        };
        let process_tree = match Self::attach(root_pid) {
            Ok(process_tree) => process_tree,
            Err(error) => {
                let _ = child.start_kill();
                return Err(error);
            }
        };
        if let Err(error) = resume_windows_process(root_pid) {
            process_tree.signal(true);
            let _ = child.start_kill();
            return Err(error);
        }
        Ok((child, process_tree))
    }

    fn signal(&self, force: bool) {
        #[cfg(unix)]
        {
            let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
            unsafe {
                libc::kill(-(self.root_pid as i32), signal);
            }
        }
        #[cfg(windows)]
        {
            if force {
                unsafe {
                    windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job, 1);
                }
            } else {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &self.root_pid.to_string(), "/T"])
                    .status();
            }
        }
    }

    fn exists(&self) -> bool {
        #[cfg(unix)]
        {
            let result = unsafe { libc::kill(-(self.root_pid as i32), 0) };
            return result == 0
                || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::JobObjects::{
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JobObjectBasicAccountingInformation,
                QueryInformationJobObject,
            };
            let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            let queried = unsafe {
                QueryInformationJobObject(
                    self.job,
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    std::ptr::null_mut(),
                )
            };
            return queried != 0 && accounting.ActiveProcesses > 0;
        }
        #[allow(unreachable_code)]
        false
    }
}

#[cfg(not(windows))]
fn resume_windows_process(_root_pid: u32) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn resume_windows_process(root_pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    let mut found_thread = None;
    let mut snapshot_error = None;
    for _ in 0..20 {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            snapshot_error = Some(std::io::Error::last_os_error());
        } else {
            let mut entry = THREADENTRY32 {
                dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
                ..THREADENTRY32::default()
            };
            let mut has_entry = unsafe { Thread32First(snapshot, &mut entry) } != FALSE;
            while has_entry {
                if entry.th32OwnerProcessID == root_pid {
                    found_thread = Some(entry.th32ThreadID);
                    break;
                }
                has_entry = unsafe { Thread32Next(snapshot, &mut entry) } != FALSE;
            }
            unsafe { CloseHandle(snapshot) };
            if found_thread.is_some() {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    let thread_id = found_thread.ok_or_else(|| {
        if let Some(error) = snapshot_error {
            format!("Failed to enumerate the suspended Windows process {root_pid}: {error}")
        } else {
            format!("Could not find the primary thread for suspended Windows process {root_pid}")
        }
    })?;
    let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, FALSE, thread_id) };
    if thread.is_null() {
        return Err(format!(
            "Failed to open the suspended Windows process thread: {}",
            std::io::Error::last_os_error()
        ));
    }
    let previous_count = unsafe { ResumeThread(thread) };
    unsafe { CloseHandle(thread) };
    if previous_count == u32::MAX {
        return Err(format!(
            "Failed to resume the supervised Windows process: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(windows)]
fn force_kill_process_tree_fallback(root_pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &root_pid.to_string(), "/T", "/F"])
        .status();
}

const LOCAL_SERVER_READY_TIMEOUT: Duration = Duration::from_secs(15);
const CHILD_GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(3);

async fn spawn_local_server(
    cwd: &Path,
    api_key: &str,
) -> Result<(LocalServerHandle, Option<String>), String> {
    let program = local_server_program(cwd)?;
    spawn_local_server_with_program(cwd, api_key, &program, LOCAL_SERVER_READY_TIMEOUT).await
}

async fn spawn_local_server_with_program(
    cwd: &Path,
    api_key: &str,
    server_program: &str,
    ready_timeout: Duration,
) -> Result<(LocalServerHandle, Option<String>), String> {
    validate_local_server_node()?;
    let data_dir = local_server_data_dir(cwd);
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create local Server data directory: {error}"))?;
    let command = build_local_server_command(server_program, &data_dir);
    let mut process = TokioCommand::new(&command.program);
    process
        .args(&command.args)
        .current_dir(cwd)
        .env("BOOTSTRAP_API_KEY", api_key)
        .env("LOCALAPP_DEV_TOOLS", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    let (mut child, process_tree) = ProcessTree::spawn_tokio(&mut process)
        .map_err(|error| format!("Failed to start canonical localapp-server: {error}"))?;
    let Some(stdout) = child.stdout.take() else {
        terminate_tokio_child(&mut child, &process_tree).await;
        return Err("Local Server stdout is unavailable".to_string());
    };
    let mut lines = BufReader::new(stdout).lines();
    let deadline = tokio::time::Instant::now() + ready_timeout;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            terminate_tokio_child(&mut child, &process_tree).await;
            return Err(format!(
                "Local Server readiness timed out after {} ms",
                ready_timeout.as_millis()
            ));
        }
        let next = match tokio::time::timeout(remaining, lines.next_line()).await {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                terminate_tokio_child(&mut child, &process_tree).await;
                return Err(format!("Failed to read local Server readiness: {error}"));
            }
            Err(_) => {
                terminate_tokio_child(&mut child, &process_tree).await;
                return Err(format!(
                    "Local Server readiness timed out after {} ms",
                    ready_timeout.as_millis()
                ));
            }
        };
        let Some(line) = next else {
            terminate_tokio_child(&mut child, &process_tree).await;
            return Err("Local Server exited before readiness".to_string());
        };
        let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if message.get("type").and_then(serde_json::Value::as_str) != Some("ready") {
            continue;
        }
        let Some(listen_url) = message
            .get("listenUrl")
            .and_then(serde_json::Value::as_str)
            .filter(|url| !url.is_empty())
        else {
            terminate_tokio_child(&mut child, &process_tree).await;
            return Err("Local Server readiness did not include its actual listenUrl".to_string());
        };
        let base_url = match validate_dev_listen_url(listen_url) {
            Ok(base_url) => base_url,
            Err(error) => {
                terminate_tokio_child(&mut child, &process_tree).await;
                return Err(error);
            }
        };
        let setup_url = message
            .get("setupUrl")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        tokio::spawn(async move { while lines.next_line().await.ok().flatten().is_some() {} });
        return Ok((
            LocalServerHandle {
                child,
                base_url,
                process_tree,
            },
            setup_url,
        ));
    }
}

fn validate_dev_listen_url(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value)
        .map_err(|_| "Local Server readiness listenUrl is not a valid URL".to_string())?;
    let port = url.port().filter(|port| *port != 0).ok_or_else(|| {
        "Local Server readiness must include a loopback listener port".to_string()
    })?;
    let canonical = format!("http://127.0.0.1:{port}");
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
        || !matches!(value, candidate if candidate == canonical || candidate == format!("{canonical}/"))
    {
        return Err(
            "Local Server readiness must report an exact http://127.0.0.1:<port> loopback listener"
                .to_string(),
        );
    }
    Ok(canonical)
}

async fn stop_local_server(server: &mut LocalServerHandle) {
    terminate_tokio_child(&mut server.child, &server.process_tree).await;
}

async fn terminate_tokio_child(child: &mut TokioChild, process_tree: &ProcessTree) {
    process_tree.signal(false);
    let deadline = tokio::time::Instant::now() + CHILD_GRACEFUL_STOP_TIMEOUT;
    loop {
        let _ = child.try_wait();
        if !process_tree.exists() {
            let _ = child.wait().await;
            return;
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    process_tree.signal(true);
    let _ = child.kill().await;
    let _ = child.wait().await;
    wait_for_process_tree_exit(process_tree).await;
}

async fn terminate_vite_child(child: &mut Child, process_tree: &ProcessTree) {
    process_tree.signal(false);
    let deadline = tokio::time::Instant::now() + CHILD_GRACEFUL_STOP_TIMEOUT;
    loop {
        let _ = child.try_wait();
        if !process_tree.exists() {
            let _ = child.wait();
            return;
        }
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    process_tree.signal(true);
    let _ = child.kill();
    let _ = child.wait();
    wait_for_process_tree_exit(process_tree).await;
}

async fn wait_for_process_tree_exit(process_tree: &ProcessTree) {
    let deadline = tokio::time::Instant::now() + CHILD_GRACEFUL_STOP_TIMEOUT;
    while process_tree.exists() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn supervise_local_dev_with_shutdown<F>(
    server: &mut LocalServerHandle,
    vite: &mut Child,
    vite_process_tree: &ProcessTree,
    shutdown: F,
) -> Result<(), String>
where
    F: std::future::Future<Output = ()>,
{
    tokio::pin!(shutdown);
    enum Outcome {
        Server(ExitStatus),
        Vite(ExitStatus),
        Interrupted,
    }
    let outcome = loop {
        tokio::select! {
            _ = &mut shutdown => break Outcome::Interrupted,
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                match server.child.try_wait() {
                    Ok(Some(status)) => break Outcome::Server(status),
                    Err(error) => {
                        terminate_vite_child(vite, vite_process_tree).await;
                        stop_local_server(server).await;
                        return Err(format!("Failed to monitor local Server: {error}"));
                    }
                    Ok(None) => {}
                }
                match vite.try_wait() {
                    Ok(Some(status)) => break Outcome::Vite(status),
                    Err(error) => {
                        terminate_vite_child(vite, vite_process_tree).await;
                        stop_local_server(server).await;
                        return Err(format!("Failed to monitor Vite: {error}"));
                    }
                    Ok(None) => {}
                }
            }
        }
    };

    match outcome {
        Outcome::Interrupted => {
            terminate_vite_child(vite, vite_process_tree).await;
            stop_local_server(server).await;
            Ok(())
        }
        Outcome::Vite(status) => {
            terminate_vite_child(vite, vite_process_tree).await;
            stop_local_server(server).await;
            if status.success() {
                Ok(())
            } else {
                Err(format!("dev server exited with code: {status}"))
            }
        }
        Outcome::Server(status) => {
            stop_local_server(server).await;
            terminate_vite_child(vite, vite_process_tree).await;
            Err(format!(
                "Local Server exited while Vite was running: {status}"
            ))
        }
    }
}

async fn supervise_local_dev(
    server: &mut LocalServerHandle,
    vite: &mut Child,
    vite_process_tree: &ProcessTree,
) -> Result<(), String> {
    supervise_local_dev_with_shutdown(server, vite, vite_process_tree, async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
}

async fn initialize_local_server(
    base_url: &str,
    setup_url: Option<&str>,
    password: Option<&str>,
) -> Result<(), String> {
    let Some(setup_url) = setup_url else {
        return Ok(());
    };
    let password = password.ok_or("Local Server setup password is unavailable")?;
    let token = reqwest::Url::parse(setup_url)
        .ok()
        .and_then(|url| {
            url.query_pairs()
                .find(|(key, _)| key == "token")
                .map(|(_, value)| value.into_owned())
        })
        .ok_or("Local Server setup URL did not include a token")?;
    let response = reqwest::Client::new()
        .post(format!("{base_url}/api/setup/initialize"))
        .json(&serde_json::json!({
            "token": token,
            "username": DEFAULT_DEV_USER_ID,
            "password": password,
        }))
        .send()
        .await
        .map_err(|error| format!("Failed to initialize local Server: {error}"))?;
    if response.status() != reqwest::StatusCode::CREATED {
        return Err(format!(
            "Local Server setup failed with HTTP {}",
            response.status()
        ));
    }
    Ok(())
}

async fn ensure_local_server_login(
    cwd: &Path,
    base_url: &str,
    setup_url: Option<&str>,
    api_key: &str,
) -> Result<(), String> {
    if setup_url.is_some() {
        let password = local_server_password(cwd)?;
        return initialize_local_server(base_url, setup_url, Some(&password)).await;
    }

    let password_path = local_server_password_path(cwd);
    if read_private_value(&password_path)?.is_some() {
        return Ok(());
    }

    let response = reqwest::Client::new()
        .post(format!("{base_url}/api/admin/reset-password"))
        .header("X-API-Key", api_key)
        .json(&serde_json::json!({ "userId": DEFAULT_DEV_USER_ID }))
        .send()
        .await
        .map_err(|error| format!("Failed to replace legacy local Server password: {error}"))?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to read local Server password-reset response: {error}"))?;
    if status != reqwest::StatusCode::OK || body["success"].as_bool() != Some(true) {
        return Err(body["error"]
            .as_str()
            .unwrap_or("Local Server password reset failed")
            .to_string());
    }
    let password = body["data"]["temporaryPassword"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or("Local Server password reset did not return a temporary password")?;
    write_private_file(&password_path, format!("{password}\n").as_bytes())
}

async fn write_dev_config(
    cwd: &std::path::Path,
    page_name: &str,
    server_url: &str,
    app_server_port: u16,
    api_key: &str,
) -> Result<(), String> {
    let localapp_dir = cwd.join(".localapp");
    fs::create_dir_all(&localapp_dir)
        .map_err(|e| format!("Failed to create .localapp dir: {e}"))?;

    if api_key.is_empty() {
        eprintln!(
            "  Warning: not logged in. Local app APIs keep working; remote platform and AI tools are unavailable until login."
        );
    }
    let config_json = serde_json::json!({
        "serverUrl": server_url,
        "userId": DEFAULT_DEV_USER_ID,
        "pageName": page_name,
        "apiKey": api_key,
        "appServerPort": app_server_port,
    });
    let content = serde_json::to_string_pretty(&config_json)
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    let path = localapp_dir.join("dev-config.json");
    write_private_file(&path, content.as_bytes())?;

    println!("  Dev config written to .localapp/dev-config.json");
    println!("    userId: {DEFAULT_DEV_USER_ID}, pageName: {page_name}");
    println!(
        "    Dev identity stays fixed; use the DevShell identity picker to simulate other users."
    );
    Ok(())
}

pub async fn run() -> Result<(), String> {
    pm::check_available()?;

    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;

    let manifest =
        Manifest::read(&cwd).ok_or("No manifest.json found. Run 'localapp init' first.")?;

    if manifest.name.is_empty() {
        return Err("No name in manifest.json".to_string());
    }

    sync::refresh_for_dev(&cwd)?;

    // Auto-install if node_modules is missing or a freshly synced file dependency is stale.
    if !cwd.join("node_modules").is_dir() {
        eprintln!("node_modules not found, installing dependencies...");
        pm::run_install(&cwd)?;
    } else if runtime_dependencies_stale(&cwd) {
        eprintln!("LocalApp runtime dependencies changed, refreshing dependencies...");
        pm::run_install(&cwd)?;
        refresh_installed_runtime_packages(&cwd)?;
        clear_vite_dependency_cache(&cwd)?;
    }

    println!("Starting dev server for: {}", manifest.name);
    println!("  Project dir: {}", cwd.display());
    let app_server_port = pick_app_server_port()?;
    println!("  App URL:         http://localhost:{app_server_port}/");

    let api_key = local_server_api_key(&cwd)?;
    let (mut local_server, setup_url) = spawn_local_server(&cwd, &api_key).await?;
    if let Err(err) =
        ensure_local_server_login(&cwd, &local_server.base_url, setup_url.as_deref(), &api_key)
            .await
    {
        stop_local_server(&mut local_server).await;
        return Err(err);
    }

    let package_output = cwd
        .join("tmp/localapp-dev/packages")
        .join(format!("{}.localapp", manifest.name));
    let package = match build::build_package_for_dev(&cwd, package_output.to_str()).await {
        Ok(package) => package,
        Err(err) => {
            stop_local_server(&mut local_server).await;
            return Err(err);
        }
    };
    let local_config = Config {
        server_url: local_server.base_url.clone(),
        api_key: api_key.clone(),
    };
    let client = Client::new(&local_config);
    let (status, body) = match client.install_package(&package.path).await {
        Ok(result) => result,
        Err(err) => {
            stop_local_server(&mut local_server).await;
            return Err(format!(
                "Failed to install the dev package on local Server: {err}"
            ));
        }
    };
    if !matches!(status, 200 | 201) || body["success"].as_bool() != Some(true) {
        stop_local_server(&mut local_server).await;
        return Err(body["error"]
            .as_str()
            .unwrap_or("Local Server application install failed")
            .to_string());
    }

    if let Err(err) = write_dev_config(
        &cwd,
        &manifest.name,
        &local_server.base_url,
        app_server_port,
        &api_key,
    )
    .await
    {
        stop_local_server(&mut local_server).await;
        return Err(err);
    }

    println!();
    println!("  Local Server:   {}", local_server.base_url);
    println!(
        "  Local login:    {DEFAULT_DEV_USER_ID} (password stored at {})",
        local_server_password_path(&cwd).display()
    );
    println!(
        "  Formal app API: {}/serve/{}/{}/",
        local_server.base_url, DEFAULT_DEV_USER_ID, manifest.name
    );
    println!("  API proxy:      Vite /api/* -> the same local Server");
    println!();

    let mut vite_command = match pm::dev_command() {
        Ok(command) => command,
        Err(err) => {
            stop_local_server(&mut local_server).await;
            return Err(err);
        }
    };
    let (mut child, vite_process_tree) = match ProcessTree::spawn_std(&mut vite_command) {
        Ok(process) => process,
        Err(err) => {
            stop_local_server(&mut local_server).await;
            return Err(format!("Failed to start Vite dev server: {err}"));
        }
    };

    supervise_local_dev(&mut local_server, &mut child, &vite_process_tree).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::process::Command;
    use tempfile::tempdir;

    fn write_fake_server(dir: &Path, source: &str) -> PathBuf {
        let path = dir.join("fake-server.mjs");
        fs::write(&path, source).unwrap();
        path
    }

    fn spawn_grouped_node(source: &str) -> (Child, ProcessTree) {
        let mut command =
            Command::new(std::env::var("LOCALAPP_NODE_BIN").unwrap_or_else(|_| "node".to_string()));
        command.args(["-e", source]);
        ProcessTree::spawn_std(&mut command).unwrap()
    }

    #[cfg(unix)]
    fn process_is_alive(pid: u32) -> bool {
        if unsafe { libc::kill(pid as i32, 0) } != 0 {
            return false;
        }
        match Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
        {
            Ok(output) if output.status.success() => !String::from_utf8_lossy(&output.stdout)
                .trim_start()
                .starts_with('Z'),
            Ok(_) => false,
            Err(_) => true,
        }
    }

    #[cfg(windows)]
    fn process_is_alive(pid: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid) };
        if process.is_null() {
            return false;
        }
        let mut exit_code = 0;
        let active = unsafe { GetExitCodeProcess(process, &mut exit_code) } != 0
            && exit_code == STILL_ACTIVE as u32;
        unsafe { CloseHandle(process) };
        active
    }

    async fn wait_for_process_exit(pid: u32) -> bool {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        while tokio::time::Instant::now() < deadline {
            if !process_is_alive(pid) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        !process_is_alive(pid)
    }

    #[cfg(unix)]
    fn force_kill_process(pid: u32) {
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    fn force_kill_process(pid: u32) {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status();
    }

    #[cfg(windows)]
    fn windows_acl_is_current_user_only(path: &Path) -> Result<bool, String> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::{ERROR_SUCCESS, LocalFree};
        use windows_sys::Win32::Security::Authorization::{
            EXPLICIT_ACCESS_W, GRANT_ACCESS, GetExplicitEntriesFromAclW, GetNamedSecurityInfoW,
            SE_FILE_OBJECT, SET_ACCESS, TRUSTEE_IS_SID,
        };
        use windows_sys::Win32::Security::{
            ACL, DACL_SECURITY_INFORMATION, EqualSid, GetSecurityDescriptorControl,
            PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED,
        };
        use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;

        let identity = CurrentUserSid::load()?;
        let wide_path = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide_path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut descriptor,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!(
                "Failed to inspect Windows ACL: {}",
                std::io::Error::from_raw_os_error(status as i32)
            ));
        }
        let mut control = 0;
        let mut revision = 0;
        let protected =
            unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) != 0 }
                && control & SE_DACL_PROTECTED != 0;
        let mut count = 0;
        let mut entries: *mut EXPLICIT_ACCESS_W = std::ptr::null_mut();
        let entries_status = unsafe { GetExplicitEntriesFromAclW(dacl, &mut count, &mut entries) };
        let valid = if entries_status == ERROR_SUCCESS && count == 1 && !entries.is_null() {
            let entry = unsafe { &*entries };
            protected
                && entry.Trustee.TrusteeForm == TRUSTEE_IS_SID
                && matches!(entry.grfAccessMode, SET_ACCESS | GRANT_ACCESS)
                && entry.grfAccessPermissions & FILE_ALL_ACCESS == FILE_ALL_ACCESS
                && unsafe { EqualSid(identity.sid(), entry.Trustee.ptstrName.cast()) } != 0
        } else {
            false
        };
        if !entries.is_null() {
            unsafe { LocalFree(entries.cast()) };
        }
        if !descriptor.is_null() {
            unsafe { LocalFree(descriptor.cast()) };
        }
        Ok(valid)
    }

    #[test]
    fn detects_stale_runtime_file_dependencies() {
        let dir = tempdir().unwrap();
        let runtime_dist = dir.path().join(".localapp/runtime/server-core/dist");
        let installed_dist = dir.path().join("node_modules/@localapp/server-core/dist");
        fs::create_dir_all(&runtime_dist).unwrap();
        fs::create_dir_all(&installed_dist).unwrap();
        fs::write(runtime_dist.join("index.js"), "new runtime").unwrap();
        fs::write(installed_dist.join("index.js"), "old runtime").unwrap();

        for (runtime, installed) in [
            ("sdk/core/src", "@localapp/sdk/src"),
            ("sdk/react/src", "@localapp/sdk-react/src"),
            ("sdk/agent/src", "@localapp/sdk-agent/src"),
        ] {
            let runtime_dir = dir.path().join(".localapp/runtime").join(runtime);
            let installed_dir = dir.path().join("node_modules").join(installed);
            fs::create_dir_all(&runtime_dir).unwrap();
            fs::create_dir_all(&installed_dir).unwrap();
            fs::write(runtime_dir.join("index.ts"), "same").unwrap();
            fs::write(installed_dir.join("index.ts"), "same").unwrap();
        }
        for file in [
            "dev-shell.tsx",
            "vite-plugin.mjs",
            "package.json",
            "tsconfig.base.json",
        ] {
            let runtime_file = dir.path().join(".localapp/runtime").join(file);
            let installed_file = dir.path().join("node_modules/@localapp/app-kit").join(file);
            fs::create_dir_all(installed_file.parent().unwrap()).unwrap();
            fs::write(runtime_file, "same").unwrap();
            fs::write(installed_file, "same").unwrap();
        }

        assert!(runtime_dependencies_stale(dir.path()));
        fs::write(installed_dist.join("index.js"), "new runtime").unwrap();
        assert!(!runtime_dependencies_stale(dir.path()));
    }

    #[test]
    fn detects_an_installed_runtime_file_missing_from_the_project_source() {
        let dir = tempdir().unwrap();
        for (runtime, installed) in [
            ("server-core/dist", "@localapp/server-core/dist"),
            ("sdk/core/src", "@localapp/sdk/src"),
            ("sdk/react/src", "@localapp/sdk-react/src"),
            ("sdk/agent/src", "@localapp/sdk-agent/src"),
        ] {
            let runtime_dir = dir.path().join(".localapp/runtime").join(runtime);
            let installed_dir = dir.path().join("node_modules").join(installed);
            fs::create_dir_all(&runtime_dir).unwrap();
            fs::create_dir_all(&installed_dir).unwrap();
            fs::write(runtime_dir.join("index.ts"), "same").unwrap();
            fs::write(installed_dir.join("index.ts"), "same").unwrap();
        }
        for file in [
            "dev-shell.tsx",
            "vite-plugin.mjs",
            "package.json",
            "tsconfig.base.json",
        ] {
            let runtime_file = dir.path().join(".localapp/runtime").join(file);
            let installed_file = dir.path().join("node_modules/@localapp/app-kit").join(file);
            fs::create_dir_all(installed_file.parent().unwrap()).unwrap();
            fs::write(runtime_file, "same").unwrap();
            fs::write(installed_file, "same").unwrap();
        }
        fs::write(
            dir.path()
                .join("node_modules/@localapp/server-core/dist/removed.js"),
            "stale runtime",
        )
        .unwrap();

        assert!(runtime_dependencies_stale(dir.path()));
    }

    #[test]
    fn detects_stale_app_kit_file_dependency() {
        let dir = tempdir().unwrap();
        for (runtime, installed) in [
            ("server-core/dist", "@localapp/server-core/dist"),
            ("sdk/core/src", "@localapp/sdk/src"),
            ("sdk/react/src", "@localapp/sdk-react/src"),
            ("sdk/agent/src", "@localapp/sdk-agent/src"),
        ] {
            let runtime_dir = dir.path().join(".localapp/runtime").join(runtime);
            let installed_dir = dir.path().join("node_modules").join(installed);
            fs::create_dir_all(&runtime_dir).unwrap();
            fs::create_dir_all(&installed_dir).unwrap();
            fs::write(runtime_dir.join("index.ts"), "same").unwrap();
            fs::write(installed_dir.join("index.ts"), "same").unwrap();
        }
        let runtime_shell = dir.path().join(".localapp/runtime/dev-shell.tsx");
        let installed_shell = dir
            .path()
            .join("node_modules/@localapp/app-kit/dev-shell.tsx");
        fs::create_dir_all(installed_shell.parent().unwrap()).unwrap();
        fs::write(&runtime_shell, "new shell").unwrap();
        fs::write(&installed_shell, "old shell").unwrap();
        for file in ["vite-plugin.mjs", "package.json", "tsconfig.base.json"] {
            fs::write(dir.path().join(".localapp/runtime").join(file), "same").unwrap();
            fs::write(
                dir.path().join("node_modules/@localapp/app-kit").join(file),
                "same",
            )
            .unwrap();
        }

        assert!(runtime_dependencies_stale(dir.path()));
        fs::write(installed_shell, "new shell").unwrap();
        assert!(!runtime_dependencies_stale(dir.path()));
    }

    #[test]
    fn detects_stale_nested_app_kit_runtime_files() {
        let dir = tempdir().unwrap();
        for (runtime, installed) in [
            ("server-core/dist", "@localapp/server-core/dist"),
            ("sdk/core/src", "@localapp/sdk/src"),
            ("sdk/react/src", "@localapp/sdk-react/src"),
            ("sdk/agent/src", "@localapp/sdk-agent/src"),
        ] {
            let runtime_dir = dir.path().join(".localapp/runtime").join(runtime);
            let installed_dir = dir.path().join("node_modules").join(installed);
            fs::create_dir_all(&runtime_dir).unwrap();
            fs::create_dir_all(&installed_dir).unwrap();
            fs::write(runtime_dir.join("index.ts"), "same").unwrap();
            fs::write(installed_dir.join("index.ts"), "same").unwrap();
        }
        for file in [
            "dev-shell.tsx",
            "vite-plugin.mjs",
            "package.json",
            "tsconfig.base.json",
        ] {
            let runtime_file = dir.path().join(".localapp/runtime").join(file);
            let installed_file = dir.path().join("node_modules/@localapp/app-kit").join(file);
            fs::create_dir_all(installed_file.parent().unwrap()).unwrap();
            fs::write(runtime_file, "same").unwrap();
            fs::write(installed_file, "same").unwrap();
        }
        let runtime_hook = dir.path().join(".localapp/runtime/hooks/use-mobile.ts");
        let installed_hook = dir
            .path()
            .join("node_modules/@localapp/app-kit/hooks/use-mobile.ts");
        fs::create_dir_all(runtime_hook.parent().unwrap()).unwrap();
        fs::create_dir_all(installed_hook.parent().unwrap()).unwrap();
        fs::write(runtime_hook, "new hook").unwrap();
        fs::write(installed_hook, "old hook").unwrap();

        assert!(runtime_dependencies_stale(dir.path()));
    }

    #[test]
    fn clears_vite_dependency_cache_after_runtime_refresh() {
        let dir = tempdir().unwrap();
        let cache_dir = dir.path().join("node_modules/.vite/deps");
        fs::create_dir_all(&cache_dir).unwrap();
        fs::write(cache_dir.join("style-to-js.js"), "stale optimized module").unwrap();

        clear_vite_dependency_cache(dir.path()).unwrap();

        assert!(!dir.path().join("node_modules/.vite").exists());
        clear_vite_dependency_cache(dir.path()).unwrap();
    }

    #[test]
    fn exact_runtime_refresh_does_not_truncate_pnpm_hard_linked_files() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("runtime");
        let installed = dir.path().join("installed");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&installed).unwrap();
        let package = b"{\"name\":\"@localapp/app-kit\"}\n";
        fs::write(source.join("package.json"), package).unwrap();
        fs::hard_link(source.join("package.json"), installed.join("package.json")).unwrap();
        fs::write(source.join("vite-plugin.mjs"), "new plugin").unwrap();
        fs::write(installed.join("vite-plugin.mjs"), "old plugin").unwrap();

        sync_directory_exact(&source, &installed).unwrap();

        assert_eq!(fs::read(source.join("package.json")).unwrap(), package);
        assert_eq!(fs::read(installed.join("package.json")).unwrap(), package);
        assert_eq!(
            fs::read_to_string(installed.join("vite-plugin.mjs")).unwrap(),
            "new plugin"
        );
    }

    #[tokio::test]
    async fn write_dev_config_uses_canonical_server_credentials() {
        let dir = tempdir().unwrap();

        write_dev_config(
            dir.path(),
            "demo",
            "http://127.0.0.1:3000",
            5182,
            "local-dev-api-key",
        )
        .await
        .unwrap();

        let content = fs::read_to_string(dir.path().join(".localapp/dev-config.json")).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(config["serverUrl"], "http://127.0.0.1:3000");
        assert_eq!(config["pageName"], "demo");
        assert_eq!(config["apiKey"], "local-dev-api-key");
        assert_eq!(config["appServerPort"], 5182);
        assert_eq!(config["userId"], "dev-user");
        assert_eq!(config.as_object().unwrap().len(), 5);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.path().join(".localapp/dev-config.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        #[cfg(windows)]
        assert!(
            windows_acl_is_current_user_only(&dir.path().join(".localapp/dev-config.json"))
                .unwrap()
        );
    }

    #[test]
    fn local_server_api_key_is_csprng_shaped_stable_and_private() {
        let dir = tempdir().unwrap();

        let first = local_server_api_key(dir.path()).unwrap();
        let second = local_server_api_key(dir.path()).unwrap();

        assert_eq!(first, second);
        let random = first
            .strip_prefix("localapp_dev_")
            .expect("credential prefix");
        assert_eq!(random.len(), 64);
        assert!(random.bytes().all(|byte| byte.is_ascii_hexdigit()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.path().join("tmp/localapp-dev/server-api-key"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        #[cfg(windows)]
        assert!(
            windows_acl_is_current_user_only(&dir.path().join("tmp/localapp-dev/server-api-key"))
                .unwrap()
        );
    }

    #[test]
    fn rejects_a_legacy_predictable_local_server_api_key() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tmp/localapp-dev/server-api-key");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "localapp-dev-123-456\n").unwrap();

        let error = local_server_api_key(dir.path()).unwrap_err();

        assert!(error.contains("insecure legacy"));
        assert!(error.contains("tmp/localapp-dev"));
    }

    #[test]
    fn local_server_password_is_random_stable_and_private() {
        let dir = tempdir().unwrap();

        let first = local_server_password(dir.path()).unwrap();
        let second = local_server_password(dir.path()).unwrap();

        assert_eq!(first, second);
        let random = first
            .strip_prefix("localapp_dev_password_")
            .expect("credential prefix");
        assert_eq!(random.len(), 64);
        assert!(random.bytes().all(|byte| byte.is_ascii_hexdigit()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(local_server_password_path(dir.path()))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        #[cfg(windows)]
        assert!(windows_acl_is_current_user_only(&local_server_password_path(dir.path())).unwrap());
    }

    #[test]
    fn app_server_port_avoids_an_occupied_vite_default_port() {
        let listener = TcpListener::bind(("127.0.0.1", 5173)).ok();
        let port = pick_app_server_port().unwrap();

        assert!((5173..=5200).contains(&port));
        if listener.is_some() {
            assert_ne!(port, 5173);
        }
    }

    #[test]
    fn local_server_command_uses_canonical_server_and_project_tmp_data() {
        let dir = tempdir().unwrap();

        let data_dir = dir.path().join("tmp/localapp-dev/server");
        let command = build_local_server_command("localapp-server", &data_dir);

        assert_eq!(command.program, "localapp-server");
        assert_eq!(
            command.args,
            vec![
                "start".to_string(),
                "--data-dir".to_string(),
                data_dir.to_string_lossy().to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                "0".to_string(),
            ],
        );
    }

    #[test]
    fn local_server_command_runs_a_packaged_mjs_launcher_with_node() {
        let dir = tempdir().unwrap();
        let launcher = dir.path().join("localapp-server.mjs");
        let command =
            build_local_server_command(launcher.to_str().unwrap(), &dir.path().join("data"));

        assert_eq!(command.program, "node");
        assert_eq!(
            command.args.first(),
            Some(&launcher.to_string_lossy().to_string())
        );
        assert_eq!(command.args.last(), Some(&"0".to_string()));
    }

    #[test]
    fn resolves_a_project_installed_canonical_server_before_path() {
        let dir = tempdir().unwrap();
        let bin_dir = dir.path().join("node_modules/.bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let server_bin = bin_dir.join(if cfg!(windows) {
            "localapp-server.cmd"
        } else {
            "localapp-server"
        });
        fs::write(&server_bin, "server launcher").unwrap();

        let resolved = resolve_local_server_program_from(
            dir.path(),
            None,
            None,
            Some(std::ffi::OsStr::new("")),
        )
        .unwrap();

        assert_eq!(PathBuf::from(resolved), server_bin);
    }

    #[test]
    fn missing_canonical_server_has_actionable_install_guidance() {
        let dir = tempdir().unwrap();

        let error = resolve_local_server_program_from(
            dir.path(),
            None,
            None,
            Some(std::ffi::OsStr::new("")),
        )
        .unwrap_err();

        assert!(error.contains("@localapp/server"));
        assert!(error.contains("LOCALAPP_SERVER_BIN"));
    }

    #[test]
    fn packaged_server_node_version_requires_major_24_or_newer() {
        assert!(validate_node_version_output("v24.7.0\n").is_ok());
        assert!(validate_node_version_output("v26.0.0\n").is_ok());
        let error = validate_node_version_output("v22.19.0\n").unwrap_err();
        assert!(error.contains("Node.js 24"));
        assert!(validate_node_version_output("not-node").is_err());
    }

    #[test]
    fn local_server_data_dir_is_below_project_tmp() {
        let dir = tempdir().unwrap();
        assert_eq!(
            local_server_data_dir(dir.path()),
            dir.path().join("tmp/localapp-dev/server")
        );
    }

    #[tokio::test]
    async fn local_server_readiness_has_a_bounded_timeout() {
        let dir = tempdir().unwrap();
        let server = write_fake_server(dir.path(), "setInterval(() => {}, 1000);");

        let started = std::time::Instant::now();
        let error = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server.to_str().unwrap(),
            Duration::from_millis(150),
        )
        .await
        .unwrap_err();

        assert!(error.contains("readiness timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn local_server_uses_actual_loopback_listener_instead_of_public_url() {
        let dir = tempdir().unwrap();
        let server = write_fake_server(
            dir.path(),
            r#"console.log(JSON.stringify({type:"ready",url:"https://public.example",listenUrl:"http://127.0.0.1:43127"})); setInterval(() => {}, 1000);"#,
        );

        let (mut handle, _) = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server.to_str().unwrap(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();

        assert_eq!(handle.base_url, "http://127.0.0.1:43127");
        stop_local_server(&mut handle).await;
    }

    #[tokio::test]
    async fn local_server_rejects_a_non_loopback_readiness_listener() {
        let dir = tempdir().unwrap();
        let server = write_fake_server(
            dir.path(),
            r#"console.log(JSON.stringify({type:"ready",url:"https://public.example",listenUrl:"https://public.example"})); setInterval(() => {}, 1000);"#,
        );

        let error = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server.to_str().unwrap(),
            Duration::from_secs(2),
        )
        .await
        .unwrap_err();

        assert!(error.contains("loopback listener"), "got: {error}");
    }

    #[tokio::test]
    async fn server_failure_stops_the_vite_process_tree() {
        let dir = tempdir().unwrap();
        let server_program = write_fake_server(
            dir.path(),
            r#"console.log(JSON.stringify({type:"ready",url:"http://127.0.0.1:43127",listenUrl:"http://127.0.0.1:43127"})); setTimeout(() => process.exit(9), 150);"#,
        );
        let (mut server, _) = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server_program.to_str().unwrap(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        let (mut vite, vite_tree) = spawn_grouped_node("setInterval(() => {}, 1000);");

        let error = supervise_local_dev_with_shutdown(
            &mut server,
            &mut vite,
            &vite_tree,
            std::future::pending(),
        )
        .await
        .unwrap_err();

        assert!(error.contains("Local Server exited"));
        assert!(vite.try_wait().unwrap().is_some());
    }

    #[tokio::test]
    async fn server_exit_kills_a_grandchild_that_ignores_sigterm() {
        let dir = tempdir().unwrap();
        let pid_path = dir.path().join("stubborn-server-grandchild.pid");
        let source = format!(
            r#"import {{ spawn }} from "node:child_process";
	import fs from "node:fs";
	const nested = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {{}}); process.send?.('handler-ready'); setInterval(() => {{}}, 1000);"], {{ stdio: ["ignore", "ignore", "ignore", "ipc"] }});
	nested.once("message", (message) => {{
	  if (message !== "handler-ready") process.exit(91);
	  fs.writeFileSync({}, String(nested.pid));
	  console.log(JSON.stringify({{type:"ready",url:"http://127.0.0.1:43127",listenUrl:"http://127.0.0.1:43127"}}));
	  setTimeout(() => process.exit(9), 25);
	}});"#,
            serde_json::to_string(&pid_path).unwrap(),
        );
        let server_program = write_fake_server(dir.path(), &source);
        let (mut server, _) = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server_program.to_str().unwrap(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        let nested_pid: u32 = fs::read_to_string(&pid_path).unwrap().parse().unwrap();
        let (mut vite, vite_tree) = spawn_grouped_node("setInterval(() => {}, 1000);");

        let error = supervise_local_dev_with_shutdown(
            &mut server,
            &mut vite,
            &vite_tree,
            std::future::pending(),
        )
        .await
        .unwrap_err();
        let gone = wait_for_process_exit(nested_pid).await;
        if !gone {
            force_kill_process(nested_pid);
        }

        assert!(error.contains("Local Server exited"));
        assert!(gone, "stubborn Server grandchild {nested_pid} survived");
    }

    #[tokio::test]
    async fn vite_failure_stops_the_local_server_process_tree() {
        let dir = tempdir().unwrap();
        let server_program = write_fake_server(
            dir.path(),
            r#"console.log(JSON.stringify({type:"ready",url:"http://127.0.0.1:43127",listenUrl:"http://127.0.0.1:43127"})); setInterval(() => {}, 1000);"#,
        );
        let (mut server, _) = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server_program.to_str().unwrap(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        let (mut vite, vite_tree) = spawn_grouped_node("setTimeout(() => process.exit(7), 100);");

        let error = supervise_local_dev_with_shutdown(
            &mut server,
            &mut vite,
            &vite_tree,
            std::future::pending(),
        )
        .await
        .unwrap_err();

        assert!(error.contains("dev server exited"));
        assert!(server.child.try_wait().unwrap().is_some());
    }

    #[tokio::test]
    async fn vite_exit_kills_a_grandchild_that_ignores_sigterm() {
        let dir = tempdir().unwrap();
        let pid_path = dir.path().join("stubborn-vite-grandchild.pid");
        let server_program = write_fake_server(
            dir.path(),
            r#"console.log(JSON.stringify({type:"ready",url:"http://127.0.0.1:43127",listenUrl:"http://127.0.0.1:43127"})); setInterval(() => {}, 1000);"#,
        );
        let (mut server, _) = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server_program.to_str().unwrap(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        let source = format!(
            r#"const {{ spawn }} = require("node:child_process");
	const fs = require("node:fs");
	const nested = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {{}}); process.send?.('handler-ready'); setInterval(() => {{}}, 1000);"], {{ stdio: ["ignore", "ignore", "ignore", "ipc"] }});
	nested.once("message", (message) => {{
	  if (message !== "handler-ready") process.exit(91);
	  fs.writeFileSync({}, String(nested.pid));
	  setTimeout(() => process.exit(0), 25);
	}});"#,
            serde_json::to_string(&pid_path).unwrap(),
        );
        let (mut vite, vite_tree) = spawn_grouped_node(&source);

        supervise_local_dev_with_shutdown(
            &mut server,
            &mut vite,
            &vite_tree,
            std::future::pending(),
        )
        .await
        .unwrap();
        let nested_pid: u32 = fs::read_to_string(&pid_path).unwrap().parse().unwrap();
        let gone = wait_for_process_exit(nested_pid).await;
        if !gone {
            force_kill_process(nested_pid);
        }

        assert!(gone, "stubborn Vite grandchild {nested_pid} survived");
    }

    #[tokio::test]
    async fn normal_vite_exit_stops_the_local_server_process_tree() {
        let dir = tempdir().unwrap();
        let server_program = write_fake_server(
            dir.path(),
            r#"console.log(JSON.stringify({type:"ready",url:"http://127.0.0.1:43127",listenUrl:"http://127.0.0.1:43127"})); setInterval(() => {}, 1000);"#,
        );
        let (mut server, _) = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server_program.to_str().unwrap(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        let (mut vite, vite_tree) = spawn_grouped_node("setTimeout(() => process.exit(0), 100);");

        supervise_local_dev_with_shutdown(
            &mut server,
            &mut vite,
            &vite_tree,
            std::future::pending(),
        )
        .await
        .unwrap();

        assert!(server.child.try_wait().unwrap().is_some());
        assert!(vite.try_wait().unwrap().is_some());
    }

    #[tokio::test]
    async fn interruption_stops_and_waits_for_both_process_trees() {
        let dir = tempdir().unwrap();
        let server_program = write_fake_server(
            dir.path(),
            r#"console.log(JSON.stringify({type:"ready",url:"http://127.0.0.1:43127",listenUrl:"http://127.0.0.1:43127"})); setInterval(() => {}, 1000);"#,
        );
        let (mut server, _) = spawn_local_server_with_program(
            dir.path(),
            "test-key",
            server_program.to_str().unwrap(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        let (mut vite, vite_tree) = spawn_grouped_node("setInterval(() => {}, 1000);");

        supervise_local_dev_with_shutdown(&mut server, &mut vite, &vite_tree, async {
            tokio::time::sleep(Duration::from_millis(100)).await;
        })
        .await
        .unwrap();

        assert!(server.child.try_wait().unwrap().is_some());
        assert!(vite.try_wait().unwrap().is_some());
    }

    #[test]
    fn refreshes_installed_runtime_packages_from_project_runtime_sources() {
        let dir = tempdir().unwrap();
        let source = dir.path().join(".localapp/runtime");
        let installed = dir.path().join("node_modules/@localapp/app-kit");
        fs::create_dir_all(source.join("sdk/core")).unwrap();
        fs::create_dir_all(installed.join("sdk/core")).unwrap();
        fs::write(source.join("vite-plugin.mjs"), "new proxy").unwrap();
        fs::write(source.join("sdk/core/index.ts"), "new sdk").unwrap();
        fs::write(installed.join("vite-plugin.mjs"), "old proxy").unwrap();
        fs::write(installed.join("stale.mjs"), "stale").unwrap();

        refresh_installed_runtime_packages(dir.path()).unwrap();

        assert_eq!(
            fs::read_to_string(installed.join("vite-plugin.mjs")).unwrap(),
            "new proxy"
        );
        assert_eq!(
            fs::read_to_string(installed.join("sdk/core/index.ts")).unwrap(),
            "new sdk"
        );
        assert!(!installed.join("stale.mjs").exists());
    }
}
