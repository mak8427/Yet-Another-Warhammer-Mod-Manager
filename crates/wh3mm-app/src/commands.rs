use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use wh3mm_core::conflicts::ConflictReport;
use wh3mm_core::error::AppError;
use wh3mm_core::ipc::{
    AppInfo, ExportProfileReport, GameLocation, ImportProfileOutcome, LoadOrderReadReport,
    LoadOrderWriteReport, ModListSnapshot, Profile, ProfilesState, ResetDefaultsReport, Tag,
    UiPreferences,
};
use wh3mm_core::launch::{LaunchOptions, LaunchResult};
use wh3mm_core::session::{Session, SessionOptions};
use wh3mm_core::window::WindowGeometry;
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

    pub fn export_profile(
        &self,
        profile_id: String,
        path: String,
    ) -> Result<ExportProfileReport, AppError> {
        let path = PathBuf::from(path);
        self.with(|session| session.export_profile(&profile_id, &path, env!("CARGO_PKG_VERSION")))?
    }

    pub fn import_profile(&self, path: String) -> Result<ImportProfileOutcome, AppError> {
        let path = PathBuf::from(path);
        self.with_mut(|session| session.import_profile(&path))
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

    pub fn window_geometry(&self) -> Option<WindowGeometry> {
        self.with(|session| session.window_geometry())
            .ok()
            .flatten()
    }

    pub fn set_window_geometry(&self, geometry: WindowGeometry) -> Result<(), AppError> {
        self.with_mut(|session| session.set_window_geometry(geometry))
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
        self.with(|session| session.conflict_scan())??.compute()
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
/// renders the result. On desktop targets the `tauri::command` attribute turns
/// this into an IPC handler; elsewhere it stays a plain function for tests.
#[cfg_attr(any(windows, target_os = "linux"), tauri::command)]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Yet Another Warhammer Mod Manager".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        core_version: wh3mm_core::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Runs session work on a blocking thread so no IPC handler occupies the main
/// thread. Tauri executes synchronous commands on the main thread, and every
/// session command can reach the filesystem or wait on the session mutex that a
/// scan or write holds.
///
/// The desktop shell uses Tauri's runtime; tests compile the same seam against
/// Tokio so the off-main-thread contract runs without a Tauri runtime or a
/// display.
#[cfg(any(windows, target_os = "linux", test))]
async fn run_blocking<T, F>(work: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    #[cfg(not(test))]
    let joined = tauri::async_runtime::spawn_blocking(work).await;
    #[cfg(test)]
    let joined = tokio::task::spawn_blocking(work).await;

    joined.map_err(|error| {
        AppError::internal("A background mod-manager task failed").with_details(error.to_string())
    })?
}

/// Tauri command wrappers for the desktop shell. Tests exercise the core and
/// the Manager methods directly, without a Tauri runtime or a WebView.
#[cfg(any(windows, target_os = "linux"))]
mod tauri_commands {
    use super::*;
    use tauri::Manager as _;

    #[tauri::command]
    pub async fn detect_game(app: tauri::AppHandle) -> Result<GameLocation, AppError> {
        run_blocking(move || app.state::<Manager>().detect_game()).await
    }

    #[tauri::command]
    pub async fn set_game_path(
        app: tauri::AppHandle,
        game_path: Option<String>,
    ) -> Result<GameLocation, AppError> {
        run_blocking(move || app.state::<Manager>().set_game_path(game_path)).await
    }

    #[tauri::command]
    pub async fn list_mods(app: tauri::AppHandle) -> Result<ModListSnapshot, AppError> {
        run_blocking(move || app.state::<Manager>().list_mods()).await
    }

    #[tauri::command]
    pub async fn set_mod_enabled(
        app: tauri::AppHandle,
        mod_id: String,
        enabled: bool,
    ) -> Result<ModListSnapshot, AppError> {
        run_blocking(move || app.state::<Manager>().set_mod_enabled(mod_id, enabled)).await
    }

    #[tauri::command]
    pub async fn set_mods_enabled(
        app: tauri::AppHandle,
        mod_ids: Vec<String>,
        enabled: bool,
    ) -> Result<ModListSnapshot, AppError> {
        run_blocking(move || app.state::<Manager>().set_mods_enabled(mod_ids, enabled)).await
    }

    #[tauri::command]
    pub async fn set_load_order(
        app: tauri::AppHandle,
        ordered_mod_ids: Vec<String>,
    ) -> Result<ModListSnapshot, AppError> {
        run_blocking(move || app.state::<Manager>().set_load_order(ordered_mod_ids)).await
    }

    #[tauri::command]
    pub async fn list_profiles(app: tauri::AppHandle) -> Result<ProfilesState, AppError> {
        run_blocking(move || app.state::<Manager>().list_profiles()).await
    }

    #[tauri::command]
    pub async fn save_profile(
        app: tauri::AppHandle,
        profile_id: Option<String>,
        name: String,
        enabled_mod_ids: Vec<String>,
    ) -> Result<Profile, AppError> {
        run_blocking(move || {
            app.state::<Manager>()
                .save_profile(profile_id, name, enabled_mod_ids)
        })
        .await
    }

    #[tauri::command]
    pub async fn duplicate_profile(
        app: tauri::AppHandle,
        profile_id: String,
        name: String,
    ) -> Result<Profile, AppError> {
        run_blocking(move || app.state::<Manager>().duplicate_profile(profile_id, name)).await
    }

    #[tauri::command]
    pub async fn delete_profile(
        app: tauri::AppHandle,
        profile_id: String,
    ) -> Result<ProfilesState, AppError> {
        run_blocking(move || app.state::<Manager>().delete_profile(profile_id)).await
    }

    #[tauri::command]
    pub async fn apply_profile(
        app: tauri::AppHandle,
        profile_id: String,
    ) -> Result<ModListSnapshot, AppError> {
        run_blocking(move || app.state::<Manager>().apply_profile(profile_id)).await
    }

    #[tauri::command]
    pub async fn export_profile(
        app: tauri::AppHandle,
        profile_id: String,
        path: String,
    ) -> Result<ExportProfileReport, AppError> {
        run_blocking(move || app.state::<Manager>().export_profile(profile_id, path)).await
    }

    #[tauri::command]
    pub async fn import_profile(
        app: tauri::AppHandle,
        path: String,
    ) -> Result<ImportProfileOutcome, AppError> {
        run_blocking(move || app.state::<Manager>().import_profile(path)).await
    }

    #[tauri::command]
    pub async fn list_tags(app: tauri::AppHandle) -> Result<Vec<Tag>, AppError> {
        run_blocking(move || app.state::<Manager>().list_tags()).await
    }

    #[tauri::command]
    pub async fn create_tag(
        app: tauri::AppHandle,
        name: String,
        color: String,
    ) -> Result<Vec<Tag>, AppError> {
        run_blocking(move || app.state::<Manager>().create_tag(name, color)).await
    }

    #[tauri::command]
    pub async fn delete_tag(app: tauri::AppHandle, tag_id: String) -> Result<Vec<Tag>, AppError> {
        run_blocking(move || app.state::<Manager>().delete_tag(tag_id)).await
    }

    #[tauri::command]
    pub async fn set_mod_tags(
        app: tauri::AppHandle,
        mod_id: String,
        tag_ids: Vec<String>,
    ) -> Result<ModListSnapshot, AppError> {
        run_blocking(move || app.state::<Manager>().set_mod_tags(mod_id, tag_ids)).await
    }

    #[tauri::command]
    pub async fn get_ui_preferences(app: tauri::AppHandle) -> Result<UiPreferences, AppError> {
        run_blocking(move || app.state::<Manager>().get_ui_preferences()).await
    }

    #[tauri::command]
    pub async fn update_ui_preferences(
        app: tauri::AppHandle,
        window: tauri::WebviewWindow,
        preferences: UiPreferences,
    ) -> Result<UiPreferences, AppError> {
        let saved =
            run_blocking(move || app.state::<Manager>().update_ui_preferences(preferences)).await?;
        crate::window_state::apply_zoom(&window, saved.zoom)?;
        Ok(saved)
    }

    #[tauri::command]
    pub async fn reset_to_defaults(
        app: tauri::AppHandle,
        window: tauri::WebviewWindow,
        confirm: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<ResetDefaultsReport, AppError> {
        let report = run_blocking(move || {
            app.state::<Manager>()
                .reset_to_defaults(confirm, confirm_unmanaged_loss)
        })
        .await?;
        crate::window_state::apply_zoom(&window, wh3mm_core::ipc::ZOOM_DEFAULT)?;
        Ok(report)
    }

    #[tauri::command]
    pub async fn read_load_order(app: tauri::AppHandle) -> Result<LoadOrderReadReport, AppError> {
        run_blocking(move || app.state::<Manager>().read_load_order()).await
    }

    #[tauri::command]
    pub async fn preview_load_order(
        app: tauri::AppHandle,
    ) -> Result<LoadOrderWriteReport, AppError> {
        run_blocking(move || app.state::<Manager>().preview_load_order()).await
    }

    #[tauri::command]
    pub async fn write_load_order(
        app: tauri::AppHandle,
        allow_empty: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<LoadOrderWriteReport, AppError> {
        run_blocking(move || {
            app.state::<Manager>()
                .write_load_order(allow_empty, confirm_unmanaged_loss)
        })
        .await
    }

    #[tauri::command]
    pub async fn restore_load_order(
        app: tauri::AppHandle,
    ) -> Result<LoadOrderReadReport, AppError> {
        run_blocking(move || app.state::<Manager>().restore_load_order()).await
    }

    #[tauri::command]
    pub async fn get_conflicts(app: tauri::AppHandle) -> Result<ConflictReport, AppError> {
        run_blocking(move || app.state::<Manager>().get_conflicts()).await
    }

    #[tauri::command]
    pub async fn list_workshop_items(app: tauri::AppHandle) -> Result<Vec<WorkshopItem>, AppError> {
        run_blocking(move || app.state::<Manager>().list_workshop_items()).await
    }

    #[tauri::command]
    pub async fn workshop_action(
        app: tauri::AppHandle,
        action: WorkshopAction,
        workshop_id: String,
    ) -> Result<SteamActionResult, AppError> {
        run_blocking(move || app.state::<Manager>().workshop_action(action, workshop_id)).await
    }

    #[tauri::command]
    pub async fn get_launch_options(app: tauri::AppHandle) -> Result<LaunchOptions, AppError> {
        run_blocking(move || app.state::<Manager>().get_launch_options()).await
    }

    #[tauri::command]
    pub async fn set_launch_options(
        app: tauri::AppHandle,
        options: LaunchOptions,
    ) -> Result<LaunchOptions, AppError> {
        run_blocking(move || app.state::<Manager>().set_launch_options(options)).await
    }

    #[tauri::command]
    pub async fn launch_game(
        app: tauri::AppHandle,
        skip_intro: bool,
        script_logging: bool,
    ) -> Result<LaunchResult, AppError> {
        run_blocking(move || {
            app.state::<Manager>()
                .launch_game(skip_intro, script_logging)
        })
        .await
    }
}

#[cfg(any(windows, target_os = "linux"))]
pub use tauri_commands::*;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use wh3mm_core::error::ErrorCode;
    use wh3mm_core::pack::{synthetic_pack_bytes, PFH5_HEADER_LEN};
    use wh3mm_core::test_support::TempDir;

    #[test]
    fn app_info_reports_both_crate_versions() {
        let info = app_info();

        assert_eq!(info.name, "Yet Another Warhammer Mod Manager");
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

        let scan = manager
            .with(|session| session.conflict_scan())
            .unwrap()
            .unwrap();
        let reversed: Vec<String> = ids.iter().rev().cloned().collect();
        manager.set_load_order(reversed).unwrap();
        assert_eq!(scan.compute().unwrap().conflicts[0].winner_mod_id, ids[2]);
        assert_eq!(
            manager.get_conflicts().unwrap().conflicts[0].winner_mod_id,
            ids[0]
        );

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

    fn manager_with_one_pack(label: &str) -> Arc<Manager> {
        let dir = TempDir::new(label);
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
        Arc::new(Manager::from_session(session))
    }

    #[test]
    fn command_work_runs_off_the_caller_thread() {
        let manager = manager_with_one_pack("app-command-off-thread");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();

        runtime.block_on(async move {
            let caller = std::thread::current().id();
            let blocking_manager = Arc::clone(&manager);
            let (worker, snapshot) = run_blocking(move || {
                Ok::<_, AppError>((std::thread::current().id(), blocking_manager.list_mods()?))
            })
            .await
            .unwrap();

            assert_ne!(caller, worker, "command work ran on the caller thread");
            assert_eq!(snapshot.mods.len(), 1);
        });
    }

    #[test]
    fn command_work_leaves_the_async_thread_free() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();

        runtime.block_on(async {
            let ticks = Arc::new(AtomicUsize::new(0));
            let ticker = {
                let ticks = Arc::clone(&ticks);
                tokio::spawn(async move {
                    for _ in 0..4 {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                        ticks.fetch_add(1, Ordering::SeqCst);
                    }
                })
            };

            let probe = Arc::clone(&ticks);
            let ticks_while_blocked = run_blocking(move || {
                std::thread::sleep(Duration::from_millis(120));
                Ok::<_, AppError>(probe.load(Ordering::SeqCst))
            })
            .await
            .unwrap();

            assert!(
                ticks_while_blocked >= 2,
                "the async thread was blocked by command work: {ticks_while_blocked} ticks"
            );
            ticker.await.unwrap();
            assert_eq!(ticks.load(Ordering::SeqCst), 4);
        });
    }

    fn manager_for(dir: &TempDir, config: &str, packs: &[&str]) -> Manager {
        let game = dir.path().join("games").join(config);
        fs::create_dir_all(game.join("data")).unwrap();
        for name in packs {
            fs::write(
                game.join("data").join(name),
                synthetic_pack_bytes(0, &[], 0),
            )
            .unwrap();
        }
        let session = Session::initialize(SessionOptions {
            config_path: dir.path().join(format!("{config}.json")),
            steam_root_candidates: Some(Vec::new()),
            manual_game_path: Some(game),
            log_timings: false,
        })
        .unwrap();
        Manager::from_session(session)
    }

    #[test]
    fn manager_round_trips_a_profile_share_file() {
        let dir = TempDir::new("app-profile-share");
        let source = manager_for(&dir, "source", &["a.pack", "b.pack"]);
        let ids: Vec<String> = source
            .list_mods()
            .unwrap()
            .mods
            .iter()
            .map(|module| module.id.clone())
            .collect();
        source.set_mods_enabled(ids.clone(), true).unwrap();
        let profile = source
            .save_profile(None, "Campaign".to_string(), ids)
            .unwrap();
        let file = dir.path().join("campaign.wh3mm-profile.json");
        let path = file.to_string_lossy().into_owned();

        let report = source.export_profile(profile.id, path.clone()).unwrap();
        assert_eq!(report.profile_name, "Campaign");
        assert_eq!(report.exported_mods, 2);
        assert_eq!(report.skipped_mods, 0);

        // One pack missing: no profile is created.
        let target = manager_for(&dir, "target", &["a.pack"]);
        let before = target.list_profiles().unwrap().profiles.len();
        match target.import_profile(path.clone()).unwrap() {
            ImportProfileOutcome::MissingMods {
                total_mods,
                missing,
                ..
            } => {
                assert_eq!(total_mods, 2);
                assert_eq!(missing.len(), 1);
                assert_eq!(missing[0].pack, "b.pack");
            }
            other => panic!("expected missing mods, got {other:?}"),
        }
        assert_eq!(target.list_profiles().unwrap().profiles.len(), before);

        // Install the missing pack, rescan, and import again.
        let refreshed = manager_for(&dir, "target", &["a.pack", "b.pack"]);
        match refreshed.import_profile(path).unwrap() {
            ImportProfileOutcome::Imported {
                profile,
                renamed_from,
                total_mods,
            } => {
                assert_eq!(renamed_from, None);
                assert_eq!(total_mods, 2);
                assert_eq!(profile.enabled_mod_ids.len(), 2);
            }
            other => panic!("expected an imported profile, got {other:?}"),
        }
    }
}
