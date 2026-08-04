use crate::config::{ProfileStore, ServerProfile};

pub fn add(name: &str, server_url: &str, api_key: &str) -> Result<(), String> {
    let mut store = ProfileStore::load()?;
    store.upsert(ServerProfile {
        name: name.to_string(),
        server_url: server_url.to_string(),
        api_key: api_key.to_string(),
    })?;
    let profile = store
        .profiles
        .get(name)
        .ok_or_else(|| format!("Server profile not found after save: {name}"))?;
    println!(
        "{}",
        serde_json::json!({
            "success": true,
            "profile": {
                "name": profile.name,
                "serverUrl": profile.server_url,
                "active": store.active_profile.as_deref() == Some(name),
                "loggedIn": true,
            }
        })
    );
    Ok(())
}

pub fn list() -> Result<(), String> {
    let store = ProfileStore::load()?;
    let profiles = store
        .profiles
        .values()
        .map(|profile| {
            serde_json::json!({
                "name": profile.name,
                "serverUrl": profile.server_url,
                "active": store.active_profile.as_deref() == Some(profile.name.as_str()),
                "loggedIn": !profile.api_key.is_empty(),
            })
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        serde_json::json!({
            "success": true,
            "activeProfile": store.active_profile,
            "profiles": profiles,
        })
    );
    Ok(())
}

pub fn use_profile(name: &str) -> Result<(), String> {
    let mut store = ProfileStore::load()?;
    store.use_profile(name)?;
    let profile = store
        .profiles
        .get(name)
        .ok_or_else(|| format!("Server profile not found after selection: {name}"))?;
    println!(
        "{}",
        serde_json::json!({
            "success": true,
            "activeProfile": name,
            "serverUrl": profile.server_url,
        })
    );
    Ok(())
}

pub fn remove(name: &str) -> Result<(), String> {
    let mut store = ProfileStore::load()?;
    store.remove(name)?;
    println!(
        "{}",
        serde_json::json!({
            "success": true,
            "removed": name,
            "activeProfile": store.active_profile,
        })
    );
    Ok(())
}
