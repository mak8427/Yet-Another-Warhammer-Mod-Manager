//! Steam Workshop metadata and Steam-client actions.
//!
//! Subscription metadata comes from Steam's own `appworkshop_*.acf` files. The
//! manager never authenticates to Steam and never claims that a subscribe,
//! unsubscribe, or update succeeded: it opens the item in the Steam client and
//! the UI re-reads the ACF state afterwards.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::clock::system_time_to_iso8601;
use crate::error::{AppError, ErrorCode};
use crate::paths::{self, GameLocation, VdfValue};
use crate::session::Session;

/// WH3's Workshop metadata app id. The issue contract names this file
/// explicitly; the game's own app id is the fallback for installations that
/// use the conventional name.
pub const WORKSHOP_APP_ID: &str = "3247630";
pub const WH3_APP_ID: &str = "1142710";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkshopState {
    Subscribed,
    Installed,
    UpdatePending,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopItem {
    pub workshop_id: String,
    pub title: String,
    pub state: WorkshopState,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkshopAction {
    Open,
    Subscribe,
    Unsubscribe,
    Update,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamActionResult {
    pub action: WorkshopAction,
    pub workshop_id: String,
    /// True only when the Steam client accepted the URL as a process argument.
    /// This never means the subscription or update itself finished.
    pub opened: bool,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AcfEntry {
    pub manifest: Option<String>,
    pub time_updated: Option<i64>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkshopAcf {
    pub installed: BTreeMap<String, AcfEntry>,
    pub details: BTreeMap<String, AcfEntry>,
}

pub fn acf_paths(steam_root: &Path) -> [PathBuf; 2] {
    let base = steam_root.join("steamapps").join("workshop");
    [
        base.join(format!("appworkshop_{WORKSHOP_APP_ID}.acf")),
        base.join(format!("appworkshop_{WH3_APP_ID}.acf")),
    ]
}

pub fn parse_acf(text: &str) -> Result<WorkshopAcf, AppError> {
    let value = paths::parse_vdf(text).map_err(|error| {
        AppError::new(
            ErrorCode::SteamNotFound,
            "Steam Workshop metadata could not be parsed",
        )
        .with_details(error.details.unwrap_or(error.message))
    })?;
    let root = value.as_object().ok_or_else(|| {
        AppError::new(ErrorCode::SteamNotFound, "Steam ACF root is not an object")
    })?;
    let app = object_get(root, "AppWorkshop").ok_or_else(|| {
        AppError::new(
            ErrorCode::SteamNotFound,
            "Steam Workshop metadata has no AppWorkshop section",
        )
    })?;
    let app = app.as_object().ok_or_else(|| {
        AppError::new(
            ErrorCode::SteamNotFound,
            "Steam Workshop metadata has an invalid AppWorkshop section",
        )
    })?;

    let installed = app
        .get("WorkshopItemsInstalled")
        .or_else(|| object_get(app, "WorkshopItemsInstalled"))
        .and_then(VdfValue::as_object)
        .map(parse_entries)
        .unwrap_or_default();
    let details = app
        .get("WorkshopItemDetails")
        .or_else(|| object_get(app, "WorkshopItemDetails"))
        .and_then(VdfValue::as_object)
        .map(parse_entries)
        .unwrap_or_default();

    Ok(WorkshopAcf { installed, details })
}

fn parse_entries(values: &BTreeMap<String, VdfValue>) -> BTreeMap<String, AcfEntry> {
    values
        .iter()
        .filter(|(id, _)| id.chars().all(|character| character.is_ascii_digit()))
        .map(|(id, value)| {
            let object = value.as_object();
            let entry = AcfEntry {
                manifest: object
                    .and_then(|values| object_get(values, "manifest"))
                    .and_then(VdfValue::as_str)
                    .map(str::to_string),
                time_updated: object
                    .and_then(|values| object_get(values, "timeupdated"))
                    .and_then(VdfValue::as_str)
                    .and_then(|value| value.parse().ok()),
                title: object
                    .and_then(|values| object_get(values, "title"))
                    .and_then(VdfValue::as_str)
                    .map(str::to_string),
            };
            (id.clone(), entry)
        })
        .collect()
}

fn object_get<'a>(values: &'a BTreeMap<String, VdfValue>, key: &str) -> Option<&'a VdfValue> {
    values.get(key).or_else(|| {
        values
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(key))
            .map(|(_, value)| value)
    })
}

pub fn read_workshop_acf(steam_root: &Path) -> Result<WorkshopAcf, AppError> {
    if steam_root.as_os_str().is_empty() {
        return Err(AppError::new(
            ErrorCode::SteamNotFound,
            "Steam was not found; Workshop metadata is unavailable",
        ));
    }
    let candidates = acf_paths(steam_root);
    for path in &candidates {
        if !path.is_file() {
            continue;
        }
        let text = std::fs::read_to_string(path).map_err(|error| {
            AppError::io_path("Could not read Steam Workshop metadata", path, &error)
        })?;
        return parse_acf(&text);
    }
    Err(AppError::new(
        ErrorCode::SteamNotFound,
        "Steam Workshop metadata was not found",
    )
    .with_details(format!(
        "Checked {} and {}",
        candidates[0].display(),
        candidates[1].display()
    )))
}

pub fn items_from_acf(
    acf: &WorkshopAcf,
    local_titles: &HashMap<String, String>,
) -> Vec<WorkshopItem> {
    let mut ids: Vec<&String> = acf.installed.keys().chain(acf.details.keys()).collect();
    ids.sort();
    ids.dedup();
    let mut items: Vec<WorkshopItem> = ids
        .into_iter()
        .map(|id| {
            let installed = acf.installed.get(id);
            let detail = acf.details.get(id);
            let state = match (installed, detail) {
                (Some(installed), Some(detail))
                    if installed.manifest.is_some()
                        && detail.manifest.is_some()
                        && installed.manifest != detail.manifest =>
                {
                    WorkshopState::UpdatePending
                }
                (Some(_), _) => WorkshopState::Installed,
                (None, Some(_)) => WorkshopState::Subscribed,
                (None, None) => WorkshopState::Unknown,
            };
            let title = detail
                .and_then(|entry| entry.title.clone())
                .or_else(|| installed.and_then(|entry| entry.title.clone()))
                .or_else(|| local_titles.get(id).cloned())
                .unwrap_or_else(|| format!("Workshop item {id}"));
            let timestamp = installed
                .and_then(|entry| entry.time_updated)
                .or_else(|| detail.and_then(|entry| entry.time_updated));
            WorkshopItem {
                workshop_id: id.clone(),
                title,
                state,
                updated_at: timestamp.and_then(unix_seconds_to_iso8601),
            }
        })
        .collect();
    items.sort_by(|left, right| left.workshop_id.cmp(&right.workshop_id));
    items
}

fn unix_seconds_to_iso8601(seconds: i64) -> Option<String> {
    if seconds < 0 {
        return None;
    }
    let instant = SystemTime::UNIX_EPOCH.checked_add(Duration::from_secs(seconds as u64))?;
    system_time_to_iso8601(instant)
}

pub fn workshop_url(action: WorkshopAction, workshop_id: &str) -> String {
    match action {
        WorkshopAction::Open
        | WorkshopAction::Subscribe
        | WorkshopAction::Unsubscribe
        | WorkshopAction::Update => {
            format!("steam://url/CommunityFilePage/{workshop_id}")
        }
    }
}

pub fn action_message(action: WorkshopAction) -> &'static str {
    match action {
        WorkshopAction::Open => "Steam opened the Workshop page.",
        WorkshopAction::Subscribe => {
            "Steam opened the Workshop page. Subscribe there, then refresh to confirm the recorded state."
        }
        WorkshopAction::Unsubscribe => {
            "Steam opened the Workshop page. Unsubscribe there, then refresh to confirm the recorded state."
        }
        WorkshopAction::Update => {
            "Steam opened the Workshop page. Steam updates subscriptions automatically; refresh to confirm the recorded state."
        }
    }
}

pub fn find_steam_executable(location: &GameLocation) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if !location.steam_root.as_os_str().is_empty() {
        #[cfg(windows)]
        {
            candidates.push(location.steam_root.join("steam.exe"));
            candidates.push(location.steam_root.join("Steam.exe"));
        }
        #[cfg(not(windows))]
        {
            candidates.push(location.steam_root.join("steam.sh"));
            candidates.push(location.steam_root.join("steam"));
        }
    }
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    find_on_path(if cfg!(windows) { "steam.exe" } else { "steam" })
}

