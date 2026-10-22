# ADR-008 — Persisted window geometry and whole-interface zoom

- Status: accepted
- Date: 2026-10-22
- Owner: Katerina Zarina
- Depends on: ADR-001, ADR-002, ADR-003, ADR-006
- Implements: WAR-141 (GitHub issue #47)

## Context

The desktop shell opened every launch at a fixed 1280x840 window. That height
does not fit the 1366x768 viewport required by `docs/UI_ACCEPTANCE.md`, and
neither size, position, nor maximised state survived a restart. The shell also
had no zoom control: density changes row heights only and does not scale text or
chrome.

Two pieces of state are involved. Zoom is a user preference, belongs beside
density, and must participate in **Reset to defaults**. Window geometry is
desktop state, belongs in the same config document so it is saved atomically,
and is not a user preference. Window placement rules depend on monitor work
areas, which are only available from the platform shell.

## Decision

### Zoom

- `ui.zoom` is a percentage in `UiPreferences` (config schema v1, additive
  field, `serde(default)`). The range is 80–200 in 10-point steps; the default
  and the value restored by **Reset to defaults** is 100.
- The backend clamps every persisted or caller-supplied value with
  `wh3mm_core::ipc::clamp_zoom`. An older config without `zoom` loads as 100,
  so no schema-version bump is required.
- The frontend applies the steps and clamps locally for immediate feedback, then
  persists the whole `UiPreferences` through `update_ui_preferences`. That
  command applies `WebviewWindow::set_zoom(zoom / 100)` after a successful
  save, so the webview is never scaled by CSS and SVG/table layout stays
  consistent.
- Startup applies the saved zoom in the shell setup, before the UI is
  interactive. **Reset to defaults** applies 100 after the reset succeeds.
- Shortcuts are `Ctrl`/`Cmd` + `+`/`-`/`0` and `Ctrl`/`Cmd` + wheel. They work
  while a text field has focus, like browser zoom. The Settings screen exposes
  the same action as a visible −/level/+/Reset control, and a short toast
  reports the new level.

### Window geometry

- `window` is an optional `WindowGeometry` in `AppConfig`: physical outer `x`,
  `y`, inner `width`/`height` (the same units Tauri's `set_position` and
  `set_size` use), and `maximized`. `null` means first run; the shell then uses
  a centred 1280x680 window.
- `tauri.conf.json` changes the first-run height from 840 to 680, reduces
  `minHeight` from 720 to 600 so a 768-pixel-tall screen can show the whole
  window with its title bar, and centres the first window.
- Normal bounds are tracked from `Moved`/`Resized` events while the window is
  not maximised or minimised; maximised bounds are never stored as normal
  bounds. The latest values are written once on `CloseRequested`. Dragging does
  not rewrite the config.
- Restore is a pure core function,
  `wh3mm_core::window::resolve(saved, work_areas)`:
  - the monitor with the largest intersection owns the window;
  - a window that intersects no monitor is centred on the primary work area
    with its saved size;
  - a window larger than the work area is reduced to fit;
  - a partially off-screen window is pulled fully inside;
  - negative coordinates on a monitor to the left of the primary are preserved.
  The shell maps Tauri monitor work areas to `WorkArea` and applies physical
  size and position. A placement failure is logged and non-fatal because
  Wayland compositors own window positions.
- Geometry survives **Reset to defaults**; it is desktop state, not an
  appearance preference.

### Tests and evidence

- `wh3mm-core` tests cover zoom clamping, config round-trip, legacy configs
  without `zoom`, geometry round-trip, and every restore branch (off-screen,
  disconnected monitor, oversized, partially visible, left monitor, gap, no
  monitors).
- Frontend tests cover the zoom bounds, keyboard and wheel shortcuts, the
  Settings control, and persistence through the typed IPC contract.
- The `screenshots-m4.mjs` QA harness accepts `SHOT_OUT` and `SHOT_ONLY`, so
  WAR-141 can capture the Settings and mod-list screens at both documented
  viewports without rewriting the M4 evidence set.

## Consequences

- The config schema remains v1. A downgrade to a build without `zoom`/`window`
  drops the fields without losing any other state; a later upgrade reads the
  defaults.
- Window geometry is saved on a normal close. A process kill loses only the
  geometry, never other preferences, which are saved when they change.
- Linux placement is best-effort under Wayland; size, zoom, and maximised state
  still persist.
