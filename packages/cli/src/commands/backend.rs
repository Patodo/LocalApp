use crate::commands::backend_security::generated_security;
use crate::commands::db::{ColumnInfo, apply_migrations, table_columns, user_tables};
use rusqlite::Connection;
use serde_json::{Map, Value, json};
use std::fs;
use std::path::{Path, PathBuf};

const RESOURCE_SCHEMA_URL: &str =
    "https://localapp.dev/schemas/backend/resource-schema.schema.json";
const QUERIES_SCHEMA_URL: &str = "https://localapp.dev/schemas/backend/queries.schema.json";
const MUTATIONS_SCHEMA_URL: &str = "https://localapp.dev/schemas/backend/mutations.schema.json";

/// 后端契约脚手架选项。
pub struct ScaffoldOptions {
    /// 仅 scaffold 指定表；None 表示处理所有用户表。
    pub table: Option<String>,
    /// 已存在声明时是否覆盖；默认跳过。
    pub force: bool,
    /// backend 根目录；默认 `backend/`。
    pub backend_root: PathBuf,
    /// public/authenticated/owner/member/parent-owner。
    pub security_profile: String,
    /// owner/member 身份字段。
    pub identity_field: Option<String>,
    /// parent-owner 的父资源表。
    pub parent_resource: Option<String>,
    /// parent-owner 的子表外键。
    pub foreign_key: Option<String>,
    /// parent-owner 的父表 owner 字段。
    pub parent_identity_field: Option<String>,
    /// name:status_field:from:to，可重复。
    pub transitions: Vec<String>,
}

impl Default for ScaffoldOptions {
    fn default() -> Self {
        Self {
            table: None,
            force: false,
            backend_root: PathBuf::from("backend"),
            security_profile: "authenticated".to_string(),
            identity_field: None,
            parent_resource: None,
            foreign_key: None,
            parent_identity_field: None,
            transitions: Vec::new(),
        }
    }
}

/// 运行 `localapp backend scaffold`。
///
/// 流程：
/// 1. 在内存 SQLite 上应用 migrations，得到完整 schema
/// 2. 枚举用户表（跳过 `_localapp_*`、users、groups、roles）
/// 3. 对每张表生成 schema.json + queries.json + mutations.json
/// 4. 已存在声明时默认跳过，--force 才覆盖
pub fn scaffold(opts: ScaffoldOptions) -> Result<ScaffoldSummary, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    scaffold_at(&cwd, opts)
}

fn scaffold_at(project_dir: &Path, opts: ScaffoldOptions) -> Result<ScaffoldSummary, String> {
    let migrations_dir = project_dir.join("migrations");
    if !migrations_dir.exists() {
        return Err(format!(
            "Migrations directory not found at {}. Create migrations first.",
            migrations_dir.display()
        ));
    }

    let mut conn = Connection::open_in_memory()
        .map_err(|e| format!("Failed to open in-memory SQLite: {e}"))?;
    apply_migrations(&mut conn, &migrations_dir)?;

    let mut tables = user_tables(&conn)?;
    tables.sort();
    if let Some(target) = &opts.table {
        if !tables.iter().any(|t| t == target) {
            return Err(format!(
                "Table '{target}' not found in schema. Available tables: {}",
                tables.join(", ")
            ));
        }
        tables = vec![target.clone()];
    }

    let backend_root = if opts.backend_root.is_absolute() {
        opts.backend_root.clone()
    } else {
        project_dir.join(&opts.backend_root)
    };
    let resources_dir = backend_root.join("resources");
    let security = secure_config_from_options(&opts)?;

    let mut summary = ScaffoldSummary::default();
    for table in &tables {
        let columns = table_columns(&conn, table)?;
        let target_dir = resources_dir.join(table);
        let already_exists = target_dir.join("queries.json").exists()
            || target_dir.join("mutations.json").exists()
            || target_dir.join("schema.json").exists();

        if already_exists && !opts.force {
            summary.skipped.push(table.clone());
            continue;
        }

        fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create {}: {e}", target_dir.display()))?;

        let schema_json = build_schema_json(table, &columns);
        let queries_json = build_secure_queries_json(table, &security)?;
        let mutations_json = build_secure_mutations_json(table, &columns, &security)?;

        write_json(&target_dir.join("schema.json"), &schema_json)?;
        write_json(&target_dir.join("queries.json"), &queries_json)?;
        write_json(&target_dir.join("mutations.json"), &mutations_json)?;

        summary.generated.push(table.clone());
    }

    Ok(summary)
}

