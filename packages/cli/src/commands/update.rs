use crate::client::Client;
use crate::config::Config;
use localapp_core::write_verified_release_asset;
use semver::Version;
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

const VERSION: &str = match option_env!("LOCALAPP_CLI_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};
const MAX_RELEASE_ASSET_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Deserialize)]
struct CliVersionResponse {
    latest: String,
    assets: Vec<CliReleaseAsset>,
}

#[derive(Deserialize)]
struct CliReleaseAsset {
    kind: String,
    version: String,
    os: String,
    arch: String,
    size: u64,
    sha256: String,
    url: String,
}

struct DownloadRequest {
    url: String,
    headers: HashMap<String, String>,
}

struct DownloadRequestPlan {
    discovery: DownloadRequest,
    asset: DownloadRequest,
}

fn platform_os() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        other => other,
    }
}

fn platform_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => other,
    }
}

fn current_exe_path() -> Result<PathBuf, String> {
    env::current_exe().map_err(|e| format!("Failed to get current exe path: {e}"))
}

fn is_update_available(current: &str, latest: &str) -> Result<bool, String> {
    let current =
        Version::parse(current).map_err(|e| format!("Failed to parse current CLI version: {e}"))?;
    let latest =
        Version::parse(latest).map_err(|e| format!("Failed to parse latest CLI version: {e}"))?;
    Ok(current < latest)
}

pub async fn run() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);

    // Clean up old backup from previous update
    cleanup_old_backup()?;

    // Check latest version
    let (status, body) = client.get("/api/cli/version").await?;
    if status != 200 {
        let err = body["error"].as_str().unwrap_or("Failed to check version");
        return Err(err.to_string());
    }

    let vr: CliVersionResponse =
        serde_json::from_value(body).map_err(|e| format!("Failed to parse version info: {e}"))?;

    if !is_update_available(VERSION, &vr.latest)? {
        let output = serde_json::json!({
            "success": true,
            "message": format!("Already up to date (v{})", vr.latest),
        });
        println!("{output}");
        return Ok(());
    }

    let target_os = platform_os();
    let target_arch = platform_arch();
    let asset = vr
        .assets
        .iter()
        .find(|asset| {
            asset.kind == "cli"
                && asset.version == vr.latest
                && asset.os == target_os
                && asset.arch == target_arch
        })
        .ok_or_else(|| {
            format!(
                "CLI_ASSET_NOT_FOUND: no release asset for {}/{}/{}",
                vr.latest, target_os, target_arch
            )
        })?;
    if asset.size == 0 || asset.size > MAX_RELEASE_ASSET_BYTES {
        return Err("Release integrity error: asset size is outside the supported range".into());
    }

    let url = format!(
        "{}/api/cli/download?os={}&arch={}",
        config.base_url(),
        target_os,
        target_arch,
    );

    let allow_insecure_loopback = allow_insecure_loopback_asset(&asset.url);
    let plan = build_download_request_plan_with_policy(
        &url,
        &config.api_key,
        &asset.url,
        !allow_insecure_loopback,
    )?;
    let bytes = download_release_bytes(&plan, asset.size, allow_insecure_loopback).await?;

    let exe_path = current_exe_path()?;
    let tmp_path = exe_path.with_extension("download");
    write_verified_release_asset(&tmp_path, &bytes, asset.size, &asset.sha256)
        .map_err(|e| format!("Release integrity error: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&tmp_path)
            .map_err(|e| format!("Failed to read update permissions: {e}"))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&tmp_path, permissions)
            .map_err(|e| format!("Failed to set update permissions: {e}"))?;
    }

    if cfg!(windows) {
        let old_path = exe_path.with_extension("old.exe");
        fs::rename(&exe_path, &old_path)
            .map_err(|e| format!("Failed to replace current exe: {e}"))?;
        if let Err(error) = fs::rename(&tmp_path, &exe_path) {
            let _ = fs::rename(&old_path, &exe_path);
            return Err(format!("Failed to install update: {error}"));
        }
    } else {
        fs::rename(&tmp_path, &exe_path).map_err(|e| format!("Failed to install update: {e}"))?;
    }

    let output = serde_json::json!({
        "success": true,
        "version": vr.latest,
    });
    println!("{output}");
    Ok(())
}

