# ADR-002 — IPC contract and error model

- Status: accepted
- Date: 2026-10-20
- Owner: Katerina Zarina
- Depends on: ADR-001

## Context

The frontend must never touch the filesystem or Steam, and every state mutation
must be a typed Rust operation. The legacy app used untyped Electron channels
(`ipcRenderer.invoke("someString", payload)`) with ad-hoc error shapes, which is
exactly the coupling this rebuild removes.

The desktop shell compiles the UI and the Rust binary into one Tauri package, so
both sides always ship together in production. Development mode can still run a
stale frontend against a new binary, so the contract needs a visible build
identity.

## Decision

### Command naming and arguments

- Command IDs are `snake_case` (`app_info`, `write_load_order`).
- Rust commands take `snake_case` parameters. Tauri's default argument mapping
  means the TypeScript caller passes `camelCase` keys (`modId`, `orderedModIds`).
- All request/response structs use `#[serde(rename_all = "camelCase")]`, so
  JSON fields are `camelCase` on both sides.
- Success resolves directly with the response value. There is no `{ ok, data }`
  envelope.
- Failure rejects with exactly one `AppError` object (below).
- Commands are registered explicitly in `crates/wh3mm-app/src/lib.rs` with
  `tauri::generate_handler!`. No dynamic command names.
- Frontend code imports only `frontend/src/lib/ipc.ts`; importing
  `@tauri-apps/api/core` elsewhere is a lint/review failure.

Tauri events are reserved for progress on long-running work (import, update,
launch). They never replace the command result: the promise still resolves or
rejects with the final value.

### Error envelope

`wh3mm_core::error::AppError` is the only error type crossing IPC:

```json
{
  "code": "game_not_found",
  "message": "Could not find a Total War: Warhammer III installation.",
  "details": "Checked 3 Steam libraries; no appmanifest_1142710.acf",
  "retryable": false
}
```

| Code | Meaning | Typical retryable |
|---|---|---|
| `io` | Filesystem read/write failure | yes when transient (lock, sharing violation) |
| `config_corrupt` | Persisted state cannot be parsed or validated | no |
| `game_not_found` | WH3 install not located | no |
| `steam_not_found` | Steam install/library data not readable | no |
| `pack_parse_failed` | `.pack` header/file is malformed | no |
| `not_found` | Requested mod/profile/tag does not exist | no |
| `validation` | Caller-supplied input is invalid | no |
| `internal` | Unexpected failure | no |

Rules:

- `message` is user-facing, short, and actionable; no stack traces or absolute
  paths in UI copy unless the path is the fix (manual override).
- `details` is diagnostic context for logs/error expansion; may contain paths.
  The key is always present and is `null` when absent.
- `retryable` is set by core only when retrying without user intervention is
  safe. The UI must not invent it.
- Panics never cross IPC. Command wrappers map unexpected errors to
  `internal`, log the original, and keep the message generic.
- There is no success/error union type. `Result<T, AppError>` in Rust becomes
  `Promise<T>` / `IpcError` in TypeScript.

The TypeScript mirror (`frontend/src/lib/ipc.ts`) normalizes malformed or
non-contract rejections to `IpcError` with code `internal` rather than trusting
them.

### M0 command (implemented)

```rust
#[cfg_attr(windows, tauri::command)]
pub fn app_info() -> AppInfo
```

```ts
export interface AppInfo {
  name: string        // "WH3 Mod Manager"
  version: string     // wh3mm-app version
  coreVersion: string // wh3mm-core version
  platform: string    // std::env::consts::OS
  arch: string        // std::env::consts::ARCH
}
```

`frontend/src/App.tsx` invokes it on mount and renders the result, proving the
round trip. This is also the stale-build check: the UI shows both versions.

`reset_to_defaults` requires `confirm: true`. It resets `UiPreferences` to
defaults, clears the manual game-path override, clears the active profile's
enabled set, and writes an empty `used_mods.txt` through the atomic writer when
a game path is available (`loadOrderWritten: true`). Profiles, tags, mod tags,
and launch options are kept. With no game path the config reset still succeeds
and `loadOrderWritten` is `false`.