#[derive(Default)]
pub struct ScaffoldSummary {
    pub generated: Vec<String>,
    pub skipped: Vec<String>,
}

/// 选出用户可在 create/update 中设置的字段：
/// - 排除 `id`（auto-increment PK）
/// - 排除 `created_at` / `updated_at`（由 SQL DEFAULT 控制）
fn user_settable_columns(columns: &[ColumnInfo]) -> Vec<&ColumnInfo> {
    columns
        .iter()
        .filter(|c| c.name != "id" && c.name != "created_at" && c.name != "updated_at")
        .collect()
}

/// SQLite 类型 → named SQL param 类型字符串。
fn param_type_for(sqlite_type: &str) -> &'static str {
    let upper = sqlite_type.to_uppercase();
    if upper.contains("INT") {
        "number"
    } else if upper.contains("REAL")
        || upper.contains("NUM")
        || upper.contains("DOUB")
        || upper.contains("FLOA")
    {
        "number"
    } else {
        "string"
    }
}

fn build_schema_json(table: &str, columns: &[ColumnInfo]) -> Value {
    let fields = columns
        .iter()
        .map(|column| {
            (
                column.name.clone(),
                json!({ "type": param_type_for(&column.sqlite_type) }),
            )
        })
        .collect::<Map<_, _>>();
    json!({
        "$schema": RESOURCE_SCHEMA_URL,
        "name": table,
        "fields": fields
    })
}

#[derive(Debug, Clone)]
enum SecureScaffoldProfile {
    Public,
    Authenticated,
    Owner {
        identity_field: String,
    },
    Member {
        identity_field: String,
    },
    ParentOwner {
        parent_resource: String,
        foreign_key: String,
        parent_identity_field: String,
    },
}

#[derive(Debug, Clone)]
struct ScaffoldTransition {
    name: String,
    status_field: String,
    from: String,
    to: String,
}

#[derive(Debug, Clone)]
struct SecureScaffoldConfig {
    profile: SecureScaffoldProfile,
    transitions: Vec<ScaffoldTransition>,
}

impl SecureScaffoldConfig {
    fn public() -> Self {
        Self {
            profile: SecureScaffoldProfile::Public,
            transitions: Vec::new(),
        }
    }

    fn authenticated() -> Self {
        Self {
            profile: SecureScaffoldProfile::Authenticated,
            transitions: Vec::new(),
        }
    }

    fn owner(identity_field: &str) -> Self {
        Self {
            profile: SecureScaffoldProfile::Owner {
                identity_field: identity_field.to_string(),
            },
            transitions: Vec::new(),
        }
    }

    fn member(identity_field: &str) -> Self {
        Self {
            profile: SecureScaffoldProfile::Member {
                identity_field: identity_field.to_string(),
            },
            transitions: Vec::new(),
        }
    }

    fn parent_owner(parent_resource: &str, foreign_key: &str, parent_identity_field: &str) -> Self {
        Self {
            profile: SecureScaffoldProfile::ParentOwner {
                parent_resource: parent_resource.to_string(),
                foreign_key: foreign_key.to_string(),
                parent_identity_field: parent_identity_field.to_string(),
            },
            transitions: Vec::new(),
        }
    }
}

fn secure_config_from_options(opts: &ScaffoldOptions) -> Result<SecureScaffoldConfig, String> {
    let mut config = match opts.security_profile.as_str() {
        "public" => SecureScaffoldConfig::public(),
        "authenticated" => SecureScaffoldConfig::authenticated(),
        "owner" => {
            SecureScaffoldConfig::owner(opts.identity_field.as_deref().unwrap_or("created_by"))
        }
        "member" => {
            SecureScaffoldConfig::member(opts.identity_field.as_deref().unwrap_or("assignee_id"))
        }
        "parent-owner" => SecureScaffoldConfig::parent_owner(
            opts.parent_resource
                .as_deref()
                .ok_or("--parent-resource is required for parent-owner")?,
            opts.foreign_key
                .as_deref()
                .ok_or("--foreign-key is required for parent-owner")?,
            opts.parent_identity_field
                .as_deref()
                .unwrap_or("created_by"),
        ),
        other => {
            return Err(format!(
                "Unknown security profile '{other}'. Use public, authenticated, owner, member, or parent-owner."
            ));
        }
    };
    for encoded in &opts.transitions {
        let parts = encoded.split(':').collect::<Vec<_>>();
        if parts.len() != 4 {
            return Err(format!(
                "Invalid transition '{encoded}'. Expected name:status_field:from:to"
            ));
        }
        config.transitions.push(ScaffoldTransition {
            name: parts[0].to_string(),
            status_field: parts[1].to_string(),
            from: parts[2].to_string(),
            to: parts[3].to_string(),
        });
    }
    Ok(config)
}

