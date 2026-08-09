use crate::local_store::LocalStore;
use rusqlite::{OptionalExtension, params};
use uuid::Uuid;

pub struct LocalInboxRow {
    pub id: String,
    pub app_owner: String,
    pub app_name: String,
    pub title: String,
    pub body: Option<String>,
    pub url: Option<String>,
    pub priority: String,
    pub created_at: i64,
    pub read_at: Option<i64>,
}

pub struct LocalFavoriteRow {
    pub stored_page_path: String,
    pub app_path: String,
    pub page_name: Option<String>,
    pub owner_name: Option<String>,
    pub created_at: i64,
}

/// 本地消息/收藏的 SQLite 数据访问层（无远程 server 时的本地数据源）。
pub struct LocalPlatformRepository<'a> {
    store: &'a LocalStore,
}

impl<'a> LocalPlatformRepository<'a> {
    pub fn new(store: &'a LocalStore) -> Self {
        Self { store }
    }

    pub fn insert_inbox_item(
        &self,
        app_owner: &str,
        app_name: &str,
        title: &str,
        body: Option<&str>,
        url: Option<&str>,
        priority: &str,
    ) -> Result<LocalInboxRow, String> {
        let id = Uuid::new_v4().to_string();
        let created_at = now_millis();
        self.store.with_connection(|connection| {
            connection
                .execute(
                    "INSERT INTO local_inbox_items (
                        id, app_owner, app_name, title, body, url, priority, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    params![id, app_owner, app_name, title, body, url, priority, created_at],
                )
                .map_err(|error| format!("Could not insert local inbox item: {error}"))?;
            Ok(())
        })?;
        Ok(LocalInboxRow {
            id,
            app_owner: app_owner.to_string(),
            app_name: app_name.to_string(),
            title: title.to_string(),
            body: body.map(str::to_string),
            url: url.map(str::to_string),
            priority: priority.to_string(),
            created_at,
            read_at: None,
        })
    }

