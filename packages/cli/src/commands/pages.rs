use crate::client::Client;
use crate::config::Config;
use crate::project::Manifest;

pub async fn list() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let (status, body) = client.get("/api/pages").await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{body}");
    Ok(())
}

pub async fn info(page_name: Option<String>) -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let name = resolve_page_name(page_name)?;
    let client = Client::new(&config);
    let (status, body) = client.get(&format!("/api/pages/{name}")).await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{body}");
    Ok(())
}

pub async fn delete(page_name: Option<String>) -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let name = resolve_page_name(page_name)?;
    let client = Client::new(&config);
    let (status, body) = client.delete(&format!("/api/pages/{name}")).await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{body}");
    Ok(())
}

fn resolve_page_name(page_name: Option<String>) -> Result<String, String> {
    if let Some(name) = page_name {
        return Ok(name);
    }
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    let manifest =
        Manifest::read(&cwd).ok_or("No manifest.json found. Run 'localapp init' first.")?;
    if manifest.name.is_empty() {
        return Err("No name in manifest.json".to_string());
    }
    Ok(manifest.name)
}
