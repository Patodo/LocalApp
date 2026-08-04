#[path = "../src/runner/environment.rs"]
mod environment;

use environment::{
    CommandInstaller, CommandPlan, EnvironmentDescriptor, EnvironmentError, EnvironmentRepository,
    InstallControl, InstallLogger, InstallOutput, Installer,
};
use fs2::FileExt;
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

fn dependencies(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
    entries
        .iter()
        .map(|(name, version)| ((*name).to_string(), (*version).to_string()))
        .collect()
}

#[test]
fn rejects_non_exact_versions_and_accepts_scoped_names() {
    for version in ["^1.2.3", "~1.2.3", ">=1.2.3", "1.2", "latest", "*"] {
        let error = EnvironmentDescriptor::new(
            "https://registry.npmjs.org",
            None,
            dependencies(&[("react", version)]),
        )
        .unwrap_err();
        assert!(error.to_string().contains("exact semantic version"));
    }

    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("@localapp/forms", "1.2.3-beta.1")]),
    )
    .unwrap();
    assert_eq!(
        descriptor.dependencies,
        dependencies(&[("@localapp/forms", "1.2.3-beta.1")])
    );
}

#[test]
fn rejects_invalid_npm_names_and_javascript_unsafe_versions() {
    let long_name = "a".repeat(215);
    let invalid_names = [
        ".",
        "..",
        ".hidden",
        "_private",
        "../escape",
        "scope/package",
        "@scope/../escape",
        "@scope/.hidden",
        "node_modules",
        "favicon.ico",
        "UPPERCASE",
        "has space",
        long_name.as_str(),
    ];
    for name in invalid_names {
        let error = EnvironmentDescriptor::new(
            "https://registry.npmjs.org",
            None,
            dependencies(&[(name, "1.2.3")]),
        )
        .unwrap_err();
        assert!(error.to_string().contains("Invalid npm package name: "));
    }

    for version in [
        "9007199254740992.0.0",
        "1.9007199254740992.0",
        "1.2.9007199254740992",
        "1.2.3-9007199254740992",
    ] {
        let error = EnvironmentDescriptor::new(
            "https://registry.npmjs.org",
            None,
            dependencies(&[("zod", version)]),
        )
        .unwrap_err();
        assert!(error.to_string().contains("exact semantic version"));
    }

    EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("@scope/package", "9007199254740991.0.0")]),
    )
    .unwrap();
}

#[test]
fn descriptor_and_key_are_canonical_and_credential_free() {
    let first = EnvironmentDescriptor::new(
        "HTTPS://REGISTRY.NPMJS.ORG/team",
        Some("http://alice:first-secret@proxy.example:8080"),
        dependencies(&[("zod", "3.25.1"), ("@localapp/forms", "1.2.3")]),
    )
    .unwrap();
    let second = EnvironmentDescriptor::new(
        "https://registry.npmjs.org/team/",
        Some("http://bob:second-secret@PROXY.EXAMPLE:8080/"),
        dependencies(&[("@localapp/forms", "1.2.3"), ("zod", "3.25.1")]),
    )
    .unwrap();

    assert_eq!(first.node_major, 24);
    assert_eq!(first.registry, "https://registry.npmjs.org/team/");
    assert_eq!(first.proxy_identity, second.proxy_identity);
    assert_eq!(first.key(), second.key());
    assert_eq!(first.key().len(), 64);

    let serialized = serde_json::to_string(&first).unwrap();
    assert!(!serialized.contains("alice"));
    assert!(!serialized.contains("first-secret"));
    assert!(serialized.find("@localapp/forms").unwrap() < serialized.find("zod").unwrap());
}

#[test]
fn rejects_registry_credentials() {
    let error = EnvironmentDescriptor::new(
        "https://registry-user:registry-secret@registry.example/npm/",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap_err();
    assert!(error.to_string().contains("must not contain credentials"));
    assert!(!error.to_string().contains("registry-secret"));
}

struct FixtureInstaller {
    calls: AtomicUsize,
    delay: Duration,
    outcomes: Mutex<Vec<Result<BTreeMap<String, String>, String>>>,
    plans: Mutex<Vec<CommandPlan>>,
}

impl FixtureInstaller {
    fn new(outcomes: Vec<Result<BTreeMap<String, String>, String>>) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            delay: Duration::ZERO,
            outcomes: Mutex::new(outcomes.into_iter().rev().collect()),
            plans: Mutex::new(Vec::new()),
        }
    }

    fn delayed(mut self) -> Self {
        self.delay = Duration::from_millis(100);
        self
    }
}

