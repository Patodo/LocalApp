use crate::config::Config;
use crate::pm;
use crate::project::Manifest;
use std::fs;
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

fn directory_contains_same_files(source: &Path, installed: &Path) -> bool {
    if !source.is_dir() || !installed.is_dir() {
        return false;
    }
    let entries = match fs::read_dir(source) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return false,
        };
        let source_path = entry.path();
        let installed_path = installed.join(entry.file_name());
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => return false,
        };
        if file_type.is_dir() {
            if !directory_contains_same_files(&source_path, &installed_path) {
                return false;
            }
        } else if file_type.is_file() {
            let source_bytes = match fs::read(&source_path) {
                Ok(bytes) => bytes,
                Err(_) => return false,
            };
            let installed_bytes = match fs::read(&installed_path) {
                Ok(bytes) => bytes,
                Err(_) => return false,
            };
            if source_bytes != installed_bytes {
                return false;
            }
        }
    }
    true
}

fn files_contain_same_bytes(source: &Path, installed: &Path) -> bool {
    match (fs::read(source), fs::read(installed)) {
        (Ok(source_bytes), Ok(installed_bytes)) => source_bytes == installed_bytes,
        _ => false,
    }
}

fn runtime_dependencies_stale(cwd: &Path) -> bool {
    let comparisons = [
        (".localapp/runtime/server-core/dist", "node_modules/@localapp/server-core/dist"),
        (".localapp/runtime/sdk/core/src", "node_modules/@localapp/sdk/src"),
        (".localapp/runtime/sdk/react/src", "node_modules/@localapp/sdk-react/src"),
        (".localapp/runtime/sdk/agent/src", "node_modules/@localapp/sdk-agent/src"),
    ];
    let stale_directory = comparisons.iter().any(|(source, installed)| {
        !directory_contains_same_files(&cwd.join(source), &cwd.join(installed))
    });
    let app_kit_files = [
        "dev-shell.tsx",
        "vite-plugin.mjs",
        "package.json",
        "tsconfig.base.json",
    ];
    stale_directory || app_kit_files.iter().any(|file| {
        !files_contain_same_bytes(
            &cwd.join(".localapp/runtime").join(file),
            &cwd.join("node_modules/@localapp/app-kit").join(file),
        )
    })
}

fn clear_vite_dependency_cache(cwd: &Path) -> Result<(), String> {
    let cache_dir = cwd.join("node_modules/.vite");
    if !cache_dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to clear stale Vite dependency cache: {e}"))
}

const DEFAULT_DEV_USER_ID: &str = "dev-user";

struct MiniServerCommand {
    program: String,
    args: Vec<String>,
}

fn pick_mini_server_port() -> Result<u16, String> {
    for port in 15174..=15200 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("No free port found for mini-server in range 15174-15200".to_string())
}

fn pick_app_server_port() -> Result<u16, String> {
    for port in 5173..=5200 {
        let ipv4_in_use = TcpStream::connect(("127.0.0.1", port)).is_ok();
        let ipv6_in_use = TcpStream::connect(("::1", port)).is_ok();
        if ipv4_in_use || ipv6_in_use {
            continue;
        }
        let ipv4 = TcpListener::bind(("127.0.0.1", port));
        let ipv6 = TcpListener::bind(("::1", port));
        if ipv4.is_ok() && ipv6.is_ok() {
            return Ok(port);
        }
    }
    Err("No free port found for app dev server in range 5173-5200".to_string())
}

fn build_mini_server_command(
    cwd: &Path,
    port: u16,
    server_url: &str,
    api_key: &str,
    dev_page_name: &str,
) -> MiniServerCommand {
    MiniServerCommand {
        program: "node".to_string(),
        args: vec![
            cwd.join(".localapp/runtime/mini-server.mjs")
                .to_string_lossy()
                .to_string(),
            "--port".to_string(),
            port.to_string(),
            "--data-dir".to_string(),
            cwd.join(".localapp").to_string_lossy().to_string(),
            "--prod-server".to_string(),
            server_url.to_string(),
            "--api-key".to_string(),
            api_key.to_string(),
            "--project-dir".to_string(),
            cwd.to_string_lossy().to_string(),
            "--dev-user-id".to_string(),
            DEFAULT_DEV_USER_ID.to_string(),
            "--dev-page-name".to_string(),
            dev_page_name.to_string(),
        ],
    }
}

