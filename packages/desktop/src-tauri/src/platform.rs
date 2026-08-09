use crate::local_platform::{LocalFavoriteRow, LocalInboxRow, LocalPlatformRepository};
use crate::local_store::LocalStore;
use localapp_core::{Config, PlatformClient};
use serde::{Deserialize, Serialize};
use url::form_urlencoded;

pub struct InboxService {
    client: PlatformClient,
}

pub struct FavoriteService {
    client: PlatformClient,
}

/// 本地数据源的消息服务（无远程 server 配置时使用）。
pub struct LocalInboxService<'a> {
    repository: LocalPlatformRepository<'a>,
}

/// 本地数据源的收藏服务（无远程 server 配置时使用）。
pub struct LocalFavoriteService<'a> {
    repository: LocalPlatformRepository<'a>,
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

    pub async fn add(
        &self,
        stored_page_path: &str,
        page_name: Option<&str>,
        owner_name: Option<&str>,
    ) -> Result<Favorite, String> {
        let favorite: ServerFavorite = self
            .client
            .post(
                "/api/favorites",
                &serde_json::json!({
                    "pagePath": stored_page_path,
                    "pageName": page_name,
                    "ownerName": owner_name,
                }),
            )
            .await
            .map_err(|error| format!("Could not save LocalApp favorite: {error}"))?;
        favorite.try_into()
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

impl<'a> LocalInboxService<'a> {
    pub fn new(store: &'a LocalStore) -> Self {
        Self {
            repository: LocalPlatformRepository::new(store),
        }
    }

    pub fn list(&self, cursor: Option<&str>, unread_only: bool) -> Result<InboxPage, String> {
        // 本地分页游标 = 上次返回的 created_at（毫秒），每页 20 条。
        let offset: i64 = cursor
            .and_then(|value| value.parse().ok())
            .unwrap_or_default();
        let rows = self.repository.list_inbox(unread_only, 20, offset as usize)?;
        let has_more = rows.len() == 20;
        let next_cursor = if has_more {
            rows.last().map(|row| row.created_at.to_string())
        } else {
            None
        };
        Ok(InboxPage {
            items: rows.into_iter().map(local_inbox_item).collect(),
            next_cursor,
        })
    }

    pub fn unread_count(&self) -> Result<u32, String> {
        self.repository.unread_count()
    }

    pub fn mark_read(&self, notification_id: &str) -> Result<InboxItem, String> {
        self.repository
            .mark_read(notification_id)?
            .map(local_inbox_item)
            .ok_or_else(|| "Local message not found".to_string())
    }

    pub fn delete(&self, notification_id: &str) -> Result<(), String> {
        self.repository.delete(notification_id)
    }

    pub fn mark_all_read(&self) -> Result<u32, String> {
        self.repository.mark_all_read()
    }
}

impl<'a> LocalFavoriteService<'a> {
    pub fn new(store: &'a LocalStore) -> Self {
        Self {
            repository: LocalPlatformRepository::new(store),
        }
    }

    pub fn list(&self) -> Result<Vec<Favorite>, String> {
        self.repository
            .list_favorites()?
            .into_iter()
            .map(local_favorite)
            .collect()
    }

    pub fn add(
        &self,
        stored_page_path: &str,
        page_name: Option<&str>,
        owner_name: Option<&str>,
    ) -> Result<Favorite, String> {
        let app_path = normalize_app_path(stored_page_path)?;
        let row = self.repository.add_favorite(
            &app_path,
            &app_path,
            page_name,
            owner_name,
        )?;
        local_favorite(row)
    }

    pub fn remove(&self, stored_page_path: &str) -> Result<(), String> {
        let app_path = normalize_app_path(stored_page_path)?;
        self.repository.remove_favorite(&app_path)
    }
}

fn local_inbox_item(row: LocalInboxRow) -> InboxItem {
    InboxItem {
        id: row.id,
        app_owner: row.app_owner,
        app_name: row.app_name,
        title: row.title,
        body: row.body,
        url: row.url,
        priority: row.priority,
        created_at: format_millis(row.created_at),
        read: row.read_at.is_some(),
    }
}

fn local_favorite(row: LocalFavoriteRow) -> Result<Favorite, String> {
    let id = row
        .created_at
        .unsigned_abs()
        .wrapping_mul(1_000_000)
        .wrapping_add(row.stored_page_path.len() as u64);
    Ok(Favorite {
        id,
        app_path: row.app_path,
        stored_page_path: row.stored_page_path,
        page_name: row.page_name,
        owner_name: row.owner_name,
        created_at: format_millis(row.created_at),
    })
}

pub(crate) fn format_millis(millis: i64) -> String {
    chrono::DateTime::from_timestamp_millis(millis)
        .map(|date| date.to_rfc3339())
        .unwrap_or_else(|| millis.to_string())
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