impl Installer for FixtureInstaller {
    fn install(
        &self,
        plan: &CommandPlan,
        log: &mut InstallLogger,
    ) -> Result<InstallOutput, EnvironmentError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.plans.lock().unwrap().push(plan.clone());
        thread::sleep(self.delay);
        match self.outcomes.lock().unwrap().pop().unwrap() {
            Ok(installed) => {
                for (name, version) in installed {
                    let package_directory = plan.install_directory.join("node_modules").join(&name);
                    fs::create_dir_all(&package_directory).unwrap();
                    fs::write(
                        package_directory.join("package.json"),
                        serde_json::to_vec(&serde_json::json!({
                            "name": name,
                            "version": version,
                            "main": "index.js"
                        }))
                        .unwrap(),
                    )
                    .unwrap();
                    fs::write(package_directory.join("index.js"), "module.exports = {};").unwrap();
                }
                log.write_stdout(b"installed\n")?;
                Ok(InstallOutput::success("installed", ""))
            }
            Err(message) => {
                log.write_stderr(message.as_bytes())?;
                Ok(InstallOutput::failure("", &message))
            }
        }
    }
}

#[test]
fn empty_dependency_environment_is_ready_and_reusable() {
    let root = TempDir::new().unwrap();
    let descriptor =
        EnvironmentDescriptor::new("https://registry.npmjs.org", None, BTreeMap::new()).unwrap();
    let installer = FixtureInstaller::new(vec![Ok(BTreeMap::new())]);
    let repository = EnvironmentRepository::new(
        root.path(),
        root.path().join("node"),
        root.path().join("npm-cli.js"),
    )
    .unwrap();

    let first = repository.prepare(&descriptor, None, &installer).unwrap();
    let second = repository.prepare(&descriptor, None, &installer).unwrap();

    assert!(first.path.join("node_modules").is_dir());
    assert!(!first.reused);
    assert!(second.reused);
    assert_eq!(installer.calls.load(Ordering::SeqCst), 1);
}

struct PartialFailureInstaller;

impl Installer for PartialFailureInstaller {
    fn install(
        &self,
        _plan: &CommandPlan,
        log: &mut InstallLogger,
    ) -> Result<InstallOutput, EnvironmentError> {
        log.write_stdout(b"downloaded partial artifact\n")?;
        assert!(
            fs::read_to_string(_plan.install_directory.join("install.log"))
                .unwrap()
                .contains("downloaded partial artifact")
        );
        log.write_stderr(b"proxy-")?;
        log.write_stderr(b"secret\n")?;
        assert!(
            !fs::read_to_string(_plan.install_directory.join("install.log"))
                .unwrap()
                .contains("proxy-secret")
        );
        Ok(InstallOutput::failure("", "proxy-secret"))
    }
}

struct LayoutInstaller<F> {
    calls: AtomicUsize,
    layout: F,
}

impl<F> LayoutInstaller<F> {
    fn new(layout: F) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            layout,
        }
    }
}

impl<F> Installer for LayoutInstaller<F>
where
    F: Fn(&PathBuf) + Send + Sync,
{
    fn install(
        &self,
        plan: &CommandPlan,
        log: &mut InstallLogger,
    ) -> Result<InstallOutput, EnvironmentError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        (self.layout)(&plan.install_directory);
        log.write_stdout(b"installed fixture\n")?;
        Ok(InstallOutput::success("installed fixture", ""))
    }
}

fn write_package(directory: &std::path::Path, manifest: serde_json::Value) {
    fs::create_dir_all(directory).unwrap();
    fs::write(
        directory.join("package.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
}

fn repository(root: &TempDir) -> EnvironmentRepository {
    EnvironmentRepository::new(
        root.path(),
        PathBuf::from("/bundled/node"),
        PathBuf::from("/bundled/npm-cli.js"),
    )
    .unwrap()
}

#[cfg(unix)]
fn write_executable(path: &Path, source: &str) {
    use std::os::unix::fs::PermissionsExt;

    fs::write(path, source).unwrap();
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).unwrap();
}

#[cfg(unix)]
fn find_staging_file(root: &Path, name: &str) -> Option<PathBuf> {
    fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join(name))
        .find(|path| path.is_file())
}

