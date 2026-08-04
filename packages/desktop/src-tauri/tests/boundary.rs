use localapp_core::Config;
use localapp_desktop::{PublicSettings, validate_external_url};

fn config(server_url: &str) -> Config {
    Config {
        server_url: server_url.into(),
        api_key: "desktop-secret".into(),
    }
}

#[test]
fn settings_never_serialize_api_key() {
    let settings = PublicSettings::from_config(&config("https://work.example/")).unwrap();

    let json = serde_json::to_value(settings).unwrap();

    assert!(json.get("apiKey").is_none());
    assert!(json.get("api_key").is_none());
    assert_eq!(json["serverUrl"], "https://work.example");
}

#[test]
fn capability_only_allows_events_and_read_only_package_selection() {
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();

    assert_eq!(
        capability["permissions"],
        serde_json::json!([
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "dialog:allow-open"
        ])
    );
    let serialized = capability["permissions"].to_string();
    assert!(!serialized.contains("allow-write"));
    assert!(!serialized.contains("shell"));
    assert!(!serialized.contains("process"));
}

#[test]
fn desktop_deep_link_is_static_and_single_instance_is_registered_first() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(
        config["plugins"]["deep-link"]["desktop"]["schemes"],
        serde_json::json!(["localapp"])
    );

    let cargo = include_str!("../Cargo.toml");
    assert!(cargo.contains(
        "tauri-plugin-single-instance = { version = \"2.4\", features = [\"deep-link\"] }"
    ));
    assert!(cargo.contains("tauri-plugin-deep-link = \"2.4\""));
    assert!(cargo.contains("[target.'cfg(windows)'.dependencies]"));
    assert!(cargo.contains("windows-sys"));
    let settings = include_str!("../src/settings.rs");
    assert!(settings.contains("ReplaceFileW"));
    assert!(settings.contains("MoveFileExW"));

    let source = include_str!("../src/lib.rs");
    let single_instance = source
        .find(".plugin(tauri_plugin_single_instance::init")
        .unwrap();
    let deep_link = source
        .find(".plugin(tauri_plugin_deep_link::init())")
        .unwrap();
    assert!(single_instance < deep_link);
    assert!(!cargo.contains("tauri-plugin-shell"));
}

#[test]
fn configured_url_credentials_do_not_reach_public_settings() {
    assert!(PublicSettings::from_config(&config("https://user:password@work.example/")).is_err());
}

#[test]
fn external_urls_must_use_the_configured_http_origin() {
    for (server_url, candidate) in [
        ("https://work.example/", "https://work.example/apps/roadmap"),
        ("http://localhost:3000/", "http://localhost:3000/favorites"),
    ] {
        let validated = validate_external_url(&config(server_url), candidate).unwrap();
        assert_eq!(validated.as_str(), candidate);
    }
}

#[test]
fn external_urls_reject_other_protocols_origins_and_credentials() {
    let config = config("https://work.example/");

    for candidate in [
        "mailto:help@work.example",
        "file:///tmp/localapp",
        "http://work.example/",
        "https://work.example.evil.test/",
        "https://user:password@work.example/private",
    ] {
        assert!(
            validate_external_url(&config, candidate).is_err(),
            "{candidate}"
        );
    }
}

#[test]
fn external_urls_reject_configured_server_credentials() {
    let configured = config("https://user:password@work.example/");

    assert!(validate_external_url(&configured, "https://work.example/app").is_err());
}
