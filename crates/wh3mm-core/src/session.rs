//! M1/M2 orchestration: config + detection + scan + working load order.
//!
//! Keeping this state machine in the core crate means the complete mod-list,
//! profile, and `used_mods.txt` flow is exercised headlessly on Linux. The Tauri
//! layer only locks a session and forwards commands.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::config::{self, AppConfig, ConfigStatus};
use crate::error::{AppError, ErrorCode};
use crate::ipc::{
    GameLocation as IpcGameLocation, LoadOrderReadReport, LoadOrderWriteReport, ModListSnapshot,
    ModSummary, Profile, ProfilesState, ResetDefaultsReport, ResetLoadOrderReport,
    ResetLoadOrderStatus, Tag, UiPreferences,
};
use crate::load_order::{self, LoadOrderFile, PlannedName, WritePlan};
use crate::mod_index::{self, DiscoveredMod, IndexReport};
use crate::paths::{self, DetectionReport, GameLocation};
use crate::timing::{log_timing, Timings};

pub struct SessionOptions {
    pub config_path: PathBuf,
    /// `None` means use the platform Steam discovery. `Some(vec![])` disables it
    /// for tests that only use a manual path.
    pub steam_root_candidates: Option<Vec<PathBuf>>,
    /// Test/bootstrap helper: use this game folder when the config has no override.
    pub manual_game_path: Option<PathBuf>,
    pub log_timings: bool,
}

impl SessionOptions {
    pub fn new(config_dir: impl AsRef<Path>) -> Self {
        Self {
            config_path: config_dir.as_ref().join(config::CONFIG_FILE),
            steam_root_candidates: None,
            manual_game_path: None,
            log_timings: true,
        }
    }
}

pub struct Session {
    pub config_path: PathBuf,
    pub config: AppConfig,
    pub config_status: ConfigStatus,
    pub config_write_blocked: bool,
    pub warnings: Vec<String>,
    pub location: Option<GameLocation>,
    pub detection: DetectionReport,
    pub mods: Vec<DiscoveredMod>,
    pub index_report: IndexReport,
    /// Enabled IDs in load order. May contain IDs that are temporarily not
    /// discovered; those are preserved in profiles and reported as skipped.
    pub enabled_ids: Vec<String>,
    pub load_order: LoadOrderReadReport,
    pub timings: Timings,
    steam_root_candidates: Option<Vec<PathBuf>>,
    log_timings: bool,
}

impl Session {
    pub fn initialize(options: SessionOptions) -> Result<Self, AppError> {
        let started = Instant::now();
        let loaded = config::load_or_create(&options.config_path)?;
        let mut config = loaded.config;
        let mut warnings = loaded.warnings;
        let config_status = loaded.status;
        let mut config_write_blocked = loaded.write_blocked;

        if let Some(manual_path) = &options.manual_game_path {
            if config.paths.game_path_override.is_none() {
                config.paths.game_path_override = Some(manual_path.clone());
                if !config_write_blocked {
                    if let Err(error) = config::save(&config, &options.config_path) {
                        warnings.push(format!("Could not persist the game path: {error}"));
                        config_write_blocked = true;
                    }
                }
            }
        }

        let detection_started = Instant::now();
        let candidates = options
            .steam_root_candidates
            .clone()
            .unwrap_or_else(paths::default_steam_root_candidates);
        let (mut location, detection) = resolve_location(&config, &candidates, &mut warnings);
        let detection_duration = detection_started.elapsed();

        let mut scan_duration = Duration::ZERO;
        let mut load_order_duration = Duration::ZERO;
        let mut mods = Vec::new();
        let mut index_report = IndexReport::default();
        let mut load_order_report = empty_load_order_report("");

        if let Some(found) = &location {
            let scan_started = Instant::now();
            let (scanned, report) = mod_index::scan(found);
            mods = scanned;
            index_report = report;
            scan_duration = scan_started.elapsed();

            let read_started = Instant::now();
            let file = load_order::read_file(&load_order::used_mods_path(&found.game_path));
            if let Some(reason) = &file.unreadable {
                warnings.push(format!(
                    "used_mods.txt could not be read; writes are blocked until it is readable: {reason}"
                ));
            }
            load_order_report = read_report(&file, &mods);
            load_order_duration = read_started.elapsed();
        }

        let mut session = Self {
            config_path: options.config_path,
            config,
            config_status,
            config_write_blocked,
            warnings,
            location: location.take(),
            detection,
            mods,
            index_report,
            enabled_ids: Vec::new(),
            load_order: load_order_report,
            timings: Timings::default(),
            steam_root_candidates: options.steam_root_candidates,
            log_timings: options.log_timings,
        };

        session.enabled_ids = session.config.active_profile().enabled_mod_ids.clone();

        if session.location.is_some() && session.config_status == ConfigStatus::Created {
            session.import_used_mods_on_first_run();
        }

        let total = started.elapsed();
        session.timings = Timings::from_durations(
            total,
            detection_duration,
            scan_duration,
            load_order_duration,
            total,
        );
        if session.log_timings {
            log_timing("startup", total);
            log_timing("detection", detection_duration);
            log_timing("pack_scan", scan_duration);
            log_timing("mod_list_load", load_order_duration);
        }
        Ok(session)
    }