#[cfg(unix)]
fn process_exists(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

#[test]
fn command_plan_uses_bundled_tools_exact_packages_and_proxy_only_in_child_env() {
    let _production_installer = CommandInstaller;
    let root = TempDir::new().unwrap();
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.example/npm",
        Some("http://user:secret@proxy.example:8080"),
        dependencies(&[("@localapp/forms", "1.2.3"), ("zod", "3.25.1")]),
    )
    .unwrap();
    let installer = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);

    repository(&root)
        .prepare(
            &descriptor,
            Some("http://user:secret@proxy.example:8080"),
            &installer,
        )
        .unwrap();

    let plans = installer.plans.lock().unwrap();
    let plan = &plans[0];
    assert!(plan.clear_environment);
    assert_eq!(plan.program, PathBuf::from("/bundled/node"));
    assert_eq!(plan.args[0], "/bundled/npm-cli.js");
    for required in [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
    ] {
        assert!(plan.args.iter().any(|argument| argument == required));
    }
    assert!(
        plan.args
            .iter()
            .any(|argument| argument == "@localapp/forms@1.2.3")
    );
    assert!(plan.args.iter().any(|argument| argument == "zod@3.25.1"));
    assert_eq!(
        plan.environment
            .get("NPM_CONFIG_REGISTRY")
            .map(String::as_str),
        Some("https://registry.example/npm/")
    );
    for key in ["NPM_CONFIG_PROXY", "NPM_CONFIG_HTTPS_PROXY"] {
        assert_eq!(
            plan.environment.get(key).map(String::as_str),
            Some("http://user:secret@proxy.example:8080")
        );
    }
    assert_eq!(
        plan.environment
            .get("NPM_CONFIG_USERCONFIG")
            .map(PathBuf::from),
        Some(plan.install_directory.join(".npmrc"))
    );
    for forbidden in [
        "PATH",
        "NODE_OPTIONS",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NPM_CONFIG_USERCONFIG_FROM_PARENT",
    ] {
        assert!(
            !plan
                .environment
                .keys()
                .any(|key| key.eq_ignore_ascii_case(forbidden)),
            "inherited {forbidden}"
        );
    }
    assert!(!format!("{plan:?}").contains("secret"));
}

#[cfg(unix)]
#[test]
fn command_installer_environment_helper() {
    let Ok(root) = std::env::var("LOCALAPP_TEST_COMMAND_ROOT") else {
        return;
    };
    let node_path = PathBuf::from(std::env::var("LOCALAPP_TEST_COMMAND_NODE").unwrap());
    let proxy = "http://user:secret@proxy.example:8080";
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.example/npm",
        Some(proxy),
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    EnvironmentRepository::new(root, node_path, PathBuf::from("/bundled/npm-cli.js"))
        .unwrap()
        .prepare(&descriptor, Some(proxy), &CommandInstaller)
        .unwrap();
}

#[cfg(unix)]
#[test]
fn command_installer_clears_parent_environment_at_runtime() {
    use std::os::unix::fs::PermissionsExt;

    let root = TempDir::new().unwrap();
    let node_path = root.path().join("node.sh");
    fs::write(
        &node_path,
        r#"#!/bin/sh
/usr/bin/env > "$PWD/observed.env"
/bin/mkdir -p "$PWD/node_modules/zod"
printf '%s' '{"name":"zod","version":"3.25.1","main":"index.js"}' > "$PWD/node_modules/zod/package.json"
printf '%s' 'module.exports = {};' > "$PWD/node_modules/zod/index.js"
"#,
    )
    .unwrap();
    let mut permissions = fs::metadata(&node_path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&node_path, permissions).unwrap();

    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "command_installer_environment_helper",
            "--nocapture",
        ])
        .env("LOCALAPP_TEST_COMMAND_ROOT", root.path())
        .env("LOCALAPP_TEST_COMMAND_NODE", &node_path)
        .env("NODE_OPTIONS", "--require=/parent/injection.js")
        .env("PATH", "/parent/path")
        .env("HTTP_PROXY", "http://parent-http-proxy")
        .env("HTTPS_PROXY", "http://parent-https-proxy")
        .env("NPM_CONFIG_USERCONFIG", "/parent/.npmrc")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());

    let descriptor = EnvironmentDescriptor::new(
        "https://registry.example/npm",
        Some("http://user:secret@proxy.example:8080"),
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let environment =
        fs::read_to_string(root.path().join(descriptor.key()).join("observed.env")).unwrap();
    for forbidden in ["NODE_OPTIONS=", "PATH=", "HTTP_PROXY=", "HTTPS_PROXY="] {
        assert!(!environment.lines().any(|line| line.starts_with(forbidden)));
    }
    assert!(environment.contains("NPM_CONFIG_REGISTRY=https://registry.example/npm/"));
    assert!(environment.contains("NPM_CONFIG_PROXY=http://user:secret@proxy.example:8080"));
    assert!(!environment.contains("NPM_CONFIG_USERCONFIG=/parent/.npmrc"));
}

