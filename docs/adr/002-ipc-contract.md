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
- Request objects in the table are flat on the wire: `{ a, b }` means the
  command receives two named arguments, not a nested `request` object. The
  command wrapper assembles the typed request struct in core.
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

### Planned command surface (M1-M3)

Payloads are fixed here so UI work and core work can proceed in parallel.
Adding a command or changing a field is a contract change: update this ADR,
Rust, and `frontend/src/lib/ipc.ts` in one commit.

| Milestone | Command | Request | Response |
|---|---|---|---|
| M1 | `detect_game` | none | `GameLocation` |
| M1 | `set_game_path` | `{ gamePath: string }` | `GameLocation` |
| M1 | `list_mods` | none | `ModSummary[]` |
| M2 | `set_mod_enabled` | `{ modId: string, enabled: boolean }` | `ModSummary` |
| M2 | `set_load_order` | `{ orderedModIds: string[] }` | `ModListSnapshot` |
| M2 | `preview_load_order` | none | `LoadOrderWriteReport` |
| M2 | `write_load_order` | `{ allowEmpty: boolean, confirmUnmanagedLoss: boolean }` | `LoadOrderWriteReport` |
| M2 | `restore_load_order_backup` | none | `LoadOrderWriteReport` |
| M2 | `list_tags` | none | `Tag[]` |
| M2 | `create_tag` | `{ name: string, color: string }` | `Tag` |
| M2 | `update_tag` | `{ tagId: string, name: string, color: string }` | `Tag` |
| M2 | `delete_tag` | `{ tagId: string }` | `Tag[]` |
| M2 | `list_profiles` | none | `Profile[]` |
| M2 | `save_profile` | `{ profileId?: string, name: string, enabledModIds: string[] }` | `Profile` |
| M2 | `apply_profile` | `{ profileId: string }` | `ModListSnapshot` |
| M2 | `rename_profile` | `{ profileId: string, name: string }` | `Profile` |
| M2 | `duplicate_profile` | `{ profileId: string, name: string }` | `Profile` |
| M2 | `delete_profile` | `{ profileId: string }` | `Profile[]` |
| M2 | `get_settings` | none | `Settings` |
| M2 | `update_settings` | `UpdateSettingsRequest` | `Settings` |
| M3 | `get_conflicts` | none | `ConflictReport` |
| M3 | `list_workshop_items` | none | `WorkshopItem[]` |
| M3 | `subscribe_workshop_item` | `{ workshopId: string }` | `WorkshopItem` |
| M3 | `unsubscribe_workshop_item` | `{ workshopId: string }` | `WorkshopItem` |
| M3 | `open_workshop_item` | `{ workshopId: string }` | none |
| M3 | `launch_game` | `{ skipIntro: boolean, scriptLogging: boolean }` | `LaunchResult` |

The table is exhaustive for the planned M1-M3 surface. A command that is not
listed here has no contract yet; add it to this table before implementing it.

```ts
type GameLocation = {
  gamePath: string
  dataPath: string
  workshopPath: string
  steamRoot: string
  source: 'auto' | 'manual'
}

type ModSummary = {
  id: string                 // opaque, core-assigned; never a UI-owned path
  name: string               // pack file name, e.g. "mymod.pack"
  humanName: string          // display name from the pack header
  author: string | null
  isWorkshop: boolean
  workshopId: string | null
  isEnabled: boolean
  loadOrder: number          // 0-based, top of list = 0
  tags: string[]             // tag ids
  updatedAt: string | null   // ISO-8601 UTC
}

type ModListSnapshot = { mods: ModSummary[]; enabledCount: number }

type Profile = {
  id: string
  name: string
  enabledModIds: string[]    // ordered, index = load order
  createdAt: string
  updatedAt: string
}

type LoadOrderWriteRequest = {
  allowEmpty: boolean         // explicit "disable all / write empty" permission
  confirmUnmanagedLoss: boolean // explicit permission to drop unmanaged directives
}

type LoadOrderWriteReport = {
  path: string
  backupPath: string | null  // backup associated with this operation: the .bak
                             // created by a write, the .bak a preview would use, or
                             // the .bak restored by restore_load_order_backup;
                             // null when no backup applies
  written: number            // mod lines written (preview: would be written)
  skipped: string[]          // names not resolvable to a discovered pack
  unmanagedDirectives: string[] // raw directives the write would drop (preview: would drop)
}

type Tag = {
  id: string
  name: string
  color: string              // #RRGGBB
}

type Settings = {
  density: 'comfortable' | 'compact'
  showAuthors: boolean
  showThumbnails: boolean
  lastScrollTop: number
}

type UpdateSettingsRequest = {
  density?: 'comfortable' | 'compact'
  showAuthors?: boolean
  showThumbnails?: boolean
  lastScrollTop?: number     // at least one field must be present; {} is validation
}

type ConflictReport = {
  conflicts: Array<{ path: string; winnerModId: string; loserModIds: string[] }>
  missingDependencies: Array<{ modId: string; missing: string[] }>
  duplicatePackNames: Array<{ name: string; modIds: string[] }>
}

type WorkshopItem = {
  workshopId: string
  title: string
  state: 'subscribed' | 'installed' | 'update_pending' | 'unknown'
  updatedAt: string | null
}

type LaunchResult = {
  launched: boolean
  method: 'steam' | 'direct'
  message: string | null
}
```

### Load-order write: preview, refusals, and confirmation

`used_mods.txt` is game-owned and may contain directives this app does not
manage. A write replaces the whole file, so planning and writing are separate
commands:

