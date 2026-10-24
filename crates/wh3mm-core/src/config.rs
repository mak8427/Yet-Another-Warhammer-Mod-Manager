//! Schema-v1 app config: paths, UI preferences, profiles, tags, and mod tags.
//!
//! The config is one JSON document so a profile switch cannot leave a
//! half-written set of files. Mutations are validated on a clone, saved
//! atomically, and only then committed by the session.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::atomic::{atomic_write_no_backup, atomic_write_with_backup};
use crate::clock::now_iso8601;
use crate::error::AppError;
use crate::ipc::{Profile, Tag, UiPreferences};
use crate::launch::LaunchOptions;
use crate::window::WindowGeometry;

pub const SCHEMA_VERSION: u32 = 1;
pub const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsConfig {
    #[serde(default)]
    pub game_path_override: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    #[serde(default)]
    pub paths: PathsConfig,
    #[serde(default)]
    pub ui: UiPreferences,
    /// Last normal window bounds and maximised state. `None` means first run.
    #[serde(default)]
    pub window: Option<WindowGeometry>,
    pub active_profile_id: String,
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub tags: Vec<Tag>,
    #[serde(default)]
    pub mod_tags: BTreeMap<String, Vec<String>>,
    /// Launch options keyed by profile id. Kept in the same document so a
    /// profile switch cannot leave half-written launch state behind.
    #[serde(default)]
    pub launch_options: BTreeMap<String, LaunchOptions>,
}

impl AppConfig {
    pub fn new() -> Self {
        let profile = Profile::new("Default");
        Self {
            schema_version: SCHEMA_VERSION,
            paths: PathsConfig::default(),
            ui: UiPreferences::default(),
            window: None,
            active_profile_id: profile.id.clone(),
            profiles: vec![profile],
            tags: Vec::new(),
            mod_tags: BTreeMap::new(),
            launch_options: BTreeMap::new(),
        }
    }

    pub fn active_profile(&self) -> &Profile {
        self.profiles
            .iter()
            .find(|profile| profile.id == self.active_profile_id)
            .unwrap_or_else(|| &self.profiles[0])
    }

    pub fn active_profile_mut(&mut self) -> &mut Profile {
        let id = self.active_profile_id.clone();
        let index = self.profile_index(&id).unwrap_or(0);
        &mut self.profiles[index]
    }

    pub fn profile_index(&self, id: &str) -> Option<usize> {
        self.profiles.iter().position(|profile| profile.id == id)
    }

    pub fn profile(&self, id: &str) -> Option<&Profile> {
        self.profiles.iter().find(|profile| profile.id == id)
    }

    pub fn set_active_profile(&mut self, id: &str) -> Result<(), AppError> {
        if self.profile_index(id).is_none() {
            return Err(AppError::not_found(format!("Unknown profile {id}")));
        }
        self.active_profile_id = id.to_string();
        Ok(())
    }

    /// Creates or updates a profile. An update may rename it and replace its
    /// enabled set; unknown IDs are the caller's responsibility (the session
    /// preserves temporarily missing mods before calling this).
    pub fn save_profile(
        &mut self,
        profile_id: Option<&str>,
        name: &str,
        enabled_mod_ids: Vec<String>,
    ) -> Result<Profile, AppError> {
        let name = validate_profile_name(name)?;
        self.ensure_unique_profile_name(&name, profile_id)?;
        let enabled_mod_ids = dedupe_ids(enabled_mod_ids);
        let now = now_iso8601();

        if let Some(id) = profile_id.filter(|id| !id.is_empty()) {
            let index = self
                .profile_index(id)
                .ok_or_else(|| AppError::not_found(format!("Unknown profile {id}")))?;
            let profile = &mut self.profiles[index];
            profile.name = name;
            profile.enabled_mod_ids = enabled_mod_ids;
            profile.updated_at = now;
            Ok(profile.clone())
        } else {
            let profile = Profile {
                id: uuid::Uuid::new_v4().to_string(),
                name,
                enabled_mod_ids,
                created_at: now.clone(),
                updated_at: now,
            };
            self.profiles.push(profile.clone());
            Ok(profile)
        }
    }