    pub fn list_inbox(
        &self,
        unread_only: bool,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<LocalInboxRow>, String> {
        let sql = if unread_only {
            "SELECT id, app_owner, app_name, title, body, url, priority, created_at, read_at
             FROM local_inbox_items
             WHERE read_at IS NULL
             ORDER BY created_at DESC
             LIMIT ?1 OFFSET ?2"
        } else {
            "SELECT id, app_owner, app_name, title, body, url, priority, created_at, read_at
             FROM local_inbox_items
             ORDER BY created_at DESC
             LIMIT ?1 OFFSET ?2"
        };
        self.store.with_connection(|connection| {
            let mut statement = connection
                .prepare(sql)
                .map_err(|error| format!("Could not list local inbox items: {error}"))?;
            let rows = statement
                .query_map(params![limit as i64, offset as i64], |row| {
                    Ok(LocalInboxRow {
                        id: row.get(0)?,
                        app_owner: row.get(1)?,
                        app_name: row.get(2)?,
                        title: row.get(3)?,
                        body: row.get(4)?,
                        url: row.get(5)?,
                        priority: row.get(6)?,
                        created_at: row.get(7)?,
                        read_at: row.get(8)?,
                    })
                })
                .map_err(|error| format!("Could not list local inbox items: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Could not list local inbox items: {error}"))
        })
    }

    pub fn unread_count(&self) -> Result<u32, String> {
        self.store.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM local_inbox_items WHERE read_at IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map(|count| count as u32)
                .map_err(|error| format!("Could not read local inbox unread count: {error}"))
        })
    }

    pub fn mark_read(&self, id: &str) -> Result<Option<LocalInboxRow>, String> {
        let read_at = now_millis();
        self.store.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE local_inbox_items SET read_at = ?1 WHERE id = ?2 AND read_at IS NULL",
                    params![read_at, id],
                )
                .map_err(|error| format!("Could not mark local inbox item read: {error}"))?;
            connection
                .query_row(
                    "SELECT id, app_owner, app_name, title, body, url, priority, created_at, read_at
                     FROM local_inbox_items WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok(LocalInboxRow {
                            id: row.get(0)?,
                            app_owner: row.get(1)?,
                            app_name: row.get(2)?,
                            title: row.get(3)?,
                            body: row.get(4)?,
                            url: row.get(5)?,
                            priority: row.get(6)?,
                            created_at: row.get(7)?,
                            read_at: row.get(8)?,
                        })
                    },
                )
                .optional()
                .map_err(|error| format!("Could not read local inbox item: {error}"))
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        self.store.with_connection(|connection| {
            connection
                .execute(
                    "DELETE FROM local_inbox_items WHERE id = ?1",
                    params![id],
                )
                .map_err(|error| format!("Could not delete local inbox item: {error}"))?;
            Ok(())
        })
    }

    pub fn mark_all_read(&self) -> Result<u32, String> {
        let read_at = now_millis();
        self.store.with_connection(|connection| {
            let changed = connection
                .execute(
                    "UPDATE local_inbox_items SET read_at = ?1 WHERE read_at IS NULL",
                    params![read_at],
                )
                .map_err(|error| format!("Could not mark local inbox items read: {error}"))?;
            Ok(changed as u32)
        })
    }

    pub fn add_favorite(
        &self,
        stored_page_path: &str,
        app_path: &str,
        page_name: Option<&str>,
        owner_name: Option<&str>,
    ) -> Result<LocalFavoriteRow, String> {
        let created_at = now_millis();
        self.store.with_connection(|connection| {
            connection
                .execute(
                    "INSERT OR REPLACE INTO local_favorites (
                        stored_page_path, app_path, page_name, owner_name, created_at
                    ) VALUES (?, ?, ?, ?, ?)",
                    params![stored_page_path, app_path, page_name, owner_name, created_at],
                )
                .map_err(|error| format!("Could not insert local favorite: {error}"))?;
            Ok(())
        })?;
        Ok(LocalFavoriteRow {
            stored_page_path: stored_page_path.to_string(),
            app_path: app_path.to_string(),
            page_name: page_name.map(str::to_string),
            owner_name: owner_name.map(str::to_string),
            created_at,
        })
    }

    pub fn remove_favorite(&self, stored_page_path: &str) -> Result<(), String> {
        self.store.with_connection(|connection| {
            connection
                .execute(
                    "DELETE FROM local_favorites WHERE stored_page_path = ?1",
                    params![stored_page_path],
                )
                .map_err(|error| format!("Could not remove local favorite: {error}"))?;
            Ok(())
        })
    }

    pub fn list_favorites(&self) -> Result<Vec<LocalFavoriteRow>, String> {
        self.store.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT stored_page_path, app_path, page_name, owner_name, created_at
                     FROM local_favorites
                     ORDER BY created_at DESC",
                )
                .map_err(|error| format!("Could not list local favorites: {error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok(LocalFavoriteRow {
                        stored_page_path: row.get(0)?,
                        app_path: row.get(1)?,
                        page_name: row.get(2)?,
                        owner_name: row.get(3)?,
                        created_at: row.get(4)?,
                    })
                })
                .map_err(|error| format!("Could not list local favorites: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Could not list local favorites: {error}"))
        })
    }
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store::LocalStore;
    use crate::paths::DesktopPaths;

    #[test]
    fn inbox_crud_round_trip() {
        let root = tempfile::TempDir::new().unwrap();
        let store = LocalStore::open(DesktopPaths::from_root(root.path().to_path_buf())).unwrap();
        let repository = LocalPlatformRepository::new(&store);

        assert_eq!(repository.unread_count().unwrap(), 0);

        let inserted = repository
            .insert_inbox_item("alice", "reports", "任务「生成报表」已完成", Some("ok"), None, "normal")
            .unwrap();
        assert_eq!(repository.unread_count().unwrap(), 1);

        let listed = repository.list_inbox(false, 20, 0).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, inserted.id);

        let unread_only = repository.list_inbox(true, 20, 0).unwrap();
        assert_eq!(unread_only.len(), 1);

        let marked = repository.mark_read(&inserted.id).unwrap().unwrap();
        assert!(marked.read_at.is_some());
        assert_eq!(repository.unread_count().unwrap(), 0);
        assert!(repository.list_inbox(true, 20, 0).unwrap().is_empty());

        repository.delete(&inserted.id).unwrap();
        assert!(repository.list_inbox(false, 20, 0).unwrap().is_empty());
    }

    #[test]
    fn favorites_crud_round_trip() {
        let root = tempfile::TempDir::new().unwrap();
        let store = LocalStore::open(DesktopPaths::from_root(root.path().to_path_buf())).unwrap();
        let repository = LocalPlatformRepository::new(&store);

        repository
            .add_favorite("/alice/reports", "/alice/reports", Some("报表"), Some("alice"))
            .unwrap();
        let favorites = repository.list_favorites().unwrap();
        assert_eq!(favorites.len(), 1);
        assert_eq!(favorites[0].stored_page_path, "/alice/reports");

        // 重复添加为替换，不重复
        repository
            .add_favorite("/alice/reports", "/alice/reports", Some("报表2"), Some("alice"))
            .unwrap();
        assert_eq!(repository.list_favorites().unwrap().len(), 1);

        repository.remove_favorite("/alice/reports").unwrap();
        assert!(repository.list_favorites().unwrap().is_empty());
    }

    #[test]
    fn mark_all_read_updates_everything() {
        let root = tempfile::TempDir::new().unwrap();
        let store = LocalStore::open(DesktopPaths::from_root(root.path().to_path_buf())).unwrap();
        let repository = LocalPlatformRepository::new(&store);

        for index in 0..3 {
            repository
                .insert_inbox_item("alice", "app", &format!("message {index}"), None, None, "normal")
                .unwrap();
        }
        assert_eq!(repository.unread_count().unwrap(), 3);
        assert_eq!(repository.mark_all_read().unwrap(), 3);
        assert_eq!(repository.unread_count().unwrap(), 0);
        assert_eq!(repository.mark_all_read().unwrap(), 0);
    }
}
