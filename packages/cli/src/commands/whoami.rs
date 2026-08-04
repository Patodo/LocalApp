use crate::client::Client;
use crate::config::Config;

pub async fn whoami() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;

    let client = Client::new(&config);
    let (_status, body) = client.get("/api/me").await?;

    let data = &body["data"];
    if !body["success"].as_bool().unwrap_or(false) || data.is_null() {
        println!("Not logged in");
        println!("Run 'localapp login' to authenticate.");
        return Ok(());
    }

    let user = &body["data"];
    println!("User:    {}", user["name"].as_str().unwrap_or("unknown"));
    println!("User ID: {}", user["id"].as_str().unwrap_or("unknown"));
    println!("Server:  {}", config.base_url());
    println!("Role:    {}", user["role"].as_str().unwrap_or("user"));

    Ok(())
}

pub async fn logout() -> Result<(), String> {
    let mut config = Config::load().ok_or("Already logged out.")?;

    // Clear the API key but keep the server URL
    config.api_key = String::new();
    config
        .save()
        .map_err(|e| format!("Failed to save config: {e}"))?;

    println!("Logged out successfully");
    println!("Server URL preserved: {}", config.base_url());

    Ok(())
}
