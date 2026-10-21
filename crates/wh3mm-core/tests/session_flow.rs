use std::fs;
use std::path::{Path, PathBuf};

use wh3mm_core::config::{self, AppConfig, CONFIG_FILE};
use wh3mm_core::error::ErrorCode;
use wh3mm_core::ipc::{Density, UiPreferences};
use wh3mm_core::load_order;
use wh3mm_core::pack::synthetic_pack_bytes;
use wh3mm_core::session::{Session, SessionOptions};
use wh3mm_core::test_support::TempDir;

fn write_pack(path: &Path) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, synthetic_pack_bytes(0, &[], 0)).unwrap();
}

fn game_fixture(dir: &TempDir, names: &[&str]) -> PathBuf {
    let game = dir.path().join("game");
    fs::create_dir_all(game.join("data")).unwrap();
    for name in names {
        write_pack(&game.join("data").join(name));
    }
    game
}

fn options(dir: &TempDir, game: Option<&Path>) -> SessionOptions {
    SessionOptions {
        config_path: dir.path().join(CONFIG_FILE),
        steam_root_candidates: Some(Vec::new()),
        manual_game_path: game.map(Path::to_path_buf),
        log_timings: false,
    }
}

#[test]
fn manual_first_run_imports_used_mods_in_file_order() {
    let dir = TempDir::new("session-import");
    let game = game_fixture(&dir, &["a.pack", "b.pack", "c.pack"]);
    fs::write(
        game.join("used_mods.txt"),
        "mod \"b.pack\";\nmod \"a.pack\";\nmod \"missing.pack\";\n",
    )
    .unwrap();

    let session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = session.snapshot();
    assert_eq!(snapshot.enabled_count, 2);
    let enabled: Vec<&str> = snapshot
        .mods
        .iter()
        .filter(|module| module.is_enabled)
        .map(|module| module.name.as_str())
        .collect();
    assert_eq!(enabled, vec!["b.pack", "a.pack"]);
    assert_eq!(snapshot.load_order.missing_names, vec!["missing.pack"]);
    assert_eq!(
        session.profiles_state().profiles[0].enabled_mod_ids.len(),
        2
    );
}

#[test]
fn toggles_and_reorder_persist_across_reload() {
    let dir = TempDir::new("session-persist");
    let game = game_fixture(&dir, &["a.pack", "b.pack", "c.pack"]);
    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = session.snapshot();
    let id = |name: &str| {
        snapshot
            .mods
            .iter()
            .find(|module| module.name == name)
            .unwrap()
            .id
            .clone()
    };
    let a = id("a.pack");
    let b = id("b.pack");
    let c = id("c.pack");

    session
        .set_mods_enabled(&[a.clone(), b.clone(), c.clone()], true)
        .unwrap();
    session
        .set_mods_enabled(std::slice::from_ref(&b), false)
        .unwrap();
    let ordered = session.set_load_order(&[c.clone(), a.clone()]).unwrap();
    let enabled: Vec<&str> = ordered
        .mods
        .iter()
        .filter(|module| module.is_enabled)
        .map(|module| module.name.as_str())
        .collect();
    assert_eq!(enabled, vec!["c.pack", "a.pack"]);

    let reloaded = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = reloaded.snapshot();
    let enabled: Vec<&str> = snapshot
        .mods
        .iter()
        .filter(|module| module.is_enabled)
        .map(|module| module.name.as_str())
        .collect();
    assert_eq!(enabled, vec!["c.pack", "a.pack"]);
}

#[test]
fn writes_byte_compatible_used_mods_and_backs_up_the_previous_file() {
    let dir = TempDir::new("session-write");
    let game = game_fixture(&dir, &["a.pack", "b.pack"]);
    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = session.snapshot();
    let a = snapshot
        .mods
        .iter()
        .find(|m| m.name == "a.pack")
        .unwrap()
        .id
        .clone();
    let b = snapshot
        .mods
        .iter()
        .find(|m| m.name == "b.pack")
        .unwrap()
        .id
        .clone();

    session
        .set_mods_enabled(&[b.clone(), a.clone()], true)
        .unwrap();
    let report = session.write_load_order(false, false).unwrap();
    assert_eq!(report.written, 2);
    assert_eq!(report.unmanaged_directives, Vec::<String>::new());
    let path = game.join("used_mods.txt");
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "mod \"b.pack\";\nmod \"a.pack\";"
    );

    let reordered = session.set_load_order(&[a.clone(), b.clone()]).unwrap();
    assert!(reordered.enabled_count == 2);
    let second = session.write_load_order(false, false).unwrap();
    assert!(second.backup_path.is_some());
    assert_eq!(
        fs::read_to_string(game.join("used_mods.txt.bak")).unwrap(),
        "mod \"b.pack\";\nmod \"a.pack\";"
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "mod \"a.pack\";\nmod \"b.pack\";"
    );
    assert_eq!(second.unmanaged_directives, Vec::<String>::new());
}

