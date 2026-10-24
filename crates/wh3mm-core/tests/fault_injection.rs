//! Deliberate fault injection at the Rust API boundary.
//!
//! Each test names a failure from `docs/QA_PLAN.md` §5 and asserts three things:
//! the operation returns a typed error (never a panic), the user's original file
//! is byte-identical afterwards, and no temp file is left behind. These are the
//! paths that can destroy a load order, so they are release-blocking.

use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use wh3mm_core::config::{backup_path as config_backup_path, CONFIG_FILE};
use wh3mm_core::error::ErrorCode;
use wh3mm_core::load_order::backup_path as used_mods_backup_path;
use wh3mm_core::session::{Session, SessionOptions};
use wh3mm_core::test_support::TempDir;

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn fixture_bytes(group: &str, name: &str) -> Vec<u8> {
    fs::read(fixtures_root().join(group).join(name))
        .unwrap_or_else(|error| panic!("cannot read {group}/{name}: {error}"))
}

fn options(dir: &TempDir, game: &Path) -> SessionOptions {
    SessionOptions {
        config_path: dir.path().join("config").join(CONFIG_FILE),
        steam_root_candidates: Some(Vec::new()),
        manual_game_path: Some(game.to_path_buf()),
        log_timings: false,
    }
}

fn game_with_packs(dir: &TempDir, packs: &[&str]) -> PathBuf {
    let game = dir.path().join("game");
    let data = game.join("data");
    fs::create_dir_all(&data).expect("data dir");
    for name in packs {
        fs::copy(fixtures_root().join("packs").join(name), data.join(name))
            .unwrap_or_else(|error| panic!("copy {name}: {error}"));
    }
    game
}

fn id_of(session: &Session, name: &str) -> String {
    session
        .snapshot()
        .mods
        .iter()
        .find(|module| module.name == name)
        .unwrap_or_else(|| panic!("{name} was not discovered"))
        .id
        .clone()
}

/// FI-01 — one malformed pack must not abort the scan or panic startup.
#[test]
fn fi01_malformed_pack_does_not_abort_scan() {
    let dir = TempDir::new("qa-fi01");
    let game = game_with_packs(&dir, &["valid_minimal.pack", "malformed_bad_magic.pack"]);

    let result = catch_unwind(AssertUnwindSafe(|| {
        Session::initialize(options(&dir, &game))
    }));
    assert!(result.is_ok(), "a malformed pack must never panic startup");
    let session = result.expect("checked").expect("session stays alive");

    let snapshot = session.snapshot();
    assert_eq!(snapshot.mods.len(), 2);
    let healthy = snapshot
        .mods
        .iter()
        .find(|module| module.name == "valid_minimal.pack")
        .expect("healthy pack");
    let broken = snapshot
        .mods
        .iter()
        .find(|module| module.name == "malformed_bad_magic.pack")
        .expect("broken pack");
    assert!(healthy.pack_error.is_none());
    assert!(broken.pack_error.is_some());
    assert!(
        session
            .index_report
            .problems
            .iter()
            .any(|problem| problem.contains("malformed_bad_magic.pack")),
        "{:?}",
        session.index_report.problems
    );
}

#[cfg(unix)]
fn has_temp_sibling(path: &Path) -> bool {
    let prefix = format!(
        ".{}",
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    fs::read_dir(path.parent().expect("parent"))
        .expect("read parent")
        .flatten()
        .any(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.starts_with(&prefix) && name.contains(".tmp-")
        })
}

/// FI-03 — a locked/read-only directory makes the write fail without touching
/// the existing load order or leaving a temp file.
#[cfg(unix)]
#[test]
fn fi03_read_only_directory_preserves_the_load_order() {
    use std::os::unix::fs::PermissionsExt;

    let dir = TempDir::new("qa-fi03");
    let game = game_with_packs(&dir, &["valid_minimal.pack"]);
    let used_mods = game.join("used_mods.txt");
    let original = fixture_bytes("load_order", "used_mods_valid.txt");
    fs::write(&used_mods, &original).expect("stage used_mods");

    let mut session = Session::initialize(options(&dir, &game)).expect("session");
    let id = id_of(&session, "valid_minimal.pack");
    session.set_mods_enabled(&[id], true).expect("enable");

    let mut perms = fs::metadata(&game).expect("game metadata").permissions();
    let original_mode = perms.mode();
    perms.set_mode(0o555);
    fs::set_permissions(&game, perms).expect("make game dir read-only");

    let result = session.write_load_order(false, false);
    let still_there = fs::read(&used_mods);

    let mut restore = fs::metadata(&game).expect("game metadata").permissions();
    restore.set_mode(original_mode);
    fs::set_permissions(&game, restore).expect("restore permissions");

    let error = result.expect_err("a read-only directory must refuse the write");
    assert_eq!(error.code, ErrorCode::Io, "{error:?}");
    assert_eq!(still_there.expect("file still readable"), original);
    assert!(
        !has_temp_sibling(&used_mods),
        "a failed write must clean its temp file"
    );
}