    fn import_used_mods_on_first_run(&mut self) {
        if self.load_order.corrupt {
            return;
        }
        let by_name = mods_by_lower_name(&self.mods);
        let mut imported = Vec::new();
        for name in &self.load_order.mod_names {
            if let Some(id) = by_name.get(&name.to_lowercase()) {
                if !imported.contains(id) {
                    imported.push(id.clone());
                }
            }
        }
        if imported.is_empty() {
            return;
        }
        self.enabled_ids = imported;
        let mut next = self.config.clone();
        next.active_profile_mut().enabled_mod_ids = self.enabled_ids.clone();
        if self.config_write_blocked {
            return;
        }
        match config::save(&next, &self.config_path) {
            Ok(()) => self.config = next,
            Err(error) => {
                self.warnings
                    .push(format!("Could not import used_mods.txt: {error}"));
                self.config_write_blocked = true;
            }
        }
    }

    pub fn game_location(&self) -> Result<IpcGameLocation, AppError> {
        self.location
            .as_ref()
            .map(GameLocation::to_ipc)
            .ok_or_else(|| self.game_not_found_error())
    }

    /// Steam roots considered by the Linux direct-Proton resolver.
    ///
    /// The detected location carries the Steam root for automatic detection, but
    /// a manual path only exposes the library root. Prefer the location's root
    /// and fall back to the injected/default candidates.
    pub(crate) fn launch_steam_roots(&self) -> Vec<PathBuf> {
        let mut candidates = self
            .steam_root_candidates
            .clone()
            .unwrap_or_else(paths::default_steam_root_candidates);
        if let Some(location) = &self.location {
            if !location.steam_root.as_os_str().is_empty() {
                candidates.insert(0, location.steam_root.clone());
            }
        }
        paths::discover_steam_roots(&candidates)
    }

