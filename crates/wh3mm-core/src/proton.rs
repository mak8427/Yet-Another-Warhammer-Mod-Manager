//! Linux direct launch through Steam's Proton toolchain.
//!
//! `steam -applaunch 1142710` hands the app to Creative Assembly's launcher,
//! which rewrites `used_mods.txt` with its own active set before
//! `Warhammer3.exe` starts. When the Proton toolchain can be resolved, launch
//! the game executable through the Steam Linux Runtime and Proton instead, and
//! pass `used_mods.txt;` directly. Resolution is pure so fixtures can exercise
//! it on any platform; only the final spawn is platform-specific.

use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use crate::launch::{LaunchCommand, LaunchMethod, LaunchOptions, WH3_APP_ID};
use crate::paths::{
    discover_libraries, parse_vdf, GameLocation, SteamLibrary, VdfValue, WH3_EXE_NAME,
};

/// The game argument that carries the enabled pack list. The trailing `;` is
/// part of CA's argument syntax, not a shell separator.
pub const MOD_LIST_ARGUMENT: &str = "used_mods.txt;";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtonLaunchError {
    pub reason: String,
}

impl ProtonLaunchError {
    fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

impl fmt::Display for ProtonLaunchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.reason)
    }
}

impl std::error::Error for ProtonLaunchError {}

/// The resolved files needed for a launcher-free launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtonToolchain {
    pub steam_root: PathBuf,
    pub proton: PathBuf,
    pub runtime: Option<PathBuf>,
    pub compat_data: PathBuf,
    pub game_dir: PathBuf,
}

impl ProtonToolchain {
    pub fn command(&self, options: LaunchOptions) -> LaunchCommand {
        let game_exe = self.game_dir.join(WH3_EXE_NAME);
        let mut args: Vec<OsString> = Vec::new();
        let executable = if let Some(runtime) = &self.runtime {
            args.push(OsString::from("--verb=waitforexitandrun"));
            args.push(OsString::from("--"));
            args.push(self.proton.as_os_str().to_os_string());
            args.push(OsString::from("waitforexitandrun"));
            runtime.clone()
        } else {
            args.push(OsString::from("waitforexitandrun"));
            self.proton.clone()
        };
        args.push(game_exe.into_os_string());
        args.push(OsString::from(MOD_LIST_ARGUMENT));
        LaunchCommand {
            executable,
            args,
            env: self.environment(),
            working_dir: Some(self.game_dir.clone()),
            method: LaunchMethod::Direct,
            options,
        }
    }

    fn environment(&self) -> Vec<(OsString, OsString)> {
        let steam_root = self.steam_root.as_os_str().to_os_string();
        let compat_data = self.compat_data.as_os_str().to_os_string();
        let game_dir = self.game_dir.as_os_str().to_os_string();
        vec![
            (
                OsString::from("STEAM_COMPAT_APP_ID"),
                OsString::from(WH3_APP_ID),
            ),
            (OsString::from("SteamAppId"), OsString::from(WH3_APP_ID)),
            (OsString::from("SteamGameId"), OsString::from(WH3_APP_ID)),
            (
                OsString::from("STEAM_COMPAT_CLIENT_INSTALL_PATH"),
                steam_root,
            ),
            (OsString::from("STEAM_COMPAT_DATA_PATH"), compat_data),
            (OsString::from("STEAM_COMPAT_INSTALL_PATH"), game_dir),
        ]
    }
}

/// Resolves the toolchain from the Steam root and every library it lists.
pub fn resolve_from_disk(location: &GameLocation) -> Result<ProtonToolchain, ProtonLaunchError> {
    if location.steam_root.as_os_str().is_empty() {
        return Err(ProtonLaunchError::new(
            "the Steam root is unknown; point the manager at a game folder inside a Steam library",
        ));
    }
    let (libraries, _) = discover_libraries(std::slice::from_ref(&location.steam_root));
    let compat_tool = read_compat_tool(&location.steam_root);
    resolve(location, &libraries, compat_tool.as_deref())
}

