# ADR-005 — M1/M2 implementation decisions

- Status: proposed
- Date: 2026-10-21
- Owner: Karl Franz
- Depends on: ADR-001, ADR-002, ADR-003, ADR-004

## Context

M1 and M2 add Steam/WH3 detection, PFH5 parsing, the mod index, the mod-list
UI, `used_mods.txt` persistence, profiles, tags, and the first performance
instrumentation. ADR-002 fixed the command names but left several payload and
behaviour questions open. This ADR records the decisions needed to implement
M1/M2 without contradicting the product contract.

## PFH5 metadata reality

WH3 `.pack` files use the PFH5 container. The 28-byte header carries the magic,
byte mask, dependency-index size, file count, packed-file-index size, and two
reserved words. **It does not carry a title or creator metadata.** The title
comes from Steam Workshop metadata (M3) or from the pack file name; v1.0 does
not model an author (WAR-104).

Therefore:

- `PackHeader` reports `format`, `version`, `header_len`, `byte_mask`,
  `pack_type` (`movie` when the legacy `byteMask == 4` rule matches, otherwise
  `data`), the pack name, the file timestamp, and the dependency pack names.
- `ModSummary.humanName` is the pack file stem until M3 adds Workshop titles.
- `ModSummary.updatedAt` is the pack file mtime in ISO-8601 UTC.
- Pack parsing is bounded: sizes are checked against the real file length and
  sane caps before any allocation. Malformed packs become a per-mod
  `packError`, not a failed scan.

## Ordering model

A profile stores only the ordered enabled set (`enabledModIds`), as ADR-003
requires. The UI shows:

1. enabled mods first, in load order (top = first loaded);
2. disabled mods after them, sorted by pack name.

Consequences:

- Enabling a mod appends it to the enabled order (highest priority) until the
  user moves it.
- Drag, move-to-top/bottom, and keyboard reorder operate on enabled rows.
- `set_load_order` receives the complete enabled order, never a display-only
  order. Disabled rows keep no persisted position.
- Unknown IDs left in a profile (for example a temporarily missing Workshop
  item) are preserved in the profile and reported as `skipped` on write instead
  of being silently deleted.

## Session ownership

`wh3mm-core::session::Session` owns the loaded config, detected game location,
scanned mods, working enabled order, and cached read/write reports. The Tauri
layer only resolves the config directory, holds the session behind one mutex,
and maps methods to commands. This keeps the whole M2 flow testable headlessly
on Linux with a temporary config dir and a synthetic game directory.

## Contract extensions (ADR-002)

The following additions are required by M1/M2:

| Command | Request | Response |
|---|---|---|
| `set_mods_enabled` | `{ modIds: string[], enabled: boolean }` | `ModListSnapshot` |
| `duplicate_profile` | `{ profileId: string, name: string }` | `Profile` |
| `delete_profile` | `{ profileId: string }` | `ProfilesState` |
| `read_load_order` | none | `LoadOrderReadReport` |
| `preview_load_order` | none | `LoadOrderWriteReport` |
| `restore_load_order` | none | `LoadOrderReadReport` |
| `list_tags` | none | `Tag[]` |
| `create_tag` | `{ name: string, color: string }` | `Tag[]` |
| `delete_tag` | `{ tagId: string }` | `Tag[]` |
| `set_mod_tags` | `{ modId: string, tagIds: string[] }` | `ModListSnapshot` |
| `get_ui_preferences` | none | `UiPreferences` |
| `update_ui_preferences` | `UiPreferences` fields | `UiPreferences` |

Changed payloads:

- `GameLocation` gains `protonPrefix: string | null` and `steamRoot` may be an
  empty string for a manual install outside Steam.
- `ModSummary` gains `thumbnailPath`, `dependencies`, `packError`, `isMovie`,
  and `sizeBytes`.
- `ModListSnapshot` gains `activeProfileId`, `loadOrder`
  (`LoadOrderReadReport`), and `timings`.
- `set_mod_enabled`, `set_load_order`, `apply_profile`, and `set_mod_tags`
  return `ModListSnapshot` so the UI has one authoritative order.
- `ProfilesState` is `{ profiles, activeProfileId }`; `Profile` is unchanged.
- `set_game_path` accepts `{ gamePath: string | null }`; `null` clears the
  manual override and returns to auto-detection.
- `LoadOrderWriteReport` gains `unmanagedDirectives`, `wouldDropUnmanaged`,
  `existingModCount`, `resultingModCount`, `canWrite`, and `blockedReason`.
- `LoadOrderReadReport` is `{ path, present, corrupt, message, unreadable,
  modNames, resolvedModIds, missingNames, duplicates, unmanagedDirectives,
  backupAvailable }`. `unreadable` carries a read failure (permissions,
  sharing violation); startup stays alive and all writes are hard-blocked
  until the file can be read.
- `Timings` is `{ startupMs, detectionMs, scanMs, loadOrderMs, totalMs }`.

`write_load_order` takes `{ allowEmpty, confirmUnmanagedLoss }` exactly as
WAR-20 specifies. `preview_load_order` performs the same read/resolve/plan work
and writes nothing.

## Write safety

`used_mods.txt` writes are planned before they touch disk:

- only enabled, resolvable packs are written, as `mod "<name>";`, LF-joined,
  with **no trailing newline** (matching the legacy writer);
- unmanaged directives are never re-emitted; dropping them requires
  `confirmUnmanagedLoss`;
- an empty result over a file that currently has mods requires `allowEmpty`;
- a non-empty enabled set with zero resolvable packs is refused;
- a corrupt current file is refused until the user restores `.bak`;
- the current file is copied to `used_mods.txt.bak` first, then the new content
  is written to a same-directory temp file, flushed, fsynced, and renamed over
  the target. On failure the temp file is removed and the original remains.

## First run and config

- Missing `config.json`: create schema v1 with a `Default` profile. If
  `used_mods.txt` exists, import its resolvable, deduplicated names into that
  profile in file order.
- Existing config: the active profile is the working enabled set. IDs missing
  from the current scan stay in the profile but are not shown as enabled.
- Corrupt config: use `config.json.bak` if valid; otherwise load defaults with
  writes blocked and surface `config_corrupt`. Core never overwrites a file it
  could not read.
- Every mutation clones the config, validates, writes atomically, and commits
  the clone only after the write succeeded.

## Profiling hooks

`Session` measures detection, pack scan, load-order read, and total startup, and
emits one `wh3mm: timing ...` line to stderr. The same values are returned in
`ModListSnapshot.timings` so WAR-7 can benchmark the real hot path without
parsing logs.

## Consequences

- M2 shipping order and profile state have one owner (core), so the UI cannot
  produce a second order.
- PFH5 packs without Workshop metadata show the pack stem; M3 upgrades the
  display name when Workshop metadata is available.
- The extra `read/preview/restore` load-order commands make corruption recovery
  explicit and testable; they are not a cut feature.
