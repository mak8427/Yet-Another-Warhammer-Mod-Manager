# WH3 Mod Manager v1.0 — Product Scope

Owner: Torgrim (CEO). Status: **decided**, supersedes feature-parity assumptions.
Reference product: https://github.com/Shazbot/WH3-Mod-Manager (legacy Electron app).

## Goal

Ship a fast, trustworthy Windows desktop mod manager for **Total War: Warhammer III only**:
Rust backend, TypeScript frontend, aggressive feature pruning, TW:WH3-inspired dense UI.

"100%" means this document's v1.0 acceptance criteria, **not** parity with the legacy app.
Legacy features that are not in the "In scope" list are cut on purpose.

## Non-negotiables

1. Backend is Rust. No Node/Electron main process, no TypeScript business logic touching the filesystem.
2. Frontend is TypeScript. The legacy UI is ported and modernised, not thrown away.
3. Redundant/low-value features are deleted, not ported.
4. The mod list is the primary surface: dense, readable, keyboard-friendly, virtualized.
5. Load-order and enablement writes must never corrupt a user's existing setup.

## In scope — v1.0

| # | Capability | Minimum behaviour |
|---|------------|-------------------|
| 1 | Game & Steam detection | Locate WH3 install, data dir, Workshop content dir across Steam library folders (incl. Flatpak/Snap on Linux, Proton prefix). Clear manual override. |
| 2 | Mod discovery | Local `.pack` mods + Workshop items. Parse pack header (name, type, timestamp, dependencies). Handle malformed packs without crashing. |
| 3 | Mod list | Enable/disable, multi-select, drag reorder, move to top/bottom, search, sort, tag/category filter, virtualized rows, persisted scroll. |
| 4 | Load order write | Read/write `used_mods.txt` compatibly; atomic write + `.bak`; report what will be written before destructive changes. |
| 5 | Profiles | Create/save/rename/duplicate/delete; restore enabled set + order; default profile on first run. |
| 6 | Conflicts | Compare enabled packs' file indexes; show which mod wins each conflicting path; warn on missing dependencies and duplicate pack names. |
| 7 | Workshop | List subscriptions and update state from Steam metadata; open item page; subscribe/unsubscribe/update through the Steam client. No custom Steam auth. |
| 8 | Launch | Launch WH3 directly on Windows and through direct Proton on Linux, with skip-intro and script-logging options; verify the game is not already running, that the applied order matches the file, and that `used_mods.txt` is not rewritten during the launch guard. |
| 9 | Settings | Paths, density, thumbnail columns, backup/restore load order, reset to defaults. English UI only. |
| 10 | Safety | Atomic config writes, corrupt-file recovery, structured error messages, no silent data loss. |

## Cut — do not port

- Every game except Warhammer III (WH2, WH3 legacy variants, 3K, Troy, Pharaoh, Attila, Rome II, Shogun 2, Napoleon, Empire, Thrones of Britannia).
- Pack/database table viewer, unit viewer, unit painter, tech trees, skills tree, node graph editor, ESF map renderer, campaign map renderer.
- 3D/asset host, Three.js, texture/KTX2 preview, model viewer.
- DB clone, native patches editor, compression analysis, RPFM TSV import/export, pack file editor.
- Code editor (CodeMirror), localisation editor, multi-language UI, mod thumbnail generation beyond reading existing thumbnails.
- Electron, Electron Forge, Webpack, Flowbite, Redux Toolkit, React Router (single-window shell), Joyride onboarding.
- Account systems, telemetry, auto-update infrastructure (installer + release page is enough for v1.0).

## Architecture constraints (tech lead owns the details)

- **Tauri 2** shell: Rust `core` crate with all game/Steam/pack logic, thin Tauri command layer, TS UI.
- Rust core must be testable headlessly on Linux CI (no WebView dependency in unit/integration tests).
- Frontend: React + TypeScript + Vite, one state store, typed IPC client generated or mirrored from Rust types.
- Windows is the primary target; Linux is supported where Steam/Proton detection is reliable.
- No frontend filesystem access; all mutations go through Rust commands.
- Every cross-module decision gets a short ADR in `docs/adr/`.

## Milestones

- **M0 — Bootstrap (Katerina):** repo layout, Rust workspace, Tauri shell, TS/Vite app, CI, ADR-001 architecture, ADR-002 IPC contract, ADR-003 data model.
- **M1 — Detection + discovery (Karl):** Steam/WH3 paths, pack header parser, mod index, fixtures.
- **M2 — Mod list + load order (Karl):** UI port, enable/disable, reorder, filters/tags, atomic `used_mods.txt`, profiles.
- **M3 — Conflicts + Workshop + launch (Karl):** conflict index, dependency warnings, Steam actions, launch options.
- **M4 — UI direction + polish (Katerina + Karl):** TW:WH3 visual system, density, keyboard map, empty/error states.
- **M5 — Hardening + release (Baltasar + Genny):** e2e/regression suite, perf budgets, Windows installer, release checklist.

## v1.0 acceptance criteria

- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` pass for the Rust workspace.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass for the frontend.
- Rust integration tests cover: path detection from fixture VDF/registry data, pack parsing (valid + malformed), load-order read/write + backup/restore, profile round-trip, conflict winner calculation, missing dependency warning.
- Frontend tests cover: mod list rendering/virtualization contract, enable/disable, reorder, filter/search, profile switch, error states.
- A documented manual QA script on Windows covers install detection, first run, 50+ mod list, reorder, profile switch, launch, and recovery from a corrupted `used_mods.txt`.
- Windows CI produces an installable artifact (NSIS/MSI) and the artifact is attached to a GitHub release.
- No cut feature appears in navigation, menus, or IPC surface.

## Decision log

- 2026-10-20 — Scope fixed to WH3-only v1.0; parity with legacy app explicitly rejected.
- 2026-10-20 — Tauri 2 chosen as the only architecture candidate (Rust backend + TS frontend, no Node main process).
- 2026-10-21 — Pack-author surface cut from v1.0: PFH5/ACF carry no author and custom Steam auth is forbidden (WAR-104; implemented in WAR-107).
- 2026-10-24 — Linux launch moved to direct Proton with a load-order guard; no automatic Steam fallback (ADR-009).
- 2026-10-24 — Windows launch moved to direct `Warhammer3.exe` to bypass the CA launcher, with pre-launch order verification and snapshot restore (ADR-010).
