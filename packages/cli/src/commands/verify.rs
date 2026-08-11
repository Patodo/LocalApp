use crate::client::Client;
use crate::config::{Config, ResolvedTarget, resolve_project_target};
use crate::project::Manifest;
use reqwest::header::{COOKIE, LOCATION, SET_COOKIE};
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificationCheck {
    phase: String,
    status: String,
    summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    suggestion: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerificationReport {
    schema_version: u64,
    success: bool,
    status: String,
    identity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<u64>,
    checks: Vec<VerificationCheck>,
    #[serde(skip_serializing_if = "Option::is_none")]
    browser_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    browser_session_id: Option<String>,
    pending_browser_checks: Vec<String>,
}

pub async fn run(identity: &str, json_output: bool, profile: Option<&str>) -> Result<(), String> {
    if std::env::current_dir()
        .ok()
        .and_then(|cwd| Manifest::read(&cwd))
        .is_none()
    {
        let mut report = empty_report(identity);
        let (_, error) = failed(
            &mut report,
            "project",
            "No manifest.json found. Run 'localapp init' first.".to_string(),
            Some("Run this command from an initialized application directory"),
        );
        write_report(&report, json_output);
        return Err(error);
    }
    let cwd = std::env::current_dir().map_err(|error| format!("Failed to get cwd: {error}"))?;
    let target = resolve_project_target(profile, &cwd)?;
    match execute_with_target(identity, &target).await {
        Ok(report) => {
            write_report(&report, json_output);
            Ok(())
        }
        Err((report, error)) => {
            write_report(&report, json_output);
            Err(error)
        }
    }
}

pub(crate) async fn execute_with_target(
    identity: &str,
    target: &ResolvedTarget,
) -> Result<VerificationReport, (VerificationReport, String)> {
    let mut report = empty_report(identity);

    let cwd = std::env::current_dir().map_err(|error| {
        failed(
            &mut report,
            "project",
            format!("Failed to get cwd: {error}"),
            None,
        )
    })?;
    let manifest = Manifest::read(&cwd).ok_or_else(|| {
        failed(
            &mut report,
            "project",
            "No manifest.json found. Run 'localapp init' first.".to_string(),
            Some("Run this command from an initialized application directory"),
        )
    })?;
    if manifest.name.is_empty() {
        return Err(failed(
            &mut report,
            "project",
            "manifest.json does not contain an application name".to_string(),
            Some("Set manifest.name before verification"),
        ));
    }
    report.app = Some(manifest.name.clone());
    report
        .checks
        .push(passed("project", "Application manifest resolved"));

    let config = target.as_config();
    let client = Client::new(&config);
    let (page_status, page_body) = client
        .get(&format!("/api/pages/{}", manifest.name))
        .await
        .map_err(|error| failed(&mut report, "session", error, None))?;
    if page_status != 200 {
        let error = api_error(&page_body, "Failed to resolve deployed application");
        return Err(failed(&mut report, "session", error, None));
    }
    let owner = required_string(&page_body, "/data/userId")
        .map_err(|error| failed(&mut report, "session", error, None))?;
    let version = page_body
        .pointer("/data/currentVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if version == 0 {
        return Err(failed(
            &mut report,
            "session",
            "Application has no deployed version to verify".to_string(),
            Some("Run localapp app install first"),
        ));
    }
    report.owner = Some(owner.clone());
    report.version = Some(version);

    let smoke = create_session(&client, &owner, &manifest.name, version, identity)
        .await
        .map_err(|error| failed(&mut report, "session", error, None))?;
    report
        .checks
        .push(passed("session", "Isolated smoke session created"));

    let (smoke_checks, smoke_cookie) = run_smoke(&config, &owner, &manifest.name, &smoke).await;
    let smoke_success = smoke_checks.iter().all(|check| check.status == "passed");
    report.checks.extend(smoke_checks.clone());
    let _ = submit_smoke_report(
        &config,
        &owner,
        &manifest.name,
        &smoke_cookie,
        smoke_success,
        &smoke_checks,
    )
    .await;
    if !smoke_success {
        return Err((
            report,
            "Production-path smoke verification failed".to_string(),
        ));
    }

    let browser = create_session(&client, &owner, &manifest.name, version, identity)
        .await
        .map_err(|error| failed(&mut report, "browser", error, None))?;
    report.browser_url = Some(browser.open_url);
    report.browser_session_id = Some(browser.id);
    report.pending_browser_checks = vec![
        "dom".to_string(),
        "console".to_string(),
        "interaction".to_string(),
        "identity".to_string(),
    ];
    for phase in &report.pending_browser_checks {
        report.checks.push(VerificationCheck {
            phase: phase.clone(),
            status: "pending".to_string(),
            summary: format!("Browser {phase} check requires Agent execution"),
            suggestion: None,
        });
    }
    report.success = true;
    report.status = "pending-browser".to_string();
    Ok(report)
}

fn empty_report(identity: &str) -> VerificationReport {
    VerificationReport {
        schema_version: 1,
        success: false,
        status: "failed".to_string(),
        identity: identity.to_string(),
        owner: None,
        app: None,
        version: None,
        checks: Vec::new(),
        browser_url: None,
        browser_session_id: None,
        pending_browser_checks: Vec::new(),
    }
}

struct OpenedSession {
    id: String,
    open_url: String,
}

async fn create_session(
    client: &Client,
    owner: &str,
    app: &str,
    version: u64,
    identity: &str,
) -> Result<OpenedSession, String> {
    let (status, body) = client
        .post_json(
            "/api/verification/sessions",
            json!({ "owner": owner, "app": app, "version": version, "identity": identity }),
        )
        .await?;
    if status != 201 {
        return Err(api_error(&body, "Failed to create verification session"));
    }
    Ok(OpenedSession {
        id: required_string(&body, "/data/id")?,
        open_url: required_string(&body, "/data/openUrl")?,
    })
}

async fn run_smoke(
    config: &Config,
    owner: &str,
    app: &str,
    session: &OpenedSession,
) -> (Vec<VerificationCheck>, String) {
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("reqwest client should build");
    let open = match http.get(&session.open_url).send().await {
        Ok(response) => response,
        Err(error) => {
            return (
                vec![failed_check(
                    "http",
                    format!("Open token exchange failed: {error}"),
                )],
                String::new(),
            );
        }
    };
    if !open.status().is_redirection() {
        return (
            vec![failed_check(
                "http",
                format!("Open token exchange returned HTTP {}", open.status()),
            )],
            String::new(),
        );
    }
    let cookies = open
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .collect::<Vec<_>>()
        .join("; ");
    let location = open
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let shell_url = if location.starts_with("http") {
        location.to_string()
    } else {
        format!("{}{location}", config.base_url())
    };
    let targets = [
        ("http", "formal Shell", shell_url.clone()),
        (
            "http",
            "app resource entry",
            format!("{}/serve/{owner}/{app}/", config.base_url()),
        ),
        (
            "api",
            "core time API",
            format!("{}/serve/{owner}/{app}/api/time", config.base_url()),
        ),
    ];
    let mut checks = Vec::new();
    for (phase, label, url) in targets {
        match http.get(url).header(COOKIE, &cookies).send().await {
            Ok(response) if response.status().is_success() => checks.push(passed(
                phase,
                format!("{label} returned HTTP {}", response.status()),
            )),
            Ok(response) => checks.push(failed_check(
                phase,
                format!("{label} returned HTTP {}", response.status()),
            )),
            Err(error) => checks.push(failed_check(
                phase,
                format!("{label} request failed: {error}"),
            )),
        }
    }
    match http
        .get(format!("{}/api/me", config.base_url()))
        .header(COOKIE, &cookies)
        .header("Referer", &shell_url)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => match response.json::<Value>().await {
            Ok(body) if body.pointer("/data/id").and_then(Value::as_str).is_some() => {
                checks.push(passed(
                    "identity",
                    "App-scoped verification identity resolved",
                ));
            }
            Ok(_) => checks.push(failed_check(
                "identity",
                "GET /api/me did not return a verification identity",
            )),
            Err(error) => checks.push(failed_check(
                "identity",
                format!("GET /api/me returned invalid JSON: {error}"),
            )),
        },
        Ok(response) => checks.push(failed_check(
            "identity",
            format!("GET /api/me returned HTTP {}", response.status()),
        )),
        Err(error) => checks.push(failed_check(
            "identity",
            format!("GET /api/me request failed: {error}"),
        )),
    }
    (checks, cookies)
}