    pub fn set_game_path(
        &mut self,
        game_path: Option<PathBuf>,
    ) -> Result<IpcGameLocation, AppError> {
        let (new_location, detection, new_override) = match &game_path {
            Some(path) => {
                let location = paths::game_location_from_manual(path)?;
                let game_path = location.game_path.clone();
                let mut detection = self.detection.clone();
                detection.problems.clear();
                (Some(location), detection, Some(game_path))
            }
            None => {
                let candidates = self
                    .steam_root_candidates
                    .clone()
                    .unwrap_or_else(paths::default_steam_root_candidates);
                let (location, detection) = paths::autodetect(&candidates);
                (location, detection, None)
            }
        };

        let scan_started = Instant::now();
        let (new_mods, new_index) = match &new_location {
            Some(location) => {
                let (mods, report) = mod_index::scan(location);
                (mods, report)
            }
            None => (Vec::new(), IndexReport::default()),
        };
        let scan_duration = scan_started.elapsed();

        let mut next = self.config.clone();
        next.paths.game_path_override = new_override;
        migrate_profiles_by_name(&mut next, &self.mods, &new_mods);

        let read_started = Instant::now();
        let mut new_load_order = empty_load_order_report("");
        let mut path_warnings = Vec::new();
        let mut new_load_order_file = None;
        if let Some(location) = &new_location {
            let file = load_order::read_file(&load_order::used_mods_path(&location.game_path));
            if let Some(reason) = &file.unreadable {
                path_warnings.push(format!(
                    "used_mods.txt could not be read; writes are blocked until it is readable: {reason}"
                ));
            }
            new_load_order = read_report(&file, &new_mods);
            new_load_order_file = Some(file);
        }
        let read_duration = read_started.elapsed();

        if self.config_status == ConfigStatus::Created {
            if let Some(file) = &new_load_order_file {
                let by_name = mods_by_lower_name(&new_mods);
                let mut imported = Vec::new();
                for name in &file.parsed.mod_names {
                    if let Some(id) = by_name.get(&name.to_lowercase()) {
                        if !imported.contains(id) {
                            imported.push(id.clone());
                        }
                    }
                }
                if !imported.is_empty() {
                    next.active_profile_mut().enabled_mod_ids = imported;
                }
            }
        }

        self.ensure_config_writable()?;
        config::save(&next, &self.config_path)?;

        self.config = next;
        self.location = new_location;
        self.detection = detection;
        self.mods = new_mods;
        self.index_report = new_index;
        self.load_order = new_load_order;
        self.enabled_ids = self.config.active_profile().enabled_mod_ids.clone();
        self.config_status = ConfigStatus::Loaded;
        self.warnings.extend(path_warnings);
        if self.log_timings {
            log_timing("pack_scan_path_change", scan_duration);
            log_timing("mod_list_load_path_change", read_duration);
        }
        self.game_location()
    }

    fn ensure_config_writable(&self) -> Result<(), AppError> {
        if self.config_write_blocked {
            Err(AppError::corrupt(
                "The config files could not be read; writing is disabled to avoid data loss",
            ))
        } else {
            Ok(())
        }
    }

    fn commit_config<T>(
        &mut self,
        mutate: impl FnOnce(&mut AppConfig) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        self.ensure_config_writable()?;
        let mut next = self.config.clone();
        let value = mutate(&mut next)?;
        config::save(&next, &self.config_path)?;
        self.config = next;
        Ok(value)
    }

    pub fn snapshot(&self) -> ModListSnapshot {
        let by_id: HashMap<&str, &DiscoveredMod> = self
            .mods
            .iter()
            .map(|module| (module.id.as_str(), module))
            .collect();
        let mut seen = HashSet::new();
        let mut order = Vec::new();
        for id in &self.enabled_ids {
            if let Some(module) = by_id.get(id.as_str()) {
                if seen.insert(module.id.clone()) {
                    order.push(*module);
                }
            }
        }
        let mut disabled: Vec<&DiscoveredMod> = self
            .mods
            .iter()
            .filter(|module| !seen.contains(&module.id))
            .collect();
        disabled.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        order.extend(disabled);

        let mods: Vec<ModSummary> = order
            .into_iter()
            .enumerate()
            .map(|(index, module)| {
                let is_enabled = seen.contains(&module.id);
                ModSummary {
                    id: module.id.clone(),
                    name: module.name.clone(),
                    human_name: module.human_name.clone(),
                    is_workshop: module.is_workshop,
                    workshop_id: module.workshop_id.clone(),
                    is_enabled,
                    load_order: index as u32,
                    tags: self
                        .config
                        .mod_tags
                        .get(&module.id)
                        .cloned()
                        .unwrap_or_default(),
                    updated_at: module.updated_at.clone(),
                    thumbnail_path: module
                        .thumbnail_path
                        .as_ref()
                        .map(|path| path.to_string_lossy().into_owned()),
                    dependencies: module.dependencies.clone(),
                    pack_error: module.pack_error.clone(),
                    is_movie: module.is_movie,
                    size_bytes: module.size_bytes,
                }
            })
            .collect();

        ModListSnapshot {
            enabled_count: mods.iter().filter(|module| module.is_enabled).count() as u32,
            mods,
            active_profile_id: self.config.active_profile_id.clone(),
            load_order: self.load_order.clone(),
            timings: self.timings,
            warnings: self.snapshot_warnings(),
        }
    }

