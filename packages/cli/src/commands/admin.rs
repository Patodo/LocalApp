use crate::client::Client;
use crate::config::Config;

pub async fn users() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let (status, body) = client.get("/api/admin/users").await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{body}");
    Ok(())
}

pub async fn pages() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let (status, body) = client.get("/api/admin/pages").await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{body}");
    Ok(())
}

pub async fn stats() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let (status, body) = client.get("/api/admin/stats").await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{body}");
    Ok(())
}
