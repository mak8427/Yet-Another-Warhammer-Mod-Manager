//! WH3 launch options, Steam launch command construction, and the managed
//! start-game tweaks.
//!
//! Skip-intro movies are a data-folder override pack, and script logging is the
//! documented `data/script/enable_console_logging` marker. Both are owned by
//! the manager and removed when the matching option is turned off, so a launch
//! does not leave a hidden override behind.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::atomic::atomic_write;
use crate::config;
use crate::error::{AppError, ErrorCode};
use crate::paths::GameLocation;
use crate::session::Session;

pub const WH3_APP_ID: &str = "1142710";
pub const WH3_PROCESS_NAME: &str = "warhammer3.exe";
pub const MANAGED_SKIP_INTRO_PACK: &str = "wh3mm_skip_intro.pack";
pub const SCRIPT_LOG_MARKER: &str = "enable_console_logging";
pub const SCRIPT_LOG_OWNERSHIP_MARKER: &str = ".wh3mm_enable_console_logging";

const PFH5_HEADER_LEN: usize = 28;
const PACK_BYTE_MASK: u32 = 3;
const INTRO_MOVIES: [&str; 6] = [
    "movies\\epilepsy_warning\\epilepsy_warning_en.ca_vp8",
    "movies\\gam_int.ca_vp8",
    "movies\\startup_movie_01.ca_vp8",
    "movies\\startup_movie_02.ca_vp8",
    "movies\\startup_movie_03.ca_vp8",
    "movies\\startup_movie_04.ca_vp8",
];

