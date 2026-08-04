use localapp_core::{
    Config, ProfileStore, ResolvedTargetSource, ServerProfile, TargetSelector, resolve_target,
};
use std::fs;

fn without_server_env<T>(config_dir: &str, action: impl FnOnce() -> T) -> T {
    temp_env::with_vars(
        [
            ("LOCALAPP_CONFIG_DIR", Some(config_dir)),
            ("LOCALAPP_SERVER_URL", None),
            ("LOCALAPP_API_KEY", None),
            ("LOCALAPP_PROFILE", None),
        ],
        action,
    )
}

#[test]
fn legacy_config_remains_the_default_target_without_profiles() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("config.json"),
        r#"{"server_url":"https://legacy.example/","api_key":"legacy-key"}"#,
    )
    .unwrap();

    without_server_env(dir.path().to_str().unwrap(), || {
        let target = resolve_target(TargetSelector::default()).unwrap();
        assert_eq!(target.base_url(), "https://legacy.example");
        assert_eq!(target.api_key, "legacy-key");
        assert_eq!(target.source, ResolvedTargetSource::LegacyConfig);
    });
}

#[test]
fn profiles_are_saved_atomically_and_switching_updates_legacy_mirror() {
    let dir = tempfile::tempdir().unwrap();

    without_server_env(dir.path().to_str().unwrap(), || {
        let mut store = ProfileStore::load().unwrap();
        store
            .upsert(ServerProfile {
                name: "staging".into(),
                server_url: "https://staging.example/".into(),
                api_key: "staging-key".into(),
            })
            .unwrap();
        store
            .upsert(ServerProfile {
                name: "production".into(),
                server_url: "https://production.example".into(),
                api_key: "production-key".into(),
            })
            .unwrap();
        store.use_profile("production").unwrap();

        let reloaded = ProfileStore::load().unwrap();
        assert_eq!(reloaded.active_profile.as_deref(), Some("production"));
        assert_eq!(reloaded.profiles.len(), 2);
        assert_eq!(
            Config::load().unwrap().base_url(),
            "https://production.example"
        );
        assert!(fs::read_dir(dir.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp")
        }));
    });
}

#[test]
fn explicit_profile_is_resolved_once_and_does_not_expose_secret_in_debug() {
    let dir = tempfile::tempdir().unwrap();

    without_server_env(dir.path().to_str().unwrap(), || {
        let mut store = ProfileStore::load().unwrap();
        store
            .upsert(ServerProfile {
                name: "staging".into(),
                server_url: "https://staging.example".into(),
                api_key: "do-not-log".into(),
            })
            .unwrap();

        let target = resolve_target(TargetSelector {
            profile: Some("staging".into()),
            project_default_profile: None,
        })
        .unwrap();

        assert_eq!(target.profile_name.as_deref(), Some("staging"));
        assert_eq!(target.source, ResolvedTargetSource::ExplicitProfile);
        assert!(!format!("{target:?}").contains("do-not-log"));
    });
}

#[test]
fn complete_environment_target_conflicts_with_explicit_profile() {
    let dir = tempfile::tempdir().unwrap();
    temp_env::with_vars(
        [
            ("LOCALAPP_CONFIG_DIR", dir.path().to_str()),
            ("LOCALAPP_SERVER_URL", Some("https://temporary.example")),
            ("LOCALAPP_API_KEY", Some("temporary-key")),
            ("LOCALAPP_PROFILE", None),
        ],
        || {
            let error = resolve_target(TargetSelector {
                profile: Some("production".into()),
                project_default_profile: None,
            })
            .unwrap_err();
            assert!(error.contains("cannot be combined"));
        },
    );
}

#[test]
fn failed_profile_mutation_keeps_other_profiles_unchanged() {
    let dir = tempfile::tempdir().unwrap();

    without_server_env(dir.path().to_str().unwrap(), || {
        let mut store = ProfileStore::load().unwrap();
        store
            .upsert(ServerProfile {
                name: "production".into(),
                server_url: "https://production.example".into(),
                api_key: "production-key".into(),
            })
            .unwrap();
        let before = fs::read(dir.path().join("servers.json")).unwrap();

        let error = store
            .upsert(ServerProfile {
                name: "../invalid".into(),
                server_url: "https://invalid.example".into(),
                api_key: "invalid-key".into(),
            })
            .unwrap_err();

        assert!(error.contains("profile name"));
        assert_eq!(fs::read(dir.path().join("servers.json")).unwrap(), before);
    });
}

#[test]
fn removing_the_active_profile_clears_the_legacy_mirror() {
    let dir = tempfile::tempdir().unwrap();

    without_server_env(dir.path().to_str().unwrap(), || {
        let mut store = ProfileStore::load().unwrap();
        store
            .upsert(ServerProfile {
                name: "staging".into(),
                server_url: "https://staging.example".into(),
                api_key: "staging-key".into(),
            })
            .unwrap();
        store.use_profile("staging").unwrap();

        store.remove("staging").unwrap();

        assert!(!dir.path().join("config.json").exists());
        let error = resolve_target(TargetSelector::default()).unwrap_err();
        assert!(error.contains("Not configured"), "{error}");
    });
}

#[test]
fn switching_profiles_rolls_back_both_files_when_the_legacy_mirror_fails() {
    let dir = tempfile::tempdir().unwrap();

    without_server_env(dir.path().to_str().unwrap(), || {
        let mut store = ProfileStore::load().unwrap();
        store
            .upsert(ServerProfile {
                name: "staging".into(),
                server_url: "https://staging.example".into(),
                api_key: "staging-key".into(),
            })
            .unwrap();
        let profiles_before = fs::read(dir.path().join("servers.json")).unwrap();
        fs::create_dir(dir.path().join("config.json")).unwrap();

        let error = store.use_profile("staging").unwrap_err();

        assert!(!error.is_empty());
        assert_eq!(
            fs::read(dir.path().join("servers.json")).unwrap(),
            profiles_before
        );
        assert!(dir.path().join("config.json").is_dir());
        assert_eq!(store.active_profile, None);
    });
}
