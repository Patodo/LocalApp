use crate::activation::{ActivationTicket, DEVICE_ACTION_PROTOCOL_VERSION};
use reqwest::redirect::Policy;
use serde::Deserialize;
use url::Url;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceControlActivation {
    pub request_id: String,
    pub status: String,
    pub confirmation_url: String,
    pub protocol_version: u8,
}

pub struct DeviceControlClient {
    endpoint: Url,
    token: String,
    client: reqwest::Client,
}

impl DeviceControlClient {
    pub fn new(ready_origin: &str, token: String) -> Result<Self, String> {
        let endpoint = Url::parse(ready_origin).map_err(|_| "invalid Server origin")?;
        if endpoint.scheme() != "http"
            || !matches!(endpoint.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "::1"))
            || endpoint.username() != ""
            || endpoint.password().is_some()
        {
            return Err("device control requires an authenticated loopback Server".into());
        }
        if token.is_empty() {
            return Err("device control token is required".into());
        }
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|error| format!("Could not create device control client: {error}"))?;
        Ok(Self { endpoint, token, client })
    }

    pub async fn activate(&self, ticket: &ActivationTicket) -> Result<DeviceControlActivation, String> {
        if ticket.protocol_version != DEVICE_ACTION_PROTOCOL_VERSION {
            return Err("unsupported device action protocol".into());
        }
        let url = self
            .endpoint
            .join("/api/device-control/activations")
            .map_err(|_| "invalid device control endpoint")?;
        let response = self
            .client
            .post(url)
            .header("x-localapp-device-control", &self.token)
            .json(ticket)
            .send()
            .await
            .map_err(|_| "device action activation request failed".to_string())?;
        let status = response.status();
        let body = response
            .json::<Envelope<DeviceControlActivation>>()
            .await
            .map_err(|_| "Server returned an invalid device action response".to_string())?;
        if !status.is_success() || !body.success {
            return Err("Server rejected the device action activation".into());
        }
        let data = body.data.ok_or("Server returned no activation data")?;
        if data.protocol_version != DEVICE_ACTION_PROTOCOL_VERSION {
            return Err("Server returned an unsupported device action protocol".into());
        }
        Ok(data)
    }
}

#[derive(Deserialize)]
struct Envelope<T> {
    success: bool,
    data: Option<T>,
}
