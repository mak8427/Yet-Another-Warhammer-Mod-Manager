//! Lightweight duration instrumentation for the hot startup paths.

use std::time::Duration;

/// Durations captured while loading a mod-list snapshot. Returned to the UI and
/// logged so WAR-7 can benchmark the real path instead of a synthetic harness.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub startup_ms: u64,
    pub detection_ms: u64,
    pub scan_ms: u64,
    pub load_order_ms: u64,
    pub total_ms: u64,
}

impl Timings {
    pub fn from_durations(
        startup: Duration,
        detection: Duration,
        scan: Duration,
        load_order: Duration,
        total: Duration,
    ) -> Self {
        Self {
            startup_ms: millis(startup),
            detection_ms: millis(detection),
            scan_ms: millis(scan),
            load_order_ms: millis(load_order),
            total_ms: millis(total),
        }
    }
}

fn millis(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

/// Emits one structured line per measured phase. Kept dependency-free so the
/// core crate stays headless and the log is easy to parse in benchmarks.
pub fn log_timing(label: &str, duration: Duration) {
    eprintln!("wh3mm: timing {label}={}ms", duration.as_millis());
}
