# ADR-007 — Linux desktop shell for native Steam and Proton

- Status: accepted
- Date: 2026-10-22
- Owner: Boris Todbringer
- Amends: ADR-001 (shell gating), ADR-004 (test layers and Linux gates)
- Product contract: `docs/PRODUCT_SCOPE.md`

## Context

The v1.0 product was Windows-first. ADR-001 gated `tauri` and `tauri-build` to
`cfg(windows)` so Linux CI could compile and test the domain crate without
WebKitGTK. That kept the core headless, but it also made `cargo run -p
wh3mm-app` print a Windows-only stub on Linux even though the core already had
Unix Steam discovery, Proton-prefix detection, `/proc` game-process detection,
and `steam.sh`/`steam` launch support.

`docs/PRODUCT_SCOPE.md` already says Linux is supported where Steam/Proton
detection is reliable. The remaining gap is the desktop shell itself, not the
game, pack, load-order, or Workshop logic.

The supported Linux configuration is a native Steam client with Total War:
Warhammer III running through Proton. Flatpak and Snap Steam clients are out of
scope for this decision; their game detection remains in the core, but this ADR
does not add a launch path for them.

## Decision

### Shell gating

`crates/wh3mm-app/Cargo.toml`, `build.rs`, `lib.rs`, `main.rs`, and
`commands.rs` use `cfg(any(windows, target_os = "linux"))` for the Tauri shell,
the `tauri::command` attribute, and the command wrappers. macOS keeps the
existing unsupported fallback.

`wh3mm-core` remains free of Tauri and WebView dependencies. The app crate stays
a thin command layer; no game, Steam, pack, or load-order logic moves into it.

### Threading seam

Outside tests the desktop shell uses `tauri::async_runtime::spawn_blocking` on
both Windows and Linux. Tests use `tokio::task::spawn_blocking` so the
off-main-thread contract can run in headless CI without initializing a Tauri
runtime or opening a window.

### Build and CI

This repository builds the shell with cargo, not the Tauri CLI, so the `tauri`
dependency enables the `custom-protocol` feature. Without it Tauri treats the
build as development mode and the WebView loads `devUrl`
(`http://localhost:1420`) instead of the embedded frontend. The feature applies
to cargo-built debug and release binaries; the supported path is always
`pnpm build` followed by cargo.

`generate_context!` embeds `frontend/dist` at compile time, so every
workspace-wide cargo command now needs the frontend built first:

```bash
pnpm install --frozen-lockfile
pnpm build
cargo test --workspace --locked
```

`cargo test -p wh3mm-core --locked` remains frontend- and WebView-free.

The Linux CI job installs the Tauri v2 desktop packages (WebKitGTK 4.1, GTK3,
libayatana-appindicator, librsvg, OpenSSL, D-Bus), builds the frontend before
clippy and tests, and builds the release shell. It uploads
`target/release/wh3mm` as the `wh3mm-linux-x64` artifact. The Windows shell job
remains manual until packaging CI changes in a separate task.

### UI

The game-folder placeholder follows the reported platform: Linux shows a
Linux-style Steam library path, Windows keeps the existing Windows path.

## Consequences

- Linux users can build and run the same desktop application as Windows users,
  including Steam detection, Proton-prefix display, the mod list, load order,
  profiles, conflicts, Workshop metadata, and launch through native Steam.
- A clean Linux build needs WebKitGTK and GTK3 development packages, and a run
  needs the WebKitGTK 4.1 runtime.
- The Linux quality gate is slower because it compiles the Tauri dependency
  graph. The core crate remains the fast, headless test target.
- Flatpak/Snap Steam launch, macOS, and Linux installer packaging remain out of
  scope. They need their own decisions and release work.
