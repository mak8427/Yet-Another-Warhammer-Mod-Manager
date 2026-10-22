# ADR-001 — Architecture, repository layout, and legacy UI port

- Status: accepted
- Date: 2026-10-20
- Owner: Katerina Zarina
- Supersedes: none
- Amended by: ADR-006 (design tokens live in `frontend/src/styles/tokens.css`);
  ADR-007 (Linux desktop shell)
- Product contract: `docs/PRODUCT_SCOPE.md`

## Context

The v1.0 product is a Windows-first Total War: Warhammer III mod manager. The
legacy application is Electron with a React renderer and a very large
main-process file (`src/ipcMainListeners.ts`, ~14k lines) that mixes Steam
discovery, pack parsing, load-order writes, and game launching. The product
scope fixes the stack to Rust + TypeScript and cuts the legacy viewers and
editors.

M0 establishes the repository shape and the boundaries that later milestones
must not erode.

## Decision

### Repository layout

```
Cargo.toml                     workspace root (resolver 2)
rust-toolchain.toml            stable + rustfmt + clippy
crates/wh3mm-core/             pure domain logic, no Tauri/WebView deps
crates/wh3mm-app/              Tauri 2 command layer + `wh3mm` binary
frontend/                      React + TypeScript + Vite UI (pnpm workspace)
docs/adr/                      architecture decisions
.github/workflows/ci.yml       Linux quality gates + Linux shell build + manual Windows shell build
```

`pnpm-workspace.yaml` contains only `frontend`. The root `package.json` is a
private task runner (`pnpm dev|build|typecheck|lint|test`); it ships no code.

### Crate boundaries

`wh3mm-core` is platform- and UI-free. It owns:

| Module (introduced by) | Responsibility |
|---|---|
| `error` (M0) | `AppError` / `ErrorCode` wire contract |
| `ipc` (M0) | Serialized payload structs shared with the Tauri layer |
| `paths` (M1) | Steam library discovery, WH3 detection, manual overrides |
| `pack` (M1) | Pack header parsing, mod index, malformed-pack handling |
| `load_order` (M2) | `used_mods.txt` parse/serialize, ordering, atomic write |
| `profiles` (M2) | Profile creation, restore, first-run default |
| `settings` (M2) | Config schema, validation, migrations, atomic persistence |
| `conflicts` (M3) | Pack file indexes, winner calculation, dependency warnings |
| `workshop` (M3) | Subscription metadata; Steam actions are requested through the app layer |
| `launch` (M3) | Launch plan construction and preconditions |

`wh3mm-app` owns only:

- Tauri command registration and argument validation (`commands.rs` in M0;
  split into `commands/` by domain as M1-M3 land).
- Resolving OS/app paths (Tauri path APIs) and passing them to core.
- Process spawning for Steam/game launch.
- Mapping core errors to `AppError` and serializing responses.

No filesystem, Steam, registry, or pack logic may live in `frontend/`. The UI
receives opaque `modId`s and talks only through `frontend/src/lib/ipc.ts`.

### Selected versions (resolved in `Cargo.lock` / `pnpm-lock.yaml`)

| Component | Version |
|---|---|
| Rust toolchain | stable, `rust-version = 1.90` (Tauri 2.12 MSRV) |
| Tauri | 2.12.4 |
| tauri-build | 2.7.3 |
| serde / serde_json | 1.0.229 / 1.0.154 |
| thiserror | 2.0.21 |
| React / React DOM | 19.3.1 |
| TypeScript | 6.0.3 |
| Vite | 8.3.4 |
| Vitest | 5.0.5 |
| ESLint | 10.13.0 |
| @tauri-apps/api | 2.12.4 |
| Node (CI) | 24.x |
| pnpm | 12.14.0 |

### Tauri shell gating (Linux CI without WebKitGTK)

`crates/wh3mm-app/Cargo.toml` declares `tauri` and `tauri-build` under
`[target.'cfg(windows)'.dependencies]` / `build-dependencies`. `lib.rs` uses
`#[cfg(windows)]` for the builder and `commands::app_info` uses
`#[cfg_attr(windows, tauri::command)]`. Consequences:

- Linux `cargo test`, `cargo clippy`, and `cargo build` compile the app crate as
  a stub and never link WebKitGTK.
- Command implementations stay platform-neutral and are unit-tested on Linux.
- The Tauri shell is compiled by the manual Windows CI job, which runs
  `pnpm build` before `cargo build -p wh3mm-app` because `generate_context!`
  embeds `frontend/dist` at compile time.
- Cross-compiling the Windows shell from Linux is out of scope for M0.

#### Amendment 2026-10-22 (ADR-007)

Linux is now a supported desktop target for native Steam and Proton. The Tauri
dependency and command cfg is `any(windows, target_os = "linux")`; macOS keeps
the unsupported fallback. Linux CI installs WebKitGTK 4.1/GTK3, builds the
frontend before the workspace cargo gates because `generate_context!` embeds
`frontend/dist`, and produces the `wh3mm-linux-x64` tarball artifact with a
checksum.
`wh3mm-core` remains WebView-free; `cargo test -p wh3mm-core` stays usable
without a desktop stack.

### Frontend state and navigation

- One store: a small typed external store built on `useSyncExternalStore`
  (introduced with the mod list in M2). No Redux, no Context-per-feature stores.
- No router: the shell is a single window with section state in the store.
- No component library. UI primitives are local; the TW:WH3-inspired visual
  tokens live in `frontend/src/styles/theme.css`.
- M0 keeps only one live screen (`Load order`). Planned sections are rendered as
  disabled rail labels so no cut feature is implied.

## Legacy UI port map