fn find_on_path(command: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(command))
        .find(|candidate| candidate.is_file())
}

fn spawn_steam_url(steam: &Path, url: &str) -> Result<(), AppError> {
    crate::host_process::command(steam, &[url.to_string()], &BTreeMap::new(), None)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            AppError::new(
                ErrorCode::SteamNotFound,
                "Steam could not be started; check that Steam is installed and running",
            )
            .with_details(format!("{} {url}: {error}", steam.display()))
        })
}

pub fn validate_workshop_id(workshop_id: &str) -> Result<(), AppError> {
    if workshop_id.is_empty()
        || !workshop_id
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(AppError::validation(
            "A Workshop item id must be a positive number",
        ));
    }
    Ok(())
}

fn launch_workshop_action(
    location: &GameLocation,
    action: WorkshopAction,
    workshop_id: &str,
    spawn: impl FnOnce(&Path, &str) -> Result<(), AppError>,
) -> Result<SteamActionResult, AppError> {
    let steam = find_steam_executable(location).ok_or_else(|| {
        AppError::new(
            ErrorCode::SteamNotFound,
            "Steam was not found; install Steam or point the manager at a Steam library",
        )
    })?;
    spawn(&steam, &workshop_url(action, workshop_id))?;
    Ok(SteamActionResult {
        action,
        workshop_id: workshop_id.to_string(),
        opened: true,
        message: action_message(action).to_string(),
    })
}