    fn snapshot_warnings(&self) -> Vec<String> {
        let mut warnings = self.warnings.clone();
        for duplicate in self.index_report.duplicates.iter().take(5) {
            warnings.push(format!(
                "Several packs are named {}; using the first discovered copy",
                duplicate.name
            ));
        }
        if self.index_report.duplicates.len() > 5 {
            warnings.push(format!(
                "{} more duplicate pack names were found",
                self.index_report.duplicates.len() - 5
            ));
        }
        if self.config_write_blocked {
            warnings.push(
                "Config writes are disabled because config.json and its backup could not be read"
                    .to_string(),
            );
        }
        warnings
    }

    pub fn set_mods_enabled(
        &mut self,
        mod_ids: &[String],
        enabled: bool,
    ) -> Result<ModListSnapshot, AppError> {
        self.require_game()?;
        if mod_ids.is_empty() {
            return Err(AppError::validation("No mods were selected"));
        }
        let known: HashSet<&str> = self.mods.iter().map(|module| module.id.as_str()).collect();
        for id in mod_ids {
            if !known.contains(id.as_str()) {
                return Err(AppError::not_found(format!("Unknown mod {id}")));
            }
        }
        let selected: HashSet<&str> = mod_ids.iter().map(String::as_str).collect();
        let mut next_enabled = self.enabled_ids.clone();
        if enabled {
            for id in mod_ids {
                if !next_enabled.contains(id) {
                    next_enabled.push(id.clone());
                }
            }
        } else {
            next_enabled.retain(|id| !selected.contains(id.as_str()));
        }
        self.apply_enabled_ids(next_enabled)?;
        Ok(self.snapshot())
    }

    pub fn set_load_order(
        &mut self,
        ordered_mod_ids: &[String],
    ) -> Result<ModListSnapshot, AppError> {
        self.require_game()?;
        let known_enabled = self.known_enabled_ids();
        let provided: HashSet<&str> = ordered_mod_ids.iter().map(String::as_str).collect();
        if provided.len() != ordered_mod_ids.len() {
            return Err(AppError::validation(
                "The load order contains duplicate mod ids",
            ));
        }
        let expected: HashSet<&str> = known_enabled.iter().map(String::as_str).collect();
        if provided != expected {
            return Err(AppError::validation(
                "The load order must contain exactly the enabled mods, once each",
            ));
        }
        let known: HashSet<&str> = self.mods.iter().map(|module| module.id.as_str()).collect();
        let mut next_enabled: Vec<String> = ordered_mod_ids.to_vec();
        for id in &self.enabled_ids {
            if !known.contains(id.as_str()) && !next_enabled.contains(id) {
                next_enabled.push(id.clone());
            }
        }
        self.apply_enabled_ids(next_enabled)?;
        Ok(self.snapshot())
    }

    fn apply_enabled_ids(&mut self, enabled_ids: Vec<String>) -> Result<(), AppError> {
        self.commit_config(|config| {
            config.active_profile_mut().enabled_mod_ids = enabled_ids.clone();
            Ok(())
        })?;
        self.enabled_ids = enabled_ids;
        Ok(())
    }

    fn known_enabled_ids(&self) -> Vec<String> {
        let known: HashSet<&str> = self.mods.iter().map(|module| module.id.as_str()).collect();
        self.enabled_ids
            .iter()
            .filter(|id| known.contains(id.as_str()))
            .cloned()
            .collect()
    }

    pub fn profiles_state(&self) -> ProfilesState {
        ProfilesState {
            profiles: self.config.profiles.clone(),
            active_profile_id: self.config.active_profile_id.clone(),
        }
    }

    pub fn save_profile(
        &mut self,
        profile_id: Option<&str>,
        name: &str,
        enabled_mod_ids: Vec<String>,
    ) -> Result<Profile, AppError> {
        let mut enabled = enabled_mod_ids;
        if let Some(id) = profile_id {
            if let Some(existing) = self.config.profile(id) {
                let known: HashSet<&str> =
                    self.mods.iter().map(|module| module.id.as_str()).collect();
                for existing_id in &existing.enabled_mod_ids {
                    if !known.contains(existing_id.as_str()) && !enabled.contains(existing_id) {
                        enabled.push(existing_id.clone());
                    }
                }
            }
        }
        let is_active = profile_id.is_some_and(|id| id == self.config.active_profile_id);
        let profile =
            self.commit_config(|config| config.save_profile(profile_id, name, enabled))?;
        if is_active {
            self.enabled_ids = profile.enabled_mod_ids.clone();
        }
        Ok(profile)
    }

