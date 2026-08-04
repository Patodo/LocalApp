use crate::AppState;
use localapp_core::{
    ProfileStore, PublishResult, ResolvedTarget, ServerProfile, TargetSelector,
    publish_app_version, resolve_target,
};
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerProfileSummary {
    pub name: String,
    pub server_url: String,
    pub active: bool,
    pub logged_in: bool,
}

#[tauri::command]
pub(crate) fn list_server_profiles() -> Result<Vec<ServerProfileSummary>, String> {
    Ok(public_profiles(&ProfileStore::load()?))
}

#[tauri::command]
pub(crate) fn save_server_profile(
    name: String,
    server_url: String,
    api_key: String,
) -> Result<Vec<ServerProfileSummary>, String> {
    let mut store = ProfileStore::load()?;
    store.upsert(ServerProfile {
        name,
        server_url,
        api_key,
    })?;
    Ok(public_profiles(&store))
}

#[tauri::command]
pub(crate) fn remove_server_profile(name: String) -> Result<Vec<ServerProfileSummary>, String> {
    let mut store = ProfileStore::load()?;
    store.remove(&name)?;
    Ok(public_profiles(&store))
}

#[tauri::command]
pub(crate) fn use_server_profile(app: AppHandle, name: String) -> Result<(), String> {
    let mut store = ProfileStore::load()?;
    store.use_profile(&name)?;
    app.restart()
}

#[tauri::command]
pub(crate) async fn publish_local_app(
    state: State<'_, AppState>,
    app_id: String,
    profile_name: String,
) -> Result<PublishResult, String> {
    let app = state
        .local_apps
        .list()?
        .into_iter()
        .find(|app| app.app_id == app_id)
        .ok_or_else(|| format!("Local application not found: {app_id}"))?;
    let target = resolve_publish_target(&profile_name)?;
    publish_app_version(&app.version_root, &target).await
}

fn resolve_publish_target(profile_name: &str) -> Result<ResolvedTarget, String> {
    if profile_name.trim().is_empty() {
        return Err("Select a Server profile before publishing".into());
    }
    resolve_target(TargetSelector {
        profile: Some(profile_name.to_string()),
        project_default_profile: None,
    })
}

fn public_profiles(store: &ProfileStore) -> Vec<ServerProfileSummary> {
    store
        .profiles
        .values()
        .map(|profile| ServerProfileSummary {
            name: profile.name.clone(),
            server_url: profile.server_url.clone(),
            active: store.active_profile.as_deref() == Some(profile.name.as_str()),
            logged_in: !profile.api_key.trim().is_empty(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn public_profile_list_never_serializes_api_keys() {
        let store = ProfileStore {
            schema_version: 1,
            active_profile: Some("production".into()),
            profiles: BTreeMap::from([(
                "production".into(),
                ServerProfile {
                    name: "production".into(),
                    server_url: "https://work.example".into(),
                    api_key: "test-private-profile-key".into(),
                },
            )]),
        };

        let value = serde_json::to_value(public_profiles(&store)).unwrap();

        assert_eq!(value[0]["name"], "production");
        assert_eq!(value[0]["active"], true);
        assert_eq!(value[0]["loggedIn"], true);
        assert!(!value.to_string().contains("test-private-profile-key"));
        assert!(value[0].get("apiKey").is_none());
    }
}