/// Pure resolver used by fixtures and [`resolve_from_disk`].
pub fn resolve(
    location: &GameLocation,
    libraries: &[SteamLibrary],
    compat_tool: Option<&str>,
) -> Result<ProtonToolchain, ProtonLaunchError> {
    if location.steam_root.as_os_str().is_empty() {
        return Err(ProtonLaunchError::new("the Steam root is unknown"));
    }
    let game_exe = location.game_path.join(WH3_EXE_NAME);
    if !game_exe.is_file() {
        return Err(ProtonLaunchError::new(format!(
            "{WH3_EXE_NAME} was not found under {}",
            location.game_path.display()
        )));
    }
    let compat_data = compat_data_dir(location).ok_or_else(|| {
        let checked = compat_data_candidate(location)
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "<unknown>".to_string());
        ProtonLaunchError::new(format!(
            "no Proton prefix was found at {checked}; start Warhammer III once through Steam, then retry"
        ))
    })?;
    let proton = find_proton(libraries, compat_tool).ok_or_else(|| {
        ProtonLaunchError::new("no Proton installation was found in the Steam libraries")
    })?;
    Ok(ProtonToolchain {
        steam_root: location.steam_root.clone(),
        proton,
        runtime: find_runtime(libraries),
        compat_data,
        game_dir: location.game_path.clone(),
    })
}

/// Reads `CompatToolMapping["1142710"].name` from `config/config.vdf`.
pub fn compat_tool_name(config_vdf: &str) -> Option<String> {
    let root = parse_vdf(config_vdf).ok()?;
    let steam = nested(&root, &["InstallConfigStore", "Software", "Valve", "Steam"])?;
    let mapping = child(steam, "CompatToolMapping")?;
    let app = child(mapping, WH3_APP_ID)?;
    string_child(app, "name")
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

fn read_compat_tool(steam_root: &Path) -> Option<String> {
    let path = steam_root.join("config").join("config.vdf");
    let text = fs::read_to_string(path).ok()?;
    compat_tool_name(&text)
}

fn child<'a>(value: &'a VdfValue, wanted: &str) -> Option<&'a VdfValue> {
    value
        .as_object()?
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(wanted))
        .map(|(_, value)| value)
}

fn nested<'a>(mut value: &'a VdfValue, path: &[&str]) -> Option<&'a VdfValue> {
    for key in path {
        value = child(value, key)?;
    }
    Some(value)
}

fn string_child(value: &VdfValue, wanted: &str) -> Option<String> {
    child(value, wanted)?.as_str().map(str::to_string)
}

fn compat_data_candidate(location: &GameLocation) -> Option<PathBuf> {
    if let Some(prefix) = &location.proton_prefix {
        if let Some(data) = prefix.parent() {
            return Some(data.to_path_buf());
        }
    }
    let steamapps = location
        .game_path
        .ancestors()
        .find(|ancestor| ancestor.file_name().is_some_and(|name| name == "steamapps"))?;
    Some(steamapps.join("compatdata").join(WH3_APP_ID))
}

fn compat_data_dir(location: &GameLocation) -> Option<PathBuf> {
    let data = compat_data_candidate(location)?;
    data.is_dir().then_some(data)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProtonCandidate {
    name: String,
    proton: PathBuf,
    version: Vec<u32>,
}

fn find_proton(libraries: &[SteamLibrary], compat_tool: Option<&str>) -> Option<PathBuf> {
    let candidates = proton_candidates(libraries);
    if let Some(tool) = compat_tool {
        if let Some(found) = candidates
            .iter()
            .filter(|candidate| matches_tool(candidate, tool))
            .max_by(|a, b| compare_candidates(a, b))
        {
            return Some(found.proton.clone());
        }
    }
    candidates
        .iter()
        .max_by(|a, b| compare_candidates(a, b))
        .map(|candidate| candidate.proton.clone())
}

fn proton_candidates(libraries: &[SteamLibrary]) -> Vec<ProtonCandidate> {
    let mut candidates = Vec::new();
    for library in libraries {
        let Ok(entries) = fs::read_dir(library.steamapps.join("common")) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.to_ascii_lowercase().starts_with("proton") {
                continue;
            }
            let proton = entry.path().join("proton");
            if proton.is_file() {
                candidates.push(ProtonCandidate {
                    version: version_numbers(&name),
                    name,
                    proton,
                });
            }
        }
    }
    candidates
}