async fn submit_smoke_report(
    config: &Config,
    owner: &str,
    app: &str,
    cookie: &str,
    success: bool,
    checks: &[VerificationCheck],
) -> Result<(), String> {
    let response = reqwest::Client::new()
        .post(format!(
            "{}/serve/{owner}/{app}/api/_verification/report",
            config.base_url()
        ))
        .header(COOKIE, cookie)
        .json(&json!({
            "status": if success { "passed" } else { "failed" },
            "checks": checks,
        }))
        .send()
        .await
        .map_err(|error| format!("Failed to submit smoke report: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Smoke report endpoint returned HTTP {}",
            response.status()
        ))
    }
}

fn required_string(body: &Value, pointer: &str) -> Result<String, String> {
    body.pointer(pointer)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("Server response is missing {pointer}"))
}

fn api_error(body: &Value, fallback: &str) -> String {
    body.get("error")
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

fn passed(phase: impl Into<String>, summary: impl Into<String>) -> VerificationCheck {
    VerificationCheck {
        phase: phase.into(),
        status: "passed".to_string(),
        summary: summary.into(),
        suggestion: None,
    }
}

fn failed_check(phase: impl Into<String>, summary: impl Into<String>) -> VerificationCheck {
    VerificationCheck {
        phase: phase.into(),
        status: "failed".to_string(),
        summary: summary.into(),
        suggestion: Some("Inspect the deployed version and rerun localapp verify".to_string()),
    }
}

fn failed(
    report: &mut VerificationReport,
    phase: &str,
    error: String,
    suggestion: Option<&str>,
) -> (VerificationReport, String) {
    report.checks.push(VerificationCheck {
        phase: phase.to_string(),
        status: "failed".to_string(),
        summary: error.clone(),
        suggestion: suggestion.map(str::to_string),
    });
    let owned = VerificationReport {
        schema_version: report.schema_version,
        success: false,
        status: "failed".to_string(),
        identity: report.identity.clone(),
        owner: report.owner.clone(),
        app: report.app.clone(),
        version: report.version,
        checks: report.checks.clone(),
        browser_url: report.browser_url.clone(),
        browser_session_id: report.browser_session_id.clone(),
        pending_browser_checks: report.pending_browser_checks.clone(),
    };
    (owned, error)
}

fn write_report(report: &VerificationReport, json_output: bool) {
    if json_output {
        println!(
            "{}",
            serde_json::to_string(report).expect("verification report should serialize")
        );
        return;
    }
    for check in &report.checks {
        let mark = match check.status.as_str() {
            "passed" => "PASS",
            "pending" => "PENDING",
            _ => "FAIL",
        };
        println!("[{mark}] {}: {}", check.phase, check.summary);
    }
    if let Some(url) = &report.browser_url {
        println!("\nBrowser verification URL: {url}");
    }
}