    pub fn duplicate_profile(&mut self, source_id: &str, name: &str) -> Result<Profile, AppError> {
        let source = self
            .profile(source_id)
            .cloned()
            .ok_or_else(|| AppError::not_found(format!("Unknown profile {source_id}")))?;
        let name = validate_profile_name(name)?;
        self.ensure_unique_profile_name(&name, None)?;
        let now = now_iso8601();
        let duplicate = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            enabled_mod_ids: source.enabled_mod_ids,
            created_at: now.clone(),
            updated_at: now,
        };
        let insert_at = self
            .profile_index(source_id)
            .map(|index| index + 1)
            .unwrap_or(self.profiles.len());
        self.profiles.insert(insert_at, duplicate.clone());
        Ok(duplicate)
    }

    pub fn delete_profile(&mut self, id: &str) -> Result<(), AppError> {
        if self.profiles.len() <= 1 {
            return Err(AppError::validation("The last profile cannot be deleted"));
        }
        let index = self
            .profile_index(id)
            .ok_or_else(|| AppError::not_found(format!("Unknown profile {id}")))?;
        self.profiles.remove(index);
        if self.active_profile_id == id {
            let next = index.min(self.profiles.len() - 1);
            self.active_profile_id = self.profiles[next].id.clone();
        }
        Ok(())
    }

    pub fn create_tag(&mut self, name: &str, color: &str) -> Result<Tag, AppError> {
        let name = validate_tag_name(name)?;
        if self
            .tags
            .iter()
            .any(|tag| tag.name.eq_ignore_ascii_case(&name))
        {
            return Err(AppError::validation(format!(
                "A tag named {name:?} already exists"
            )));
        }
        let color = validate_color(color)?;
        let tag = Tag {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            color,
        };
        self.tags.push(tag.clone());
        Ok(tag)
    }

    pub fn delete_tag(&mut self, tag_id: &str) -> Result<(), AppError> {
        let index = self
            .tags
            .iter()
            .position(|tag| tag.id == tag_id)
            .ok_or_else(|| AppError::not_found(format!("Unknown tag {tag_id}")))?;
        self.tags.remove(index);
        for tag_ids in self.mod_tags.values_mut() {
            tag_ids.retain(|id| id != tag_id);
        }
        self.mod_tags.retain(|_, tag_ids| !tag_ids.is_empty());
        Ok(())
    }

    pub fn set_mod_tags(&mut self, mod_id: &str, tag_ids: Vec<String>) -> Result<(), AppError> {
        for tag_id in &tag_ids {
            if !self.tags.iter().any(|tag| &tag.id == tag_id) {
                return Err(AppError::not_found(format!("Unknown tag {tag_id}")));
            }
        }
        let tag_ids = dedupe_ids(tag_ids);
        if tag_ids.is_empty() {
            self.mod_tags.remove(mod_id);
        } else {
            self.mod_tags.insert(mod_id.to_string(), tag_ids);
        }
        Ok(())
    }

    pub fn update_ui(&mut self, preferences: UiPreferences) {
        self.ui = preferences;
    }

    fn ensure_unique_profile_name(
        &self,
        name: &str,
        except_id: Option<&str>,
    ) -> Result<(), AppError> {
        if self.profiles.iter().any(|profile| {
            Some(profile.id.as_str()) != except_id && profile.name.eq_ignore_ascii_case(name)
        }) {
            return Err(AppError::validation(format!(
                "A profile named {name:?} already exists"
            )));
        }
        Ok(())
    }

    /// Returns the document to the documented defaults while keeping profiles,
    /// tags, mod tags, and launch options. Only the active profile's enabled set
    /// is cleared; other profiles keep their saved sets.
    pub fn reset_to_defaults(&mut self) {
        self.ui = UiPreferences::default();
        self.paths = PathsConfig::default();
        let now = now_iso8601();
        let active = self.active_profile_mut();
        active.enabled_mod_ids.clear();
        active.updated_at = now;
    }

    /// Repairs safe invariants and rejects the ones that would lose data.
    fn validate_and_normalize(mut self) -> Result<(Self, Vec<String>), AppError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(AppError::corrupt(format!(
                "Unsupported config schema version {}",
                self.schema_version
            )));
        }
        if let Some(path) = &self.paths.game_path_override {
            if !path.is_absolute() {
                return Err(AppError::corrupt(
                    "The configured game path override is not absolute",
                ));
            }
        }

        self.ui = self.ui.clone().normalized();
        self.window = self.window.map(WindowGeometry::sane);

        if self.profiles.is_empty() {
            let profile = Profile::new("Default");
            self.active_profile_id = profile.id.clone();
            self.profiles.push(profile);
        }

        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        for profile in &mut self.profiles {
            profile.name = profile.name.trim().to_string();
            if profile.name.is_empty() {
                return Err(AppError::corrupt("A profile has an empty name"));
            }
            if !ids.insert(profile.id.clone()) {
                return Err(AppError::corrupt("Two profiles share the same id"));
            }
            if !names.insert(profile.name.to_lowercase()) {
                return Err(AppError::corrupt(format!(
                    "Two profiles share the name {:?}",
                    profile.name
                )));
            }
            profile.enabled_mod_ids = dedupe_ids(std::mem::take(&mut profile.enabled_mod_ids));
        }

        if self.profile_index(&self.active_profile_id).is_none() {
            self.active_profile_id = self.profiles[0].id.clone();
        }

        let mut tag_ids = HashSet::new();
        let mut tag_names = HashSet::new();
        for tag in &self.tags {
            if !is_hex_color(&tag.color) {
                return Err(AppError::corrupt(format!(
                    "Tag {:?} has an invalid color",
                    tag.name
                )));
            }
            if !tag_ids.insert(tag.id.clone()) {
                return Err(AppError::corrupt("Two tags share the same id"));
            }
            if !tag_names.insert(tag.name.to_lowercase()) {
                return Err(AppError::corrupt(format!(
                    "Two tags share the name {:?}",
                    tag.name
                )));
            }
        }

        let mut warnings = Vec::new();
        let known_tags = tag_ids;
        for tag_ids in self.mod_tags.values_mut() {
            let before = tag_ids.len();
            let retained: Vec<String> = std::mem::take(tag_ids)
                .into_iter()
                .filter(|id| known_tags.contains(id))
                .collect();
            *tag_ids = dedupe_ids(retained);
            if tag_ids.len() != before {
                warnings.push("Dropped mod tags that referenced missing tags".to_string());
            }
        }
        self.mod_tags.retain(|_, tag_ids| !tag_ids.is_empty());
        let profile_ids: HashSet<String> = self
            .profiles
            .iter()
            .map(|profile| profile.id.clone())
            .collect();
        self.launch_options
            .retain(|profile_id, _| profile_ids.contains(profile_id));

        Ok((self, warnings))
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self::new()
    }
}

