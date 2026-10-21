# ADR-006 — M3 conflict, Workshop, and launch decisions

- Status: accepted
- Approved: Katerina Zarina, 2026-10-21
- Date: 2026-10-21
- Owner: Karl Franz
- Depends on: ADR-002, ADR-003, ADR-005

## Context

M3 adds three surfaces that read or act outside the app: pack file indexes,
Steam Workshop metadata, and the Steam client. This ADR records the choices
that keep those surfaces honest, testable on Linux, and compatible with the
M1/M2 data model.

## Conflict report

- Only **enabled** packs are compared. Disabled packs are available as
  dependency providers but cannot win or lose a file conflict.
- The enabled order is the profile order: the first enabled mod is loaded first
  and the **last enabled mod wins** every path it shares with an earlier pack.
  This matches `used_mods.txt` and the M2 UI.
- Only the PFH5 packed-file index is read. Bodies are never loaded. The index
  parser honours the WH3 compression flag and the `0x40` filename-hash bit, and
  it refuses indexes larger than 256 MiB, more than 2,000,000 entries, or an
  index that extends past the real file length.
- Entry paths are compared case-insensitively after normalizing `\` to `/`.
  Display paths use `/`.
- `modSummaries` counts:
  - `overrides`: conflicting paths this mod wins;
  - `overriddenOn`: conflicting paths this mod loses;
  - `baseTableOverrides`: `db/` paths that also exist in a vanilla pack.
- Missing dependencies are checked against the current scan and the vanilla
  pack names from `data/manifest.txt`. A dependency that resolves to a disabled
  mod is reported separately as a disabled dependency; it is not "missing".
- Duplicate pack names come from the M1 scanner, including the dropped copies,
  so the report can name every path involved instead of only the kept copy.
- Base-game table shadowing is computed from the vanilla pack indexes listed in
  `data/manifest.txt` (falling back to the three known base packs). The report
  returns a bounded sample of 200 rows plus the full count. If no vanilla index
  can be read, the report says so in `warnings` rather than claiming there are
  no shadows.
- A pack that fails to index is skipped with a warning; one malformed pack does
  not hide the rest of the report.

## Workshop

- Metadata is read from Steam's `steamapps/workshop/appworkshop_3247630.acf` as
  specified by the M3 contract, falling back to `appworkshop_1142710.acf`.
  The file is parsed with the existing Valve KeyValues parser in `paths.rs`; no
  new parser and no Steam authentication.
- State mapping:
  - `installed`: present in `WorkshopItemsInstalled` and no newer manifest;
  - `update_pending`: installed manifest differs from the manifest in
    `WorkshopItemDetails`;
  - `subscribed`: present only in `WorkshopItemDetails`;
  - `unknown`: no ACF entry, or a locally installed Workshop pack the ACF does
    not mention.
- Titles come from the ACF when present; otherwise the local pack stem is used.
  Timestamps are converted from Steam Unix seconds to ISO-8601 UTC.
- Open, Subscribe, Unsubscribe, and Update all open
  `steam://url/CommunityFilePage/<id>` through the Steam executable
  (`steam.sh`/`steam` on Linux, `steam.exe` on Windows, then `PATH`). The Steam
  browser protocol has no documented subscribe/unsubscribe endpoint, and this
  app does not use a custom Steamworks integration. The result is therefore
  `opened: true`, not "subscribed": the user finishes the action in Steam and
  the UI re-reads ACF state. The UI must not present any of these actions as
  confirmed subscription changes; an update action follows the same rule.
- A missing Steam executable or ACF is a `steam_not_found` error with the paths
  that were checked. There is no claim that a subscription changed before the
  next metadata read confirms it.

## Process ownership

- Steam process spawning for launch and Workshop actions lives in
  `wh3mm-core` (`launch.rs`, `workshop.rs`) behind `Session`, so the behaviour is
  testable headlessly. `wh3mm-app` remains the Tauri command shell. This
  corrects the module map in ADR-001.

## Launch

- Launch command: `<steam> -applaunch 1142710`. The command never runs the game
  executable directly on Windows or Linux; Steam owns the app lifecycle.
- A running `Warhammer3.exe` (case-insensitive process/cmdline match) blocks
  another launch with a `validation` error.
- Options are persisted per profile in `config.json` under
  `launchOptions.<profileId>`. This is an additive schema-v1 field with a
  default, so existing config files load unchanged.
- Option effects:
  - **Script logging**: create `data/script/enable_console_logging`. A sidecar
    `.wh3mm_enable_console_logging` records ownership; turning the option off
    removes the marker only when the sidecar exists, so a user-owned marker is
    never deleted.
  - **Skip intro movies**: write `data/wh3mm_skip_intro.pack`, a PFH5 pack that
    replaces the six WH3 intro movies with a one-frame CA video. Turning the
    option off removes that pack. The pack is excluded from the mod scan so it
    cannot appear as a user mod.
  - The blank video bytes are the MIT-licensed fixture from the legacy
    WH3 Mod Manager (`src/helperPackData.ts`), used only to keep the override
    valid; the rest of the start-game feature set is not ported.
- `launch_game` saves the options before applying tweaks so the choice survives
  a failed launch attempt. The result says the launch was **requested**; it does
  not claim the game reached the main menu.

## Consequences

- Conflict analysis is deterministic and cheap enough to recompute on demand;
  it never trusts a stale file cache.
- Workshop state is only as fresh as the ACF on disk; the UI always offers a
  refresh and never fakes an action result.
- Launch options are one more field in the existing config document. No second
  state file is introduced.
- The skip-intro pack is a data-folder override; whether a game build loads all
  data packs or only `used_mods.txt` entries is verified by the M3 manual QA
  script on Windows, not assumed by the core.
