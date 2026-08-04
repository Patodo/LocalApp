use httpmock::{Method, MockServer};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::process::Command;
use tempfile::tempdir;

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

#[test]
fn command_downloads_verifies_and_replaces_the_invoked_binary() {
    let replacement = b"verified replacement binary";
    let sha256 = format!("{:x}", Sha256::digest(replacement));
    let asset_server = MockServer::start();
    let asset = asset_server.mock(|when, then| {
        when.method(Method::GET)
            .path("/localapp")
            .header_exists("x-api-key");
        then.status(500);
    });
    let asset_without_credentials = asset_server.mock(|when, then| {
        when.method(Method::GET).path("/localapp");
        then.status(200)
            .header("content-length", replacement.len().to_string())
            .body(replacement.as_slice());
    });
    let platform = MockServer::start();
    let version = platform.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/cli/version")
            .header("x-api-key", "instance-secret");
        then.status(200).json_body_obj(&json!({
            "latest": "999.0.0",
            "assets": [{
                "kind": "cli",
                "version": "999.0.0",
                "os": platform_os(),
                "arch": platform_arch(),
                "url": asset_server.url("/localapp"),
                "size": replacement.len(),
                "sha256": sha256
            }]
        }));
    });
    let discovery = platform.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/cli/download")
            .query_param("os", platform_os())
            .query_param("arch", platform_arch())
            .header("x-api-key", "instance-secret");
        then.status(307)
            .header("location", asset_server.url("/localapp"));
    });
    let directory = tempdir().unwrap();
    let executable = directory.path().join(if cfg!(windows) {
        "localapp-under-test.exe"
    } else {
        "localapp-under-test"
    });
    fs::copy(env!("CARGO_BIN_EXE_localapp"), &executable).unwrap();
    let config_dir = directory.path().join("config");
    fs::create_dir_all(&config_dir).unwrap();
    fs::write(
        config_dir.join("config.json"),
        serde_json::to_vec(&json!({
            "server_url": platform.base_url(),
            "api_key": "instance-secret"
        }))
        .unwrap(),
    )
    .unwrap();

    let output = Command::new(&executable)
        .arg("update")
        .env("LOCALAPP_CONFIG_DIR", &config_dir)
        .env("LOCALAPP_UPDATE_ALLOW_INSECURE_LOOPBACK", "1")
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read(&executable).unwrap(), replacement);
    version.assert();
    discovery.assert();
    asset_without_credentials.assert();
    asset.assert_hits(0);
}
