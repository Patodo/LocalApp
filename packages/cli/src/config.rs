pub use localapp_core::{
    Config, ProfileStore, ResolvedTarget, ServerProfile, TargetSelector, resolve_target,
};
use std::path::Path;

pub fn resolve_project_target(
    profile: Option<&str>,
    project_dir: &Path,
) -> Result<ResolvedTarget, String> {
    resolve_target(TargetSelector {
        profile: profile.map(str::to_string),
        project_default_profile: project_default_profile(project_dir),
    })
}

fn project_default_profile(project_dir: &Path) -> Option<String> {
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(project_dir.join(".localapp/publish.json")).ok()?)
            .ok()?;
    value
        .get("defaultProfile")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}