#[test]
fn corrupt_used_mods_refuses_write_and_restore_recovers_the_backup() {
    let dir = TempDir::new("session-corrupt");
    let game = game_fixture(&dir, &["a.pack"]);
    fs::write(game.join("used_mods.txt"), "mod \"unterminated;\n").unwrap();
    fs::write(game.join("used_mods.txt.bak"), "mod \"a.pack\";\n").unwrap();

    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    assert!(session.snapshot().load_order.corrupt);
    let a = session.snapshot().mods[0].id.clone();
    session.set_mods_enabled(&[a], true).unwrap();
    let preview = session.preview_load_order().unwrap();
    assert!(!preview.can_write);
    assert!(preview.blocked_reason.unwrap().contains("corrupt"));
    let error = session.write_load_order(false, false).unwrap_err();
    assert_eq!(error.code, ErrorCode::ConfigCorrupt);

    let restored = session.restore_load_order().unwrap();
    assert!(!restored.corrupt);
    assert_eq!(restored.mod_names, vec!["a.pack"]);
    assert_eq!(
        fs::read_to_string(game.join("used_mods.txt")).unwrap(),
        "mod \"a.pack\";\n"
    );
}

#[test]
fn unreadable_used_mods_keeps_the_session_alive_and_blocks_writes() {
    let dir = TempDir::new("session-unreadable");
    let game = game_fixture(&dir, &["a.pack"]);
    // A directory at the file's path fails `fs::read` on every platform.
    fs::create_dir(game.join("used_mods.txt")).unwrap();

    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = session.snapshot();
    assert_eq!(snapshot.mods.len(), 1);
    assert!(snapshot.load_order.unreadable.is_some());
    assert!(!snapshot.load_order.corrupt);
    assert!(
        session
            .warnings
            .iter()
            .any(|warning| warning.contains("used_mods.txt could not be read")),
        "{:?}",
        session.warnings
    );

    let id = snapshot.mods[0].id.clone();
    session.set_mods_enabled(&[id], true).unwrap();
    let preview = session.preview_load_order().unwrap();
    assert!(!preview.can_write);
    assert!(preview.hard_blocked);
    let error = session.write_load_order(false, false).unwrap_err();
    assert_eq!(error.code, ErrorCode::ConfigCorrupt);
    assert!(game.join("used_mods.txt").is_dir());
}

#[test]
fn profiles_create_switch_duplicate_and_delete() {
    let dir = TempDir::new("session-profiles");
    let game = game_fixture(&dir, &["a.pack", "b.pack"]);
    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = session.snapshot();
    let default_id = snapshot.active_profile_id.clone();
    let a = snapshot
        .mods
        .iter()
        .find(|m| m.name == "a.pack")
        .unwrap()
        .id
        .clone();
    let b = snapshot
        .mods
        .iter()
        .find(|m| m.name == "b.pack")
        .unwrap()
        .id
        .clone();

    session
        .set_mods_enabled(std::slice::from_ref(&a), true)
        .unwrap();
    let campaign = session
        .save_profile(None, "Campaign", vec![b.clone(), a.clone()])
        .unwrap();
    let applied = session.apply_profile(&campaign.id).unwrap();
    assert_eq!(applied.active_profile_id, campaign.id);
    assert_eq!(applied.enabled_count, 2);

    let copy = session
        .duplicate_profile(&campaign.id, "Campaign copy")
        .unwrap();
    assert_eq!(copy.enabled_mod_ids, vec![b, a]);
    let state = session.delete_profile(&copy.id).unwrap();
    assert_eq!(state.profiles.len(), 2);

    let applied = session.apply_profile(&default_id).unwrap();
    assert_eq!(applied.enabled_count, 1);
    session.delete_profile(&default_id).unwrap();
    assert_eq!(session.profiles_state().profiles.len(), 1);
}