The legacy tree is reference material only; it is **not** copied into this
repository. Porting means rewriting against the new IPC client and visual
system, with behaviour verified by new tests.

### Reused (ported and modernised in M2/M3)

| Legacy source | New home | Notes |
|---|---|---|
| `src/components/ModListPane.tsx`, `ModRows.tsx`, `ModRow.tsx`, `ModListHeader.tsx`, `ModListCategoryHeader.tsx` | `frontend/src/components/mod-list/` | Keep the dense row model; replace Flowbite/FontAwesome, wire virtualization and keyboard selection. |
| `src/components/Categories.tsx`, `ModTagPicker.tsx` | `frontend/src/components/tags/` | Tags are persisted by core; filter state lives in the store. |
| `src/components/RequiredMods.tsx` | `frontend/src/components/mod-details/` | Missing-dependency warnings come from the core conflict report. |
| `src/components/CompatScreen.tsx`, `CompatConflictCard.tsx`, `CompatCollapsibleSection.tsx` | `frontend/src/components/conflicts/` | Layout reused; winner data comes from `get_conflicts`. |
| `src/components/PresetsTab.tsx` | `frontend/src/components/profiles/` | Renamed to profiles; all persistence moves to core. |
| `src/components/UsedModsLoadOrderModal.tsx` | `frontend/src/components/load-order/` | Becomes backup/restore UI backed by the load-order commands. |
| `src/components/GamePathsSetup.tsx`, `OptionsDrawer.tsx` | `frontend/src/components/settings/` | Path override and display options only; cut toggles are dropped. |
| `src/components/TopBar.tsx`, `LeftSidebar.tsx`, `Drawer.tsx`, `Toasts.tsx`, `RenameModal.tsx` | `frontend/src/components/shell/` | Rewritten with local CSS/inline SVG icons and the new visual tokens. |
| `src/usedMods.ts` (parse/import behaviour) | `crates/wh3mm-core/src/load_order` | Reimplemented in Rust; parser compatibility covered by fixtures. |
| `src/modSortingHelpers.ts` (name/pinned ordering concepts) | `crates/wh3mm-core/src/load_order` | Only ordering needed by the v1.0 mod list; rule engine is cut. |

### Dropped (not ported, no new route or IPC command)

| Legacy area | Reason |
|---|---|
| `src/viewer/`, `src/unitViewer/`, `src/components/skillsViewer/`, `src/components/techTrees/`, `src/components/buildings/`, `src/components/ancillaries/` | Product scope cut. |
| `src/esfMap/`, `src/nodeGraph/`, `src/nativePatches/`, `src/compressionAnalysis/`, `src/visuals/` | Product scope cut. |
| `src/globalSearch/`, `src/components/PackSearcher.tsx` | Pack search is not in v1.0 scope. |
| `src/components/loadOrderRules/`, `src/loadOrderRules.ts`, `src/mainLoadOrderRules.ts` | Rule engine is not in the In-scope table; automatic name order plus manual pins only. |
| `src/components/ModsMerger.tsx`, `src/components/ShareMods.tsx`, `src/components/ImportSteamCollection.tsx`, `src/components/CreateSteamCollection.tsx` | Merging and collection import/export are cut. |
| `src/components/Onboarding.tsx`, `src/components/UpdateNotification.tsx` | Joyride onboarding and auto-update infrastructure are cut. |
| `src/components/SaveGames.tsx`, `src/campaigns.ts`, `src/gameSaves.ts` | Save-game and campaign tooling is cut. |
| `src/flowbite/`, `tailwind.config.js`, Flowbite theme/components | Explicitly excluded stack. |
| `src/appSlice.ts`, `src/store.ts`, Redux Toolkit wiring | Replaced by the single `useSyncExternalStore` store. |
| `src/ipcMainListeners.ts`, `src/preload.ts`, `src/renderer*.ts`, `src/sub.ts`, `steamworks/` | Electron main/preload/worker code; replaced by Tauri commands and Rust crates. |
| `src/vanillaDbCache/`, `src/vanillaLocCache/`, `src/vanillaPackIndex/`, `src/helperPackData.ts`, database/table code | Viewers and data editors are cut. |
| `locales/`, localisation context | English-only UI in v1.0. |
| FontAwesome / `react-icons` (dependencies) | Replaced with inline SVG + CSS in the new visual system. |

### How legacy IPC calls are replaced

The legacy renderer called `window.electron.*` / `ipcRenderer.invoke(...)` and
received main-process events. The replacement is:

1. Every operation becomes a typed Tauri command declared in
   `crates/wh3mm-app/src/commands.rs` (or `commands/` once split) and registered
   in `invoke_handler`.
2. Request/response payloads are `serde` structs in `wh3mm-core::ipc` with
   camelCase fields; the TypeScript mirror lives in `frontend/src/lib/ipc.ts`.
3. Renderer code calls `ipc.<method>()`; it never imports `@tauri-apps/api`
   directly. Errors are normalized to `IpcError` at that boundary.
4. Long-running operations may emit Tauri events for progress, but the result
   still resolves through the command promise.
5. Destructive operations accept only opaque IDs or validated user choices;
   Rust re-resolves every path.

## Consequences

- Domain code stays testable headlessly; the desktop shell is a thin,
  replaceable layer on Windows and Linux.
- M1-M3 must add modules/commands according to this map; a new top-level
  directory or a UI-owned filesystem call requires a new ADR.
- The Linux clippy gate type-checks the Linux Tauri shell. Windows-specific
  paths remain covered by the manual Windows workflow and M5 packaging CI.
- The legacy UI is ported incrementally, not lifted wholesale; visual review is
  required at M4.
