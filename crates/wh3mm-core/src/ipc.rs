use serde::{Deserialize, Serialize};

use crate::timing::Timings;

/// Identity and build information for the running application.
///
/// This is the M0 proof command for the typed IPC contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Human-facing product name.
    pub name: String,
    /// Version of the desktop shell (`wh3mm-app`).
    pub version: String,
    /// Version of the pure domain crate (`wh3mm-core`).
    pub core_version: String,
    /// Operating system as reported by `std::env::consts::OS`.
    pub platform: String,
    /// CPU architecture as reported by `std::env::consts::ARCH`.
    pub arch: String,
}

/// How a game location was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocationSource {
    Auto,
    Manual,
}

/// Resolved WH3/Steam paths returned to the UI for display and the override form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLocation {
    pub game_path: String,
    pub data_path: String,
    pub workshop_path: String,
    pub steam_root: String,
    pub proton_prefix: Option<String>,
    pub source: LocationSource,
}

/// One discovered mod as rendered by the list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSummary {
    /// Opaque, core-assigned identity derived from the canonical pack path.
    pub id: String,
    /// Pack file name, e.g. `mymod.pack`. This is what `used_mods.txt` stores.
    pub name: String,
    /// Display name. The Workshop title in M3; the pack stem before that.
    pub human_name: String,
    pub author: Option<String>,
    pub is_workshop: bool,
    pub workshop_id: Option<String>,
    pub is_enabled: bool,
    /// Zero-based display index (top of the list = 0).
    pub load_order: u32,
    /// Tag ids assigned through the app config.
    pub tags: Vec<String>,
    pub updated_at: Option<String>,
    pub thumbnail_path: Option<String>,
    /// Dependency pack names declared by the pack header.
    pub dependencies: Vec<String>,
    /// Populated when the pack header could not be parsed; the mod stays listed.
    pub pack_error: Option<String>,
    pub is_movie: bool,
    pub size_bytes: u64,
}

/// Result of reading `used_mods.txt`, including the recovery information the UI needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOrderReadReport {
    pub path: String,
    pub present: bool,
    pub corrupt: bool,
    pub message: Option<String>,
    /// Set when the file exists but could not be read; writes stay blocked.
    pub unreadable: Option<String>,
    /// Every managed name found in the file, in file order (deduplicated).
    pub mod_names: Vec<String>,
    /// Names that resolve to a discovered mod, by id, in file order.
    pub resolved_mod_ids: Vec<String>,
    /// Names that do not resolve against the current scan.
    pub missing_names: Vec<String>,
    /// Names repeated in the file (case-insensitive); first occurrence wins.
    pub duplicates: Vec<String>,
    /// Non-`mod` directives found in the file.
    pub unmanaged_directives: Vec<String>,
    /// True when `used_mods.txt.bak` exists next to the file.
    pub backup_available: bool,
}

/// Plan/preview for a `used_mods.txt` write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOrderWriteReport {
    pub path: String,
    pub backup_path: Option<String>,
    pub written: usize,
    pub skipped: Vec<String>,
    pub unmanaged_directives: Vec<String>,
    pub would_drop_unmanaged: bool,
    pub existing_mod_count: usize,
    pub resulting_mod_count: usize,
    pub can_write: bool,
    pub blocked_reason: Option<String>,
    /// The caller must pass `allowEmpty` before this write can proceed.
    pub requires_empty_confirmation: bool,
    /// The caller must pass `confirmUnmanagedLoss` before this write can proceed.
    pub requires_unmanaged_confirmation: bool,
    /// No confirmation flag can make this write safe (corrupt file or nothing resolved).
    pub hard_blocked: bool,
}

/// One authoritative mod-list state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModListSnapshot {
    pub mods: Vec<ModSummary>,
    pub enabled_count: u32,
    pub active_profile_id: String,
    pub load_order: LoadOrderReadReport,
    pub timings: Timings,
    /// Non-fatal conditions from config recovery, scanning, or deduplication.
    pub warnings: Vec<String>,
}

/// How a confirmed reset handled the game-owned load-order file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetLoadOrderStatus {
    /// An empty `used_mods.txt` was written through the atomic path.
    Written,
    /// The override was cleared and automatic detection found no game.
    NoGamePath,
    /// The reset stopped because the existing file cannot be safely replaced.
    Failed,
    /// The reset stopped because dropping unmanaged directives needs confirmation.
    UnmanagedDirectives,
}

/// Load-order outcome of a confirmed reset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetLoadOrderReport {
    pub status: ResetLoadOrderStatus,
    /// Why the write failed or is waiting for confirmation.
    pub message: Option<String>,
    /// Directives that the pending reset write would drop.
    pub unmanaged_directives: Vec<String>,
    /// Repeat the reset with `confirmUnmanagedLoss: true` to drop them.
    pub requires_unmanaged_confirmation: bool,
}

/// Result of a confirmed reset to documented defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetDefaultsReport {
    pub load_order: ResetLoadOrderReport,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Ordered enabled set; the index is the load order.
    pub enabled_mod_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesState {
    pub profiles: Vec<Profile>,
    pub active_profile_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    /// `#RRGGBB`
    pub color: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    #[default]
    Comfortable,
    Compact,
    Roomy,
}

impl<'de> Deserialize<'de> for Density {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.to_ascii_lowercase().as_str() {
            "compact" => Self::Compact,
            "roomy" => Self::Roomy,
            _ => Self::Comfortable,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UiPreferences {
    pub density: Density,
    pub show_authors: bool,
    pub show_thumbnails: bool,
    pub last_scroll_top: u64,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            density: Density::Comfortable,
            show_authors: true,
            show_thumbnails: true,
            last_scroll_top: 0,
        }
    }
}