/// FI-05 — corrupt config and corrupt backup are never overwritten.
#[test]
fn fi05_double_corrupt_config_is_never_overwritten() {
    let dir = TempDir::new("qa-fi05");
    let game = game_with_packs(&dir, &["valid_minimal.pack"]);
    let config_dir = dir.path().join("config");
    fs::create_dir_all(&config_dir).expect("config dir");
    let config_path = config_dir.join(CONFIG_FILE);
    let primary = fixture_bytes("config", "config_corrupt.json");
    let backup = fixture_bytes("config", "config_truncated.json");
    fs::write(&config_path, &primary).expect("primary");
    fs::write(config_backup_path(&config_path), &backup).expect("backup");

    let mut session = Session::initialize(options(&dir, &game)).expect("startup survives");
    assert!(session.config_write_blocked);
    let id = id_of(&session, "valid_minimal.pack");
    let error = session
        .set_mods_enabled(&[id], true)
        .expect_err("writes are blocked");
    assert_eq!(error.code, ErrorCode::ConfigCorrupt);

    assert_eq!(fs::read(&config_path).expect("primary"), primary);
    assert_eq!(
        fs::read(config_backup_path(&config_path)).expect("backup"),
        backup
    );
}

/// FI-06 — a corrupt load order is refused, and recovery happens only when the
/// user explicitly restores the backup.
#[test]
fn fi06_corrupt_load_order_requires_explicit_restore() {
    let dir = TempDir::new("qa-fi06");
    let game = game_with_packs(&dir, &["valid_minimal.pack"]);
    let used_mods = game.join("used_mods.txt");
    let corrupt = fixture_bytes("load_order", "used_mods_corrupt.txt");
    let good = fixture_bytes("load_order", "used_mods_valid.txt");
    fs::write(&used_mods, &corrupt).expect("corrupt file");
    fs::write(used_mods_backup_path(&used_mods), &good).expect("valid backup");

    let mut session = Session::initialize(options(&dir, &game)).expect("session");
    assert!(session.snapshot().load_order.corrupt);
    let id = id_of(&session, "valid_minimal.pack");
    session.set_mods_enabled(&[id], true).expect("enable");

    let preview = session.preview_load_order().expect("preview");
    assert!(!preview.can_write);
    let error = session
        .write_load_order(false, false)
        .expect_err("must refuse");
    assert_eq!(error.code, ErrorCode::ConfigCorrupt);
    assert_eq!(fs::read(&used_mods).expect("untouched"), corrupt);

    let restored = session.restore_load_order().expect("explicit restore");
    assert!(!restored.corrupt);
    assert_eq!(fs::read(&used_mods).expect("restored"), good);
    assert!(used_mods_backup_path(&used_mods).is_file());
}

/// FI-07 — dropping unmanaged directives needs explicit confirmation.
#[test]
fn fi07_unmanaged_loss_requires_confirmation() {
    let dir = TempDir::new("qa-fi07");
    let game = game_with_packs(&dir, &["valid_minimal.pack"]);
    let used_mods = game.join("used_mods.txt");
    // The fixture references mod_a.pack/mod_b.pack; give them to the scan so the
    // write has two resolvable names and one unmanaged directive to drop.
    for name in ["mod_a.pack", "mod_b.pack"] {
        fs::copy(
            fixtures_root().join("packs").join("valid_minimal.pack"),
            game.join("data").join(name),
        )
        .expect("copy named pack");
    }
    let original = fixture_bytes("load_order", "used_mods_unknown_directive.txt");
    fs::write(&used_mods, &original).expect("stage directives");

    let mut session = Session::initialize(options(&dir, &game)).expect("session");
    let preview = session.preview_load_order().expect("preview");
    assert!(!preview.can_write);
    assert_eq!(preview.unmanaged_directives.len(), 2);

    let error = session
        .write_load_order(false, false)
        .expect_err("unconfirmed loss must be refused");
    assert_eq!(error.code, ErrorCode::Validation);
    assert_eq!(fs::read(&used_mods).expect("untouched"), original);

    let report = session
        .write_load_order(false, true)
        .expect("confirmed write");
    assert_eq!(report.written, 2);
    assert_eq!(
        fs::read(&used_mods).expect("new file"),
        b"mod \"mod_a.pack\";\nmod \"mod_b.pack\";"
    );
    assert_eq!(
        fs::read(used_mods_backup_path(&used_mods)).expect("backup"),
        original
    );
}

