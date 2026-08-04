use crate::config::Config;
use reqwest::multipart;
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::time::Duration;

const VERSION: &str = match option_env!("LOCALAPP_CLI_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

pub struct Client {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
}

#[cfg(test)]
mod tests {
    use super::Client;
    use crate::config::Config;
    use httpmock::{Method, MockServer};

    #[tokio::test]
    async fn authenticated_requests_never_follow_cross_origin_redirects() {
        let external = MockServer::start();
        let leaked = external.mock(|when, then| {
            when.method(Method::GET)
                .path("/target")
                .header("x-api-key", "instance-secret");
            then.status(200).json_body_obj(&serde_json::json!({}));
        });
        let platform = MockServer::start();
        let redirect = platform.mock(|when, then| {
            when.method(Method::GET)
                .path("/api/cli/version")
                .header("x-api-key", "instance-secret");
            then.status(302).header("location", external.url("/target"));
        });
        let client = Client::new(&Config {
            server_url: platform.base_url(),
            api_key: "instance-secret".to_string(),
        });

        let result = client.get("/api/cli/version").await;

        assert!(result.is_err());
        redirect.assert();
        leaked.assert_hits(0);
    }
}

impl Client {
    pub fn new(config: &Config) -> Self {
        Client {
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .build()
                .expect("failed to build LocalApp HTTP client"),
            base_url: config.base_url().to_string(),
            api_key: config.api_key.clone(),
        }
    }

    pub async fn get(&self, path: &str) -> Result<(u16, Value), String> {
        let url = format!("{}{path}", self.base_url);
        let res = self
            .http
            .get(&url)
            .header("X-API-Key", &self.api_key)
            .header("X-CLI-Version", VERSION)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        let status = res.status().as_u16();
        let body = res
            .json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        Ok((status, body))
    }

    pub async fn get_bytes(&self, path: &str) -> Result<(u16, Vec<u8>), String> {
        let url = format!("{}{path}", self.base_url);
        let res = self
            .http
            .get(&url)
            .header("X-API-Key", &self.api_key)
            .header("X-CLI-Version", VERSION)
            .send()
            .await
            .map_err(|_| {
                "Cannot reach prod server. Validation requires online connection.".to_string()
            })?;
        let status = res.status().as_u16();
        let body = res
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response: {e}"))?
            .to_vec();
        Ok((status, body))
    }

    pub async fn post_json(&self, path: &str, body: Value) -> Result<(u16, Value), String> {
        let url = format!("{}{path}", self.base_url);
        let res = self
            .http
            .post(&url)
            .header("X-API-Key", &self.api_key)
            .header("Content-Type", "application/json")
            .header("X-CLI-Version", VERSION)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        let status = res.status().as_u16();
        let body = res
            .json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        Ok((status, body))
    }

    pub async fn post_empty(&self, path: &str) -> Result<(u16, Value), String> {
        let url = format!("{}{path}", self.base_url);
        let res = self
            .http
            .post(&url)
            .header("X-API-Key", &self.api_key)
            .header("X-CLI-Version", VERSION)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        let status = res.status().as_u16();
        let body = res
            .json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        Ok((status, body))
    }

    pub async fn delete(&self, path: &str) -> Result<(u16, Value), String> {
        let url = format!("{}{path}", self.base_url);
        let res = self
            .http
            .delete(&url)
            .header("X-API-Key", &self.api_key)
            .header("X-CLI-Version", VERSION)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        let status = res.status().as_u16();
        let body = res
            .json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        Ok((status, body))
    }

    pub async fn delete_json(&self, path: &str, body: Value) -> Result<(u16, Value), String> {
        let url = format!("{}{path}", self.base_url);
        let res = self
            .http
            .delete(&url)
            .header("X-API-Key", &self.api_key)
            .header("Content-Type", "application/json")
            .header("X-CLI-Version", VERSION)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        let status = res.status().as_u16();
        let body = res
            .json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        Ok((status, body))
    }

    pub async fn upload_with_description(
        &self,
        page_name: &str,
        files: Vec<(String, Vec<u8>)>,
        migrations: Vec<(String, Vec<u8>, String)>,
        backend_files: Vec<(String, Vec<u8>)>,
        description: &str,
        db_config: Option<&str>,
        shell_config: Option<&str>,
        notify_config: Option<&str>,
        manifest_json: Option<&str>,
    ) -> Result<(u16, Value), String> {
        let url = format!("{}/api/upload", self.base_url);
        let mut form = multipart::Form::new();
        form = form.text("name", page_name.to_string());

        if !description.is_empty() {
            form = form.text("description", description.to_string());
        }

        if let Some(db) = db_config {
            form = form.text("dbConfig", db.to_string());
        }

        if let Some(shell) = shell_config {
            form = form.text("shellConfig", shell.to_string());
        }

        if let Some(notify) = notify_config {
            form = form.text("notifyConfig", notify.to_string());
        }

        if let Some(manifest) = manifest_json {
            let part = multipart::Part::text(manifest.to_string())
                .file_name("manifest.json")
                .mime_str("application/json")
                .map_err(|e| format!("MIME error: {e}"))?;
            form = form.part("manifest", part);
        }

        for (index, (filename, data)) in files.into_iter().enumerate() {
            form = form.text(format!("filepath_{index}"), filename.clone());
            let part = multipart::Part::bytes(data)
                .file_name(filename.clone())
                .mime_str("application/octet-stream")
                .map_err(|e| format!("MIME error: {e}"))?;
            form = form.part("files", part);
        }

        for (filename, data, checksum) in migrations {
            form = form.text(format!("migrationChecksum_{filename}"), checksum);
            let part = multipart::Part::bytes(data)
                .file_name(filename.clone())
                .mime_str("application/octet-stream")
                .map_err(|e| format!("MIME error: {e}"))?;
            form = form.part(format!("migration_{filename}"), part);
        }

        for (index, (filename, data)) in backend_files.into_iter().enumerate() {
            form = form.text(format!("backendFilepath_{index}"), filename.clone());
            let part = multipart::Part::bytes(data)
                .file_name(filename.clone())
                .mime_str("application/json")
                .map_err(|e| format!("MIME error: {e}"))?;
            form = form.part("backendFiles", part);
        }

        let res = self
            .http
            .post(&url)
            .header("X-API-Key", &self.api_key)
            .header("X-CLI-Version", VERSION)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Upload failed: {e}"))?;
        let status = res.status().as_u16();
        let body = res
            .json::<Value>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;
        Ok((status, body))
    }
}

pub fn collect_files(dir: &Path) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut files = Vec::new();
    collect_files_recursive(dir, dir, &mut files)?;
    Ok(files)
}

fn collect_files_recursive(
    base: &Path,
    current: &Path,
    files: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|e| format!("Failed to read dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(base, &path, files)?;
        } else {
            let relative = path
                .strip_prefix(base)
                .map_err(|e| format!("Path error: {e}"))?
                .to_string_lossy()
                .replace('\\', "/");
            if relative == "db/seeds" || relative.starts_with("db/seeds/") {
                continue;
            }
            let data = fs::read(&path).map_err(|e| format!("Failed to read {}: {e}", relative))?;
            files.push((relative, data));
        }
    }
    Ok(())
}
