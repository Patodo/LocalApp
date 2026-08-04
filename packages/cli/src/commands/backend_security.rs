use crate::platform_capabilities::embedded_platform_capabilities;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SecurityVerification {
    PlatformVerified,
    ScenarioVerified,
    LegacyMissing,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct SecurityValidationSummary {
    pub platform_verified: usize,
    pub scenario_verified: usize,
    pub legacy_missing: usize,
}

pub(crate) fn validate_backend_security_files(
    files: &[(String, Vec<u8>)],
    required: bool,
) -> Result<SecurityValidationSummary, String> {
    let mut summary = SecurityValidationSummary::default();
    for (path, data) in files {
        let container = if path.ends_with("/queries.json") || path == "queries.json" {
            "queries"
        } else if path.ends_with("/mutations.json") || path == "mutations.json" {
            "mutations"
        } else {
            continue;
        };
        let kind = if container == "queries" {
            "query"
        } else {
            "mutation"
        };
        let value: Value = serde_json::from_slice(data)
            .map_err(|error| format!("Invalid backend JSON {path}: {error}"))?;
        let entries = value
            .get(container)
            .and_then(Value::as_object)
            .ok_or_else(|| format!("Backend contract file {path} must declare {container}"))?;
        for (name, entry) in entries {
            let entry = entry
                .as_object()
                .ok_or_else(|| format!("Named SQL {name} must be an object"))?;
            let sql = entry
                .get("sql")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Named SQL {name} must declare sql"))?;
            let verification = validate_named_sql_security(
                name,
                kind,
                sql,
                entry.get("access").and_then(Value::as_str),
                entry.get("security"),
                required,
            )?;
            match verification {
                SecurityVerification::PlatformVerified => summary.platform_verified += 1,
                SecurityVerification::ScenarioVerified => summary.scenario_verified += 1,
                SecurityVerification::LegacyMissing => summary.legacy_missing += 1,
            }
        }
    }
    Ok(summary)
}

pub(crate) fn security_required_for_platform_range(range: Option<&str>) -> bool {
    let Some(range) = range.map(str::trim) else {
        return false;
    };
    let required = embedded_platform_capabilities()
        .ok()
        .and_then(|capabilities| {
            parse_version(
                &capabilities
                    .backend
                    .security_contracts
                    .required_from_platform_version,
            )
        })
        .unwrap_or((1, 1, 0));
    if let Some(version) = range.strip_prefix('^').and_then(parse_version) {
        return version >= required;
    }
    if let Some(lower) = range.strip_prefix(">=") {
        let lower = lower
            .split([' ', '<', ','])
            .find(|value| !value.is_empty())
            .and_then(parse_version);
        return lower.is_some_and(|version| version >= required);
    }
    false
}

pub(crate) fn generated_security(
    name: &str,
    kind: &str,
    sql: &str,
    template: &str,
    resource: &str,
    config: Value,
) -> Value {
    let mut security = json!({
        "mode": "generated",
        "template": template,
        "resource": resource,
        "config": config,
    });
    let digest = generated_digest(name, kind, sql, &security);
    security
        .as_object_mut()
        .expect("generated security must be an object")
        .insert("digest".to_string(), Value::String(digest));
    security
}

pub(crate) fn validate_named_sql_security(
    name: &str,
    kind: &str,
    sql: &str,
    runtime_access: Option<&str>,
    security: Option<&Value>,
    required: bool,
) -> Result<SecurityVerification, String> {
    let Some(security) = security else {
        if required {
            return Err(format!(
                "Named SQL {name} must declare security.mode as generated or custom"
            ));
        }
        return Ok(SecurityVerification::LegacyMissing);
    };
    let security = security
        .as_object()
        .ok_or_else(|| format!("Named SQL {name} security must be an object"))?;
    match security.get("mode").and_then(Value::as_str) {
        Some("generated") => validate_generated(name, kind, sql, runtime_access, security),
        Some("custom") => validate_custom(name, sql, runtime_access, security),
        _ => Err(format!(
            "Named SQL {name} security.mode must be generated or custom"
        )),
    }
}

fn validate_generated(
    name: &str,
    kind: &str,
    sql: &str,
    runtime_access: Option<&str>,
    security: &Map<String, Value>,
) -> Result<SecurityVerification, String> {
    let template = required_string(security, "template", name)?;
    let resource = required_identifier(security, "resource", name)?;
    let config = security
        .get("config")
        .and_then(Value::as_object)
        .ok_or_else(|| format!("Named SQL {name} generated security must declare config"))?;
    let digest = required_string(security, "digest", name)?;
    let mut unsigned = Value::Object(security.clone());
    unsigned
        .as_object_mut()
        .expect("security is an object")
        .remove("digest");
    let expected = generated_digest(name, kind, sql, &unsigned);
    if digest != expected {
        return Err(format!(
            "Named SQL {name} generated security digest does not match its SQL or template metadata"
        ));
    }

    let normalized = normalize_sql(sql);
    if !contains_identifier(&normalized, resource) {
        return Err(format!(
            "Named SQL {name} generated template does not reference resource {resource}"
        ));
    }
    match template {
        "public-v1" => require_runtime_access(name, runtime_access, "public")?,
        "authenticated-v1" => require_runtime_access(name, runtime_access, "authenticated")?,
        "owner-read-v1" | "owner-create-v1" | "owner-update-v1" | "owner-delete-v1"
        | "member-read-v1" | "member-create-v1" | "member-update-v1" | "member-delete-v1" => {
            require_runtime_access(name, runtime_access, "authenticated")?;
            let identity_field = required_identifier(config, "identityField", name)?;
            if !normalized.contains(":currentuserid") {
                return Err(format!(
                    "Named SQL {name} generated security SQL must use trusted system param currentUserId"
                ));
            }
            require_sql_fragments(name, &normalized, &[identity_field])?;
            let identity_constraint =
                format!("{} = :currentuserid", identity_field.to_ascii_lowercase());
            match template {
                "owner-read-v1" | "member-read-v1" => {
                    require_where_constraint(name, &normalized, &identity_constraint)?;
                }
                "owner-create-v1" | "member-create-v1" => {
                    require_sql_fragments(name, &normalized, &["insert into"])?;
                    let split_at = normalized
                        .find(" values ")
                        .or_else(|| normalized.find(" select "))
                        .ok_or_else(|| {
                            format!(
                                "Named SQL {name} generated create security must use VALUES or SELECT"
                            )
                        })?;
                    if !normalized[..split_at].contains(&identity_field.to_ascii_lowercase())
                        || !normalized[split_at..].contains(":currentuserid")
                    {
                        return Err(format!(
                            "Named SQL {name} generated create security must write currentUserId to {identity_field}"
                        ));
                    }
                }
                "owner-update-v1" | "member-update-v1" => {
                    require_sql_fragments(name, &normalized, &["update"])?;
                    require_where_constraint(name, &normalized, &identity_constraint)?;
                }
                "owner-delete-v1" | "member-delete-v1" => {
                    require_sql_fragments(name, &normalized, &["delete from"])?;
                    require_where_constraint(name, &normalized, &identity_constraint)?;
                }
                _ => unreachable!(),
            }
        }
        "parent-owner-v1" => {
            require_runtime_access(name, runtime_access, "authenticated")?;
            let parent_resource = required_identifier(config, "parentResource", name)?;
            let parent_identity_field = required_identifier(config, "parentIdentityField", name)?;
            let foreign_key = required_identifier(config, "foreignKey", name)?;
            require_sql_fragments(
                name,
                &normalized,
                &[
                    "exists",
                    parent_resource,
                    parent_identity_field,
                    foreign_key,
                    ":currentuserid",
                ],
            )?;
            require_where_constraint(name, &normalized, "exists")?;
        }
        "transition-v1" => {
            require_runtime_access(name, runtime_access, "authenticated")?;
            let status_field = required_identifier(config, "statusField", name)?;
            let from = required_string(config, "from", name)?.to_ascii_lowercase();
            let to = required_string(config, "to", name)?.to_ascii_lowercase();
            require_sql_fragments(name, &normalized, &["update"])?;
            let (set_clause, where_clause) = split_set_and_where(name, &normalized)?;
            if !set_clause.contains(&status_field.to_ascii_lowercase()) || !set_clause.contains(&to)
            {
                return Err(format!(
                    "Named SQL {name} transition security SET must write {status_field} to {to}"
                ));
            }
            if !where_clause.contains(&status_field.to_ascii_lowercase())
                || !where_clause.contains(&from)
            {
                return Err(format!(
                    "Named SQL {name} transition security WHERE must require {status_field} = {from}"
                ));
            }
        }
        _ => {
            return Err(format!(
                "Named SQL {name} uses unknown generated template {template}"
            ));
        }
    }
    Ok(SecurityVerification::PlatformVerified)
}

fn validate_custom(
    name: &str,
    sql: &str,
    runtime_access: Option<&str>,
    security: &Map<String, Value>,
) -> Result<SecurityVerification, String> {
    let access = required_string(security, "access", name)?;
    if !matches!(
        access,
        "public" | "authenticated" | "owner" | "owner-or-member"
    ) {
        return Err(format!(
            "Named SQL {name} custom security access is invalid"
        ));
    }
    match access {
        "public" => require_runtime_access(name, runtime_access, "public")?,
        "authenticated" | "owner" | "owner-or-member" => {
            require_runtime_access(name, runtime_access, "authenticated")?
        }
        _ => unreachable!(),
    }

    let resources = required_string_array(security, "resources", name, false)?;
    let normalized = normalize_sql(sql);
    for resource in &resources {
        if !is_identifier(resource) || !contains_identifier(&normalized, resource) {
            return Err(format!(
                "Named SQL {name} custom security resource {resource} is invalid or absent from SQL"
            ));
        }
    }

    let declared_system_params = required_string_array(security, "systemParams", name, true)?;
    let supported = embedded_platform_capabilities()?
        .backend
        .named_sql
        .system_params
        .into_iter()
        .collect::<BTreeSet<_>>();
    if declared_system_params
        .iter()
        .any(|param| !supported.contains(param))
    {
        return Err(format!(
            "Named SQL {name} custom security declares an unsupported system param"
        ));
    }
    let used_system_params = supported
        .iter()
        .filter(|param| normalized.contains(&format!(":{}", param.to_ascii_lowercase())))
        .cloned()
        .collect::<BTreeSet<_>>();
    let declared_system_params = declared_system_params.into_iter().collect::<BTreeSet<_>>();
    if used_system_params != declared_system_params {
        return Err(format!(
            "Named SQL {name} custom security systemParams must exactly match trusted params used by SQL"
        ));
    }

    let scenarios = security
        .get("scenarios")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Named SQL {name} custom security must declare scenarios"))?;
    let mut identities = BTreeSet::new();
    for scenario in scenarios {
        let scenario = scenario.as_object().ok_or_else(|| {
            format!("Named SQL {name} custom security scenario must be an object")
        })?;
        let identity = required_string(scenario, "identity", name)?;
        let expect = required_string(scenario, "expect", name)?;
        if !matches!(identity, "anonymous" | "owner" | "member")
            || !matches!(expect, "allow" | "deny")
        {
            return Err(format!(
                "Named SQL {name} custom security scenario is invalid"
            ));
        }
        identities.insert(identity.to_string());
    }
    for required in ["owner", "member"] {
        if !identities.contains(required) {
            return Err(format!(
                "Named SQL {name} custom security must cover the {required} identity scenario"
            ));
        }
    }
    Ok(SecurityVerification::ScenarioVerified)
}

fn generated_digest(name: &str, kind: &str, sql: &str, security: &Value) -> String {
    let payload = json!({
        "name": name,
        "kind": kind,
        "sql": normalize_sql(sql),
        "security": security,
    });
    format!(
        "sha256:{:x}",
        Sha256::digest(canonical_json(&payload).as_bytes())
    )
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Object(object) => {
            let mut entries = object.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            format!(
                "{{{}}}",
                entries
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("JSON key serialization cannot fail"),
                        canonical_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(array) => format!(
            "[{}]",
            array
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        _ => serde_json::to_string(value).expect("JSON value serialization cannot fail"),
    }
}

fn normalize_sql(sql: &str) -> String {
    sql.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn require_runtime_access(name: &str, actual: Option<&str>, expected: &str) -> Result<(), String> {
    if actual == Some(expected) {
        Ok(())
    } else {
        Err(format!(
            "Named SQL {name} security requires runtime access {expected}"
        ))
    }
}

fn require_sql_fragments(name: &str, sql: &str, fragments: &[&str]) -> Result<(), String> {
    if let Some(missing) = fragments
        .iter()
        .find(|fragment| !sql.contains(&fragment.to_ascii_lowercase()))
    {
        return Err(format!(
            "Named SQL {name} generated security SQL must contain {missing}"
        ));
    }
    Ok(())
}

fn require_where_constraint(name: &str, sql: &str, constraint: &str) -> Result<(), String> {
    let where_clause = sql
        .split_once(" where ")
        .map(|(_, clause)| clause)
        .ok_or_else(|| format!("Named SQL {name} generated security must declare WHERE"))?;
    if !where_clause.contains(&constraint.to_ascii_lowercase()) {
        return Err(format!(
            "Named SQL {name} generated security WHERE must contain {constraint}"
        ));
    }
    Ok(())
}

fn split_set_and_where<'a>(name: &str, sql: &'a str) -> Result<(&'a str, &'a str), String> {
    let (_, after_set) = sql
        .split_once(" set ")
        .ok_or_else(|| format!("Named SQL {name} transition security must declare SET"))?;
    after_set
        .split_once(" where ")
        .ok_or_else(|| format!("Named SQL {name} transition security must declare WHERE"))
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    name: &str,
) -> Result<&'a str, String> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Named SQL {name} security must declare {field}"))
}

fn required_identifier<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    name: &str,
) -> Result<&'a str, String> {
    let value = required_string(object, field, name)?;
    if is_identifier(value) {
        Ok(value)
    } else {
        Err(format!(
            "Named SQL {name} security {field} must be a SQL identifier"
        ))
    }
}