#[cfg(unix)]
#[test]
fn controlled_command_installer_cancellation_kills_descendants_and_reaps() {
    let root = TempDir::new().unwrap();
    let node_path = root.path().join("long-node.sh");
    write_executable(
        &node_path,
        r#"#!/bin/sh
/bin/sleep 30 &
descendant=$!
/bin/echo "$descendant" > "$PWD/descendant.pid"
wait "$descendant"
"#,
    );
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let cancellation = CancellationToken::new();
    let installer = CommandInstaller::with_control(InstallControl::new(
        cancellation.clone(),
        Instant::now() + Duration::from_secs(30),
    ));
    let repository =
        EnvironmentRepository::new(root.path(), node_path, PathBuf::from("/bundled/npm-cli.js"))
            .unwrap();
    let handle = thread::spawn(move || repository.prepare(&descriptor, None, &installer));

    let wait_started = Instant::now();
    let descendant = loop {
        if let Some(path) = find_staging_file(root.path(), "descendant.pid") {
            if let Ok(pid) = fs::read_to_string(path)
                .unwrap_or_default()
                .trim()
                .parse::<i32>()
            {
                break pid;
            }
        }
        assert!(wait_started.elapsed() < Duration::from_secs(5));
        thread::sleep(Duration::from_millis(10));
    };
    let cancel_started = Instant::now();
    cancellation.cancel();
    let error = handle.join().unwrap().unwrap_err();

    assert!(error.is_cancelled());
    assert!(!error.is_timed_out());
    assert!(cancel_started.elapsed() < Duration::from_secs(3));
    for _ in 0..100 {
        if !process_exists(descendant) {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("npm descendant {descendant} survived cancellation");
}

#[cfg(unix)]
#[test]
fn controlled_command_installer_deadline_returns_timed_out_promptly() {
    let root = TempDir::new().unwrap();
    let node_path = root.path().join("long-node.sh");
    write_executable(&node_path, "#!/bin/sh\n/bin/sleep 30\n");
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let installer = CommandInstaller::with_control(InstallControl::new(
        CancellationToken::new(),
        Instant::now() + Duration::from_millis(250),
    ));
    let repository =
        EnvironmentRepository::new(root.path(), node_path, PathBuf::from("/bundled/npm-cli.js"))
            .unwrap();

    let started = Instant::now();
    let error = repository
        .prepare(&descriptor, None, &installer)
        .unwrap_err();
    assert!(error.is_timed_out());
    assert!(!error.is_cancelled());
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn controlled_installer_cancellation_interrupts_environment_lock_wait() {
    let root = TempDir::new().unwrap();
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let lock_directory = root.path().join(".locks");
    fs::create_dir_all(&lock_directory).unwrap();
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_directory.join(format!("{}.lock", descriptor.key())))
        .unwrap();
    FileExt::lock_exclusive(&lock).unwrap();

    let cancellation = CancellationToken::new();
    let installer = CommandInstaller::with_control(InstallControl::new(
        cancellation.clone(),
        Instant::now() + Duration::from_secs(30),
    ));
    let repository = EnvironmentRepository::new(
        root.path(),
        root.path().join("node"),
        root.path().join("npm-cli.js"),
    )
    .unwrap();
    let handle = thread::spawn(move || repository.prepare(&descriptor, None, &installer));
    thread::sleep(Duration::from_millis(100));
    let started = Instant::now();
    cancellation.cancel();
    let error = handle.join().unwrap().unwrap_err();

    assert!(error.is_cancelled());
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn controlled_installer_deadline_interrupts_environment_lock_wait() {
    let root = TempDir::new().unwrap();
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let lock_directory = root.path().join(".locks");
    fs::create_dir_all(&lock_directory).unwrap();
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_directory.join(format!("{}.lock", descriptor.key())))
        .unwrap();
    FileExt::lock_exclusive(&lock).unwrap();

    let installer = CommandInstaller::with_control(InstallControl::new(
        CancellationToken::new(),
        Instant::now() + Duration::from_millis(150),
    ));
    let repository = EnvironmentRepository::new(
        root.path(),
        root.path().join("node"),
        root.path().join("npm-cli.js"),
    )
    .unwrap();
    let started = Instant::now();
    let error = repository
        .prepare(&descriptor, None, &installer)
        .unwrap_err();

    assert!(error.is_timed_out());
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[cfg(unix)]
#[test]
fn controlled_command_installer_preserves_streamed_logs_on_success() {
    let root = TempDir::new().unwrap();
    let node_path = root.path().join("logging-node.sh");
    write_executable(
        &node_path,
        r#"#!/bin/sh
/bin/echo "install stdout"
/bin/echo "install stderr" >&2
/bin/mkdir -p "$PWD/node_modules/zod"
/usr/bin/printf '%s' '{"name":"zod","version":"3.25.1"}' > "$PWD/node_modules/zod/package.json"
/usr/bin/printf '%s' 'module.exports = {};' > "$PWD/node_modules/zod/index.js"
"#,
    );
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let installer = CommandInstaller::with_control(InstallControl::new(
        CancellationToken::new(),
        Instant::now() + Duration::from_secs(5),
    ));
    let repository =
        EnvironmentRepository::new(root.path(), node_path, PathBuf::from("/bundled/npm-cli.js"))
            .unwrap();

    let prepared = repository.prepare(&descriptor, None, &installer).unwrap();
    let log = fs::read_to_string(prepared.path.join("install.log")).unwrap();
    assert!(log.contains("stdout: install stdout"));
    assert!(log.contains("stderr: install stderr"));
}

#[test]
fn command_installer_windows_job_object_support_is_cfg_guarded() {
    let source = include_str!("../src/runner/environment.rs");
    assert!(source.contains("#[cfg(windows)]\nstruct NpmProcessTree"));
    assert!(source.contains("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE"));
    assert!(source.contains("AssignProcessToJobObject"));
    assert!(source.contains("TerminateJobObject"));
}

#[cfg(windows)]
#[test]
fn windows_job_object_support_compiles() {
    environment::assert_windows_job_object_support();
}

#[test]
fn prepare_revalidates_public_descriptor_fields() {
    let root = TempDir::new().unwrap();
    let invalid_descriptors = [
        EnvironmentDescriptor {
            node_major: 23,
            registry: "https://registry.npmjs.org/".into(),
            proxy_identity: None,
            dependencies: dependencies(&[("zod", "3.25.1")]),
        },
        EnvironmentDescriptor {
            node_major: 24,
            registry: "https://registry.npmjs.org/".into(),
            proxy_identity: None,
            dependencies: dependencies(&[("../escape", "3.25.1")]),
        },
        EnvironmentDescriptor {
            node_major: 24,
            registry: "https://registry.npmjs.org/".into(),
            proxy_identity: None,
            dependencies: dependencies(&[("zod", "9007199254740992.0.0")]),
        },
    ];

    for descriptor in invalid_descriptors {
        let installer = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
        assert!(
            repository(&root)
                .prepare(&descriptor, None, &installer)
                .is_err()
        );
        assert_eq!(installer.calls.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn concurrent_prepare_installs_once_then_reuses_valid_ready_environment() {
    let root = TempDir::new().unwrap();
    let repository = Arc::new(repository(&root));
    let descriptor = Arc::new(
        EnvironmentDescriptor::new(
            "https://registry.npmjs.org",
            None,
            dependencies(&[("zod", "3.25.1")]),
        )
        .unwrap(),
    );
    let installer =
        Arc::new(FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]).delayed());

    let handles: Vec<_> = (0..2)
        .map(|_| {
            let repository = Arc::clone(&repository);
            let descriptor = Arc::clone(&descriptor);
            let installer = Arc::clone(&installer);
            thread::spawn(move || {
                repository
                    .prepare(&descriptor, None, installer.as_ref())
                    .unwrap()
            })
        })
        .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();

    assert_eq!(installer.calls.load(Ordering::SeqCst), 1);
    assert_eq!(results.iter().filter(|result| result.reused).count(), 1);
    assert_eq!(results[0].path, results[1].path);
    assert!(results[0].path.join(".ready.json").is_file());
}

#[test]
fn ready_marker_tree_digest_is_deterministic_and_path_free() {
    let roots = [TempDir::new().unwrap(), TempDir::new().unwrap()];
    let proxy = "http://alice:marker-secret@proxy.example:8080";
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        Some(proxy),
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let mut markers = Vec::new();

    for (index, root) in roots.iter().enumerate() {
        let installer = LayoutInstaller::new(move |directory: &PathBuf| {
            let package = directory.join("node_modules/zod");
            write_package(
                &package,
                serde_json::json!({"name": "zod", "version": "3.25.1"}),
            );
            let files = if index == 0 {
                [("a.js", "a"), ("b.js", "b")]
            } else {
                [("b.js", "b"), ("a.js", "a")]
            };
            for (name, contents) in files {
                fs::write(package.join(name), contents).unwrap();
            }
        });
        let prepared = repository(root)
            .prepare(&descriptor, Some(proxy), &installer)
            .unwrap();
        markers.push(fs::read_to_string(prepared.path.join(".ready.json")).unwrap());
    }

    let first: serde_json::Value = serde_json::from_str(&markers[0]).unwrap();
    let second: serde_json::Value = serde_json::from_str(&markers[1]).unwrap();
    assert_eq!(first["treeDigest"], second["treeDigest"]);
    assert_eq!(first["treeDigest"].as_str().unwrap().len(), 64);
    for (root, marker) in roots.iter().zip(markers) {
        assert!(!marker.contains(root.path().to_str().unwrap()));
        assert!(!marker.contains("alice"));
        assert!(!marker.contains("marker-secret"));
    }
}

#[test]
fn abrupt_lock_holder_helper() {
    let Ok(lock_path) = std::env::var("LOCALAPP_TEST_LOCK_PATH") else {
        return;
    };
    let ready_path = std::env::var("LOCALAPP_TEST_LOCK_READY").unwrap();
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)
        .unwrap();
    lock.lock_exclusive().unwrap();
    fs::write(ready_path, b"locked").unwrap();
    thread::sleep(Duration::from_millis(350));
    std::process::exit(17);
}

#[test]
fn cross_process_abrupt_exit_releases_environment_lock() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let lock_directory = root.path().join(".locks");
    fs::create_dir_all(&lock_directory).unwrap();
    let lock_path = lock_directory.join(format!("{}.lock", descriptor.key()));
    let ready_path = root.path().join("holder-ready");
    let mut holder = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "abrupt_lock_holder_helper", "--nocapture"])
        .env("LOCALAPP_TEST_LOCK_PATH", &lock_path)
        .env("LOCALAPP_TEST_LOCK_READY", &ready_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let wait_started = Instant::now();
    while !ready_path.is_file() {
        assert!(wait_started.elapsed() < Duration::from_secs(5));
        thread::sleep(Duration::from_millis(10));
    }

    let installer = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    let prepare_started = Instant::now();
    let prepared = repository.prepare(&descriptor, None, &installer).unwrap();
    let status = holder.wait().unwrap();

    assert!(!status.success());
    assert!(prepare_started.elapsed() >= Duration::from_millis(200));
    assert!(!prepared.reused);
    assert_eq!(installer.calls.load(Ordering::SeqCst), 1);
}

#[test]
fn failed_partial_is_nonready_retained_and_redacted_then_reinstalled() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let proxy = "http://alice:proxy-secret@proxy.example:8080";
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        Some(proxy),
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let installer = FixtureInstaller::new(vec![
        Err(format!("npm failed via {proxy}; password=proxy-secret")),
        Ok(descriptor.dependencies.clone()),
    ]);

    let error = repository
        .prepare(&descriptor, Some(proxy), &installer)
        .unwrap_err();
    assert!(!error.to_string().contains("proxy-secret"));
    let successful = repository
        .prepare(&descriptor, Some(proxy), &installer)
        .unwrap();
    assert!(!successful.reused);
    assert_eq!(installer.calls.load(Ordering::SeqCst), 2);

    let logs = fs::read_dir(root.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("install.log"))
        .filter(|path| path.is_file())
        .map(|path| fs::read_to_string(path).unwrap())
        .collect::<Vec<_>>();
    assert!(logs.iter().any(|log| log.contains("[REDACTED]")));
    assert!(
        logs.iter()
            .all(|log| !log.contains("alice") && !log.contains("proxy-secret"))
    );
}

