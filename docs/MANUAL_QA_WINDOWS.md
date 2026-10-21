# Manual Windows QA script — v1.0

Owner: Baltasar Gelt (QA). Executed on a real Windows 10/11 x64 machine with
Steam and Total War: Warhammer III installed. This script covers only what CI
cannot: the Windows shell, Steam detection, the game launch, and recovery on a
real user profile. Automation evidence still comes from the gate in
`docs/QA_PLAN.md` §1.

Record raw evidence per step: screenshot or screen recording, the exact file
contents before/after, and the error text if a step fails. "Looks fine" is not
evidence.

## Preconditions

- Windows 10 22H2+ or Windows 11, x64, 8 GB RAM minimum.
- Steam installed; WH3 app id `1142710` installed in a library that is **not**
  the Steam root library (proves multi-library detection).
- At least one Workshop mod subscribed and one local `.pack` in
  `<game>/data/`.
- The release artefact under test: version, SHA-256, and CI run URL.
- Backups: copy the real `used_mods.txt`, `config.json`, and `config.json.bak`
  to a safe folder before starting. Stop if no backup was taken.

Environment block to fill in:

| Field | Value |
| --- | --- |
| App version / commit | |
| Artefact SHA-256 | |
| CI run URL | |
| Windows build | |
| Steam root / library paths | |
| GPU / driver | |
| Tester / date | |

## Steps

### WIN-01 — Clean install and first start

1. Uninstall any previous build; remove `%APPDATA%\com.warhammerlabs.wh3mm\`.
2. Install the artefact. The v1.0 installer is unsigned, so expect the documented
   SmartScreen "Unknown publisher" warning (`docs/RELEASE.md`, step 11): verify
   the SHA-256 against the release notes, then choose **More info → Run anyway**.
   Any other AV block is a defect.
3. Start the app.

Expected: the window opens, the mod list loads, no console window, no crash.
Record cold-start time if the build shows instrumentation.

### WIN-02 — Game detection across libraries

1. Confirm the app shows the WH3 install and the correct `data/` and Workshop
   paths.
2. Confirm it did **not** pick the Steam root when WH3 is in the second library.

Expected: paths match `appmanifest_1142710.acf`; no "game not found" state.

### WIN-03 — Missing-game state

1. Close the app. Temporarily rename the WH3 `appmanifest_1142710.acf`
   (backup first) or unplug the second library.
2. Start the app.

Expected: a clear "game not found / set path" state, no crash, no data write.
The Settings path override is reachable.

3. Restore the manifest and use **Settings → game path** to point at the install.

Expected: detection recovers without restarting; the override persists after
restart.

### WIN-04 — 50+ mod list

1. Ensure 50+ packs are discoverable. Either subscribe to enough Workshop mods
   or copy the generated `qa_scale_*.pack` files from
   `node scripts/qa/generate-fixtures.mjs --scale <dir> --count 60` into
   `<game>/data/` (back up first).
2. Reload the list.

Expected: all packs appear once; disabled state is clear; unicode names render;
the list scrolls smoothly at 500 rows without the UI freezing. Duplicate names
are flagged, not merged.

### WIN-05 — Enable / disable

1. Disable one mod, enable another; check the count badge.
2. Restart the app.

Expected: the state persists. `used_mods.txt` is unchanged until an explicit
write/apply (no background writes).

### WIN-06 — Reorder (mouse and keyboard)

1. Drag a mod to the top, then send it to the bottom; repeat with the keyboard.
2. Apply the load order and confirm the pre-write report.
3. Inspect `used_mods.txt`.

Expected: the file order matches the UI top-to-bottom order; every previous
line that should be kept is present; `.bak` contains the previous version.

### WIN-07 — Atomic write and `.bak`

1. Note the current `used_mods.txt` bytes and hash.
2. Make a change and apply it.
3. Confirm `used_mods.txt.bak` equals the previous file, and no
   `used_mods.txt.tmp-*` remains.

Expected: hash of `.bak` equals the old hash; no temp file; timestamps sane.

### WIN-08 — Corrupt `used_mods.txt` recovery

1. With the app closed, back up `used_mods.txt`.
2. Replace it with `fixtures/load_order/used_mods_corrupt.txt`.
3. Start the app.

Expected: a structured warning, no crash, no automatic overwrite. The last good
`.bak` is offered for restore, and restoring it brings back the previous order.

4. Also test an empty file and a CRLF file; both must load without data loss.

### WIN-09 — Profile switch

1. Create "Profile A" with 3 mods in a known order; create "Profile B" with a
   different set.
2. Switch A → B → A.
3. Restart and switch again.

Expected: enabled set and order are restored exactly; the active profile
persists; deleting the last profile is refused with a message.

### WIN-10 — Conflict winner and missing dependency

1. Enable two packs that both contain the same file path.
2. Open the conflict view.

Expected: the winner is the pack lower in the load order (last line wins), and
the losing pack is listed. A pack that declares an absent dependency shows a
warning; the app does not crash.

### WIN-11 — Launch handoff

1. Close WH3 if running; try **Launch**.
2. Repeat while WH3 is already running.

Expected: the game starts through Steam with the chosen options; the
already-running case reports a clear message instead of starting a second
instance. No `used_mods.txt` rewrite unless the user applied a change.

### WIN-12 — Cut-feature audit

1. Walk every menu, rail item, context menu, and Settings tab.
2. Search the UI for pack editor, 3D/unit viewer, map renderer, DB clone, code
   editor, non-WH3 games, account/telemetry/auto-update.

Expected: none are reachable. Any sighting is an S2 defect with a screenshot.

### WIN-13 — Uninstall / reinstall

1. Uninstall; confirm user config and `used_mods.txt` are not deleted without
   consent.
2. Reinstall; confirm the app starts with the previous state intact.

## Result

| Step | Pass/Fail | Evidence path | Notes |
| --- | --- | --- | --- |
| WIN-01 | | | |
| WIN-02 | | | |
| … | | | |

Sign-off: tester, date, artefact SHA-256. Any S1/S2 failure blocks the release;
file it with `docs/BUG_REPORT_TEMPLATE.md` and link the issue.