async fn download_release_bytes(
    plan: &DownloadRequestPlan,
    expected_size: u64,
    allow_insecure_for_test: bool,
) -> Result<Vec<u8>, String> {
    let discovery_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Download client failed: {e}"))?;
    let discovery = discovery_client
        .get(&plan.discovery.url)
        .headers(to_header_map(&plan.discovery.headers)?)
        .send()
        .await
        .map_err(|e| format!("Download discovery failed: {e}"))?;
    if !discovery.status().is_redirection() {
        return Err(format!(
            "Download discovery failed: expected a redirect, got {}",
            discovery.status()
        ));
    }
    let location = discovery
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Download discovery failed: redirect location is missing".to_string())?;
    if location != plan.asset.url {
        return Err(
            "Download discovery failed: redirect target did not match the validated asset"
                .to_string(),
        );
    }

    let asset_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many release redirects");
            }
            if attempt.url().scheme() == "https" || allow_insecure_for_test {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Download client failed: {e}"))?;
    let mut resp = asset_client
        .get(&plan.asset.url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !resp.status().is_success() {
        let err = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v["error"].as_str().map(String::from))
            .unwrap_or_else(|| "Download failed".to_string());
        return Err(err);
    }

    if resp.url().scheme() != "https" && !allow_insecure_for_test {
        return Err("Download failed: release redirect did not resolve to HTTPS".to_string());
    }
    if let Some(length) = resp.content_length()
        && length != expected_size
    {
        return Err(format!(
            "Release integrity error: expected {} bytes, got {length}",
            expected_size
        ));
    }
    let capacity = usize::try_from(expected_size)
        .map_err(|_| "Release integrity error: asset is too large for this platform".to_string())?;
    let mut bytes = Vec::with_capacity(capacity);
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Download failed: {e}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > capacity {
            return Err("Release integrity error: download exceeded declared size".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
fn build_download_request_plan(
    discovery_url: &str,
    api_key: &str,
    asset_url: &str,
) -> Result<DownloadRequestPlan, String> {
    build_download_request_plan_with_policy(discovery_url, api_key, asset_url, true)
}

fn allow_insecure_loopback_asset(asset_url: &str) -> bool {
    if env::var("LOCALAPP_UPDATE_ALLOW_INSECURE_LOOPBACK").as_deref() != Ok("1") {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(asset_url) else {
        return false;
    };
    if url.scheme() != "http" {
        return false;
    }
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|address| address.is_loopback())
    })
}

fn build_download_request_plan_with_policy(
    discovery_url: &str,
    api_key: &str,
    asset_url: &str,
    require_https: bool,
) -> Result<DownloadRequestPlan, String> {
    reqwest::Url::parse(discovery_url)
        .map_err(|_| "Download discovery failed: invalid Server URL".to_string())?;
    let asset = reqwest::Url::parse(asset_url)
        .map_err(|_| "Download failed: invalid release asset URL".to_string())?;
    if (require_https && asset.scheme() != "https")
        || !asset.username().is_empty()
        || asset.password().is_some()
    {
        return Err(
            "Download failed: release asset URL must use HTTPS without credentials".to_string(),
        );
    }
    let mut discovery_headers = HashMap::new();
    discovery_headers.insert("X-API-Key".to_string(), api_key.to_string());
    discovery_headers.insert("X-CLI-Version".to_string(), VERSION.to_string());
    Ok(DownloadRequestPlan {
        discovery: DownloadRequest {
            url: discovery_url.to_string(),
            headers: discovery_headers,
        },
        asset: DownloadRequest {
            url: asset.to_string(),
            headers: HashMap::new(),
        },
    })
}

fn to_header_map(headers: &HashMap<String, String>) -> Result<reqwest::header::HeaderMap, String> {
    let mut result = reqwest::header::HeaderMap::new();
    for (name, value) in headers {
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| format!("Download client failed: invalid header name: {e}"))?;
        let value = reqwest::header::HeaderValue::from_str(value)
            .map_err(|e| format!("Download client failed: invalid header value: {e}"))?;
        result.insert(name, value);
    }
    Ok(result)
}

fn cleanup_old_backup() -> Result<(), String> {
    let exe_path = current_exe_path()?;
    let old_path = if cfg!(windows) {
        exe_path.with_extension("old.exe")
    } else {
        let mut p = exe_path.into_os_string();
        p.push(".old");
        PathBuf::from(p)
    };

    if old_path.exists() {
        let _ = fs::remove_file(&old_path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_download_request_plan, build_download_request_plan_with_policy,
        download_release_bytes, is_update_available, platform_arch, platform_os,
    };
    use httpmock::{Method, MockServer};

    #[test]
    fn current_target_uses_the_shared_release_target_vocabulary() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../shared/release-targets.json")).unwrap();
        let targets = fixture["targets"].as_array().unwrap();

        assert!(
            targets.iter().any(|target| {
                target["os"] == platform_os() && target["arch"] == platform_arch()
            })
        );
    }

    #[test]
    fn stable_release_is_newer_than_its_prerelease() {
        assert!(is_update_available("1.2.0-beta.1", "1.2.0").unwrap());
        assert!(!is_update_available("1.2.0", "1.2.0-beta.1").unwrap());
    }

    #[test]
    fn cross_origin_asset_request_never_carries_instance_credentials() {
        let plan = build_download_request_plan(
            "https://localapp.example/api/cli/download?os=linux&arch=x86_64",
            "instance-secret",
            "https://objects.example/localapp-cli",
        )
        .unwrap();

        assert_eq!(
            plan.discovery.headers.get("X-API-Key").map(String::as_str),
            Some("instance-secret")
        );
        assert!(!plan.asset.headers.contains_key("X-API-Key"));
        assert!(!plan.asset.headers.contains_key("X-CLI-Version"));
    }

    #[tokio::test]
    async fn authenticated_discovery_downloads_from_the_asset_origin_without_forwarding_secrets() {
        let asset_server = MockServer::start();
        let leaked_key = asset_server.mock(|when, then| {
            when.method(Method::GET)
                .path("/localapp-cli")
                .header("x-api-key", "instance-secret");
            then.status(500);
        });
        let asset_request = asset_server.mock(|when, then| {
            when.method(Method::GET).path("/localapp-cli");
            then.status(200)
                .header("content-length", "12")
                .body("release-data");
        });
        let discovery_server = MockServer::start();
        let discovery = discovery_server.mock(|when, then| {
            when.method(Method::GET)
                .path("/api/cli/download")
                .header("x-api-key", "instance-secret")
                .header_exists("x-cli-version");
            then.status(307)
                .header("location", asset_server.url("/localapp-cli"));
        });
        let plan = build_download_request_plan_with_policy(
            &discovery_server.url("/api/cli/download"),
            "instance-secret",
            &asset_server.url("/localapp-cli"),
            false,
        )
        .unwrap();

        let bytes = download_release_bytes(&plan, 12, true).await.unwrap();

        assert_eq!(bytes, b"release-data");
        discovery.assert();
        asset_request.assert();
        leaked_key.assert_hits(0);
    }
}
