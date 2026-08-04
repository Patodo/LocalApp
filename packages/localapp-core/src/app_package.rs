use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::write::SimpleFileOptions;

const PACKAGE_SCHEMA_VERSION: u32 = 1;
const MAX_ENTRY_COUNT: usize = 10_000;
const MAX_ENTRY_SIZE: u64 = 128 * 1024 * 1024;
const MAX_PACKAGE_SIZE: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPackageMetadata {
    pub schema_version: u32,
    pub app_id: String,
    pub version: String,
    pub platform_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPackageSummary {
    pub metadata: AppPackageMetadata,
    pub files: Vec<String>,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPackageInspection {
    pub metadata: AppPackageMetadata,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppPackageValidationError {
    InvalidMetadata(String),
    UnsafePath(String),
    UnsupportedEntry(String),
    MissingFile(String),
    UnexpectedFile(String),
    DuplicateFile(String),
    SizeLimitExceeded(String),
    ChecksumMismatch(String),
    Io(String),
    InvalidArchive(String),
}

impl fmt::Display for AppPackageValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMetadata(message) => {
                write!(formatter, "invalid package metadata: {message}")
            }
            Self::UnsafePath(path) => write!(formatter, "unsafe package path: {path}"),
            Self::UnsupportedEntry(path) => write!(formatter, "unsupported package entry: {path}"),
            Self::MissingFile(path) => write!(formatter, "package file is missing: {path}"),
            Self::UnexpectedFile(path) => write!(formatter, "unexpected package file: {path}"),
            Self::DuplicateFile(path) => write!(formatter, "duplicate package file: {path}"),
            Self::SizeLimitExceeded(message) => {
                write!(formatter, "package size limit exceeded: {message}")
            }
            Self::ChecksumMismatch(path) => write!(formatter, "package checksum mismatch: {path}"),
            Self::Io(message) | Self::InvalidArchive(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for AppPackageValidationError {}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChecksumManifest {
    schema_version: u32,
    files: BTreeMap<String, FileChecksum>,
}

#[derive(Serialize, Deserialize)]
struct FileChecksum {
    sha256: String,
    size: u64,
}

pub fn build_app_package(
    project_root: &Path,
    output: &Path,
    metadata: AppPackageMetadata,
) -> Result<AppPackageSummary, AppPackageValidationError> {
    let files = collect_publishable_files(project_root)?;
    let files = files
        .into_iter()
        .map(|(path, source)| {
            fs::read(source)
                .map(|bytes| (path, bytes))
                .map_err(io_error)
        })
        .collect::<Result<Vec<_>, _>>()?;
    build_app_package_from_files(output, metadata, files)
}

pub fn build_app_package_from_files(
    output: &Path,
    metadata: AppPackageMetadata,
    mut files: Vec<(String, Vec<u8>)>,
) -> Result<AppPackageSummary, AppPackageValidationError> {
    validate_metadata(&metadata)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    for (path, _) in &files {
        validate_publishable_path(path)?;
    }
    for duplicate in files.windows(2) {
        if duplicate[0].0 == duplicate[1].0 {
            return Err(AppPackageValidationError::DuplicateFile(
                duplicate[0].0.clone(),
            ));
        }
    }
    if !files.iter().any(|(path, _)| path == "manifest.json") {
        return Err(AppPackageValidationError::MissingFile(
            "manifest.json".into(),
        ));
    }
    if !files.iter().any(|(path, _)| path == "dist/index.html") {
        return Err(AppPackageValidationError::MissingFile(
            "dist/index.html".into(),
        ));
    }

    let mut checksums = BTreeMap::new();
    for (path, bytes) in &files {
        checksums.insert(
            path.clone(),
            FileChecksum {
                sha256: hex_sha256(bytes),
                size: bytes.len() as u64,
            },
        );
    }
    let checksum_manifest = ChecksumManifest {
        schema_version: PACKAGE_SCHEMA_VERSION,
        files: checksums,
    };
    let metadata_bytes = canonical_json(&metadata)?;
    let checksum_bytes = canonical_json(&checksum_manifest)?;

    let parent = output.parent().ok_or_else(|| {
        AppPackageValidationError::Io("package output has no parent directory".into())
    })?;
    fs::create_dir_all(parent).map_err(io_error)?;
    let temporary = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    {
        let mut archive = zip::ZipWriter::new(temporary.as_file());
        write_archive_file(&mut archive, "package.json", &metadata_bytes)?;
        write_archive_file(&mut archive, "checksums.json", &checksum_bytes)?;
        for (path, bytes) in &files {
            write_archive_file(&mut archive, path, bytes)?;
        }
        archive
            .finish()
            .map_err(|error| AppPackageValidationError::InvalidArchive(error.to_string()))?;
    }
    temporary.as_file().sync_all().map_err(io_error)?;
    temporary
        .persist(output)
        .map_err(|error| io_error(error.error))?;

    let package_bytes = fs::read(output).map_err(io_error)?;
    Ok(AppPackageSummary {
        metadata,
        files: files.into_iter().map(|(path, _)| path).collect(),
        sha256: hex_sha256(&package_bytes),
        size: package_bytes.len() as u64,
    })
}

pub fn inspect_app_package(
    package: &Path,
) -> Result<AppPackageInspection, AppPackageValidationError> {
    let file = fs::File::open(package).map_err(io_error)?;
    if file.metadata().map_err(io_error)?.len() > MAX_PACKAGE_SIZE {
        return Err(AppPackageValidationError::SizeLimitExceeded(format!(
            "archive exceeds {MAX_PACKAGE_SIZE} bytes"
        )));
    }
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| AppPackageValidationError::InvalidArchive(error.to_string()))?;
    if archive.len() > MAX_ENTRY_COUNT {
        return Err(AppPackageValidationError::SizeLimitExceeded(format!(
            "archive contains more than {MAX_ENTRY_COUNT} entries"
        )));
    }

    let mut entries = BTreeMap::<String, Vec<u8>>::new();
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| AppPackageValidationError::InvalidArchive(error.to_string()))?;
        let raw_name = entry.name().to_string();
        validate_archive_path(&raw_name)?;
        if entry.is_dir() {
            continue;
        }
        if !entry.is_file() {
            return Err(AppPackageValidationError::UnsupportedEntry(raw_name));
        }
        if entry.size() > MAX_ENTRY_SIZE {
            return Err(AppPackageValidationError::SizeLimitExceeded(raw_name));
        }
        total_size = total_size.checked_add(entry.size()).ok_or_else(|| {
            AppPackageValidationError::SizeLimitExceeded("uncompressed size overflow".into())
        })?;
        if total_size > MAX_PACKAGE_SIZE {
            return Err(AppPackageValidationError::SizeLimitExceeded(format!(
                "uncompressed content exceeds {MAX_PACKAGE_SIZE} bytes"
            )));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(io_error)?;
        if entries.insert(raw_name.clone(), bytes).is_some() {
            return Err(AppPackageValidationError::DuplicateFile(raw_name));
        }
    }

    let metadata: AppPackageMetadata = parse_required_json(&entries, "package.json")?;
    validate_metadata(&metadata)?;
    let manifest: serde_json::Value = parse_required_json(&entries, "manifest.json")?;
    if manifest.get("name").and_then(serde_json::Value::as_str) != Some(&metadata.app_id) {
        return Err(AppPackageValidationError::InvalidMetadata(
            "manifest name does not match package appId".into(),
        ));
    }
    let checksums: ChecksumManifest = parse_required_json(&entries, "checksums.json")?;
    if checksums.schema_version != PACKAGE_SCHEMA_VERSION {
        return Err(AppPackageValidationError::InvalidMetadata(format!(
            "unsupported checksum schema {}",
            checksums.schema_version
        )));
    }

    let metadata_files = BTreeSet::from(["package.json", "checksums.json"]);
    for path in entries.keys() {
        if !metadata_files.contains(path.as_str()) && !checksums.files.contains_key(path) {
            return Err(AppPackageValidationError::UnexpectedFile(path.clone()));
        }
    }
    for (path, expected) in &checksums.files {
        validate_publishable_path(path)?;
        let bytes = entries
            .get(path)
            .ok_or_else(|| AppPackageValidationError::MissingFile(path.clone()))?;
        if expected.size != bytes.len() as u64 || expected.sha256 != hex_sha256(bytes) {
            return Err(AppPackageValidationError::ChecksumMismatch(path.clone()));
        }
    }

    Ok(AppPackageInspection {
        metadata,
        files: checksums.files.into_keys().collect(),
    })
}

pub fn extract_app_package(
    package: &Path,
    destination: &Path,
) -> Result<AppPackageInspection, AppPackageValidationError> {
    let inspection = inspect_app_package(package)?;
    if destination.exists()
        && fs::read_dir(destination)
            .map_err(io_error)?
            .next()
            .is_some()
    {
        return Err(AppPackageValidationError::Io(
            "package extraction destination must be empty".into(),
        ));
    }
    fs::create_dir_all(destination).map_err(io_error)?;
    let allowed = inspection.files.iter().cloned().collect::<BTreeSet<_>>();
    let file = fs::File::open(package).map_err(io_error)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| AppPackageValidationError::InvalidArchive(error.to_string()))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| AppPackageValidationError::InvalidArchive(error.to_string()))?;
        let entry_name = entry.name().to_string();
        if entry_name == "package.json" || entry_name == "checksums.json" || entry.is_dir() {
            continue;
        }
        if !allowed.contains(&entry_name) {
            return Err(AppPackageValidationError::UnexpectedFile(entry_name));
        }
        validate_archive_path(&entry_name)?;
        let target = destination.join(&entry_name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        let mut output = fs::File::create(&target).map_err(io_error)?;
        std::io::copy(&mut entry, &mut output).map_err(io_error)?;
        output.sync_all().map_err(io_error)?;
    }
    Ok(inspection)
}

