use crate::actions::ClaimedAction;
use crate::local_store::LocalStore;
use rusqlite::{OptionalExtension, Row, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

const MAX_TRUST_IDENTIFIER_LENGTH: usize = 128;

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustKey {
    server_origin: String,
    app_owner: String,
    app_name: String,
    publisher_user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustKeyInput {
    server_origin: String,
    app_owner: String,
    app_name: String,
    publisher_user_id: String,
}

impl TrustKey {
    pub fn from_action(action: &ClaimedAction) -> Result<Self, String> {
        Self::new(
            &action.server_origin,
            &action.app_owner,
            &action.app_name,
            &action.publisher_user_id,
        )
    }

    pub fn from_input(input: &TrustKeyInput) -> Result<Self, String> {
        Self::new(
            &input.server_origin,
            &input.app_owner,
            &input.app_name,
            &input.publisher_user_id,
        )
    }

    fn new(
        server_origin: &str,
        app_owner: &str,
        app_name: &str,
        publisher_user_id: &str,
    ) -> Result<Self, String> {
        Ok(Self {
            server_origin: normalize_server_origin(server_origin)?,
            app_owner: validate_identifier(app_owner, "app owner")?,
            app_name: validate_identifier(app_name, "app name")?,
            publisher_user_id: validate_identifier(publisher_user_id, "publisher user ID")?,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppTrust {
    pub server_origin: String,
    pub app_owner: String,
    pub app_name: String,
    pub publisher_user_id: String,
    pub publisher_display_name: Option<String>,
    pub trusted_at: String,
    pub revoked_at: Option<String>,
}

impl AppTrust {
    pub fn key(&self) -> Result<TrustKey, String> {
        TrustKey::new(
            &self.server_origin,
            &self.app_owner,
            &self.app_name,
            &self.publisher_user_id,
        )
    }

    pub fn is_trusted(&self) -> bool {
        self.revoked_at.is_none()
    }
}

pub struct TrustRepository<'store> {
    store: &'store LocalStore,
}

impl<'store> TrustRepository<'store> {
    pub fn new(store: &'store LocalStore) -> Self {
        Self { store }
    }

    pub fn trust(&self, action: &ClaimedAction) -> Result<AppTrust, String> {
        let key = TrustKey::from_action(action)?;
        self.store.with_connection(|connection| {
            let transaction =
                Transaction::new_unchecked(connection, TransactionBehavior::Immediate).map_err(
                    |error| format!("Could not begin trusting desktop application: {error}"),
                )?;
            let trusted_at = now_timestamp();
            transaction
                .execute(
                    "INSERT INTO app_trusts (
                        server_origin, app_owner, app_name, publisher_user_id,
                        publisher_display_name, trusted_at, revoked_at
                    ) VALUES (?, ?, ?, ?, ?, ?, NULL)
                    ON CONFLICT(server_origin, app_owner, app_name, publisher_user_id)
                    DO UPDATE SET
                        publisher_display_name = excluded.publisher_display_name,
                        trusted_at = excluded.trusted_at,
                        revoked_at = NULL",
                    params![
                        key.server_origin,
                        key.app_owner,
                        key.app_name,
                        key.publisher_user_id,
                        action.publisher_display_name,
                        trusted_at,
                    ],
                )
                .map_err(|error| format!("Could not trust desktop application: {error}"))?;
            let trusted = find_trust(&transaction, &key, false)?.ok_or_else(|| {
                "Could not read the trusted desktop application after saving it".to_string()
            })?;
            transaction
                .commit()
                .map_err(|error| format!("Could not commit desktop application trust: {error}"))?;
            Ok(trusted)
        })
    }

    pub fn find_trusted(&self, action: &ClaimedAction) -> Result<Option<AppTrust>, String> {
        let key = TrustKey::from_action(action)?;
        self.store
            .with_connection(|connection| find_trust(connection, &key, true))
    }

    pub fn revoke(&self, input: &TrustKeyInput) -> Result<Option<AppTrust>, String> {
        let key = TrustKey::from_input(input)?;
        self.store.with_connection(|connection| {
            let transaction =
                Transaction::new_unchecked(connection, TransactionBehavior::Immediate).map_err(
                    |error| format!("Could not begin revoking desktop application trust: {error}"),
                )?;
            let revoked_at = now_timestamp();
            transaction
                .execute(
                    "UPDATE app_trusts SET revoked_at = ?
                     WHERE server_origin = ? AND app_owner = ? AND app_name = ?
                       AND publisher_user_id = ? AND revoked_at IS NULL",
                    params![
                        revoked_at,
                        key.server_origin,
                        key.app_owner,
                        key.app_name,
                        key.publisher_user_id,
                    ],
                )
                .map_err(|error| format!("Could not revoke desktop application trust: {error}"))?;
            let revoked = find_trust(&transaction, &key, false)?;
            transaction.commit().map_err(|error| {
                format!("Could not commit revoked desktop application trust: {error}")
            })?;
            Ok(revoked)
        })
    }

    pub fn list_trusted(&self) -> Result<Vec<AppTrust>, String> {
        self.store.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT server_origin, app_owner, app_name, publisher_user_id,
                            publisher_display_name, trusted_at, revoked_at
                     FROM app_trusts
                     WHERE revoked_at IS NULL
                     ORDER BY app_owner, app_name, publisher_user_id, server_origin",
                )
                .map_err(|error| format!("Could not list trusted desktop applications: {error}"))?;
            let rows = statement
                .query_map([], app_trust_from_row)
                .map_err(|error| format!("Could not list trusted desktop applications: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Could not list trusted desktop applications: {error}"))
        })
    }
}

fn normalize_server_origin(candidate: &str) -> Result<String, String> {
    if candidate != candidate.trim() || candidate.chars().any(char::is_control) {
        return Err("Desktop action server origin is invalid".to_string());
    }
    let (_, authority_and_suffix) = candidate
        .split_once("://")
        .ok_or_else(|| "Desktop action server origin is invalid".to_string())?;
    if authority_and_suffix
        .find(['/', '?', '#'])
        .is_some_and(|start| &authority_and_suffix[start..] != "/")
    {
        return Err("Desktop action server URL must contain only an HTTP(S) origin".to_string());
    }
    let url =
        Url::parse(candidate).map_err(|_| "Desktop action server origin is invalid".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Desktop action server URL must contain only an HTTP(S) origin".to_string());
    }
    Ok(url.origin().ascii_serialization())
}

fn validate_identifier(candidate: &str, field: &str) -> Result<String, String> {
    if candidate.is_empty()
        || candidate.len() > MAX_TRUST_IDENTIFIER_LENGTH
        || !candidate
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!("Desktop action {field} is invalid"));
    }
    Ok(candidate.to_string())
}

