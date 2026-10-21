//! `used_mods.txt` integration contract using the committed QA fixtures.
//!
//! The unit tests in `load_order.rs` use hand-written strings. These tests feed
//! the exact bytes a user can have on disk (BOM, CRLF, unmanaged directives,
//! corruption) through the public parser/planner/writer and assert that a
//! refusal leaves the original file byte-identical.

use std::fs;
use std::path::{Path, PathBuf};

use wh3mm_core::error::ErrorCode;
use wh3mm_core::load_order::{
    backup_path, parse_used_mods, plan_write, read_file, restore_backup, write_plan, PlannedName,
    USED_MODS_FILE,
};
use wh3mm_core::test_support::TempDir;

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn fixture_bytes(name: &str) -> Vec<u8> {
    fs::read(fixtures_root().join("load_order").join(name))
        .unwrap_or_else(|error| panic!("cannot read load_order/{name}: {error}"))
}

fn names(values: &[&str]) -> Vec<PlannedName> {
    values
        .iter()
        .map(|name| PlannedName {
            id: (*name).to_string(),
            name: (*name).to_string(),
        })
        .collect()
}

fn stage(dir: &TempDir, fixture: &str) -> PathBuf {
    let path = dir.path().join(USED_MODS_FILE);
    fs::write(&path, fixture_bytes(fixture)).expect("stage used_mods fixture");
    path
}

#[test]
fn parses_every_committed_variant_exactly_as_documented() {
    let valid = parse_used_mods(&fixture_bytes("used_mods_valid.txt")).expect("valid");
    assert_eq!(
        valid.mod_names,
        vec![
            "mod_a.pack",
            "mod_b.pack",
            "mod with spaces.pack",
            "mod_ñandú.pack"
        ]
    );
    assert!(valid.unmanaged.is_empty());
    assert!(valid.duplicates.is_empty());
    assert!(!valid.is_corrupt());

    let crlf = parse_used_mods(&fixture_bytes("used_mods_crlf.txt")).expect("crlf");
    assert!(crlf.had_crlf);
    assert_eq!(crlf.mod_names, valid.mod_names);

    let bom = parse_used_mods(&fixture_bytes("used_mods_bom.txt")).expect("bom");
    assert!(bom.had_bom);
    assert_eq!(bom.mod_names, valid.mod_names);

    let empty = parse_used_mods(&fixture_bytes("used_mods_empty.txt")).expect("empty");
    assert!(empty.mod_names.is_empty());
    assert!(!empty.is_corrupt());

    let corrupt = parse_used_mods(&fixture_bytes("used_mods_corrupt.txt")).expect("corrupt");
    assert_eq!(corrupt.mod_names, vec!["ok.pack"]);
    assert_eq!(corrupt.corrupt_lines.len(), 2, "{corrupt:?}");
    assert_eq!(corrupt.unmanaged.len(), 1, "{corrupt:?}");
    assert!(corrupt.is_corrupt());

    let duplicates =
        parse_used_mods(&fixture_bytes("used_mods_duplicates.txt")).expect("duplicates");
    assert_eq!(duplicates.mod_names, vec!["mod_a.pack", "mod_b.pack"]);
    assert_eq!(
        duplicates.duplicates,
        vec!["Mod_A.pack", "MOD_A.PACK", "mod_b.pack"]
    );

    let directives =
        parse_used_mods(&fixture_bytes("used_mods_unknown_directive.txt")).expect("directives");
    assert_eq!(directives.mod_names, vec!["mod_a.pack", "mod_b.pack"]);
    assert_eq!(directives.unmanaged.len(), 2);

    let no_newline =
        parse_used_mods(&fixture_bytes("used_mods_no_final_newline.txt")).expect("no newline");
    assert_eq!(no_newline.mod_names, valid.mod_names);
}

#[test]
fn successful_write_creates_a_byte_exact_backup_and_restore_brings_it_back() {
    let dir = TempDir::new("qa-loadorder-backup");
    let original = fixture_bytes("used_mods_valid.txt");
    let path = stage(&dir, "used_mods_valid.txt");

    let plan = plan_write(&path, &names(&["b.pack", "a.pack"]), &[], false, false).expect("plan");
    assert!(plan.can_write, "{:?}", plan.blocked_reason);
    let backup = write_plan(&plan).expect("write").expect("backup path");

    assert_eq!(backup, backup_path(&path));
    assert_eq!(
        fs::read(&path).expect("target"),
        b"mod \"b.pack\";\nmod \"a.pack\";"
    );
    assert_eq!(fs::read(&backup).expect("backup"), original);

    let restored = restore_backup(&path).expect("restore");
    assert_eq!(restored.parsed.mod_names.len(), 4);
    assert_eq!(fs::read(&path).expect("restored target"), original);
    assert!(
        backup.is_file(),
        "restore must keep the backup for a second attempt"
    );
}