fn compare_candidates(a: &ProtonCandidate, b: &ProtonCandidate) -> std::cmp::Ordering {
    a.version.cmp(&b.version).then_with(|| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    })
}

fn matches_tool(candidate: &ProtonCandidate, tool: &str) -> bool {
    let tool = tool.trim().to_ascii_lowercase();
    let name = candidate.name.to_ascii_lowercase();
    if let Some(suffix) = tool.strip_prefix("proton_") {
        if let Ok(major) = suffix.parse::<u32>() {
            return candidate.version.first() == Some(&major);
        }
        return match suffix {
            "experimental" => name.contains("experimental"),
            "hotfix" => name.contains("hotfix"),
            _ => false,
        };
    }
    name == tool
}

fn find_runtime(libraries: &[SteamLibrary]) -> Option<PathBuf> {
    let mut candidates: Vec<((u8, Vec<u32>), String, PathBuf)> = Vec::new();
    for library in libraries {
        let Ok(entries) = fs::read_dir(library.steamapps.join("common")) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.to_ascii_lowercase().starts_with("steamlinuxruntime") {
                continue;
            }
            let entry_point = entry.path().join("_v2-entry-point");
            if entry_point.is_file() {
                candidates.push((runtime_rank(&name), name.to_ascii_lowercase(), entry_point));
            }
        }
    }
    candidates
        .into_iter()
        .max_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)))
        .map(|(_, _, entry_point)| entry_point)
}

fn runtime_rank(name: &str) -> (u8, Vec<u32>) {
    let lower = name.to_ascii_lowercase();
    if let Some(suffix) = lower.strip_prefix("steamlinuxruntime_") {
        if let Ok(number) = suffix.parse::<u32>() {
            return (3, vec![number]);
        }
        if suffix == "sniper" {
            return (2, vec![3]);
        }
        if suffix == "soldier" {
            return (1, vec![2]);
        }
    }
    (0, version_numbers(name))
}

