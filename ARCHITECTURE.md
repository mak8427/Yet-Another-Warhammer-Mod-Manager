# Architecture

WH3 Mod Manager manages Total War: Warhammer III packs, profiles, load order,
conflicts, and Steam Workshop metadata. It is a Rust/Tauri desktop app with a
React/TypeScript interface. Supported desktop targets are Windows x86_64 and
Linux x86_64. Native Steam and Proton are required for Linux game launching.

## Repository and boundaries

| Location | Responsibility |
|---|---|
| `crates/wh3mm-core` | Game discovery, pack parsing/indexing, config, load order, conflicts, Workshop metadata, and launch orchestration |
| `crates/wh3mm-app` | Tauri window, command registration, blocking-work dispatch, application paths, and window geometry/zoom |
| `crates/wh3mm-perf` | Standalone performance measurement of the core session pipeline |
| `frontend/src` | Screens, state, interaction, virtualization, accessibility, and presentation |
| `frontend/src/lib/ipc.ts` | Frontend's typed interface to registered Tauri commands |
| `packaging` | Native packages, Flatpak, Nix/Gentoo binary recipes, signed repository staging |
| `scripts/dev`, `scripts/qa`, `scripts/perf` | Developer helpers, deterministic checks, and performance tooling |
| `fixtures`, `docs/perf`, `docs/screenshots` | Synthetic test data and measurement/screenshot evidence |

The frontend never reads game files directly. Commands in `wh3mm-app` validate
requests and call the core. Blocking filesystem and pack work runs off the async
command thread. The core has no Tauri/WebView dependency and is testable without
a desktop. Do not move game rules into React components or add UI dependencies
to the core.

## Data flow

```text
React screen -> typed IPC facade -> Tauri command -> Manager / core Session
                                                   |
                            Steam libraries, packs, config, used_mods.txt
                                                   |
React store <- typed response or AppError <---------+
```

A session coordinates the detected game, indexed mods, active profile, tags,
preferences, and load-order state. Components receive their screen state through
the application/store layer. Keep mutation and refresh behavior centralized so
profile changes, selection, and displayed counts remain consistent.

Errors cross IPC as `AppError`: stable code, user-facing message, optional details,
and retryable flag. Missing games and unreadable/corrupt files are recoverable
states; avoid panics and silent success. Rust wire types in `ipc.rs` and TypeScript
types in `ipc.ts` must change together. Their contract tests protect the boundary.

## Discovery, indexing, and conflicts

Steam roots come from Windows registry/default locations and Linux native,
Flatpak/Snap, and XDG candidates. Parse `libraryfolders.vdf` and app manifests to
find libraries. Manual game-folder selection recovers failed discovery. Detecting
a Flatpak/Snap Steam directory does not imply that launching that Steam client
is supported.

The index reads local data packs and Workshop item folders, deduplicates packs,
and discovers local thumbnail images. Malformed packs remain diagnosable without
hiding unrelated mods. Pack parsing uses bounded PFH5 header/index checks rather
than reading arbitrary file bodies. Conflict reports cover overlapping pack
entries, missing/disabled dependencies, duplicate pack names, and base-game table
shadows. They are not a full database editor or a proof that a mod combination
is playable.

Workshop subscriptions/install state come from Steam metadata. Workshop actions
open the Steam client; the app does not authenticate as the user or claim a
subscription succeeded before Steam records it.

## Persistence and load-order safety

Config stores profiles, launch options, tags, UI preferences, and optional window
geometry. Writes are atomic and keep the existing backup/recovery contract.
Future config schemas are refused without overwriting them. Corrupt primary and
backup files require explicit recovery; do not replace them with empty defaults.

`used_mods.txt` preserves ordering and managed working-directory directives.
Unknown directives and unexpectedly empty output require explicit intent. Absolute
Linux paths must be written in the Windows-visible `Z:/...` form for Proton;
Windows paths and relative paths retain their semantics. A backup is kept before
replacement. Never modify `.pack` archives as part of ordinary load-order work.

## Launch boundary

Windows verifies the selected order, requires Steam to be running, and launches
`Warhammer3.exe` directly with the mod-list argument and game directory as cwd.
Linux resolves the existing compatibility prefix, configured Proton, and Steam
Linux Runtime, then launches through that runtime. It does not create prefixes or
fall back to Steam's CA-launcher path.

The manager rejects a running game and verifies the load order before launch. A
bounded three-second guard watches for replacement, stops the process it started,
and restores the snapshot on mismatch. It cannot guarantee termination of every
spawned descendant or detect rewrites after its window. Errors must preserve this
limitation rather than claiming the game loaded successfully.

The manager's Flatpak uses `flatpak-spawn --host` for game/Steam commands and host
process detection. Forward arguments, cwd, and resolved launch variables without
shell interpolation. Keep host library paths; do not inject GNOME runtime paths
into Proton. Broad filesystem/host-spawn permissions are deliberate and documented
in [installation](docs/INSTALLATION.md).

## UI and desktop behavior

The current skin uses dark grey surfaces, blue controls, and material tokens in
`frontend/src/styles/tokens.css`. Component styles use semantic tokens; density
and virtualization geometry remain independent of the palette. Prefer existing
components, keyboard behavior, focus rules, and error surfaces over new parallel
patterns. Thumbnails come from the backend's local paths through the asset bridge.

Window geometry is persisted with monitor-aware recovery. Zoom is a WebView scale
from 80–200%, independent of row density. Wayland may own window placement; failures
must remain nonfatal. Windows accelerator behavior and real game launching require
manual desktop checks in addition to unit tests.

## Distribution

The frontend is embedded at Rust compile time. Always build it before workspace
Cargo commands. Release outputs include Windows NSIS and Linux Debian, RPM,
AppImage, tarball, Arch, Flatpak, and hash-pinned Nix/Gentoo recipes. Native binaries
use the Ubuntu 24.04/glibc 2.39 baseline. Flatpak uses GNOME 50.

A separate publisher consumes a public release, verifies its checksum index, signs
apt/RPM/pacman/Flatpak repositories with a persistent key, and stages Pages hosting.
No production key is committed and no unsigned-repository fallback is allowed.
Code implementation, CI validation, public release publication, and repository
activation are separate states; document them accurately.

Detailed setup: [development](docs/DEVELOPMENT.md), [testing](docs/TESTING.md),
[performance](docs/PERFORMANCE.md), [installation](docs/INSTALLATION.md).
