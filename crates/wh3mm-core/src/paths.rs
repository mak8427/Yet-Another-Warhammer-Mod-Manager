//! Steam library discovery, WH3 location detection, and the manual override.
//!
//! The parser and the location rules are pure so fixtures can exercise them on
//! Linux CI. Platform discovery (registry, Flatpak/Snap locations) only supplies
//! candidate roots; it never contains business logic.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, ErrorCode};
use crate::ipc::{GameLocation as IpcGameLocation, LocationSource};

pub const WH3_APP_ID: &str = "1142710";
pub const WH3_GAME_DIR_NAME: &str = "Total War WARHAMMER III";
pub const WH3_EXE_NAME: &str = "Warhammer3.exe";

/// Value tree produced by the small VDF parser used for `libraryfolders.vdf`
/// and Steam app manifests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VdfValue {
    String(String),
    Object(BTreeMap<String, VdfValue>),
}

impl VdfValue {
    pub fn as_object(&self) -> Option<&BTreeMap<String, VdfValue>> {
        match self {
            Self::Object(values) => Some(values),
            Self::String(_) => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            Self::Object(_) => None,
        }
    }
}

/// Parses the subset of Valve Data Format used by Steam: nested objects,
/// quoted strings, unquoted tokens, `//` comments, and backslash escapes.
pub fn parse_vdf(text: &str) -> Result<VdfValue, AppError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut parser = VdfParser::new(text);
    let mut root = BTreeMap::new();
    while !parser.at_end() {
        let key = parser.next_token()?;
        let value = parser.next_value()?;
        root.insert(key, value);
    }
    Ok(VdfValue::Object(root))
}

struct VdfParser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl<'a> VdfParser<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            chars: text.chars().peekable(),
        }
    }

    fn at_end(&mut self) -> bool {
        self.skip_trivia();
        self.chars.peek().is_none()
    }

    fn skip_trivia(&mut self) {
        loop {
            while matches!(self.chars.peek(), Some(c) if c.is_whitespace()) {
                self.chars.next();
            }
            if self.chars.peek() == Some(&'/') {
                let mut clone = self.chars.clone();
                clone.next();
                if clone.peek() == Some(&'/') {
                    self.chars.next();
                    self.chars.next();
                    for c in self.chars.by_ref() {
                        if c == '\n' {
                            break;
                        }
                    }
                    continue;
                }
            }
            break;
        }
    }

    fn next_token(&mut self) -> Result<String, AppError> {
        self.skip_trivia();
        match self.chars.peek().copied() {
            None => Err(AppError::corrupt("VDF ended before a key")),
            Some('"') => self.next_quoted(),
            Some('{') | Some('}') => Err(AppError::corrupt(
                "VDF object brace where a key was expected",
            )),
            Some(_) => {
                let mut token = String::new();
                while let Some(c) = self.chars.peek().copied() {
                    if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                        break;
                    }
                    token.push(c);
                    self.chars.next();
                }
                if token.is_empty() {
                    Err(AppError::corrupt("VDF contained an empty token"))
                } else {
                    Ok(token)
                }
            }
        }
    }

    fn next_quoted(&mut self) -> Result<String, AppError> {
        if self.chars.next() != Some('"') {
            return Err(AppError::corrupt("VDF string was not quoted"));
        }
        let mut value = String::new();
        while let Some(c) = self.chars.next() {
            match c {
                '"' => return Ok(value),
                '\\' => match self.chars.next() {
                    Some('n') => value.push('\n'),
                    Some('t') => value.push('\t'),
                    Some('r') => value.push('\r'),
                    Some('\\') => value.push('\\'),
                    Some('"') => value.push('"'),
                    Some(other) => value.push(other),
                    None => return Err(AppError::corrupt("VDF escape at end of file")),
                },
                other => value.push(other),
            }
        }
        Err(AppError::corrupt("VDF string was not terminated"))
    }

    fn next_value(&mut self) -> Result<VdfValue, AppError> {
        self.skip_trivia();
        match self.chars.peek().copied() {
            Some('{') => {
                self.chars.next();
                let mut values = BTreeMap::new();
                loop {
                    self.skip_trivia();
                    match self.chars.peek().copied() {
                        Some('}') => {
                            self.chars.next();
                            return Ok(VdfValue::Object(values));
                        }
                        None => return Err(AppError::corrupt("VDF object was not closed")),
                        _ => {
                            let key = self.next_token()?;
                            let value = self.next_value()?;
                            values.insert(key, value);
                        }
                    }
                }
            }
            Some('"') => Ok(VdfValue::String(self.next_quoted()?)),
            Some(_) => {
                let mut token = String::new();
                while let Some(c) = self.chars.peek().copied() {
                    if c.is_whitespace() || c == '{' || c == '}' {
                        break;
                    }
                    token.push(c);
                    self.chars.next();
                }
                if token.is_empty() {
                    Err(AppError::corrupt("VDF contained an empty value"))
                } else {
                    Ok(VdfValue::String(token))
                }
            }
            None => Err(AppError::corrupt("VDF ended before a value")),
        }
    }
}