fn find_trust(
    connection: &rusqlite::Connection,
    key: &TrustKey,
    active_only: bool,
) -> Result<Option<AppTrust>, String> {
    let active_clause = if active_only {
        " AND revoked_at IS NULL"
    } else {
        ""
    };
    connection
        .query_row(
            &format!(
                "SELECT server_origin, app_owner, app_name, publisher_user_id,
                        publisher_display_name, trusted_at, revoked_at
                 FROM app_trusts
                 WHERE server_origin = ? AND app_owner = ? AND app_name = ?
                   AND publisher_user_id = ?{active_clause}"
            ),
            params![
                key.server_origin,
                key.app_owner,
                key.app_name,
                key.publisher_user_id,
            ],
            app_trust_from_row,
        )
        .optional()
        .map_err(|error| format!("Could not read desktop application trust: {error}"))
}

fn app_trust_from_row(row: &Row<'_>) -> rusqlite::Result<AppTrust> {
    Ok(AppTrust {
        server_origin: row.get(0)?,
        app_owner: row.get(1)?,
        app_name: row.get(2)?,
        publisher_user_id: row.get(3)?,
        publisher_display_name: row.get(4)?,
        trusted_at: row.get(5)?,
        revoked_at: row.get(6)?,
    })
}

fn now_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("unix-ms:{millis}")
}

