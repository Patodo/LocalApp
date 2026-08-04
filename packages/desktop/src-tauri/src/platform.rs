use localapp_core::{Config, PlatformClient};
use serde::{Deserialize, Serialize};
use url::form_urlencoded;

pub struct InboxService {
    client: PlatformClient,
}

pub struct FavoriteService {
    client: PlatformClient,
}

impl FavoriteService {
    pub fn new(config: Config) -> Self {
        Self {
            client: PlatformClient::new(config),
        }
    }

    pub async fn list(&self) -> Result<Vec<Favorite>, String> {
        let favorites: Vec<ServerFavorite> = self
            .client
            .get("/api/me/favorites?limit=100")
            .await
            .map_err(favorites_error)?;
        favorites.into_iter().map(TryInto::try_into).collect()
    }

    pub async fn remove(&self, page_path: &str) -> Result<(), String> {
        let _: FavoriteMutationResult = self
            .client
            .delete(&favorite_path(page_path))
            .await
            .map_err(favorites_error)?;
        Ok(())
    }
}

impl InboxService {
    pub fn new(config: Config) -> Self {
        Self {
            client: PlatformClient::new(config),
        }
    }

    pub async fn list(&self, cursor: Option<&str>, unread_only: bool) -> Result<InboxPage, String> {
        let page: ServerInboxPage = self
            .client
            .get(&inbox_path(cursor, unread_only))
            .await
            .map_err(platform_error)?;
        Ok(page.into())
    }

    pub async fn unread_count(&self) -> Result<u32, String> {
        let count: UnreadCount = self
            .client
            .get("/api/inbox/unread-count")
            .await
            .map_err(platform_error)?;
        Ok(count.count)
    }

    pub async fn mark_read(&self, notification_id: &str) -> Result<InboxItem, String> {
        let item: ServerInboxItem = self
            .client
            .patch(&notification_path(notification_id), &serde_json::json!({}))
            .await
            .map_err(platform_error)?;
        Ok(item.into())
    }

    pub async fn delete(&self, notification_id: &str) -> Result<(), String> {
        let _: DeleteResult = self
            .client
            .delete(&notification_path(notification_id))
            .await
            .map_err(platform_error)?;
        Ok(())
    }

    pub async fn mark_all_read(&self) -> Result<u32, String> {
        let result: MarkAllReadResult = self
            .client
            .post("/api/inbox/read-all", &serde_json::json!({}))
            .await
            .map_err(platform_error)?;
        Ok(result.updated)
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxListInput {
    pub cursor: Option<String>,
    #[serde(default)]
    pub unread_only: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    id: String,
    app_owner: String,
    app_name: String,
    title: String,
    body: Option<String>,
    url: Option<String>,
    priority: String,
    created_at: String,
    read: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxPage {
    items: Vec<InboxItem>,
    next_cursor: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    id: u64,
    stored_page_path: String,
    app_path: String,
    page_name: Option<String>,
    owner_name: Option<String>,
    created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerFavorite {
    id: u64,
    page_path: String,
    page_name: Option<String>,
    owner_name: Option<String>,
    created_at: String,
}

impl TryFrom<ServerFavorite> for Favorite {
    type Error = String;

    fn try_from(favorite: ServerFavorite) -> Result<Self, Self::Error> {
        Ok(Self {
            id: favorite.id,
            app_path: normalize_app_path(&favorite.page_path)?,
            stored_page_path: favorite.page_path,
            page_name: favorite.page_name,
            owner_name: favorite.owner_name,
            created_at: favorite.created_at,
        })
    }
}

#[derive(Deserialize)]
struct ServerInboxPage {
    items: Vec<ServerInboxItem>,
    cursor: Option<String>,
}

impl From<ServerInboxPage> for InboxPage {
    fn from(page: ServerInboxPage) -> Self {
        Self {
            items: page.items.into_iter().map(Into::into).collect(),
            next_cursor: page.cursor,
        }
    }
}

#[derive(Deserialize)]
struct ServerInboxItem {
    id: String,
    app_owner: String,
    app_name: String,
    title: String,
    body: Option<String>,
    url: Option<String>,
    priority: String,
    created_at: String,
    read_at: Option<String>,
}

impl From<ServerInboxItem> for InboxItem {
    fn from(item: ServerInboxItem) -> Self {
        Self {
            id: item.id,
            app_owner: item.app_owner,
            app_name: item.app_name,
            title: item.title,
            body: item.body,
            url: item.url,
            priority: item.priority,
            created_at: item.created_at,
            read: item.read_at.is_some(),
        }
    }
}

#[derive(Deserialize)]
struct UnreadCount {
    count: u32,
}

#[derive(Deserialize)]
struct DeleteResult {
    #[allow(dead_code)]
    deleted: bool,
}

#[derive(Deserialize)]
struct MarkAllReadResult {
    updated: u32,
}

#[derive(Deserialize)]
struct FavoriteMutationResult {
    #[allow(dead_code)]
    favorited: bool,
}

fn inbox_path(cursor: Option<&str>, unread_only: bool) -> String {
    let mut query = form_urlencoded::Serializer::new("/api/inbox?limit=20".to_string());
    if let Some(cursor) = cursor {
        query.append_pair("cursor", cursor);
    }
    if unread_only {
        query.append_pair("unreadOnly", "true");
    }
    query.finish()
}

fn notification_path(notification_id: &str) -> String {
    let encoded: String = form_urlencoded::byte_serialize(notification_id.as_bytes()).collect();
    format!("/api/inbox/{encoded}")
}

fn favorite_path(page_path: &str) -> String {
    let encoded: String = form_urlencoded::byte_serialize(page_path.as_bytes()).collect();
    format!("/api/favorites/{encoded}")
}

pub(crate) fn normalize_app_path(stored_page_path: &str) -> Result<String, String> {
    let relative_path = stored_page_path.trim_start_matches('/');
    if relative_path.contains(['%', '?', '#', '\\', '@', ':']) {
        return Err("Favorite path must be a canonical owner/app path".to_string());
    }

    let segments: Vec<&str> = relative_path.split('/').collect();
    if segments.len() != 2
        || segments
            .iter()
            .any(|segment| segment.is_empty() || matches!(*segment, "." | ".."))
    {
        return Err("Favorite path must be a canonical owner/app path".to_string());
    }

    Ok(format!("/{relative_path}"))
}

fn platform_error(error: localapp_core::PlatformError) -> String {
    format!("Could not load LocalApp messages: {error}")
}

fn favorites_error(error: localapp_core::PlatformError) -> String {
    format!("Could not load LocalApp favorites: {error}")
}