#[test]
fn corrupt_fixture_refuses_writes_and_never_changes_the_file() {
    let dir = TempDir::new("qa-loadorder-corrupt");
    let original = fixture_bytes("used_mods_corrupt.txt");
    let path = stage(&dir, "used_mods_corrupt.txt");

    let file = read_file(&path);
    assert!(file.is_corrupt());
    let plan = plan_write(&path, &names(&["a.pack"]), &[], false, false).expect("plan");
    assert!(!plan.can_write);
    assert!(plan.corrupt);
    assert!(plan.hard_blocked);

    let error = write_plan(&plan).expect_err("corrupt write must be refused");
    assert_eq!(error.code, ErrorCode::ConfigCorrupt);
    assert_eq!(fs::read(&path).expect("unchanged"), original);
}

#[test]
fn corrupt_fixture_recovers_from_a_valid_backup_only_on_request() {
    let dir = TempDir::new("qa-loadorder-restore");
    let corrupt = fixture_bytes("used_mods_corrupt.txt");
    let good = fixture_bytes("used_mods_valid.txt");
    let path = stage(&dir, "used_mods_corrupt.txt");
    fs::write(backup_path(&path), &good).expect("valid backup");

    // Loading alone must not repair anything.
    let file = read_file(&path);
    assert!(file.is_corrupt());
    assert!(file.backup_available);
    assert_eq!(fs::read(&path).expect("untouched"), corrupt);

    let restored = restore_backup(&path).expect("explicit restore");
    assert!(!restored.is_corrupt());
    assert_eq!(restored.parsed.mod_names.len(), 4);
    assert_eq!(fs::read(&path).expect("restored"), good);
}

#[test]
fn corrupt_backup_is_refused_and_leaves_the_target_alone() {
    let dir = TempDir::new("qa-loadorder-corrupt-bak");
    let corrupt = fixture_bytes("used_mods_corrupt.txt");
    let path = stage(&dir, "used_mods_corrupt.txt");
    fs::write(backup_path(&path), &corrupt).expect("corrupt backup");

    let error = restore_backup(&path).expect_err("a corrupt backup is not usable");
    assert_eq!(error.code, ErrorCode::ConfigCorrupt);
    assert_eq!(fs::read(&path).expect("untouched"), corrupt);
}

#[test]
fn unmanaged_directives_require_confirmation_before_they_are_dropped() {
    let dir = TempDir::new("qa-loadorder-unmanaged");
    let original = fixture_bytes("used_mods_unknown_directive.txt");
    let path = stage(&dir, "used_mods_unknown_directive.txt");
    let resolved = names(&["mod_a.pack", "mod_b.pack"]);

    let blocked = plan_write(&path, &resolved, &[], false, false).expect("plan");
    assert!(!blocked.can_write);
    assert!(blocked.requires_unmanaged_confirmation);
    assert_eq!(blocked.unmanaged_directives.len(), 2);
    let error = write_plan(&blocked).expect_err("unconfirmed loss must be refused");
    assert_eq!(error.code, ErrorCode::Validation);
    assert_eq!(fs::read(&path).expect("unchanged"), original);

    let confirmed = plan_write(&path, &resolved, &[], false, true).expect("plan");
    assert!(confirmed.can_write);
    write_plan(&confirmed).expect("confirmed write");
    assert_eq!(
        fs::read(&path).expect("new target"),
        b"mod \"mod_a.pack\";\nmod \"mod_b.pack\";"
    );
    assert_eq!(fs::read(backup_path(&path)).expect("backup"), original);
}

#[test]
fn empty_write_over_existing_mods_requires_explicit_intent() {
    let dir = TempDir::new("qa-loadorder-empty");
    let original = fixture_bytes("used_mods_valid.txt");
    let path = stage(&dir, "used_mods_valid.txt");

    let blocked = plan_write(&path, &[], &[], false, false).expect("plan");
    assert!(!blocked.can_write);
    assert!(blocked.requires_empty_confirmation);
    let error = write_plan(&blocked).expect_err("unconfirmed empty write must be refused");
    assert_eq!(error.code, ErrorCode::Validation);
    assert_eq!(fs::read(&path).expect("unchanged"), original);

    let allowed = plan_write(&path, &[], &[], true, false).expect("plan");
    assert!(allowed.can_write);
    write_plan(&allowed).expect("disable-all write");
    assert_eq!(fs::read(&path).expect("empty target"), b"");
    assert_eq!(fs::read(backup_path(&path)).expect("backup"), original);
}

#[test]
fn unreadable_fixture_path_is_a_typed_block_not_a_panic() {
    let dir = TempDir::new("qa-loadorder-unreadable");
    let path = dir.path().join(USED_MODS_FILE);
    fs::create_dir(&path).expect("directory in place of the file");

    let file = read_file(&path);
    assert!(file.unreadable.is_some());
    let plan = plan_write(&path, &names(&["a.pack"]), &[], false, false).expect("plan");
    assert!(!plan.can_write);
    assert!(plan.hard_blocked);
    assert_eq!(
        write_plan(&plan).expect_err("must refuse").code,
        ErrorCode::ConfigCorrupt
    );
    assert!(
        path.is_dir(),
        "the unreadable path must be left exactly as found"
    );
}
