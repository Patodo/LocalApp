use localapp_core::{ReleaseAssetIntegrityError, write_verified_release_asset};

#[test]
fn writes_asset_only_after_size_and_sha256_match() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("localapp.download");
    let bytes = b"verified release";
    let digest = "1ce4572138ddacf54f7b7834f96aef9b61cc975676daa26fef2fbdf5c7a2d4bf";

    write_verified_release_asset(&target, bytes, bytes.len() as u64, digest).unwrap();

    assert_eq!(std::fs::read(target).unwrap(), bytes);
}

#[test]
fn size_mismatch_does_not_replace_existing_target() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("localapp.download");
    std::fs::write(&target, b"existing").unwrap();

    let error =
        write_verified_release_asset(&target, b"candidate", 99, &"a".repeat(64)).unwrap_err();

    assert!(matches!(
        error,
        ReleaseAssetIntegrityError::SizeMismatch { .. }
    ));
    assert_eq!(std::fs::read(target).unwrap(), b"existing");
}

#[test]
fn sha256_mismatch_does_not_replace_existing_target() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("localapp.download");
    std::fs::write(&target, b"existing").unwrap();

    let error = write_verified_release_asset(
        &target,
        b"candidate",
        b"candidate".len() as u64,
        &"0".repeat(64),
    )
    .unwrap_err();

    assert!(matches!(error, ReleaseAssetIntegrityError::Sha256Mismatch));
    assert_eq!(std::fs::read(target).unwrap(), b"existing");
}
