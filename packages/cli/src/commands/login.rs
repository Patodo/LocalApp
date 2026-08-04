use crate::config::{Config, ProfileStore, ServerProfile};
use crate::version;
use dialoguer::{Input, Password};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize)]
struct LoginUser {
    id: String,
    name: String,
    role: String,
}

#[derive(Deserialize)]
struct LoginEnvelope {
    success: bool,
    data: Option<LoginUser>,
}

fn login_error(code: &str, message: &str) -> String {
    serde_json::json!({
        "success": false,
        "code": code,
        "message": message,
    })
    .to_string()
}

fn normalize_server_url(server_url: &str) -> Result<String, String> {
    let trimmed = server_url.trim().trim_end_matches('/');
    let parsed = Url::parse(trimmed).map_err(|_| {
        login_error(
            "LOGIN_CONNECTION_FAILED",
            "Server URL 无效，请检查地址后重试。",
        )
    })?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(login_error(
            "LOGIN_CONNECTION_FAILED",
            "Server URL 必须是有效的 HTTP 或 HTTPS 地址。",
        ));
    }
    Ok(trimmed.to_string())
}

async fn validate_login(server_url: &str, api_key: &str) -> Result<LoginUser, String> {
    let url = format!("{server_url}/api/me");
    let http = Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| {
            login_error(
                "LOGIN_CONNECTION_FAILED",
                "无法初始化网络客户端，请稍后重试。",
            )
        })?;
    let response = http
        .get(url)
        .header("X-API-Key", api_key)
        .header("X-CLI-Version", version::cli_version())
        .send()
        .await
        .map_err(|_| {
            login_error(
                "LOGIN_CONNECTION_FAILED",
                "无法连接 LocalApp Server，请检查地址和网络。",
            )
        })?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(login_error(
            "LOGIN_INVALID_API_KEY",
            "API Key 无效，请联系管理员获取有效凭据。",
        ));
    }
    if !response.status().is_success() {
        return Err(login_error(
            "LOGIN_PROTOCOL_ERROR",
            "LocalApp Server 返回了不兼容的状态。",
        ));
    }

    let envelope = response.json::<LoginEnvelope>().await.map_err(|_| {
        login_error(
            "LOGIN_PROTOCOL_ERROR",
            "目标地址未返回兼容的 LocalApp 登录响应。",
        )
    })?;
    if !envelope.success {
        return Err(login_error(
            "LOGIN_PROTOCOL_ERROR",
            "LocalApp Server 返回了不兼容的登录响应。",
        ));
    }
    envelope.data.ok_or_else(|| {
        login_error(
            "LOGIN_INVALID_API_KEY",
            "API Key 无效，请联系管理员获取有效凭据。",
        )
    })
}

pub async fn run(
    cli_server_url: Option<String>,
    cli_api_key: Option<String>,
    profile_name: Option<String>,
) -> Result<(), String> {
    let complete_non_interactive = cli_server_url.is_some() && cli_api_key.is_some();
    let existing_profile = if let Some(name) = profile_name.as_deref() {
        ProfileStore::load()?.profiles.get(name).cloned()
    } else {
        None
    };
    let existing = existing_profile
        .map(|profile| Config {
            server_url: profile.server_url,
            api_key: profile.api_key,
        })
        .or_else(Config::load);

    let server_url = if complete_non_interactive {
        cli_server_url.unwrap()
    } else {
        let default_url = cli_server_url
            .as_deref()
            .or_else(|| existing.as_ref().map(|config| config.server_url.as_str()))
            .unwrap_or("");
        Input::new()
            .with_prompt("Server URL")
            .default(default_url.to_string())
            .interact()
            .map_err(|e| format!("输入 Server URL 失败: {e}"))?
    };

    let api_key = match cli_api_key {
        Some(api_key) => api_key,
        None => Password::new()
            .with_prompt("API Key")
            .allow_empty_password(false)
            .interact()
            .map_err(|e| format!("输入 API Key 失败: {e}"))?,
    };

    let server_url = normalize_server_url(&server_url)?;
    let user = validate_login(&server_url, &api_key).await?;
    if let Some(name) = profile_name.as_deref() {
        let mut store = ProfileStore::load()?;
        store.upsert(ServerProfile {
            name: name.to_string(),
            server_url: server_url.clone(),
            api_key,
        })?;
    } else {
        Config {
            server_url: server_url.clone(),
            api_key,
        }
        .save()?;
    }

    println!(
        "{}",
        serde_json::json!({
            "success": true,
            "user": user,
            "profile": profile_name,
            "serverUrl": server_url,
        })
    );
    Ok(())
}
