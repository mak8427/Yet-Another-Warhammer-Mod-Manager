# ADR-003 — Persisted data model

- Status: accepted
- Date: 2026-10-20
- Owner: Katerina Zarina
- Depends on: ADR-001, ADR-002
- Amended by: ADR-005 (`ui.density` also accepts `roomy`)

## Context

Two kinds of state exist and they have different owners:

1. `used_mods.txt` is **game-owned compatibility state**. WH3 reads it at launch;
   other tools and the user may edit it. It must round-trip without corruption.
2. App state (paths, profiles, tags, UI preferences) is **owned by this app** and
   has no legacy on-disk contract except that users may already have a legacy
   config. That legacy config is not imported in v1.0.

All persistence is implemented in `wh3mm-core` and exposed through IPC. The
frontend never opens a file.

## Storage locations

| State | Location | Owner |
|---|---|---|
| Load order | `<WH3 game dir>/used_mods.txt` | Game-compatible file written atomically by core |
| App config | Tauri `app_config_dir()/config.json` | Core schema, app resolves the directory |
| Config backup | `config.json.bak` next to config | Core, one generation |
| Load-order backup | `used_mods.txt.bak` next to game file | Core, one generation |

Resolved locations on supported platforms:

- Windows: `%APPDATA%\com.warhammerlabs.wh3mm\config.json`
  (`app_config_dir` uses the bundle identifier `com.warhammerlabs.wh3mm`).
- Linux: `~/.config/com.warhammerlabs.wh3mm/config.json` (XDG config dir).

There is no database, no per-profile file, and no registry state. Profiles, tags,
and settings live in one validated JSON document so a profile switch cannot leave
a half-written set of files.

## `used_mods.txt` compatibility

### Format observed in the legacy app

The legacy writer (`src/ipcMainListeners.ts`, "writing used_mods.txt") produced:

```
mod "some_mod.pack";
mod "another_mod.pack";
```

- UTF-8 without BOM, LF line endings.
- One `mod "<pack file name>";` statement per enabled mod, in the UI's
  top-to-bottom order.
- WH3 loads the list **bottom-up**: the last line has the highest priority and
  wins file conflicts. The UI therefore shows the same order as the file: top =
  loaded first, bottom = wins.
- Disabled mods are omitted. There is no header, no count, and no escaping.
- Pack names cannot contain `"` or newlines; such names are rejected before
  writing.

### v1.0 rules

Read:

- Tolerate a UTF-8 BOM, CRLF, blank lines, and arbitrary whitespace.
- Parse case-insensitively: `mod "name";` with optional whitespace before `mod`,
  between tokens, and before `;`.
- Deduplicate names case-insensitively (Windows semantics), keeping the first
  occurrence and reporting duplicates as a warning. This matches legacy
  `parseUsedMods`.
- Preserve the order of first occurrence. Unknown lines (for example
  `add_working_directory "…";`) are parsed as unmanaged directives: they are
  not interpreted, but they are counted and included in the pre-write report and
  in the `.bak`.
- Resolve names against the discovered mod index using case-insensitive pack
  file names. Names that do not resolve are reported, not guessed.

Write:

- The file contains only managed `mod "<name>";` lines, matching legacy
  behaviour. Unmanaged directives are **not** re-emitted; if any were present,
  the command must have returned them in the pre-write report so the UI warned
  the user before the destructive change.
- Only enabled, resolvable packs are written. `written` and `skipped` are
  returned in `LoadOrderWriteReport` (ADR-002).
- Refuse to write when the enabled set is non-empty but zero packs resolve, and
  refuse when the resulting file would be empty while the existing file has mod
  lines, unless the caller explicitly requested "write empty" (disable-all).
  This prevents a detection failure from wiping a working setup.
- Atomic replace:
  1. Serialize to `used_mods.txt.tmp-<pid>` in the same directory.
  2. Flush and `fsync` the temp file.
  3. Copy the current `used_mods.txt` to `used_mods.txt.bak` (if it exists and
     passed the read step).
  4. `rename(temp, used_mods.txt)`; same-directory rename is atomic on NTFS and
     POSIX filesystems, and Rust's `fs::rename` replaces an existing file on
     Windows.
  5. On Unix, `fsync` the parent directory.
- On any failure the original file is untouched. The temp file is removed.
- Crash recovery is explicit: if `used_mods.txt` is missing and `.bak` exists,
  the UI offers restore; core never silently restores.

Encoding note: legacy used UTF-16LE only for Shogun 2, which is out of scope.
WH3 writes UTF-8.

## `config.json` schema v1

```json
{
  "schemaVersion": 1,
  "paths": {
    "gamePathOverride": null
  },
  "ui": {
    "density": "comfortable",
    "showAuthors": true,
    "showThumbnails": true,
    "lastScrollTop": 0
  },
  "activeProfileId": "b0f4e7f0-3a55-4b8e-9d4a-8a2f6f4b1c21",
  "profiles": [
    {
      "id": "b0f4e7f0-3a55-4b8e-9d4a-8a2f6f4b1c21",
      "name": "Default",
      "enabledModIds": [
        "c:/steam/steamapps/workshop/content/1142710/123456789/mod_a.pack",
        "c:/steam/steamapps/common/warhammer3/data/mod_b.pack"
      ],
      "createdAt": "2026-10-20T14:00:00Z",
      "updatedAt": "2026-10-20T14:00:00Z"
    }
  ],
  "tags": [
    { "id": "0d1f8e2a-4c7b-4f0e-8a3d-2b6c9e5f7a11", "name": "Overhaul", "color": "#c9a227" }
  ],
  "modTags": {
    "c:/steam/steamapps/workshop/content/1142710/123456789/mod_a.pack": [
      "0d1f8e2a-4c7b-4f0e-8a3d-2b6c9e5f7a11"
    ]
  }
}
```