/// A valid one-frame CA video used as the skip-intro placeholder. The bytes are
/// the MIT-licensed blank movie from the legacy WH3 Mod Manager; see ADR-006.
const EMPTY_CA_VIDEO: &[u8] = &[
    0x43, 0x41, 0x4d, 0x56, 0x01, 0x00, 0x29, 0x00, 0x56, 0x50, 0x38, 0x30, 0x80, 0x02, 0xe0, 0x01,
    0x55, 0x55, 0x85, 0x42, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x4a, 0x02, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x21, 0x02, 0x00, 0x00, 0x00, 0x50, 0x42, 0x00, 0x9d, 0x01, 0x2a, 0x80,
    0x02, 0xe0, 0x01, 0x00, 0x47, 0x08, 0x85, 0x85, 0x88, 0x85, 0x84, 0x88, 0x02, 0x02, 0x00, 0x06,
    0x16, 0x04, 0xf7, 0x06, 0x81, 0x64, 0x9f, 0x6b, 0xdb, 0x9b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38,
    0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b,
    0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27, 0x38, 0x7b, 0x27,
    0x38, 0x7b, 0x27, 0x37, 0x80, 0xfe, 0xff, 0xab, 0x50, 0x80, 0x29, 0x00, 0x00, 0x00, 0x21, 0x02,
    0x00, 0x00, 0x01,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchOptions {
    pub skip_intro: bool,
    pub script_logging: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMethod {
    Steam,
    Direct,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub launched: bool,
    pub method: LaunchMethod,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchCommand {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub options: LaunchOptions,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppliedLaunchTweaks {
    pub skip_intro_pack: Option<PathBuf>,
    pub script_logging_marker: Option<PathBuf>,
}

pub fn build_launch_command(steam: &Path, options: LaunchOptions) -> LaunchCommand {
    LaunchCommand {
        executable: steam.to_path_buf(),
        args: vec!["-applaunch".to_string(), WH3_APP_ID.to_string()],
        options,
    }
}

pub fn skip_intro_pack_bytes() -> Vec<u8> {
    let mut index = Vec::new();
    for movie in INTRO_MOVIES {
        index.extend_from_slice(&(EMPTY_CA_VIDEO.len() as u32).to_le_bytes());
        index.push(0);
        index.extend_from_slice(movie.as_bytes());
        index.push(0);
    }
    let mut bytes = vec![0u8; PFH5_HEADER_LEN];
    bytes[0..4].copy_from_slice(b"PFH5");
    bytes[4..8].copy_from_slice(&PACK_BYTE_MASK.to_le_bytes());
    bytes[16..20].copy_from_slice(&(INTRO_MOVIES.len() as u32).to_le_bytes());
    bytes[20..24].copy_from_slice(&(index.len() as u32).to_le_bytes());
    bytes[24..28].copy_from_slice(&0x7fff_ffffu32.to_le_bytes());
    bytes.extend_from_slice(&index);
    for _ in INTRO_MOVIES {
        bytes.extend_from_slice(EMPTY_CA_VIDEO);
    }
    bytes
}

pub fn prepare_launch_tweaks(
    location: &GameLocation,
    options: &LaunchOptions,
) -> Result<AppliedLaunchTweaks, AppError> {
    let mut applied = AppliedLaunchTweaks::default();
    let pack_path = location.data_path.join(MANAGED_SKIP_INTRO_PACK);
    if options.skip_intro {
        atomic_write(&pack_path, &skip_intro_pack_bytes()).map_err(|error| {
            AppError::io_path("Could not write the skip-intro pack", &pack_path, &error)
        })?;
        applied.skip_intro_pack = Some(pack_path);
    } else if pack_path.exists() {
        fs::remove_file(&pack_path).map_err(|error| {
            AppError::io_path("Could not remove the skip-intro pack", &pack_path, &error)
        })?;
    }

    let script_dir = location.data_path.join("script");
    let marker = script_dir.join(SCRIPT_LOG_MARKER);
    let ownership = script_dir.join(SCRIPT_LOG_OWNERSHIP_MARKER);
    if options.script_logging {
        fs::create_dir_all(&script_dir).map_err(|error| {
            AppError::io_path(
                "Could not create the game script directory",
                &script_dir,
                &error,
            )
        })?;
        atomic_write(&marker, b"").map_err(|error| {
            AppError::io_path("Could not enable script logging", &marker, &error)
        })?;
        atomic_write(&ownership, b"wh3mm\n").map_err(|error| {
            AppError::io_path(
                "Could not record the script-logging marker",
                &ownership,
                &error,
            )
        })?;
        applied.script_logging_marker = Some(marker);
    } else if ownership.exists() {
        if marker.exists() {
            fs::remove_file(&marker).map_err(|error| {
                AppError::io_path("Could not disable script logging", &marker, &error)
            })?;
        }
        fs::remove_file(&ownership).map_err(|error| {
            AppError::io_path(
                "Could not remove the script-logging marker",
                &ownership,
                &error,
            )
        })?;
    }
    Ok(applied)
}

pub fn command_line_mentions_game(cmdline: &[u8]) -> bool {
    String::from_utf8_lossy(cmdline)
        .to_lowercase()
        .contains(WH3_PROCESS_NAME)
}

#[cfg(target_os = "linux")]
pub fn is_game_running() -> Result<bool, AppError> {
    let entries = match fs::read_dir("/proc") {
        Ok(entries) => entries,
        Err(_) => return Ok(false),
    };
    for entry in entries.flatten() {
        let path = entry.path().join("cmdline");
        let Ok(cmdline) = fs::read(path) else {
            continue;
        };
        if command_line_mentions_game(&cmdline) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(windows)]
pub fn is_game_running() -> Result<bool, AppError> {
    let output = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq Warhammer3.exe", "/NH"])
        .output();
    match output {
        Ok(output) => Ok(String::from_utf8_lossy(&output.stdout)
            .to_lowercase()
            .contains(WH3_PROCESS_NAME)),
        Err(_) => Ok(false),
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn is_game_running() -> Result<bool, AppError> {
    Ok(false)
}

pub fn spawn_launch_command(command: &LaunchCommand) -> Result<u32, AppError> {
    let child = Command::new(&command.executable)
        .args(&command.args)
        .spawn()
        .map_err(|error| {
            AppError::new(
                ErrorCode::SteamNotFound,
                "Steam could not be started; check that Steam is installed and running",
            )
            .with_details(format!("{}: {error}", command.executable.display()))
        })?;
    Ok(child.id())
}

impl Session {
    pub fn launch_options(&self) -> LaunchOptions {
        self.config
            .launch_options
            .get(&self.config.active_profile_id)
            .copied()
            .unwrap_or_default()
    }

    pub fn set_launch_options(
        &mut self,
        options: LaunchOptions,
    ) -> Result<LaunchOptions, AppError> {
        if self.config_write_blocked {
            return Err(AppError::corrupt(
                "The config files could not be read; writing is disabled to avoid data loss",
            ));
        }
        let profile_id = self.config.active_profile_id.clone();
        let mut next = self.config.clone();
        next.launch_options.insert(profile_id, options);
        config::save(&next, &self.config_path)?;
        self.config = next;
        Ok(options)
    }

    pub fn launch_game(&mut self, options: LaunchOptions) -> Result<LaunchResult, AppError> {
        let location = self.location.clone().ok_or_else(|| {
            AppError::new(
                ErrorCode::GameNotFound,
                "Could not find a Total War: Warhammer III installation",
            )
        })?;
        if is_game_running()? {
            return Err(AppError::validation(
                "Total War: Warhammer III is already running; close it before launching again",
            ));
        }
        self.set_launch_options(options)?;
        prepare_launch_tweaks(&location, &options)?;
        let steam = crate::workshop::find_steam_executable(&location).ok_or_else(|| {
            AppError::new(
                ErrorCode::SteamNotFound,
                "Steam was not found; install Steam or point the manager at a Steam library",
            )
        })?;
        let command = build_launch_command(&steam, options);
        spawn_launch_command(&command)?;
        Ok(LaunchResult {
            launched: true,
            method: LaunchMethod::Steam,
            message: Some("Warhammer III launch requested through Steam.".to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conflicts::read_pack_file_index;
    use crate::session::SessionOptions;
    use crate::test_support::TempDir;

    fn location(dir: &TempDir) -> GameLocation {
        let game = dir.path().join("game");
        fs::create_dir_all(game.join("data")).unwrap();
        GameLocation {
            game_path: game.clone(),
            data_path: game.join("data"),
            workshop_path: PathBuf::new(),
            steam_root: dir.path().join("steam"),
            proton_prefix: None,
            source: crate::ipc::LocationSource::Manual,
        }
    }

    #[test]
    fn launch_command_uses_the_steam_app_id_and_carries_options() {
        let command = build_launch_command(
            Path::new("steam"),
            LaunchOptions {
                skip_intro: true,
                script_logging: true,
            },
        );
        assert_eq!(command.args, vec!["-applaunch", "1142710"]);
        assert!(command.options.skip_intro);
        assert!(command.options.script_logging);
    }

    #[test]
    fn skip_intro_pack_contains_all_intro_movies() {
        let dir = TempDir::new("launch-pack");
        let path = dir.path().join(MANAGED_SKIP_INTRO_PACK);
        fs::write(&path, skip_intro_pack_bytes()).unwrap();
        let entries = read_pack_file_index(&path).unwrap();
        assert_eq!(entries.len(), INTRO_MOVIES.len());
        assert!(entries
            .iter()
            .any(|entry| entry.path == "movies/gam_int.ca_vp8"));
        assert!(entries.iter().all(|entry| entry.size == 595));
    }

    #[test]
    fn tweaks_are_written_and_removed_with_the_option() {
        let dir = TempDir::new("launch-tweaks");
        let location = location(&dir);
        let enabled = LaunchOptions {
            skip_intro: true,
            script_logging: true,
        };
        let applied = prepare_launch_tweaks(&location, &enabled).unwrap();
        let pack = applied.skip_intro_pack.unwrap();
        let marker = applied.script_logging_marker.unwrap();
        assert!(pack.is_file());
        assert!(marker.is_file());
        assert!(location
            .data_path
            .join("script")
            .join(SCRIPT_LOG_OWNERSHIP_MARKER)
            .is_file());

        prepare_launch_tweaks(&location, &LaunchOptions::default()).unwrap();
        assert!(!pack.exists());
        assert!(!marker.exists());
    }

    #[test]
    fn user_owned_script_logging_marker_is_not_deleted() {
        let dir = TempDir::new("launch-user-marker");
        let location = location(&dir);
        let script_dir = location.data_path.join("script");
        fs::create_dir_all(&script_dir).unwrap();
        let marker = script_dir.join(SCRIPT_LOG_MARKER);
        fs::write(&marker, b"user").unwrap();

        prepare_launch_tweaks(&location, &LaunchOptions::default()).unwrap();
        assert!(marker.is_file());
    }

    #[test]
    fn process_matching_is_case_insensitive() {
        assert!(command_line_mentions_game(
            b"C:\\Games\\Warhammer3.exe\0--foo"
        ));
        assert!(!command_line_mentions_game(b"C:\\Games\\other.exe"));
    }

    #[test]
    fn launch_options_round_trip_per_profile() {
        let dir = TempDir::new("launch-options");
        let game = dir.path().join("game");
        fs::create_dir_all(game.join("data")).unwrap();
        let options = SessionOptions {
            config_path: dir.path().join("config.json"),
            steam_root_candidates: Some(Vec::new()),
            manual_game_path: Some(game),
            log_timings: false,
        };
        let mut session = Session::initialize(options).unwrap();
        assert_eq!(session.launch_options(), LaunchOptions::default());
        session
            .set_launch_options(LaunchOptions {
                skip_intro: true,
                script_logging: true,
            })
            .unwrap();

        let reloaded = Session::initialize(SessionOptions {
            config_path: dir.path().join("config.json"),
            steam_root_candidates: Some(Vec::new()),
            manual_game_path: None,
            log_timings: false,
        })
        .unwrap();
        assert!(reloaded.launch_options().skip_intro);
        assert!(reloaded.launch_options().script_logging);
    }
}
