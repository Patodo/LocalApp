pub mod activation;
pub mod device_control_client;
pub mod server_process;

use activation::{ActivationTicket, validate_confirmation_url};
use device_control_client::DeviceControlClient;
use notify_rust::Notification;
use server_process::{ServerLaunch, ServerProcess};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::open_url;
use url::Url;
use uuid::Uuid;

pub struct BridgeState {
    pub server: Mutex<Option<ServerProcess>>,
    pub control_token: String,
    pub quitting: AtomicBool,
}

pub fn tray_menu_specs() -> [(&'static str, &'static str); 2] {
    [
        ("tray-open-home", "打开主页"),
        ("tray-exit", "退出本地服务"),
    ]
}

fn notify_startup_failure(message: &str) {
    let _ = Notification::new()
        .summary("LocalApp 本地服务启动失败")
        .body(message)
        .show();
}

fn setup_server(app: &tauri::App) -> Result<(), String> {
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not locate Server resources: {error}"))?;
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate Server data directory: {error}"))?;
    std::fs::create_dir_all(&data_directory)
        .map_err(|error| format!("Could not create Server data directory: {error}"))?;
    let state = app.state::<BridgeState>();
    let launch = match ServerLaunch::bundled(
        &resource_directory,
        data_directory,
        state.control_token.clone(),
    ) {
        Ok(launch) => launch,
        Err(error) => {
            notify_startup_failure(&error);
            return Err(error);
        }
    };
    let process = match tauri::async_runtime::block_on(ServerProcess::start(launch)) {
        Ok(process) => process,
        Err(error) => {
            notify_startup_failure(&error);
            return Err(error);
        }
    };
    *state
        .server
        .lock()
        .map_err(|_| "Server state is unavailable".to_string())? = Some(process);
    Ok(())
}

fn open_home(app: &AppHandle) {
    let url = app
        .state::<BridgeState>()
        .server
        .lock()
        .ok()
        .and_then(|server| server.as_ref().map(ServerProcess::open_home));
    if let Some(url) = url {
        let _ = open_url(&url, None::<&str>);
    }
}

fn stop_server(app: &AppHandle) {
    let process = app
        .state::<BridgeState>()
        .server
        .lock()
        .ok()
        .and_then(|mut server| server.take());
    if let Some(mut process) = process {
        let _ = tauri::async_runtime::block_on(process.stop());
    }
}

fn forward_activation(app: &AppHandle, raw_url: String) {
    let ticket = match ActivationTicket::parse(&raw_url) {
        Ok(ticket) => ticket,
        Err(_) => return,
    };
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let (ready_origin, control_token) = {
            let state = handle.state::<BridgeState>();
            let Ok(server) = state.server.lock() else {
                return;
            };
            let Some(server) = server.as_ref() else {
                return;
            };
            (server.open_home(), state.control_token.clone())
        };
        let Ok(client) = DeviceControlClient::new(&ready_origin, control_token) else {
            return;
        };
        let Ok(response) = client.activate(&ticket).await else {
            return;
        };
        let Ok(confirmation_url) = validate_confirmation_url(
            &response.confirmation_url,
            &ready_origin,
            &response.request_id,
        ) else {
            return;
        };
        let _ = open_url(&confirmation_url, None::<&str>);
    });
}

fn forward_urls<I>(app: &AppHandle, urls: I)
where
    I: IntoIterator<Item = String>,
{
    for url in urls {
        forward_activation(app, url);
    }
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let specs = tray_menu_specs();
    let open = MenuItem::with_id(app, specs[0].0, specs[0].1, true, None::<&str>)?;
    let exit = MenuItem::with_id(app, specs[1].0, specs[1].1, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;
    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("LocalApp")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open-home" => open_home(app),
            "tray-exit" => {
                let state = app.state::<BridgeState>();
                if !state.quitting.swap(true, Ordering::AcqRel) {
                    stop_server(app);
                    app.exit(0);
                }
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
                open_home(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let state = BridgeState {
        server: Mutex::new(None),
        control_token: Uuid::new_v4().to_string(),
        quitting: AtomicBool::new(false),
    };
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _| {
            forward_urls(app, argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .setup(|app| {
            setup_tray(app)?;
            setup_server(app)?;
            if let Some(urls) = app.deep_link().get_current()? {
                forward_urls(app.handle(), urls.into_iter().map(|url| url.to_string()));
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                forward_urls(&handle, event.urls().iter().map(Url::to_string));
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build LocalApp desktop bridge");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_server(app);
        }
    });
}