    pub fn duplicate_profile(&mut self, profile_id: &str, name: &str) -> Result<Profile, AppError> {
        self.commit_config(|config| config.duplicate_profile(profile_id, name))
    }

    pub fn delete_profile(&mut self, profile_id: &str) -> Result<ProfilesState, AppError> {
        self.commit_config(|config| config.delete_profile(profile_id))?;
        self.enabled_ids = self.config.active_profile().enabled_mod_ids.clone();
        Ok(self.profiles_state())
    }

    pub fn apply_profile(&mut self, profile_id: &str) -> Result<ModListSnapshot, AppError> {
        self.commit_config(|config| config.set_active_profile(profile_id))?;
        self.enabled_ids = self.config.active_profile().enabled_mod_ids.clone();
        Ok(self.snapshot())
    }

    pub fn list_tags(&self) -> Vec<Tag> {
        self.config.tags.clone()
    }

    pub fn create_tag(&mut self, name: &str, color: &str) -> Result<Vec<Tag>, AppError> {
        self.commit_config(|config| config.create_tag(name, color))?;
        Ok(self.list_tags())
    }

    pub fn delete_tag(&mut self, tag_id: &str) -> Result<Vec<Tag>, AppError> {
        self.commit_config(|config| config.delete_tag(tag_id))?;
        Ok(self.list_tags())
    }

    pub fn set_mod_tags(
        &mut self,
        mod_id: &str,
        tag_ids: Vec<String>,
    ) -> Result<ModListSnapshot, AppError> {
        if !self.mods.iter().any(|module| module.id == mod_id) {
            return Err(AppError::not_found(format!("Unknown mod {mod_id}")));
        }
        self.commit_config(|config| config.set_mod_tags(mod_id, tag_ids))?;
        Ok(self.snapshot())
    }

    pub fn ui_preferences(&self) -> UiPreferences {
        self.config.ui.clone()
    }

    pub fn update_ui_preferences(
        &mut self,
        mut preferences: UiPreferences,
    ) -> Result<UiPreferences, AppError> {
        preferences.last_scroll_top = preferences.last_scroll_top.min(10_000_000);
        self.commit_config(|config| {
            config.update_ui(preferences.clone());
            Ok(())
        })?;
        Ok(self.ui_preferences())
    }

