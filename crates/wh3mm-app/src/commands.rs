use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use wh3mm_core::conflicts::ConflictReport;
use wh3mm_core::error::AppError;
use wh3mm_core::ipc::{
    AppInfo, GameLocation, LoadOrderReadReport, LoadOrderWriteReport, ModListSnapshot, Profile,
    ProfilesState, ResetDefaultsReport, Tag, UiPreferences,
};
use wh3mm_core::launch::{LaunchOptions, LaunchResult};
use wh3mm_core::session::{Session, SessionOptions};
use wh3mm_core::workshop::{SteamActionResult, WorkshopAction, WorkshopItem};

/// Owns the single mutable session. Every filesystem mutation is serialized by
/// this mutex; the command layer adds no business logic of its own.
pub struct Manager {
    session: Mutex<Session>,
}

impl Manager {
    pub fn new(config_dir: PathBuf) -> Result<Self, AppError> {
        let session = Session::initialize(SessionOptions::new(config_dir))?;
        Ok(Self {
            session: Mutex::new(session),
        })
    }

    pub fn from_session(session: Session) -> Self {
        Self {
            session: Mutex::new(session),
        }
    }

    fn with<T>(&self, action: impl FnOnce(&Session) -> T) -> Result<T, AppError> {
        let guard = self
            .session
            .lock()
            .map_err(|_| AppError::internal("The mod-manager state lock was poisoned"))?;
        Ok(action(&guard))
    }

    fn with_mut<T>(
        &self,
        action: impl FnOnce(&mut Session) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut guard = self
            .session
            .lock()
            .map_err(|_| AppError::internal("The mod-manager state lock was poisoned"))?;
        action(&mut guard)
    }

    pub fn detect_game(&self) -> Result<GameLocation, AppError> {
        self.with(|session| session.game_location())?
    }

    pub fn set_game_path(&self, game_path: Option<String>) -> Result<GameLocation, AppError> {
        let path = game_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        self.with_mut(|session| session.set_game_path(path))
    }

    pub fn list_mods(&self) -> Result<ModListSnapshot, AppError> {
        let started = Instant::now();
        let snapshot = self.with(|session| session.snapshot())?;
        if std::env::var_os("WH3MM_TIMINGS").is_some() {
            eprintln!(
                "wh3mm: timing mod_list_snapshot={}ms",
                started.elapsed().as_millis()
            );
        }
        Ok(snapshot)
    }

    pub fn set_mod_enabled(
        &self,
        mod_id: String,
        enabled: bool,
    ) -> Result<ModListSnapshot, AppError> {
        self.with_mut(|session| session.set_mods_enabled(&[mod_id], enabled))
    }

    pub fn set_mods_enabled(
        &self,
        mod_ids: Vec<String>,
        enabled: bool,
    ) -> Result<ModListSnapshot, AppError> {
        self.with_mut(|session| session.set_mods_enabled(&mod_ids, enabled))
    }

    pub fn set_load_order(
        &self,
        ordered_mod_ids: Vec<String>,
    ) -> Result<ModListSnapshot, AppError> {
        self.with_mut(|session| session.set_load_order(&ordered_mod_ids))
    }

    pub fn list_profiles(&self) -> Result<ProfilesState, AppError> {
        self.with(|session| session.profiles_state())
    }

    pub fn save_profile(
        &self,
        profile_id: Option<String>,
        name: String,
        enabled_mod_ids: Vec<String>,
    ) -> Result<Profile, AppError> {
        self.with_mut(|session| session.save_profile(profile_id.as_deref(), &name, enabled_mod_ids))
    }

    pub fn duplicate_profile(&self, profile_id: String, name: String) -> Result<Profile, AppError> {
        self.with_mut(|session| session.duplicate_profile(&profile_id, &name))
    }

    pub fn delete_profile(&self, profile_id: String) -> Result<ProfilesState, AppError> {
        self.with_mut(|session| session.delete_profile(&profile_id))
    }

