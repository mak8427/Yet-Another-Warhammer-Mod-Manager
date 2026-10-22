//! Window geometry persistence, safe restore, and webview zoom application.
//!
//! Only the main window is managed. The normal (non-maximised) bounds are
//! tracked while the window is open and written once on close, so dragging and
//! resizing do not rewrite `config.json`.

use std::sync::Mutex;

use tauri::{Manager as _, PhysicalPosition, PhysicalSize};
use wh3mm_core::ipc::{clamp_zoom, ZOOM_DEFAULT};
use wh3mm_core::window::{resolve, WindowGeometry, WorkArea};

use crate::commands::Manager;

/// Latest normal bounds observed while the window was open.
#[derive(Default)]
pub struct Tracker {
    normal: Mutex<Option<WindowGeometry>>,
}

impl Tracker {
    fn remember(&self, geometry: WindowGeometry) {
        if let Ok(mut normal) = self.normal.lock() {
            *normal = Some(geometry);
        }
    }

    fn normal(&self) -> Option<WindowGeometry> {
        self.normal.lock().ok().and_then(|normal| *normal)
    }

    fn observe(&self, window: &tauri::Window) {
        if window.is_maximized().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
            return;
        }
        let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
            return;
        };
        self.remember(WindowGeometry {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized: false,
        });
    }
}

/// Applies the saved geometry and zoom to the main window.
///
/// Placement failures are logged, not fatal: on Wayland the compositor owns the
/// position, and a missing monitor list must not stop the app from starting.
pub fn restore(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("wh3mm: the main window is missing; window state was not restored");
        return;
    };
    let Some(manager) = app.try_state::<Manager>() else {
        return;
    };
    let zoom = manager
        .get_ui_preferences()
        .map(|preferences| preferences.zoom)
        .unwrap_or(ZOOM_DEFAULT);

    if let Some(work_areas) = work_areas(&window) {
        let geometry = resolve(manager.window_geometry(), &work_areas);
        if let Err(error) = window.set_size(PhysicalSize::new(geometry.width, geometry.height)) {
            eprintln!("wh3mm: could not restore the window size: {error}");
        }
        if let Err(error) = window.set_position(PhysicalPosition::new(geometry.x, geometry.y)) {
            eprintln!("wh3mm: could not restore the window position: {error}");
        }
        if geometry.maximized {
            if let Err(error) = window.maximize() {
                eprintln!("wh3mm: could not restore the maximized state: {error}");
            }
        }
        if let Some(tracker) = app.try_state::<Tracker>() {
            tracker.remember(geometry);
        }
    }

    if let Err(error) = apply_zoom(&window, zoom) {
        eprintln!("wh3mm: could not restore the zoom level: {error}");
    }
}

pub fn handle_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    match event {
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            if let Some(tracker) = window.app_handle().try_state::<Tracker>() {
                tracker.observe(window);
            }
        }
        tauri::WindowEvent::CloseRequested { .. } => persist_geometry(window),
        _ => {}
    }
}

/// Applies a whole-interface webview zoom. The backend clamps the value again
/// so a stale or hand-edited config cannot exceed the supported range.
pub fn apply_zoom(
    window: &tauri::WebviewWindow,
    zoom: u16,
) -> Result<(), wh3mm_core::error::AppError> {
    window
        .set_zoom(f64::from(clamp_zoom(zoom)) / 100.0)
        .map_err(|error| {
            wh3mm_core::error::AppError::internal("Could not apply the zoom level")
                .with_details(error.to_string())
        })
}

fn persist_geometry(window: &tauri::Window) {
    let Some(manager) = window.app_handle().try_state::<Manager>() else {
        return;
    };
    let Some(tracker) = window.app_handle().try_state::<Tracker>() else {
        return;
    };
    let maximized = window.is_maximized().unwrap_or(false);
    let Some(mut geometry) = tracker.normal().or_else(|| manager.window_geometry()) else {
        return;
    };
    geometry.maximized = maximized;
    if let Err(error) = manager.set_window_geometry(geometry) {
        eprintln!("wh3mm: could not save the window geometry: {error}");
    }
}

fn work_areas(window: &tauri::WebviewWindow) -> Option<Vec<WorkArea>> {
    let monitors = window.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }
    Some(
        monitors
            .iter()
            .map(|monitor| {
                let area = monitor.work_area();
                WorkArea {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width,
                    height: area.size.height,
                }
            })
            .collect(),
    )
}