#[test]
fn reset_to_defaults_keeps_profiles_and_tags_and_writes_an_empty_order() {
    let dir = TempDir::new("session-reset");
    let game = game_fixture(&dir, &["a.pack", "b.pack"]);
    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = session.snapshot();
    let id = |name: &str| {
        snapshot
            .mods
            .iter()
            .find(|module| module.name == name)
            .unwrap()
            .id
            .clone()
    };
    let a = id("a.pack");
    let b = id("b.pack");

    session
        .set_mods_enabled(&[a.clone(), b.clone()], true)
        .unwrap();
    session
        .save_profile(None, "Campaign", vec![b.clone(), a.clone()])
        .unwrap();
    let tags = session.create_tag("Overhaul", "#C9A227").unwrap();
    session.set_mod_tags(&a, vec![tags[0].id.clone()]).unwrap();
    session
        .update_ui_preferences(UiPreferences {
            density: Density::Compact,
            show_authors: false,
            show_thumbnails: false,
            last_scroll_top: 400,
        })
        .unwrap();
    let written = session.write_load_order(false, false).unwrap();
    assert_eq!(written.written, 2);

    let report = session.reset_to_defaults(true).unwrap();

    assert!(report.load_order_written);
    let snapshot = session.snapshot();
    assert_eq!(snapshot.enabled_count, 0);
    assert_eq!(session.config.ui, UiPreferences::default());
    assert!(session.config.paths.game_path_override.is_none());
    assert_eq!(session.config.profiles.len(), 2);
    let campaign = session
        .config
        .profiles
        .iter()
        .find(|profile| profile.name == "Campaign")
        .unwrap();
    assert_eq!(campaign.enabled_mod_ids, vec![b, a]);
    assert_eq!(session.config.tags, tags);
    assert_eq!(
        session.config.mod_tags.values().next().map(Vec::len),
        Some(1)
    );
    assert!(config::backup_path(&dir.path().join(CONFIG_FILE)).is_file());
    assert!(game.join("used_mods.txt.bak").is_file());
    let order = fs::read_to_string(game.join("used_mods.txt")).unwrap();
    assert!(
        order.trim().is_empty(),
        "expected an empty order, got {order:?}"
    );
    let error = session.reset_to_defaults(false).unwrap_err();
    assert_eq!(error.code, ErrorCode::Validation);
}

#[test]
fn reset_to_defaults_without_a_game_still_persists_the_config() {
    let dir = TempDir::new("session-reset-no-game");
    let mut session = Session::initialize(options(&dir, None)).unwrap();
    session
        .update_ui_preferences(UiPreferences {
            density: Density::Roomy,
            show_authors: false,
            show_thumbnails: false,
            last_scroll_top: 900,
        })
        .unwrap();

    let report = session.reset_to_defaults(true).unwrap();

    assert!(!report.load_order_written);
    assert_eq!(session.config.ui, UiPreferences::default());
    assert!(session.config.paths.game_path_override.is_none());
    let reloaded = config::load_or_create(&dir.path().join(CONFIG_FILE)).unwrap();
    assert_eq!(reloaded.config.ui, UiPreferences::default());
}

#[test]
fn applying_a_profile_restores_the_saved_order_exactly() {
    let dir = TempDir::new("session-profile-order");
    let game = game_fixture(&dir, &["a.pack", "b.pack", "c.pack"]);
    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = session.snapshot();
    let id = |name: &str| {
        snapshot
            .mods
            .iter()
            .find(|module| module.name == name)
            .unwrap()
            .id
            .clone()
    };
    let a = id("a.pack");
    let b = id("b.pack");
    let c = id("c.pack");

    session
        .set_mods_enabled(&[a.clone(), b.clone(), c.clone()], true)
        .unwrap();
    session
        .set_load_order(&[c.clone(), a.clone(), b.clone()])
        .unwrap();
    let profile = session
        .save_profile(None, "Ordered", vec![c.clone(), a.clone(), b.clone()])
        .unwrap();

    session
        .set_load_order(&[b.clone(), c.clone(), a.clone()])
        .unwrap();
    session
        .set_mods_enabled(std::slice::from_ref(&a), false)
        .unwrap();

    let applied = session.apply_profile(&profile.id).unwrap();
    assert_eq!(applied.active_profile_id, profile.id);
    assert_eq!(applied.enabled_count, 3);
    let enabled: Vec<&str> = applied
        .mods
        .iter()
        .filter(|module| module.is_enabled)
        .map(|module| module.name.as_str())
        .collect();
    assert_eq!(enabled, vec!["c.pack", "a.pack", "b.pack"]);
    assert_eq!(
        session.config.active_profile().enabled_mod_ids,
        vec![c, a, b]
    );
}

