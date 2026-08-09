use localapp_desktop::local_runtime::{
    LocalRuntimeController, LocalRuntimeLaunch, LocalRuntimeStatus,
};
use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tempfile::TempDir;

#[tokio::test]
async fn starts_waits_for_ready_and_stops_without_restarting() {
    let fixture = RuntimeFixture::new(false);
    let controller = LocalRuntimeController::new(fixture.launch());

    let ready = controller.start().await.unwrap();
    assert_eq!(ready.host, "127.0.0.1");
    assert_eq!(ready.port, 43127);
    assert!(matches!(
        controller.snapshot().await.status,
        LocalRuntimeStatus::Running
    ));

    controller.stop().await.unwrap();
    tokio::time::sleep(Duration::from_millis(350)).await;
    let stopped = controller.snapshot().await;
    assert_eq!(stopped.status, LocalRuntimeStatus::Stopped);
    assert_eq!(stopped.restart_count, 0);
}

#[tokio::test]
async fn rate_limits_crash_restarts_and_exposes_the_failure() {
    let fixture = RuntimeFixture::new(true);
    let controller = LocalRuntimeController::new(fixture.launch());
    controller.start().await.unwrap();

    tokio::time::sleep(Duration::from_millis(1_600)).await;
    let snapshot = controller.snapshot().await;
    assert_eq!(snapshot.status, LocalRuntimeStatus::Failed);
    assert_eq!(snapshot.restart_count, 3);
    assert!(snapshot.error.unwrap().contains("restart limit"));
}

#[test]
fn localhost_resolution_tolerates_system_resolver_misses_but_rejects_non_loopback_addresses() {
    localapp_desktop::local_runtime::validate_localhost_resolution_with("notes-app", |_| {
        Err("name resolution failed".into())
    })
    .unwrap();
    localapp_desktop::local_runtime::validate_localhost_resolution_with("notes-app", |_| {
        Ok(Vec::new())
    })
    .unwrap();

    let non_loopback =
        localapp_desktop::local_runtime::validate_localhost_resolution_with("notes-app", |_| {
            Ok(vec![SocketAddr::new(
                IpAddr::V4(Ipv4Addr::new(192, 0, 2, 10)),
                0,
            )])
        })
        .unwrap_err();
    assert!(non_loopback.contains("notes-app.localhost"));
    assert!(non_loopback.contains("loopback"));
}

#[tokio::test]
async fn maintenance_stops_the_runtime_and_serializes_concurrent_installers_before_resuming() {
    let fixture = RuntimeFixture::new(false);
    let controller = LocalRuntimeController::new(fixture.launch());
    controller.start().await.unwrap();
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));

    let operations = (0..2).map(|_| {
        let controller = controller.clone();
        let active = Arc::clone(&active);
        let peak = Arc::clone(&peak);
        tokio::spawn(async move {
            controller
                .with_quiesced_runtime(|| async {
                    assert_eq!(
                        controller.snapshot().await.status,
                        LocalRuntimeStatus::Stopped,
                        "database maintenance must not race a live sql.js process"
                    );
                    let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(current, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(80)).await;
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok::<_, String>(())
                })
                .await
        })
    });
    for operation in operations {
        operation.await.unwrap().unwrap();
    }

    assert_eq!(peak.load(Ordering::SeqCst), 1);
    assert_eq!(
        controller.snapshot().await.status,
        LocalRuntimeStatus::Running
    );
    controller.stop().await.unwrap();
}

#[tokio::test]
async fn maintenance_waits_for_an_in_flight_app_open_sequence() {
    let fixture = RuntimeFixture::new(false);
    let controller = LocalRuntimeController::new(fixture.launch());
    controller.start().await.unwrap();
    let access_started = Arc::new(tokio::sync::Notify::new());
    let release_access = Arc::new(tokio::sync::Notify::new());

    let access = {
        let controller = controller.clone();
        let access_started = Arc::clone(&access_started);
        let release_access = Arc::clone(&release_access);
        tokio::spawn(async move {
            controller
                .with_runtime_access(|| async {
                    access_started.notify_one();
                    release_access.notified().await;
                    Ok::<_, String>(())
                })
                .await
        })
    };
    access_started.notified().await;

    let maintenance_entered = Arc::new(AtomicUsize::new(0));
    let maintenance = {
        let controller = controller.clone();
        let maintenance_entered = Arc::clone(&maintenance_entered);
        tokio::spawn(async move {
            controller
                .with_quiesced_runtime(|| async {
                    maintenance_entered.store(1, Ordering::SeqCst);
                    Ok::<_, String>(())
                })
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(maintenance_entered.load(Ordering::SeqCst), 0);

    release_access.notify_one();
    access.await.unwrap().unwrap();
    maintenance.await.unwrap().unwrap();
    assert_eq!(maintenance_entered.load(Ordering::SeqCst), 1);
    controller.stop().await.unwrap();
}

struct RuntimeFixture {
    _root: TempDir,
    script: PathBuf,
    registry: PathBuf,
}

impl RuntimeFixture {
    fn new(crash: bool) -> Self {
        let root = TempDir::new().unwrap();
        let script = root.path().join("runtime.mjs");
        let registry = root.path().join("registry.json");
        fs::write(&registry, r#"{"schemaVersion":1,"apps":[]}"#).unwrap();
        fs::write(
            &script,
            format!(
                r#"
if (!process.env.LOCALAPP_LOCAL_REGISTRY || !process.env.LOCALAPP_LOCAL_CONTROL_TOKEN) {{
  process.exit(9);
}}
process.stdout.write(JSON.stringify({{
  type: "ready", host: "127.0.0.1", port: 43127, pid: process.pid
}}) + "\n");
if ({crash}) {{
  setTimeout(() => process.exit(17), 40);
}} else {{
  setInterval(() => {{}}, 1000);
}}
"#
            ),
        )
        .unwrap();
        Self {
            _root: root,
            script,
            registry,
        }
    }

    fn launch(&self) -> LocalRuntimeLaunch {
        LocalRuntimeLaunch {
            node: PathBuf::from("node"),
            script: self.script.clone(),
            registry: self.registry.clone(),
            control_token: "test-control-token".into(),
            port: 0,
            ready_timeout: Duration::from_secs(5),
            restart_delay: Duration::from_millis(150),
            restart_limit: 3,
            resources: PathBuf::new(),
        }
    }
}