### Implemented command surface (M1-M2)

Payloads are fixed here so UI work and core work can proceed in parallel.
Adding a command or changing a field is a contract change: update this ADR,
Rust, and `frontend/src/lib/ipc.ts` in one commit. ADR-005 records the M1/M2
payload extensions and the load-order safety rules.

| Milestone | Command | Request | Response |
|---|---|---|---|
| M1 | `detect_game` | none | `GameLocation` |
| M1 | `set_game_path` | `{ gamePath: string \| null }` | `GameLocation` |
| M1 | `list_mods` | none | `ModListSnapshot` |
| M2 | `set_mod_enabled` | `{ modId: string, enabled: boolean }` | `ModListSnapshot` |
| M2 | `set_mods_enabled` | `{ modIds: string[], enabled: boolean }` | `ModListSnapshot` |
| M2 | `set_load_order` | `{ orderedModIds: string[] }` | `ModListSnapshot` |
| M2 | `list_profiles` | none | `ProfilesState` |
| M2 | `save_profile` | `{ profileId?: string, name: string, enabledModIds: string[] }` | `Profile` |
| M2 | `duplicate_profile` | `{ profileId: string, name: string }` | `Profile` |
| M2 | `delete_profile` | `{ profileId: string }` | `ProfilesState` |
| M2 | `apply_profile` | `{ profileId: string }` | `ModListSnapshot` |
| M2 | `list_tags` | none | `Tag[]` |
| M2 | `create_tag` | `{ name: string, color: string }` | `Tag[]` |
| M2 | `delete_tag` | `{ tagId: string }` | `Tag[]` |
| M2 | `set_mod_tags` | `{ modId: string, tagIds: string[] }` | `ModListSnapshot` |
| M2 | `get_ui_preferences` | none | `UiPreferences` |
| M2 | `update_ui_preferences` | `{ preferences: UiPreferences }` | `UiPreferences` |
| M4 | `reset_to_defaults` | `{ confirm: boolean }` | `ResetDefaultsReport` |
| M2 | `read_load_order` | none | `LoadOrderReadReport` |
| M2 | `preview_load_order` | none | `LoadOrderWriteReport` |
| M2 | `write_load_order` | `{ allowEmpty: boolean, confirmUnmanagedLoss: boolean }` | `LoadOrderWriteReport` |
| M2 | `restore_load_order` | none | `LoadOrderReadReport` |
| M3 | `get_conflicts` | none | `ConflictReport` |
| M3 | `list_workshop_items` | none | `WorkshopItem[]` |
| M3 | `workshop_action` | `{ action: "open" \| "subscribe" \| "unsubscribe" \| "update", workshopId: string }` | `SteamActionResult` |
| M3 | `get_launch_options` | none | `LaunchOptions` |
| M3 | `set_launch_options` | `{ options: LaunchOptions }` | `LaunchOptions` |
| M3 | `launch_game` | `{ skipIntro: boolean, scriptLogging: boolean }` | `LaunchResult` |