#[test]
fn no_game_session_returns_typed_error_and_recovers_when_a_path_is_set() {
    let dir = TempDir::new("session-no-game");
    let mut session = Session::initialize(options(&dir, None)).unwrap();
    let error = session.game_location().unwrap_err();
    assert_eq!(error.code, ErrorCode::GameNotFound);
    assert!(session.snapshot().mods.is_empty());
    assert!(!session.snapshot().load_order.present);

    let game = game_fixture(&dir, &["a.pack"]);
    let location = session.set_game_path(Some(game.clone())).unwrap();
    assert_eq!(location.game_path, game.to_string_lossy());
    assert_eq!(session.snapshot().mods.len(), 1);
    assert_eq!(
        session.config.paths.game_path_override.as_deref(),
        Some(game.as_path())
    );
}

#[test]
fn loads_500_mods_toggles_reorders_saves_profile_and_writes_500_lines() {
    let dir = TempDir::new("session-500");
    let game = dir.path().join("game");
    fs::create_dir_all(game.join("data")).unwrap();
    for index in 0..500 {
        write_pack(&game.join("data").join(format!("mod_{index:03}.pack")));
    }
    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let snapshot = session.snapshot();
    assert_eq!(snapshot.mods.len(), 500);

    let ids: Vec<String> = snapshot
        .mods
        .iter()
        .map(|module| module.id.clone())
        .collect();
    let reversed: Vec<String> = ids.iter().rev().cloned().collect();
    session.set_mods_enabled(&ids, true).unwrap();
    let ordered = session.set_load_order(&reversed).unwrap();
    assert_eq!(ordered.enabled_count, 500);
    let names: Vec<&str> = ordered
        .mods
        .iter()
        .filter(|module| module.is_enabled)
        .map(|module| module.name.as_str())
        .collect();
    assert_eq!(names.first().copied(), Some("mod_499.pack"));
    assert_eq!(names.last().copied(), Some("mod_000.pack"));

    let profile = session
        .save_profile(
            None,
            "500 mods",
            ordered
                .mods
                .iter()
                .filter(|m| m.is_enabled)
                .map(|m| m.id.clone())
                .collect(),
        )
        .unwrap();
    assert_eq!(profile.enabled_mod_ids.len(), 500);
    let written = session.write_load_order(false, false).unwrap();
    assert_eq!(written.written, 500);
    let bytes = fs::read(game.join("used_mods.txt")).unwrap();
    assert!(!bytes.ends_with(b"\n"));
    let parsed = load_order::parse_used_mods(&bytes).unwrap();
    assert_eq!(parsed.mod_names.len(), 500);
    assert_eq!(parsed.mod_names[0], "mod_499.pack");
    assert_eq!(parsed.mod_names[499], "mod_000.pack");
}

#[test]
fn corrupt_config_blocks_writes_and_the_app_still_starts() {
    let dir = TempDir::new("session-config-corrupt");
    let game = game_fixture(&dir, &["a.pack"]);
    let config_path = dir.path().join(CONFIG_FILE);
    fs::write(&config_path, b"not json").unwrap();
    fs::write(config::backup_path(&config_path), b"also not json").unwrap();

    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    assert!(session.config_write_blocked);
    assert_eq!(session.snapshot().mods.len(), 1);
    let id = session.snapshot().mods[0].id.clone();
    let error = session.set_mods_enabled(&[id], true).unwrap_err();
    assert_eq!(error.code, ErrorCode::ConfigCorrupt);
    assert_eq!(fs::read(&config_path).unwrap(), b"not json");
}

#[test]
fn ui_preferences_round_trip() {
    let dir = TempDir::new("session-ui");
    let game = game_fixture(&dir, &["a.pack"]);
    let mut session = Session::initialize(options(&dir, Some(&game))).unwrap();
    let mut preferences = session.ui_preferences();
    preferences.density = Density::Compact;
    preferences.show_authors = false;
    preferences.last_scroll_top = 1234;
    session.update_ui_preferences(preferences.clone()).unwrap();

    let reloaded = Session::initialize(options(&dir, Some(&game))).unwrap();
    assert_eq!(reloaded.ui_preferences(), preferences);
}

#[test]
fn fixture_app_config_can_be_seeded_for_other_tools() {
    let dir = TempDir::new("session-seed");
    let game = game_fixture(&dir, &["a.pack"]);
    let config_path = dir.path().join(CONFIG_FILE);
    let mut config = AppConfig::new();
    config.paths.game_path_override = Some(game.clone());
    config::save(&config, &config_path).unwrap();
    let session = Session::initialize(options(&dir, Some(&game))).unwrap();
    assert_eq!(session.snapshot().mods.len(), 1);
    assert_eq!(
        session.config_status,
        wh3mm_core::config::ConfigStatus::Loaded
    );
}