fn version_numbers(name: &str) -> Vec<u32> {
    let mut numbers = Vec::new();
    let mut current = String::new();
    for character in name.chars() {
        if character.is_ascii_digit() {
            current.push(character);
        } else if !current.is_empty() {
            numbers.push(current.parse().unwrap_or(u32::MAX));
            current.clear();
        }
    }
    if !current.is_empty() {
        numbers.push(current.parse().unwrap_or(u32::MAX));
    }
    numbers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::LocationSource;
    use crate::test_support::TempDir;

    fn write(path: &Path, contents: impl AsRef<[u8]>) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn library(root: &Path) -> SteamLibrary {
        SteamLibrary {
            root: root.to_path_buf(),
            library: root.to_path_buf(),
            steamapps: root.join("steamapps"),
        }
    }

    fn fixture(dir: &TempDir) -> (SteamLibrary, GameLocation) {
        let root = dir.path().join("Steam");
        let game = root
            .join("steamapps")
            .join("common")
            .join("Total War WARHAMMER III");
        write(&game.join("data").join("data.pack"), b"pack");
        write(&game.join(WH3_EXE_NAME), b"exe");
        fs::create_dir_all(
            root.join("steamapps")
                .join("compatdata")
                .join(WH3_APP_ID)
                .join("pfx"),
        )
        .unwrap();
        write(
            &root.join("config").join("config.vdf"),
            r#""InstallConfigStore"
{
    "Software"
    {
        "Valve"
        {
            "Steam"
            {
                "CompatToolMapping"
                {
                    "1142710"
                    {
                        "name" "proton_9"
                        "config" ""
                        "Priority" "250"
                    }
                }
            }
        }
    }
}"#,
        );
        let location = GameLocation {
            game_path: game.clone(),
            data_path: game.join("data"),
            workshop_path: PathBuf::new(),
            steam_root: root.clone(),
            proton_prefix: Some(
                root.join("steamapps")
                    .join("compatdata")
                    .join(WH3_APP_ID)
                    .join("pfx"),
            ),
            source: LocationSource::Manual,
        };
        (library(&root), location)
    }

    #[test]
    fn compat_tool_mapping_is_read_case_insensitively() {
        let text = r#""installconfigstore"
{
    "software"
    {
        "valve"
        {
            "steam"
            {
                "compattoolmapping"
                {
                    "1142710" { "name" "proton_11" }
                }
            }
        }
    }
}"#;
        assert_eq!(compat_tool_name(text).as_deref(), Some("proton_11"));
        assert_eq!(compat_tool_name("not vdf"), None);
    }

    #[test]
    fn resolve_reads_the_mapped_proton_runtime_and_prefix() {
        let dir = TempDir::new("proton-resolve");
        let (library, location) = fixture(&dir);
        write(
            &dir.path()
                .join("Steam")
                .join("steamapps")
                .join("common")
                .join("Proton 9.0")
                .join("proton"),
            b"#!/bin/sh",
        );
        write(
            &dir.path()
                .join("Steam")
                .join("steamapps")
                .join("common")
                .join("Proton 11.0")
                .join("proton"),
            b"#!/bin/sh",
        );
        for runtime in ["SteamLinuxRuntime_soldier", "SteamLinuxRuntime_sniper"] {
            write(
                &dir.path()
                    .join("Steam")
                    .join("steamapps")
                    .join("common")
                    .join(runtime)
                    .join("_v2-entry-point"),
                b"#!/bin/sh",
            );
        }

        let toolchain = resolve(&location, &[library], Some("proton_9")).unwrap();
        let common = dir.path().join("Steam").join("steamapps").join("common");
        assert_eq!(toolchain.proton, common.join("Proton 9.0").join("proton"));
        assert_eq!(
            toolchain.runtime,
            Some(
                common
                    .join("SteamLinuxRuntime_sniper")
                    .join("_v2-entry-point")
            )
        );
        assert_eq!(
            toolchain.compat_data,
            dir.path()
                .join("Steam")
                .join("steamapps")
                .join("compatdata")
                .join(WH3_APP_ID)
        );
    }

    #[test]
    fn direct_command_uses_runtime_proton_and_the_mod_list_argument() {
        let dir = TempDir::new("proton-command");
        let toolchain = ProtonToolchain {
            steam_root: dir.path().join("Steam"),
            proton: dir.path().join("Proton 9.0").join("proton"),
            runtime: Some(dir.path().join("runtime").join("_v2-entry-point")),
            compat_data: dir.path().join("compatdata").join(WH3_APP_ID),
            game_dir: dir.path().join("game"),
        };
        let options = LaunchOptions {
            skip_intro: true,
            script_logging: false,
        };
        let command = toolchain.command(options);
        let game_exe = toolchain.game_dir.join(WH3_EXE_NAME);

        assert_eq!(command.method, LaunchMethod::Direct);
        assert_eq!(
            command.executable,
            dir.path().join("runtime/_v2-entry-point")
        );
        assert_eq!(
            command.args,
            vec![
                OsString::from("--verb=waitforexitandrun"),
                OsString::from("--"),
                toolchain.proton.as_os_str().to_os_string(),
                OsString::from("waitforexitandrun"),
                game_exe.into_os_string(),
                OsString::from(MOD_LIST_ARGUMENT),
            ]
        );
        assert_eq!(command.working_dir, Some(toolchain.game_dir.clone()));
        assert!(command.options.skip_intro);

        let env: std::collections::BTreeMap<_, _> = command
            .env
            .iter()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.to_string_lossy().into_owned(),
                )
            })
            .collect();
        assert_eq!(env["STEAM_COMPAT_APP_ID"], WH3_APP_ID);
        assert_eq!(env["SteamAppId"], WH3_APP_ID);
        assert_eq!(env["SteamGameId"], WH3_APP_ID);
        assert_eq!(
            env["STEAM_COMPAT_CLIENT_INSTALL_PATH"],
            toolchain.steam_root.to_string_lossy()
        );
        assert_eq!(
            env["STEAM_COMPAT_DATA_PATH"],
            toolchain.compat_data.to_string_lossy()
        );
        assert_eq!(
            env["STEAM_COMPAT_INSTALL_PATH"],
            toolchain.game_dir.to_string_lossy()
        );
    }

    #[test]
    fn direct_command_without_a_runtime_invokes_proton() {
        let dir = TempDir::new("proton-command-no-runtime");
        let proton = dir.path().join("Proton 9.0").join("proton");
        let toolchain = ProtonToolchain {
            steam_root: dir.path().join("Steam"),
            proton: proton.clone(),
            runtime: None,
            compat_data: dir.path().join("compatdata").join(WH3_APP_ID),
            game_dir: dir.path().join("game"),
        };
        let command = toolchain.command(LaunchOptions::default());
        assert_eq!(command.executable, proton);
        assert_eq!(command.args.len(), 3);
        assert_eq!(command.args[0], OsString::from("waitforexitandrun"));
        assert_eq!(command.args[2], OsString::from(MOD_LIST_ARGUMENT));
    }

    #[test]
    fn missing_prefix_is_a_resolution_error() {
        let dir = TempDir::new("proton-no-prefix");
        let (library, mut location) = fixture(&dir);
        fs::remove_dir_all(
            dir.path()
                .join("Steam")
                .join("steamapps")
                .join("compatdata"),
        )
        .unwrap();
        location.proton_prefix = None;
        write(
            &dir.path()
                .join("Steam")
                .join("steamapps")
                .join("common")
                .join("Proton 9.0")
                .join("proton"),
            b"#!/bin/sh",
        );

        let error = resolve(&location, &[library], None).unwrap_err();
        assert!(error.reason.contains("Proton prefix"), "{error}");
    }

    #[test]
    fn missing_proton_is_a_resolution_error() {
        let dir = TempDir::new("proton-no-tool");
        let (library, location) = fixture(&dir);
        let error = resolve(&location, &[library], None).unwrap_err();
        assert!(error.reason.contains("no Proton installation"), "{error}");
    }

    #[test]
    fn resolve_from_disk_reads_the_compat_mapping() {
        let dir = TempDir::new("proton-disk");
        let (_, location) = fixture(&dir);
        let common = dir.path().join("Steam").join("steamapps").join("common");
        write(&common.join("Proton 9.0").join("proton"), b"#!/bin/sh");
        write(&common.join("Proton 11.0").join("proton"), b"#!/bin/sh");
        write(
            &common
                .join("SteamLinuxRuntime_soldier")
                .join("_v2-entry-point"),
            b"#!/bin/sh",
        );

        let toolchain = resolve_from_disk(&location).unwrap();
        assert_eq!(toolchain.proton, common.join("Proton 9.0").join("proton"));
        assert_eq!(
            toolchain.runtime,
            Some(
                common
                    .join("SteamLinuxRuntime_soldier")
                    .join("_v2-entry-point")
            )
        );
    }
}