#[cfg(test)]
fn build_queries_json(table: &str) -> Value {
    build_secure_queries_json(table, &SecureScaffoldConfig::authenticated())
        .expect("default authenticated scaffold must be valid")
}

#[cfg(test)]
fn build_mutations_json(table: &str, columns: &[ColumnInfo]) -> Value {
    build_secure_mutations_json(table, columns, &SecureScaffoldConfig::authenticated())
        .expect("default authenticated scaffold must be valid")
}

fn build_secure_queries_json(table: &str, config: &SecureScaffoldConfig) -> Result<Value, String> {
    validate_identifier(table, "resource")?;
    let (list_filter, single_filter, template, security_config, access) = match &config.profile {
        SecureScaffoldProfile::Public => (
            String::new(),
            "id = :id".to_string(),
            "public-v1",
            json!({}),
            "public",
        ),
        SecureScaffoldProfile::Authenticated => (
            String::new(),
            "id = :id".to_string(),
            "authenticated-v1",
            json!({}),
            "authenticated",
        ),
        SecureScaffoldProfile::Owner { identity_field } => {
            validate_identifier(identity_field, "identityField")?;
            (
                format!("WHERE {identity_field} = :currentUserId"),
                format!("id = :id AND {identity_field} = :currentUserId"),
                "owner-read-v1",
                json!({ "identityField": identity_field }),
                "authenticated",
            )
        }
        SecureScaffoldProfile::Member { identity_field } => {
            validate_identifier(identity_field, "identityField")?;
            (
                format!("WHERE {identity_field} = :currentUserId"),
                format!("id = :id AND {identity_field} = :currentUserId"),
                "member-read-v1",
                json!({ "identityField": identity_field }),
                "authenticated",
            )
        }
        SecureScaffoldProfile::ParentOwner {
            parent_resource,
            foreign_key,
            parent_identity_field,
        } => {
            validate_identifier(parent_resource, "parentResource")?;
            validate_identifier(foreign_key, "foreignKey")?;
            validate_identifier(parent_identity_field, "parentIdentityField")?;
            let exists = format!(
                "EXISTS (SELECT 1 FROM {parent_resource} WHERE {parent_resource}.id = {table}.{foreign_key} AND {parent_resource}.{parent_identity_field} = :currentUserId)"
            );
            (
                format!("WHERE {exists}"),
                format!("id = :id AND {exists}"),
                "parent-owner-v1",
                json!({
                    "parentResource": parent_resource,
                    "foreignKey": foreign_key,
                    "parentIdentityField": parent_identity_field,
                }),
                "authenticated",
            )
        }
    };
    let list_name = format!("${table}.list");
    let get_name = format!("${table}.get");
    let count_name = format!("${table}.count");
    let list_sql =
        format!("SELECT * FROM {table} {list_filter} ORDER BY id DESC LIMIT :limit OFFSET :offset");
    let get_sql = format!("SELECT * FROM {table} WHERE {single_filter}");
    let count_sql = if list_filter.is_empty() {
        format!("SELECT COUNT(*) AS count FROM {table}")
    } else {
        format!("SELECT COUNT(*) AS count FROM {table} {list_filter}")
    };
    Ok(json!({
        "$schema": QUERIES_SCHEMA_URL,
        "queries": {
            list_name.clone(): {
                "kind": "query",
                "sql": list_sql,
                "params": {
                    "limit": { "type": "number", "required": true },
                    "offset": { "type": "number", "required": true }
                },
                "result": { "mode": "page", "maxRows": 100, "maxBytes": 65536 },
                "access": access,
                "security": generated_security(&list_name, "query", &list_sql, template, table, security_config.clone())
            },
            get_name.clone(): {
                "kind": "query",
                "sql": get_sql,
                "params": { "id": { "type": "number", "required": true } },
                "result": { "mode": "single", "maxRows": 1, "maxBytes": 8192 },
                "access": access,
                "security": generated_security(&get_name, "query", &get_sql, template, table, security_config.clone())
            },
            count_name.clone(): {
                "kind": "query",
                "sql": count_sql,
                "params": {},
                "result": { "mode": "aggregate", "maxRows": 1, "maxBytes": 4096 },
                "access": access,
                "security": generated_security(&count_name, "query", &count_sql, template, table, security_config)
            }
        }
    }))
}