```ts
type GameLocation = {
  gamePath: string
  dataPath: string
  workshopPath: string
  steamRoot: string       // empty for a manual install outside Steam
  protonPrefix: string | null
  source: 'auto' | 'manual'
}

type ModSummary = {
  id: string                 // opaque, core-assigned; never a UI-owned path
  name: string               // pack file name, e.g. "mymod.pack"
  humanName: string          // pack stem until M3 adds Workshop titles
  author: string | null
  isWorkshop: boolean
  workshopId: string | null
  isEnabled: boolean
  loadOrder: number          // 0-based, top of list = 0
  tags: string[]             // tag ids
  updatedAt: string | null   // ISO-8601 UTC
  thumbnailPath: string | null
  dependencies: string[]
  packError: string | null
  isMovie: boolean
  sizeBytes: number
}

type ModListSnapshot = {
  mods: ModSummary[]
  enabledCount: number
  activeProfileId: string
  loadOrder: LoadOrderReadReport
  timings: Timings
  warnings: string[]
}

type Tag = {
  id: string
  name: string
  color: string  // #RRGGBB
}

type Profile = {
  id: string
  name: string
  enabledModIds: string[]    // ordered, index = load order
  createdAt: string
  updatedAt: string
}

type LoadOrderWriteReport = {
  path: string
  backupPath: string | null
  written: number
  skipped: string[]          // names not resolvable to a discovered pack
  unmanagedDirectives: string[]
  wouldDropUnmanaged: boolean
  existingModCount: number
  resultingModCount: number
  canWrite: boolean
  blockedReason: string | null
  requiresEmptyConfirmation: boolean
  requiresUnmanagedConfirmation: boolean
  hardBlocked: boolean
}

type Timings = {
  startupMs: number
  detectionMs: number
  scanMs: number
  loadOrderMs: number
  totalMs: number
}

type UiPreferences = {
  density: 'comfortable' | 'compact'
  showAuthors: boolean
  showThumbnails: boolean
  lastScrollTop: number
}

type ResetDefaultsReport = {
  loadOrderWritten: boolean
}

type ProfilesState = {
  profiles: Profile[]
  activeProfileId: string
}

type LoadOrderReadReport = {
  path: string
  present: boolean
  corrupt: boolean
  message: string | null
  modNames: string[]
  resolvedModIds: string[]
  missingNames: string[]
  duplicates: string[]
  unmanagedDirectives: string[]
  backupAvailable: boolean
}

type ConflictReport = {
  conflicts: Array<{ path: string; winnerModId: string; loserModIds: string[] }>
  missingDependencies: Array<{ modId: string; missing: string[] }>
  duplicatePackNames: Array<{ name: string; modIds: string[] }>
  disabledDependencies: Array<{
    modId: string
    dependency: string
    providerModId: string
  }>
  shadowedBaseTables: Array<{ modId: string; path: string; basePack: string }>
  shadowedBaseTableCount: number
  modSummaries: Array<{
    modId: string
    name: string
    overrides: number
    overriddenOn: number
    baseTableOverrides: number
    fileCount: number
  }>
  warnings: string[]
}

type WorkshopItem = {
  workshopId: string
  title: string
  state: 'subscribed' | 'installed' | 'update_pending' | 'unknown'
  updatedAt: string | null
}

type SteamActionResult = {
  action: 'open' | 'subscribe' | 'unsubscribe' | 'update'
  workshopId: string
  opened: boolean
  message: string
}

type LaunchOptions = {
  skipIntro: boolean
  scriptLogging: boolean
}

type LaunchResult = {
  launched: boolean
  method: 'steam' | 'direct'
  message: string | null
}
```

Notes:

- `modId` is opaque. The UI may store it, compare it, and pass it back; it must
  not parse it or build filesystem paths from it.
- `gamePath`/`dataPath`/`workshopPath` are returned for display and for the
  manual-override form. They are not accepted on destructive commands; Rust
  re-resolves the game and mod locations from its own state.
- `set_load_order` receives the complete enabled-id order. Partial reorder
  payloads (`fromIndex`/`toIndex`) are rejected to avoid two sources of truth.
- All timestamps are ISO-8601 UTC strings; core owns formatting.

## Enforcement

- Rust: integration tests in `crates/wh3mm-core/tests/ipc_contract.rs` assert
  the serialized field names, error codes, and `details: null` behaviour.
- TypeScript: `frontend/src/lib/ipc.test.ts` asserts the wrapper forwards the
  command id, normalizes the error envelope, and rejects malformed payloads.
- Manual mirroring is deliberate at this size. If the surface grows beyond ~15
  commands or drift becomes a recurring review cost, switch to generated types
  (e.g. `ts-rs`) in a superseding ADR.

## Consequences

- Frontend errors are structured and can be rendered without string matching.
- Every new feature must add its command to this table first, which keeps the
  UI and core in step.
- The UI can display backend build identity, which makes dev-mode mismatches
  diagnosable.
