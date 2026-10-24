//! Direct Proton launch resolution for Linux.
//!
//! Starting WH3 through Steam hands it to Creative Assembly's launcher, which
//! can rewrite `used_mods.txt` before the game reads it. This module resolves the
//! Steam root, the existing compatibility data, the configured Proton, and the
//! Steam Linux Runtime so the game can be started directly with the manager's
//! mod-list argument. It deliberately never creates a Proton prefix.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, ErrorCode};
use crate::paths::{self, SteamLibrary, VdfValue, WH3_EXE_NAME};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProtonLaunch {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub working_dir: PathBuf,
}

pub(crate) fn resolve(
    game_path: &Path,
    proton_prefix: Option<&Path>,
    steam_roots: &[PathBuf],
    steam_id: &str,
    game_args: &[String],
    linux: bool,
) -> Result<Option<ProtonLaunch>, AppError> {
    if !linux {
        return Ok(None);
    }

    let (steam_root, libraries) = select_steam_root(game_path, steam_roots)?;
    let game_exe = game_path.join(WH3_EXE_NAME);
    let exe_exists = game_exe.is_file();
    let compat_tool = read_compat_tool_name(&steam_root, steam_id);
    let proton_like = compat_tool.as_deref().is_some_and(is_proton_tool);

    if !exe_exists && !proton_like {
        return Err(AppError::new(
            ErrorCode::ProtonNotConfigured,
            "Steam is not configured to run Warhammer III through Proton and Warhammer3.exe was not found",
        )
        .with_details(format!(
            "compatibility tool for {steam_id}: {compat_tool:?}; expected {}",
            game_exe.display()
        )));
    }
    if !exe_exists {
        return Err(AppError::new(
            ErrorCode::GameNotFound,
            "The Warhammer III executable was not found",
        )
        .with_details(format!("expected {}", game_exe.display())));
    }

    let compat_data = compat_data_dir(game_path, proton_prefix, steam_id).ok_or_else(|| {
        let expected = game_path
            .ancestors()
            .find(|path| path.file_name().is_some_and(|name| name == "steamapps"))
            .map(|steamapps| steamapps.join("compatdata").join(steam_id));
        AppError::new(
            ErrorCode::CompatDataMissing,
            "No Proton compatibility data exists for Warhammer III; start it through Steam/Proton once",
        )
        .with_details(format!(
            "expected {}; proton prefix: {}",
            expected
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "<no steamapps ancestor>".to_string()),
            proton_prefix
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "<none>".to_string())
        ))
    })?;

    let protons = find_proton_directories(&libraries);
    if protons.is_empty() {
        return Err(AppError::new(
            ErrorCode::ProtonNotInstalled,
            "No Proton installation was found in the Steam libraries",
        )
        .with_details(searched_common_details(&libraries, "Proton*/proton")));
    }
    let proton_directory = select_proton(&protons, compat_tool.as_deref()).ok_or_else(|| {
        AppError::new(
            ErrorCode::ProtonNotInstalled,
            "No usable Proton installation was selected",
        )
        .with_details(searched_common_details(&libraries, "Proton*/proton"))
    })?;

    let runtime_entry_point = find_runtime_entry_point(&libraries).ok_or_else(|| {
        AppError::new(
            ErrorCode::ProtonRuntimeMissing,
            "No Steam Linux Runtime entry point was found; direct Proton launch requires it",
        )
        .with_details(searched_common_details(
            &libraries,
            "SteamLinuxRuntime*/_v2-entry-point",
        ))
    })?;

    let proton_script = proton_directory.join("proton");
    let mut args = vec![
        "--verb=waitforexitandrun".to_string(),
        "--".to_string(),
        proton_script.to_string_lossy().into_owned(),
        "waitforexitandrun".to_string(),
        game_exe.to_string_lossy().into_owned(),
    ];
    args.extend(game_args.iter().cloned());

    let mut env = BTreeMap::new();
    env.insert("STEAM_COMPAT_APP_ID".to_string(), steam_id.to_string());
    env.insert(
        "STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(),
        steam_root.to_string_lossy().into_owned(),
    );
    env.insert(
        "STEAM_COMPAT_DATA_PATH".to_string(),
        compat_data.to_string_lossy().into_owned(),
    );
    env.insert(
        "STEAM_COMPAT_INSTALL_PATH".to_string(),
        game_path.to_string_lossy().into_owned(),
    );
    env.insert("SteamAppId".to_string(), steam_id.to_string());
    env.insert("SteamGameId".to_string(), steam_id.to_string());

    Ok(Some(ProtonLaunch {
        executable: runtime_entry_point,
        args,
        env,
        working_dir: game_path.to_path_buf(),
    }))
}