/// Extracts library paths from a `libraryfolders.vdf` document.
///
/// Supports both the modern `"0" { "path" "..." }` shape and the legacy
/// `"1" "D:\\SteamLibrary"` shape. Relative paths are resolved against `base`.
pub fn library_paths_from_vdf(text: &str, base: &Path) -> Result<Vec<PathBuf>, AppError> {
    let root = parse_vdf(text)?;
    let mut paths = Vec::new();

    fn visit(value: &VdfValue, base: &Path, paths: &mut Vec<PathBuf>) {
        match value {
            VdfValue::Object(values) => {
                for (key, child) in values {
                    if key.eq_ignore_ascii_case("path") || key.chars().all(|c| c.is_ascii_digit()) {
                        if let Some(path) = child.as_str() {
                            push_path(paths, path, base);
                        }
                    }
                    visit(child, base, paths);
                }
            }
            VdfValue::String(_) => {}
        }
    }

    visit(&root, base, &mut paths);
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(path_key(path)));
    Ok(paths)
}

fn push_path(paths: &mut Vec<PathBuf>, raw: &str, base: &Path) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    let candidate = PathBuf::from(trimmed);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        base.join(candidate)
    };
    paths.push(lexical_absolute(&absolute));
}

/// Reads the `installdir` value from a Steam app manifest (`appmanifest_*.acf`).
pub fn installed_dir_from_manifest(text: &str) -> Result<Option<String>, AppError> {
    let root = parse_vdf(text)?;
    fn find(value: &VdfValue, wanted: &str) -> Option<String> {
        match value {
            VdfValue::Object(values) => {
                for (key, child) in values {
                    if key.eq_ignore_ascii_case(wanted) {
                        if let Some(found) = child.as_str() {
                            return Some(found.to_string());
                        }
                    }
                    if let Some(found) = find(child, wanted) {
                        return Some(found);
                    }
                }
                None
            }
            VdfValue::String(_) => None,
        }
    }
    Ok(find(&root, "installdir"))
}

/// A Steam library and the Steam installation root that listed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamLibrary {
    /// Steam root that owns this library (`root/steamapps` exists there).
    pub root: PathBuf,
    /// Library directory that contains `steamapps`.
    pub library: PathBuf,
    pub steamapps: PathBuf,
}

/// Diagnostics for the detection screen.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DetectionReport {
    pub steam_roots: Vec<PathBuf>,
    pub libraries: Vec<PathBuf>,
    pub missing_libraries: Vec<PathBuf>,
    pub problems: Vec<String>,
}

/// A resolved game and the library it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameLocation {
    pub game_path: PathBuf,
    pub data_path: PathBuf,
    pub workshop_path: PathBuf,
    pub steam_root: PathBuf,
    pub proton_prefix: Option<PathBuf>,
    pub source: LocationSource,
}

impl GameLocation {
    pub fn to_ipc(&self) -> IpcGameLocation {
        IpcGameLocation {
            game_path: display_path(&self.game_path),
            data_path: display_path(&self.data_path),
            workshop_path: display_path(&self.workshop_path),
            steam_root: display_path(&self.steam_root),
            proton_prefix: self.proton_prefix.as_ref().map(|path| display_path(path)),
            source: self.source,
        }
    }
}