impl Profile {
    fn new(name: &str) -> Self {
        let now = now_iso8601();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            enabled_mod_ids: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigStatus {
    Loaded,
    Created,
    RecoveredFromBackup,
    Corrupt,
}

#[derive(Debug, Clone)]
pub struct LoadedConfig {
    pub config: AppConfig,
    pub status: ConfigStatus,
    pub write_blocked: bool,
    pub warnings: Vec<String>,
    pub path: PathBuf,
}

/// Loads `config.json`, creating it on first run. A corrupt document falls back
/// to `.bak`; only a valid fallback is written back. When both copies are
/// corrupt the app runs with defaults and refuses to write over either file.
///
/// A document with an unsupported `schemaVersion` is never recovered from the
/// backup and never overwritten: it may have been written by a newer build, and
/// the backup is older by definition (ADR-003).
pub fn load_or_create(path: &Path) -> Result<LoadedConfig, AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::io_path("Could not create the config directory", parent, &error)
        })?;
    }
    if !path.exists() {
        let config = AppConfig::new();
        save(&config, path)?;
        return Ok(LoadedConfig {
            config,
            status: ConfigStatus::Created,
            write_blocked: false,
            warnings: Vec::new(),
            path: path.to_path_buf(),
        });
    }

    let bytes = fs::read(path)
        .map_err(|error| AppError::io_path("Could not read the config file", path, &error))?;
    match parse_config(&bytes) {
        Ok((config, mut warnings)) => Ok(LoadedConfig {
            config,
            status: ConfigStatus::Loaded,
            write_blocked: false,
            warnings: std::mem::take(&mut warnings),
            path: path.to_path_buf(),
        }),
        Err(ParseFailure::UnsupportedVersion(version)) => Ok(LoadedConfig {
            config: AppConfig::new(),
            status: ConfigStatus::Corrupt,
            write_blocked: true,
            warnings: vec![
                format!(
                    "config.json uses unsupported schema version {version}; refusing to load or overwrite it"
                ),
                "Running with defaults; config writes are disabled".to_string(),
            ],
            path: path.to_path_buf(),
        }),
        Err(ParseFailure::Corrupt(primary_error)) => {
            let backup = backup_path(path);
            if let Ok(bytes) = fs::read(&backup) {
                if let Ok((config, mut warnings)) = parse_config(&bytes) {
                    warnings.push(format!(
                        "config.json was corrupt ({}); restored config.json.bak",
                        primary_error.message
                    ));
                    let repaired = save_no_backup(&config, path);
                    if let Err(error) = repaired {
                        warnings.push(format!("Could not repair config.json: {error}"));
                    }
                    return Ok(LoadedConfig {
                        config,
                        status: ConfigStatus::RecoveredFromBackup,
                        write_blocked: false,
                        warnings,
                        path: path.to_path_buf(),
                    });
                }
            }

            let mut warnings = vec![format!(
                "config.json and config.json.bak could not be read: {}",
                primary_error.message
            )];
            warnings.push("Running with defaults; config writes are disabled".to_string());
            Ok(LoadedConfig {
                config: AppConfig::new(),
                status: ConfigStatus::Corrupt,
                write_blocked: true,
                warnings,
                path: path.to_path_buf(),
            })
        }
    }
}

