use crate::client::Client;
use localapp_core::ResolvedTarget;
use serde_json::Value;
use std::time::Duration;

const TERMINAL_STATUSES: &[&str] = &["completed", "rolled-back", "failed", "recovery-required"];

pub async fn sync_application(
    target: &ResolvedTarget,
    app_name: &str,
    peer_name: &str,
    with_data: bool,
    confirmation: Option<&str>,
) -> Result<(), String> {
    if with_data && confirmation != Some(app_name) {
        return Err(format!("--with-data requires --confirm-app {app_name}"));
    }

    let client = Client::new(&target.as_config());
    let body = if with_data {
        serde_json::json!({
            "peerName": peer_name,
            "withData": true,
            "confirmation": app_name,
        })
    } else {
        serde_json::json!({
            "peerName": peer_name,
            "withData": false,
        })
    };
    let (status, response) = client
        .post_json(&format!("/api/me/apps/{app_name}/sync"), body)
        .await?;
    if status != 202 || response["success"].as_bool() != Some(true) {
        return Err(response_error(
            &response,
            "Could not start application synchronization",
        ));
    }
    let job_id = response["data"]["id"]
        .as_str()
        .ok_or_else(|| "Server returned an invalid synchronization job".to_string())?;

    loop {
        let (status, job_response) = client.get(&format!("/api/sync-jobs/{job_id}")).await?;
        if status != 200 || job_response["success"].as_bool() != Some(true) {
            return Err(response_error(
                &job_response,
                "Could not read application synchronization status",
            ));
        }
        let job = job_response["data"].clone();
        let job_status = job["status"].as_str().unwrap_or("unknown");
        if TERMINAL_STATUSES.contains(&job_status) {
            println!(
                "{}",
                serde_json::json!({
                    "success": job_status == "completed",
                    "status": job_status,
                    "job": job,
                    "sourceServer": target.base_url(),
                    "peer": peer_name,
                    "withData": with_data,
                })
            );
            if job_status == "completed" {
                return Ok(());
            }
            return Err(job["error"]
                .as_str()
                .unwrap_or("Application synchronization failed")
                .to_string());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn response_error(response: &Value, fallback: &str) -> String {
    response["error"]
        .as_str()
        .or_else(|| response["message"].as_str())
        .unwrap_or(fallback)
        .to_string()
}