impl Session {
    pub fn workshop_items(&self) -> Result<Vec<WorkshopItem>, AppError> {
        let location = self.location.as_ref().ok_or_else(|| {
            AppError::new(
                ErrorCode::GameNotFound,
                "Could not find a Total War: Warhammer III installation",
            )
        })?;
        let acf = read_workshop_acf(&location.steam_root)?;
        let local_titles: HashMap<String, String> = self
            .mods
            .iter()
            .filter_map(|module| {
                module
                    .workshop_id
                    .as_ref()
                    .map(|id| (id.clone(), module.human_name.clone()))
            })
            .collect();
        let mut items = items_from_acf(&acf, &local_titles);
        let known: std::collections::HashSet<String> =
            items.iter().map(|item| item.workshop_id.clone()).collect();
        for module in &self.mods {
            if let Some(id) = &module.workshop_id {
                if !known.contains(id) {
                    items.push(WorkshopItem {
                        workshop_id: id.clone(),
                        title: module.human_name.clone(),
                        state: WorkshopState::Unknown,
                        updated_at: module.updated_at.clone(),
                    });
                }
            }
        }
        items.sort_by(|left, right| left.workshop_id.cmp(&right.workshop_id));
        Ok(items)
    }

    pub fn workshop_action(
        &self,
        action: WorkshopAction,
        workshop_id: &str,
    ) -> Result<SteamActionResult, AppError> {
        self.workshop_action_with_launcher(action, workshop_id, spawn_steam_url)
    }