    /// Resets UI preferences and the active profile's enabled set, clears the
    /// manual game path override, and writes an empty load order at the
    /// automatically detected game path. Profiles, tags, mod tags, and launch
    /// options are kept.
    ///
    /// The load-order write is preflighted before any state changes. A corrupt
    /// or unreadable `used_mods.txt`, or an unconfirmed unmanaged-directive
    /// drop, leaves the session untouched and is reported through
    /// [`ResetLoadOrderReport`].
    pub fn reset_to_defaults(
        &mut self,
        confirm: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<ResetDefaultsReport, AppError> {
        if !confirm {
            return Err(AppError::validation(
                "Resetting settings and the load order requires confirmation",
            ));
        }

        // Clearing the override moves the reset write to the automatically
        // detected installation, so probe that location before mutating state.
        // When automatic detection finds nothing, still refuse to report a
        // successful reset over a corrupt file in the currently live install.
        let (new_location, detection) = self.detect_automatic_location();
        let preflight = match &new_location {
            Some(location) => Some((location, true)),
            None => self.location.as_ref().map(|location| (location, false)),
        };
        if let Some((location, writes_here)) = preflight {
            let plan = load_order::plan_write(
                &load_order::used_mods_path(&location.game_path),
                &[],
                &[],
                true,
                confirm_unmanaged_loss,
            )?;
            // A corrupt or unreadable file can also contain unmanaged lines.
            // Refuse it before asking for a directive-loss confirmation: the
            // write cannot succeed, so the confirmation would be false.
            if plan.hard_blocked {
                return Ok(ResetDefaultsReport {
                    load_order: failed_report(plan.blocked_reason, plan.unmanaged_directives),
                });
            }
            if writes_here {
                if plan.requires_unmanaged_confirmation {
                    return Ok(ResetDefaultsReport {
                        load_order: unmanaged_report(
                            plan.blocked_reason,
                            plan.unmanaged_directives,
                        ),
                    });
                }
                if !plan.can_write {
                    return Ok(ResetDefaultsReport {
                        load_order: failed_report(plan.blocked_reason, plan.unmanaged_directives),
                    });
                }
            }
        }

        self.commit_config(|config| {
            config.reset_to_defaults();
            Ok(())
        })?;
        self.enabled_ids.clear();
        self.apply_detected_location(new_location, detection);

        let Some(location) = &self.location else {
            return Ok(ResetDefaultsReport {
                load_order: ResetLoadOrderReport {
                    status: ResetLoadOrderStatus::NoGamePath,
                    message: Some(
                        "Automatic detection found no game path; the load order was not written"
                            .to_string(),
                    ),
                    unmanaged_directives: Vec::new(),
                    requires_unmanaged_confirmation: false,
                },
            });
        };
        let path = load_order::used_mods_path(&location.game_path);

        // Re-plan after detection: the file can change between the preflight and
        // the write. Never start a new confirmation round after the config has
        // already been reset; report the race instead.
        let plan = self.plan_write(true, confirm_unmanaged_loss)?;
        if plan.hard_blocked {
            return Ok(ResetDefaultsReport {
                load_order: failed_report(plan.blocked_reason, plan.unmanaged_directives),
            });
        }
        if plan.requires_unmanaged_confirmation {
            return Ok(ResetDefaultsReport {
                load_order: failed_report(
                    Some(
                        "used_mods.txt changed during the reset; review the unmanaged directives and try again"
                            .to_string(),
                    ),
                    plan.unmanaged_directives,
                ),
            });
        }
        if !plan.can_write {
            return Ok(ResetDefaultsReport {
                load_order: failed_report(plan.blocked_reason, plan.unmanaged_directives),
            });
        }
        if let Err(error) = load_order::write_plan(&plan) {
            let message = match error.details {
                Some(details) => format!("{}: {details}", error.message),
                None => error.message,
            };
            return Ok(ResetDefaultsReport {
                load_order: failed_report(Some(message), Vec::new()),
            });
        }
        self.load_order = read_report(&load_order::read_file(&path), &self.mods);
        Ok(ResetDefaultsReport {
            load_order: ResetLoadOrderReport {
                status: ResetLoadOrderStatus::Written,
                message: None,
                unmanaged_directives: Vec::new(),
                requires_unmanaged_confirmation: false,
            },
        })
    }

    pub fn read_load_order(&mut self) -> Result<LoadOrderReadReport, AppError> {
        let location = self.require_game_location()?;
        let file = load_order::read_file(&load_order::used_mods_path(&location.game_path));
        self.load_order = read_report(&file, &self.mods);
        Ok(self.load_order.clone())
    }

    pub fn preview_load_order(&self) -> Result<LoadOrderWriteReport, AppError> {
        let plan = self.plan_write(false, false)?;
        Ok(write_report(&plan, plan.backup_path.clone()))
    }

    pub fn write_load_order(
        &mut self,
        allow_empty: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<LoadOrderWriteReport, AppError> {
        let plan = self.plan_write(allow_empty, confirm_unmanaged_loss)?;
        if !plan.can_write {
            let code = if plan.corrupt || plan.unreadable {
                ErrorCode::ConfigCorrupt
            } else {
                ErrorCode::Validation
            };
            return Err(AppError::new(
                code,
                plan.blocked_reason
                    .clone()
                    .unwrap_or_else(|| "The load-order write was refused".to_string()),
            ));
        }
        let backup = load_order::write_plan(&plan)?;
        let report = write_report(&plan, backup);
        self.refresh_load_order_after_write()?;
        Ok(report)
    }

    pub fn restore_load_order(&mut self) -> Result<LoadOrderReadReport, AppError> {
        let location = self.require_game_location()?;
        let path = load_order::used_mods_path(&location.game_path);
        let file = load_order::restore_backup(&path)?;
        self.load_order = read_report(&file, &self.mods);
        Ok(self.load_order.clone())
    }

    fn refresh_load_order_after_write(&mut self) -> Result<(), AppError> {
        let location = self.require_game_location()?;
        let file = load_order::read_file(&load_order::used_mods_path(&location.game_path));
        self.load_order = read_report(&file, &self.mods);
        Ok(())
    }

    fn detect_automatic_location(&self) -> (Option<GameLocation>, DetectionReport) {
        let candidates = self
            .steam_root_candidates
            .clone()
            .unwrap_or_else(paths::default_steam_root_candidates);
        paths::autodetect(&candidates)
    }

    /// Applies a location resolved from automatic detection. The mod index is
    /// rescanned only when the game folder changed.
    fn apply_detected_location(
        &mut self,
        location: Option<GameLocation>,
        detection: DetectionReport,
    ) {
        let same_game = match (&self.location, &location) {
            (Some(current), Some(next)) => current.game_path == next.game_path,
            (None, None) => true,
            _ => false,
        };
        self.location = location.clone();
        self.detection = detection;
        if same_game {
            return;
        }
        match location {
            Some(found) => {
                let (mods, report) = mod_index::scan(&found);
                self.mods = mods;
                self.index_report = report;
                let file = load_order::read_file(&load_order::used_mods_path(&found.game_path));
                if let Some(reason) = &file.unreadable {
                    self.warnings.push(format!(
                        "used_mods.txt could not be read; writes are blocked until it is readable: {reason}"
                    ));
                }
                self.load_order = read_report(&file, &self.mods);
            }
            None => {
                self.mods.clear();
                self.index_report = IndexReport::default();
                self.load_order = empty_load_order_report("");
            }
        }
    }

    fn plan_write(
        &self,
        allow_empty: bool,
        confirm_unmanaged_loss: bool,
    ) -> Result<WritePlan, AppError> {
        let location = self.require_game_location()?;
        let by_id: HashMap<&str, &DiscoveredMod> = self
            .mods
            .iter()
            .map(|module| (module.id.as_str(), module))
            .collect();
        let mut resolved = Vec::new();
        let mut unresolved = Vec::new();
        for id in &self.enabled_ids {
            match by_id.get(id.as_str()) {
                Some(module) => resolved.push(PlannedName {
                    id: id.clone(),
                    name: module.name.clone(),
                }),
                None => unresolved.push(id.rsplit('/').next().unwrap_or(id.as_str()).to_string()),
            }
        }
        load_order::plan_write(
            &load_order::used_mods_path(&location.game_path),
            &resolved,
            &unresolved,
            allow_empty,
            confirm_unmanaged_loss,
        )
    }

    fn require_game(&self) -> Result<(), AppError> {
        if self.location.is_some() {
            Ok(())
        } else {
            Err(self.game_not_found_error())
        }
    }

    fn require_game_location(&self) -> Result<&GameLocation, AppError> {
        self.location
            .as_ref()
            .ok_or_else(|| self.game_not_found_error())
    }

    fn game_not_found_error(&self) -> AppError {
        let mut details = Vec::new();
        if !self.detection.steam_roots.is_empty() {
            details.push(format!(
                "Steam roots: {}",
                self.detection
                    .steam_roots
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if !self.detection.libraries.is_empty() {
            details.push(format!(
                "Libraries checked: {}",
                self.detection
                    .libraries
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if !self.detection.problems.is_empty() {
            details.push(self.detection.problems.join("; "));
        }
        let error = AppError::new(
            ErrorCode::GameNotFound,
            "Could not find a Total War: Warhammer III installation",
        );
        if details.is_empty() {
            error.with_details("No Steam or Flatpak/Snap library was found")
        } else {
            error.with_details(details.join(". "))
        }
    }
}

fn resolve_location(
    config: &AppConfig,
    candidates: &[PathBuf],
    warnings: &mut Vec<String>,
) -> (Option<GameLocation>, DetectionReport) {
    if let Some(override_path) = &config.paths.game_path_override {
        match paths::game_location_from_manual(override_path) {
            Ok(location) => {
                let mut detection = DetectionReport::default();
                detection.problems.push(format!(
                    "Using the manual game path {}",
                    location.game_path.display()
                ));
                return (Some(location), detection);
            }
            Err(error) => warnings.push(format!(
                "The configured game path {} is invalid ({}); falling back to auto-detection",
                override_path.display(),
                error.message
            )),
        }
    }
    paths::autodetect(candidates)
}

fn migrate_profiles_by_name(
    config: &mut AppConfig,
    old_mods: &[DiscoveredMod],
    new_mods: &[DiscoveredMod],
) {
    let old_by_id: HashMap<&str, &str> = old_mods
        .iter()
        .map(|module| (module.id.as_str(), module.name.as_str()))
        .collect();
    let new_by_name: HashMap<String, &str> = new_mods
        .iter()
        .map(|module| (module.name.to_lowercase(), module.id.as_str()))
        .collect();

    for profile in &mut config.profiles {
        let mut migrated = Vec::new();
        for id in &profile.enabled_mod_ids {
            let new_id = old_by_id
                .get(id.as_str())
                .and_then(|name| new_by_name.get(&name.to_lowercase()).copied())
                .map(str::to_string)
                .unwrap_or_else(|| id.clone());
            if !migrated.contains(&new_id) {
                migrated.push(new_id);
            }
        }
        profile.enabled_mod_ids = migrated;
    }
}

fn mods_by_lower_name(mods: &[DiscoveredMod]) -> HashMap<String, String> {
    mods.iter()
        .map(|module| (module.name.to_lowercase(), module.id.clone()))
        .collect()
}

fn unmanaged_report(
    message: Option<String>,
    unmanaged_directives: Vec<String>,
) -> ResetLoadOrderReport {
    ResetLoadOrderReport {
        status: ResetLoadOrderStatus::UnmanagedDirectives,
        message,
        unmanaged_directives,
        requires_unmanaged_confirmation: true,
    }
}

fn failed_report(
    message: Option<String>,
    unmanaged_directives: Vec<String>,
) -> ResetLoadOrderReport {
    ResetLoadOrderReport {
        status: ResetLoadOrderStatus::Failed,
        message,
        unmanaged_directives,
        requires_unmanaged_confirmation: false,
    }
}

fn empty_load_order_report(path: &str) -> LoadOrderReadReport {
    LoadOrderReadReport {
        path: path.to_string(),
        present: false,
        corrupt: false,
        message: None,
        unreadable: None,
        mod_names: Vec::new(),
        resolved_mod_ids: Vec::new(),
        missing_names: Vec::new(),
        duplicates: Vec::new(),
        unmanaged_directives: Vec::new(),
        backup_available: false,
    }
}

fn read_report(file: &LoadOrderFile, mods: &[DiscoveredMod]) -> LoadOrderReadReport {
    let by_name = mods_by_lower_name(mods);
    let mut resolved = Vec::new();
    let mut missing = Vec::new();
    for name in &file.parsed.mod_names {
        match by_name.get(&name.to_lowercase()) {
            Some(id) => resolved.push(id.clone()),
            None => missing.push(name.clone()),
        }
    }
    LoadOrderReadReport {
        path: file.path.to_string_lossy().into_owned(),
        present: file.present,
        corrupt: file.is_corrupt(),
        message: file.corrupt_message.clone(),
        unreadable: file.unreadable.clone(),
        mod_names: file.parsed.mod_names.clone(),
        resolved_mod_ids: resolved,
        missing_names: missing,
        duplicates: file.parsed.duplicates.clone(),
        unmanaged_directives: file.parsed.unmanaged.clone(),
        backup_available: file.backup_available,
    }
}

fn write_report(plan: &WritePlan, backup: Option<PathBuf>) -> LoadOrderWriteReport {
    LoadOrderWriteReport {
        path: plan.path.to_string_lossy().into_owned(),
        backup_path: backup.map(|path| path.to_string_lossy().into_owned()),
        written: plan.written,
        skipped: plan.skipped.clone(),
        unmanaged_directives: plan.unmanaged_directives.clone(),
        would_drop_unmanaged: plan.would_drop_unmanaged,
        existing_mod_count: plan.existing_mod_count,
        resulting_mod_count: plan.resulting_mod_count,
        can_write: plan.can_write,
        blocked_reason: plan.blocked_reason.clone(),
        requires_empty_confirmation: plan.requires_empty_confirmation,
        requires_unmanaged_confirmation: plan.requires_unmanaged_confirmation,
        hard_blocked: plan.hard_blocked,
    }
}