Field rules:

- `schemaVersion` is required and must be exactly `1` for this version. A higher
  number is not loaded and is never overwritten (`config_corrupt`).
- `paths.gamePathOverride` is `null` for auto-detection, otherwise an absolute
  directory chosen by the user. Core validates that it contains the WH3
  executable before persisting it.
- `ui.density` is `"comfortable"` or `"compact"`. Unknown values fall back to
  `"comfortable"` and are reported.
- `ui.lastScrollTop` is a non-negative number of CSS pixels, clamped on load.
- Profile `enabledModIds` is ordered top-to-bottom and doubles as the enabled
  set: an ID present is enabled, and its index is its load order. There is no
  separate `loadOrder` field, so the two cannot disagree.
- Profile and tag IDs are UUID v4 strings. Profile names are unique
  case-insensitively and trimmed; an empty name is `validation`.
- Tag names are unique case-insensitively. `color` is `#RRGGBB`.
- `modTags` keys are opaque mod IDs (see below). Tag IDs referenced from
  `modTags` must exist in `tags`; unknown references are dropped with a warning
  on load.
- `activeProfileId` must reference an existing profile. If it does not, the first
  profile becomes active; if there are no profiles, a `Default` profile is
  created.
- Timestamps are ISO-8601 UTC (`2026-10-20T14:00:00Z`), generated by core.

### Mod identity

`ModId` is an opaque string assigned by core from the canonical pack path:

- Absolute path, `/` separators, no `..`, no trailing slash.
- Case-folded on Windows (all-lowercase drive letter and path) for stable
  identity; case preserved on Linux.
- The UI treats it as a token: it never parses it, normalizes it, or builds a
  path from it.
- Moving or renaming a pack file produces a new ID; its tags do not follow. This
  is accepted for v1.0 and avoids relying on mutable pack names for identity.
- Duplicate pack **names** are possible across directories. The conflict report
  warns about them; IDs stay distinct.

## Lifecycle

### First run

1. Core detects WH3 and the game data directory.
2. If `config.json` does not exist, core creates the schema with a `Default`
   profile.
3. If `used_mods.txt` exists, its resolvable entries are imported into the
   `Default` profile in file order. Unresolvable names are reported, not stored.
4. The config is written atomically. The legacy app config is not read or
   migrated; the legacy install is left untouched.

### Saving

- Every mutation is a typed command with an explicit intent (save profile, set
  order, toggle mod, update settings). There is no untyped "save whole state"
  call, which removes the legacy race between renderer snapshots.
- Writes are serialized by a single mutex in `wh3mm-app` state.
- Atomic replace: `config.json.tmp-<pid>` → `fsync` → copy previous valid file to
  `config.json.bak` → rename temp to `config.json`.
- If `config.json` is corrupt at startup:
  1. Try `config.json.bak`.
  2. If the backup is valid, load it and surface a recoverable warning.
  3. If both are corrupt, start with defaults **without overwriting either
     file**, and surface `config_corrupt` so the user can back up the files.
- Unknown fields are preserved on read/write? No: serde drops unknown fields on
  save. The schema is versioned; a future version is refused rather than
  silently down-converted.

### Profiles

- Create, rename, duplicate, delete as separate commands in M2.
- Deleting the active profile activates the next profile; deleting the last
  profile is refused (`validation`).
- Applying a profile sets the enabled set/order and writes `used_mods.txt` only
  through the explicit `write_load_order` command (the UI shows the pre-write
  report and requires confirmation for destructive changes).
- Saving a profile with zero enabled mods is allowed (the user explicitly asked
  for it); no silent background save can produce an empty profile.

## Consequences

- One validated config document keeps cross-entity invariants local and testable.
- Two backups exist, one per file; recovery is explicit rather than magical.
- Tag identity is tied to pack location in v1.0. If users need tags that survive
  moves, a later schema version can add a content hash; that requires a new ADR
  and migration.
- Legacy config migration is intentionally out of scope. Only the
  game-compatible `used_mods.txt` is imported.

## M2 implementation notes

- The writer emits `mod "<name>";` lines joined by LF with **no trailing
  newline**, matching the legacy writer for the same input. Reading tolerates a
  BOM, CRLF, blank lines, and surrounding whitespace.
- `.bak` is always the complete previous file, written through its own atomic
  replace before the target rename. A corrupt current file is never overwritten
  by a normal write; `restore_load_order` copies a valid `.bak` back atomically
  and leaves the backup in place.
- A write that would drop unmanaged directives, or would empty a file that
  currently has mod lines, is refused until the matching confirmation flag is
  supplied. A non-empty enabled set that resolves to zero packs is always
  refused.
- Toggling a mod or changing the enabled order updates the **active profile**
  immediately, so the working state survives a restart without a separate
  "save" action. Creating/renaming/duplicating/deleting profiles remains an
  explicit command.
- Changing the game path migrates profile entries by pack file name so a
  case-only or library-path change does not silently lose the enabled set.
- Config recovery repairs `config.json` from a valid `.bak` on startup. If both
  files are corrupt, the in-memory defaults are used and every write is refused
  with `config_corrupt`; neither file is touched.
