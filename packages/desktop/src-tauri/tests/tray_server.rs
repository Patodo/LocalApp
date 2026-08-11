use std::path::PathBuf;
use std::time::Duration;

use localapp_desktop::server_process::{ServerLaunch, ServerProcess};
use localapp_desktop::tray_menu_specs;

#[test]
fn tray_menu_contains_only_open_home_and_exit() {
    assert_eq!(
        tray_menu_specs(),
        [("tray-open-home", "打开主页"), ("tray-exit", "退出本地服务")]
    );
}

#[tokio::test]
async fn server_process_opens_ready_url_and_stops_child() {
    let node = std::env::var_os("LOCALAPP_TEST_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"));
    let script = "process.stdout.write(JSON.stringify({type:'ready',url:'http://127.0.0.1:49813'})+'\\n'); setInterval(()=>{},1000)";
    let mut process = ServerProcess::start(ServerLaunch::command(
        node,
        vec!["-e".into(), script.into()],
        Duration::from_secs(5),
    ))
    .await
    .expect("server child should become ready");
    assert!(process.ready().await.expect("ready state").url.starts_with("http://127.0.0.1:"));
    process.stop().await.expect("server child should stop");
    assert!(!process.is_running());
}
