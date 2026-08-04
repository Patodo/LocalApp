use sha2::{Digest, Sha256};
use std::fmt;
use std::io::Write;
use std::path::Path;

#[derive(Debug)]
pub enum ReleaseAssetIntegrityError {
    InvalidSha256,
    SizeMismatch { expected: u64, actual: u64 },
    Sha256Mismatch,
    Io(String),
}

impl fmt::Display for ReleaseAssetIntegrityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSha256 => formatter.write_str("release asset SHA-256 is invalid"),
            Self::SizeMismatch { expected, actual } => {
                write!(
                    formatter,
                    "release asset size mismatch: expected {expected}, got {actual}"
                )
            }
            Self::Sha256Mismatch => formatter.write_str("release asset SHA-256 mismatch"),
            Self::Io(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ReleaseAssetIntegrityError {}

pub fn write_verified_release_asset(
    target: &Path,
    bytes: &[u8],
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), ReleaseAssetIntegrityError> {
    if expected_sha256.len() != 64 || !expected_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(ReleaseAssetIntegrityError::InvalidSha256);
    }
    let actual_size = bytes.len() as u64;
    if actual_size != expected_size {
        return Err(ReleaseAssetIntegrityError::SizeMismatch {
            expected: expected_size,
            actual: actual_size,
        });
    }
    let actual_sha256 = format!("{:x}", Sha256::digest(bytes));
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256) {
        return Err(ReleaseAssetIntegrityError::Sha256Mismatch);
    }

    let parent = target.parent().ok_or_else(|| {
        ReleaseAssetIntegrityError::Io("release asset target has no parent directory".into())
    })?;
    std::fs::create_dir_all(parent)
        .map_err(|error| ReleaseAssetIntegrityError::Io(error.to_string()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| ReleaseAssetIntegrityError::Io(error.to_string()))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| ReleaseAssetIntegrityError::Io(error.to_string()))?;
    temporary
        .persist(target)
        .map_err(|error| ReleaseAssetIntegrityError::Io(error.error.to_string()))?;
    Ok(())
}
