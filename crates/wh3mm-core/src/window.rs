//! Persisted desktop-window geometry and safe restore against monitor work areas.
//!
//! The Tauri shell owns the platform types; this module keeps the restore rules
//! testable without a display. Geometry is stored in physical pixels because
//! that is the coordinate space Tauri reports for window positions and monitor
//! rectangles.

use serde::{Deserialize, Serialize};

/// Smallest usable window size; matches the 1024x720 minimum viewport contract
/// with room for the title bar on a 768-pixel screen.
pub const MIN_WIDTH: u32 = 1024;
pub const MIN_HEIGHT: u32 = 600;

/// First-run size. 680px leaves room for the title bar and taskbar on the
/// documented 1366x768 display.
pub const DEFAULT_WIDTH: u32 = 1280;
pub const DEFAULT_HEIGHT: u32 = 680;

/// Window geometry as persisted in `config.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// A monitor work area in physical pixels (screen minus taskbar and dock).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WindowGeometry {
    /// Drops obviously unusable values so a hand-edited config cannot create a
    /// zero-sized or absurdly large window. The monitor clamp still runs on top
    /// of this at restore time.
    pub fn sane(self) -> Self {
        Self {
            x: self.x.clamp(-65_536, 65_536),
            y: self.y.clamp(-65_536, 65_536),
            width: self.width.clamp(320, 32_768),
            height: self.height.clamp(240, 32_768),
            maximized: self.maximized,
        }
    }
}

/// Resolves persisted geometry to a position that is fully visible on an
/// available monitor.
///
/// * No saved geometry: a centred 1280x680 window on the primary work area.
/// * Off-screen or on a disconnected monitor: the saved size, centred on the
///   primary work area.
/// * Partially off-screen: pulled fully into the chosen work area.
/// * Larger than the monitor: reduced to fit.
///
/// The first work area is the primary monitor; the shell guarantees that order.
/// `maximized` is carried through; the caller applies it after positioning.
pub fn resolve(saved: Option<WindowGeometry>, work_areas: &[WorkArea]) -> WindowGeometry {
    let Some(primary) = work_areas.first().copied() else {
        return WindowGeometry {
            x: 0,
            y: 0,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            maximized: false,
        };
    };

    let Some(saved) = saved else {
        return centered(DEFAULT_WIDTH, DEFAULT_HEIGHT, false, primary);
    };

    match best_work_area(saved, work_areas) {
        Some(work_area) => fit(saved, work_area),
        None => centered(
            saved.width.max(1),
            saved.height.max(1),
            saved.maximized,
            primary,
        ),
    }
}

fn best_work_area(geometry: WindowGeometry, work_areas: &[WorkArea]) -> Option<WorkArea> {
    let window = rect(geometry.x, geometry.y, geometry.width, geometry.height);
    work_areas
        .iter()
        .copied()
        .map(|area| {
            let intersection = intersection_area(window, area);
            (area, intersection)
        })
        .filter(|(_, intersection)| *intersection > 0)
        .max_by_key(|(_, intersection)| *intersection)
        .map(|(area, _)| area)
}

fn fit(geometry: WindowGeometry, work_area: WorkArea) -> WindowGeometry {
    let width = geometry.width.max(MIN_WIDTH).min(work_area.width).max(1);
    let height = geometry.height.max(MIN_HEIGHT).min(work_area.height).max(1);
    let max_x = i64::from(work_area.x) + i64::from(work_area.width) - i64::from(width);
    let max_y = i64::from(work_area.y) + i64::from(work_area.height) - i64::from(height);
    WindowGeometry {
        x: i64::from(geometry.x).clamp(i64::from(work_area.x), max_x) as i32,
        y: i64::from(geometry.y).clamp(i64::from(work_area.y), max_y) as i32,
        width,
        height,
        maximized: geometry.maximized,
    }
}

fn centered(width: u32, height: u32, maximized: bool, work_area: WorkArea) -> WindowGeometry {
    let width = width.max(MIN_WIDTH).min(work_area.width).max(1);
    let height = height.max(MIN_HEIGHT).min(work_area.height).max(1);
    WindowGeometry {
        x: (i64::from(work_area.x) + (i64::from(work_area.width) - i64::from(width)) / 2) as i32,
        y: (i64::from(work_area.y) + (i64::from(work_area.height) - i64::from(height)) / 2) as i32,
        width,
        height,
        maximized,
    }
    .sane()
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    left: i64,
    top: i64,
    right: i64,
    bottom: i64,
}

fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
    let left = i64::from(x);
    let top = i64::from(y);
    Rect {
        left,
        top,
        right: left + i64::from(width),
        bottom: top + i64::from(height),
    }
}

