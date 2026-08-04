use crate::client::{Client, collect_files};
use crate::config::Config;
use crate::pm;
use crate::project::{Manifest, ManifestBackend, ManifestDb, ManifestRequires, is_valid_name};
use crate::template::{
    extract_cli_zone, extract_user_zone, postprocess_package_json, write_runtime_version,
};
use std::path::{Path, PathBuf};
use std::process::Command;

fn is_git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn prepare_template_builtin(target_dir: &Path) -> Result<(), String> {
    eprintln!("  \u{2713} Extracting user zone...");
    extract_user_zone(target_dir)?;

    eprintln!("  \u{2713} Extracting CLI zone (runtime + skills)...");
    extract_cli_zone(target_dir)?;

    eprintln!("  \u{2713} Writing runtime version marker...");
    write_runtime_version(target_dir)?;

    eprintln!("  \u{2713} Post-processing package.json...");
    postprocess_package_json(target_dir)?;

    Ok(())
}

fn prepare_template_git(target_dir: &Path, name: &str, template_url: &str) -> Result<(), String> {
    let cwd = target_dir
        .parent()
        .ok_or_else(|| "Invalid target directory".to_string())?;
    let current_dir_target = target_dir.exists();
    let clone_name = if current_dir_target {
        format!(".{name}-template-{}", std::process::id())
    } else {
        name.to_string()
    };
    let clone_dir = cwd.join(&clone_name);

    eprintln!("  \u{2713} Cloning template...");
    let output = Command::new("git")
        .args(["clone", "--depth", "1", template_url, &clone_name])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone failed: {}", stderr.trim()));
    }

    let rm_output = Command::new("git")
        .args(["remote", "remove", "origin"])
        .current_dir(&clone_dir)
        .output()
        .map_err(|e| format!("Failed to remove remote: {e}"))?;

    if !rm_output.status.success() {
        let stderr = String::from_utf8_lossy(&rm_output.stderr);
        eprintln!(
            "Warning: could not remove upstream remote: {}",
            stderr.trim()
        );
    }

    if current_dir_target {
        copy_dir_contents(&clone_dir, target_dir)?;
        std::fs::remove_dir_all(&clone_dir)
            .map_err(|e| format!("Failed to clean temporary template directory: {e}"))?;
    }

    Ok(())
}

fn copy_dir_contents(from: &Path, to: &Path) -> Result<(), String> {
    for entry in
        std::fs::read_dir(from).map_err(|e| format!("Failed to read template directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read template entry: {e}"))?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|e| format!("Failed to create template directory: {e}"))?;
            copy_dir_contents(&source, &target)?;
        } else {
            std::fs::copy(&source, &target)
                .map_err(|e| format!("Failed to copy template file: {e}"))?;
        }
    }
    Ok(())
}

fn is_empty_dir(path: &Path) -> Result<bool, String> {
    let mut entries =
        std::fs::read_dir(path).map_err(|e| format!("Failed to read current directory: {e}"))?;
    Ok(entries.next().is_none())
}

fn resolve_target_dir(cwd: &Path, name: &str) -> Result<PathBuf, String> {
    let cwd_name = cwd.file_name().and_then(|value| value.to_str());
    if cwd_name == Some(name) && is_empty_dir(cwd)? {
        return Ok(cwd.to_path_buf());
    }
    Ok(cwd.join(name))
}

#[derive(Debug, PartialEq, Eq)]
enum InitMode {
    LocalOnly { server_url: String },
    RemoteRequired,
}

fn resolve_init_mode(config: Option<&Config>, skip_deploy: bool) -> Result<InitMode, String> {
    if skip_deploy {
        return Ok(InitMode::LocalOnly {
            server_url: config
                .map(|cfg| cfg.base_url().to_string())
                .unwrap_or_default(),
        });
    }

    let _ = config.ok_or("Not configured. Run 'localapp login' first.")?;
    Ok(InitMode::RemoteRequired)
}