fn select_steam_root(
    game_path: &Path,
    steam_roots: &[PathBuf],
) -> Result<(PathBuf, Vec<SteamLibrary>), AppError> {
    let mut best: Option<(u8, PathBuf, Vec<SteamLibrary>)> = None;
    let mut seen = HashSet::new();

    for candidate in steam_roots {
        let root = paths::lexical_absolute(candidate);
        if !seen.insert(root.clone()) {
            continue;
        }
        let (libraries, _) = paths::discover_libraries(std::slice::from_ref(&root));
        if !libraries
            .iter()
            .any(|library| game_path.starts_with(&library.steamapps))
        {
            continue;
        }
        let score = if root.join("config").join("config.vdf").is_file() {
            2
        } else if root.join("steamapps").join("libraryfolders.vdf").is_file() {
            1
        } else {
            0
        };
        if score == 0 {
            continue;
        }
        let replace = match &best {
            Some((best_score, _, _)) => score > *best_score,
            None => true,
        };
        if replace {
            best = Some((score, root, libraries));
        }
    }

    best.map(|(_, root, libraries)| (root, libraries))
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::SteamNotFound,
                "Steam could not be located for the direct Proton launch",
            )
            .with_details(format!(
                "{} is not inside a Steam library discovered from {}",
                game_path.display(),
                steam_roots
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
}

fn read_compat_tool_name(steam_root: &Path, steam_id: &str) -> Option<String> {
    let text = fs::read_to_string(steam_root.join("config").join("config.vdf")).ok()?;
    let root = paths::parse_vdf(&text).ok()?;
    let install = object_get(root.as_object()?, "InstallConfigStore")?.as_object()?;
    let software = object_get(install, "Software")?.as_object()?;
    let valve = object_get(software, "Valve")?.as_object()?;
    let steam = object_get(valve, "Steam")?.as_object()?;
    let mapping = object_get(steam, "CompatToolMapping")?.as_object()?;
    object_get(mapping, steam_id)?
        .as_object()
        .and_then(|entry| object_get(entry, "name"))
        .and_then(VdfValue::as_str)
        .map(str::to_string)
}

fn object_get<'a>(object: &'a BTreeMap<String, VdfValue>, key: &str) -> Option<&'a VdfValue> {
    object
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
        .map(|(_, value)| value)
}

fn is_proton_tool(name: &str) -> bool {
    name.to_lowercase().contains("proton")
}

fn compat_data_dir(
    game_path: &Path,
    proton_prefix: Option<&Path>,
    steam_id: &str,
) -> Option<PathBuf> {
    if let Some(prefix) = proton_prefix {
        if let Some(parent) = prefix.parent() {
            if parent.is_dir() {
                return Some(parent.to_path_buf());
            }
        }
    }

    let steamapps = game_path
        .ancestors()
        .find(|path| path.file_name().is_some_and(|name| name == "steamapps"))?;
    let candidate = steamapps.join("compatdata").join(steam_id);
    candidate.is_dir().then_some(candidate)
}

