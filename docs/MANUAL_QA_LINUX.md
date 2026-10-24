# Manual Linux QA script — v1.1

Owner: the Linux desktop workstream (WAR-139). Executed on a Linux x86_64
desktop with a **native** Steam client and Total War: Warhammer III running
through Proton. This script
covers what the Linux CI gate cannot: the real Steam/Proton paths, the desktop
window, and a launch on a real user profile. Automation evidence still comes
from `docs/QA_PLAN.md` §1.

Record raw evidence per step: screenshot, exact file contents before/after, and
the error text if a step fails. "Looks fine" is not evidence.

## Preconditions

- Linux x86_64 with X11 or Wayland and the WebKitGTK 4.1 runtime installed.
- Native Steam (`steam.sh`/`steam`), not Flatpak or Snap; Flatpak/Snap launch is
  out of scope for this build.
- WH3 app id `1142710` installed in a Steam library, ideally **not** the Steam
  root library (proves multi-library detection).
- Proton prefix present at `steamapps/compatdata/1142710/pfx`.
- At least one installed Proton under `steamapps/common/Proton*` and a
  `SteamLinuxRuntime*/_v2-entry-point` under `steamapps/common/`.
- At least one Workshop mod subscribed and one local `.pack` in `<game>/data/`.
- Back up the real `used_mods.txt`, `config.json`, and `config.json.bak` before
  starting. Stop if no backup was taken.

Environment block to fill in:

| Field | Value |
| --- | --- |
| App version / commit | |
| CI run URL / artifact | |
| Desktop session | X11 or Wayland |
| Steam root / library paths | |
| Proton prefix | |
| GPU / driver | |
| Tester / date | |

## Steps

### LIN-01 — Build and first start

1. From a clean checkout:

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   cargo build -p wh3mm-app --release --locked
   ./target/release/wh3mm
   ```

2. Confirm the window opens and the mod list loads without a terminal-only
   path. Expected: the window title is "WH3 Mod Manager"; no crash; the config
   is created under `${XDG_CONFIG_HOME:-$HOME/.config}/com.warhammerlabs.wh3mm/`.

### LIN-02 — Game detection

1. Open **Settings** and record the Data, Workshop, Steam, Proton prefix, and
   Source rows.
2. Confirm the paths match `appmanifest_1142710.acf` and the selected Steam
   library, not merely the Steam root.
3. Confirm the Workshop path exists and the Proton prefix points at
   `steamapps/compatdata/1142710/pfx`.

Expected: no "game not found" state; the Proton prefix row is present. If
detection misses the library, use the manual path and record the path.

### LIN-03 — Mod list and load order

1. Enable and disable a local pack; confirm the count and row state change.
2. Move an enabled mod up/down; confirm the order survives a restart.
3. Open **Apply load order** and inspect the preview before writing.
4. Write the order. Expected: `used_mods.txt` changes atomically and
   `used_mods.txt.bak` contains the previous content.
5. Toggle **Restore backup** and confirm the previous content returns.

Do not continue if the preview reports unmanaged directives; record the exact
warning and stop.

### LIN-04 — Profiles and tags

1. Create a profile, enable a different set, and apply it.
2. Restart and confirm the active profile and enabled order persist.
3. Create a tag, assign it to a mod, filter by it, then delete the tag.

Expected: profile switches restore the exact enabled order; deleting the tag
removes it from the mod without touching `used_mods.txt`.

### LIN-05 — Conflicts

1. Enable at least two packs that contain the same file path, or use the M3
   fixture packs from `docs/M3_MANUAL_QA.md`.
2. Open **Conflicts** and record the winner and overridden rows.
3. Disable the winner and refresh.

Expected: the winner moves to the next pack without a restart; missing and
disabled dependencies are reported separately.

### LIN-06 — Workshop

1. Open **Workshop** and compare the rows with
   `steamapps/workshop/appworkshop_3247630.acf` (fallback
   `appworkshop_1142710.acf`).
2. Click **Open page** for one item. Expected: Steam opens the item page; the
   app reports that it opened Steam, not that a subscription changed.
3. Change a subscription in Steam, close and reopen the manager, and refresh.
4. Rename the ACF file and refresh. Expected: a `steam_not_found` error lists
   the checked paths; the app does not show an empty list as success.

### LIN-07 — Launch through direct Proton

1. Record the configured compatibility tool from
   `config/config.vdf` (`CompatToolMapping` → `1142710` → `name`), the
   installed `Proton*` directory, and the `SteamLinuxRuntime*` entry point.
2. Close Total War: Warhammer III. Confirm no `Warhammer3.exe` process is
   running (the app checks `/proc`).
3. Write a distinctive load order and record the SHA-256 of `used_mods.txt`.
4. Open **Launch game**, enable **Skip intro** and **Script logging**, and
   launch.
5. While the game starts, record the process command line:

   ```bash
   ps -eo pid,args | grep -E 'Warhammer3.exe|_v2-entry-point|/proton'
   ```

   Expected: the runtime entry point, `--verb=waitforexitandrun`, `--`, the
   selected Proton `proton` script, `waitforexitandrun`, `Warhammer3.exe`, and
   the literal `used_mods.txt;` argument. Steam must not be the parent launcher.
6. Expected: `data/wh3mm_skip_intro.pack` and
   `data/script/enable_console_logging` exist while the options are enabled.
   The game reaches the main menu and loads the selected mods, not just an
   unchanged file.
7. Compare the SHA-256 of `used_mods.txt` while the game is running and after it
   exits. Expected: unchanged from step 3.
8. Turn both options off and launch again. Expected: the managed pack and the
   owned script-logging marker are removed; a user-owned logging marker is not
   deleted.
9. While the game runs, try launching from the manager again. Expected: a
   validation error says the game is already running, and no files change.
10. Test the load-order guard: start another launch and, during the three-second
    guard window, rewrite `used_mods.txt` from another terminal. Expected: the
    manager stops the spawned process and shows `load_order_overridden`.
11. Test the no-fallback behavior: temporarily move the selected
    `SteamLinuxRuntime*` directory aside (back it up first), launch, and restore
    it. Expected: `proton_runtime_missing`; Steam must not start as a fallback.
12. Repeat with `compatdata/1142710` moved aside. Expected:
    `compat_data_missing`; no prefix is created.

### LIN-08 — Recovery

1. Corrupt `used_mods.txt` (backup first) and restart.
2. Expected: the app reports the corrupt file, refuses to overwrite it, and
   offers the backup restore path.
3. Restore the backup and confirm the mod list matches the pre-corruption
   state.

## Sign-off

- [ ] LIN-01 through LIN-08 pass on native Steam + Proton.
- [ ] No write occurred outside the expected `used_mods.txt`/config paths.
- [ ] The CI `wh3mm-linux-x64` artifact matches the tested commit.
- [ ] Tester/date recorded in the environment block.