fn spawn_mini_server(
    cwd: &Path,
    port: u16,
    server_url: &str,
    api_key: &str,
    dev_page_name: &str,
) -> Result<Child, String> {
    let command = build_mini_server_command(cwd, port, server_url, api_key, dev_page_name);
    Command::new(&command.program)
        .args(&command.args)
        .current_dir(cwd)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to start mini-server: {e}"))
}

async fn wait_for_mini_server(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/health");
    let client = reqwest::Client::new();
    for _ in 0..50 {
        if let Ok(response) = client.get(&url).send().await {
            if response.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!("mini-server did not become ready at {url}"))
}

fn terminate_child(child: &mut Child) {
    if let Ok(None) = child.try_wait() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

async fn write_dev_config(
    cwd: &std::path::Path,
    page_name: &str,
    server_url: &str,
    app_server_port: u16,
    mini_server_port: u16,
    api_key: &str,
) -> Result<(), String> {
    let localapp_dir = cwd.join(".localapp");
    fs::create_dir_all(&localapp_dir).map_err(|e| format!("Failed to create .localapp dir: {e}"))?;

    if api_key.is_empty() {
        eprintln!(
            "  Warning: not logged in. Local app APIs keep working; remote platform and AI tools are unavailable until login."
        );
    }
    let config_json = serde_json::json!({
        "serverUrl": server_url,
        "userId": DEFAULT_DEV_USER_ID,
        "pageName": page_name,
        "apiKey": api_key,
        "appServerPort": app_server_port,
        "miniServerPort": mini_server_port,
    });
    let content = serde_json::to_string_pretty(&config_json)
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    let path = localapp_dir.join("dev-config.json");
    fs::write(&path, content).map_err(|e| format!("Failed to write dev-config.json: {e}"))?;

    println!("  Dev config written to .localapp/dev-config.json");
    println!("    userId: {DEFAULT_DEV_USER_ID}, pageName: {page_name}");
    println!("    Dev identity stays fixed; use the DevShell identity picker to simulate other users.");
    Ok(())
}

pub async fn run() -> Result<(), String> {
    pm::check_available()?;

    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;

    let manifest =
        Manifest::read(&cwd).ok_or("No manifest.json found. Run 'localapp init' first.")?;

    if manifest.name.is_empty() {
        return Err("No name in manifest.json".to_string());
    }

    let config = Config::load();
    let server_url = config
        .as_ref()
        .map(|c| c.base_url().to_string())
        .unwrap_or_else(|| "http://localhost:3000".to_string());

    // Auto-install if node_modules is missing or a freshly synced file dependency is stale.
    if !cwd.join("node_modules").is_dir() {
        eprintln!("node_modules not found, installing dependencies...");
        pm::run_install(&cwd)?;
    } else if runtime_dependencies_stale(&cwd) {
        eprintln!("LocalApp runtime dependencies changed, refreshing dependencies...");
        pm::run_install(&cwd)?;
        clear_vite_dependency_cache(&cwd)?;
    }

    println!("Starting dev server for: {}", manifest.name);
    println!("  Project dir: {}", cwd.display());
    let app_server_port = pick_app_server_port()?;
    println!("  App URL:         http://localhost:{app_server_port}/");
    println!("  Platform server: {server_url} (remote features only)");

    let mini_server_port = pick_mini_server_port()?;
    let api_key = config.as_ref().map(|c| c.api_key.as_str()).unwrap_or("");
    let mut mini_server = spawn_mini_server(
        &cwd,
        mini_server_port,
        &server_url,
        api_key,
        &manifest.name,
    )?;
    if let Err(err) = wait_for_mini_server(mini_server_port).await {
        terminate_child(&mut mini_server);
        return Err(err);
    }

    if let Err(err) = write_dev_config(
        &cwd,
        &manifest.name,
        &server_url,
        app_server_port,
        mini_server_port,
        api_key,
    )
    .await
    {
        terminate_child(&mut mini_server);
        return Err(err);
    }

    println!();
    println!("  Mini server: http://127.0.0.1:{mini_server_port}");
    println!("  API proxy: /api/llm/* -> server, other /api/* -> mini-server");
    println!();

    let mut child = match pm::spawn_dev() {
        Ok(child) => child,
        Err(err) => {
            terminate_child(&mut mini_server);
            return Err(err);
        }
    };

    let status = match child.wait() {
        Ok(status) => status,
        Err(err) => {
            terminate_child(&mut mini_server);
            return Err(format!("dev server exited with error: {err}"));
        }
    };

    terminate_child(&mut mini_server);

    if !status.success() {
        return Err(format!("dev server exited with code: {status}"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tempfile::tempdir;

    #[test]
    fn detects_stale_runtime_file_dependencies() {
        let dir = tempdir().unwrap();
        let runtime_dist = dir.path().join(".localapp/runtime/server-core/dist");
        let installed_dist = dir.path().join("node_modules/@localapp/server-core/dist");
        fs::create_dir_all(&runtime_dist).unwrap();
        fs::create_dir_all(&installed_dist).unwrap();
        fs::write(runtime_dist.join("index.js"), "new runtime").unwrap();
        fs::write(installed_dist.join("index.js"), "old runtime").unwrap();

        for (runtime, installed) in [
            ("sdk/core/src", "@localapp/sdk/src"),
            ("sdk/react/src", "@localapp/sdk-react/src"),
            ("sdk/agent/src", "@localapp/sdk-agent/src"),
        ] {
            let runtime_dir = dir.path().join(".localapp/runtime").join(runtime);
            let installed_dir = dir.path().join("node_modules").join(installed);
            fs::create_dir_all(&runtime_dir).unwrap();
            fs::create_dir_all(&installed_dir).unwrap();
            fs::write(runtime_dir.join("index.ts"), "same").unwrap();
            fs::write(installed_dir.join("index.ts"), "same").unwrap();
        }
        for file in ["dev-shell.tsx", "vite-plugin.mjs", "package.json", "tsconfig.base.json"] {
            let runtime_file = dir.path().join(".localapp/runtime").join(file);
            let installed_file = dir.path().join("node_modules/@localapp/app-kit").join(file);
            fs::create_dir_all(installed_file.parent().unwrap()).unwrap();
            fs::write(runtime_file, "same").unwrap();
            fs::write(installed_file, "same").unwrap();
        }

        assert!(runtime_dependencies_stale(dir.path()));
        fs::write(installed_dist.join("index.js"), "new runtime").unwrap();
        assert!(!runtime_dependencies_stale(dir.path()));
    }

    #[test]
    fn detects_stale_app_kit_file_dependency() {
        let dir = tempdir().unwrap();
        for (runtime, installed) in [
            ("server-core/dist", "@localapp/server-core/dist"),
            ("sdk/core/src", "@localapp/sdk/src"),
            ("sdk/react/src", "@localapp/sdk-react/src"),
            ("sdk/agent/src", "@localapp/sdk-agent/src"),
        ] {
            let runtime_dir = dir.path().join(".localapp/runtime").join(runtime);
            let installed_dir = dir.path().join("node_modules").join(installed);
            fs::create_dir_all(&runtime_dir).unwrap();
            fs::create_dir_all(&installed_dir).unwrap();
            fs::write(runtime_dir.join("index.ts"), "same").unwrap();
            fs::write(installed_dir.join("index.ts"), "same").unwrap();
        }
        let runtime_shell = dir.path().join(".localapp/runtime/dev-shell.tsx");
        let installed_shell = dir.path().join("node_modules/@localapp/app-kit/dev-shell.tsx");
        fs::create_dir_all(installed_shell.parent().unwrap()).unwrap();
        fs::write(&runtime_shell, "new shell").unwrap();
        fs::write(&installed_shell, "old shell").unwrap();
        for file in ["vite-plugin.mjs", "package.json", "tsconfig.base.json"] {
            fs::write(dir.path().join(".localapp/runtime").join(file), "same").unwrap();
            fs::write(dir.path().join("node_modules/@localapp/app-kit").join(file), "same").unwrap();
        }

        assert!(runtime_dependencies_stale(dir.path()));
        fs::write(installed_shell, "new shell").unwrap();
        assert!(!runtime_dependencies_stale(dir.path()));
    }

    #[test]
    fn clears_vite_dependency_cache_after_runtime_refresh() {
        let dir = tempdir().unwrap();
        let cache_dir = dir.path().join("node_modules/.vite/deps");
        fs::create_dir_all(&cache_dir).unwrap();
        fs::write(cache_dir.join("style-to-js.js"), "stale optimized module").unwrap();

        clear_vite_dependency_cache(dir.path()).unwrap();

        assert!(!dir.path().join("node_modules/.vite").exists());
        clear_vite_dependency_cache(dir.path()).unwrap();
    }

    #[tokio::test]
    async fn write_dev_config_includes_local_server_ports() {
        let dir = tempdir().unwrap();

        write_dev_config(
            dir.path(),
            "demo",
            "http://127.0.0.1:3000",
            5182,
            5174,
            "",
        )
        .await
        .unwrap();

        let content = fs::read_to_string(dir.path().join(".localapp/dev-config.json")).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(config["serverUrl"], "http://127.0.0.1:3000");
        assert_eq!(config["pageName"], "demo");
        assert_eq!(config["miniServerPort"], 5174);
        assert_eq!(config["appServerPort"], 5182);
        assert_eq!(config["userId"], "dev-user");
    }

    #[test]
    fn app_server_port_avoids_an_occupied_vite_default_port() {
        let listener = TcpListener::bind(("127.0.0.1", 5173)).ok();
        let port = pick_app_server_port().unwrap();

        assert!((5173..=5200).contains(&port));
        if listener.is_some() {
            assert_ne!(port, 5173);
        }
    }

    #[test]
    fn mini_server_command_uses_stable_dev_user_id() {
        let dir = tempdir().unwrap();

        let command = build_mini_server_command(
            dir.path(),
            15174,
            "http://127.0.0.1:3000",
            "test-key",
            "team-workload",
        );

        assert!(
            command
                .args
                .windows(2)
                .any(|pair| pair == ["--dev-user-id", "dev-user"])
        );
        assert!(
            command
                .args
                .windows(2)
                .any(|pair| pair == ["--dev-page-name", "team-workload"])
        );
    }

    #[test]
    fn mini_server_port_avoids_vite_default_range() {
        let port = pick_mini_server_port().unwrap();
        assert!(
            port >= 15174,
            "mini-server should avoid Vite's common 5173-5200 dev-port range"
        );
    }

    #[test]
    fn mini_server_command_points_to_runtime_script() {
        let dir = tempdir().unwrap();
        let command = build_mini_server_command(
            dir.path(),
            5175,
            "http://127.0.0.1:3000",
            "test-key",
            "team-workload",
        );

        assert_eq!(command.program, "node");
        assert_eq!(
            command.args,
            vec![
                dir.path()
                    .join(".localapp/runtime/mini-server.mjs")
                    .to_string_lossy()
                    .to_string(),
                "--port".to_string(),
                "5175".to_string(),
                "--data-dir".to_string(),
                dir.path().join(".localapp").to_string_lossy().to_string(),
                "--prod-server".to_string(),
                "http://127.0.0.1:3000".to_string(),
                "--api-key".to_string(),
                "test-key".to_string(),
                "--project-dir".to_string(),
                dir.path().to_string_lossy().to_string(),
                "--dev-user-id".to_string(),
                "dev-user".to_string(),
                "--dev-page-name".to_string(),
                "team-workload".to_string(),
            ],
        );
    }
}