fn find_proton_directories(libraries: &[SteamLibrary]) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    for library in libraries {
        let common = library.steamapps.join("common");
        let Ok(entries) = fs::read_dir(&common) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("Proton") {
                continue;
            }
            let directory = entry.path();
            if directory.join("proton").is_file() {
                directories.push(directory);
            }
        }
    }
    sort_protons(&mut directories);
    directories
}

fn sort_protons(directories: &mut [PathBuf]) {
    directories.sort_by(|left, right| {
        let left_name = directory_name(left);
        let right_name = directory_name(right);
        match (
            proton_major_version(&left_name),
            proton_major_version(&right_name),
        ) {
            (Some(left_version), Some(right_version)) => right_version
                .cmp(&left_version)
                .then_with(|| left_name.to_lowercase().cmp(&right_name.to_lowercase())),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => left_name.to_lowercase().cmp(&right_name.to_lowercase()),
        }
    });
}

fn select_proton(directories: &[PathBuf], tool_name: Option<&str>) -> Option<PathBuf> {
    let Some(tool_name) = tool_name else {
        return directories.first().cloned();
    };

    let short_name = tool_name.strip_prefix("proton_").unwrap_or(tool_name);
    let major_digits: String = short_name
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    if let Ok(major) = major_digits.parse::<u32>() {
        if let Some(found) = directories
            .iter()
            .find(|directory| proton_major_version(&directory_name(directory)) == Some(major))
        {
            return Some(found.clone());
        }
    }

    let wanted = short_name.to_lowercase();
    directories
        .iter()
        .find(|directory| directory_name(directory).to_lowercase().contains(&wanted))
        .cloned()
        .or_else(|| directories.first().cloned())
}

fn proton_major_version(name: &str) -> Option<u32> {
    let rest = name.strip_prefix("Proton ")?;
    let digits: String = rest
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

fn find_runtime_entry_point(libraries: &[SteamLibrary]) -> Option<PathBuf> {
    let mut entry_points = Vec::new();
    for library in libraries {
        let common = library.steamapps.join("common");
        let Ok(entries) = fs::read_dir(&common) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("SteamLinuxRuntime") {
                continue;
            }
            let entry_point = entry.path().join("_v2-entry-point");
            if entry_point.is_file() {
                entry_points.push(entry_point);
            }
        }
    }
    entry_points.sort_by(|left, right| {
        runtime_rank(right)
            .cmp(&runtime_rank(left))
            .then_with(|| left.cmp(right))
    });
    entry_points.into_iter().next()
}

fn runtime_rank(entry_point: &Path) -> u32 {
    let name = entry_point
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if let Some(generation) = name
        .strip_prefix("SteamLinuxRuntime_")
        .and_then(|rest| rest.parse::<u32>().ok())
    {
        return 100 + generation;
    }
    if name.contains("sniper") {
        103
    } else if name.contains("soldier") {
        102
    } else {
        101
    }
}

