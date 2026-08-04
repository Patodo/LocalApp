use crate::client::Client;
use crate::config::Config;
use crate::project::Manifest;
use serde_json::json;

pub async fn version() -> Result<(), String> {
    let config = Config::load().ok_or("Not configured. Run 'localapp login' first.")?;
    let client = Client::new(&config);
    let (status, body) = client.get("/api/platform/version").await?;
    if status != 200 {
        let error = body["error"].as_str().unwrap_or("Unknown error");
        return Err(error.to_string());
    }

    let platform_version = body["data"]["version"]
        .as_str()
        .ok_or("Invalid platform version response")?;
    let platform_range = Manifest::read(&std::env::current_dir().map_err(|e| e.to_string())?)
        .and_then(|manifest| manifest.platform_version);

    let compatible = platform_range
        .as_deref()
        .map(|range| is_platform_version_compatible(range, platform_version))
        .unwrap_or(true);

    println!(
        "{}",
        json!({
            "platformVersion": platform_version,
            "compatible": compatible,
        })
    );
    Ok(())
}

pub fn is_platform_version_compatible(range: &str, version: &str) -> bool {
    let trimmed = range.trim();
    if trimmed.is_empty() {
        return true;
    }
    if let Some(required_major) = trimmed.strip_prefix('^').and_then(parse_major) {
        return parse_major(version) == Some(required_major);
    }
    if let Some((min, max)) = parse_bounded_major_range(trimmed) {
        return parse_major(version).is_some_and(|major| major >= min && major < max);
    }
    trimmed == version
}

fn parse_major(version: &str) -> Option<u64> {
    version.split('.').next()?.parse().ok()
}

fn parse_bounded_major_range(range: &str) -> Option<(u64, u64)> {
    let mut parts = range.split_whitespace();
    let min = parts.next()?.strip_prefix(">=").and_then(parse_major)?;
    let max = parts.next()?.strip_prefix('<').and_then(parse_major)?;
    if parts.next().is_some() {
        return None;
    }
    Some((min, max))
}

#[cfg(test)]
mod tests {
    use super::is_platform_version_compatible;

    #[test]
    fn caret_range_matches_same_major() {
        assert!(is_platform_version_compatible("^1.0.0", "1.2.3"));
        assert!(!is_platform_version_compatible("^1.0.0", "2.0.0"));
    }

    #[test]
    fn bounded_range_matches_inside_major_window() {
        assert!(is_platform_version_compatible(">=1.0 <2.0", "1.5.0"));
        assert!(!is_platform_version_compatible(">=1.0 <2.0", "2.0.0"));
    }
}