fn build_secure_mutations_json(
    table: &str,
    columns: &[ColumnInfo],
    config: &SecureScaffoldConfig,
) -> Result<Value, String> {
    validate_identifier(table, "resource")?;
    let identity_field = match &config.profile {
        SecureScaffoldProfile::Owner { identity_field }
        | SecureScaffoldProfile::Member { identity_field } => Some(identity_field.as_str()),
        _ => None,
    };
    if let Some(identity_field) = identity_field {
        validate_identifier(identity_field, "identityField")?;
        require_column(columns, identity_field)?;
    }
    let settable = user_settable_columns(columns)
        .into_iter()
        .filter(|column| Some(column.name.as_str()) != identity_field)
        .collect::<Vec<_>>();

    // create params + INSERT
    let mut create_params = Map::new();
    let mut create_cols: Vec<String> = Vec::new();
    let mut create_placeholders: Vec<String> = Vec::new();
    for col in &settable {
        create_params.insert(
            col.name.clone(),
            json!({ "type": param_type_for(&col.sqlite_type) }),
        );
        create_cols.push(col.name.clone());
        create_placeholders.push(format!(":{}", col.name));
    }
    if let Some(identity_field) = identity_field {
        create_cols.push(identity_field.to_string());
        create_placeholders.push(":currentUserId".to_string());
    }
    let mut create_sql = if create_cols.is_empty() {
        format!("INSERT INTO {table} DEFAULT VALUES")
    } else {
        format!(
            "INSERT INTO {table} ({}) VALUES ({})",
            create_cols.join(", "),
            create_placeholders.join(", ")
        )
    };

    // update params (id required + settable) + patch-style UPDATE.
    // Optional omitted params are bound as NULL by the named SQL runtime, so
    // COALESCE keeps the current column value unless the caller provides a
    // replacement. Nullable fields also get a <field>__set_null switch for
    // explicit clearing.
    let mut update_params = Map::new();
    update_params.insert(
        "id".to_string(),
        json!({ "type": "number", "required": true }),
    );
    let mut update_set_clauses: Vec<String> = Vec::new();
    for col in &settable {
        update_params.insert(
            col.name.clone(),
            if col.not_null || col.primary_key {
                json!({ "type": param_type_for(&col.sqlite_type) })
            } else {
                json!({ "type": param_type_for(&col.sqlite_type), "nullable": true })
            },
        );
        if col.not_null || col.primary_key {
            update_set_clauses.push(format!(
                "{} = COALESCE(:{}, {})",
                col.name, col.name, col.name
            ));
        } else {
            let set_null_param = format!("{}__set_null", col.name);
            update_params.insert(set_null_param.clone(), json!({ "type": "boolean" }));
            update_set_clauses.push(format!(
                "{} = CASE WHEN :{} THEN NULL ELSE COALESCE(:{}, {}) END",
                col.name, set_null_param, col.name, col.name
            ));
        }
    }
    let mut update_sql = if update_set_clauses.is_empty() {
        format!("UPDATE {table} SET id = id WHERE id = :id")
    } else {
        format!(
            "UPDATE {table} SET {} WHERE id = :id",
            update_set_clauses.join(", ")
        )
    };

    let mut delete_sql = format!("DELETE FROM {table} WHERE id = :id");
    let (create_template, update_template, delete_template, security_config, access) = match &config
        .profile
    {
        SecureScaffoldProfile::Public => {
            ("public-v1", "public-v1", "public-v1", json!({}), "public")
        }
        SecureScaffoldProfile::Authenticated => (
            "authenticated-v1",
            "authenticated-v1",
            "authenticated-v1",
            json!({}),
            "authenticated",
        ),
        SecureScaffoldProfile::Owner { identity_field } => {
            update_sql.push_str(&format!(" AND {identity_field} = :currentUserId"));
            delete_sql.push_str(&format!(" AND {identity_field} = :currentUserId"));
            (
                "owner-create-v1",
                "owner-update-v1",
                "owner-delete-v1",
                json!({ "identityField": identity_field }),
                "authenticated",
            )
        }
        SecureScaffoldProfile::Member { identity_field } => {
            update_sql.push_str(&format!(" AND {identity_field} = :currentUserId"));
            delete_sql.push_str(&format!(" AND {identity_field} = :currentUserId"));
            (
                "member-create-v1",
                "member-update-v1",
                "member-delete-v1",
                json!({ "identityField": identity_field }),
                "authenticated",
            )
        }
        SecureScaffoldProfile::ParentOwner {
            parent_resource,
            foreign_key,
            parent_identity_field,
        } => {
            require_column(columns, foreign_key)?;
            let exists = format!(
                "EXISTS (SELECT 1 FROM {parent_resource} WHERE {parent_resource}.id = {table}.{foreign_key} AND {parent_resource}.{parent_identity_field} = :currentUserId)"
            );
            if create_cols.is_empty() {
                return Err(
                    "parent-owner scaffold requires at least one insertable column".to_string(),
                );
            }
            create_sql = format!(
                "INSERT INTO {table} ({}) SELECT {} WHERE EXISTS (SELECT 1 FROM {parent_resource} WHERE {parent_resource}.id = :{foreign_key} AND {parent_resource}.{parent_identity_field} = :currentUserId)",
                create_cols.join(", "),
                create_placeholders.join(", ")
            );
            update_sql.push_str(&format!(" AND {exists}"));
            delete_sql.push_str(&format!(" AND {exists}"));
            (
                "parent-owner-v1",
                "parent-owner-v1",
                "parent-owner-v1",
                json!({
                    "parentResource": parent_resource,
                    "foreignKey": foreign_key,
                    "parentIdentityField": parent_identity_field,
                }),
                "authenticated",
            )
        }
    };
    let create_name = format!("${table}.create");
    let update_name = format!("${table}.update");
    let delete_name = format!("${table}.delete");
    let mut mutations = Map::new();
    mutations.insert(create_name.clone(), json!({
        "kind": "mutation",
        "sql": create_sql,
        "params": create_params,
        "access": access,
        "security": generated_security(&create_name, "mutation", &create_sql, create_template, table, security_config.clone())
    }));
    mutations.insert(update_name.clone(), json!({
        "kind": "mutation",
        "sql": update_sql,
        "params": update_params,
        "access": access,
        "security": generated_security(&update_name, "mutation", &update_sql, update_template, table, security_config.clone())
    }));
    mutations.insert(delete_name.clone(), json!({
        "kind": "mutation",
        "sql": delete_sql,
        "params": { "id": { "type": "number", "required": true } },
        "access": access,
        "security": generated_security(&delete_name, "mutation", &delete_sql, delete_template, table, security_config)
    }));

    if !config.transitions.is_empty()
        && !matches!(config.profile, SecureScaffoldProfile::Authenticated)
    {
        return Err(
            "transition scaffold currently requires the authenticated security profile".to_string(),
        );
    }
    for transition in &config.transitions {
        validate_identifier(&transition.name, "transition name")?;
        validate_identifier(&transition.status_field, "statusField")?;
        require_column(columns, &transition.status_field)?;
        validate_literal(&transition.from, "transition from")?;
        validate_literal(&transition.to, "transition to")?;
        let name = format!("${table}.{}", transition.name);
        let sql = format!(
            "UPDATE {table} SET {} = '{}' WHERE id = :id AND {} = '{}'",
            transition.status_field, transition.to, transition.status_field, transition.from
        );
        mutations.insert(
            name.clone(),
            json!({
                "kind": "mutation",
                "sql": sql,
                "params": { "id": { "type": "number", "required": true } },
                "access": "authenticated",
                "security": generated_security(
                    &name,
                    "mutation",
                    &sql,
                    "transition-v1",
                    table,
                    json!({
                        "statusField": transition.status_field,
                        "from": transition.from,
                        "to": transition.to,
                    }),
                )
            }),
        );
    }

    Ok(json!({
        "$schema": MUTATIONS_SCHEMA_URL,
        "mutations": mutations
    }))
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    let mut chars = value.chars();
    if chars
        .next()
        .is_none_or(|first| first != '_' && !first.is_ascii_alphabetic())
        || !chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
    {
        return Err(format!("{label} must be a SQL identifier"));
    }
    Ok(())
}