    pub fn apply_profile(&self, profile_id: String) -> Result<ModListSnapshot, AppError> {
        self.with_mut(|session| session.apply_profile(&profile_id))
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>, AppError> {
        self.with(|session| session.list_tags())
    }

    pub fn create_tag(&self, name: String, color: String) -> Result<Vec<Tag>, AppError> {
        self.with_mut(|session| session.create_tag(&name, &color))
    }

    pub fn delete_tag(&self, tag_id: String) -> Result<Vec<Tag>, AppError> {
        self.with_mut(|session| session.delete_tag(&tag_id))
    }

    pub fn set_mod_tags(
        &self,
        mod_id: String,
        tag_ids: Vec<String>,
    ) -> Result<ModListSnapshot, AppError> {
        self.with_mut(|session| session.set_mod_tags(&mod_id, tag_ids))
    }

    pub fn get_ui_preferences(&self) -> Result<UiPreferences, AppError> {
        self.with(|session| session.ui_preferences())
    }

    pub fn update_ui_preferences(
        &self,
        preferences: UiPreferences,
    ) -> Result<UiPreferences, AppError> {
        self.with_mut(|session| session.update_ui_preferences(preferences))
    }

    pub fn reset_to_defaults(
        &self,
        confirm: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<ResetDefaultsReport, AppError> {
        self.with_mut(|session| session.reset_to_defaults(confirm, confirm_unmanaged_loss))
    }

    pub fn read_load_order(&self) -> Result<LoadOrderReadReport, AppError> {
        self.with_mut(|session| session.read_load_order())
    }

    pub fn preview_load_order(&self) -> Result<LoadOrderWriteReport, AppError> {
        self.with(|session| session.preview_load_order())?
    }

    pub fn write_load_order(
        &self,
        allow_empty: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<LoadOrderWriteReport, AppError> {
        self.with_mut(|session| session.write_load_order(allow_empty, confirm_unmanaged_loss))
    }

    pub fn restore_load_order(&self) -> Result<LoadOrderReadReport, AppError> {
        self.with_mut(|session| session.restore_load_order())
    }

    pub fn get_conflicts(&self) -> Result<ConflictReport, AppError> {
        self.with(|session| session.conflict_report())?
    }

    pub fn list_workshop_items(&self) -> Result<Vec<WorkshopItem>, AppError> {
        self.with(|session| session.workshop_items())?
    }

    pub fn workshop_action(
        &self,
        action: WorkshopAction,
        workshop_id: String,
    ) -> Result<SteamActionResult, AppError> {
        self.with(|session| session.workshop_action(action, &workshop_id))?
    }

    pub fn get_launch_options(&self) -> Result<LaunchOptions, AppError> {
        self.with(|session| session.launch_options())
    }

    pub fn set_launch_options(&self, options: LaunchOptions) -> Result<LaunchOptions, AppError> {
        self.with_mut(|session| session.set_launch_options(options))
    }

    pub fn launch_game(
        &self,
        skip_intro: bool,
        script_logging: bool,
    ) -> Result<LaunchResult, AppError> {
        self.with_mut(|session| {
            session.launch_game(LaunchOptions {
                skip_intro,
                script_logging,
            })
        })
    }
}

/// Returns identity and build information for the running application.
///
/// This is the M0 round-trip proof: the React shell invokes `app_info` and
/// renders the result. On Windows the `tauri::command` attribute turns this
/// into an IPC handler; elsewhere it stays a plain function for tests.
#[cfg_attr(windows, tauri::command)]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "WH3 Mod Manager".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        core_version: wh3mm_core::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Tauri command wrappers. They stay Windows-only so Linux CI can exercise the
/// full core and the Manager methods without linking a WebView.
#[cfg(windows)]
mod tauri_commands {
    use super::*;

    #[tauri::command]
    pub fn detect_game(state: tauri::State<'_, Manager>) -> Result<GameLocation, AppError> {
        state.detect_game()
    }

    #[tauri::command]
    pub fn set_game_path(
        state: tauri::State<'_, Manager>,
        game_path: Option<String>,
    ) -> Result<GameLocation, AppError> {
        state.set_game_path(game_path)
    }

    #[tauri::command]
    pub fn list_mods(state: tauri::State<'_, Manager>) -> Result<ModListSnapshot, AppError> {
        state.list_mods()
    }

    #[tauri::command]
    pub fn set_mod_enabled(
        state: tauri::State<'_, Manager>,
        mod_id: String,
        enabled: bool,
    ) -> Result<ModListSnapshot, AppError> {
        state.set_mod_enabled(mod_id, enabled)
    }

    #[tauri::command]
    pub fn set_mods_enabled(
        state: tauri::State<'_, Manager>,
        mod_ids: Vec<String>,
        enabled: bool,
    ) -> Result<ModListSnapshot, AppError> {
        state.set_mods_enabled(mod_ids, enabled)
    }

    #[tauri::command]
    pub fn set_load_order(
        state: tauri::State<'_, Manager>,
        ordered_mod_ids: Vec<String>,
    ) -> Result<ModListSnapshot, AppError> {
        state.set_load_order(ordered_mod_ids)
    }

    #[tauri::command]
    pub fn list_profiles(state: tauri::State<'_, Manager>) -> Result<ProfilesState, AppError> {
        state.list_profiles()
    }

    #[tauri::command]
    pub fn save_profile(
        state: tauri::State<'_, Manager>,
        profile_id: Option<String>,
        name: String,
        enabled_mod_ids: Vec<String>,
    ) -> Result<Profile, AppError> {
        state.save_profile(profile_id, name, enabled_mod_ids)
    }

    #[tauri::command]
    pub fn duplicate_profile(
        state: tauri::State<'_, Manager>,
        profile_id: String,
        name: String,
    ) -> Result<Profile, AppError> {
        state.duplicate_profile(profile_id, name)
    }

    #[tauri::command]
    pub fn delete_profile(
        state: tauri::State<'_, Manager>,
        profile_id: String,
    ) -> Result<ProfilesState, AppError> {
        state.delete_profile(profile_id)
    }

    #[tauri::command]
    pub fn apply_profile(
        state: tauri::State<'_, Manager>,
        profile_id: String,
    ) -> Result<ModListSnapshot, AppError> {
        state.apply_profile(profile_id)
    }

    #[tauri::command]
    pub fn list_tags(state: tauri::State<'_, Manager>) -> Result<Vec<Tag>, AppError> {
        state.list_tags()
    }

    #[tauri::command]
    pub fn create_tag(
        state: tauri::State<'_, Manager>,
        name: String,
        color: String,
    ) -> Result<Vec<Tag>, AppError> {
        state.create_tag(name, color)
    }

    #[tauri::command]
    pub fn delete_tag(
        state: tauri::State<'_, Manager>,
        tag_id: String,
    ) -> Result<Vec<Tag>, AppError> {
        state.delete_tag(tag_id)
    }

    #[tauri::command]
    pub fn set_mod_tags(
        state: tauri::State<'_, Manager>,
        mod_id: String,
        tag_ids: Vec<String>,
    ) -> Result<ModListSnapshot, AppError> {
        state.set_mod_tags(mod_id, tag_ids)
    }

    #[tauri::command]
    pub fn get_ui_preferences(state: tauri::State<'_, Manager>) -> Result<UiPreferences, AppError> {
        state.get_ui_preferences()
    }

    #[tauri::command]
    pub fn update_ui_preferences(
        state: tauri::State<'_, Manager>,
        preferences: UiPreferences,
    ) -> Result<UiPreferences, AppError> {
        state.update_ui_preferences(preferences)
    }

    #[tauri::command]
    pub fn reset_to_defaults(
        state: tauri::State<'_, Manager>,
        confirm: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<ResetDefaultsReport, AppError> {
        state.reset_to_defaults(confirm, confirm_unmanaged_loss)
    }

    #[tauri::command]
    pub fn read_load_order(
        state: tauri::State<'_, Manager>,
    ) -> Result<LoadOrderReadReport, AppError> {
        state.read_load_order()
    }

    #[tauri::command]
    pub fn preview_load_order(
        state: tauri::State<'_, Manager>,
    ) -> Result<LoadOrderWriteReport, AppError> {
        state.preview_load_order()
    }

    #[tauri::command]
    pub fn write_load_order(
        state: tauri::State<'_, Manager>,
        allow_empty: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<LoadOrderWriteReport, AppError> {
        state.write_load_order(allow_empty, confirm_unmanaged_loss)
    }

    #[tauri::command]
    pub fn restore_load_order(
        state: tauri::State<'_, Manager>,
    ) -> Result<LoadOrderReadReport, AppError> {
        state.restore_load_order()
    }

    #[tauri::command]
    pub fn get_conflicts(state: tauri::State<'_, Manager>) -> Result<ConflictReport, AppError> {
        state.get_conflicts()
    }

    #[tauri::command]
    pub fn list_workshop_items(
        state: tauri::State<'_, Manager>,
    ) -> Result<Vec<WorkshopItem>, AppError> {
        state.list_workshop_items()
    }

    #[tauri::command]
    pub fn workshop_action(
        state: tauri::State<'_, Manager>,
        action: WorkshopAction,
        workshop_id: String,
    ) -> Result<SteamActionResult, AppError> {
        state.workshop_action(action, workshop_id)
    }

    #[tauri::command]
    pub fn get_launch_options(state: tauri::State<'_, Manager>) -> Result<LaunchOptions, AppError> {
        state.get_launch_options()
    }

    #[tauri::command]
    pub fn set_launch_options(
        state: tauri::State<'_, Manager>,
        options: LaunchOptions,
    ) -> Result<LaunchOptions, AppError> {
        state.set_launch_options(options)
    }

    #[tauri::command]
    pub fn launch_game(
        state: tauri::State<'_, Manager>,
        skip_intro: bool,
        script_logging: bool,
    ) -> Result<LaunchResult, AppError> {
        state.launch_game(skip_intro, script_logging)
    }
}

#[cfg(windows)]
pub use tauri_commands::*;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use wh3mm_core::error::ErrorCode;
    use wh3mm_core::pack::{synthetic_pack_bytes, PFH5_HEADER_LEN};
    use wh3mm_core::test_support::TempDir;

    #[test]
    fn app_info_reports_both_crate_versions() {
        let info = app_info();

        assert_eq!(info.name, "WH3 Mod Manager");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.core_version, wh3mm_core::VERSION);
        assert!(!info.platform.is_empty());
        assert!(!info.arch.is_empty());
    }

    fn pack_with_file(path: &str) -> Vec<u8> {
        let name = path.as_bytes();
        let body = b"x";
        let mut index = Vec::new();
        index.extend_from_slice(&(body.len() as u32).to_le_bytes());
        index.push(0);
        index.extend_from_slice(name);
        index.push(0);
        let mut bytes = vec![0u8; PFH5_HEADER_LEN];
        bytes[0..4].copy_from_slice(b"PFH5");
        bytes[4..8].copy_from_slice(&3u32.to_le_bytes());
        bytes[16..20].copy_from_slice(&1u32.to_le_bytes());
        bytes[20..24].copy_from_slice(&(index.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&index);
        bytes.extend_from_slice(body);
        bytes
    }

    #[test]
    fn manager_forwards_m3_conflict_workshop_and_launch_commands() {
        let dir = TempDir::new("app-manager-m3");
        let game = dir.path().join("game");
        let data = game.join("data");
        fs::create_dir_all(&data).unwrap();
        for name in ["m3_a.pack", "m3_b.pack", "m3_c.pack"] {
            fs::write(data.join(name), pack_with_file("db\\units_tables\\same")).unwrap();
        }

        let session = Session::initialize(SessionOptions {
            config_path: dir.path().join("config.json"),
            steam_root_candidates: Some(Vec::new()),
            manual_game_path: Some(game),
            log_timings: false,
        })
        .unwrap();
        let manager = Manager::from_session(session);
        let ids: Vec<String> = manager
            .list_mods()
            .unwrap()
            .mods
            .iter()
            .map(|module| module.id.clone())
            .collect();
        manager.set_mods_enabled(ids.clone(), true).unwrap();

        let report = manager.get_conflicts().unwrap();
        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(report.conflicts[0].winner_mod_id, ids[2]);
        assert_eq!(report.conflicts[0].loser_mod_ids.len(), 2);

        let error = manager.list_workshop_items().unwrap_err();
        assert_eq!(error.code, ErrorCode::SteamNotFound);

        let options = manager
            .set_launch_options(wh3mm_core::launch::LaunchOptions {
                skip_intro: true,
                script_logging: true,
            })
            .unwrap();
        assert!(options.skip_intro);
        assert!(manager.get_launch_options().unwrap().script_logging);
    }

    #[test]
    fn manager_forwards_commands_to_the_session() {
        let dir = TempDir::new("app-manager");
        let game = dir.path().join("game");
        fs::create_dir_all(game.join("data")).unwrap();
        fs::write(
            game.join("data").join("a.pack"),
            synthetic_pack_bytes(0, &[], 0),
        )
        .unwrap();

        let session = Session::initialize(SessionOptions {
            config_path: dir.path().join("config.json"),
            steam_root_candidates: Some(Vec::new()),
            manual_game_path: Some(game),
            log_timings: false,
        })
        .unwrap();
        let manager = Manager::from_session(session);

        assert_eq!(manager.list_mods().unwrap().mods.len(), 1);
        let id = manager.list_mods().unwrap().mods[0].id.clone();
        let snapshot = manager.set_mod_enabled(id.clone(), true).unwrap();
        assert_eq!(snapshot.enabled_count, 1);
        assert_eq!(manager.list_profiles().unwrap().profiles.len(), 1);

        let preview = manager.preview_load_order().unwrap();
        assert!(preview.can_write);
        let report = manager.write_load_order(false, false).unwrap();
        assert_eq!(report.written, 1);

        let error = manager
            .set_mods_enabled(vec!["unknown".to_string()], true)
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::NotFound);
    }
}