fn intersection_area(window: Rect, area: WorkArea) -> i64 {
    let other = rect(area.x, area.y, area.width, area.height);
    let width = (window.right.min(other.right) - window.left.max(other.left)).max(0);
    let height = (window.bottom.min(other.bottom) - window.top.max(other.top)).max(0);
    width * height
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work_area(x: i32, y: i32, width: u32, height: u32) -> WorkArea {
        WorkArea {
            x,
            y,
            width,
            height,
        }
    }

    fn primary_1366() -> WorkArea {
        work_area(0, 0, 1366, 728)
    }

    #[test]
    fn default_window_fits_a_1366_by_768_display() {
        let resolved = resolve(None, &[primary_1366()]);
        assert_eq!(resolved.width, 1280);
        assert_eq!(resolved.height, 680);
        assert!(resolved.x >= 0);
        assert!(resolved.y >= 0);
        assert!(resolved.x + resolved.width as i32 <= 1366);
        assert!(resolved.y + resolved.height as i32 <= 728);
        assert!(!resolved.maximized);
    }

    #[test]
    fn saved_geometry_inside_a_monitor_is_kept() {
        let saved = WindowGeometry {
            x: 100,
            y: 20,
            width: 1200,
            height: 700,
            maximized: false,
        };
        assert_eq!(resolve(Some(saved), &[primary_1366()]), saved);
    }

    #[test]
    fn position_from_a_disconnected_monitor_centers_on_the_primary() {
        let primary = work_area(0, 0, 1920, 1040);
        let saved = WindowGeometry {
            x: 5000,
            y: 900,
            width: 1280,
            height: 800,
            maximized: true,
        };
        let resolved = resolve(Some(saved), &[primary]);
        assert_eq!(resolved.width, 1280);
        assert_eq!(resolved.height, 800);
        assert_eq!(resolved.x, 320);
        assert_eq!(resolved.y, 120);
        assert!(resolved.maximized);
    }

    #[test]
    fn oversized_window_is_reduced_to_the_work_area() {
        let primary = work_area(0, 0, 1920, 1040);
        let saved = WindowGeometry {
            x: -200,
            y: -100,
            width: 3000,
            height: 2000,
            maximized: false,
        };
        let resolved = resolve(Some(saved), &[primary]);
        assert_eq!(
            resolved,
            WindowGeometry {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
                maximized: false
            }
        );
    }

    #[test]
    fn partially_offscreen_window_is_pulled_inside() {
        let saved = WindowGeometry {
            x: -100,
            y: -50,
            width: 1280,
            height: 680,
            maximized: false,
        };
        let resolved = resolve(Some(saved), &[primary_1366()]);
        assert_eq!(resolved.x, 0);
        assert_eq!(resolved.y, 0);
        assert_eq!(resolved.width, 1280);
        assert_eq!(resolved.height, 680);
    }

    #[test]
    fn negative_coordinates_on_a_left_monitor_are_preserved() {
        let left = work_area(-1920, 0, 1920, 1040);
        let right = work_area(0, 0, 1920, 1040);
        let saved = WindowGeometry {
            x: -1800,
            y: 100,
            width: 1280,
            height: 800,
            maximized: false,
        };
        let resolved = resolve(Some(saved), &[left, right]);
        assert_eq!(resolved.x, -1800);
        assert_eq!(resolved.y, 100);
        assert_eq!(resolved.width, 1280);
        assert_eq!(resolved.height, 800);
    }

    #[test]
    fn geometry_in_a_gap_between_monitors_falls_back_to_the_primary() {
        let left = work_area(-2000, 0, 1000, 1040);
        let right = work_area(0, 0, 1920, 1040);
        let saved = WindowGeometry {
            x: -900,
            y: 100,
            width: 80,
            height: 80,
            maximized: false,
        };
        let resolved = resolve(Some(saved), &[right, left]);
        assert_eq!(resolved.width, MIN_WIDTH);
        assert_eq!(resolved.height, MIN_HEIGHT);
        assert_eq!(resolved.x, 448);
        assert_eq!(resolved.y, 220);
    }

    #[test]
    fn missing_monitors_fall_back_to_the_default_size() {
        let resolved = resolve(None, &[]);
        assert_eq!(
            resolved,
            WindowGeometry {
                x: 0,
                y: 0,
                width: DEFAULT_WIDTH,
                height: DEFAULT_HEIGHT,
                maximized: false,
            }
        );
    }

    #[test]
    fn tiny_saved_size_is_raised_to_the_minimum_when_the_monitor_allows() {
        let saved = WindowGeometry {
            x: 10,
            y: 10,
            width: 10,
            height: 10,
            maximized: false,
        };
        let resolved = resolve(Some(saved), &[primary_1366()]);
        assert_eq!(resolved.width, MIN_WIDTH);
        assert_eq!(resolved.height, MIN_HEIGHT);
    }
}