fn display_path(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        String::new()
    } else {
        path.to_string_lossy().into_owned()
    }
}

/// Candidate Steam roots for the current platform.
pub fn default_steam_root_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(value) = std::env::var("STEAM_ROOT") {
        if !value.trim().is_empty() {
            candidates.push(PathBuf::from(value));
        }
    }

    #[cfg(windows)]
    {
        candidates.extend(registry_steam_paths());
        if let Some(program_files) = std::env::var_os("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(program_files).join("Steam"));
        }
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("Steam"));
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            candidates.push(home.join(".steam").join("steam"));
            candidates.push(home.join(".steam").join("root"));
            candidates.push(home.join(".steam").join("debian-installation"));
            candidates.push(home.join(".local").join("share").join("Steam"));
            candidates.push(
                home.join(".var")
                    .join("app")
                    .join("com.valvesoftware.Steam")
                    .join(".local")
                    .join("share")
                    .join("Steam"),
            );
            candidates.push(
                home.join("snap")
                    .join("steam")
                    .join("common")
                    .join(".local")
                    .join("share")
                    .join("Steam"),
            );
        }
        if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
            candidates.push(PathBuf::from(data_home).join("Steam"));
        }
    }

    dedupe_paths(candidates)
}

#[cfg(windows)]
fn registry_steam_paths() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut paths = Vec::new();
    let candidates = [
        (HKEY_CURRENT_USER, "Software\\Valve\\Steam", "SteamPath"),
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\WOW6432Node\\Valve\\Steam",
            "InstallPath",
        ),
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\Valve\\Steam", "InstallPath"),
    ];
    for (hive, key_path, value_name) in candidates {
        if let Ok(key) = RegKey::predef(hive).open_subkey(key_path) {
            if let Ok(value) = key.get_value::<String, _>(value_name) {
                if !value.trim().is_empty() {
                    paths.push(PathBuf::from(value));
                }
            }
        }
    }
    paths
}

/// Keeps only roots that actually contain a `steamapps` directory.
pub fn discover_steam_roots(candidates: &[PathBuf]) -> Vec<PathBuf> {
    dedupe_paths(
        candidates
            .iter()
            .filter(|path| path.join("steamapps").is_dir())
            .cloned()
            .collect(),
    )
}

/// Reads every library listed by the supplied Steam roots.
pub fn discover_libraries(roots: &[PathBuf]) -> (Vec<SteamLibrary>, DetectionReport) {
    let mut report = DetectionReport {
        steam_roots: roots.to_vec(),
        ..DetectionReport::default()
    };
    let mut libraries: Vec<SteamLibrary> = Vec::new();
    let mut seen = HashSet::new();

    for root in roots {
        let steamapps = root.join("steamapps");
        if !steamapps.is_dir() {
            report.problems.push(format!(
                "Steam root has no steamapps directory: {}",
                root.display()
            ));
            continue;
        }
        push_library(
            &mut libraries,
            &mut seen,
            root.clone(),
            root.clone(),
            steamapps,
        );

        let vdf_candidates = [
            root.join("steamapps").join("libraryfolders.vdf"),
            root.join("config").join("libraryfolders.vdf"),
        ];
        for vdf_path in vdf_candidates {
            let Ok(text) = fs::read_to_string(&vdf_path) else {
                continue;
            };
            match library_paths_from_vdf(&text, root) {
                Ok(paths) => {
                    for library in paths {
                        let library_steamapps = library.join("steamapps");
                        if library_steamapps.is_dir() {
                            push_library(
                                &mut libraries,
                                &mut seen,
                                root.clone(),
                                library,
                                library_steamapps,
                            );
                        } else {
                            report.missing_libraries.push(library);
                        }
                    }
                }
                Err(error) => report.problems.push(format!(
                    "Could not parse {}: {}",
                    vdf_path.display(),
                    error.message
                )),
            }
        }
    }

    report.libraries = libraries
        .iter()
        .map(|library| library.library.clone())
        .collect();
    let mut unseen_missing = HashSet::new();
    report
        .missing_libraries
        .retain(|path| unseen_missing.insert(path_key(path)));
    (libraries, report)
}

