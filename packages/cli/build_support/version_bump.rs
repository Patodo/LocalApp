use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildKind {
    Debug,
    Release,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionBump {
    pub previous: String,
    pub next: String,
}

pub fn build_kind_from_profile(profile: &str) -> BuildKind {
    if profile == "release" {
        BuildKind::Release
    } else {
        BuildKind::Debug
    }
}

pub fn bump_semver(version: &str, kind: BuildKind) -> Result<String, String> {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 3 {
        return Err(format!("CLI version must be x.y.z, got {version}"));
    }

    let major = parse_numeric_part(parts[0], version, "major")?;
    let minor = parse_numeric_part(parts[1], version, "minor")?;
    let patch = parse_numeric_part(parts[2], version, "patch")?;

    let next = match kind {
        BuildKind::Debug => format!("{major}.{minor}.{}", patch + 1),
        BuildKind::Release => format!("{major}.{}.0", minor + 1),
    };
    Ok(next)
}

pub fn bump_cli_version(
    cargo_toml_path: &Path,
    cargo_lock_path: &Path,
    kind: BuildKind,
) -> Result<VersionBump, String> {
    let cargo_toml = fs::read_to_string(cargo_toml_path)
        .map_err(|e| format!("Failed to read {}: {e}", cargo_toml_path.display()))?;
    let previous = read_manifest_version(&cargo_toml)?;
    let next = bump_semver(&previous, kind)?;
    let updated_toml = replace_manifest_version(&cargo_toml, &previous, &next)?;
    fs::write(cargo_toml_path, updated_toml)
        .map_err(|e| format!("Failed to write {}: {e}", cargo_toml_path.display()))?;

    if cargo_lock_path.exists() {
        let cargo_lock = fs::read_to_string(cargo_lock_path)
            .map_err(|e| format!("Failed to read {}: {e}", cargo_lock_path.display()))?;
        let updated_lock = replace_lock_package_version(&cargo_lock, "localapp", &next)?;
        fs::write(cargo_lock_path, updated_lock)
            .map_err(|e| format!("Failed to write {}: {e}", cargo_lock_path.display()))?;
    }

    Ok(VersionBump { previous, next })
}

pub fn read_manifest_version(content: &str) -> Result<String, String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("version") {
            let rest = rest.trim_start();
            if let Some(value) = rest.strip_prefix('=') {
                return parse_quoted_version(value.trim());
            }
        }
    }
    Err("Unable to read CLI version from Cargo.toml".to_string())
}

fn replace_manifest_version(content: &str, previous: &str, next: &str) -> Result<String, String> {
    let needle = format!("version = \"{previous}\"");
    let replacement = format!("version = \"{next}\"");
    if !content.contains(&needle) {
        return Err(format!(
            "Cargo.toml does not contain expected version {previous}"
        ));
    }
    Ok(content.replacen(&needle, &replacement, 1))
}

fn replace_lock_package_version(
    content: &str,
    package_name: &str,
    next: &str,
) -> Result<String, String> {
    let mut lines: Vec<String> = content.lines().map(ToString::to_string).collect();
    let mut in_package = false;
    let mut found_package = false;
    let mut replaced = false;

    for line in &mut lines {
        let trimmed = line.trim();
        if trimmed == "[[package]]" {
            in_package = true;
            found_package = false;
            continue;
        }
        if in_package && trimmed == format!("name = \"{package_name}\"") {
            found_package = true;
            continue;
        }
        if in_package && found_package && trimmed.starts_with("version = ") {
            *line = format!("version = \"{next}\"");
            replaced = true;
            break;
        }
    }

    if !replaced {
        return Err(format!(
            "Cargo.lock package {package_name} version entry not found"
        ));
    }

    let mut updated = lines.join("\n");
    if content.ends_with('\n') {
        updated.push('\n');
    }
    Ok(updated)
}

fn parse_numeric_part(part: &str, full: &str, label: &str) -> Result<u64, String> {
    part.parse::<u64>()
        .map_err(|_| format!("CLI version {label} part must be numeric, got {full}"))
}

fn parse_quoted_version(value: &str) -> Result<String, String> {
    let Some(rest) = value.strip_prefix('"') else {
        return Err("Cargo.toml version must be quoted".to_string());
    };
    let Some(end) = rest.find('"') else {
        return Err("Cargo.toml version quote is not closed".to_string());
    };
    Ok(rest[..end].to_string())
}
