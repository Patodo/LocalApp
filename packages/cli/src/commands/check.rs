use crate::client::{Client, collect_files};
use crate::commands::backend_security::{
    SecurityValidationSummary, security_required_for_platform_range,
    validate_backend_security_files,
};
use crate::commands::{db, upload};
use crate::config::{ResolvedTarget, resolve_project_target};
use crate::platform_capabilities::PlatformCapabilities;
use crate::pm;
use crate::project::{Manifest, is_valid_name, validate_manifest_collaboration};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CheckPhase {
    Project,
    Capabilities,
    Migrations,
    Backend,
    Tests,
    Build,
    Dist,
}

pub(crate) const PHASE_ORDER: [CheckPhase; 7] = [
    CheckPhase::Project,
    CheckPhase::Capabilities,
    CheckPhase::Migrations,
    CheckPhase::Backend,
    CheckPhase::Tests,
    CheckPhase::Build,
    CheckPhase::Dist,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DiagnosticSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PhaseStatus {
    NotRun,
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhaseResult {
    pub phase: CheckPhase,
    pub status: PhaseStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Diagnostic {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub phase: CheckPhase,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs_ref: Option<String>,
}

impl Diagnostic {
    pub(crate) fn error(code: &str, phase: CheckPhase, message: impl Into<String>) -> Self {
        Self::new(code, DiagnosticSeverity::Error, phase, message)
    }

    pub(crate) fn warning(code: &str, phase: CheckPhase, message: impl Into<String>) -> Self {
        Self::new(code, DiagnosticSeverity::Warning, phase, message)
    }

    fn new(
        code: &str,
        severity: DiagnosticSeverity,
        phase: CheckPhase,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.to_string(),
            severity,
            phase,
            message: message.into(),
            file: None,
            line: None,
            suggestion: None,
            docs_ref: None,
        }
    }

    pub(crate) fn with_file(mut self, file: &str) -> Self {
        self.file = Some(file.to_string());
        self
    }

    pub(crate) fn with_suggestion(mut self, suggestion: &str) -> Self {
        self.suggestion = Some(suggestion.to_string());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckReport {
    pub schema_version: u64,
    pub success: bool,
    pub input_hash: String,
    pub capability_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_phase: Option<CheckPhase>,
    pub phases: Vec<PhaseResult>,
    pub diagnostics: Vec<Diagnostic>,
}

impl CheckReport {
    pub(crate) fn new(input_hash: String, capability_hash: String) -> Self {
        Self {
            schema_version: 1,
            success: true,
            input_hash,
            capability_hash,
            failed_phase: None,
            phases: PHASE_ORDER
                .iter()
                .copied()
                .map(|phase| PhaseResult {
                    phase,
                    status: PhaseStatus::NotRun,
                })
                .collect(),
            diagnostics: Vec::new(),
        }
    }

    pub(crate) fn push(&mut self, diagnostic: Diagnostic) {
        if diagnostic.severity == DiagnosticSeverity::Error {
            self.success = false;
        }
        self.diagnostics.push(diagnostic);
    }

    pub(crate) fn finish_phase(&mut self, phase: CheckPhase, status: PhaseStatus) {
        if status == PhaseStatus::Failed {
            self.success = false;
            if self.failed_phase.is_none() {
                self.failed_phase = Some(phase);
            }
        }
        if let Some(result) = self.phases.iter_mut().find(|result| result.phase == phase) {
            result.status = status;
        }
    }

    pub(crate) fn success(&self) -> bool {
        self.success
    }

    pub(crate) fn to_json(&self) -> Result<String, String> {
        serde_json::to_string(self)
            .map_err(|error| format!("Failed to serialize check report: {error}"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckCache {
    pub success: bool,
    pub input_hash: String,
    pub server_url: String,
    pub capability_hash: String,
    #[serde(default)]
    pub artifact_path: String,
    #[serde(default)]
    pub artifact_hash: String,
}

impl CheckCache {
    pub(crate) fn successful(input_hash: String, server_url: &str, capability_hash: &str) -> Self {
        Self {
            success: true,
            input_hash,
            server_url: server_url.trim_end_matches('/').to_string(),
            capability_hash: capability_hash.to_string(),
            artifact_path: String::new(),
            artifact_hash: String::new(),
        }
    }

    fn successful_for(
        input_hash: String,
        server_url: &str,
        capability_hash: &str,
        artifact_path: &str,
        artifact_hash: &str,
    ) -> Self {
        let mut cache = Self::successful(input_hash, server_url, capability_hash);
        cache.artifact_path = artifact_path.to_string();
        cache.artifact_hash = artifact_hash.to_string();
        cache
    }

    pub(crate) fn matches(
        &self,
        input_hash: &str,
        server_url: &str,
        capability_hash: &str,
    ) -> bool {
        self.success
            && self.input_hash == input_hash
            && self.server_url == server_url.trim_end_matches('/')
            && self.capability_hash == capability_hash
    }

    fn matches_for(
        &self,
        input_hash: &str,
        server_url: &str,
        capability_hash: &str,
        artifact_path: &str,
        artifact_hash: &str,
    ) -> bool {
        self.matches(input_hash, server_url, capability_hash)
            && self.artifact_path == artifact_path
            && self.artifact_hash == artifact_hash
    }
}

pub async fn run(json: bool, profile: Option<&str>) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|error| format!("Failed to get cwd: {error}"))?;
    if Manifest::read_validated(&cwd).ok().flatten().is_none() {
        let result = execute(&cwd, None, CheckMode::Local).await;
        emit_report(&result.report, json)?;
        return if result.report.success() {
            Ok(())
        } else {
            Err("Project check failed".to_string())
        };
    }
    let target = resolve_project_target(profile, &cwd)?;
    let result = execute(&cwd, None, CheckMode::Remote(&target)).await;
    emit_report(&result.report, json)?;
    if result.report.success() {
        let (artifact_path, artifact_hash) = artifact_cache_state(&cwd, None)?;
        write_cache(
            &cwd,
            &CheckCache::successful_for(
                result.report.input_hash.clone(),
                result.server_url.as_deref().unwrap_or(""),
                &result.report.capability_hash,
                &artifact_path,
                &artifact_hash,
            ),
        )?;
        Ok(())
    } else {
        Err("Project check failed".to_string())
    }
}

pub async fn run_for_upload(
    upload_path: Option<&str>,
    target: &ResolvedTarget,
) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|error| format!("Failed to get cwd: {error}"))?;
    let input_hash = project_input_hash_for(&cwd, upload_path)?;
    let artifact_state = artifact_cache_state(&cwd, upload_path).ok();
    if let Some((server_url, _, capability_hash)) = load_target_capabilities(target).await.ok() {
        if artifact_state
            .as_ref()
            .is_some_and(|(artifact_path, artifact_hash)| {
                read_cache(&cwd).is_some_and(|cache| {
                    cache.matches_for(
                        &input_hash,
                        &server_url,
                        &capability_hash,
                        artifact_path,
                        artifact_hash,
                    )
                })
            })
        {
            eprintln!("  ✓ Reusing successful localapp check result");
            return Ok(());
        }
    }

    let result = execute(&cwd, upload_path, CheckMode::Remote(target)).await;
    if !result.report.success() {
        return Err(result
            .report
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
            .map(|diagnostic| diagnostic.message.clone())
            .unwrap_or_else(|| "Project check failed before upload".to_string()));
    }
    eprintln!("  ✓ localapp check passed");
    let (artifact_path, artifact_hash) = artifact_cache_state(&cwd, upload_path)?;
    write_cache(
        &cwd,
        &CheckCache::successful_for(
            result.report.input_hash.clone(),
            result.server_url.as_deref().unwrap_or(""),
            &result.report.capability_hash,
            &artifact_path,
            &artifact_hash,
        ),
    )?;
    Ok(())
}

pub async fn run_local_for_package(project_dir: &Path) -> Result<(), String> {
    let result = execute(project_dir, None, CheckMode::Local).await;
    if result.report.success() {
        return Ok(());
    }
    Err(result
        .report
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
        .map(|diagnostic| diagnostic.message.clone())
        .unwrap_or_else(|| "Local project check failed".into()))
}

struct CheckExecution {
    report: CheckReport,
    server_url: Option<String>,
}

#[derive(Clone, Copy)]
enum CheckMode<'a> {
    Remote(&'a ResolvedTarget),
    Local,
}

async fn execute(
    project_dir: &Path,
    upload_path: Option<&str>,
    mode: CheckMode<'_>,
) -> CheckExecution {
    let input_hash = project_input_hash_for(project_dir, upload_path).unwrap_or_default();
    let (server_url, capabilities, capability_hash, target_error) = match mode {
        CheckMode::Remote(target) => match load_target_capabilities(target).await {
            Ok(target) => (Some(target.0), target.1, target.2, None),
            Err(error) => (
                Some(target.base_url().to_string()),
                crate::platform_capabilities::embedded_platform_capabilities()
                    .expect("embedded platform capabilities must be valid"),
                "unavailable".to_string(),
                Some(error),
            ),
        },
        CheckMode::Local => {
            let capabilities = crate::platform_capabilities::embedded_platform_capabilities()
                .expect("embedded platform capabilities must be valid");
            let capability_hash = format!(
                "{:x}",
                Sha256::digest(capabilities.platform_version.as_bytes())
            );
            (None, capabilities, capability_hash, None)
        }
    };
    let mut report = CheckReport::new(input_hash, capability_hash);

    let manifest = match Manifest::read_validated(project_dir) {
        Ok(Some(manifest)) => manifest,
        Ok(None) => {
            report.push(
                Diagnostic::error(
                    "PROJECT_MANIFEST_MISSING",
                    CheckPhase::Project,
                    "No manifest.json found",
                )
                .with_file("manifest.json")
                .with_suggestion("Run localapp init in an application project"),
            );
            report.finish_phase(CheckPhase::Project, PhaseStatus::Failed);
            for phase in PHASE_ORDER.iter().copied().skip(1) {
                report.finish_phase(phase, PhaseStatus::Skipped);
            }
            return CheckExecution { report, server_url };
        }
        Err(error) => {
            report.push(
                Diagnostic::error("PROJECT_MANIFEST_INVALID", CheckPhase::Project, error)
                    .with_file("manifest.json")
                    .with_suggestion("Fix the reported manifest field before uploading"),
            );
            report.finish_phase(CheckPhase::Project, PhaseStatus::Failed);
            for phase in PHASE_ORDER.iter().copied().skip(1) {
                report.finish_phase(phase, PhaseStatus::Skipped);
            }
            return CheckExecution { report, server_url };
        }
    };

    let mut project_failed = false;
    if !is_valid_name(&manifest.name) {
        report.push(
            Diagnostic::error(
                "PROJECT_NAME_INVALID",
                CheckPhase::Project,
                "manifest name is invalid",
            )
            .with_file("manifest.json"),
        );
        project_failed = true;
    }
    if let Some(range) = manifest.platform_version.as_deref() {
        match upload::validate_platform_version_range(range) {
            Err(error) => {
                report.push(
                    Diagnostic::error("PLATFORM_VERSION_INVALID", CheckPhase::Project, error)
                        .with_file("manifest.json"),
                );
                project_failed = true;
            }
            Ok(()) if !platform_version_matches_target(range, &capabilities.platform_version) => {
                report.push(
                    Diagnostic::error(
                        "PLATFORM_VERSION_UNSUPPORTED",
                        CheckPhase::Project,
                        format!(
                            "Target platform version {} does not satisfy {range}",
                            capabilities.platform_version
                        ),
                    )
                    .with_file("manifest.json")
                    .with_suggestion(
                        "Update platformVersion or target a compatible LocalApp server",
                    ),
                );
                project_failed = true;
            }
            Ok(()) => {}
        }
    } else {
        report.push(
            Diagnostic::warning(
                "PLATFORM_VERSION_MISSING",
                CheckPhase::Project,
                "manifest.json does not declare platformVersion",
            )
            .with_file("manifest.json")
            .with_suggestion("Set platformVersion to ^1.0"),
        );
    }
    report.finish_phase(
        CheckPhase::Project,
        if project_failed {
            PhaseStatus::Failed
        } else {
            PhaseStatus::Passed
        },
    );

    if let Some(error) = target_error.as_ref() {
        report.push(
            Diagnostic::error(
                "PLATFORM_CAPABILITIES_UNAVAILABLE",
                CheckPhase::Capabilities,
                error,
            )
            .with_suggestion(
                "Run localapp login and verify that the configured server is reachable",
            ),
        );
    }
    let capability_diagnostics = evaluate_capability_requirements(&manifest, &capabilities)
        .into_iter()
        .chain(
            infer_capability_usage(project_dir, &manifest).unwrap_or_else(|error| {
                vec![Diagnostic::error(
                    "CAPABILITY_INFERENCE_FAILED",
                    CheckPhase::Capabilities,
                    error,
                )]
            }),
        );
    let mut capabilities_failed = target_error.is_some();
    for diagnostic in capability_diagnostics {
        capabilities_failed |= diagnostic.severity == DiagnosticSeverity::Error;
        report.push(diagnostic);
    }
    report.finish_phase(
        CheckPhase::Capabilities,
        if capabilities_failed {
            PhaseStatus::Failed
        } else {
            PhaseStatus::Passed
        },
    );

    if project_failed || matches!(mode, CheckMode::Remote(_)) && target_error.is_some() {
        report.finish_phase(CheckPhase::Migrations, PhaseStatus::Skipped);
    } else {
        let migration_result = match mode {
            CheckMode::Remote(target) => db::validate_silent_with_config(&target.as_config()).await,
            CheckMode::Local => db::validate_local_migrations(project_dir),
        };
        match migration_result {
            Ok(()) => report.finish_phase(CheckPhase::Migrations, PhaseStatus::Passed),
            Err(error) => {
                report.push(
                    Diagnostic::error(
                        "MIGRATION_VALIDATION_FAILED",
                        CheckPhase::Migrations,
                        error,
                    )
                    .with_suggestion("Run localapp db validate and fix the reported migration or production snapshot mismatch"),
                );
                report.finish_phase(CheckPhase::Migrations, PhaseStatus::Failed);
            }
        }
    }

    match validate_backend(project_dir, &manifest) {
        Ok(summary) => {
            if summary.legacy_missing > 0 {
                report.push(
                    Diagnostic::warning(
                        "BACKEND_SECURITY_LEGACY_MISSING",
                        CheckPhase::Backend,
                        format!(
                            "{} named SQL entries do not declare security; accepted only as a legacy ^1.0 contract",
                            summary.legacy_missing
                        ),
                    )
                    .with_suggestion(
                        "Run localapp backend scaffold or declare security.mode=custom before adopting platformVersion ^1.1",
                    ),
                );
            }
            if summary.scenario_verified > 0 {
                report.push(Diagnostic::warning(
                    "BACKEND_SECURITY_SCENARIO_VERIFIED",
                    CheckPhase::Backend,
                    format!(
                        "{} custom named SQL entries are scenario-verified, not platform-verified",
                        summary.scenario_verified
                    ),
                ));
            }
            report.finish_phase(CheckPhase::Backend, PhaseStatus::Passed);
        }
        Err(error) => {
            report.push(
                Diagnostic::error("BACKEND_CONTRACT_INVALID", CheckPhase::Backend, error)
                    .with_suggestion(
                        "Run localapp backend scaffold or fix the referenced backend contract file",
                    ),
            );
            report.finish_phase(CheckPhase::Backend, PhaseStatus::Failed);
        }
    }

    match pm::run_test_if_present(project_dir) {
        Ok(true) => report.finish_phase(CheckPhase::Tests, PhaseStatus::Passed),
        Ok(false) => report.finish_phase(CheckPhase::Tests, PhaseStatus::Skipped),
        Err(error) => {
            report.push(Diagnostic::error(
                "APP_TEST_FAILED",
                CheckPhase::Tests,
                error,
            ));
            report.finish_phase(CheckPhase::Tests, PhaseStatus::Failed);
        }
    }

    let build_passed = if upload_path.is_some() {
        report.finish_phase(CheckPhase::Build, PhaseStatus::Skipped);
        true
    } else {
        match pm::check_available().and_then(|_| pm::run_build_if_present(project_dir)) {
            Ok(true) => {
                report.finish_phase(CheckPhase::Build, PhaseStatus::Passed);
                true
            }
            Ok(false) => {
                report.finish_phase(CheckPhase::Build, PhaseStatus::Skipped);
                true
            }
            Err(error) => {
                report.push(
                    Diagnostic::error("BUILD_FAILED", CheckPhase::Build, error)
                        .with_suggestion("Run the application build command and fix all errors"),
                );
                report.finish_phase(CheckPhase::Build, PhaseStatus::Failed);
                false
            }
        }
    };

    if build_passed {
        match validate_dist(project_dir, &manifest, upload_path) {
            Ok(()) => report.finish_phase(CheckPhase::Dist, PhaseStatus::Passed),
            Err(error) => {
                report.push(
                    Diagnostic::error("DIST_INVALID", CheckPhase::Dist, error).with_suggestion(
                        "Ensure the production build emits dist/index.html and referenced assets",
                    ),
                );
                report.finish_phase(CheckPhase::Dist, PhaseStatus::Failed);
            }
        }
    } else {
        report.finish_phase(CheckPhase::Dist, PhaseStatus::Skipped);
    }

    CheckExecution { report, server_url }
}

fn validate_backend(
    project_dir: &Path,
    manifest: &Manifest,
) -> Result<SecurityValidationSummary, String> {
    let files = upload::collect_backend_files_for_manifest(project_dir, manifest)?;
    upload::validate_backend_contract_files(&files)?;
    let mutations = upload::collect_declared_backend_mutations(&files)?;
    validate_manifest_collaboration(manifest.collaboration.as_ref(), &mutations)?;
    validate_backend_security_files(
        &files,
        security_required_for_platform_range(manifest.platform_version.as_deref()),
    )
}

fn validate_dist(
    project_dir: &Path,
    manifest: &Manifest,
    upload_path: Option<&str>,
) -> Result<(), String> {
    let configured = upload_path.unwrap_or(&manifest.dist_dir);
    let configured_path = Path::new(configured);
    let dist = if configured_path.is_absolute() {
        configured_path.to_path_buf()
    } else {
        project_dir.join(configured_path)
    };
    if !dist.is_dir() {
        return Err(format!("Directory not found: {configured}"));
    }
    if collect_files(&dist)?.is_empty() {
        return Err(format!("No files found in: {configured}"));
    }
    if !dist.join("index.html").is_file() {
        return Err(format!("{configured}/index.html is missing"));
    }
    Ok(())
}

async fn load_target_capabilities(
    target: &ResolvedTarget,
) -> Result<(String, PlatformCapabilities, String), String> {
    let config = target.as_config();
    let client = Client::new(&config);
    let (status, body) = client.get("/api/platform/capabilities").await?;
    if status != 200 || body["success"].as_bool() != Some(true) {
        return Err(body["error"]
            .as_str()
            .unwrap_or("Target platform capabilities request failed")
            .to_string());
    }
    let value = body["data"].clone();
    let capabilities: PlatformCapabilities = serde_json::from_value(value.clone())
        .map_err(|error| format!("Target platform returned invalid capabilities: {error}"))?;
    let capability_hash = format!("{:x}", Sha256::digest(value.to_string().as_bytes()));
    Ok((config.base_url().to_string(), capabilities, capability_hash))
}

fn emit_report(report: &CheckReport, json: bool) -> Result<(), String> {
    if json {
        println!("{}", report.to_json()?);
        return Ok(());
    }
    for phase in &report.phases {
        eprintln!("  {:?}: {:?}", phase.phase, phase.status);
    }
    for diagnostic in &report.diagnostics {
        eprintln!(
            "  [{:?}] {}: {}",
            diagnostic.severity, diagnostic.code, diagnostic.message
        );
    }
    eprintln!(
        "  Check {}",
        if report.success() { "passed" } else { "failed" }
    );
    Ok(())
}

fn cache_path(project_dir: &Path) -> PathBuf {
    project_dir.join(".localapp/check-result.json")
}

fn read_cache(project_dir: &Path) -> Option<CheckCache> {
    serde_json::from_str(&fs::read_to_string(cache_path(project_dir)).ok()?).ok()
}

fn write_cache(project_dir: &Path, cache: &CheckCache) -> Result<(), String> {
    let path = cache_path(project_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create check cache directory: {error}"))?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(cache)
            .map_err(|error| format!("Failed to serialize check cache: {error}"))?,
    )
    .map_err(|error| format!("Failed to write check cache: {error}"))
}

pub(crate) fn evaluate_capability_requirements(
    manifest: &Manifest,
    capabilities: &PlatformCapabilities,
) -> Vec<Diagnostic> {
    let Some(requirements) = &manifest.requires else {
        return vec![Diagnostic::warning(
            "REQUIRES_MISSING",
            CheckPhase::Capabilities,
            "manifest.json does not declare requires; capability use cannot be fully verified",
        )
        .with_file("manifest.json")
        .with_suggestion("Add a requires object describing content, backend, identity, and platform primitive needs")];
    };
    let mut diagnostics = Vec::new();

    if let Some(content) = &requirements.content {
        for mime_type in &content.mime_types {
            if !capabilities
                .content
                .types
                .iter()
                .any(|item| item.mime_type == *mime_type)
            {
                diagnostics.push(
                    Diagnostic::error(
                        "CAPABILITY_CONTENT_TYPE_UNSUPPORTED",
                        CheckPhase::Capabilities,
                        format!("Target platform does not support content type {mime_type}"),
                    )
                    .with_file("manifest.json")
                    .with_suggestion("Remove the requirement or target a platform version that supports this MIME type"),
                );
            }
        }
        if content
            .max_bytes
            .is_some_and(|required| required > capabilities.content.upload.max_bytes)
        {
            diagnostics.push(
                Diagnostic::error(
                    "CAPABILITY_CONTENT_SIZE_EXCEEDED",
                    CheckPhase::Capabilities,
                    format!(
                        "Required content size exceeds platform limit of {} bytes",
                        capabilities.content.upload.max_bytes
                    ),
                )
                .with_file("manifest.json")
                .with_suggestion(
                    "Lower requires.content.maxBytes or target a platform with a larger limit",
                ),
            );
        }
        for mime_type in &content.inline_preview {
            if !capabilities
                .content
                .types
                .iter()
                .any(|item| item.mime_type == *mime_type && item.inline_preview)
            {
                diagnostics.push(
                    Diagnostic::error(
                        "CAPABILITY_INLINE_PREVIEW_UNSUPPORTED",
                        CheckPhase::Capabilities,
                        format!("Target platform cannot preview {mime_type} inline"),
                    )
                    .with_file("manifest.json"),
                );
            }
        }
    }

    if let Some(backend) = requirements.backend.as_deref() {
        let supported = match backend {
            "named-sql" => capabilities.backend.named_sql.enabled,
            "hosted-actions" => capabilities.backend.hosted_actions.enabled,
            _ => false,
        };
        if !supported {
            diagnostics.push(
                Diagnostic::error(
                    "CAPABILITY_BACKEND_UNSUPPORTED",
                    CheckPhase::Capabilities,
                    format!("Target platform does not support backend mode {backend}"),
                )
                .with_file("manifest.json")
                .with_suggestion("Use named-sql, transaction mutations, or a platform primitive"),
            );
        }
    }

    for identity in &requirements.identity {
        let supported = match identity.as_str() {
            "currentUser" => capabilities.identity.current_user,
            "pageOwner" => capabilities.identity.page_owner,
            "groups" => capabilities.identity.groups,
            _ => false,
        };
        if !supported {
            diagnostics.push(
                Diagnostic::error(
                    "CAPABILITY_IDENTITY_UNSUPPORTED",
                    CheckPhase::Capabilities,
                    format!("Target platform does not provide identity context {identity}"),
                )
                .with_file("manifest.json"),
            );
        }
    }

    for primitive in &requirements.primitives {
        diagnostics.push(
            Diagnostic::error(
                "CAPABILITY_PRIMITIVE_UNSUPPORTED",
                CheckPhase::Capabilities,
                format!("Target platform does not declare primitive {primitive}"),
            )
            .with_file("manifest.json"),
        );
    }
    diagnostics
}

fn platform_version_matches_target(range: &str, target: &str) -> bool {
    let Some(target) = parse_version(target) else {
        return false;
    };
    let range = range.trim();
    if let Some(base) = range.strip_prefix('^').and_then(parse_version) {
        let upper = if base.0 > 0 {
            (base.0 + 1, 0, 0)
        } else if base.1 > 0 {
            (0, base.1 + 1, 0)
        } else {
            (0, 0, base.2 + 1)
        };
        return target >= base && target < upper;
    }

    let Some(lower_text) = range.strip_prefix(">=") else {
        return false;
    };
    let Some(upper_index) = lower_text.find('<') else {
        return false;
    };
    let Some(lower) = parse_version(lower_text[..upper_index].trim().trim_end_matches(',')) else {
        return false;
    };
    let Some(upper) = parse_version(lower_text[upper_index + 1..].trim()) else {
        return false;
    };
    target >= lower && target < upper
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let mut parts = value.trim().split(['.', '-', '+']);
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

pub(crate) fn infer_capability_usage(
    project_dir: &Path,
    manifest: &Manifest,
) -> Result<Vec<Diagnostic>, String> {
    let mut source = String::new();
    collect_text_files(&project_dir.join("src"), &mut source)?;
    let pdf_used = source.to_ascii_lowercase().contains("application/pdf");
    let pdf_declared = manifest
        .requires
        .as_ref()
        .and_then(|requirements| requirements.content.as_ref())
        .is_some_and(|content| {
            content
                .mime_types
                .iter()
                .any(|item| item == "application/pdf")
                && content
                    .inline_preview
                    .iter()
                    .any(|item| item == "application/pdf")
        });
    if pdf_used && !pdf_declared {
        return Ok(vec![
            Diagnostic::error(
                "REQUIRES_CONTENT_PDF_MISSING",
                CheckPhase::Capabilities,
                "Source uses application/pdf but manifest requires does not declare PDF upload and inline preview",
            )
            .with_file("manifest.json")
            .with_suggestion("Add application/pdf to requires.content.mimeTypes and requires.content.inlinePreview"),
        ]);
    }
    Ok(Vec::new())
}

pub(crate) fn project_input_hash(project_dir: &Path) -> Result<String, String> {
    project_input_hash_for(project_dir, None)
}

fn project_input_hash_for(project_dir: &Path, upload_path: Option<&str>) -> Result<String, String> {
    let mut ignored_paths = Vec::new();
    if let Some(manifest) = Manifest::read(project_dir) {
        ignored_paths.push(resolve_project_path(project_dir, &manifest.dist_dir));
    }
    if let Some(upload_path) = upload_path {
        ignored_paths.push(resolve_project_path(project_dir, upload_path));
    }
    ignored_paths.retain(|path| path != project_dir);

    let mut files = Vec::new();
    collect_input_files(project_dir, &ignored_paths, &mut files)?;
    files.sort();
    let mut hasher = Sha256::new();
    for path in files {
        let relative = path
            .strip_prefix(project_dir)
            .map_err(|error| format!("Failed to hash project input: {error}"))?;
        hasher.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(&path).map_err(|error| {
            format!("Failed to read project input {}: {error}", path.display())
        })?);
        hasher.update([0]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn resolve_project_path(project_dir: &Path, configured: &str) -> PathBuf {
    let path = Path::new(configured);
    if path.is_absolute() {
        path.components().collect()
    } else {
        project_dir.join(path).components().collect()
    }
}

fn artifact_cache_state(
    project_dir: &Path,
    upload_path: Option<&str>,
) -> Result<(String, String), String> {
    let configured = match upload_path {
        Some(path) => path.to_string(),
        None => {
            Manifest::read(project_dir)
                .ok_or("No manifest.json found")?
                .dist_dir
        }
    };
    let path = resolve_project_path(project_dir, &configured);
    let key = path.to_string_lossy().replace('\\', "/");
    Ok((key, artifact_input_hash(&path)?))
}

fn artifact_input_hash(artifact_dir: &Path) -> Result<String, String> {
    let mut files = collect_files(artifact_dir)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let mut hasher = Sha256::new();
    for (path, data) in files {
        hasher.update(path.as_bytes());
        hasher.update([0]);
        hasher.update(data);
        hasher.update([0]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn collect_input_files(
    current: &Path,
    ignored_paths: &[PathBuf],
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(current)
        .map_err(|error| format!("Failed to read {}: {error}", current.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read project input: {error}"))?;
        let path = entry.path();
        if ignored_paths
            .iter()
            .any(|ignored| path.starts_with(ignored))
        {
            continue;
        }
        if path.is_dir() {
            let name = entry.file_name();
            if matches!(
                name.to_str(),
                Some(".git" | ".localapp" | "dist" | "node_modules" | "target")
            ) {
                continue;
            }
            collect_input_files(&path, ignored_paths, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn collect_text_files(dir: &Path, output: &mut String) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in
        fs::read_dir(dir).map_err(|error| format!("Failed to read {}: {error}", dir.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read source: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_text_files(&path, output)?;
        } else if matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("ts" | "tsx" | "js" | "jsx" | "html")
        ) {
            output.push_str(
                &fs::read_to_string(&path).map_err(|error| {
                    format!("Failed to read source {}: {error}", path.display())
                })?,
            );
            output.push('\n');
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        CheckCache, CheckPhase, CheckReport, Diagnostic, DiagnosticSeverity, PHASE_ORDER,
        PhaseStatus, artifact_input_hash, evaluate_capability_requirements, infer_capability_usage,
        platform_version_matches_target, project_input_hash, validate_backend,
    };
    use crate::platform_capabilities::embedded_platform_capabilities;
    use crate::project::Manifest;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn diagnostics_serialize_with_stable_required_fields() {
        let diagnostic = Diagnostic::error(
            "CAPABILITY_CONTENT_TYPE_UNSUPPORTED",
            CheckPhase::Capabilities,
            "application/pdf is unavailable",
        )
        .with_file("manifest.json")
        .with_suggestion("Remove the requirement or upgrade the platform");

        let value = serde_json::to_value(diagnostic).unwrap();
        assert_eq!(value["code"], "CAPABILITY_CONTENT_TYPE_UNSUPPORTED");
        assert_eq!(value["severity"], "error");
        assert_eq!(value["phase"], "capabilities");
        assert_eq!(value["file"], "manifest.json");
        assert!(value["suggestion"].as_str().unwrap().contains("upgrade"));
    }

    #[test]
    fn phases_have_a_fixed_public_order() {
        assert_eq!(
            PHASE_ORDER,
            [
                CheckPhase::Project,
                CheckPhase::Capabilities,
                CheckPhase::Migrations,
                CheckPhase::Backend,
                CheckPhase::Tests,
                CheckPhase::Build,
                CheckPhase::Dist,
            ]
        );
    }

    #[test]
    fn reports_declared_capabilities_that_the_platform_does_not_support() {
        let capabilities = embedded_platform_capabilities().unwrap();
        let manifest: Manifest = serde_json::from_str(
            r#"{
              "name": "demo-app",
              "requires": {
                "content": { "mimeTypes": ["video/mp4"], "maxBytes": 20971520 },
                "backend": "hosted-actions"
              }
            }"#,
        )
        .unwrap();

        let diagnostics = evaluate_capability_requirements(&manifest, &capabilities);
        let codes = diagnostics
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>();
        assert!(codes.contains(&"CAPABILITY_CONTENT_TYPE_UNSUPPORTED"));
        assert!(codes.contains(&"CAPABILITY_CONTENT_SIZE_EXCEEDED"));
        assert!(codes.contains(&"CAPABILITY_BACKEND_UNSUPPORTED"));
    }

    #[test]
    fn platform_version_range_must_include_the_target_version() {
        assert!(platform_version_matches_target("^1.0", "1.4.2"));
        assert!(platform_version_matches_target(">=1.0 <2.0", "1.4.2"));
        assert!(!platform_version_matches_target("^2.0", "1.4.2"));
        assert!(!platform_version_matches_target(">=1.0 <1.4", "1.4.2"));
    }

    #[test]
    fn infers_pdf_usage_and_rejects_a_missing_manifest_declaration() {
        let project = tempdir().unwrap();
        fs::create_dir_all(project.path().join("src")).unwrap();
        fs::write(
            project.path().join("src/upload.tsx"),
            r#"<input type="file" accept="application/pdf" />"#,
        )
        .unwrap();
        let manifest: Manifest = serde_json::from_str(r#"{ "name": "pdf-app" }"#).unwrap();

        let diagnostics = infer_capability_usage(project.path(), &manifest).unwrap();
        assert!(
            diagnostics
                .iter()
                .any(|item| item.code == "REQUIRES_CONTENT_PDF_MISSING")
        );
    }

    #[test]
    fn source_changes_invalidate_a_successful_check_cache() {
        let project = tempdir().unwrap();
        fs::create_dir_all(project.path().join("src")).unwrap();
        fs::write(project.path().join("manifest.json"), r#"{"name":"demo"}"#).unwrap();
        fs::write(
            project.path().join("src/main.tsx"),
            "export const value = 1;",
        )
        .unwrap();
        let first_hash = project_input_hash(project.path()).unwrap();
        let cache = CheckCache::successful(first_hash.clone(), "http://localhost:3000", "cap-v1");

        assert!(cache.matches(&first_hash, "http://localhost:3000", "cap-v1"));
        fs::write(
            project.path().join("src/main.tsx"),
            "export const value = 2;",
        )
        .unwrap();
        let second_hash = project_input_hash(project.path()).unwrap();
        assert_ne!(first_hash, second_hash);
        assert!(!cache.matches(&second_hash, "http://localhost:3000", "cap-v1"));
        assert!(!cache.matches(&first_hash, "http://localhost:3001", "cap-v1"));
        assert!(!cache.matches(&first_hash, "http://localhost:3000", "cap-v2"));
    }

    #[test]
    fn custom_build_output_does_not_invalidate_the_check_cache() {
        let project = tempdir().unwrap();
        fs::create_dir_all(project.path().join("src")).unwrap();
        fs::create_dir_all(project.path().join("build-output")).unwrap();
        fs::write(
            project.path().join("manifest.json"),
            r#"{"name":"demo","distDir":"build-output"}"#,
        )
        .unwrap();
        fs::write(
            project.path().join("src/main.tsx"),
            "export const value = 1;",
        )
        .unwrap();
        fs::write(
            project.path().join("build-output/index.html"),
            "first build",
        )
        .unwrap();
        let first_hash = project_input_hash(project.path()).unwrap();

        fs::write(
            project.path().join("build-output/index.html"),
            "second build",
        )
        .unwrap();
        let second_hash = project_input_hash(project.path()).unwrap();

        assert_eq!(first_hash, second_hash);
    }

    #[test]
    fn artifact_changes_invalidate_an_upload_check_cache() {
        let project = tempdir().unwrap();
        fs::create_dir_all(project.path().join("dist")).unwrap();
        fs::write(project.path().join("dist/index.html"), "first build").unwrap();
        let first_artifact_hash = artifact_input_hash(&project.path().join("dist")).unwrap();
        let cache = CheckCache::successful_for(
            "source-v1".to_string(),
            "http://localhost:3000",
            "cap-v1",
            "dist",
            &first_artifact_hash,
        );

        fs::write(project.path().join("dist/index.html"), "second build").unwrap();
        let second_artifact_hash = artifact_input_hash(&project.path().join("dist")).unwrap();

        assert_ne!(first_artifact_hash, second_artifact_hash);
        assert!(!cache.matches_for(
            "source-v1",
            "http://localhost:3000",
            "cap-v1",
            "dist",
            &second_artifact_hash,
        ));
    }

    #[test]
    fn backend_phase_rejects_hosted_action_sources() {
        let project = tempdir().unwrap();
        fs::create_dir_all(project.path().join("backend/actions")).unwrap();
        fs::write(
            project.path().join("backend/actions/example.ts"),
            "export default async function run() { return {}; }",
        )
        .unwrap();
        let manifest: Manifest =
            serde_json::from_str(r#"{"name":"demo","backend":{"root":"backend"}}"#).unwrap();

        let error = validate_backend(project.path(), &manifest).unwrap_err();
        assert!(error.contains("Hosted actions") || error.contains("disabled"));
    }

    #[test]
    fn warning_diagnostics_do_not_claim_error_severity() {
        let diagnostic =
            Diagnostic::warning("REQUIRES_MISSING", CheckPhase::Capabilities, "missing");
        assert_eq!(diagnostic.severity, DiagnosticSeverity::Warning);
    }

    #[test]
    fn report_is_one_json_document_and_fails_only_on_error_diagnostics() {
        let mut report = CheckReport::new("input-v1".to_string(), "cap-v1".to_string());
        report.finish_phase(CheckPhase::Project, PhaseStatus::Passed);
        report.push(Diagnostic::warning(
            "REQUIRES_MISSING",
            CheckPhase::Capabilities,
            "missing",
        ));
        assert!(report.success());

        report.push(Diagnostic::error(
            "BUILD_FAILED",
            CheckPhase::Build,
            "build failed",
        ));
        report.finish_phase(CheckPhase::Build, PhaseStatus::Failed);
        assert!(!report.success());

        let rendered = report.to_json().unwrap();
        let value: serde_json::Value = serde_json::from_str(&rendered).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["success"], false);
        assert_eq!(value["failedPhase"], "build");
        assert_eq!(rendered.lines().count(), 1);
    }
}
