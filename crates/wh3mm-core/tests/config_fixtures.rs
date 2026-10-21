//! Config schema fixture integration: valid v1, future version, corrupt primary
//! with a valid backup, and the double-corrupt state that must never overwrite
//! either file (ADR-003).

use std::fs;
use std::path::{Path, PathBuf};

use wh3mm_core::config::{backup_path, load_or_create, ConfigStatus, CONFIG_FILE};
use wh3mm_core::test_support::TempDir;

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn fixture_bytes(name: &str) -> Vec<u8> {
    fs::read(fixtures_root().join("config").join(name))
        .unwrap_or_else(|error| panic!("cannot read config/{name}: {error}"))
}

fn stage(dir: &TempDir, fixture: &str) -> PathBuf {
    let path = dir.path().join(CONFIG_FILE);
    fs::write(&path, fixture_bytes(fixture)).expect("stage config fixture");
    path
}

#[test]
fn valid_schema_v1_fixture_loads_without_writes() {
    let dir = TempDir::new("qa-config-valid");
    let original = fixture_bytes("config_valid.json");
    let path = stage(&dir, "config_valid.json");

    let loaded = load_or_create(&path).expect("valid config must load");
    assert_eq!(loaded.status, ConfigStatus::Loaded);
    assert!(!loaded.write_blocked);
    assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
    assert_eq!(loaded.config.schema_version, 1);
    assert_eq!(loaded.config.active_profile().name, "Default");
    assert_eq!(loaded.config.active_profile().enabled_mod_ids.len(), 2);
    assert_eq!(fs::read(&path).expect("untouched"), original);
}

#[test]
fn future_schema_is_refused_and_never_overwritten() {
    let dir = TempDir::new("qa-config-future");
    let original = fixture_bytes("config_future_version.json");
    let path = stage(&dir, "config_future_version.json");

    let loaded = load_or_create(&path).expect("a future schema must not crash startup");
    assert_eq!(loaded.status, ConfigStatus::Corrupt);
    assert!(loaded.write_blocked);
    assert!(
        loaded
            .warnings
            .iter()
            .any(|warning| warning.contains("schema version 2")
                || warning.contains("could not be read")),
        "{:?}",
        loaded.warnings
    );
    assert_eq!(
        fs::read(&path).expect("future config"),
        original,
        "ADR-003: a future schema is never overwritten"
    );
}

// Quarantined: WAR-47 (owner: Karl Franz). A future schema is currently
// overwritten by a stale v1 backup, which violates ADR-003. Un-ignore when the
// fix lands; the issue records the repro and acceptance criteria.
#[test]
#[ignore = "WAR-47: future schema is overwritten by a stale v1 backup (S2)"]
fn future_schema_with_a_stale_backup_must_still_not_overwrite() {
    // ADR-003: "A higher number is not loaded and is never overwritten".
    // A valid v1 backup must not be used to downgrade a v2 file in place.
    let dir = TempDir::new("qa-config-future-bak");
    let original = fixture_bytes("config_future_version.json");
    let path = stage(&dir, "config_future_version.json");
    fs::write(backup_path(&path), fixture_bytes("config_valid.json")).expect("valid backup");

    let loaded = load_or_create(&path).expect("a future schema must not crash startup");
    assert_eq!(fs::read(&path).expect("future config"), original);
    assert_eq!(loaded.status, ConfigStatus::Corrupt);
    assert!(loaded.write_blocked);
}

#[test]
fn corrupt_primary_recovers_from_a_valid_backup_and_says_so() {
    let dir = TempDir::new("qa-config-recover");
    let path = stage(&dir, "config_corrupt.json");
    let valid = fixture_bytes("config_valid.json");
    fs::write(backup_path(&path), &valid).expect("valid backup");

    let loaded = load_or_create(&path).expect("recoverable config must load");
    assert_eq!(loaded.status, ConfigStatus::RecoveredFromBackup);
    assert!(!loaded.write_blocked);
    assert!(
        loaded
            .warnings
            .iter()
            .any(|warning| warning.contains("config.json.bak")),
        "{:?}",
        loaded.warnings
    );
    assert_eq!(loaded.config.active_profile().name, "Default");
    assert_eq!(
        fs::read(&path).expect("repaired config"),
        valid,
        "the repaired config must be the validated backup bytes"
    );
    assert_eq!(fs::read(backup_path(&path)).expect("backup"), valid);
}

#[test]
fn double_corrupt_config_leaves_both_files_untouched() {
    let dir = TempDir::new("qa-config-double-corrupt");
    let path = stage(&dir, "config_corrupt.json");
    let backup_bytes = fixture_bytes("config_truncated.json");
    fs::write(backup_path(&path), &backup_bytes).expect("corrupt backup");

    let loaded = load_or_create(&path).expect("double corrupt must not crash startup");
    assert_eq!(loaded.status, ConfigStatus::Corrupt);
    assert!(loaded.write_blocked);
    assert_eq!(
        fs::read(&path).expect("primary"),
        fixture_bytes("config_corrupt.json")
    );
    assert_eq!(fs::read(backup_path(&path)).expect("backup"), backup_bytes);
}

#[test]
fn malformed_schema_v1_fixture_is_rejected_without_a_rewrite() {
    let dir = TempDir::new("qa-config-unknown");
    let original = fixture_bytes("config_unknown_fields.json");
    let path = stage(&dir, "config_unknown_fields.json");

    let loaded = load_or_create(&path).expect("malformed v1 must not crash startup");
    assert_eq!(loaded.status, ConfigStatus::Corrupt);
    assert!(loaded.write_blocked);
    assert_eq!(fs::read(&path).expect("untouched"), original);
}
