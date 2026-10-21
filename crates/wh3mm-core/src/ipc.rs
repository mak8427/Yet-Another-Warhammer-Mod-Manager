use serde::{Deserialize, Serialize};

use crate::error::{AppError, ErrorCode};

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

/// Request payload for `write_load_order`.
///
/// The Tauri command receives the two flags as flat `allowEmpty` /
/// `confirmUnmanagedLoss` arguments and assembles this type before planning.
/// Both flags are explicit: there are no implicit confirmations. The frontend
/// must call `preview_load_order` first and set a flag only after the user
/// acknowledges the corresponding warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadOrderWriteRequest {
    /// Permission to replace a non-empty managed list with an empty one.
    pub allow_empty: bool,
    /// Permission to drop unmanaged directives from the existing file.
    pub confirm_unmanaged_loss: bool,
}

/// Facts from the read/resolve/plan pass that decide whether a write may run.
///
/// The M2 writer builds these facts from the current `used_mods.txt` and the
/// resolved enabled set, then calls [`LoadOrderWriteRequest::validate`] before
/// creating a backup or a temporary file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadOrderWriteFacts {
    /// Number of managed `mod "..."` lines in the existing file.
    pub existing_managed_lines: usize,
    /// Number of managed `mod "..."` lines the new write would produce.
    pub planned_managed_lines: usize,
    /// Unmanaged directives that the write would replace.
    pub unmanaged_directives: Vec<String>,
}

impl LoadOrderWriteRequest {
    /// Applies the two destructive-write refusals from ADR-002.
    ///
    /// Returns `validation` without side effects when the caller has not
    /// confirmed dropping unmanaged directives or writing an empty list.
    pub fn validate(&self, facts: &LoadOrderWriteFacts) -> Result<(), AppError> {
        if !facts.unmanaged_directives.is_empty() && !self.confirm_unmanaged_loss {
            return Err(AppError::new(
                ErrorCode::Validation,
                "Writing the load order would drop unmanaged directives.",
            )
            .with_details(format!(
                "{} unmanaged directive(s) would be removed; pass confirmUnmanagedLoss: true to proceed: {}",
                facts.unmanaged_directives.len(),
                facts.unmanaged_directives.join(" | ")
            )));
        }

        if facts.existing_managed_lines > 0 && facts.planned_managed_lines == 0 && !self.allow_empty
        {
            return Err(AppError::new(
                ErrorCode::Validation,
                "Writing would empty a non-empty load order.",
            )
            .with_details(format!(
                "The existing file has {} managed mod line(s); pass allowEmpty: true to write an empty list.",
                facts.existing_managed_lines
            )));
        }

        Ok(())
    }
}

/// Result of `preview_load_order` and `write_load_order`.
///
/// A preview reports what a write would do; a write reports what it did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOrderWriteReport {
    /// Absolute path of `used_mods.txt`.
    pub path: String,
    /// Backup associated with this operation: the `.bak` created by a write,
    /// the `.bak` a preview would use, or the `.bak` restored by
    /// `restore_load_order_backup`. `None` when no backup applies.
    pub backup_path: Option<String>,
    /// Number of managed mod lines written (preview: would be written).
    pub written: usize,
    /// Enabled names that did not resolve to a discovered pack.
    pub skipped: Vec<String>,
    /// Raw unmanaged directives dropped by the write (preview: would be
    /// dropped).
    pub unmanaged_directives: Vec<String>,
}