fn directory_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn searched_common_details(libraries: &[SteamLibrary], pattern: &str) -> String {
    let common = libraries
        .iter()
        .map(|library| library.steamapps.join("common").display().to_string())
        .collect::<Vec<_>>();
    format!("searched {pattern} under {}", common.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::test_support::TempDir;
    use std::fs;

    const STEAM_ID: &str = "1142710";

    struct Fixture {
        _dir: TempDir,
        steam_root: PathBuf,
        library: PathBuf,
        game: PathBuf,
        compat_data: PathBuf,
    }

    fn write(path: &Path, contents: impl AsRef<[u8]>) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn escape(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "\\\\")
    }

    fn fixture(name: &str) -> Fixture {
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

        let compat_data = library.join("steamapps").join("compatdata").join(STEAM_ID);
        fs::create_dir_all(&compat_data).unwrap();

        let library_folders = format!(
            "\"libraryfolders\"\n{{\n    \"0\" {{ \"path\" \"{}\" }}\n    \"1\" {{ \"path\" \"{}\" }}\n}}\n",
            escape(&steam_root),
            escape(&library)
        );
        write(
            &steam_root.join("steamapps").join("libraryfolders.vdf"),
            library_folders.as_bytes(),
        );

        Fixture {
            _dir: dir,
            steam_root,
            library,
            game,
            compat_data,
        }
    }

    fn write_config(fixture: &Fixture, tool: &str) {
        let text = format!(
            "\"InstallConfigStore\"\n{{\n    \"Software\"\n    {{\n        \"Valve\"\n        {{\n            \"Steam\"\n            {{\n                \"CompatToolMapping\"\n                {{\n                    \"{STEAM_ID}\"\n                    {{\n                        \"name\" \"{tool}\"\n                    }}\n                }}\n            }}\n        }}\n    }}\n}}\n"
        );
        write(
            &fixture.steam_root.join("config").join("config.vdf"),
            text.as_bytes(),
        );
    }

    fn add_proton(fixture: &Fixture, name: &str) -> PathBuf {
        let directory = fixture.library.join("steamapps").join("common").join(name);
        write(&directory.join("proton"), b"#!/bin/sh\n");
        directory
    }

    fn add_runtime(fixture: &Fixture, name: &str) -> PathBuf {
        let entry_point = fixture
            .library
            .join("steamapps")
            .join("common")
            .join(name)
            .join("_v2-entry-point");
        write(&entry_point, b"#!/bin/sh\n");
        entry_point
    }

    fn resolve_for(
        fixture: &Fixture,
        proton_prefix: Option<&Path>,
    ) -> Result<Option<ProtonLaunch>, AppError> {
        let game_args = vec!["used_mods.txt;".to_string()];
        resolve(
            &fixture.game,
            proton_prefix,
            std::slice::from_ref(&fixture.steam_root),
            STEAM_ID,
            &game_args,
            true,
        )
    }

    fn proton_script(fixture: &Fixture, name: &str) -> String {
        fixture
            .library
            .join("steamapps")
            .join("common")
            .join(name)
            .join("proton")
            .to_string_lossy()
            .into_owned()
    }

    fn game_exe(fixture: &Fixture) -> String {
        fixture
            .game
            .join("Warhammer3.exe")
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn resolves_configured_proton_through_the_newest_runtime() {
        let fixture = fixture("proton-config");
        write_config(&fixture, "proton_11");
        add_proton(&fixture, "Proton 9.0 (Beta)");
        let proton = add_proton(&fixture, "Proton 11.0");
        add_runtime(&fixture, "SteamLinuxRuntime_sniper");
        let runtime = add_runtime(&fixture, "SteamLinuxRuntime_4");

        let launch = resolve_for(&fixture, None).unwrap().unwrap();

        assert_eq!(launch.executable, runtime);
        assert_eq!(
            launch.args,
            vec![
                "--verb=waitforexitandrun".to_string(),
                "--".to_string(),
                proton.join("proton").to_string_lossy().into_owned(),
                "waitforexitandrun".to_string(),
                game_exe(&fixture),
                "used_mods.txt;".to_string(),
            ]
        );
        assert_eq!(launch.working_dir, fixture.game);
        assert_eq!(
            launch.env.get("STEAM_COMPAT_APP_ID").map(String::as_str),
            Some(STEAM_ID)
        );
        assert_eq!(
            launch
                .env
                .get("STEAM_COMPAT_CLIENT_INSTALL_PATH")
                .map(String::as_str),
            Some(fixture.steam_root.to_string_lossy().as_ref())
        );
        assert_eq!(
            launch.env.get("STEAM_COMPAT_DATA_PATH").map(String::as_str),
            Some(fixture.compat_data.to_string_lossy().as_ref())
        );
        assert_eq!(
            launch
                .env
                .get("STEAM_COMPAT_INSTALL_PATH")
                .map(String::as_str),
            Some(fixture.game.to_string_lossy().as_ref())
        );
        assert_eq!(
            launch.env.get("SteamAppId").map(String::as_str),
            Some(STEAM_ID)
        );
        assert_eq!(
            launch.env.get("SteamGameId").map(String::as_str),
            Some(STEAM_ID)
        );
    }

    #[test]
    fn falls_back_to_newest_numbered_proton_when_mapping_is_missing() {
        let fixture = fixture("proton-newest");
        add_proton(&fixture, "Proton 9.0 (Beta)");
        add_proton(&fixture, "Proton 10.0");
        add_proton(&fixture, "Proton - Experimental");
        add_runtime(&fixture, "SteamLinuxRuntime_4");

        let launch = resolve_for(&fixture, None).unwrap().unwrap();
        let expected = proton_script(&fixture, "Proton 10.0");

        assert!(launch.args.iter().any(|argument| argument == &expected));
    }

    #[test]
    fn matches_named_proton_experimental() {
        let fixture = fixture("proton-experimental");
        write_config(&fixture, "proton_experimental");
        add_proton(&fixture, "Proton - Experimental");
        add_runtime(&fixture, "SteamLinuxRuntime_4");

        let launch = resolve_for(&fixture, None).unwrap().unwrap();
        let expected = proton_script(&fixture, "Proton - Experimental");

        assert!(launch.args.iter().any(|argument| argument == &expected));
    }

    #[test]
    fn refuses_direct_launch_without_compatibility_data() {
        let fixture = fixture("proton-no-compatdata");
        write_config(&fixture, "proton_11");
        add_proton(&fixture, "Proton 11.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");
        fs::remove_dir_all(&fixture.compat_data).unwrap();

        let error = resolve_for(&fixture, None).unwrap_err();

        assert_eq!(error.code, ErrorCode::CompatDataMissing);
        assert!(error.details.unwrap_or_default().contains("compatdata"));
    }

    #[test]
    fn returns_proton_not_configured_without_mapping_or_game_exe() {
        let fixture = fixture("proton-unconfigured");
        fs::remove_file(fixture.game.join("Warhammer3.exe")).unwrap();
        add_proton(&fixture, "Proton 11.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");

        let error = resolve_for(&fixture, None).unwrap_err();

        assert_eq!(error.code, ErrorCode::ProtonNotConfigured);
    }

    #[test]
    fn returns_game_not_found_when_mapping_exists_but_exe_is_missing() {
        let fixture = fixture("proton-no-exe");
        write_config(&fixture, "proton_11");
        add_proton(&fixture, "Proton 11.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");
        fs::remove_file(fixture.game.join("Warhammer3.exe")).unwrap();

        let error = resolve_for(&fixture, None).unwrap_err();

        assert_eq!(error.code, ErrorCode::GameNotFound);
    }

    #[test]
    fn returns_proton_not_installed_when_no_proton_directory_exists() {
        let fixture = fixture("proton-none");
        write_config(&fixture, "proton_11");
        add_runtime(&fixture, "SteamLinuxRuntime_4");

        let error = resolve_for(&fixture, None).unwrap_err();

        assert_eq!(error.code, ErrorCode::ProtonNotInstalled);
        assert!(error
            .details
            .unwrap_or_default()
            .contains(&fixture.library.to_string_lossy().to_string()));
    }

    #[test]
    fn returns_proton_runtime_missing_without_runtime() {
        let fixture = fixture("proton-no-runtime");
        write_config(&fixture, "proton_11");
        add_proton(&fixture, "Proton 11.0");

        let error = resolve_for(&fixture, None).unwrap_err();

        assert_eq!(error.code, ErrorCode::ProtonRuntimeMissing);
    }

    #[test]
    fn uses_compatdata_parent_of_pfx() {
        let fixture = fixture("proton-pfx");
        write_config(&fixture, "proton_11");
        add_proton(&fixture, "Proton 11.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");
        let pfx = fixture.compat_data.join("pfx");
        fs::create_dir_all(&pfx).unwrap();

        let launch = resolve_for(&fixture, Some(&pfx)).unwrap().unwrap();

        assert_eq!(
            launch.env.get("STEAM_COMPAT_DATA_PATH").map(String::as_str),
            Some(fixture.compat_data.to_string_lossy().as_ref())
        );
        assert!(!launch
            .env
            .get("STEAM_COMPAT_DATA_PATH")
            .unwrap()
            .ends_with("pfx"));
    }

    #[test]
    fn does_not_use_a_library_root_as_the_steam_client_path() {
        let fixture = fixture("proton-library-root");
        write_config(&fixture, "proton_11");
        add_proton(&fixture, "Proton 11.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");
        let game_args = vec!["used_mods.txt;".to_string()];

        let error = resolve(
            &fixture.game,
            None,
            std::slice::from_ref(&fixture.library),
            STEAM_ID,
            &game_args,
            true,
        )
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::SteamNotFound);
    }

    #[test]
    fn finds_steam_root_from_candidates_for_a_manual_secondary_library() {
        let fixture = fixture("proton-manual-root");
        write_config(&fixture, "proton_11");
        add_proton(&fixture, "Proton 11.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");
        let game_args = vec!["used_mods.txt;".to_string()];

        let launch = resolve(
            &fixture.game,
            None,
            &[fixture.library.clone(), fixture.steam_root.clone()],
            STEAM_ID,
            &game_args,
            true,
        )
        .unwrap()
        .unwrap();

        assert_eq!(
            launch
                .env
                .get("STEAM_COMPAT_CLIENT_INSTALL_PATH")
                .map(String::as_str),
            Some(fixture.steam_root.to_string_lossy().as_ref())
        );
    }

    #[test]
    fn keeps_used_mods_as_one_literal_argument() {
        let fixture = fixture("proton-literal");
        write_config(&fixture, "proton_11");
        add_proton(&fixture, "Proton 11.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");

        let launch = resolve_for(&fixture, None).unwrap().unwrap();

        assert_eq!(
            launch
                .args
                .iter()
                .filter(|argument| argument.as_str() == "used_mods.txt;")
                .count(),
            1
        );
        assert_eq!(launch.args.last().unwrap(), "used_mods.txt;");
        assert!(launch
            .args
            .iter()
            .any(|argument| argument == &game_exe(&fixture)));
    }

    #[test]
    fn malformed_config_falls_back_to_newest_proton() {
        let fixture = fixture("proton-bad-config");
        write(
            &fixture.steam_root.join("config").join("config.vdf"),
            b"\"InstallConfigStore\" {",
        );
        add_proton(&fixture, "Proton 9.0");
        add_proton(&fixture, "Proton 10.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");

        let launch = resolve_for(&fixture, None).unwrap().unwrap();
        let expected = proton_script(&fixture, "Proton 10.0");

        assert!(launch.args.iter().any(|argument| argument == &expected));
    }

    #[test]
    fn custom_tool_falls_back_to_newest_numbered_proton() {
        let fixture = fixture("proton-custom-tool");
        write_config(&fixture, "GE-Proton9-20");
        add_proton(&fixture, "Proton 9.0");
        add_proton(&fixture, "Proton 10.0");
        add_runtime(&fixture, "SteamLinuxRuntime_4");

        let launch = resolve_for(&fixture, None).unwrap().unwrap();
        let expected = proton_script(&fixture, "Proton 10.0");

        assert!(launch.args.iter().any(|argument| argument == &expected));
    }

    #[test]
    fn returns_none_off_linux() {
        let fixture = fixture("proton-windows");
        let game_args = vec!["used_mods.txt;".to_string()];

        let result = resolve(
            &fixture.game,
            None,
            std::slice::from_ref(&fixture.steam_root),
            STEAM_ID,
            &game_args,
            false,
        )
        .unwrap();

        assert!(result.is_none());
    }
}
