use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

pub fn validate_database_compatibility(
    snapshot: &[u8],
    migrations_dir: &Path,
    backend_files: &[(String, Vec<u8>)],
) -> Result<Vec<String>, String> {
    validate_fresh_migration_chain(migrations_dir)?;

    let snapshot_file = NamedTempFile::new()
        .map_err(|error| format!("Failed to stage database snapshot: {error}"))?;
    fs::write(snapshot_file.path(), snapshot)
        .map_err(|error| format!("Failed to stage database snapshot: {error}"))?;
    let mut connection = Connection::open(snapshot_file.path())
        .map_err(|error| format!("Failed to open production database snapshot: {error}"))?;
    let checksums = migration_checksums(migrations_dir)?;
    validate_local_migrations_include_applied(&connection, &checksums)?;
    let applied = apply_migrations(&mut connection, migrations_dir)
        .map_err(|error| format!("Production snapshot migration validation failed: {error}"))?;
    validate_backend_schema_matches_db(&connection, backend_files)?;
    Ok(applied)
}

fn validate_fresh_migration_chain(migrations_dir: &Path) -> Result<(), String> {
    let mut connection = Connection::open_in_memory().map_err(|error| {
        format!("Failed to open in-memory SQLite for fresh migration validation: {error}")
    })?;
    apply_migrations(&mut connection, migrations_dir)
        .map(|_| ())
        .map_err(|error| format!("Fresh migration validation failed: {error}"))
}

fn apply_migrations(
    connection: &mut Connection,
    migrations_dir: &Path,
) -> Result<Vec<String>, String> {
    ensure_applied_migrations_table(connection)?;
    let migrations = read_migration_files(migrations_dir)?;
    let applied_checksums = applied_migration_checksums(connection)?;
    let mut applied_now = Vec::new();
    for migration in migrations {
        let filename = filename_for_path(&migration)?;
        let sql = fs::read_to_string(&migration).map_err(|error| {
            format!("Failed to read migration {}: {error}", migration.display())
        })?;
        let checksum = checksum_text(&sql);
        if let Some(applied_checksum) = applied_checksums.get(&filename) {
            if applied_checksum == &checksum {
                continue;
            }
            return Err(format!(
                "Migration {filename} was modified after being applied. Restore the original file or create a new migration."
            ));
        }
        connection.execute_batch(&sql).map_err(|error| {
            format!("Failed to apply migration {}: {error}", migration.display())
        })?;
        connection
            .execute(
                "INSERT OR REPLACE INTO _localapp_applied_migrations (filename, checksum, applied_at) VALUES (?1, ?2, datetime('now'))",
                params![filename, checksum],
            )
            .map_err(|error| format!("Failed to record migration {filename}: {error}"))?;
        applied_now.push(filename);
    }
    Ok(applied_now)
}

fn validate_local_migrations_include_applied(
    connection: &Connection,
    local_checksums: &BTreeMap<String, String>,
) -> Result<(), String> {
    ensure_applied_migrations_table(connection)?;
    for (filename, checksum) in applied_migration_checksums(connection)? {
        let Some(local_checksum) = local_checksums.get(&filename) else {
            return Err(format!(
                "Migration {filename} has already been applied in production but is missing locally. Restore the migration file instead of deleting it."
            ));
        };
        if local_checksum != &checksum {
            return Err(format!(
                "Migration {filename} has already been applied in production with a different checksum. Restore the original file or create a new migration."
            ));
        }
    }
    Ok(())
}

fn ensure_applied_migrations_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS _localapp_applied_migrations (
              filename TEXT PRIMARY KEY,
              checksum TEXT NOT NULL,
              applied_at TEXT NOT NULL
            );",
        )
        .map_err(|error| format!("Failed to create migrations table: {error}"))
}

fn migration_checksums(migrations_dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut checksums = BTreeMap::new();
    for path in read_migration_files(migrations_dir)? {
        let filename = filename_for_path(&path)?;
        let sql = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read migration {}: {error}", path.display()))?;
        checksums.insert(filename, checksum_text(&sql));
    }
    Ok(checksums)
}

fn read_migration_files(migrations_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !migrations_dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(migrations_dir)
        .map_err(|error| format!("Failed to read migrations directory: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read migrations directory: {error}"))?
        .into_iter()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|extension| extension.to_str()) == Some("sql"))
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn applied_migration_checksums(
    connection: &Connection,
) -> Result<BTreeMap<String, String>, String> {
    let mut statement = connection
        .prepare("SELECT filename, checksum FROM _localapp_applied_migrations")
        .map_err(|error| format!("Failed to query applied migrations: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Failed to read applied migrations: {error}"))?;
    let mut checksums = BTreeMap::new();
    for row in rows {
        let (filename, checksum) =
            row.map_err(|error| format!("Failed to read migration row: {error}"))?;
        checksums.insert(filename, checksum);
    }
    Ok(checksums)
}

fn validate_backend_schema_matches_db(
    connection: &Connection,
    backend_files: &[(String, Vec<u8>)],
) -> Result<(), String> {
    for (path, data) in backend_files {
        if !path.ends_with("schema.json") {
            continue;
        }
        let value: serde_json::Value = serde_json::from_slice(data)
            .map_err(|error| format!("Invalid backend JSON {path}: {error}"))?;
        if value.get("$schema").and_then(serde_json::Value::as_str)
            != Some("https://localapp.dev/schemas/backend/resource-schema.schema.json")
        {
            continue;
        }
        let Some(name) = value.get("name").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let columns = table_columns(connection, name)?;
        if columns.is_empty() {
            return Err(format!(
                "Backend schema {name} has no matching migration table"
            ));
        }
        let database_fields = columns.into_iter().collect::<HashSet<_>>();
        if let Some(schema_fields) = value.get("fields").and_then(serde_json::Value::as_object) {
            for field in schema_fields.keys() {
                if !database_fields.contains(field) {
                    return Err(format!(
                        "Backend schema {name}.{field} does not match migrations: column not found"
                    ));
                }
            }
        }
        validate_business_field_references(name, value.get("business"), &database_fields)?;
    }
    Ok(())
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let escaped = table.replace('"', "\"\"");
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info(\"{escaped}\")"))
        .map_err(|error| format!("Failed to inspect table {table}: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to read columns for {table}: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read column for {table}: {error}"))
}

fn validate_business_field_references(
    resource_name: &str,
    business: Option<&serde_json::Value>,
    database_fields: &HashSet<String>,
) -> Result<(), String> {
    let Some(business) = business.and_then(serde_json::Value::as_object) else {
        return Ok(());
    };
    for key in ["ownerField", "statusField"] {
        if let Some(field) = business.get(key).and_then(serde_json::Value::as_str)
            && !database_fields.contains(field)
        {
            return Err(format!(
                "Backend schema {resource_name}.business.{key} references missing migration column: {field}"
            ));
        }
    }
    for key in ["defaultFields", "enums"] {
        if let Some(fields) = business.get(key).and_then(serde_json::Value::as_object) {
            for field in fields.keys() {
                if !database_fields.contains(field) {
                    return Err(format!(
                        "Backend schema {resource_name}.business.{key}.{field} references missing migration column"
                    ));
                }
            }
        }
    }
    Ok(())
}

fn filename_for_path(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| format!("Invalid migration filename: {}", path.display()))
}

fn checksum_text(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