#[cfg(test)]
mod tests {
    use super::{AppTrust, TrustKey, TrustKeyInput, TrustRepository};
    use crate::actions::{ActionStatus, ClaimedAction};
    use crate::local_store::LocalStore;
    use crate::paths::DesktopPaths;
    use rusqlite::{Transaction, TransactionBehavior};
    use std::collections::BTreeMap;
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    fn action() -> ClaimedAction {
        ClaimedAction {
            id: "action-1".to_string(),
            server_origin: "HTTPS://Example.COM:443/".to_string(),
            app_owner: "owner".to_string(),
            app_name: "reports".to_string(),
            app_version: Some("1.0.0".to_string()),
            publisher_user_id: "publisher-1".to_string(),
            publisher_display_name: Some("Publisher One".to_string()),
            title: "Generate report".to_string(),
            description: None,
            script: "console.log('report')".to_string(),
            dependencies: BTreeMap::new(),
            input: serde_json::json!({"quarter": 3}),
            timeout_seconds: 300,
            status: ActionStatus::Claimed,
        }
    }

    fn store() -> (tempfile::TempDir, LocalStore) {
        let directory = tempfile::tempdir().unwrap();
        let store =
            LocalStore::open(DesktopPaths::from_root(directory.path().to_path_buf())).unwrap();
        (directory, store)
    }

    fn stores() -> (tempfile::TempDir, LocalStore, LocalStore) {
        let directory = tempfile::tempdir().unwrap();
        let paths = DesktopPaths::from_root(directory.path().to_path_buf());
        let first = LocalStore::open(paths.clone()).unwrap();
        let second = LocalStore::open(paths).unwrap();
        (directory, first, second)
    }

    fn timestamp_millis(timestamp: &str) -> u128 {
        timestamp.strip_prefix("unix-ms:").unwrap().parse().unwrap()
    }

    fn key_input(action: &ClaimedAction) -> TrustKeyInput {
        serde_json::from_value(serde_json::json!({
            "serverOrigin": action.server_origin,
            "appOwner": action.app_owner,
            "appName": action.app_name,
            "publisherUserId": action.publisher_user_id,
        }))
        .unwrap()
    }

    #[test]
    fn trust_key_normalizes_an_exact_server_origin() {
        let key = TrustKey::from_action(&action()).unwrap();

        assert_eq!(key.server_origin, "https://example.com");
        assert_eq!(key.app_owner, "owner");
        assert_eq!(key.app_name, "reports");
        assert_eq!(key.publisher_user_id, "publisher-1");
    }

    #[test]
    fn trust_key_rejects_values_that_are_not_plain_http_origins() {
        let invalid = [
            "not a url",
            "file:///tmp/action",
            "https://user@example.com",
            "https://user:secret@example.com",
            "https://example.com/apps/reports",
            "https://example.com/.",
            "https://example.com/..",
            "https://example.com?tenant=one",
            "https://example.com#publisher",
        ];

        for server_origin in invalid {
            let mut candidate = action();
            candidate.server_origin = server_origin.to_string();
            assert!(
                TrustKey::from_action(&candidate).is_err(),
                "accepted invalid origin {server_origin}"
            );
        }
    }

    #[test]
    fn trust_key_rejects_invalid_identifiers() {
        let invalid = [
            "".to_string(),
            "has space".to_string(),
            "has\tcontrol".to_string(),
            "path/segment".to_string(),
            "path\\segment".to_string(),
            "not.allowed".to_string(),
            "unicode-应用".to_string(),
            "a".repeat(129),
        ];

        for value in invalid {
            for field in ["owner", "app", "publisher"] {
                let mut candidate = action();
                match field {
                    "owner" => candidate.app_owner = value.clone(),
                    "app" => candidate.app_name = value.clone(),
                    "publisher" => candidate.publisher_user_id = value.clone(),
                    _ => unreachable!(),
                }
                assert!(
                    TrustKey::from_action(&candidate).is_err(),
                    "accepted invalid {field} identifier {value:?}"
                );
            }
        }
    }

