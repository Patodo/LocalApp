use crate::{ResolvedTarget, validate_database_compatibility};
use reqwest::StatusCode;
use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::time::Duration;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub name: String,
    pub url: String,
    pub raw_url: String,
    pub version: u64,
    pub server_url: String,
    pub profile: Option<String>,
}

#[derive(Deserialize)]
struct Envelope {
    success: bool,
    #[serde(default)]
    data: serde_json::Value,
    error: Option<String>,
}

pub async fn publish_app_version(
    version_root: &Path,
    target: &ResolvedTarget,
) -> Result<PublishResult, String> {
    if !version_root.is_absolute() || !version_root.is_dir() {
        return Err("Installed application version directory is unavailable".into());
    }
    let manifest_bytes = fs::read(version_root.join("manifest.json"))
        .map_err(|error| format!("Could not read installed manifest: {error}"))?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("Installed manifest is invalid: {error}"))?;
    let name = manifest["name"]
        .as_str()
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "Installed manifest does not declare an application name".to_string())?;
    let dist = collect_tree(&version_root.join("dist"), &version_root.join("dist"))?;
    if dist.is_empty() {
        return Err("Installed application has no dist files".into());
    }
    let migrations = collect_direct_files(&version_root.join("migrations"), "sql")?;
    let backend = collect_tree(&version_root.join("backend"), &version_root.join("backend"))?
        .into_iter()
        .filter(|(path, _)| path.ends_with(".json"))
        .collect::<Vec<_>>();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Could not create publisher client: {error}"))?;
    let base = reqwest::Url::parse(target.base_url())
        .map_err(|_| "Selected Server URL is invalid".to_string())?;

    send_json(
        client
            .get(join_url(&base, "/api/platform/capabilities")?)
            .header("X-API-Key", &target.api_key),
        &target.api_key,
        "Server capability check",
    )
    .await?;

    let snapshot_url = database_snapshot_url(&base, name)?;
    let snapshot_response = client
        .get(snapshot_url)
        .header("X-API-Key", &target.api_key)
        .send()
        .await
        .map_err(|_| "Database snapshot failed: selected Server is unavailable".to_string())?;
    let snapshot_status = snapshot_response.status();
    let snapshot = if snapshot_status == StatusCode::NOT_FOUND {
        Vec::new()
    } else if snapshot_status.is_success() {
        snapshot_response
            .bytes()
            .await
            .map_err(|_| "Database snapshot returned an invalid response".to_string())?
            .to_vec()
    } else {
        return Err(
            redacted_http_error(snapshot_response, &target.api_key, "Database snapshot").await,
        );
    };
    validate_database_compatibility(&snapshot, &version_root.join("migrations"), &backend)?;

    let registration = client
        .post(join_url(&base, "/api/pages")?)
        .header("X-API-Key", &target.api_key)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|_| "Selected Server is unavailable".to_string())?;
    if registration.status() != StatusCode::CONFLICT {
        read_envelope(registration, &target.api_key, "Page registration").await?;
    }

    let mut form = Form::new().text("name", name.to_string());
    if let Some(description) = manifest["description"]
        .as_str()
        .filter(|value| !value.is_empty())
    {
        form = form.text("description", description.to_string());
    }
    for (field, key) in [
        ("dbConfig", "db"),
        ("shellConfig", "shell"),
        ("notifyConfig", "notify"),
    ] {
        if !manifest[key].is_null() {
            form = form.text(field, manifest[key].to_string());
        }
    }
    form = form.part(
        "manifest",
        Part::bytes(manifest_bytes)
            .file_name("manifest.json")
            .mime_str("application/json")
            .map_err(|error| format!("Could not prepare manifest upload: {error}"))?,
    );
    for (index, (filename, data)) in dist.into_iter().enumerate() {
        form = form
            .text(format!("filepath_{index}"), filename.clone())
            .part(
                "files",
                Part::bytes(data)
                    .file_name(filename)
                    .mime_str("application/octet-stream")
                    .map_err(|error| format!("Could not prepare application upload: {error}"))?,
            );
    }
    for (filename, data) in migrations {
        let checksum = format!("{:x}", Sha256::digest(&data));
        form = form
            .text(format!("migrationChecksum_{filename}"), checksum)
            .part(
                format!("migration_{filename}"),
                Part::bytes(data)
                    .file_name(filename)
                    .mime_str("application/octet-stream")
                    .map_err(|error| format!("Could not prepare migration upload: {error}"))?,
            );
    }
    for (index, (filename, data)) in backend.into_iter().enumerate() {
        let project_path = format!("backend/{filename}");
        form = form
            .text(format!("backendFilepath_{index}"), project_path.clone())
            .part(
                "backendFiles",
                Part::bytes(data)
                    .file_name(project_path)
                    .mime_str("application/json")
                    .map_err(|error| format!("Could not prepare backend upload: {error}"))?,
            );
    }
    let uploaded = client
        .post(join_url(&base, "/api/upload")?)
        .header("X-API-Key", &target.api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|_| "Application upload failed".to_string())?;
    let envelope = read_envelope(uploaded, &target.api_key, "Application upload").await?;
    let url = returned_server_url(
        &base,
        &required_string(&envelope, "url", "Application upload")?,
        "Application upload",
    )?;
    let raw_url = returned_server_url(
        &base,
        &required_string(&envelope, "rawUrl", "Application upload")?,
        "Application upload",
    )?;
    let result = PublishResult {
        name: envelope["name"].as_str().unwrap_or(name).to_string(),
        url: url.to_string(),
        raw_url: raw_url.to_string(),
        version: envelope["version"]
            .as_u64()
            .ok_or_else(|| "Application upload returned an invalid version".to_string())?,
        server_url: target.base_url().to_string(),
        profile: target.profile_name.clone(),
    };
    let index = fs::read(version_root.join("dist/index.html")).map_err(|error| {
        format!("Could not read application entry for deployment verification: {error}")
    })?;
    verify_deployment(&client, &base, target, &result, &index).await?;
    Ok(result)
}

