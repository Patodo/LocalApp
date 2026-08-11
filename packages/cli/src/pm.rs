use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};

use crate::config::Config;
use crate::scripts::script_invokes_localapp_dev;

/// Detect the best available package manager: pnpm preferred, npm as fallback.
/// Does NOT verify availability — use `check_available()` for that.
fn detect() -> &'static str {
    let pnpm_works = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "pnpm", "--version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        Command::new("pnpm")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    if pnpm_works { "pnpm" } else { "npm" }
}

/// Verify that a package manager (pnpm preferred, npm fallback) is usable.
/// On Windows, attempts to auto-install Node.js if missing.
pub fn check_available() -> Result<(), String> {
    let pm = detect();
    let (program, args) = if cfg!(target_os = "windows") {
        ("cmd", vec!["/C", pm, "--version"])
    } else {
        (pm, vec!["--version"])
    };
    let result = Command::new(program)
        .args(&args)
        .output()
        .map_err(|_| {
            if pm == "pnpm" {
                "pnpm is not installed. Please install pnpm or Node.js (includes npm).".to_string()
            } else {
                "npm is not installed. Please install Node.js (includes npm) or pnpm.".to_string()
            }
        })
        .and_then(|o| {
            if o.status.success() {
                Ok(())
            } else {
                Err(format!(
                    "{} --version failed: {}",
                    pm,
                    String::from_utf8_lossy(&o.stderr).trim()
                ))
            }
        });

    if result.is_err() && cfg!(target_os = "windows") {
        if let Err(original) = try_install_nodejs() {
            eprintln!("\n{}", original);
        }
        // Return the original error — user needs to restart after installing
        return result;
    }

    result
}

#[derive(serde::Deserialize)]
struct NodeDepsInfo {
    version: String,
    platforms: std::collections::HashMap<String, String>,
}

/// Try to download and launch Node.js installer from the configured server.
/// Returns Ok(()) if the installer was launched (user still needs to complete it).
fn try_install_nodejs() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let base_url = config.base_url();

    // Fetch node.json from server
    let url = format!("{}/api/deps/node", base_url);
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to reach server: {e}"))?;

    if !resp.status().is_success() {
        print_nodejs_fallback();
        return Err(String::new());
    }

    let info: NodeDepsInfo = resp
        .json()
        .map_err(|e| format!("Invalid response from server: {e}"))?;

    let platform_key = "windows/x86_64";
    let filename = info
        .platforms
        .get(platform_key)
        .ok_or("Server does not have a Windows Node.js installer")?;

    eprintln!("\n⚠ 未检测到 Node.js。");
    eprintln!("服务器提供 Node.js v{} 安装包。", info.version);

    let confirm = dialoguer::Confirm::new()
        .with_prompt("是否下载并安装？")
        .default(true)
        .interact()
        .map_err(|e| format!("Failed to read input: {e}"))?;

    if !confirm {
        print_nodejs_fallback();
        return Err(String::new());
    }

    // Download installer
    let download_url = format!("{}/api/deps/node/download?os=windows&arch=x86_64", base_url);
    eprintln!("  正在下载 {} ...", filename);

    let mut resp = client
        .get(&download_url)
        .send()
        .map_err(|e| format!("Download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }

    let total_size: u64 = resp
        .headers()
        .get("content-length")
        .and_then(|v: &reqwest::header::HeaderValue| v.to_str().ok())
        .and_then(|v: &str| v.parse().ok())
        .unwrap_or(0);

    let tmp_dir = std::env::temp_dir().join("localapp-nodejs-install");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    let msi_path = tmp_dir.join(filename);

    {
        let mut file =
            std::fs::File::create(&msi_path).map_err(|e| format!("Failed to create file: {e}"))?;
        let mut downloaded: u64 = 0;
        let mut buffer = [0u8; 8192];

        loop {
            let bytes_read = resp
                .read(&mut buffer)
                .map_err(|e| format!("Download error: {e}"))?;
            if bytes_read == 0 {
                break;
            }
            file.write_all(&buffer[..bytes_read])
                .map_err(|e| format!("Write error: {e}"))?;
            downloaded += bytes_read as u64;

            if total_size > 0 {
                let pct = (downloaded * 100) / total_size;
                let mb_down = downloaded as f64 / 1_048_576.0;
                let mb_total = total_size as f64 / 1_048_576.0;
                eprint!("\r  下载中: {:.1}/{:.1} MB ({}%)", mb_down, mb_total, pct);
                std::io::stderr().flush().ok();
            }
        }
        eprintln!();
    }

    eprintln!("  启动安装向导...");
    Command::new("cmd")
        .args(["/C", "start", "", msi_path.to_str().unwrap_or("")])
        .spawn()
        .map_err(|e| format!("Failed to launch installer: {e}"))?;

    eprintln!("\n✓ Node.js 安装向导已启动。");
    eprintln!("  请完成安装后重新运行命令。");

    // Clean up msi after a delay (don't block on this)
    let _ = Command::new("cmd")
        .args([
            "/C",
            "ping",
            "-n",
            "60",
            "127.0.0.1",
            ">nul",
            "&",
            "del",
            "/q",
            msi_path.to_str().unwrap_or(""),
        ])
        .spawn();

    Err("请完成 Node.js 安装后重新运行命令。".to_string())
}

fn print_nodejs_fallback() {
    eprintln!("\n请安装 Node.js v24+ LTS:");
    eprintln!("  https://nodejs.org");
    eprintln!("安装完成后重新运行命令。\n");
}

fn run_cmd(pm: &str, args: &[&str], cwd: &Path) -> Result<(), String> {
    let (program, final_args) = if cfg!(target_os = "windows") {
        let mut a = vec!["/C", pm];
        a.extend_from_slice(args);
        ("cmd", a)
    } else {
        (pm, args.to_vec())
    };

    let output = Command::new(program)
        .args(&final_args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("Failed to run {} {}: {e}", pm, args.join(" ")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "{} {} failed:\n{}\n{}",
            pm,
            args.join(" "),
            stdout.trim(),
            stderr.trim()
        ));
    }
    Ok(())
}