/// The two ways a config document can be unusable. Only `Corrupt` may be
/// repaired from the backup; an unsupported schema must be left alone so a
/// newer build's file survives a downgrade.
enum ParseFailure {
    Corrupt(AppError),
    UnsupportedVersion(u64),
}

impl From<AppError> for ParseFailure {
    fn from(error: AppError) -> Self {
        Self::Corrupt(error)
    }
}

fn parse_config(bytes: &[u8]) -> Result<(AppConfig, Vec<String>), ParseFailure> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|error| {
        ParseFailure::Corrupt(
            AppError::corrupt("config.json is not valid JSON").with_details(error.to_string()),
        )
    })?;
    let version = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| AppError::corrupt("config.json has no schemaVersion"))?;
    if version != u64::from(SCHEMA_VERSION) {
        return Err(ParseFailure::UnsupportedVersion(version));
    }
    let config: AppConfig = serde_json::from_value(value).map_err(|error| {
        AppError::corrupt("config.json does not match schema v1").with_details(error.to_string())
    })?;
    let (config, warnings) = config.validate_and_normalize()?;
    Ok((config, warnings))
}

/// Saves the config atomically, copying the previous valid file to `.bak`.
/// Callers must check `write_blocked` before calling this.
pub fn save(config: &AppConfig, path: &Path) -> Result<(), AppError> {
    let bytes = serialize(config)?;
    atomic_write_with_backup(path, &bytes, Some(&backup_path(path)))
        .map_err(|error| AppError::io_path("Could not save config.json", path, &error))?;
    Ok(())
}

fn save_no_backup(config: &AppConfig, path: &Path) -> Result<(), AppError> {
    let bytes = serialize(config)?;
    atomic_write_no_backup(path, &bytes)
        .map_err(|error| AppError::io_path("Could not save config.json", path, &error))?;
    Ok(())
}

fn serialize(config: &AppConfig) -> Result<Vec<u8>, AppError> {
    let mut bytes = serde_json::to_vec_pretty(config)
        .map_err(|error| AppError::internal(format!("Could not serialize config: {error}")))?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub fn backup_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| CONFIG_FILE.to_string());
    path.with_file_name(format!("{name}.bak"))
}

fn validate_profile_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("A profile name is required"));
    }
    if name.len() > 80 {
        return Err(AppError::validation(
            "A profile name must be 80 characters or fewer",
        ));
    }
    Ok(name.to_string())
}

fn validate_tag_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("A tag name is required"));
    }
    if name.len() > 40 {
        return Err(AppError::validation(
            "A tag name must be 40 characters or fewer",
        ));
    }
    Ok(name.to_string())
}

fn validate_color(color: &str) -> Result<String, AppError> {
    if is_hex_color(color) {
        Ok(color.to_ascii_uppercase())
    } else {
        Err(AppError::validation(
            "A tag color must use the #RRGGBB format",
        ))
    }
}