async fn verify_deployment(
    client: &reqwest::Client,
    base: &reqwest::Url,
    target: &ResolvedTarget,
    result: &PublishResult,
    expected_index: &[u8],
) -> Result<(), String> {
    let page = send_json(
        client
            .get(page_details_url(base, &result.name)?)
            .header("X-API-Key", &target.api_key),
        &target.api_key,
        "Deployment metadata verification",
    )
    .await?;
    let deployed_version = page["currentVersion"].as_u64().ok_or_else(|| {
        "Deployment metadata verification returned an invalid version".to_string()
    })?;
    if deployed_version != result.version {
        return Err(format!(
            "Deployment metadata verification failed: uploaded version {} but Server reports version {deployed_version}",
            result.version
        ));
    }
    let owner = required_string(&page, "userId", "Deployment metadata verification")?;
    let metadata_url = returned_server_url(
        base,
        &required_string(&page, "url", "Deployment metadata verification")?,
        "Deployment metadata verification",
    )?;
    let metadata_raw_url = returned_server_url(
        base,
        &required_string(&page, "rawUrl", "Deployment metadata verification")?,
        "Deployment metadata verification",
    )?;
    let uploaded_url = returned_server_url(base, &result.url, "Application upload")?;
    let uploaded_raw_url = returned_server_url(base, &result.raw_url, "Application upload")?;
    if metadata_url != uploaded_url || metadata_raw_url != uploaded_raw_url {
        return Err("Deployment metadata verification failed: deployed entry URLs do not match the upload result".into());
    }

    let session = send_json(
        client
            .post(join_url(base, "/api/verification/sessions")?)
            .header("X-API-Key", &target.api_key)
            .json(&serde_json::json!({
                "owner": owner,
                "app": result.name,
                "version": result.version,
                "identity": "owner"
            })),
        &target.api_key,
        "Deployment smoke session",
    )
    .await?;
    let open_url = returned_server_url(
        base,
        &required_string(&session, "openUrl", "Deployment smoke session")?,
        "Deployment smoke session",
    )?;
    let opened = client.get(open_url).send().await.map_err(|_| {
        "Deployment smoke session failed: selected Server is unavailable".to_string()
    })?;
    if !opened.status().is_redirection() {
        return Err(format!(
            "Deployment smoke session failed: expected redirect, got HTTP {}",
            opened.status()
        ));
    }
    let location = opened
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Deployment smoke session did not return a redirect location".to_string())?;
    let redirect_url = returned_server_url(base, location, "Deployment smoke session")?;
    if redirect_url != uploaded_url {
        return Err("Deployment smoke session redirected to an unexpected formal entry".into());
    }
    let cookies = opened
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .collect::<Vec<_>>()
        .join("; ");
    if cookies.is_empty() {
        return Err("Deployment smoke session did not establish an application session".into());
    }

    require_success(
        client
            .get(uploaded_url)
            .header(COOKIE, &cookies)
            .send()
            .await,
        "Formal application entry verification",
    )
    .await?;
    let raw_response = require_success(
        client
            .get(uploaded_raw_url.clone())
            .header(COOKIE, &cookies)
            .send()
            .await,
        "Raw application entry verification",
    )
    .await?;
    let deployed_index = raw_response.bytes().await.map_err(|_| {
        "Raw application entry verification returned an invalid response".to_string()
    })?;
    if deployed_index.as_ref() != expected_index {
        return Err(
            "Raw application entry verification failed: deployed content does not match the uploaded version"
                .into(),
        );
    }
    let api_url = uploaded_raw_url
        .join("api/time")
        .map_err(|_| "Deployment API verification URL is invalid".to_string())?;
    let api_response = client
        .get(api_url)
        .header(COOKIE, cookies)
        .send()
        .await
        .map_err(|_| {
            "Deployment API verification failed: selected Server is unavailable".to_string()
        })?;
    read_envelope(api_response, &target.api_key, "Deployment API verification").await?;
    Ok(())
}

