use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

pub const DEVICE_ACTION_PROTOCOL_VERSION: u8 = 2;
const MAX_TICKET_LENGTH: usize = 4096;
const MIN_NONCE_LENGTH: usize = 16;
const MAX_NONCE_LENGTH: usize = 128;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationTicket {
    pub protocol_version: u8,
    pub source_origin: String,
    pub action_id: String,
    pub nonce: String,
}

impl ActivationTicket {
    pub fn parse(value: &str) -> Result<Self, String> {
        if value.is_empty()
            || value.len() > MAX_TICKET_LENGTH
            || value.chars().any(char::is_control)
        {
            return Err("invalid activation ticket".into());
        }
        let url = Url::parse(value).map_err(|_| "invalid activation ticket")?;
        if url.scheme() != "localapp"
            || url.username() != ""
            || url.password().is_some()
            || url.fragment().is_some()
            || url.host_str() != Some("action")
            || url.port().is_some()
            || url.path().contains('%')
        {
            return Err("invalid activation ticket".into());
        }

        let action_id = url
            .path_segments()
            .ok_or("invalid activation ticket")?
            .collect::<Vec<_>>();
        if action_id.len() != 1 || action_id[0].is_empty() {
            return Err("invalid activation ticket".into());
        }
        let parsed_id = Uuid::parse_str(action_id[0]).map_err(|_| "invalid activation ticket")?;
        let canonical_id = parsed_id.to_string();
        if action_id[0] != canonical_id {
            return Err("invalid activation ticket".into());
        }

        let mut source_origin = None;
        let mut nonce = None;
        let mut protocol_version = None;
        let mut keys = std::collections::HashSet::new();
        for (key, value) in url.query_pairs() {
            if !keys.insert(key.to_string()) {
                return Err("invalid activation ticket".into());
            }
            match key.as_ref() {
                "origin" => source_origin = Some(value.into_owned()),
                "nonce" => nonce = Some(value.into_owned()),
                "protocolVersion" => protocol_version = Some(value.into_owned()),
                _ => return Err("invalid activation ticket".into()),
            }
        }
        if keys.len() != 3 {
            return Err("invalid activation ticket".into());
        }
        if protocol_version.as_deref() != Some("2") {
            return Err("invalid activation ticket".into());
        }

        let source_origin =
            normalize_source_origin(&source_origin.ok_or("invalid activation ticket")?)?;
        let nonce = nonce.ok_or("invalid activation ticket")?;
        if nonce.len() < MIN_NONCE_LENGTH
            || nonce.len() > MAX_NONCE_LENGTH
            || !nonce
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err("invalid activation ticket".into());
        }

        Ok(Self {
            protocol_version: DEVICE_ACTION_PROTOCOL_VERSION,
            source_origin,
            action_id: canonical_id,
            nonce,
        })
    }

    pub fn to_url(&self) -> String {
        format!(
            "localapp://action/{}?origin={}&nonce={}&protocolVersion={}",
            self.action_id,
            url::form_urlencoded::byte_serialize(self.source_origin.as_bytes()).collect::<String>(),
            url::form_urlencoded::byte_serialize(self.nonce.as_bytes()).collect::<String>(),
            self.protocol_version,
        )
    }
}

pub fn normalize_source_origin(value: &str) -> Result<String, String> {
    let url = Url::parse(value).map_err(|_| "invalid source origin")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.username() != ""
        || url.password().is_some()
        || url.path() != "" && url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid source origin".into());
    }
    Ok(url.origin().ascii_serialization())
}

pub fn validate_confirmation_url(
    value: &str,
    ready_origin: &str,
    expected_request_id: &str,
) -> Result<String, String> {
    let url = Url::parse(value).map_err(|_| "invalid confirmation URL")?;
    let expected_origin = normalize_source_origin(ready_origin)?;
    let expected_request_id = Uuid::parse_str(expected_request_id)
        .map_err(|_| "invalid confirmation URL")?
        .to_string();
    if url.origin().ascii_serialization() != expected_origin
        || url.username() != ""
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path() != "/my/device-actions/"
    {
        return Err("invalid confirmation URL".into());
    }
    let mut request_id = None;
    let mut count = 0;
    for (key, value) in url.query_pairs() {
        count += 1;
        if key != "requestId" || request_id.is_some() {
            return Err("invalid confirmation URL".into());
        }
        request_id = Some(value.into_owned());
    }
    if count != 1 || request_id.as_deref() != Some(expected_request_id.as_str()) {
        return Err("invalid confirmation URL".into());
    }
    Ok(url.to_string())
}