    fn workshop_action_with_launcher(
        &self,
        action: WorkshopAction,
        workshop_id: &str,
        spawn: impl FnOnce(&Path, &str) -> Result<(), AppError>,
    ) -> Result<SteamActionResult, AppError> {
        validate_workshop_id(workshop_id)?;
        let location = self.location.as_ref().ok_or_else(|| {
            AppError::new(
                ErrorCode::GameNotFound,
                "Could not find a Total War: Warhammer III installation",
            )
        })?;
        launch_workshop_action(location, action, workshop_id, spawn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::SessionOptions;
    use crate::test_support::TempDir;
    use std::fs;

    const ACF: &str = r#"
"AppWorkshop"
{
    "appid" "3247630"
    "WorkshopItemsInstalled"
    {
        "111"
        {
            "manifest" "100"
            "timeupdated" "1700000000"
            "title" "Installed Mod"
        }
        "222"
        {
            "manifest" "200"
            "timeupdated" "1700000100"
        }
    }
    "WorkshopItemDetails"
    {
        "111"
        {
            "manifest" "100"
            "timeupdated" "1700000000"
        }
        "222"
        {
            "manifest" "201"
            "timeupdated" "1700000200"
        }
        "333"
        {
            "manifest" "300"
            "timeupdated" "1700000300"
            "title" "Only Subscribed"
        }
    }
}
"#;

    #[test]
    fn parses_installed_update_pending_and_subscribed_states() {
        let acf = parse_acf(ACF).unwrap();
        let items = items_from_acf(&acf, &HashMap::new());
        assert_eq!(items.len(), 3);
        let by_id: HashMap<&str, &WorkshopItem> = items
            .iter()
            .map(|item| (item.workshop_id.as_str(), item))
            .collect();
        assert_eq!(by_id["111"].state, WorkshopState::Installed);
        assert_eq!(by_id["111"].title, "Installed Mod");
        assert_eq!(by_id["222"].state, WorkshopState::UpdatePending);
        assert_eq!(by_id["333"].state, WorkshopState::Subscribed);
        assert_eq!(by_id["333"].title, "Only Subscribed");
        assert_eq!(
            by_id["111"].updated_at.as_deref(),
            Some("2023-11-14T22:13:20Z")
        );
    }

    #[test]
    fn malformed_acf_is_a_steam_metadata_error() {
        let error = parse_acf("this is not an acf").unwrap_err();
        assert_eq!(error.code, ErrorCode::SteamNotFound);
    }

    #[test]
    fn missing_acf_reports_the_checked_paths() {
        let dir = TempDir::new("workshop-missing");
        let error = read_workshop_acf(dir.path()).unwrap_err();
        assert_eq!(error.code, ErrorCode::SteamNotFound);
        assert!(error.details.unwrap().contains("appworkshop_3247630.acf"));
    }

    #[test]
    fn reads_acf_from_the_contract_path_first() {
        let dir = TempDir::new("workshop-paths");
        let acf_dir = dir.path().join("steamapps").join("workshop");
        fs::create_dir_all(&acf_dir).unwrap();
        fs::write(acf_dir.join("appworkshop_3247630.acf"), ACF).unwrap();
        let acf = read_workshop_acf(dir.path()).unwrap();
        assert_eq!(acf.installed.len(), 2);
    }

    #[test]
    fn workshop_actions_use_the_steam_client_url() {
        assert_eq!(
            workshop_url(WorkshopAction::Subscribe, "123"),
            "steam://url/CommunityFilePage/123"
        );
        assert_eq!(
            workshop_url(WorkshopAction::Update, "123"),
            "steam://url/CommunityFilePage/123"
        );
        assert!(action_message(WorkshopAction::Update).contains("refresh"));
    }

    #[test]
    fn rejects_non_numeric_workshop_ids() {
        let error = validate_workshop_id("../123").unwrap_err();
        assert_eq!(error.code, ErrorCode::Validation);
    }

    #[test]
    fn open_reaches_the_steam_launch_boundary_with_the_community_page_url() {
        let dir = TempDir::new("workshop-open");
        let steam_root = dir.path().join("Steam");
        let game = steam_root
            .join("steamapps")
            .join("common")
            .join("Total War WARHAMMER III");
        fs::create_dir_all(game.join("data")).unwrap();
        let steam = steam_root.join(if cfg!(windows) {
            "steam.exe"
        } else {
            "steam.sh"
        });
        fs::write(&steam, b"#!/bin/sh\n").unwrap();

        let session = Session::initialize(SessionOptions {
            config_path: dir.path().join("config.json"),
            steam_root_candidates: Some(Vec::new()),
            manual_game_path: Some(game),
            log_timings: false,
        })
        .unwrap();

        let mut launched = None;
        let result = session
            .workshop_action_with_launcher(WorkshopAction::Open, "123", |executable, url| {
                launched = Some((executable.to_path_buf(), url.to_string()));
                Ok(())
            })
            .unwrap();

        assert_eq!(
            launched,
            Some((steam, "steam://url/CommunityFilePage/123".to_string()))
        );
        assert_eq!(result.action, WorkshopAction::Open);
        assert_eq!(result.workshop_id, "123");
        assert!(result.opened);
        assert_eq!(result.message, action_message(WorkshopAction::Open));
    }

    #[test]
    fn finds_a_steam_executable_in_the_detected_root() {
        let dir = TempDir::new("workshop-steam");
        let steam = if cfg!(windows) {
            dir.path().join("steam.exe")
        } else {
            dir.path().join("steam.sh")
        };
        fs::write(&steam, b"#!/bin/sh\n").unwrap();
        let location = GameLocation {
            game_path: dir.path().to_path_buf(),
            data_path: dir.path().join("data"),
            workshop_path: PathBuf::new(),
            steam_root: dir.path().to_path_buf(),
            proton_prefix: None,
            source: crate::ipc::LocationSource::Manual,
        };
        assert_eq!(find_steam_executable(&location), Some(steam));
    }
}
