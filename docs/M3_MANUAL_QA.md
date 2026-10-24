# M3 manual QA — conflicts, Workshop, launch

Owner: Karl Franz. Scope: WAR-9. Windows is the primary target; run the same
checks on Linux only where Steam/Proton detection is available.

## 1. Three overlapping fixture mods

1. Close Total War: Warhammer III and the manager.
2. Generate the fixture packs:

   ```bash
   python3 docs/fixtures/make_m3_conflicts.py /tmp/m3-fixtures
   ```

3. Copy `m3_fixture_a.pack`, `m3_fixture_b.pack`, and `m3_fixture_c.pack` into
   `<WH3 game>/data`.
4. Start the manager, open **Load order**, and enable the three fixtures in the
   order A, B, C (top to bottom).
5. Open **Conflicts**.

Expected:

- **File conflicts** shows `db/units_tables/m3_conflict_fixture` and
  `script/m3_conflict_fixture.lua`.
- The winner for both paths is **`m3_fixture_c.pack`**.
- The other two rows are listed as overridden.
- The A and B rows show an `L` badge; C shows a `W` badge.
- Per-mod summary: C has `overrides = 2`, A and B have `overriddenOn = 2`.
- Remove or disable C, refresh, and confirm the winner moves to B without
  restarting the app.

## 2. Missing and disabled dependencies

1. Keep A and B enabled; disable C.
2. Use a pack that declares a dependency on `m3_fixture_c.pack` (or use the
   M1 fixture generator used in the Rust tests).
3. Refresh **Conflicts**.

Expected: the dependency is reported as **disabled**, not missing. Remove the
pack that provides it and refresh again; the same dependency becomes
**missing**.

## 3. Workshop

1. Subscribe to at least one WH3 Workshop item in Steam, then close Steam.
2. Start the manager and open **Workshop**.
3. Confirm the item title, state, and updated date match
   `steamapps/workshop/appworkshop_3247630.acf` (the manager falls back to
   `appworkshop_1142710.acf`).
4. Click **Open**; Steam opens the item page.
5. Click **Subscribe**, **Unsubscribe**, or **Update**. The manager must say
   that it opened Steam, not that the action succeeded.
6. Change the subscription in Steam, close the manager, reopen it, and refresh.
   The state must reflect the ACF file.
7. Rename or move the ACF file and refresh: the screen must show a
   `steam_not_found` error with the checked paths, not an empty list.
8. Return to **Load order**: each Workshop mod row shows the same state as the
   Workshop screen (`INST`, `SUB`, or `UPD`), alongside the `WS` badge.

## 4. Launch

1. Open **Launch**, enable **Skip intro movies** and **Enable script logging**.
2. Confirm `data/wh3mm_skip_intro.pack` and
   `data/script/enable_console_logging` exist.
3. Click **Launch game**. On Windows the manager must start `Warhammer3.exe`
   directly with the literal `used_mods.txt;` argument and no CA launcher; on
   Linux the runtime must start it through Proton with no Steam fallback.
4. Start WH3 manually and click **Launch game** while it is running. The
   manager must refuse with a "already running" validation error.
5. Disable both options and launch again. The managed pack and the manager-owned
   script-logging marker must be removed; a user-created
   `enable_console_logging` file must not be removed.
6. Restart the manager and confirm the per-profile options are still selected.

## Evidence to record on WAR-9

- The three fixture packs and their SHA-256 hashes.
- A screenshot or text dump of the conflict report showing C as the winner.
- The ACF path and the Workshop state shown before/after a subscription change.
- The launch command (Steam app id `1142710`) and any error message for the
  already-running case.
- `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked --
  -D warnings`, `cargo test --workspace --locked`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, and `pnpm build` output.
