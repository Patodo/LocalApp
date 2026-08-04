use localapp_core::{Config, PlatformClient};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet, VecDeque};
use std::sync::Mutex;
use url::Url;
use uuid::Uuid;

const MAX_NONCE_LENGTH: usize = 256;
pub const DESKTOP_ACTION_PROTOCOL_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionActivation {
    pub request_id: String,
    pub nonce: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionStatus {
    Pending,
    Claimed,
    AwaitingTrust,
    Preparing,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Expired,
    Interrupted,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAction {
    pub id: String,
    pub nonce: String,
    pub server_origin: String,
    pub app_owner: String,
    pub app_name: String,
    pub app_version: Option<String>,
    pub publisher_user_id: String,
    pub publisher_display_name: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub created_at: String,
    pub expires_at: String,
}

impl From<PendingAction> for ActionActivation {
    fn from(action: PendingAction) -> Self {
        Self {
            request_id: action.id,
            nonce: action.nonce,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedAction {
    pub id: String,
    pub server_origin: String,
    pub app_owner: String,
    pub app_name: String,
    pub app_version: Option<String>,
    pub publisher_user_id: String,
    pub publisher_display_name: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub script: String,
    pub dependencies: BTreeMap<String, String>,
    pub input: serde_json::Value,
    pub timeout_seconds: u32,
    pub status: ActionStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionSnapshot {
    pub id: String,
    pub status: ActionStatus,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionStatusUpdate {
    pub status: ActionStatus,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<ActionError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerStatusUpdate<'a> {
    installation_id: &'a str,
    status: &'a ActionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<&'a serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a ActionError>,
}

pub struct ActionService {
    client: PlatformClient,
    installation_id: String,
}

impl ActionService {
    pub fn new(config: Config, installation_id: String) -> Self {
        Self {
            client: PlatformClient::new(config),
            installation_id,
        }
    }

    pub async fn list_pending(&self) -> Result<Vec<PendingAction>, String> {
        self.client
            .get("/api/desktop-actions/pending")
            .await
            .map_err(action_api_error)
    }

    pub async fn list_recoverable(&self) -> Result<Vec<ClaimedAction>, String> {
        let path = recover_path(&self.installation_id)?;
        self.client.get(&path).await.map_err(action_api_error)
    }

    pub async fn claim(&self, activation: &ActionActivation) -> Result<ClaimedAction, String> {
        validate_request_id(&activation.request_id)?;
        let path = claim_path(activation, &self.installation_id);
        self.client.get(&path).await.map_err(action_api_error)
    }

    pub async fn update_status(
        &self,
        request_id: &str,
        update: ActionStatusUpdate,
    ) -> Result<ActionSnapshot, String> {
        validate_request_id(request_id)?;
        self.client
            .post(
                &format!("/api/desktop-actions/{request_id}/status"),
                &ServerStatusUpdate {
                    installation_id: &self.installation_id,
                    status: &update.status,
                    result: update.result.as_ref(),
                    error: update.error.as_ref(),
                },
            )
            .await
            .map_err(action_api_error)
    }
}

fn recover_path(installation_id: &str) -> Result<String, String> {
    validate_installation_id(installation_id)?;
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query.append_pair("installationId", installation_id);
    Ok(format!("/api/desktop-actions/recover?{}", query.finish()))
}

fn claim_path(activation: &ActionActivation, installation_id: &str) -> String {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query.append_pair("nonce", &activation.nonce);
    query.append_pair("installationId", installation_id);
    query.append_pair(
        "protocolVersion",
        &DESKTOP_ACTION_PROTOCOL_VERSION.to_string(),
    );
    format!(
        "/api/desktop-actions/{}/claim?{}",
        activation.request_id,
        query.finish()
    )
}

pub(crate) fn validate_request_id(request_id: &str) -> Result<(), String> {
    if Uuid::parse_str(request_id).is_ok_and(|id| id.to_string() == request_id) {
        Ok(())
    } else {
        Err("Desktop action request ID is invalid".to_string())
    }
}

fn validate_installation_id(installation_id: &str) -> Result<(), String> {
    if Uuid::parse_str(installation_id).is_ok_and(|id| id.to_string() == installation_id) {
        Ok(())
    } else {
        Err("Desktop installation ID is invalid".to_string())
    }
}

fn action_api_error(error: localapp_core::PlatformError) -> String {
    format!("Could not update the LocalApp desktop action: {error}")
}

pub fn parse_activation_url(candidate: &str) -> Result<ActionActivation, String> {
    if candidate.chars().any(char::is_control) {
        return Err("Action activation URL contains control characters".to_string());
    }

    let url = Url::parse(candidate).map_err(|_| "Action activation URL is invalid".to_string())?;
    if url.scheme() != "localapp"
        || url.host_str() != Some("action")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return Err("Action activation URL has an invalid boundary".to_string());
    }

    let segments: Vec<&str> = url
        .path_segments()
        .ok_or_else(|| "Action activation URL has no request ID".to_string())?
        .collect();
    if segments.len() != 1 {
        return Err("Action activation URL must contain one request ID".to_string());
    }
    let request_id = segments[0];
    let parsed_id = Uuid::parse_str(request_id)
        .map_err(|_| "Action activation request ID is invalid".to_string())?;
    if parsed_id.to_string() != request_id {
        return Err("Action activation request ID is not canonical".to_string());
    }

    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    if pairs.len() != 1 || pairs[0].0 != "nonce" {
        return Err("Action activation URL must contain exactly one nonce".to_string());
    }
    let nonce = &pairs[0].1;
    if nonce.is_empty()
        || nonce.len() > MAX_NONCE_LENGTH
        || !nonce
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Action activation nonce is invalid".to_string());
    }

    Ok(ActionActivation {
        request_id: request_id.to_string(),
        nonce: nonce.clone(),
    })
}

#[derive(Default)]
pub struct ActivationQueue {
    inner: Mutex<ActivationQueueInner>,
}

#[derive(Default)]
struct ActivationQueueInner {
    pending: VecDeque<ActionActivation>,
    seen: HashSet<ActionActivation>,
}

impl ActivationQueue {
    pub fn push_urls<I, S>(&self, candidates: I) -> usize
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        self.push_activations(
            candidates
                .into_iter()
                .filter_map(|candidate| parse_activation_url(candidate.as_ref()).ok()),
        )
    }

    pub fn push_activations<I>(&self, activations: I) -> usize
    where
        I: IntoIterator<Item = ActionActivation>,
    {
        let Ok(mut inner) = self.inner.lock() else {
            return 0;
        };
        let mut accepted = 0;
        for activation in activations {
            if inner.seen.insert(activation.clone()) {
                inner.pending.push_back(activation);
                accepted += 1;
            }
        }
        accepted
    }

    pub fn take_pending(&self) -> Vec<ActionActivation> {
        self.inner
            .lock()
            .map(|mut inner| {
                let pending: Vec<_> = inner.pending.drain(..).collect();
                for activation in &pending {
                    inner.seen.remove(activation);
                }
                pending
            })
            .unwrap_or_default()
    }
}