fn is_hex_color(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn dedupe_ids(ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.into_iter()
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::test_support::TempDir;

    fn config_path(dir: &TempDir) -> PathBuf {
        dir.path().join(CONFIG_FILE)
    }

    #[test]
    fn first_run_creates_a_default_profile() {
        let dir = TempDir::new("config-first-run");
        let path = config_path(&dir);
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.status, ConfigStatus::Created);
        assert_eq!(loaded.config.profiles.len(), 1);
        assert_eq!(loaded.config.profiles[0].name, "Default");
        assert_eq!(
            loaded.config.active_profile_id,
            loaded.config.profiles[0].id
        );
        assert!(path.is_file());
    }

    #[test]
    fn round_trips_profiles_tags_and_ui_preferences() {
        let dir = TempDir::new("config-roundtrip");
        let path = config_path(&dir);
        let mut loaded = load_or_create(&path).unwrap();
        let second = loaded
            .config
            .save_profile(None, "Campaign", vec!["mod-b".into(), "mod-a".into()])
            .unwrap();
        loaded.config.set_active_profile(&second.id).unwrap();
        let tag = loaded.config.create_tag("Overhaul", "#c9a227").unwrap();
        loaded
            .config
            .set_mod_tags("mod-a", vec![tag.id.clone()])
            .unwrap();
        loaded.config.update_ui(UiPreferences {
            density: crate::ipc::Density::Compact,
            show_thumbnails: false,
            last_scroll_top: 420,
            zoom: 150,
        });
        loaded.config.window = Some(WindowGeometry {
            x: -1800,
            y: 220,
            width: 1300,
            height: 760,
            maximized: true,
        });
        save(&loaded.config, &path).unwrap();

        let reloaded = load_or_create(&path).unwrap();
        assert_eq!(reloaded.status, ConfigStatus::Loaded);
        assert_eq!(reloaded.config.profiles.len(), 2);
        assert_eq!(reloaded.config.active_profile().name, "Campaign");
        assert_eq!(
            reloaded.config.active_profile().enabled_mod_ids,
            vec!["mod-b", "mod-a"]
        );
        assert_eq!(reloaded.config.tags.len(), 1);
        assert_eq!(reloaded.config.mod_tags["mod-a"], vec![tag.id]);
        assert_eq!(reloaded.config.ui.density, crate::ipc::Density::Compact);
        assert_eq!(reloaded.config.ui.last_scroll_top, 420);
        assert_eq!(reloaded.config.ui.zoom, 150);
        assert_eq!(
            reloaded.config.window,
            Some(WindowGeometry {
                x: -1800,
                y: 220,
                width: 1300,
                height: 760,
                maximized: true,
            })
        );
        assert!(backup_path(&path).is_file());
    }

    #[test]
    fn out_of_range_zoom_and_geometry_are_normalized_on_load() {
        let dir = TempDir::new("config-window-normalize");
        let path = config_path(&dir);
        let loaded = load_or_create(&path).unwrap();
        let mut value = serde_json::to_value(&loaded.config).unwrap();
        value["ui"]["zoom"] = serde_json::Value::from(500);
        value["window"] = serde_json::json!({
            "x": 999_999,
            "y": -999_999,
            "width": 0,
            "height": 0,
            "maximized": false,
        });
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();

        let reloaded = load_or_create(&path).unwrap();

        assert_eq!(reloaded.config.ui.zoom, crate::ipc::ZOOM_MAX);
        let window = reloaded
            .config
            .window
            .expect("geometry is kept, not dropped");
        assert_eq!(window.x, 65_536);
        assert_eq!(window.y, -65_536);
        assert_eq!(window.width, 320);
        assert_eq!(window.height, 240);
    }

    #[test]
    fn missing_zoom_defaults_to_100_for_older_configs() {
        let dir = TempDir::new("config-window-legacy");
        let path = config_path(&dir);
        let loaded = load_or_create(&path).unwrap();
        let mut value = serde_json::to_value(&loaded.config).unwrap();
        value["ui"].as_object_mut().unwrap().remove("zoom");
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();

        let reloaded = load_or_create(&path).unwrap();

        assert_eq!(reloaded.config.ui.zoom, crate::ipc::ZOOM_DEFAULT);
        assert_eq!(reloaded.config.window, None);
    }

    #[test]
    fn corrupt_main_recovers_from_backup_and_repairs_it() {
        let dir = TempDir::new("config-recover");
        let path = config_path(&dir);
        let loaded = load_or_create(&path).unwrap();
        save(&loaded.config, &path).unwrap();
        fs::write(&path, b"{ this is not json").unwrap();

        let recovered = load_or_create(&path).unwrap();
        assert_eq!(recovered.status, ConfigStatus::RecoveredFromBackup);
        assert!(!recovered.write_blocked);
        assert!(!recovered.warnings.is_empty());
        let repaired: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(repaired["schemaVersion"], 1);
    }

    #[test]
    fn two_corrupt_files_block_writes_without_overwriting_them() {
        let dir = TempDir::new("config-corrupt");
        let path = config_path(&dir);
        fs::write(&path, b"broken").unwrap();
        fs::write(backup_path(&path), b"also broken").unwrap();

        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.status, ConfigStatus::Corrupt);
        assert!(loaded.write_blocked);
        assert_eq!(fs::read(&path).unwrap(), b"broken");
        assert_eq!(fs::read(backup_path(&path)).unwrap(), b"also broken");
    }

    #[test]
    fn future_schema_is_refused_and_not_overwritten() {
        let dir = TempDir::new("config-future");
        let path = config_path(&dir);
        let text = r#"{"schemaVersion":2,"activeProfileId":"x","profiles":[]}"#;
        fs::write(&path, text).unwrap();
        let loaded = load_or_create(&path).unwrap();
        assert_eq!(loaded.status, ConfigStatus::Corrupt);
        assert!(loaded.write_blocked);
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
    }

    #[test]
    fn future_schema_is_not_downgraded_to_a_stale_backup() {
        let dir = TempDir::new("config-future-backup");
        let path = config_path(&dir);
        let future = r#"{"schemaVersion":2,"activeProfileId":"x","profiles":[]}"#;
        let backup = serde_json::to_vec(&AppConfig::new()).unwrap();
        fs::write(&path, future).unwrap();
        fs::write(backup_path(&path), &backup).unwrap();

        let loaded = load_or_create(&path).unwrap();

        assert_eq!(loaded.status, ConfigStatus::Corrupt);
        assert!(loaded.write_blocked);
        assert_eq!(fs::read_to_string(&path).unwrap(), future);
        assert_eq!(fs::read(backup_path(&path)).unwrap(), backup);
        assert!(
            loaded
                .warnings
                .iter()
                .any(|warning| warning.contains("schema version 2")),
            "{:?}",
            loaded.warnings
        );
    }

    #[test]
    fn profile_names_are_unique_case_insensitively() {
        let mut config = AppConfig::new();
        config.save_profile(None, "Campaign", Vec::new()).unwrap();
        let error = config
            .save_profile(None, " campaign ", Vec::new())
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::Validation);
    }

    #[test]
    fn deleting_the_last_profile_is_refused() {
        let mut config = AppConfig::new();
        let id = config.profiles[0].id.clone();
        let error = config.delete_profile(&id).unwrap_err();
        assert_eq!(error.code, ErrorCode::Validation);
    }

    #[test]
    fn deleting_the_active_profile_activates_a_sibling() {
        let mut config = AppConfig::new();
        let first = config.profiles[0].id.clone();
        let second = config.save_profile(None, "Second", Vec::new()).unwrap();
        config.set_active_profile(&first).unwrap();
        config.delete_profile(&first).unwrap();
        assert_eq!(config.active_profile_id, second.id);
    }

    #[test]
    fn duplicate_profile_copies_the_enabled_order() {
        let mut config = AppConfig::new();
        let source = config
            .save_profile(None, "Source", vec!["b".into(), "a".into()])
            .unwrap();
        let copy = config.duplicate_profile(&source.id, "Copy").unwrap();
        assert_eq!(copy.enabled_mod_ids, vec!["b", "a"]);
        assert_ne!(copy.id, source.id);
    }

    #[test]
    fn deleting_a_tag_removes_it_from_mods() {
        let mut config = AppConfig::new();
        let tag = config.create_tag("Overhaul", "#112233").unwrap();
        config
            .set_mod_tags("mod", vec![tag.id.clone(), tag.id.clone()])
            .unwrap();
        assert_eq!(config.mod_tags["mod"], vec![tag.id.clone()]);
        config.delete_tag(&tag.id).unwrap();
        assert!(!config.mod_tags.contains_key("mod"));
    }

    #[test]
    fn roomy_density_round_trips() {
        let dir = TempDir::new("config-density-roomy");
        let path = config_path(&dir);
        let loaded = load_or_create(&path).unwrap();
        let mut value = serde_json::to_value(&loaded.config).unwrap();
        value["ui"]["density"] = serde_json::Value::String("roomy".into());
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        let reloaded = load_or_create(&path).unwrap();
        assert_eq!(reloaded.config.ui.density, crate::ipc::Density::Roomy);
    }

    #[test]
    fn unknown_density_falls_back_to_comfortable() {
        let dir = TempDir::new("config-density");
        let path = config_path(&dir);
        let loaded = load_or_create(&path).unwrap();
        let mut value = serde_json::to_value(&loaded.config).unwrap();
        value["ui"]["density"] = serde_json::Value::String("huge".into());
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        let reloaded = load_or_create(&path).unwrap();
        assert_eq!(reloaded.config.ui.density, crate::ipc::Density::Comfortable);
    }
}