/// FI-08 — an empty write over a non-empty file requires explicit intent.
#[test]
fn fi08_empty_write_requires_intent() {
    let dir = TempDir::new("qa-fi08");
    let game = game_with_packs(&dir, &["valid_minimal.pack"]);
    let used_mods = game.join("used_mods.txt");
    let original = fixture_bytes("load_order", "used_mods_valid.txt");
    fs::write(&used_mods, &original).expect("stage used_mods");

    let mut session = Session::initialize(options(&dir, &game)).expect("session");
    let id = id_of(&session, "valid_minimal.pack");
    session.set_mods_enabled(&[id], true).expect("enable");
    session
        .set_mods_enabled(&[], false)
        .expect_err("empty selection is rejected");

    // A profile with no enabled IDs is the legitimate disable-all path.
    let profile = session
        .save_profile(None, "Disabled", Vec::new())
        .expect("save empty profile");
    session
        .apply_profile(&profile.id)
        .expect("apply empty profile");
    assert_eq!(session.snapshot().enabled_count, 0);

    let error = session
        .write_load_order(false, false)
        .expect_err("unconfirmed empty write must be refused");
    assert_eq!(error.code, ErrorCode::Validation);
    assert_eq!(fs::read(&used_mods).expect("untouched"), original);

    let report = session
        .write_load_order(true, false)
        .expect("disable-all write");
    assert_eq!(report.written, 0);
    assert_eq!(fs::read(&used_mods).expect("empty file"), b"");
    assert_eq!(
        fs::read(used_mods_backup_path(&used_mods)).expect("backup"),
        original
    );
}

/// FI-10 — a crash-left temp file is ignored and a missing load order with a
/// backup is never restored silently.
#[test]
fn fi10_interrupted_write_is_not_restored_silently() {
    let dir = TempDir::new("qa-fi10");
    let game = game_with_packs(&dir, &["valid_minimal.pack"]);
    let used_mods = game.join("used_mods.txt");
    let good = fixture_bytes("load_order", "used_mods_valid.txt");
    fs::write(used_mods_backup_path(&used_mods), &good).expect("backup");
    // The product's temp name is `.{file}.tmp-{pid}-{counter}` (atomic.rs).
    // `999` stands in for the pid of the process that crashed mid-write.
    let stale_temp = game.join(".used_mods.txt.tmp-999-0");
    let stale_bytes = b"mod \"half-written.pack\";\n";
    fs::write(&stale_temp, stale_bytes).expect("stale temp");

    let mut session = Session::initialize(options(&dir, &game)).expect("session");
    let snapshot = session.snapshot();
    assert!(
        !snapshot.load_order.present,
        "a missing file must stay missing"
    );
    assert!(
        !snapshot
            .load_order
            .mod_names
            .iter()
            .any(|name| name == "half-written.pack"),
        "a crash-left temp must never be read as the load order: {:?}",
        snapshot.load_order.mod_names
    );
    assert!(snapshot.load_order.backup_available);
    assert!(
        !used_mods.exists(),
        "startup must not silently restore the backup"
    );
    assert_eq!(
        fs::read(&stale_temp).expect("stale temp is left alone"),
        stale_bytes.to_vec(),
        "startup must not consume or delete the crash-left temp"
    );

    let restored = session.restore_load_order().expect("explicit restore");
    assert_eq!(restored.mod_names.len(), 4);
    assert_eq!(fs::read(&used_mods).expect("restored"), good);
    assert_eq!(
        fs::read(&stale_temp).expect("stale temp survives an explicit restore"),
        stale_bytes.to_vec(),
        "an explicit restore must not consume or delete the crash-left temp"
    );
}