fn push_library(
    libraries: &mut Vec<SteamLibrary>,
    seen: &mut HashSet<String>,
    root: PathBuf,
    library: PathBuf,
    steamapps: PathBuf,
) {
    let library = lexical_absolute(&library);
    if !seen.insert(path_key(&library)) {
        return;
    }
    libraries.push(SteamLibrary {
        root,
        library,
        steamapps,
    });
}

/// Finds WH3 in the discovered libraries.
pub fn detect_game(libraries: &[SteamLibrary]) -> Option<GameLocation> {
    libraries
        .iter()
        .find_map(|library| locate_in_library(library).ok())
}

fn locate_in_library(library: &SteamLibrary) -> Result<GameLocation, AppError> {
    let common = library.steamapps.join("common");
    let manifest = library
        .steamapps
        .join(format!("appmanifest_{WH3_APP_ID}.acf"));
    let mut candidates = Vec::new();
    if let Ok(text) = fs::read_to_string(&manifest) {
        if let Ok(Some(installdir)) = installed_dir_from_manifest(&text) {
            candidates.push(common.join(installdir));
        }
    }
    candidates.push(common.join(WH3_GAME_DIR_NAME));
    if let Ok(entries) = fs::read_dir(&common) {
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(WH3_GAME_DIR_NAME)
            {
                candidates.push(entry.path());
            }
        }
    }

    for candidate in candidates {
        if is_wh3_game_dir(&candidate) {
            return Ok(location_for_game_dir(
                &candidate,
                Some(&library.steamapps),
                Some(&library.root),
                LocationSource::Auto,
            ));
        }
    }

    Err(AppError::new(
        ErrorCode::GameNotFound,
        "Total War: Warhammer III is not installed in this Steam library",
    ))
}

fn is_wh3_game_dir(path: &Path) -> bool {
    path.is_dir() && path.join("data").is_dir()
}

fn location_for_game_dir(
    game_path: &Path,
    steamapps: Option<&Path>,
    steam_root: Option<&Path>,
    source: LocationSource,
) -> GameLocation {
    let game_path = lexical_absolute(game_path);
    let data_path = game_path.join("data");
    let workshop_path = steamapps
        .map(|steamapps| steamapps.join("workshop").join("content").join(WH3_APP_ID))
        .unwrap_or_default();
    let proton_prefix = steamapps
        .map(|steamapps| steamapps.join("compatdata").join(WH3_APP_ID).join("pfx"))
        .filter(|path| path.is_dir());
    GameLocation {
        game_path,
        data_path,
        workshop_path,
        steam_root: steam_root.map(lexical_absolute).unwrap_or_default(),
        proton_prefix,
        source,
    }
}

/// Builds a location from the user's manual game-folder choice.
///
/// Accepts the game folder (the one containing `data`) or the `data` folder
/// itself. The folder must contain a `data` directory before it is accepted.
pub fn game_location_from_manual(path: &Path) -> Result<GameLocation, AppError> {
    let path = lexical_absolute(path);
    let game_path = if path.file_name().is_some_and(|name| name == "data") {
        path.parent().map(Path::to_path_buf).unwrap_or(path.clone())
    } else {
        path.clone()
    };
    if !is_wh3_game_dir(&game_path) {
        return Err(AppError::validation(
            "That folder does not look like a Total War: Warhammer III installation",
        )
        .with_details(format!(
            "Expected a data directory under {}",
            game_path.display()
        )));
    }

    let steamapps = game_path
        .ancestors()
        .find(|ancestor| ancestor.file_name().is_some_and(|name| name == "steamapps"))
        .map(Path::to_path_buf);
    let steam_root = steamapps
        .as_ref()
        .and_then(|steamapps| steamapps.parent())
        .map(Path::to_path_buf);

    Ok(location_for_game_dir(
        &game_path,
        steamapps.as_deref(),
        steam_root.as_deref(),
        LocationSource::Manual,
    ))
}

