use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopControl {
    endpoint: String,
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInstallOutcome {
    app_id: String,
    version: String,
    upgraded: bool,
    openable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallOutput {
    success: bool,
    app_id: String,
    version: String,
    upgraded: bool,
    openable: bool,
}

pub async fn install(package: &str) -> Result<(), String> {
    let package_path = Path::new(package)
        .canonicalize()
        .map_err(|error| format!("Cannot read application package {package}: {error}"))?;
    if package_path.extension().and_then(|value| value.to_str()) != Some("localapp") {
        return Err("Local install requires a .localapp package".into());
    }
    let control = load_control()?;
    let endpoint = reqwest::Url::parse(&control.endpoint)
        .map_err(|error| format!("Desktop control endpoint is invalid: {error}"))?;
    if endpoint.scheme() != "http"
        || !endpoint
            .host_str()
            .is_some_and(|host| matches!(host, "127.0.0.1" | "::1" | "localhost"))
    {
        return Err("Desktop control endpoint must use loopback HTTP".into());
    }
    let url = endpoint
        .join("/control/apps/install")
        .map_err(|error| format!("Desktop control endpoint is invalid: {error}"))?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Failed to initialize Desktop client: {error}"))?
        .post(url)
        .header("Authorization", format!("Bearer {}", control.token))
        .json(&serde_json::json!({ "packagePath": package_path }))
        .send()
        .await
        .map_err(|_| {
            "LocalApp Desktop is not running. Start Desktop and retry local install.".to_string()
        })?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Desktop returned an invalid response: {error}"))?;
    if !status.is_success() || body["success"].as_bool() != Some(true) {
        return Err(body["error"]
            .as_str()
            .unwrap_or("Desktop rejected the application package")
            .to_string());
    }
    let outcome: DesktopInstallOutcome = serde_json::from_value(body["data"].clone())
        .map_err(|error| format!("Desktop returned an invalid install outcome: {error}"))?;
    let output = InstallOutput {
        success: true,
        app_id: outcome.app_id,
        version: outcome.version,
        upgraded: outcome.upgraded,
        openable: outcome.openable,
    };
    println!(
        "{}",
        serde_json::to_string(&output)
            .map_err(|error| format!("Could not serialize install result: {error}"))?
    );
    Ok(())
}

fn load_control() -> Result<DesktopControl, String> {
    let path = control_path();
    let content = fs::read_to_string(&path).map_err(|_| {
        "LocalApp Desktop is not running. Start Desktop and retry local install.".to_string()
    })?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Desktop control file is invalid: {error}"))
}

fn control_path() -> PathBuf {
    if let Ok(config_dir) = std::env::var("LOCALAPP_CONFIG_DIR") {
        return PathBuf::from(config_dir).join("desktop-control.json");
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join(".localapp")
            .join("work")
            .join("desktop-control.json");
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        return PathBuf::from(home)
            .join(".localapp")
            .join("work")
            .join("desktop-control.json");
    }
    PathBuf::from(".localapp/work/desktop-control.json")
}
