use crate::client::Client;
use crate::config::Config;
use serde_json::json;

pub async fn list() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let (status, body) = client.get("/api/groups").await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{body}");
    Ok(())
}

pub async fn create(name: &str, description: Option<&str>) -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let mut body = json!({
        "name": name,
    });
    if let Some(desc) = description {
        body["description"] = json!(desc);
    }
    let client = Client::new(&config);
    let (status, resp) = client.post_json("/api/groups", body).await?;
    if status != 200 && status != 201 {
        let error = resp["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{resp}");
    Ok(())
}

pub async fn delete(name: &str) -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let id = resolve_group_id(&client, name).await?;
    let (status, body) = client.delete(&format!("/api/groups/{id}")).await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{body}");
    Ok(())
}

pub async fn members(group: &str) -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let id = resolve_group_id(&client, group).await?;
    let (status, body) = client.get(&format!("/api/groups/{id}")).await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    let members = &body["data"]["members"];
    println!("{members}");
    Ok(())
}

pub async fn members_add(group: &str, user_ids: &[String]) -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let id = resolve_group_id(&client, group).await?;
    let body = json!({
        "userIds": user_ids,
    });
    let (status, resp) = client
        .post_json(&format!("/api/groups/{id}/members"), body)
        .await?;
    if status != 200 {
        let error = resp["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{resp}");
    Ok(())
}

pub async fn members_remove(group: &str, user_ids: &[String]) -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let id = resolve_group_id(&client, group).await?;
    let body = json!({
        "userIds": user_ids,
    });
    let (status, resp) = client
        .post_json(&format!("/api/groups/{id}/members/remove"), body)
        .await?;
    if status != 200 {
        let error = resp["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    println!("{resp}");
    Ok(())
}

async fn resolve_group_id(client: &Client, name: &str) -> Result<String, String> {
    let (status, body) = client.get("/api/groups").await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }
    let groups = body.get("data").ok_or("Failed to parse groups list")?;

    let arr = groups.as_array().ok_or("Groups list is not an array")?;

    for group in arr {
        if group["name"].as_str() == Some(name) {
            let id = group["id"].as_str().ok_or("Group entry has no id field")?;
            return Ok(id.to_string());
        }
    }

    Err(format!("Group '{}' not found", name))
}