    #[test]
    fn trust_entrypoints_reject_invalid_identifiers() {
        let (_directory, store) = store();
        let repository = TrustRepository::new(&store);
        let mut invalid = action();
        invalid.app_name = "../reports".to_string();

        assert!(repository.trust(&invalid).is_err());
        assert!(repository.find_trusted(&invalid).is_err());
        assert!(repository.list_trusted().unwrap().is_empty());
    }

    #[test]
    fn trust_round_trips_as_a_serializable_active_record() {
        let (_directory, store) = store();
        let repository = TrustRepository::new(&store);

        let trusted = repository.trust(&action()).unwrap();
        let found = repository.find_trusted(&action()).unwrap().unwrap();

        assert_eq!(found, trusted);
        assert!(!found.trusted_at.is_empty());
        assert_eq!(found.revoked_at, None);
        assert!(found.is_trusted());
        let json = serde_json::to_value(&found).unwrap();
        assert_eq!(json["serverOrigin"], "https://example.com");
        assert_eq!(json["publisherDisplayName"], "Publisher One");
    }

    #[test]
    fn changed_server_app_or_publisher_never_matches() {
        let (_directory, store) = store();
        let repository = TrustRepository::new(&store);
        let original = action();
        repository.trust(&original).unwrap();

        let mut changed_server = action();
        changed_server.server_origin = "https://other.example.com".to_string();
        let mut changed_owner = action();
        changed_owner.app_owner = "other-owner".to_string();
        let mut changed_name = action();
        changed_name.app_name = "other-app".to_string();
        let mut changed_publisher = action();
        changed_publisher.publisher_user_id = "publisher-2".to_string();

        for changed in [
            changed_server,
            changed_owner,
            changed_name,
            changed_publisher,
        ] {
            assert_eq!(repository.find_trusted(&changed).unwrap(), None);
        }
    }

    #[test]
    fn revoke_records_a_timestamp_and_only_affects_future_lookup() {
        let (_directory, store) = store();
        let repository = TrustRepository::new(&store);
        let active_snapshot = repository.trust(&action()).unwrap();

        let revoked = repository.revoke(&key_input(&action())).unwrap().unwrap();

        assert!(active_snapshot.is_trusted());
        assert!(!revoked.is_trusted());
        assert!(
            revoked
                .revoked_at
                .as_ref()
                .is_some_and(|value| !value.is_empty())
        );
        assert_eq!(repository.find_trusted(&action()).unwrap(), None);
        assert!(repository.list_trusted().unwrap().is_empty());
    }

    #[test]
    fn revoke_canonicalizes_the_complete_input_key() {
        let (_directory, store) = store();
        let repository = TrustRepository::new(&store);
        repository.trust(&action()).unwrap();
        let input: TrustKeyInput = serde_json::from_value(serde_json::json!({
            "serverOrigin": "HTTPS://Example.COM:443/",
            "appOwner": "owner",
            "appName": "reports",
            "publisherUserId": "publisher-1",
        }))
        .unwrap();

        let revoked = repository.revoke(&input).unwrap().unwrap();

        assert!(!revoked.is_trusted());
        assert_eq!(revoked.server_origin, "https://example.com");
    }

    #[test]
    fn revoke_rejects_invalid_identifiers() {
        let (_directory, store) = store();
        let repository = TrustRepository::new(&store);
        let input: TrustKeyInput = serde_json::from_value(serde_json::json!({
            "serverOrigin": "https://example.com",
            "appOwner": "owner",
            "appName": "reports/quarterly",
            "publisherUserId": "publisher-1",
        }))
        .unwrap();

        assert!(repository.revoke(&input).is_err());
    }