#[test]
fn decoded_proxy_credentials_are_redacted_from_logs_and_errors() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let proxy = "http://alice:proxy%20secret@proxy.example:8080";
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        Some(proxy),
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let installer = FixtureInstaller::new(vec![Err("decoded password: proxy secret".into())]);

    let error = repository
        .prepare(&descriptor, Some(proxy), &installer)
        .unwrap_err();
    assert!(!error.to_string().contains("proxy secret"));
    let log = fs::read_dir(root.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("install.log"))
        .find(|path| path.is_file())
        .map(|path| fs::read_to_string(path).unwrap())
        .unwrap();
    assert!(!log.contains("proxy secret"));
    assert!(log.contains("[REDACTED]"));
}

#[test]
fn install_log_is_streamed_and_redacted_before_installer_returns() {
    let root = TempDir::new().unwrap();
    let proxy = "http://alice:proxy-secret@proxy.example:8080";
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        Some(proxy),
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();

    let error = repository(&root)
        .prepare(&descriptor, Some(proxy), &PartialFailureInstaller)
        .unwrap_err();
    assert!(!error.to_string().contains("proxy-secret"));
    let log_path = fs::read_dir(root.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("install.log"))
        .find(|path| path.is_file())
        .unwrap();
    let log = fs::read_to_string(log_path).unwrap();
    assert!(log.contains("downloaded partial artifact"));
    assert!(log.contains("[REDACTED]"));
    assert!(!log.contains("proxy-secret"));
}