fn required_string_array(
    object: &Map<String, Value>,
    field: &str,
    name: &str,
    allow_empty: bool,
) -> Result<Vec<String>, String> {
    let values = object
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Named SQL {name} security must declare {field}"))?;
    if !allow_empty && values.is_empty() {
        return Err(format!(
            "Named SQL {name} security {field} must not be empty"
        ));
    }
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .map(ToString::to_string)
                .ok_or_else(|| format!("Named SQL {name} security {field} must contain strings"))
        })
        .collect()
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn contains_identifier(sql: &str, identifier: &str) -> bool {
    sql.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .any(|token| token == identifier.to_ascii_lowercase())
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.trim().split(['.', '-', '+']);
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::{
        SecurityVerification, generated_security, security_required_for_platform_range,
        validate_backend_security_files, validate_named_sql_security,
    };
    use serde_json::json;

    #[test]
    fn missing_security_is_legacy_only_until_the_policy_requires_it() {
        assert_eq!(
            validate_named_sql_security(
                "$tasks.list",
                "query",
                "SELECT * FROM tasks",
                Some("authenticated"),
                None,
                false,
            )
            .unwrap(),
            SecurityVerification::LegacyMissing,
        );
        assert!(
            validate_named_sql_security(
                "$tasks.list",
                "query",
                "SELECT * FROM tasks",
                Some("authenticated"),
                None,
                true,
            )
            .unwrap_err()
            .contains("security")
        );
    }

    #[test]
    fn generated_owner_contract_rejects_digest_and_identity_constraint_drift() {
        let sql = "SELECT * FROM tasks WHERE created_by = :currentUserId";
        let security = generated_security(
            "$tasks.mine",
            "query",
            sql,
            "owner-read-v1",
            "tasks",
            json!({ "identityField": "created_by" }),
        );
        assert_eq!(
            validate_named_sql_security(
                "$tasks.mine",
                "query",
                sql,
                Some("authenticated"),
                Some(&security),
                true,
            )
            .unwrap(),
            SecurityVerification::PlatformVerified,
        );

        let changed_sql = "SELECT * FROM tasks";
        assert!(
            validate_named_sql_security(
                "$tasks.mine",
                "query",
                changed_sql,
                Some("authenticated"),
                Some(&security),
                true,
            )
            .unwrap_err()
            .contains("digest")
        );

        let forged = generated_security(
            "$tasks.mine",
            "query",
            changed_sql,
            "owner-read-v1",
            "tasks",
            json!({ "identityField": "created_by" }),
        );
        assert!(
            validate_named_sql_security(
                "$tasks.mine",
                "query",
                changed_sql,
                Some("authenticated"),
                Some(&forged),
                true,
            )
            .unwrap_err()
            .contains("currentUserId")
        );

        let misplaced_sql = "UPDATE tasks SET created_by = :currentUserId WHERE id = :id";
        let misplaced = generated_security(
            "$tasks.update",
            "mutation",
            misplaced_sql,
            "owner-update-v1",
            "tasks",
            json!({ "identityField": "created_by" }),
        );
        assert!(
            validate_named_sql_security(
                "$tasks.update",
                "mutation",
                misplaced_sql,
                Some("authenticated"),
                Some(&misplaced),
                true,
            )
            .unwrap_err()
            .contains("WHERE")
        );
    }

    #[test]
    fn custom_contract_requires_resources_system_params_and_identity_scenarios() {
        let sql =
            "SELECT status, COUNT(*) FROM tasks WHERE created_by = :currentUserId GROUP BY status";
        let complete = json!({
            "mode": "custom",
            "access": "owner",
            "resources": ["tasks"],
            "systemParams": ["currentUserId"],
            "scenarios": [
                { "identity": "owner", "expect": "allow" },
                { "identity": "member", "expect": "deny" }
            ]
        });
        assert_eq!(
            validate_named_sql_security(
                "tasks.dashboard",
                "query",
                sql,
                Some("authenticated"),
                Some(&complete),
                true,
            )
            .unwrap(),
            SecurityVerification::ScenarioVerified,
        );

        let incomplete = json!({
            "mode": "custom",
            "access": "owner",
            "resources": ["tasks"],
            "systemParams": ["currentUserId"],
            "scenarios": [{ "identity": "owner", "expect": "allow" }]
        });
        assert!(
            validate_named_sql_security(
                "tasks.dashboard",
                "query",
                sql,
                Some("authenticated"),
                Some(&incomplete),
                true,
            )
            .unwrap_err()
            .contains("member")
        );
    }

    #[test]
    fn backend_file_summary_distinguishes_legacy_generated_and_custom_contracts() {
        let generated_sql = "SELECT * FROM tasks";
        let generated = generated_security(
            "$tasks.list",
            "query",
            generated_sql,
            "authenticated-v1",
            "tasks",
            json!({}),
        );
        let files = vec![(
            "backend/resources/tasks/queries.json".to_string(),
            serde_json::to_vec(&json!({
                "queries": {
                    "$tasks.list": {
                        "kind": "query",
                        "sql": generated_sql,
                        "access": "authenticated",
                        "security": generated
                    },
                    "tasks.custom": {
                        "kind": "query",
                        "sql": "SELECT * FROM tasks WHERE created_by = :currentUserId",
                        "access": "authenticated",
                        "security": {
                            "mode": "custom",
                            "access": "owner",
                            "resources": ["tasks"],
                            "systemParams": ["currentUserId"],
                            "scenarios": [
                                { "identity": "owner", "expect": "allow" },
                                { "identity": "member", "expect": "deny" }
                            ]
                        }
                    },
                    "tasks.legacy": {
                        "kind": "query",
                        "sql": "SELECT * FROM tasks",
                        "access": "authenticated"
                    }
                }
            }))
            .unwrap(),
        )];

        let summary = validate_backend_security_files(&files, false).unwrap();
        assert_eq!(summary.platform_verified, 1);
        assert_eq!(summary.scenario_verified, 1);
        assert_eq!(summary.legacy_missing, 1);
        assert!(validate_backend_security_files(&files, true).is_err());
    }

    #[test]
    fn security_policy_is_required_from_platform_contract_1_1() {
        assert!(!security_required_for_platform_range(None));
        assert!(!security_required_for_platform_range(Some("^1.0")));
        assert!(security_required_for_platform_range(Some("^1.1")));
        assert!(security_required_for_platform_range(Some(">=1.1 <2.0")));
        assert!(security_required_for_platform_range(Some("^2.0")));
    }
}