fn collect_publishable_files(
    project_root: &Path,
) -> Result<Vec<(String, PathBuf)>, AppPackageValidationError> {
    let mut files = Vec::new();
    collect_file(project_root, Path::new("manifest.json"), &mut files)?;
    collect_tree(project_root, Path::new("dist"), &mut files)?;
    collect_tree(project_root, Path::new("migrations"), &mut files)?;
    collect_tree(project_root, Path::new("backend"), &mut files)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

fn collect_file(
    root: &Path,
    relative: &Path,
    files: &mut Vec<(String, PathBuf)>,
) -> Result<(), AppPackageValidationError> {
    let source = root.join(relative);
    if !source.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(&source).map_err(io_error)?;
    if metadata.file_type().is_symlink() {
        return Err(AppPackageValidationError::UnsupportedEntry(
            relative.to_string_lossy().replace('\\', "/"),
        ));
    }
    if metadata.is_file() {
        let path = relative.to_string_lossy().replace('\\', "/");
        validate_publishable_path(&path)?;
        files.push((path, source));
    }
    Ok(())
}

fn collect_tree(
    root: &Path,
    relative: &Path,
    files: &mut Vec<(String, PathBuf)>,
) -> Result<(), AppPackageValidationError> {
    let directory = root.join(relative);
    if !directory.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(&directory).map_err(io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(AppPackageValidationError::UnsupportedEntry(
            relative.to_string_lossy().replace('\\', "/"),
        ));
    }
    let mut children = fs::read_dir(&directory)
        .map_err(io_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io_error)?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let child_relative = relative.join(child.file_name());
        let child_metadata = fs::symlink_metadata(child.path()).map_err(io_error)?;
        if child_metadata.file_type().is_symlink() {
            return Err(AppPackageValidationError::UnsupportedEntry(
                child_relative.to_string_lossy().replace('\\', "/"),
            ));
        }
        if child_metadata.is_dir() {
            collect_tree(root, &child_relative, files)?;
        } else if child_metadata.is_file() {
            let path = child_relative.to_string_lossy().replace('\\', "/");
            if is_publishable_path(&path) {
                files.push((path, child.path()));
            }
        }
    }
    Ok(())
}