#[test]
fn failed_install_finishes_log_before_syncing_staging_directory() {
    let source = include_str!("../src/runner/environment.rs");
    let helper = source
        .split("fn finish_failed_install")
        .nth(1)
        .expect("failed installs should share a durability helper");
    let finish = helper.find("log.finish()?").unwrap();
    let sync = helper.find("sync_directory(staging)").unwrap();
    assert!(finish < sync);
}

#[test]
fn resolved_version_mismatch_never_becomes_ready() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let mismatch = FixtureInstaller::new(vec![Ok(dependencies(&[("zod", "3.24.0")]))]);

    let error = repository
        .prepare(&descriptor, None, &mismatch)
        .unwrap_err();
    assert!(error.to_string().contains("resolved version mismatch"));
    assert!(
        !root
            .path()
            .join(descriptor.key())
            .join(".ready.json")
            .exists()
    );

    let correct = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    let result = repository.prepare(&descriptor, None, &correct).unwrap();
    assert!(!result.reused);
    assert_eq!(correct.calls.load(Ordering::SeqCst), 1);
}

#[test]
fn corrupted_ready_marker_or_direct_package_is_not_reused() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    fs::write(prepared.path.join(".ready.json"), b"not json").unwrap();

    let second = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    let repaired = repository.prepare(&descriptor, None, &second).unwrap();
    assert!(!repaired.reused);
    assert_eq!(second.calls.load(Ordering::SeqCst), 1);

    fs::write(
        repaired.path.join("node_modules/zod/package.json"),
        br#"{"version":"0.0.0"}"#,
    )
    .unwrap();
    let third = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &third)
            .unwrap()
            .reused
    );
}