1. `preview_load_order` runs the full read/resolve/plan path and writes nothing.
   It returns the same report shape as the write, including every unmanaged
   directive that a write would drop and every enabled name that would be
   skipped.
2. The UI shows the report before offering the write: the skipped names and the
   unmanaged directives are warnings, not hidden details. If the write would
   empty an existing non-empty list, the UI asks a second, explicit question
   ("write empty").
3. `write_load_order` repeats the read/resolve/plan path; it never trusts a
   stale preview. It refuses with `validation`, writing nothing and creating no
   backup, when either destructive change is not confirmed:
   - `confirmUnmanagedLoss` is `false` and the report's
     `unmanagedDirectives` is non-empty (the writer only re-emits managed
     `mod "…";` lines).
   - `allowEmpty` is `false`, the existing file has at least one managed mod
     line, and the planned write has none.
   The refusal message is user-facing; `details` names the directives or the
   line count.
4. ADR-003 adds a non-overridable detection-failure refusal: when the enabled
   set is non-empty but no enabled pack resolves to a discovered file, the
   write is `validation` even with `allowEmpty: true`. The user must fix
   discovery or disable the mods explicitly; a broken scan must not wipe a
   working list.
5. Only a write that passes these checks may create the `.bak` and replace the
   file.

The request carries two booleans with no defaults, so the caller always states
its intent. The report carries `written`, `skipped`, `unmanagedDirectives`, and
`backupPath` for both preview and write so the UI renders one result type.

Notes:

- `modId` is opaque. The UI may store it, compare it, and pass it back; it must
  not parse it or build filesystem paths from it.
- `gamePath`/`dataPath`/`workshopPath` are returned for display and for the
  manual-override form. They are not accepted on destructive commands; Rust
  re-resolves the game and mod locations from its own state.
- `set_load_order` receives the complete enabled-id order. Partial reorder
  payloads (`fromIndex`/`toIndex`) are rejected to avoid two sources of truth.
- `delete_tag` removes the tag from every `modTags` entry in the same
  transaction and returns the remaining tags. Unknown `tagId` is `not_found`.
- `delete_profile` returns the remaining profiles. Deleting the active profile
  activates the next one; deleting the last profile is `validation` (ADR-003).
- `duplicate_profile` requires a new, unique `name`; the copy is inactive until
  `apply_profile` selects it.
- `restore_load_order_backup` is a recovery command, not a general overwrite. It
  succeeds only when the live `used_mods.txt` is missing or unreadable and the
  `.bak` passes the same read step. If a readable live file exists it refuses
  with `validation` and the UI uses preview/write instead.
- `subscribe_workshop_item` and `unsubscribe_workshop_item` return the refreshed
  item. Steam may report a just-unsubscribed item as `installed` until the next
  workshop scan; the UI treats that as the post-action state.
- `open_workshop_item` opens the Steam Workshop page and resolves with no
  payload. Failure to hand off the URL is an `io` or `internal` error, not a
  boolean result.
- `get_settings`/`update_settings` cover the persisted `ui` block from
  ADR-003 (density, author/thumbnail columns, scroll). Game-path overrides go
  through `detect_game`/`set_game_path` and are not part of this patch.
- `update_settings` is a patch: at least one field must be present, and an
  empty patch is `validation`.
- All timestamps are ISO-8601 UTC strings; core owns formatting.

### Content Security Policy (M0 exception)

`crates/wh3mm-app/tauri.conf.json` sets `app.security.csp` to `null` in M0. The
M0 window renders only bundled local assets and the `app_info` round trip; it
loads no remote content, thumbnails, or pack-provided HTML. Keeping the policy
empty avoids claiming a CSP that has not been threat-modelled for the dev server
and the Windows WebView2 runtime.

This exception ends before the first feature that renders external content
(Workshop thumbnails or pack previews) or follows user-supplied links. M1/M2
must set a restrictive policy covering at least
`default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
`img-src 'self' asset: http://asset.localhost data:` (plus the specific remote
image origins that are accepted), and `connect-src ipc: http://ipc.localhost`
(plus the Vite dev origin in development). The exact policy is part of the
M1/M2 design review; `csp: null` must not survive that feature.

The Tauri config is strict JSON and cannot carry comments, so this section is
the note of record for the `csp: null` setting in `tauri.conf.json`.

## Enforcement

- Rust: integration tests in `crates/wh3mm-core/tests/ipc_contract.rs` assert
  the serialized field names, error codes, `details: null` behaviour, and both
  destructive-load-order refusals.
- TypeScript: `frontend/src/lib/ipc.test.ts` asserts the wrapper forwards the
  command id, normalizes the error envelope, and rejects malformed payloads.
- Manual mirroring stays deliberate for M0/M1, where only `app_info` and the
  write contract exist. The planned M1-M3 surface is now larger than the
  earlier ~15-command trigger, so before M2 adds the bulk of the commands the
  tech lead must either accept the manual mirror at the new size or schedule a
  generated-type migration (e.g. `ts-rs`) in a superseding ADR. This is an M2
  design decision, not a silent deferral.

## Consequences

- Frontend errors are structured and can be rendered without string matching.
- Load-order writes are previewable and explicitly confirmed, so dropping
  unmanaged directives or emptying the list cannot happen by accident.
- Every new feature must add its command to this table first, which keeps the
  UI and core in step.
- The UI can display backend build identity, which makes dev-mode mismatches
  diagnosable.
