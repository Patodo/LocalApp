#[test]
fn loads_cli_compatible_config_and_trims_base_url() {
    let dir = tempfile::tempdir().unwrap();
    let config_dir = dir.path().to_str().unwrap();
    temp_env::with_vars(
        [
            ("LOCALAPP_CONFIG_DIR", Some(config_dir)),
            ("LOCALAPP_SERVER_URL", None),
            ("LOCALAPP_API_KEY", None),
        ],
        || {
            std::fs::write(
                dir.path().join("config.json"),
                r#"{"server_url":"https://work.example/","api_key":"secret"}"#,
            )
            .unwrap();
            let config = localapp_core::Config::load().unwrap();
            assert_eq!(config.base_url(), "https://work.example");
            assert_eq!(config.api_key, "secret");
        },
    );
}

#[test]
fn default_config_path_uses_the_localapp_home_without_an_extra_product_layer() {
    let home = tempfile::tempdir().unwrap();
    temp_env::with_vars(
        [
            ("LOCALAPP_CONFIG_DIR", None),
            ("HOME", home.path().to_str()),
            ("USERPROFILE", None),
        ],
        || {
            assert_eq!(
                localapp_core::Config::config_path(),
                home.path().join(".localapp").join("config.json")
            );
        },
    );
}

#[cfg(unix)]
#[test]
fn save_atomically_replaces_config_without_following_existing_symlink() {
    use std::os::unix::fs::symlink;

    let dir = tempfile::tempdir().unwrap();
    let external = dir.path().join("external-config.json");
    let external_content = br#"{"server_url":"https://old.example","api_key":"old"}"#;
    std::fs::write(&external, external_content).unwrap();
    symlink(&external, dir.path().join("config.json")).unwrap();

    temp_env::with_vars(
        [
            ("LOCALAPP_CONFIG_DIR", dir.path().to_str()),
            ("LOCALAPP_SERVER_URL", None),
            ("LOCALAPP_API_KEY", None),
        ],
        || {
            let config = localapp_core::Config {
                server_url: "https://new.example".into(),
                api_key: "new".into(),
            };

            config.save().unwrap();

            assert_eq!(std::fs::read(&external).unwrap(), external_content);
            assert!(
                !std::fs::symlink_metadata(dir.path().join("config.json"))
                    .unwrap()
                    .file_type()
                    .is_symlink()
            );
            assert_eq!(localapp_core::Config::load().unwrap().api_key, "new");
            assert!(std::fs::read_dir(dir.path()).unwrap().all(|entry| {
                !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".tmp")
            }));
        },
    );
}