#[test]
fn ready_cache_rejects_package_identity_mismatch() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    fs::write(
        prepared.path.join("node_modules/zod/package.json"),
        br#"{"name":"not-zod","version":"3.25.1","main":"index.js"}"#,
    )
    .unwrap();

    let repair = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &repair)
            .unwrap()
            .reused
    );
    assert_eq!(repair.calls.load(Ordering::SeqCst), 1);
}

#[test]
fn direct_dependencies_accept_node_entry_point_variants() {
    let manifests = [
        serde_json::json!({"name": "zod", "version": "3.25.1", "main": "entry"}),
        serde_json::json!({"name": "zod", "version": "3.25.1", "main": "dist"}),
        serde_json::json!({
            "name": "zod",
            "version": "3.25.1",
            "exports": {".": {"browser": "./missing-browser.js", "node": "./node.js"}}
        }),
    ];

    for manifest in manifests {
        let root = TempDir::new().unwrap();
        let descriptor = EnvironmentDescriptor::new(
            "https://registry.npmjs.org",
            None,
            dependencies(&[("zod", "3.25.1")]),
        )
        .unwrap();
        let installer = LayoutInstaller::new(move |directory: &PathBuf| {
            let package = directory.join("node_modules/zod");
            write_package(&package, manifest.clone());
            fs::write(package.join("entry"), "module.exports = {};").unwrap();
            fs::create_dir_all(package.join("dist")).unwrap();
            fs::write(package.join("dist/index.js"), "module.exports = {};").unwrap();
            fs::write(package.join("node.js"), "module.exports = {};").unwrap();
        });

        let prepared = repository(&root)
            .prepare(&descriptor, None, &installer)
            .unwrap();
        assert!(!prepared.reused);
    }
}

#[test]
fn ready_cache_rejects_modified_internal_javascript() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = LayoutInstaller::new(|directory: &PathBuf| {
        let package = directory.join("node_modules/zod");
        write_package(
            &package,
            serde_json::json!({"name": "zod", "version": "3.25.1"}),
        );
        fs::write(package.join("index.js"), "module.exports = {};").unwrap();
        fs::write(package.join("lib.js"), "module.exports = 1;").unwrap();
    });
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    fs::write(
        prepared.path.join("node_modules/zod/lib.js"),
        "module.exports = 2;",
    )
    .unwrap();

    let repair = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &repair)
            .unwrap()
            .reused
    );
    assert_eq!(repair.calls.load(Ordering::SeqCst), 1);
}

#[test]
fn ready_cache_rejects_modified_transitive_dependency_file() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = LayoutInstaller::new(|directory: &PathBuf| {
        let direct = directory.join("node_modules/zod");
        write_package(
            &direct,
            serde_json::json!({"name": "zod", "version": "3.25.1"}),
        );
        fs::write(direct.join("index.js"), "module.exports = {};").unwrap();
        let transitive = directory.join("node_modules/transitive");
        write_package(
            &transitive,
            serde_json::json!({"name": "transitive", "version": "1.0.0"}),
        );
        fs::write(transitive.join("data.txt"), "original").unwrap();
    });
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    fs::write(
        prepared.path.join("node_modules/transitive/data.txt"),
        "tampered",
    )
    .unwrap();

    let repair = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &repair)
            .unwrap()
            .reused
    );
    assert_eq!(repair.calls.load(Ordering::SeqCst), 1);
}

#[test]
fn direct_native_addon_prevents_ready_environment() {
    assert_native_addon_rejected("node_modules/zod/addon.node");
}

#[test]
fn transitive_native_addon_prevents_ready_environment() {
    assert_native_addon_rejected("node_modules/transitive/build/addon.node");
}