fn write_project_files(
    target_dir: &Path,
    name: &str,
    description: &Option<String>,
    server_url: &str,
) -> Result<Manifest, String> {
    let manifest = Manifest {
        name: name.to_string(),
        description: description.as_deref().unwrap_or("").to_string(),
        dist_dir: "dist".to_string(),
        db: Some(ManifestDb {
            mode: "crud".to_string(),
            sql_access: Some("authenticated".to_string()),
            default_access: None,
        }),
        shell: None,
        issues: None,
        notify: None,
        backend: Some(ManifestBackend {
            root: Some("backend".to_string()),
            include: None,
        }),
        collaboration: None,
        business: None,
        requires: Some(ManifestRequires {
            content: None,
            backend: Some("named-sql".to_string()),
            identity: vec!["currentUser".to_string(), "pageOwner".to_string()],
            primitives: Vec::new(),
        }),
        platform_version: Some("^1.2".to_string()),
    };
    Manifest::write(target_dir, &manifest)?;

    let localapp_dir = target_dir.join(".localapp");
    std::fs::create_dir_all(&localapp_dir)
        .map_err(|e| format!("Failed to create .localapp dir: {e}"))?;
    let dev_config = serde_json::json!({
        "serverUrl": server_url
    });
    let dev_config_path = localapp_dir.join("dev-config.json");
    std::fs::write(
        &dev_config_path,
        serde_json::to_string_pretty(&dev_config).unwrap_or_default(),
    )
    .map_err(|e| format!("Failed to write dev-config.json: {e}"))?;

    Ok(manifest)
}

async fn deploy_project(
    client: &Client,
    target_dir: &Path,
    name: &str,
    manifest: &Manifest,
) -> Result<(), String> {
    // Register page
    eprintln!("  \u{2713} Registering page...");
    let page_body = serde_json::json!({ "name": name });
    let (page_status, page_resp) = client.post_json("/api/pages", page_body).await?;
    if page_status == 409 {
        eprintln!("  (page already exists, reusing)");
    } else if page_status != 200 {
        let error = page_resp["error"].as_str().unwrap_or("Unknown error");
        return Err(format!(
            "Page registration failed: {error}\n  You can manually run: localapp new"
        ));
    }

    // Build
    eprintln!("  \u{2713} Building project...");
    pm::run_build(target_dir)
        .map_err(|e| format!("{e}\n  Fix the build, then run: localapp upload"))?;

    // Upload
    eprintln!("  \u{2713} Uploading...");
    let dist_dir = target_dir.join("dist");
    if !dist_dir.is_dir() {
        return Err("dist/ directory not found after build. Run 'localapp upload' manually after fixing the build.".to_string());
    }

    let files = collect_files(&dist_dir)?;
    if files.is_empty() {
        return Err("No files found in dist/. Run 'localapp upload' manually.".to_string());
    }

    let db_config = manifest
        .db
        .as_ref()
        .map(|db| serde_json::to_string(db).unwrap_or_default());
    let manifest_json = serde_json::to_string(manifest).unwrap_or_default();
    let backend_files =
        crate::commands::upload::collect_backend_files_for_manifest(target_dir, manifest)?;

    let (upload_status, upload_body) = client
        .upload_with_description(
            name,
            files,
            Vec::new(),
            backend_files,
            &manifest.description,
            db_config.as_deref(),
            None,
            None,
            Some(&manifest_json),
        )
        .await?;

    if upload_status != 200 || !upload_body["success"].as_bool().unwrap_or(false) {
        let error = upload_body["error"].as_str().unwrap_or("Upload failed");
        return Err(format!("Upload failed: {}", error));
    }

    let page_url = upload_body["data"]["url"].as_str().unwrap_or("");
    let raw_url = upload_body["data"]["rawUrl"].as_str().unwrap_or("");
    eprintln!("  \u{2713} Deployed!");
    let output = serde_json::json!({
        "created": name,
        "url": page_url,
        "rawUrl": raw_url,
    });
    println!("{output}");

    Ok(())
}