    #[test]
    fn list_trusted_apps_excludes_revoked_rows() {
        let (_directory, store) = store();
        let repository = TrustRepository::new(&store);
        let first = action();
        let mut second = action();
        second.app_name = "billing".to_string();
        second.publisher_display_name = Some("Publisher Two".to_string());
        repository.trust(&first).unwrap();
        repository.trust(&second).unwrap();
        repository.revoke(&key_input(&first)).unwrap();

        let trusted = repository.list_trusted().unwrap();

        assert_eq!(trusted.len(), 1);
        assert_eq!(trusted[0].app_name, "billing");
    }

    #[test]
    fn retrust_updates_publisher_details_and_clears_revocation() {
        let (_directory, store) = store();
        let repository = TrustRepository::new(&store);
        let original = action();
        repository.trust(&original).unwrap();
        repository.revoke(&key_input(&original)).unwrap();

        let mut retrusted_action = action();
        retrusted_action.publisher_display_name = Some("Renamed Publisher".to_string());
        let retrusted = repository.trust(&retrusted_action).unwrap();

        assert!(retrusted.is_trusted());
        assert_eq!(retrusted.revoked_at, None);
        assert_eq!(
            retrusted.publisher_display_name.as_deref(),
            Some("Renamed Publisher")
        );
        assert_eq!(repository.list_trusted().unwrap(), vec![retrusted]);
    }

    #[test]
    fn concurrent_trust_timestamps_its_result_inside_the_write_lock() {
        let (_directory, first_store, second_store) = stores();
        let first_repository = TrustRepository::new(&first_store);
        let barrier = Arc::new(Barrier::new(2));

        let (trusted, lock_released_at) = second_store
            .with_connection(|connection| {
                let transaction =
                    Transaction::new_unchecked(connection, TransactionBehavior::Immediate).unwrap();
                std::thread::scope(|scope| {
                    let worker_barrier = Arc::clone(&barrier);
                    let first_repository = &first_repository;
                    let worker = scope.spawn(move || {
                        worker_barrier.wait();
                        first_repository.trust(&action()).unwrap()
                    });
                    barrier.wait();
                    std::thread::sleep(Duration::from_millis(50));
                    let lock_released_at = timestamp_millis(&super::now_timestamp());
                    transaction.commit().unwrap();
                    Ok((worker.join().unwrap(), lock_released_at))
                })
            })
            .unwrap();

        assert!(timestamp_millis(&trusted.trusted_at) >= lock_released_at);
        assert!(trusted.is_trusted());
        assert_eq!(trusted.server_origin, "https://example.com");
    }

    #[test]
    fn concurrent_revoke_timestamps_its_result_inside_the_write_lock() {
        let (_directory, first_store, second_store) = stores();
        let first_repository = TrustRepository::new(&first_store);
        let second_repository = TrustRepository::new(&second_store);
        first_repository.trust(&action()).unwrap();
        let key = key_input(&action());
        let barrier = Arc::new(Barrier::new(2));

        let (revoked, lock_released_at) = first_store
            .with_connection(|connection| {
                let transaction =
                    Transaction::new_unchecked(connection, TransactionBehavior::Immediate).unwrap();
                std::thread::scope(|scope| {
                    let worker_barrier = Arc::clone(&barrier);
                    let second_repository = &second_repository;
                    let key = &key;
                    let worker = scope.spawn(move || {
                        worker_barrier.wait();
                        second_repository.revoke(key).unwrap().unwrap()
                    });
                    barrier.wait();
                    std::thread::sleep(Duration::from_millis(50));
                    let lock_released_at = timestamp_millis(&super::now_timestamp());
                    transaction.commit().unwrap();
                    Ok((worker.join().unwrap(), lock_released_at))
                })
            })
            .unwrap();

        assert!(timestamp_millis(revoked.revoked_at.as_deref().unwrap()) >= lock_released_at);
        assert!(!revoked.is_trusted());
        assert_eq!(revoked.server_origin, "https://example.com");
    }

    fn _assert_public_dto(_: AppTrust) {}
}