fn assert_native_addon_rejected(addon: &'static str) {
    let root = TempDir::new().unwrap();
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let installer = LayoutInstaller::new(move |directory: &PathBuf| {
        write_package(
            &directory.join("node_modules/zod"),
            serde_json::json!({"name": "zod", "version": "3.25.1"}),
        );
        fs::write(
            directory.join("node_modules/zod/index.js"),
            "module.exports = {};",
        )
        .unwrap();
        let addon = directory.join(addon);
        fs::create_dir_all(addon.parent().unwrap()).unwrap();
        fs::write(addon, b"native").unwrap();
    });

    let error = repository(&root)
        .prepare(&descriptor, None, &installer)
        .unwrap_err();
    assert!(error.to_string().contains("Dependency environment"));
    assert!(
        !root
            .path()
            .join(descriptor.key())
            .join(".ready.json")
            .exists()
    );
}

#[cfg(unix)]
#[test]
fn ready_cache_rejects_symlinked_package_directory() {
    use std::os::unix::fs::symlink;

    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    let package = prepared.path.join("node_modules/zod");
    let external = root.path().join("external-zod");
    fs::rename(&package, &external).unwrap();
    symlink(&external, &package).unwrap();

    let repair = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &repair)
            .unwrap()
            .reused
    );
}

#[cfg(unix)]
#[test]
fn ready_cache_rejects_symlink_inside_transitive_dependency() {
    use std::os::unix::fs::symlink;

    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = LayoutInstaller::new(|directory: &PathBuf| {
        write_package(
            &directory.join("node_modules/zod"),
            serde_json::json!({"name": "zod", "version": "3.25.1"}),
        );
        fs::write(
            directory.join("node_modules/zod/index.js"),
            "module.exports = {};",
        )
        .unwrap();
        let transitive = directory.join("node_modules/transitive");
        write_package(
            &transitive,
            serde_json::json!({"name": "transitive", "version": "1.0.0"}),
        );
        fs::write(transitive.join("lib.js"), "module.exports = {};").unwrap();
    });
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    let transitive_file = prepared.path.join("node_modules/transitive/lib.js");
    let external = root.path().join("external-lib.js");
    fs::rename(&transitive_file, &external).unwrap();
    symlink(&external, &transitive_file).unwrap();

    let repair = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &repair)
            .unwrap()
            .reused
    );
    assert_eq!(repair.calls.load(Ordering::SeqCst), 1);
}

#[cfg(unix)]
#[test]
fn ready_cache_rejects_symlinked_ready_marker() {
    use std::os::unix::fs::symlink;

    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    let marker = prepared.path.join(".ready.json");
    let external = root.path().join("external-ready.json");
    fs::rename(&marker, &external).unwrap();
    symlink(&external, &marker).unwrap();

    let repair = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &repair)
            .unwrap()
            .reused
    );
}

#[cfg(windows)]
#[test]
fn ready_cache_rejects_junctioned_package_directory() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    let package = prepared.path.join("node_modules/zod");
    let external = root.path().join("external-zod");
    fs::rename(&package, &external).unwrap();
    let status = std::process::Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            package.to_str().unwrap(),
            external.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    assert!(status.success());

    let repair = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &repair)
            .unwrap()
            .reused
    );
}

#[cfg(windows)]
#[test]
fn ready_cache_rejects_junction_inside_transitive_dependency() {
    let root = TempDir::new().unwrap();
    let repository = repository(&root);
    let descriptor = EnvironmentDescriptor::new(
        "https://registry.npmjs.org",
        None,
        dependencies(&[("zod", "3.25.1")]),
    )
    .unwrap();
    let first = LayoutInstaller::new(|directory: &PathBuf| {
        write_package(
            &directory.join("node_modules/zod"),
            serde_json::json!({"name": "zod", "version": "3.25.1"}),
        );
        let transitive = directory.join("node_modules/transitive");
        write_package(
            &transitive,
            serde_json::json!({"name": "transitive", "version": "1.0.0"}),
        );
        fs::create_dir_all(transitive.join("lib")).unwrap();
        fs::write(transitive.join("lib/index.js"), "module.exports = {};").unwrap();
    });
    let prepared = repository.prepare(&descriptor, None, &first).unwrap();
    let transitive_lib = prepared.path.join("node_modules/transitive/lib");
    let external = root.path().join("external-transitive-lib");
    fs::rename(&transitive_lib, &external).unwrap();
    let status = std::process::Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            transitive_lib.to_str().unwrap(),
            external.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    assert!(status.success());

    let repair = FixtureInstaller::new(vec![Ok(descriptor.dependencies.clone())]);
    assert!(
        !repository
            .prepare(&descriptor, None, &repair)
            .unwrap()
            .reused
    );
    assert_eq!(repair.calls.load(Ordering::SeqCst), 1);
}
