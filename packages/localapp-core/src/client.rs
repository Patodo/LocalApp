use crate::Config;
use reqwest::{Client, Method, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fmt;

pub struct PlatformClient {
    http: Client,
    base_url: String,
    api_key: String,
}

#[derive(Debug)]
pub enum PlatformError {
    NotConfigured,
    Transport,
    Http { status: u16, message: String },
    InvalidEnvelope,
}

impl fmt::Display for PlatformError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotConfigured => formatter.write_str("Platform client is not configured"),
            Self::Transport => formatter.write_str("Platform request failed"),
            Self::Http { status, message } => {
                write!(formatter, "Platform request failed ({status}): {message}")
            }
            Self::InvalidEnvelope => formatter.write_str("Platform returned an invalid response"),
        }
    }
}

impl std::error::Error for PlatformError {}

#[derive(Deserialize)]
struct Envelope<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl PlatformClient {
    pub fn new(config: Config) -> Self {
        Self {
            http: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("failed to build platform HTTP client"),
            base_url: config.base_url().to_string(),
            api_key: config.api_key,
        }
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, PlatformError> {
        self.send::<T, ()>(Method::GET, path, None).await
    }

    pub async fn post<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, PlatformError> {
        self.send(Method::POST, path, Some(body)).await
    }

    pub async fn patch<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, PlatformError> {
        self.send(Method::PATCH, path, Some(body)).await
    }

    pub async fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T, PlatformError> {
        self.send::<T, ()>(Method::DELETE, path, None).await
    }

    async fn send<T: DeserializeOwned, B: Serialize + ?Sized>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<T, PlatformError> {
        if self.base_url.trim().is_empty() || self.api_key.trim().is_empty() {
            return Err(PlatformError::NotConfigured);
        }

        let url = self.url(path)?;
        let request = self
            .http
            .request(method, url)
            .header("X-API-Key", &self.api_key);
        let request = if let Some(body) = body {
            request.json(body)
        } else {
            request
        };
        let response = request.send().await.map_err(|_| PlatformError::Transport)?;
        let status = response.status();

        if !status.is_success() {
            return Err(Self::http_status_error(status));
        }

        let envelope = response
            .json::<Envelope<T>>()
            .await
            .map_err(|_| PlatformError::InvalidEnvelope)?;

        if envelope.success {
            return envelope.data.ok_or(PlatformError::InvalidEnvelope);
        }

        Err(PlatformError::Http {
            status: status.as_u16(),
            message: self.redact_api_key(
                envelope
                    .error
                    .unwrap_or_else(|| "Platform request failed".to_string()),
            ),
        })
    }

    fn url(&self, path: &str) -> Result<Url, PlatformError> {
        let base_url = Url::parse(&self.base_url).map_err(|_| PlatformError::Transport)?;
        let url = base_url.join(path).map_err(|_| PlatformError::Transport)?;

        if url.origin() != base_url.origin() {
            return Err(PlatformError::Transport);
        }

        Ok(url)
    }

    fn http_status_error(status: StatusCode) -> PlatformError {
        PlatformError::Http {
            status: status.as_u16(),
            message: status
                .canonical_reason()
                .unwrap_or("Platform request failed")
                .to_string(),
        }
    }

    fn redact_api_key(&self, message: String) -> String {
        message.replace(&self.api_key, "[REDACTED]")
    }
}
