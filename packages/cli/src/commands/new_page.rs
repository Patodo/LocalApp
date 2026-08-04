use crate::client::Client;
use crate::config::Config;
use crate::project::Manifest;

pub async fn run() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;

    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;

    let manifest =
        Manifest::read(&cwd).ok_or("No manifest.json found. Run 'localapp init' first.")?;

    if manifest.name.is_empty() {
        return Err("No name in manifest.json".to_string());
    }

    let body = serde_json::json!({
        "name": manifest.name,
    });

    let client = Client::new(&config);
    let (status, resp) = client.post_json("/api/pages", body).await?;

    if status != 200 {
        let error = resp["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }

    let name = resp["data"]["name"]
        .as_str()
        .unwrap_or(&manifest.name)
        .to_string();
    let url = resp["data"]["url"].as_str().unwrap_or("").to_string();
    let raw_url = resp["data"]["rawUrl"].as_str().unwrap_or("").to_string();

    let output = serde_json::json!({
        "name": name,
        "url": url,
        "rawUrl": raw_url,
    });
    println!("{output}");
    Ok(())
}
