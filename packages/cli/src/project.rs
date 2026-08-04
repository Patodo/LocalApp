use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const MANIFEST_FILE: &str = "manifest.json";

const RESERVED_NAMES: &[&str] = &[
    "api", "serve", "health", "cli", "keys", "upload", "pages", "schemas",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDb {
    #[serde(default = "default_db_mode")]
    pub mode: String,
    #[serde(default, rename = "sqlAccess")]
    pub sql_access: Option<String>,
    #[serde(default)]
    pub default_access: Option<HashMap<String, String>>,
}

fn default_db_mode() -> String {
    "crud".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestShell {
    #[serde(default)]
    pub navbar: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestIssueTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ManifestIssues {
    #[serde(default)]
    pub templates: Vec<ManifestIssueTemplate>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestNotifyPermission {
    pub table: String,
    #[serde(
        default,
        rename = "userColumn",
        skip_serializing_if = "Option::is_none"
    )]
    pub user_column: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#where: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestNotify {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<ManifestNotifyPermission>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManifestBackend {
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub include: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCollaborationResource {
    #[serde(default = "default_collaboration_mode")]
    pub mode: String,
    #[serde(default)]
    pub mutation: String,
    #[serde(default)]
    pub history: bool,
}

fn default_collaboration_mode() -> String {
    "record-versioned".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCollaboration {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub resources: HashMap<String, ManifestCollaborationResource>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestContentRequirements {
    #[serde(default)]
    pub mime_types: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<u64>,
    #[serde(default)]
    pub inline_preview: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRequires {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<ManifestContentRequirements>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
    #[serde(default)]
    pub identity: Vec<String>,
    #[serde(default)]
    pub primitives: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Manifest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_dist_dir", rename = "distDir")]
    pub dist_dir: String,
    #[serde(default)]
    pub db: Option<ManifestDb>,
    #[serde(default)]
    pub shell: Option<ManifestShell>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issues: Option<ManifestIssues>,
    #[serde(default)]
    pub notify: Option<ManifestNotify>,
    #[serde(default)]
    pub backend: Option<ManifestBackend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collaboration: Option<ManifestCollaboration>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<ManifestRequires>,
    #[serde(rename = "platformVersion", skip_serializing_if = "Option::is_none")]
    pub platform_version: Option<String>,
}

pub fn validate_manifest_collaboration(
    collaboration: Option<&ManifestCollaboration>,
    declared_mutations: &[String],
) -> Result<(), String> {
    let Some(collaboration) = collaboration else {
        return Ok(());
    };
    if !collaboration.enabled {
        return Ok(());
    }
    if collaboration.resources.is_empty() {
        return Err("collaboration.resources must declare at least one resource when collaboration.enabled is true".to_string());
    }
    for (resource_name, resource) in &collaboration.resources {
        if resource.mode != "record-versioned" {
            return Err(format!(
                "collaboration.resources.{resource_name}.mode only supports record-versioned"
            ));
        }
        if resource.mutation.trim().is_empty() {
            return Err(format!(
                "collaboration.resources.{resource_name}.mutation is required"
            ));
        }
        if !declared_mutations.is_empty()
            && !declared_mutations.iter().any(|name| name == &resource.mutation)
        {
            return Err(format!(
                "collaboration.resources.{resource_name}.mutation references unknown backend mutation: {}",
                resource.mutation
            ));
        }
    }
    Ok(())
}

fn default_dist_dir() -> String {
    "dist".to_string()
}

impl Manifest {
    pub fn read_validated(dir: &Path) -> Result<Option<Manifest>, String> {
        let path = dir.join(MANIFEST_FILE);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read {MANIFEST_FILE}: {error}"))?;
        let value: Value = serde_json::from_str(&content)
            .map_err(|error| format!("Invalid {MANIFEST_FILE}: {error}"))?;
        validate_manifest_value(&value)?;
        serde_json::from_value(value)
            .map(Some)
            .map_err(|error| format!("Invalid {MANIFEST_FILE}: {error}"))
    }

    pub fn read(dir: &Path) -> Option<Manifest> {
        let path = dir.join(MANIFEST_FILE);
        if !path.exists() {
            return None;
        }
        let content = fs::read_to_string(&path).ok()?;
        if serde_json::from_str::<serde_json::Value>(&content)
            .ok()
            .and_then(|value| value.get("schemas").cloned())
            .is_some()
        {
            eprintln!(
                "manifest.json contains deprecated schemas field. Write SQL migrations in migrations/ instead."
            );
        }
        serde_json::from_str(&content).ok()
    }

    pub fn write(dir: &Path, manifest: &Manifest) -> Result<(), String> {
        let path = dir.join(MANIFEST_FILE);
        let content = serde_json::to_string_pretty(manifest)
            .map_err(|e| format!("Failed to serialize: {e}"))?;
        fs::write(&path, content).map_err(|e| format!("Failed to write {MANIFEST_FILE}: {e}"))?;
        Ok(())
    }

    pub fn exists(dir: &Path) -> bool {
        dir.join(MANIFEST_FILE).exists()
    }
}

fn validate_manifest_value(value: &Value) -> Result<(), String> {
    let manifest = value
        .as_object()
        .ok_or_else(|| "manifest: must be an object".to_string())?;
    let Some(db) = manifest.get("db") else {
        return Ok(());
    };
    if db.is_null() {
        return Ok(());
    }
    let db = db
        .as_object()
        .ok_or_else(|| "db: must be an object".to_string())?;
    if let Some(mode) = db.get("mode") {
        if !matches!(mode.as_str(), Some("crud" | "sql")) {
            return Err("db.mode: must be crud or sql".to_string());
        }
    }
    if let Some(access) = db.get("sqlAccess") {
        validate_manifest_access(access, "db.sqlAccess")?;
    }
    if let Some(default_access) = db.get("defaultAccess") {
        let access = default_access
            .as_object()
            .ok_or_else(|| "db.defaultAccess: must be an object".to_string())?;
        for action in ["read", "create", "update", "delete"] {
            if let Some(level) = access.get(action) {
                validate_manifest_access(level, &format!("db.defaultAccess.{action}"))?;
            }
        }
    }
    Ok(())
}

fn validate_manifest_access(value: &Value, field: &str) -> Result<(), String> {
    if matches!(
        value.as_str(),
        Some("public" | "authenticated" | "owner" | "acl")
    ) {
        Ok(())
    } else {
        Err(format!(
            "{field}: must be public, authenticated, owner, or acl"
        ))
    }
}

pub fn is_valid_name(name: &str) -> bool {
    if name.len() < 3 || name.len() > 63 {
        return false;
    }
    if !name
        .chars()
        .next()
        .map_or(false, |c| c.is_ascii_lowercase())
    {
        return false;
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return false;
    }
    if name.contains("--") {
        return false;
    }
    if name.ends_with('-') {
        return false;
    }
    if RESERVED_NAMES.contains(&name) {
        return false;
    }
    true
}

#[cfg(test)]
mod collaboration_tests {
    use super::{Manifest, ManifestCollaboration, validate_manifest_collaboration};

    #[test]
    fn reads_valid_collaboration_config() {
        let manifest: Manifest = serde_json::from_str(
            r#"{
              "name": "collab-app",
              "collaboration": {
                "enabled": true,
                "resources": {
                  "tasks": {
                    "mode": "record-versioned",
                    "mutation": "tasks.updateCollaborative",
                    "history": true
                  }
                }
              }
            }"#,
        )
        .unwrap();

        let collaboration = manifest.collaboration.unwrap();
        assert!(collaboration.enabled);
        assert_eq!(
            collaboration.resources["tasks"].mutation,
            "tasks.updateCollaborative"
        );
        validate_manifest_collaboration(Some(&collaboration), &[]).unwrap();
    }

    #[test]
    fn rejects_invalid_collaboration_config() {
        let missing_mutation = ManifestCollaboration {
            enabled: true,
            resources: serde_json::from_value(serde_json::json!({
                "tasks": { "mode": "record-versioned" }
            }))
            .unwrap(),
        };
        assert!(
            validate_manifest_collaboration(Some(&missing_mutation), &[])
                .unwrap_err()
                .contains("collaboration.resources.tasks.mutation")
        );

        let unsupported_mode = ManifestCollaboration {
            enabled: true,
            resources: serde_json::from_value(serde_json::json!({
                "tasks": { "mode": "ot", "mutation": "tasks.updateCollaborative" }
            }))
            .unwrap(),
        };
        assert!(
            validate_manifest_collaboration(Some(&unsupported_mode), &[])
                .unwrap_err()
                .contains("record-versioned")
        );
    }
}

#[cfg(test)]
mod issue_template_tests {
    use super::Manifest;

    #[test]
    fn preserves_issue_templates_when_manifest_is_serialized_for_upload() {
        let manifest: Manifest = serde_json::from_str(r###"{
          "name": "template-app",
          "issues": {
            "templates": [{
              "id": "bug-report",
              "name": "Bug report",
              "description": "Report a defect",
              "titlePrefix": "[Bug] ",
              "body": "## Steps",
              "type": "bug",
              "labels": ["triage"]
            }]
          }
        }"###).unwrap();

        let serialized = serde_json::to_value(&manifest).unwrap();
        assert_eq!(serialized["issues"]["templates"][0]["id"], "bug-report");
        assert_eq!(serialized["issues"]["templates"][0]["titlePrefix"], "[Bug] ");
        assert_eq!(serialized["issues"]["templates"][0]["labels"], serde_json::json!(["triage"]));
    }
}

#[cfg(test)]
mod manifest_validation_tests {
    use super::Manifest;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rejects_null_default_access_with_a_field_level_error() {
        let project = tempdir().unwrap();
        fs::write(
            project.path().join("manifest.json"),
            r#"{
              "name": "invalid-access-app",
              "db": {
                "mode": "crud",
                "defaultAccess": null
              }
            }"#,
        )
        .unwrap();

        let error = Manifest::read_validated(project.path()).unwrap_err();
        assert!(error.contains("db.defaultAccess"));
        assert!(error.contains("object"));
    }
}
