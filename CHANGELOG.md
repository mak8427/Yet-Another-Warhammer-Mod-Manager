# Changelog

All notable changes to the WH3 Mod Manager rebuild are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - unreleased

This entry describes the scope merged on `main` as of 2026-10-21. The `v1.0.0`
tag and the published release wait for M4 (WAR-10) and the WAR-12 release
audit; see `docs/RELEASE.md`.

### Added

- **M0 — application foundation** (`#1`, `abceb50`): Rust workspace, Tauri 2
  Windows shell, TypeScript/Vite frontend, typed IPC skeleton, ADRs, Linux CI
  gates, and a manual Windows shell build.
- **M1/M2 — detection and mod management** (`#6`, `c1a9cdd`): Steam and game
  detection across registry, native, Flatpak, Snap, and XDG roots; modern and
  legacy `libraryfolders.vdf`; PFH5 pack parsing; the mod index; the mod list;
  load-order read/write with an atomic `used_mods.txt` and `.bak` recovery;
  profiles; tags; UI preferences.
- **M3 — conflicts, Workshop, and launch** (`#18`, `bb306d4`): conflict
  analysis with a disabled-local-dependency fix, Steam Workshop discovery and
  thumbnails, and game launch with the saved load order.
- **UI direction** (`#10`, `32945a2`): the Total War: Warhammer III-inspired
  visual system, design tokens, density rules, keyboard map, and the screen
  acceptance checklist.
- **Performance and QA gates** (`#4`, `#7`, `#19`): the legacy baseline
  measurement harness, the 500-mod fixture, acceptance suites, and the perf gate.
- **Release engineering** (this branch): Windows NSIS and MSI bundle
  configuration at version 1.0.0, a `v*` tag workflow that builds the
  installers, uploads the artifact, and opens a draft release, and this release
  guide plus changelog.

### Known limitations

v1.0 accepts these limitations; the exact manual checks are in `docs/RELEASE.md`.

- **WS-3 — Steam subscription actions are manual.** Subscribe, unsubscribe, and
  update through the Steam client; the app has no custom Steam authentication
  and never automates them. Manual check: subscribe and unsubscribe in Steam,
  rescan, and confirm the mod list follows.
- **LA-1 — launch through Steam is measured as a proxy.** The launch number is a
  proxy, not an in-game load time. Manual check: launch in the Windows QA pass
  and keep the proxy label.
- **ML-4 — scroll persistence and the 20k-row guard are polish.** A reset scroll
  position is accepted; the 20k fixture must show the guard instead of freezing.
  Manual check in the Windows QA pass.
- **SET-2 — density/author/thumbnail preferences are best-effort.** Manual
  check: toggle each, restart, confirm the values persist, and record any that
  do not.
- **DET-1 — Linux Flatpak/Snap/XDG discovery is best-effort.** Windows registry
  and native root are fixture-tested on WAR-10. Manual check: detect on Linux
  Flatpak/Snap or use the manual path; confirm Windows detection without a path.
- The Windows installer is unsigned; SmartScreen shows the documented
  "Unknown publisher" warning.
- M4 (the full TW:WH3 visual pass on every v1.0 screen) is not merged yet.
- The offline installer is not shipped; WebView2 uses the bootstrapper.
- No auto-updater, telemetry, account system, or Windows code signing.

[1.0.0]: https://github.com/mak8427/Warhammer_mod_manager/releases/tag/v1.0.0
