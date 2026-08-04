const VERSION: &str = match option_env!("LOCALAPP_CLI_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

/// 返回当前 CLI 二进制的版本号（编译期注入）。
///
/// 用于写入 `.localapp/runtime/version.json` 供 sync 比对、
/// 以及在 HTTP 请求头 X-CLI-Version 中携带。
pub fn cli_version() -> &'static str {
    VERSION
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_version_is_nonempty() {
        let v = cli_version();
        assert!(
            !v.is_empty(),
            "cli_version() must return a non-empty string"
        );
    }

    #[test]
    fn cli_version_is_semver_like() {
        let v = cli_version();
        let first = v.split('.').next().unwrap_or("");
        first
            .parse::<u32>()
            .expect("cli_version() should start with a numeric major version");
    }
}
