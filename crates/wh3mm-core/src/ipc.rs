use serde::{Deserialize, Serialize};

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