async fn require_success(
    response: Result<reqwest::Response, reqwest::Error>,
    operation: &str,
) -> Result<reqwest::Response, String> {
    let response =
        response.map_err(|_| format!("{operation} failed: selected Server is unavailable"))?;
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(format!(
            "{operation} failed (HTTP {})",
            response.status().as_u16()
        ))
    }
}

async fn send_json(
    request: reqwest::RequestBuilder,
    api_key: &str,
    operation: &str,
) -> Result<serde_json::Value, String> {
    let response = request
        .send()
        .await
        .map_err(|_| format!("{operation} failed: selected Server is unavailable"))?;
    read_envelope(response, api_key, operation).await
}

async fn redacted_http_error(
    response: reqwest::Response,
    api_key: &str,
    operation: &str,
) -> String {
    let status = response.status();
    let message = response
        .text()
        .await
        .unwrap_or_else(|_| "request rejected".to_string())
        .replace(api_key, "[REDACTED]");
    format!("{operation} failed ({}): {message}", status.as_u16())
}

async fn read_envelope(
    response: reqwest::Response,
    api_key: &str,
    operation: &str,
) -> Result<serde_json::Value, String> {
    let status = response.status();
    let envelope: Envelope = response
        .json()
        .await
        .map_err(|_| format!("{operation} returned an invalid response"))?;
    if status.is_success() && envelope.success {
        return Ok(envelope.data);
    }
    let message = envelope.error.unwrap_or_else(|| {
        status
            .canonical_reason()
            .unwrap_or("request rejected")
            .to_string()
    });
    Err(format!(
        "{operation} failed ({}): {}",
        status.as_u16(),
        message.replace(api_key, "[REDACTED]")
    ))
}

fn join_url(base: &reqwest::Url, path: &str) -> Result<reqwest::Url, String> {
    let url = base
        .join(path)
        .map_err(|_| "Selected Server URL is invalid".to_string())?;
    if url.origin() != base.origin() {
        return Err("Selected Server URL is invalid".into());
    }
    Ok(url)
}

fn database_snapshot_url(base: &reqwest::Url, name: &str) -> Result<reqwest::Url, String> {
    let mut url = join_url(base, "/api/db/snapshot")?;
    url.query_pairs_mut().append_pair("name", name);
    Ok(url)
}

fn page_details_url(base: &reqwest::Url, name: &str) -> Result<reqwest::Url, String> {
    let mut url = join_url(base, "/api/pages/")?;
    url.path_segments_mut()
        .map_err(|_| "Selected Server URL is invalid".to_string())?
        .pop_if_empty()
        .push(name);
    Ok(url)
}

fn returned_server_url(
    base: &reqwest::Url,
    value: &str,
    operation: &str,
) -> Result<reqwest::Url, String> {
    let url = base
        .join(value)
        .map_err(|_| format!("{operation} returned an invalid URL"))?;
    if url.origin() != base.origin() {
        return Err(format!("{operation} returned a URL for a different Server"));
    }
    Ok(url)
}

fn required_string(
    value: &serde_json::Value,
    key: &str,
    operation: &str,
) -> Result<String, String> {
    value[key]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{operation} did not return {key}"))
}

fn collect_direct_files(
    directory: &Path,
    extension: &str,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(directory)
        .map_err(|error| format!("Could not read publish directory: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read publish directory: {error}"))?;
    files.sort_by_key(|entry| entry.file_name());
    files
        .into_iter()
        .filter(|entry| {
            entry.path().extension().and_then(|value| value.to_str()) == Some(extension)
        })
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let data = fs::read(entry.path())
                .map_err(|error| format!("Could not read publish file {name}: {error}"))?;
            Ok((name, data))
        })
        .collect()
}

fn collect_tree(base: &Path, current: &Path) -> Result<Vec<(String, Vec<u8>)>, String> {
    if !current.exists() {
        return Ok(Vec::new());
    }
    let mut output = Vec::new();
    collect_tree_into(base, current, &mut output)?;
    output.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(output)
}

fn collect_tree_into(
    base: &Path,
    current: &Path,
    output: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(current)
        .map_err(|error| format!("Could not read publish directory: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read publish directory: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect publish file: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Publish content cannot contain symlinks: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_tree_into(base, &path, output)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(base)
                .map_err(|_| "Publish file escaped its content root".to_string())?;
            let name = safe_relative_path(relative)?;
            output.push((
                name,
                fs::read(&path).map_err(|error| format!("Could not read publish file: {error}"))?,
            ));
        }
    }
    Ok(())
}

fn safe_relative_path(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        let std::path::Component::Normal(component) = component else {
            return Err("Publish path is unsafe".into());
        };
        parts.push(
            component
                .to_str()
                .ok_or_else(|| "Publish path must be UTF-8".to_string())?,
        );
    }
    if parts.is_empty() {
        return Err("Publish path is empty".into());
    }
    Ok(parts.join("/"))
}