pub async fn run(
    name: &str,
    description: &Option<String>,
    skip_deploy: bool,
    skip_install: bool,
    builtin_repo: bool,
) -> Result<(), String> {
    if !is_valid_name(name) {
        return Err(
            "Invalid name. Must be 3-63 chars, lowercase letters/digits/hyphens, start with a letter, no consecutive or trailing hyphens."
                .to_string(),
        );
    }

    pm::check_available()?;

    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    let target_dir = resolve_target_dir(&cwd, name)?;

    if target_dir.exists() {
        if target_dir != cwd {
            return Err(format!("Directory '{}' already exists", name));
        }
    }

    let config = Config::load();

    let init_mode = resolve_init_mode(config.as_ref(), skip_deploy)?;

    // skip-deploy means a complete local project: no platform config or server request required.
    if let InitMode::LocalOnly { server_url } = init_mode {
        prepare_template_builtin(&target_dir)?;
        let _manifest = write_project_files(&target_dir, name, description, &server_url)?;
        if skip_install {
            eprintln!(
                "  \u{26a0} Skipping npm install. Run 'npm install' manually to install dependencies."
            );
        } else {
            eprintln!("  \u{2713} Installing dependencies...");
            pm::run_install(&target_dir)
                .map_err(|e| format!("{e}\n  You can manually run: cd {} && npm install", name))?;
        }
        let output = serde_json::json!({
            "created": name
        });
        println!("{output}");
        eprintln!(
            "  \u{26a0} Skipping deployment. Run 'localapp upload' manually when ready to deploy."
        );
        return Ok(());
    }

    let cfg = config
        .as_ref()
        .ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(cfg);

    // Get server config to determine template source
    let (status, body) = client.get("/api/config").await?;
    let template_url = if status == 200 {
        body.get("templateRepoUrl")
            .and_then(|v| v.as_str())
            .unwrap_or("")
    } else {
        ""
    };

    // --builtin-repo: skip git, use built-in template directly
    // Default: try git clone from server URL, fallback to builtin on failure
    if builtin_repo {
        prepare_template_builtin(&target_dir)?;
    } else if !template_url.is_empty() && is_git_available() {
        if let Err(e) = prepare_template_git(&target_dir, name, template_url) {
            eprintln!(
                "  \u{26a0} git clone failed ({}), falling back to built-in template",
                e
            );
            let _ = std::fs::remove_dir_all(&target_dir);
            prepare_template_builtin(&target_dir)?;
        }
    } else {
        prepare_template_builtin(&target_dir)?;
    }

    // Write project files (manifest.json + dev-config.json)
    let manifest = write_project_files(&target_dir, name, description, cfg.base_url())?;

    // npm install (skip if --skip-install)
    if skip_install {
        eprintln!(
            "  \u{26a0} Skipping npm install. Run 'npm install' manually to install dependencies."
        );
    } else {
        eprintln!("  \u{2713} Installing dependencies...");
        pm::run_install(&target_dir)
            .map_err(|e| format!("{e}\n  You can manually run: cd {} && npm install", name))?;
    }

    deploy_project(&client, &target_dir, name, &manifest).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_deploy_uses_local_mode_without_config() {
        assert_eq!(
            resolve_init_mode(None, true).unwrap(),
            InitMode::LocalOnly {
                server_url: String::new(),
            },
        );
    }

    #[test]
    fn skip_deploy_preserves_configured_server_url_for_later_upload() {
        let cfg = Config {
            server_url: "http://localhost:3000/".to_string(),
            api_key: "test-key".to_string(),
        };

        assert_eq!(
            resolve_init_mode(Some(&cfg), true).unwrap(),
            InitMode::LocalOnly {
                server_url: "http://localhost:3000".to_string(),
            },
        );
    }

    #[test]
    fn deploy_mode_requires_config() {
        let err = resolve_init_mode(None, false).unwrap_err();
        assert!(err.contains("localapp login"));
    }

    #[test]
    fn generated_manifest_declares_initial_platform_requirements() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = write_project_files(
            dir.path(),
            "first-run-app",
            &Some("First run".to_string()),
            "http://localhost:3000",
        )
        .unwrap();

        assert_eq!(manifest.platform_version.as_deref(), Some("^1.2"));
        let requires = manifest
            .requires
            .expect("generated projects should declare requirements");
        assert_eq!(requires.backend.as_deref(), Some("named-sql"));
        assert_eq!(requires.identity, vec!["currentUser", "pageOwner"]);
        assert!(requires.primitives.is_empty());
    }
}