fn validate_literal(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err(format!(
            "{label} must contain only letters, numbers, '_' or '-'"
        ));
    }
    Ok(())
}

fn require_column(columns: &[ColumnInfo], name: &str) -> Result<(), String> {
    if columns.iter().any(|column| column.name == name) {
        Ok(())
    } else {
        Err(format!(
            "Security scaffold field '{name}' does not exist in the table"
        ))
    }
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let formatted = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize {}: {e}", path.display()))?;
    let with_newline = format!("{formatted}\n");
    fs::write(path, with_newline)
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::backend_security::validate_backend_security_files;
    use rusqlite::Connection;

    fn create_test_schema(conn: &mut Connection) {
        conn.execute_batch(
            "CREATE TABLE tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                priority REAL DEFAULT 0,
                done INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .unwrap();
    }

    #[test]
    fn build_queries_json_has_standard_three_queries() {
        let queries = build_queries_json("tasks");
        let q = queries.get("queries").unwrap();
        assert!(q.get("$tasks.list").is_some());
        assert!(q.get("$tasks.get").is_some());
        assert!(q.get("$tasks.count").is_some());
        assert_eq!(q["$tasks.list"]["result"]["mode"], "page");
        assert_eq!(q["$tasks.get"]["result"]["mode"], "single");
        assert_eq!(q["$tasks.count"]["result"]["mode"], "aggregate");
    }

    #[test]
    fn build_mutations_json_has_standard_three_mutations() {
        let mut conn = Connection::open_in_memory().unwrap();
        create_test_schema(&mut conn);
        let columns = table_columns(&conn, "tasks").unwrap();
        let mutations = build_mutations_json("tasks", &columns);
        let m = mutations.get("mutations").unwrap();

        let create = m.get("$tasks.create").unwrap();
        let create_sql = create.get("sql").unwrap().as_str().unwrap();
        assert!(create_sql.contains("INSERT INTO tasks"));
        assert!(create_sql.contains(":title"));
        assert!(create_sql.contains(":priority"));
        // id / created_at / updated_at must NOT be in user-settable create params
        assert!(!create_sql.contains(":id"));
        assert!(!create_sql.contains(":created_at"));
        assert!(!create_sql.contains(":updated_at"));

        let update = m.get("$tasks.update").unwrap();
        let update_sql = update.get("sql").unwrap().as_str().unwrap();
        assert!(update_sql.starts_with("UPDATE tasks SET"));
        assert!(update_sql.contains("title = COALESCE(:title, title)"));
        assert!(update_sql.contains("priority = CASE WHEN :priority__set_null THEN NULL ELSE COALESCE(:priority, priority) END"));
        assert!(update_sql.contains("WHERE id = :id"));
        let update_params = update.get("params").unwrap().as_object().unwrap();
        assert!(update_params.contains_key("id"));
        assert!(update_params.contains_key("title"));
        assert_eq!(
            update_params
                .get("priority")
                .unwrap()
                .get("nullable")
                .unwrap(),
            true
        );
        assert!(update_params.contains_key("priority__set_null"));
    }

    #[test]
    fn secure_scaffold_profiles_generate_platform_verified_contracts() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (
                id INTEGER PRIMARY KEY,
                title TEXT,
                created_by TEXT,
                assignee_id TEXT,
                project_id INTEGER,
                status TEXT
            );",
        )
        .unwrap();
        let columns = table_columns(&conn, "tasks").unwrap();
        let profiles = [
            SecureScaffoldConfig::public(),
            SecureScaffoldConfig::authenticated(),
            SecureScaffoldConfig::owner("created_by"),
            SecureScaffoldConfig::member("assignee_id"),
            SecureScaffoldConfig::parent_owner("projects", "project_id", "created_by"),
        ];

        for profile in profiles {
            let queries = build_secure_queries_json("tasks", &profile).unwrap();
            let mutations = build_secure_mutations_json("tasks", &columns, &profile).unwrap();
            let files = vec![
                (
                    "backend/resources/tasks/queries.json".to_string(),
                    serde_json::to_vec(&queries).unwrap(),
                ),
                (
                    "backend/resources/tasks/mutations.json".to_string(),
                    serde_json::to_vec(&mutations).unwrap(),
                ),
            ];
            let summary = validate_backend_security_files(&files, true).unwrap();
            assert!(summary.platform_verified >= 6);
            assert_eq!(summary.legacy_missing, 0);
        }
    }

    #[test]
    fn transition_scaffold_generates_a_status_guarded_mutation() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, status TEXT);")
            .unwrap();
        let columns = table_columns(&conn, "tasks").unwrap();
        let mut profile = SecureScaffoldConfig::authenticated();
        profile.transitions.push(ScaffoldTransition {
            name: "complete".to_string(),
            status_field: "status".to_string(),
            from: "doing".to_string(),
            to: "done".to_string(),
        });

        let mutations = build_secure_mutations_json("tasks", &columns, &profile).unwrap();
        let complete = &mutations["mutations"]["$tasks.complete"];
        assert!(
            complete["sql"]
                .as_str()
                .unwrap()
                .contains("status = 'doing'")
        );
        let files = vec![(
            "backend/resources/tasks/mutations.json".to_string(),
            serde_json::to_vec(&mutations).unwrap(),
        )];
        let summary = validate_backend_security_files(&files, true).unwrap();
        assert_eq!(summary.platform_verified, 4);
    }

    #[test]
    fn param_type_maps_sqlite_types_to_named_param_types() {
        assert_eq!(param_type_for("TEXT"), "string");
        assert_eq!(param_type_for("INTEGER"), "number");
        assert_eq!(param_type_for("REAL"), "number");
        assert_eq!(param_type_for("NUMERIC"), "number");
        assert_eq!(param_type_for(""), "string");
    }

    #[test]
    fn scaffold_skips_existing_resources_without_force() {
        let tmp = tempfile::tempdir().unwrap();
        let project_dir = tmp.path();
        fs::create_dir_all(project_dir.join("migrations")).unwrap();
        fs::write(
            project_dir.join("migrations").join("001.sql"),
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT);",
        )
        .unwrap();
        let resources_dir = project_dir.join("backend").join("resources").join("tasks");
        fs::create_dir_all(&resources_dir).unwrap();
        fs::write(resources_dir.join("schema.json"), "{}").unwrap();

        let summary = scaffold_at(
            project_dir,
            ScaffoldOptions {
                table: None,
                force: false,
                backend_root: PathBuf::from("backend"),
                ..ScaffoldOptions::default()
            },
        )
        .unwrap();

        assert!(summary.generated.is_empty());
        assert_eq!(summary.skipped, vec!["tasks".to_string()]);
    }

    #[test]
    fn scaffold_overwrites_with_force() {
        let tmp = tempfile::tempdir().unwrap();
        let project_dir = tmp.path();
        fs::create_dir_all(project_dir.join("migrations")).unwrap();
        fs::write(
            project_dir.join("migrations").join("001.sql"),
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT);",
        )
        .unwrap();
        let resources_dir = project_dir.join("backend").join("resources").join("tasks");
        fs::create_dir_all(&resources_dir).unwrap();
        fs::write(resources_dir.join("schema.json"), "{}").unwrap();

        let summary = scaffold_at(
            project_dir,
            ScaffoldOptions {
                table: None,
                force: true,
                backend_root: PathBuf::from("backend"),
                ..ScaffoldOptions::default()
            },
        )
        .unwrap();

        assert_eq!(summary.generated, vec!["tasks".to_string()]);
        let schema = fs::read_to_string(resources_dir.join("schema.json")).unwrap();
        assert!(schema.contains("\"name\": \"tasks\""));
    }

    #[test]
    fn scaffold_filters_to_single_table_when_specified() {
        let tmp = tempfile::tempdir().unwrap();
        let project_dir = tmp.path();
        fs::create_dir_all(project_dir.join("migrations")).unwrap();
        fs::write(
            project_dir.join("migrations").join("001.sql"),
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT);
             CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);",
        )
        .unwrap();

        let summary = scaffold_at(
            project_dir,
            ScaffoldOptions {
                table: Some("tasks".to_string()),
                force: false,
                backend_root: PathBuf::from("backend"),
                ..ScaffoldOptions::default()
            },
        )
        .unwrap();

        assert_eq!(summary.generated, vec!["tasks".to_string()]);
        assert!(
            !project_dir
                .join("backend")
                .join("resources")
                .join("notes")
                .join("queries.json")
                .exists()
        );
    }

}
