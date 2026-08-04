#![allow(dead_code)]

use serde::Deserialize;

const EMBEDDED_PLATFORM_CAPABILITIES: &str = include_str!("../../../platform/capabilities.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformCapabilities {
    pub schema_version: u64,
    pub platform_version: String,
    pub content: ContentCapabilities,
    pub backend: BackendCapabilities,
    pub identity: IdentityCapabilities,
    pub verification: VerificationCapabilities,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentCapabilities {
    pub upload: ContentUploadCapabilities,
    pub read: ContentReadCapabilities,
    pub types: Vec<ContentTypeCapability>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentUploadCapabilities {
    pub enabled: bool,
    pub max_bytes: u64,
    pub validates_file_signature: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentReadCapabilities {
    pub enabled: bool,
    pub range_requests: bool,
    pub delete: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentTypeCapability {
    pub extension: String,
    pub mime_type: String,
    pub inline_preview: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendCapabilities {
    pub stable_mode: String,
    pub named_sql: NamedSqlCapabilities,
    pub hosted_actions: HostedActionCapabilities,
    pub security_contracts: SecurityContractCapabilities,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NamedSqlCapabilities {
    pub enabled: bool,
    pub transactions: bool,
    pub max_rows: u64,
    pub max_bytes: u64,
    pub system_params: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct HostedActionCapabilities {
    pub enabled: bool,
    pub stable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SecurityContractCapabilities {
    pub enabled: bool,
    pub contract_version: u64,
    pub required_from_platform_version: String,
    pub generated_templates: Vec<String>,
    pub custom_scenarios: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityCapabilities {
    pub current_user: bool,
    pub page_owner: bool,
    pub groups: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerificationCapabilities {
    pub enabled: bool,
    pub isolated_database: bool,
    pub identities: Vec<String>,
    pub default_ttl_seconds: u64,
    pub max_ttl_seconds: u64,
    pub max_concurrent_sessions: u64,
    pub max_database_bytes: u64,
}

pub(crate) fn embedded_platform_capabilities() -> Result<PlatformCapabilities, String> {
    serde_json::from_str(EMBEDDED_PLATFORM_CAPABILITIES)
        .map_err(|error| format!("Embedded platform capabilities are invalid: {error}"))
}

#[cfg(test)]
mod tests {
    use super::embedded_platform_capabilities;

    #[test]
    fn embedded_contract_parses_and_matches_the_current_platform_version() {
        let capabilities =
            embedded_platform_capabilities().expect("embedded capabilities must parse");

        assert_eq!(capabilities.schema_version, 1);
        assert_eq!(capabilities.platform_version, "1.2.0");
        assert_eq!(capabilities.backend.stable_mode, "named-sql");
        assert!(!capabilities.backend.hosted_actions.enabled);
        assert_eq!(capabilities.backend.named_sql.max_rows, 1000);
        assert_eq!(capabilities.content.upload.max_bytes, 10 * 1024 * 1024);
        assert!(capabilities.identity.current_user);
        assert!(capabilities.verification.enabled);
        assert!(capabilities.verification.isolated_database);
        assert_eq!(capabilities.verification.identities, ["owner", "member"]);
    }
}
