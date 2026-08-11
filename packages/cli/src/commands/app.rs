use crate::client::Client;
use crate::commands::{build, peer};
use crate::config::resolve_project_target;
use crate::project::Manifest;
use localapp_core::inspect_app_package;
use std::path::{Path, PathBuf};

pub(crate) use super::upload::{
    collect_backend_files_for_manifest, collect_declared_backend_mutations,
    collect_package_source_tree, validate_backend_contract_files, validate_platform_version_range,
};

pub async fn install(target_profile: Option<&str>, package: Option<&str>) -> Result<(), String> {
    let project = std::env::current_dir().map_err(|error| format!("Failed to get cwd: {error}"))?;
    let target = resolve_project_target(target_profile, &project)?;
    let package_path = match package {
        Some(path) => resolve_package_path(path)?,
        None => build::build_package(&project, None).await?.path,
    };
    inspect_app_package(&package_path)
        .map_err(|error| format!("Application package is invalid: {error}"))?;

    let client = Client::new(&target.as_config());
    let (status, response) = client.install_package(&package_path).await?;
    if !matches!(status, 200 | 201) || response["success"].as_bool() != Some(true) {
        return Err(response_error(&response, "Application installation failed"));
    }
    println!(
        "{}",
        serde_json::json!({
            "success": true,
            "operation": "install",
            "package": package_path,
            "target": target.profile_name,
            "serverUrl": target.base_url(),
            "data": response["data"],
        })
    );
    Ok(())
}

pub async fn sync(
    peer_name: &str,
    target_profile: Option<&str>,
    with_data: bool,
    confirmation: Option<&str>,
) -> Result<(), String> {
    let project = std::env::current_dir().map_err(|error| format!("Failed to get cwd: {error}"))?;
    let manifest = Manifest::read_validated(&project)?
        .ok_or_else(|| "No manifest.json found. Run 'localapp init' first.".to_string())?;
    let target = resolve_project_target(target_profile, &project)?;
    peer::sync_application(&target, &manifest.name, peer_name, with_data, confirmation).await
}

fn resolve_package_path(package: &str) -> Result<PathBuf, String> {
    let path = Path::new(package)
        .canonicalize()
        .map_err(|error| format!("Cannot read application package {package}: {error}"))?;
    if path.extension().and_then(|value| value.to_str()) != Some("localapp") {
        return Err("Application package must use the .localapp extension".into());
    }
    Ok(path)
}

fn response_error(response: &serde_json::Value, fallback: &str) -> String {
    response["error"]
        .as_str()
        .or_else(|| response["message"].as_str())
        .unwrap_or(fallback)
        .to_string()
}