/// Full auto-detection entry point used by the session.
pub fn autodetect(candidates: &[PathBuf]) -> (Option<GameLocation>, DetectionReport) {
    let roots = discover_steam_roots(candidates);
    let (libraries, report) = discover_libraries(&roots);
    let location = detect_game(&libraries);
    (location, report)
}

/// True when the path can serve as a WH3 game directory.
pub fn is_valid_game_dir(path: &Path) -> bool {
    is_wh3_game_dir(path)
}

/// Lexically normalizes a path to an absolute path without resolving symlinks.
/// `.` components are removed and `..` is applied lexically.
pub fn lexical_absolute(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    strip_verbatim_prefix(normalized)
}

#[cfg(windows)]
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path
    }
}

#[cfg(not(windows))]
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    path
}

fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        text.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        text
    }
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .map(|path| lexical_absolute(&path))
        .filter(|path| seen.insert(path_key(path)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn escape_vdf_path(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "\\\\")
    }

    #[test]
    fn parses_modern_library_folders() {
        let dir = crate::test_support::TempDir::new("vdf-modern");
        let base = dir.path();
        let first = base.join("games").join("Steam");
        let second = base.join("mnt").join("SteamLibrary");
        let missing = base.join("missing").join("SteamLibrary");
        let text = format!(
            r#""libraryfolders"
{{
    "0" {{ "path" "{}" "contentstatsid" "123" }}
    "1" {{ "path" "{}" }}
    "2" {{ "path" "{}" }}
}}"#,
            escape_vdf_path(&first),
            escape_vdf_path(&second),
            escape_vdf_path(&missing)
        );
        let paths = library_paths_from_vdf(&text, base).unwrap();
        assert_eq!(paths, vec![first, second, missing]);
    }

    #[test]
    fn parses_legacy_library_folders() {
        let dir = crate::test_support::TempDir::new("vdf-legacy");
        let base = dir.path();
        let absolute = base.join("old").join("SteamLibrary");
        let text = format!(
            r#""LibraryFolders"
{{
    "TimeNextStatsReport" "123"
    "1" "{}"
    "2" "relative/lib"
}}"#,
            escape_vdf_path(&absolute)
        );
        let paths = library_paths_from_vdf(&text, base).unwrap();
        assert_eq!(paths, vec![absolute, base.join("relative/lib")]);
    }

    #[test]
    fn relative_paths_resolve_against_the_vdf_base() {
        let dir = crate::test_support::TempDir::new("vdf-relative");
        let text = r#""libraryfolders" { "0" { "path" "relative/lib" } }"#;
        let paths = library_paths_from_vdf(text, dir.path()).unwrap();
        assert_eq!(paths, vec![dir.path().join("relative/lib")]);
    }

    #[test]
    fn rejects_malformed_vdf() {
        assert!(library_paths_from_vdf(r#""libraryfolders" { "#, Path::new(".")).is_err());
        assert!(
            library_paths_from_vdf(r#""libraryfolders" "unterminated"#, Path::new(".")).is_err()
        );
    }

    #[test]
    fn reads_installdir_from_manifest() {
        let text = r#"
"AppState"
{
    "appid" "1142710"
    "installdir" "Total War WARHAMMER III"
    "StateFlags" "4"
}
"#;
        assert_eq!(
            installed_dir_from_manifest(text).unwrap().as_deref(),
            Some("Total War WARHAMMER III")
        );
    }

    #[test]
    fn manual_location_requires_a_data_directory() {
        let dir = crate::test_support::TempDir::new("manual-path");
        let error = game_location_from_manual(dir.path()).unwrap_err();
        assert_eq!(error.code, ErrorCode::Validation);

        std::fs::create_dir_all(dir.path().join("data")).unwrap();
        let location = game_location_from_manual(dir.path()).unwrap();
        assert_eq!(location.source, LocationSource::Manual);
        assert_eq!(location.data_path, dir.path().join("data"));
    }
}