fn install_args(pm: &str) -> Vec<&'static str> {
    if pm == "pnpm" {
        vec!["install", "--ignore-workspace"]
    } else {
        vec!["install"]
    }
}

pub fn run_install(cwd: &Path) -> Result<(), String> {
    let pm = detect();
    eprintln!("  Using {} to install dependencies...", pm);
    run_cmd(pm, &install_args(pm), cwd)
}

pub fn run_build(cwd: &Path) -> Result<(), String> {
    let pm = detect();
    run_cmd(pm, &["run", "build"], cwd)
}

pub fn run_test_if_present(cwd: &Path) -> Result<bool, String> {
    if !package_has_script(cwd, "test")? {
        return Ok(false);
    }
    let pm = detect();
    run_cmd(pm, &["run", "test"], cwd)?;
    Ok(true)
}

pub fn run_build_if_present(cwd: &Path) -> Result<bool, String> {
    if !package_has_script(cwd, "build")? {
        return Ok(false);
    }
    let pm = detect();
    run_cmd(pm, &["run", "build"], cwd)?;
    Ok(true)
}

fn package_has_script(cwd: &Path, script: &str) -> Result<bool, String> {
    let package_path = cwd.join("package.json");
    if !package_path.exists() {
        return Ok(false);
    }
    let content = fs::read_to_string(&package_path)
        .map_err(|error| format!("Failed to read package.json: {error}"))?;
    let package: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| format!("Invalid package.json: {error}"))?;
    Ok(package
        .get("scripts")
        .and_then(|scripts| scripts.get(script))
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty()))
}

fn select_dev_script(cwd: &Path) -> Result<&'static str, String> {
    let pkg_path = cwd.join("package.json");
    let content = match std::fs::read_to_string(&pkg_path) {
        Ok(content) => content,
        Err(_) => return Ok("dev"),
    };
    let parsed: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid package.json: {e}"))?;
    let has_vite_script = parsed
        .get("scripts")
        .and_then(|scripts| scripts.get("dev:vite"))
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let dev_script = parsed
        .get("scripts")
        .and_then(|scripts| scripts.get("dev"))
        .and_then(|value| value.as_str())
        .map(str::trim);
    if !has_vite_script && dev_script.is_some_and(script_invokes_localapp_dev) {
        return Err(
            "package.json scripts.dev calls 'localapp dev' but scripts.dev:vite is missing. Run 'localapp sync' to repair the CLI-owned development scripts."
                .to_string(),
        );
    }
    Ok(if has_vite_script { "dev:vite" } else { "dev" })
}

/// Build the dev server command with inherited stdio. The caller owns process-tree setup and spawn.
pub fn dev_command() -> Result<Command, String> {
    let pm = detect();
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    let script = select_dev_script(&cwd)?;

    let (program, args) = if cfg!(target_os = "windows") {
        ("cmd", vec!["/C", pm, "run", script])
    } else {
        (pm, vec!["run", script])
    };

    let mut command = Command::new(program);
    command
        .args(&args)
        .current_dir(cwd)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pnpm_install_ignores_an_unrelated_parent_workspace() {
        assert_eq!(install_args("pnpm"), vec!["install", "--ignore-workspace"]);
        assert_eq!(install_args("npm"), vec!["install"]);
    }

    #[test]
    fn select_dev_script_prefers_dev_vite_when_present() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"dev":"localapp dev","dev:vite":"vite --host 127.0.0.1"}}"#,
        )
        .unwrap();

        assert_eq!(select_dev_script(tmp.path()).unwrap(), "dev:vite");
    }

    #[test]
    fn select_dev_script_falls_back_to_dev_for_legacy_projects() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"dev":"vite"}}"#,
        )
        .unwrap();

        assert_eq!(select_dev_script(tmp.path()).unwrap(), "dev");
    }

    #[test]
    fn select_dev_script_rejects_recursive_dev_without_dev_vite() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"dev":"localapp dev"}}"#,
        )
        .unwrap();

        let err = select_dev_script(tmp.path()).unwrap_err();
        assert!(err.contains("dev:vite"));
    }

    #[test]
    fn select_dev_script_rejects_recursive_dev_with_arguments_without_dev_vite() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"dev":"localapp dev --host 0.0.0.0"}}"#,
        )
        .unwrap();

        let err = select_dev_script(tmp.path()).unwrap_err();
        assert!(err.contains("dev:vite"));
    }

    #[test]
    fn select_dev_script_rejects_cross_env_recursive_dev_without_dev_vite() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"dev":"cross-env NODE_ENV=development localapp dev"}}"#,
        )
        .unwrap();

        let err = select_dev_script(tmp.path()).unwrap_err();
        assert!(err.contains("dev:vite"));
    }
}
