use crate::paths::DesktopPaths;
use rusqlite::{Connection, params};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;

pub const LOCAL_SCHEMA_VERSION: u32 = 3;

const MIGRATIONS: &[(u32, &str)] = &[
    (1, include_str!("migrations/001_local_state.sql")),
    (2, include_str!("migrations/002_js_environments.sql")),
    (3, include_str!("migrations/003_task_server_sync.sql")),
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopSettingsRow {
    pub installation_id: String,
    pub launch_at_login: bool,
    pub notifications_enabled: bool,
    pub npm_registry: Option<String>,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct ScriptEnvironmentUpdate {
    pub npm_registry: Option<String>,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub clear_http_proxy: bool,
    pub clear_https_proxy: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEnvironmentSettings {
    pub npm_registry: Option<String>,
    pub http_proxy_configured: bool,
    pub https_proxy_configured: bool,
}

pub struct LocalStore {
    paths: DesktopPaths,
    connection: Mutex<Connection>,
}

impl LocalStore {
    pub fn open(paths: DesktopPaths) -> Result<Self, String> {
        paths.ensure()?;
        let mut connection = Connection::open(paths.database())
            .map_err(|error| format!("Could not open desktop database: {error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("Could not configure desktop database: {error}"))?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| format!("Could not configure desktop database: {error}"))?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| format!("Could not configure desktop database: {error}"))?;
        migrate(&mut connection)?;
        initialize_settings(&connection)?;
        Ok(Self {
            paths,
            connection: Mutex::new(connection),
        })
    }

    pub fn discover() -> Result<Self, String> {
        Self::open(DesktopPaths::discover()?)
    }

    pub fn paths(&self) -> &DesktopPaths {
        &self.paths
    }

    pub fn schema_version(&self) -> Result<u32, String> {
        self.with_connection(|connection| {
            connection
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .map_err(|error| format!("Could not read desktop schema version: {error}"))
        })
    }

    pub fn desktop_settings(&self) -> Result<DesktopSettingsRow, String> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT installation_id, launch_at_login, notifications_enabled, npm_registry, http_proxy, https_proxy FROM desktop_settings WHERE id = 1",
                    [],
                    |row| {
                        Ok(DesktopSettingsRow {
                            installation_id: row.get(0)?,
                            launch_at_login: row.get::<_, i64>(1)? != 0,
                            notifications_enabled: row.get::<_, i64>(2)? != 0,
                            npm_registry: row.get(3)?,
                            http_proxy: row.get(4)?,
                            https_proxy: row.get(5)?,
                        })
                    },
                )
                .map_err(|error| format!("Could not read desktop settings: {error}"))
        })
    }

    pub fn script_environment_settings(&self) -> Result<ScriptEnvironmentSettings, String> {
        let settings = self.desktop_settings()?;
        Ok(ScriptEnvironmentSettings {
            npm_registry: settings.npm_registry,
            http_proxy_configured: settings.http_proxy.is_some(),
            https_proxy_configured: settings.https_proxy.is_some(),
        })
    }

    pub fn update_script_environment(
        &self,
        update: ScriptEnvironmentUpdate,
    ) -> Result<ScriptEnvironmentSettings, String> {
        let npm_registry = update
            .npm_registry
            .as_deref()
            .map(validate_registry_url)
            .transpose()?;
        let http_proxy = update
            .http_proxy
            .as_deref()
            .map(validate_proxy_url)
            .transpose()?;
        let https_proxy = update
            .https_proxy
            .as_deref()
            .map(validate_proxy_url)
            .transpose()?;
        self.with_connection(|connection| {
            connection
                .execute(
                    "UPDATE desktop_settings SET
                        npm_registry = COALESCE(?1, npm_registry),
                        http_proxy = CASE WHEN ?2 THEN NULL WHEN ?3 IS NOT NULL THEN ?3 ELSE http_proxy END,
                        https_proxy = CASE WHEN ?4 THEN NULL WHEN ?5 IS NOT NULL THEN ?5 ELSE https_proxy END,
                        updated_at = ?6
                     WHERE id = 1",
                    params![
                        npm_registry,
                        update.clear_http_proxy,
                        http_proxy,
                        update.clear_https_proxy,
                        https_proxy,
                        now_iso(),
                    ],
                )
                .map_err(|error| format!("Could not update script environment settings: {error}"))?;
            Ok(())
        })?;
        self.script_environment_settings()
    }

    pub(crate) fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Desktop database is unavailable".to_string())?;
        operation(&connection)
    }
}

fn migrate(connection: &mut Connection) -> Result<(), String> {
    let current: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("Could not read desktop schema version: {error}"))?;
    if current > LOCAL_SCHEMA_VERSION {
        return Err(format!(
            "Desktop database schema {current} is newer than supported"
        ));
    }
    for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version > current) {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Could not migrate desktop database: {error}"))?;
        transaction
            .execute_batch(sql)
            .map_err(|error| format!("Could not migrate desktop database: {error}"))?;
        transaction
            .pragma_update(None, "user_version", version)
            .map_err(|error| format!("Could not migrate desktop database: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not migrate desktop database: {error}"))?;
    }
    Ok(())
}

fn initialize_settings(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO desktop_settings (id, updated_at) VALUES (1, ?)",
            params![now_iso()],
        )
        .map_err(|error| format!("Could not initialize desktop settings: {error}"))?;
    Ok(())
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("unix-ms:{millis}")
}

fn validate_registry_url(candidate: &str) -> Result<String, String> {
    validate_http_url(candidate, false, "npm registry")
}

fn validate_proxy_url(candidate: &str) -> Result<String, String> {
    validate_http_url(candidate, true, "proxy")
}

fn validate_http_url(
    candidate: &str,
    allow_credentials: bool,
    label: &str,
) -> Result<String, String> {
    if candidate.is_empty()
        || candidate.len() > 2048
        || candidate != candidate.trim()
        || candidate.chars().any(char::is_control)
    {
        return Err(format!("Desktop {label} URL is invalid"));
    }
    let url = url::Url::parse(candidate).map_err(|_| format!("Desktop {label} URL is invalid"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || (!allow_credentials && (!url.username().is_empty() || url.password().is_some()))
        || url.query().is_some()
        || url.fragment().is_some()
        || (allow_credentials && url.path() != "/")
    {
        return Err(format!("Desktop {label} URL is invalid"));
    }
    Ok(url.to_string())
}