fn is_publishable_path(path: &str) -> bool {
    path == "manifest.json"
        || path.starts_with("dist/")
        || (path.starts_with("migrations/") && path.ends_with(".sql"))
        || (path.starts_with("backend/")
            && path.ends_with(".json")
            && !path.ends_with("/actions.manifest.json")
            && path != "backend/actions.manifest.json")
}

fn validate_publishable_path(path: &str) -> Result<(), AppPackageValidationError> {
    validate_archive_path(path)?;
    if !is_publishable_path(path) {
        return Err(AppPackageValidationError::UnsupportedEntry(path.into()));
    }
    Ok(())
}

fn validate_archive_path(path: &str) -> Result<(), AppPackageValidationError> {
    if path.is_empty() || path.contains('\\') || Path::new(path).is_absolute() {
        return Err(AppPackageValidationError::UnsafePath(path.into()));
    }
    for component in Path::new(path).components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(AppPackageValidationError::UnsafePath(path.into()));
        }
    }
    Ok(())
}

fn validate_metadata(metadata: &AppPackageMetadata) -> Result<(), AppPackageValidationError> {
    if metadata.schema_version != PACKAGE_SCHEMA_VERSION {
        return Err(AppPackageValidationError::InvalidMetadata(format!(
            "unsupported schema version {}",
            metadata.schema_version
        )));
    }
    if !is_valid_app_id(&metadata.app_id) {
        return Err(AppPackageValidationError::InvalidMetadata(
            "invalid app id".into(),
        ));
    }
    if metadata.version.trim().is_empty() || metadata.platform_version.trim().is_empty() {
        return Err(AppPackageValidationError::InvalidMetadata(
            "version and platformVersion are required".into(),
        ));
    }
    Ok(())
}

fn is_valid_app_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=63).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_lowercase)
        && bytes
            .last()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
        && !value.contains("--")
}

fn write_archive_file(
    archive: &mut zip::ZipWriter<&fs::File>,
    path: &str,
    bytes: &[u8],
) -> Result<(), AppPackageValidationError> {
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::default())
        .unix_permissions(0o644);
    archive
        .start_file(path, options)
        .and_then(|_| archive.write_all(bytes).map_err(zip::result::ZipError::Io))
        .map_err(|error| AppPackageValidationError::InvalidArchive(error.to_string()))
}

fn canonical_json(value: &impl Serialize) -> Result<Vec<u8>, AppPackageValidationError> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|error| AppPackageValidationError::InvalidMetadata(error.to_string()))?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn parse_required_json<T: for<'de> Deserialize<'de>>(
    entries: &BTreeMap<String, Vec<u8>>,
    path: &str,
) -> Result<T, AppPackageValidationError> {
    let bytes = entries
        .get(path)
        .ok_or_else(|| AppPackageValidationError::MissingFile(path.into()))?;
    serde_json::from_slice(bytes)
        .map_err(|error| AppPackageValidationError::InvalidMetadata(error.to_string()))
}

fn hex_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn io_error(error: impl fmt::Display) -> AppPackageValidationError {
    AppPackageValidationError::Io(error.to_string())
}
