//! WH3 launch options, Steam launch command construction, and the managed
//! start-game tweaks.
//!
//! Skip-intro movies are a data-folder override pack, and script logging is the
//! documented `data/script/enable_console_logging` marker. Both are owned by
//! the manager and removed when the matching option is turned off, so a launch
//! does not leave a hidden override behind.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
#[cfg(any(test, target_os = "linux"))]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

use crate::atomic::atomic_write;
use crate::config;
use crate::error::{AppError, ErrorCode};
use crate::launch_guard::LoadOrderGuard;
use crate::load_order;
use crate::paths::GameLocation;
use crate::proton_launch;
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
    Proton,
    Direct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LaunchPlatform {
    Linux,
    Windows,
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
    pub env: BTreeMap<String, String>,
    pub working_dir: Option<PathBuf>,
    pub method: LaunchMethod,
    pub options: LaunchOptions,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppliedLaunchTweaks {
    pub skip_intro_pack: Option<PathBuf>,
    pub script_logging_marker: Option<PathBuf>,
}

/// Legacy test fixture for the old Steam command shape.
///
/// Production launch must use [`build_proton_launch_command`] on Linux or
/// [`build_direct_launch_command`] on Windows; the Steam `-applaunch` path opens
/// the CA launcher and is deliberately not reachable from the app.
#[cfg(test)]
pub fn build_launch_command(
    steam: &Path,
    options: LaunchOptions,
    working_dir: Option<&Path>,
) -> LaunchCommand {
    let mut args = vec!["-applaunch".to_string(), WH3_APP_ID.to_string()];
    args.extend(game_args());
    LaunchCommand {
        executable: steam.to_path_buf(),
        args,
        env: BTreeMap::new(),
        working_dir: working_dir.map(Path::to_path_buf),
        method: LaunchMethod::Steam,
        options,
    }
}

pub(crate) fn game_args() -> Vec<String> {
    vec![format!("{};", load_order::USED_MODS_FILE)]
}

pub(crate) fn build_proton_launch_command(
    location: &GameLocation,
    steam_roots: &[PathBuf],
    options: LaunchOptions,
    linux: bool,
) -> Result<LaunchCommand, AppError> {
    let launch = proton_launch::resolve(
        &location.game_path,
        location.proton_prefix.as_deref(),
        steam_roots,
        WH3_APP_ID,
        &game_args(),
        linux,
    )?
    .ok_or_else(|| {
        AppError::new(
            ErrorCode::ProtonNotConfigured,
            "Direct Proton launch is not available on this platform",
        )
    })?;

    Ok(LaunchCommand {
        executable: launch.executable,
        args: launch.args,
        env: launch.env,
        working_dir: Some(launch.working_dir),
        method: LaunchMethod::Proton,
        options,
    })
}

pub(crate) fn build_direct_launch_command(
    location: &GameLocation,
    options: LaunchOptions,
) -> Result<LaunchCommand, AppError> {
    let executable = location.game_path.join(crate::paths::WH3_EXE_NAME);
    if !executable.is_file() {
        return Err(AppError::new(
            ErrorCode::GameNotFound,
            "The Warhammer III executable was not found",
        )
        .with_details(format!("expected {}", executable.display())));
    }

    Ok(LaunchCommand {
        executable,
        args: game_args(),
        env: BTreeMap::new(),
        working_dir: Some(location.game_path.clone()),
        method: LaunchMethod::Direct,
        options,
    })
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

/// Seam for the running-game check so launch refusal and probe failures can be
/// exercised without spawning a real platform process.
pub trait GameProcessProbe {
    fn is_game_running(&self) -> Result<bool, AppError>;
}

pub struct SystemGameProcessProbe;

impl GameProcessProbe for SystemGameProcessProbe {
    fn is_game_running(&self) -> Result<bool, AppError> {
        is_game_running()
    }
}

/// Seam for the Steam-client check used by the Windows direct launch path.
pub trait SteamProcessProbe {
    fn is_steam_running(&self) -> Result<bool, AppError>;
}

pub struct SystemSteamProcessProbe;

impl SteamProcessProbe for SystemSteamProcessProbe {
    fn is_steam_running(&self) -> Result<bool, AppError> {
        is_steam_running()
    }
}

#[cfg(windows)]
pub fn is_steam_running() -> Result<bool, AppError> {
    let tasklist = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("tasklist.exe"))
        .unwrap_or_else(|| PathBuf::from("tasklist"));
    let output = Command::new(tasklist)
        .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
        .output()
        .map_err(|error| AppError::steam_probe_failed(format!("tasklist: {error}")))?;
    if !output.status.success() {
        return Err(AppError::steam_probe_failed(format!(
            "tasklist exited with {}",
            output.status
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .to_lowercase()
        .contains("steam.exe"))
}

#[cfg(not(windows))]
pub fn is_steam_running() -> Result<bool, AppError> {
    Ok(true)
}

#[cfg(target_os = "linux")]
pub fn is_game_running() -> Result<bool, AppError> {
    if crate::host_process::is_flatpak() {
        // Flatpak has a private PID namespace. Query the host and propagate
        // probe failures rather than incorrectly allowing a second launch.
        let output = crate::host_process::command(
            Path::new("pgrep"),
            &["-i".into(), "-f".into(), "[w]arhammer3\\.exe".into()],
            &Default::default(),
            None,
        )
        .output()
        .map_err(|error| AppError::process_detection_failed(error.to_string()))?;
        return match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => Err(AppError::process_detection_failed(
                String::from_utf8_lossy(&output.stderr).into_owned(),
            )),
        };
    }
    let entries = fs::read_dir("/proc")
        .map_err(|error| AppError::process_detection_failed(format!("/proc: {error}")))?;
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
        .output()
        .map_err(|error| AppError::process_detection_failed(format!("tasklist: {error}")))?;
    if !output.status.success() {
        return Err(AppError::process_detection_failed(format!(
            "tasklist exited with {}",
            output.status
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .to_lowercase()
        .contains(WH3_PROCESS_NAME))
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn is_game_running() -> Result<bool, AppError> {
    Ok(false)
}

pub(crate) fn configure_launch_process(command: &LaunchCommand) -> Command {
    crate::host_process::command(
        &command.executable,
        &command.args,
        &command.env,
        command.working_dir.as_deref(),
    )
}

fn launch_failure_message(method: LaunchMethod) -> &'static str {
    match method {
        LaunchMethod::Steam => {
            "Steam could not be started; check that Steam is installed and running"
        }
        LaunchMethod::Proton => {
            "Warhammer III could not be started through Proton; check the Proton installation and Steam Linux Runtime"
        }
        LaunchMethod::Direct => "Warhammer III could not be started directly",
    }
}

fn launch_requested_message(method: LaunchMethod) -> &'static str {
    match method {
        LaunchMethod::Steam => "Warhammer III launch requested through Steam.",
        LaunchMethod::Proton => "Warhammer III launch requested through Proton.",
        LaunchMethod::Direct => "Warhammer III launch requested directly.",
    }
}

fn wait_for_exit(process: &mut dyn SpawnedProcess, timeout: Duration) -> bool {
    let started = Instant::now();
    loop {
        match process.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(10));
            }
            Ok(None) | Err(_) => return false,
        }
    }
}

pub(crate) fn spawn_launch_process(command: &LaunchCommand) -> Result<Child, AppError> {
    configure_launch_process(command).spawn().map_err(|error| {
        AppError::new(
            ErrorCode::LaunchFailed,
            launch_failure_message(command.method),
        )
        .with_details(format!("{}: {error}", command.executable.display()))
    })
}

pub(crate) trait SpawnedProcess {
    fn pid(&self) -> u32;
    /// Returns `Some(success)` once the process has exited.
    fn try_wait(&mut self) -> std::io::Result<Option<bool>>;
    fn kill(&mut self) -> std::io::Result<()>;
}

impl SpawnedProcess for Child {
    fn pid(&self) -> u32 {
        Child::id(self)
    }

    fn try_wait(&mut self) -> std::io::Result<Option<bool>> {
        Child::try_wait(self).map(|status| status.map(|status| status.success()))
    }

    fn kill(&mut self) -> std::io::Result<()> {
        Child::kill(self)
    }
}

pub(crate) trait LaunchSpawner {
    fn spawn(&self, command: &LaunchCommand) -> Result<Box<dyn SpawnedProcess>, AppError>;
}

pub(crate) struct SystemLaunchSpawner;

impl LaunchSpawner for SystemLaunchSpawner {
    fn spawn(&self, command: &LaunchCommand) -> Result<Box<dyn SpawnedProcess>, AppError> {
        Ok(Box::new(spawn_launch_process(command)?))
    }
}

fn current_launch_platform() -> Result<LaunchPlatform, AppError> {
    if cfg!(target_os = "linux") {
        Ok(LaunchPlatform::Linux)
    } else if cfg!(windows) {
        Ok(LaunchPlatform::Windows)
    } else {
        Err(AppError::validation(
            "Launch is only supported on Windows and Linux",
        ))
    }
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

    /// Refuses to launch when the file on disk is not the selected order.
    ///
    /// Launch and `write_load_order` are separate operations: launch never writes
    /// the file. This check makes that separation safe by ensuring an external
    /// writer (for example the CA launcher) cannot hand the game a different list
    /// after the user pressed Apply.
    fn ensure_load_order_matches_selection(
        &self,
        location: &GameLocation,
        baseline: &Option<Vec<u8>>,
    ) -> Result<(), AppError> {
        let parsed = match baseline {
            Some(bytes) => match load_order::parse_used_mods(bytes) {
                Ok(parsed) => parsed,
                Err(error) => {
                    return Err(AppError::new(
                        ErrorCode::ConfigCorrupt,
                        "used_mods.txt is corrupt; restore the backup before launching",
                    )
                    .with_details(error.details.unwrap_or(error.message)));
                }
            },
            None => load_order::ParsedUsedMods::default(),
        };
        if parsed.is_corrupt() {
            return Err(AppError::new(
                ErrorCode::ConfigCorrupt,
                "used_mods.txt is corrupt; restore the backup before launching",
            )
            .with_details(parsed.corrupt_message().unwrap_or_default()));
        }
        if !parsed.duplicates.is_empty() {
            return Err(AppError::new(
                ErrorCode::LoadOrderOverridden,
                "used_mods.txt contains duplicate mod entries; apply the load order before launching",
            )
            .with_details(format!("duplicates: {}", parsed.duplicates.join(", "))));
        }
        if !parsed.unmanaged.is_empty() {
            return Err(AppError::new(
                ErrorCode::LoadOrderOverridden,
                "used_mods.txt contains directives the manager does not manage; review and apply the load order before launching",
            )
            .with_details(format!("directives: {}", parsed.unmanaged.join(" | "))));
        }

        let mut expected = Vec::new();
        let mut expected_directories = Vec::new();
        let mut seen_directories = std::collections::HashSet::new();
        for id in &self.enabled_ids {
            let Some(module) = self.mods.iter().find(|module| module.id == *id) else {
                continue;
            };
            expected.push(module.name.as_str());
            if let Some(parent) = module.path.parent() {
                if parent != location.data_path.as_path() {
                    let directory = parent.to_string_lossy().into_owned();
                    if seen_directories.insert(directory.to_lowercase()) {
                        expected_directories.push(directory);
                    }
                }
            }
        }
        let actual: Vec<&str> = parsed.mod_names.iter().map(String::as_str).collect();
        let matches = expected.len() == actual.len()
            && expected
                .iter()
                .zip(actual.iter())
                .all(|(expected, actual)| expected.eq_ignore_ascii_case(actual));
        if !matches {
            let expected_text = if expected.is_empty() {
                "<empty>".to_string()
            } else {
                expected.join(", ")
            };
            let actual_text = if actual.is_empty() {
                "<empty>".to_string()
            } else {
                actual.join(", ")
            };
            return Err(AppError::new(
                ErrorCode::LoadOrderOverridden,
                "The load order on disk does not match the selected mods; apply the load order before launching",
            )
            .with_details(format!(
                "expected: {expected_text}; on disk: {actual_text}"
            )));
        }

        let directories_match = expected_directories.len() == parsed.working_directories.len()
            && expected_directories
                .iter()
                .zip(parsed.working_directories.iter())
                .all(|(expected, actual)| expected.eq_ignore_ascii_case(actual));
        if !directories_match {
            let expected_text = if expected_directories.is_empty() {
                "<empty>".to_string()
            } else {
                expected_directories.join(", ")
            };
            let actual_text = if parsed.working_directories.is_empty() {
                "<empty>".to_string()
            } else {
                parsed.working_directories.join(", ")
            };
            return Err(AppError::new(
                ErrorCode::LoadOrderOverridden,
                "The working directories on disk do not match the selected mods; apply the load order before launching",
            )
            .with_details(format!(
                "expected: {expected_text}; on disk: {actual_text}"
            )));
        }
        Ok(())
    }

    pub fn launch_game(&mut self, options: LaunchOptions) -> Result<LaunchResult, AppError> {
        self.launch_game_with_probe(options, &SystemGameProcessProbe)
    }

    pub(crate) fn launch_game_with_probe(
        &mut self,
        options: LaunchOptions,
        probe: &dyn GameProcessProbe,
    ) -> Result<LaunchResult, AppError> {
        self.launch_game_with_seams(
            options,
            probe,
            &SystemLaunchSpawner,
            &LoadOrderGuard::default(),
            &SystemSteamProcessProbe,
            current_launch_platform()?,
        )
    }

    pub(crate) fn launch_game_with_seams(
        &mut self,
        options: LaunchOptions,
        probe: &dyn GameProcessProbe,
        spawner: &dyn LaunchSpawner,
        guard: &LoadOrderGuard,
        steam_probe: &dyn SteamProcessProbe,
        platform: LaunchPlatform,
    ) -> Result<LaunchResult, AppError> {
        let location = self.location.clone().ok_or_else(|| {
            AppError::new(
                ErrorCode::GameNotFound,
                "Could not find a Total War: Warhammer III installation",
            )
        })?;
        if probe.is_game_running()? {
            return Err(AppError::validation(
                "Total War: Warhammer III is already running; close it before launching again",
            ));
        }
        let used_mods = load_order::used_mods_path(&location.game_path);
        let baseline = guard.snapshot(&used_mods)?;
        self.ensure_load_order_matches_selection(&location, &baseline)?;

        let command = match platform {
            LaunchPlatform::Linux => {
                build_proton_launch_command(&location, &self.launch_steam_roots(), options, true)?
            }
            LaunchPlatform::Windows => {
                if !steam_probe.is_steam_running()? {
                    return Err(AppError::new(
                        ErrorCode::SteamNotRunning,
                        "Steam must be running to authenticate Warhammer III and load Workshop mods. Start Steam, then launch again",
                    ));
                }
                build_direct_launch_command(&location, options)?
            }
        };

        self.set_launch_options(options)?;
        prepare_launch_tweaks(&location, &options)?;

        let mut child = spawner.spawn(&command)?;

        if let Err(error) = guard.wait_unchanged(&used_mods, &baseline) {
            let pid = child.pid();
            let kill_error = child.kill().err();
            let stopped =
                kill_error.is_none() && wait_for_exit(&mut *child, Duration::from_millis(750));
            let restore_error = guard.restore_snapshot(&used_mods, &baseline).err();
            let mut details = error.details.unwrap_or_default();
            if !details.is_empty() {
                details.push_str("; ");
            }
            details.push_str(&format!("spawned pid {pid}"));
            match kill_error {
                Some(kill_error) => {
                    details.push_str(&format!("; kill failed: {kill_error}"));
                }
                None if stopped => details.push_str("; process stopped"),
                None => details.push_str("; process may still be running"),
            }
            match restore_error {
                Some(restore_error) => {
                    details.push_str(&format!("; restore failed: {restore_error}"));
                }
                None => details.push_str("; used_mods.txt restored"),
            }
            return Err(AppError::new(error.code, error.message).with_details(details));
        }

        match child.try_wait() {
            Ok(Some(false)) => {
                return Err(AppError::new(
                    ErrorCode::LaunchFailed,
                    "Warhammer III exited before it could start",
                )
                .with_details(format!(
                    "pid {} exited with a failure status during the launch guard",
                    child.pid()
                )));
            }
            Ok(_) => {}
            Err(error) => {
                let pid = child.pid();
                let _ = child.kill();
                return Err(AppError::new(
                    ErrorCode::LaunchFailed,
                    "Could not determine whether the launch succeeded",
                )
                .with_details(format!("pid {pid}: {error}")));
            }
        }

        Ok(LaunchResult {
            launched: true,
            method: command.method,
            message: Some(launch_requested_message(command.method).to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conflicts::read_pack_file_index;
    use crate::launch_guard::LoadOrderGuard;
    use crate::session::SessionOptions;
    use crate::test_support::TempDir;
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::rc::Rc;

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

    fn session_with_game(dir: &TempDir) -> Session {
        let game = dir.path().join("game");
        fs::create_dir_all(game.join("data")).unwrap();
        Session::initialize(SessionOptions {
            config_path: dir.path().join("config.json"),
            steam_root_candidates: Some(Vec::new()),
            manual_game_path: Some(game),
            log_timings: false,
        })
        .unwrap()
    }

    struct StubProbe(Result<bool, AppError>);

    impl GameProcessProbe for StubProbe {
        fn is_game_running(&self) -> Result<bool, AppError> {
            self.0.clone()
        }
    }

    struct StubSteamProbe(Result<bool, AppError>);

    impl SteamProcessProbe for StubSteamProbe {
        fn is_steam_running(&self) -> Result<bool, AppError> {
            self.0.clone()
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
            Some(Path::new("C:/game")),
        );
        assert_eq!(
            command.args,
            vec!["-applaunch", "1142710", "used_mods.txt;"]
        );
        assert_eq!(command.method, LaunchMethod::Steam);
        assert_eq!(command.working_dir, Some(PathBuf::from("C:/game")));
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
    fn launch_refuses_while_the_game_is_running() {
        let dir = TempDir::new("launch-running");
        let mut session = session_with_game(&dir);
        let before = session.config.clone();
        let options = LaunchOptions {
            skip_intro: true,
            script_logging: true,
        };

        let error = session
            .launch_game_with_probe(options, &StubProbe(Ok(true)))
            .expect_err("a running game must block launch");

        assert_eq!(error.code, ErrorCode::Validation);
        assert!(error.message.contains("already running"));
        assert_eq!(session.config, before);
        let location = session.location.as_ref().unwrap();
        assert!(!location.data_path.join(MANAGED_SKIP_INTRO_PACK).exists());
        assert!(!location
            .data_path
            .join("script")
            .join(SCRIPT_LOG_MARKER)
            .exists());
    }

    #[test]
    fn launch_reports_a_detection_failure_instead_of_launching() {
        let dir = TempDir::new("launch-detection-failure");
        let mut session = session_with_game(&dir);
        let before = session.config.clone();
        let probe = StubProbe(Err(AppError::process_detection_failed(
            "tasklist: not found",
        )));

        let error = session
            .launch_game_with_probe(LaunchOptions::default(), &probe)
            .expect_err("a failed probe must block launch");

        assert_eq!(error.code, ErrorCode::ProcessDetectionFailed);
        assert!(error.retryable);
        assert_eq!(error.details.as_deref(), Some("tasklist: not found"));
        assert_eq!(session.config, before);
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

    struct LaunchFixture {
        _dir: TempDir,
        steam_root: PathBuf,
        game: PathBuf,
        session: Session,
    }

    fn write(path: &Path, contents: impl AsRef<[u8]>) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn escape_vdf_path(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "\\\\")
    }

    fn launch_fixture(name: &str, with_compat_data: bool) -> LaunchFixture {
        let dir = TempDir::new(name);
        let steam_root = dir.path().join("Steam");
        let library = dir.path().join("SteamLibrary");
        fs::create_dir_all(steam_root.join("steamapps")).unwrap();
        fs::create_dir_all(library.join("steamapps").join("common")).unwrap();

        let game = library
            .join("steamapps")
            .join("common")
            .join("Total War WARHAMMER III");
        fs::create_dir_all(game.join("data")).unwrap();
        write(&game.join("Warhammer3.exe"), b"exe");
        write(&game.join("used_mods.txt"), b"");

        let library_folders = format!(
            "\"libraryfolders\"\n{{\n    \"0\" {{ \"path\" \"{}\" }}\n    \"1\" {{ \"path\" \"{}\" }}\n}}\n",
            escape_vdf_path(&steam_root),
            escape_vdf_path(&library)
        );
        write(
            &steam_root.join("steamapps").join("libraryfolders.vdf"),
            library_folders.as_bytes(),
        );
        write(
            &steam_root.join("config").join("config.vdf"),
            b"\"InstallConfigStore\"\n{\n    \"Software\"\n    {\n        \"Valve\"\n        {\n            \"Steam\"\n            {\n                \"CompatToolMapping\"\n                {\n                    \"1142710\"\n                    {\n                        \"name\" \"proton_11\"\n                    }\n                }\n            }\n        }\n    }\n}\n",
        );
        write(
            &library
                .join("steamapps")
                .join("common")
                .join("Proton 11.0")
                .join("proton"),
            b"#!/bin/sh\n",
        );
        write(
            &library
                .join("steamapps")
                .join("common")
                .join("SteamLinuxRuntime_4")
                .join("_v2-entry-point"),
            b"#!/bin/sh\n",
        );
        if with_compat_data {
            fs::create_dir_all(library.join("steamapps").join("compatdata").join("1142710"))
                .unwrap();
        }

        let session = Session::initialize(SessionOptions {
            config_path: dir.path().join("config.json"),
            steam_root_candidates: Some(vec![steam_root.clone()]),
            manual_game_path: Some(game.clone()),
            log_timings: false,
        })
        .unwrap();

        LaunchFixture {
            _dir: dir,
            steam_root,
            game,
            session,
        }
    }

    fn fast_guard() -> LoadOrderGuard {
        LoadOrderGuard {
            window: std::time::Duration::from_millis(20),
            poll: std::time::Duration::from_millis(5),
        }
    }

    fn add_steam_executable(fixture: &LaunchFixture) -> PathBuf {
        let root = fixture
            .session
            .location
            .as_ref()
            .expect("session location")
            .steam_root
            .clone();
        let steam = root.join(if cfg!(windows) {
            "steam.exe"
        } else {
            "steam.sh"
        });
        write(&steam, b"#!/bin/sh\n");
        steam
    }

    struct RecordingSpawner {
        commands: RefCell<Vec<LaunchCommand>>,
        write_on_spawn: Option<PathBuf>,
        kills: Rc<Cell<usize>>,
        attempts: Cell<usize>,
        exit: Option<bool>,
        fail: bool,
    }

    impl Default for RecordingSpawner {
        fn default() -> Self {
            Self {
                commands: RefCell::new(Vec::new()),
                write_on_spawn: None,
                kills: Rc::new(Cell::new(0)),
                attempts: Cell::new(0),
                exit: None,
                fail: false,
            }
        }
    }

    struct FakeProcess {
        pid: u32,
        kills: Rc<Cell<usize>>,
        exit: Option<bool>,
    }

    impl SpawnedProcess for FakeProcess {
        fn pid(&self) -> u32 {
            self.pid
        }

        fn try_wait(&mut self) -> std::io::Result<Option<bool>> {
            Ok(self.exit)
        }

        fn kill(&mut self) -> std::io::Result<()> {
            self.kills.set(self.kills.get() + 1);
            self.exit = Some(true);
            Ok(())
        }
    }

    impl LaunchSpawner for RecordingSpawner {
        fn spawn(&self, command: &LaunchCommand) -> Result<Box<dyn SpawnedProcess>, AppError> {
            self.attempts.set(self.attempts.get() + 1);
            if self.fail {
                return Err(AppError::new(ErrorCode::LaunchFailed, "fake spawn failure"));
            }
            self.commands.borrow_mut().push(command.clone());
            if let Some(path) = &self.write_on_spawn {
                fs::write(path, b"changed.pack\n").unwrap();
            }
            Ok(Box::new(FakeProcess {
                pid: 4242,
                kills: self.kills.clone(),
                exit: self.exit,
            }))
        }
    }

    #[test]
    fn direct_proton_is_selected_before_steam_without_a_steam_executable() {
        let mut fixture = launch_fixture("launch-direct-proton", true);
        let spawner = RecordingSpawner::default();

        let result = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Linux,
            )
            .unwrap();

        assert_eq!(result.method, LaunchMethod::Proton);
        let commands = spawner.commands.borrow();
        assert_eq!(commands.len(), 1);
        let command = &commands[0];
        assert_eq!(command.method, LaunchMethod::Proton);
        assert_eq!(command.working_dir.as_deref(), Some(fixture.game.as_path()));
        assert_eq!(
            command.env.get("STEAM_COMPAT_APP_ID").map(String::as_str),
            Some(WH3_APP_ID)
        );
        assert!(command
            .env
            .get("STEAM_COMPAT_DATA_PATH")
            .is_some_and(|path| path.ends_with("compatdata/1142710")
                || path.ends_with("compatdata\\1142710")));
        assert!(command
            .args
            .iter()
            .any(|argument| argument == "used_mods.txt;"));
        assert!(!fixture
            .steam_root
            .join(if cfg!(windows) {
                "steam.exe"
            } else {
                "steam.sh"
            })
            .exists());
    }

    #[test]
    fn linux_launch_does_not_fall_back_to_steam() {
        let mut fixture = launch_fixture("launch-no-fallback", false);
        write(
            &fixture.steam_root.join(if cfg!(windows) {
                "steam.exe"
            } else {
                "steam.sh"
            }),
            b"#!/bin/sh\n",
        );
        let spawner = RecordingSpawner::default();

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Linux,
            )
            .expect_err("Linux must not fall back to Steam");

        assert_eq!(error.code, ErrorCode::CompatDataMissing);
        assert!(spawner.commands.borrow().is_empty());
    }

    #[test]
    fn load_order_rewrite_kills_child_and_returns_load_order_overridden() {
        let mut fixture = launch_fixture("launch-order-rewrite", true);
        let used_mods = fixture.game.join("used_mods.txt");
        let spawner = RecordingSpawner {
            write_on_spawn: Some(used_mods.clone()),
            ..RecordingSpawner::default()
        };

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Linux,
            )
            .expect_err("a rewritten used_mods.txt must stop the launch");

        assert_eq!(error.code, ErrorCode::LoadOrderOverridden);
        assert_eq!(spawner.kills.get(), 1);
        assert!(fs::read_to_string(&used_mods).unwrap().is_empty());
        assert!(error.details.unwrap_or_default().contains("pid 4242"));
    }

    #[test]
    fn launch_does_not_write_used_mods() {
        let mut fixture = launch_fixture("launch-no-write", true);
        let path = fixture.game.join("used_mods.txt");
        let before = fs::read(&path).unwrap();
        let spawner = RecordingSpawner::default();

        fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Linux,
            )
            .unwrap();

        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn spawn_failure_returns_launch_failed() {
        let mut command = build_launch_command(
            Path::new("wh3mm-test-executable-that-does-not-exist"),
            LaunchOptions::default(),
            None,
        );
        command.method = LaunchMethod::Proton;

        let error = spawn_launch_process(&command).unwrap_err();

        assert_eq!(error.code, ErrorCode::LaunchFailed);
        assert!(error.message.contains("Proton"));
    }

    #[test]
    fn spawn_configuration_applies_env_and_working_directory() {
        let mut env = BTreeMap::new();
        env.insert("WH3MM_TEST".to_string(), "value".to_string());
        let command = LaunchCommand {
            executable: PathBuf::from("proton"),
            args: vec!["waitforexitandrun".to_string()],
            env,
            working_dir: Some(PathBuf::from("C:/game")),
            method: LaunchMethod::Proton,
            options: LaunchOptions::default(),
        };

        let process = configure_launch_process(&command);

        assert_eq!(process.get_current_dir(), Some(Path::new("C:/game")));
        assert!(process.get_envs().any(|(key, value)| {
            key == std::ffi::OsStr::new("WH3MM_TEST")
                && value == Some(std::ffi::OsStr::new("value"))
        }));
    }

    #[test]
    fn launch_saves_options_before_a_failed_spawn() {
        let mut fixture = launch_fixture("launch-options-before-failure", true);
        add_steam_executable(&fixture);
        let spawner = RecordingSpawner {
            fail: true,
            ..RecordingSpawner::default()
        };
        let options = LaunchOptions {
            skip_intro: true,
            script_logging: true,
        };

        let error = fixture
            .session
            .launch_game_with_seams(
                options,
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Linux,
            )
            .expect_err("the fake spawn must fail");

        assert_eq!(error.code, ErrorCode::LaunchFailed);
        assert_eq!(fixture.session.launch_options(), options);
        assert_eq!(spawner.attempts.get(), 1);
    }

    #[test]
    fn proton_spawn_failure_does_not_try_steam() {
        let mut fixture = launch_fixture("launch-no-steam-fallback", true);
        add_steam_executable(&fixture);
        let spawner = RecordingSpawner {
            fail: true,
            ..RecordingSpawner::default()
        };

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Linux,
            )
            .expect_err("a Proton spawn failure must not fall back to Steam");

        assert_eq!(error.code, ErrorCode::LaunchFailed);
        assert_eq!(spawner.attempts.get(), 1);
        assert!(spawner.commands.borrow().is_empty());
    }

    #[test]
    fn early_process_failure_returns_launch_failed() {
        let mut fixture = launch_fixture("launch-early-failure", true);
        let spawner = RecordingSpawner {
            exit: Some(false),
            ..RecordingSpawner::default()
        };

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Linux,
            )
            .expect_err("an immediately failing runtime must be reported");

        assert_eq!(error.code, ErrorCode::LaunchFailed);
        assert!(error.message.contains("exited before"));
        assert_eq!(spawner.attempts.get(), 1);
    }

    #[test]
    fn windows_direct_launch_uses_warhammer_exe_and_the_game_directory() {
        let mut fixture = launch_fixture("launch-windows-direct", true);
        let spawner = RecordingSpawner::default();

        let result = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .unwrap();

        assert_eq!(result.method, LaunchMethod::Direct);
        let commands = spawner.commands.borrow();
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].executable, fixture.game.join("Warhammer3.exe"));
        assert_eq!(commands[0].args, vec!["used_mods.txt;"]);
        assert_eq!(
            commands[0].working_dir.as_deref(),
            Some(fixture.game.as_path())
        );
    }

    #[test]
    fn direct_command_rejects_a_missing_warhammer_exe() {
        let fixture = launch_fixture("launch-missing-exe", true);
        fs::remove_file(fixture.game.join("Warhammer3.exe")).unwrap();
        let location = fixture.session.location.as_ref().unwrap();

        let error = build_direct_launch_command(location, LaunchOptions::default()).unwrap_err();

        assert_eq!(error.code, ErrorCode::GameNotFound);
    }

    #[test]
    fn windows_direct_launch_accepts_a_matching_non_empty_order() {
        let dir = TempDir::new("launch-windows-matching");
        let game = dir.path().join("game");
        fs::create_dir_all(game.join("data")).unwrap();
        fs::write(
            game.join("data").join("matching.pack"),
            crate::pack::synthetic_pack_bytes(0, &[], 0),
        )
        .unwrap();
        fs::write(game.join("Warhammer3.exe"), b"exe").unwrap();
        let mut session = Session::initialize(SessionOptions {
            config_path: dir.path().join("config.json"),
            steam_root_candidates: Some(Vec::new()),
            manual_game_path: Some(game.clone()),
            log_timings: false,
        })
        .unwrap();
        let id = session
            .snapshot()
            .mods
            .iter()
            .find(|module| module.name == "matching.pack")
            .unwrap()
            .id
            .clone();
        session.set_mods_enabled(&[id], true).unwrap();
        fs::write(game.join("used_mods.txt"), b"mod \"matching.pack\";").unwrap();
        let spawner = RecordingSpawner::default();

        let result = session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .unwrap();

        assert_eq!(result.method, LaunchMethod::Direct);
        assert_eq!(spawner.commands.borrow().len(), 1);
    }

    #[test]
    fn windows_launch_writes_and_requires_workshop_working_directory() {
        let mut fixture = launch_fixture("launch-workshop-directory", true);
        let workshop = fixture._dir.path().join("workshop").join("1142710");
        let workshop_mod_dir = workshop.join("2858184271");
        write(
            &workshop_mod_dir.join("workshop_mod.pack"),
            crate::pack::synthetic_pack_bytes(0, &[], 0),
        );
        fixture.session.location.as_mut().unwrap().workshop_path = workshop;
        let (mods, report) = crate::mod_index::scan(fixture.session.location.as_ref().unwrap());
        fixture.session.mods = mods;
        fixture.session.index_report = report;
        let id = fixture
            .session
            .snapshot()
            .mods
            .iter()
            .find(|module| module.name == "workshop_mod.pack")
            .unwrap()
            .id
            .clone();
        fixture.session.set_mods_enabled(&[id], true).unwrap();
        fixture.session.write_load_order(false, false).unwrap();

        let used_mods = fs::read_to_string(fixture.game.join("used_mods.txt")).unwrap();
        assert!(used_mods.contains("add_working_directory"));
        assert!(used_mods.contains("workshop_mod.pack"));
        assert!(
            used_mods.find("add_working_directory").unwrap()
                < used_mods.find("mod \"workshop_mod.pack\";").unwrap()
        );

        let spawner = RecordingSpawner::default();
        fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .unwrap();
        assert_eq!(spawner.attempts.get(), 1);

        write(
            &fixture.game.join("used_mods.txt"),
            b"mod \"workshop_mod.pack\";",
        );
        let mismatch_spawner = RecordingSpawner::default();
        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &mismatch_spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .expect_err("a missing Workshop directory must block launch");
        assert_eq!(error.code, ErrorCode::LoadOrderOverridden);
        assert_eq!(mismatch_spawner.attempts.get(), 0);
    }

    #[test]
    fn windows_guard_rewrite_restores_the_snapshot() {
        let mut fixture = launch_fixture("launch-windows-guard", true);
        let used_mods = fixture.game.join("used_mods.txt");
        let spawner = RecordingSpawner {
            write_on_spawn: Some(used_mods.clone()),
            ..RecordingSpawner::default()
        };

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .expect_err("a rewritten file must stop the Windows launch");

        assert_eq!(error.code, ErrorCode::LoadOrderOverridden);
        assert_eq!(spawner.kills.get(), 1);
        assert!(fs::read_to_string(&used_mods).unwrap().is_empty());
    }

    #[test]
    fn windows_launch_does_not_write_used_mods() {
        let mut fixture = launch_fixture("launch-windows-no-write", true);
        let path = fixture.game.join("used_mods.txt");
        let before = fs::read(&path).unwrap();
        let spawner = RecordingSpawner::default();

        fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .unwrap();

        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn steam_probe_failure_blocks_windows_direct_launch() {
        let mut fixture = launch_fixture("launch-steam-probe-failure", true);
        let spawner = RecordingSpawner::default();

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Err(AppError::steam_probe_failed("tasklist: not found"))),
                LaunchPlatform::Windows,
            )
            .expect_err("a failed Steam probe must block the direct launch");

        assert_eq!(error.code, ErrorCode::ProcessDetectionFailed);
        assert!(error.message.contains("Steam"));
        assert_eq!(spawner.attempts.get(), 0);
    }

    #[test]
    fn steam_not_running_blocks_windows_direct_launch() {
        let mut fixture = launch_fixture("launch-steam-not-running", true);
        let spawner = RecordingSpawner::default();

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(false)),
                LaunchPlatform::Windows,
            )
            .expect_err("Steam must be running for the Windows direct launch");

        assert_eq!(error.code, ErrorCode::SteamNotRunning);
        assert_eq!(spawner.attempts.get(), 0);
    }

    #[test]
    fn corrupt_used_mods_blocks_launch_before_spawn() {
        let mut fixture = launch_fixture("launch-corrupt-order", true);
        write(&fixture.game.join("used_mods.txt"), b"mod \"unterminated");
        let spawner = RecordingSpawner::default();

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .expect_err("a corrupt load order must block the launch");

        assert_eq!(error.code, ErrorCode::ConfigCorrupt);
        assert_eq!(spawner.attempts.get(), 0);
    }

    #[test]
    fn duplicate_used_mods_blocks_launch_before_spawn() {
        let mut fixture = launch_fixture("launch-duplicate-order", true);
        write(
            &fixture.game.join("used_mods.txt"),
            b"mod \"a.pack\";\nmod \"a.pack\";",
        );
        let spawner = RecordingSpawner::default();

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .expect_err("duplicate mod lines must block the launch");

        assert_eq!(error.code, ErrorCode::LoadOrderOverridden);
        assert_eq!(spawner.attempts.get(), 0);
    }

    #[test]
    fn unmanaged_directives_block_launch_before_spawn() {
        let mut fixture = launch_fixture("launch-unmanaged-order", true);
        write(
            &fixture.game.join("used_mods.txt"),
            b"custom_directive \"C:/tools\";",
        );
        let spawner = RecordingSpawner::default();

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .expect_err("unmanaged directives must block the launch");

        assert_eq!(error.code, ErrorCode::LoadOrderOverridden);
        assert_eq!(spawner.attempts.get(), 0);
    }

    #[test]
    fn stale_used_mods_blocks_launch_before_spawn() {
        let mut fixture = launch_fixture("launch-stale-order", true);
        write(&fixture.game.join("used_mods.txt"), b"mod \"other.pack\";");
        let spawner = RecordingSpawner::default();

        let error = fixture
            .session
            .launch_game_with_seams(
                LaunchOptions::default(),
                &StubProbe(Ok(false)),
                &spawner,
                &fast_guard(),
                &StubSteamProbe(Ok(true)),
                LaunchPlatform::Windows,
            )
            .expect_err("the disk order must match the selected order");

        assert_eq!(error.code, ErrorCode::LoadOrderOverridden);
        assert_eq!(spawner.attempts.get(), 0);
    }
}
