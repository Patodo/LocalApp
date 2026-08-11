use crate::commands::app::{collect_backend_files_for_manifest, collect_package_source_tree};
use crate::commands::check;
use crate::project::Manifest;
use localapp_core::{AppPackageMetadata, build_app_package_from_files};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
struct ProjectPackage {
    #[serde(default = "default_version")]
    version: String,
}

fn default_version() -> String {
    "0.0.0".into()
}

pub(crate) struct PackageBuildResult {
    pub path: PathBuf,
    pub app_id: String,
    pub version: String,
    pub sha256: String,
    pub size: u64,
}

pub async fn run(package: bool, output: Option<&str>) -> Result<(), String> {
    if !package {
        return Err("The build command currently requires --package".into());
    }
    let cwd = std::env::current_dir().map_err(|error| format!("Failed to get cwd: {error}"))?;
    let result = build_package(&cwd, output).await?;
    println!(
        "{}",
        serde_json::json!({
            "success": true,
            "appId": result.app_id,
            "version": result.version,
            "path": result.path,
            "sha256": result.sha256,
            "size": result.size,
        })
    );
    Ok(())
}

pub async fn build_package(
    project: &Path,
    output: Option<&str>,
) -> Result<PackageBuildResult, String> {
    build_package_with_version(project, output, None).await
}

pub async fn build_package_for_dev(
    project: &Path,
    output: Option<&str>,
) -> Result<PackageBuildResult, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to read system clock: {error}"))?
        .as_nanos();
    let version = format!("0.0.0-dev-{}-{timestamp}", std::process::id());
    build_package_with_version(project, output, Some(version)).await
}

async fn build_package_with_version(
    project: &Path,
    output: Option<&str>,
    version_override: Option<String>,
) -> Result<PackageBuildResult, String> {
    check::run_local_for_package(project).await?;
    let manifest = Manifest::read_validated(project)?
        .ok_or_else(|| "No manifest.json found. Run 'localapp init' first.".to_string())?;
    let version = match version_override {
        Some(version) => version,
        None => read_project_version(project)?,
    };
    let output = resolve_output(project, output, &manifest.name);
    let files = collect_canonical_package_files(project, &manifest)?;
    let summary = build_app_package_from_files(
        &output,
        AppPackageMetadata {
            schema_version: 1,
            app_id: manifest.name.clone(),
            version,
            platform_version: manifest
                .platform_version
                .clone()
                .unwrap_or_else(|| "^1.0".into()),
        },
        files,
    )
    .map_err(|error| error.to_string())?;
    Ok(PackageBuildResult {
        path: output,
        app_id: summary.metadata.app_id,
        version: summary.metadata.version,
        sha256: summary.sha256,
        size: summary.size,
    })
}

fn collect_canonical_package_files(
    project: &Path,
    manifest: &Manifest,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut files = vec![(
        "manifest.json".to_string(),
        canonical_package_manifest(project, manifest)?,
    )];

    let dist = collect_package_source_tree(project, &manifest.dist_dir, "distDir", true)?;
    files.extend(
        dist.into_iter()
            .map(|(path, bytes)| (format!("dist/{path}"), bytes)),
    );

    let migrations = collect_package_source_tree(project, "migrations", "migrations", false)?;
    files.extend(
        migrations
            .into_iter()
            .filter(|(path, _)| path.ends_with(".sql"))
            .map(|(path, bytes)| (format!("migrations/{path}"), bytes)),
    );

    let backend = collect_backend_files_for_manifest(project, manifest)?;
    let backend_root = manifest
        .backend
        .as_ref()
        .and_then(|backend| backend.root.as_deref())
        .unwrap_or("backend");
    let has_include = manifest
        .backend
        .as_ref()
        .and_then(|backend| backend.include.as_deref())
        .is_some_and(|include| !include.is_empty());
    for (source_path, bytes) in backend {
        let canonical_relative = if has_include {
            strip_backend_root(&source_path, backend_root).unwrap_or_else(|| source_path.clone())
        } else {
            strip_backend_root(&source_path, backend_root).ok_or_else(|| {
                format!(
                    "backend file is outside configured backend root {backend_root}: {source_path}"
                )
            })?
        };
        files.push((format!("backend/{canonical_relative}"), bytes));
    }

    Ok(files)
}

fn strip_backend_root(path: &str, root: &str) -> Option<String> {
    let root = root
        .replace('\\', "/")
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/");
    if root.is_empty() {
        return None;
    }
    path.strip_prefix(&format!("{root}/"))
        .filter(|relative| !relative.is_empty())
        .map(str::to_string)
}

fn canonical_package_manifest(project: &Path, manifest: &Manifest) -> Result<Vec<u8>, String> {
    let path = project.join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_slice(
        &fs::read(&path).map_err(|error| format!("Failed to read manifest.json: {error}"))?,
    )
    .map_err(|error| format!("Invalid manifest.json: {error}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "manifest.json must contain an object".to_string())?;
    object.insert("distDir".into(), serde_json::Value::String("dist".into()));
    if manifest.backend.is_some() {
        let backend = object
            .entry("backend")
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or_else(|| "manifest.json backend must contain an object".to_string())?;
        backend.insert("root".into(), serde_json::Value::String("backend".into()));
        backend.remove("include");
    }
    serde_json::to_vec(&value)
        .map_err(|error| format!("Failed to serialize package manifest: {error}"))
}

fn read_project_version(project: &Path) -> Result<String, String> {
    let path = project.join("package.json");
    if !path.exists() {
        return Ok(default_version());
    }
    let package: ProjectPackage = serde_json::from_slice(
        &fs::read(&path).map_err(|error| format!("Failed to read package.json: {error}"))?,
    )
    .map_err(|error| format!("Invalid package.json: {error}"))?;
    if package.version.trim().is_empty() {
        Ok(default_version())
    } else {
        Ok(package.version)
    }
}

fn resolve_output(project: &Path, output: Option<&str>, app_id: &str) -> PathBuf {
    let configured = output
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(format!("{app_id}.localapp")));
    if configured.is_absolute() {
        configured
    } else {
        project.join(configured)
    }
}
