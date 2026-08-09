use std::process::Command;

const DESKTOP_SCHEME: &str = "localapp://";
const DOWNLOAD_URL: &str = "https://github.com/Patodo/LocalApp/releases";

/// 启动 LocalApp Desktop。
///
/// 桌面平台（macOS / Windows）通过系统已注册的 `localapp://` deep-link scheme
/// 唤醒已运行的 Desktop 实例（由 single-instance 插件聚焦窗口），或在未运行时
/// 由系统启动 Desktop。Linux / 无头环境退化为打印 CLI 帮助，因为 Desktop 是桌面客户端。
pub fn launch() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        open_on_macos()
    } else if cfg!(target_os = "windows") {
        open_on_windows()
    } else {
        // Linux / 无头环境：Desktop 是桌面客户端，这里打印引导信息而非启动。
        eprintln!("LocalApp Desktop 是桌面客户端，当前环境无法启动。");
        eprintln!();
        eprintln!("CLI 命令请使用 `localapp <command>`，例如 `localapp init`、`localapp upload`。");
        eprintln!("运行 `localapp --help` 查看完整命令列表。");
        Ok(())
    }
}

fn open_on_macos() -> Result<(), String> {
    let status = Command::new("open")
        .arg(DESKTOP_SCHEME)
        .status()
        .map_err(|e| format!("无法调用系统打开器: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        report_desktop_not_installed()
    }
}

fn open_on_windows() -> Result<(), String> {
    // `start "" "localapp://"` —— 空 title 避免 start 把 URL 当成 title 解析。
    let status = Command::new("cmd")
        .args(["/C", "start", "", DESKTOP_SCHEME])
        .status()
        .map_err(|e| format!("无法调用系统打开器: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        report_desktop_not_installed()
    }
}

fn report_desktop_not_installed() -> Result<(), String> {
    Err(format!(
        "未检测到 LocalApp Desktop。请先安装 Desktop：{DOWNLOAD_URL}"
    ))
}

#[cfg(test)]
mod tests {
    use super::{DOWNLOAD_URL, DESKTOP_SCHEME};

    #[test]
    fn constants_are_stable() {
        assert_eq!(DESKTOP_SCHEME, "localapp://");
        assert!(DOWNLOAD_URL.starts_with("https://"));
    }
}
