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

### LIN-07 — Launch and preset hand-off

The manager launches the game through Proton directly on Linux. This is the
fix for the Creative Assembly launcher replacing `used_mods.txt` (issue #44);
Steam remains the fallback when the Proton toolchain cannot be resolved.

1. Close Total War: Warhammer III. Confirm no `Warhammer3.exe` process is
   running (the app checks `/proc`).
2. Apply a profile whose enabled set differs from the launcher's own active
   list. Record the exact file and the launcher log timestamp:

   ```bash
   game_dir="<game folder>"
   proton_prefix="<game library>/steamapps/compatdata/1142710/pfx"
   sha256sum "$game_dir/used_mods.txt"
   launcher_log=$(find "$proton_prefix" -name launcher.log -print -quit)
   stat -c '%Y %n' "$launcher_log"
   ```

3. Open **Launch game**, enable **Skip intro** and **Script logging**, and
   launch. Expected: the result names the **direct** method and says the game
   receives `used_mods.txt`; the launcher must not run.
4. While the game runs, collect the open Workshop packs and compare them with
   the file. Replace `<workshop content>` with the Workshop path from
   **Settings**:

   ```bash
   pid=$(pgrep -f 'Warhammer3.exe' | head -1)
   tr '\0' '\n' < "/proc/$pid/cmdline"
   ls -l "/proc/$pid/fd" | grep '\.pack' | sed 's/.* -> //' | sort -u > /tmp/open-packs.txt
   find "<workshop content>" -name '*.pack' -printf '%f\n' | sort -u > /tmp/available-workshop.txt
   grep 'steamapps/workshop/content/1142710' /tmp/open-packs.txt | sed 's#.*/##' | sort -u > /tmp/open-workshop-packs.txt
   grep -v '^#' "$game_dir/used_mods.txt" | sed '/^$/d' | sort -u > /tmp/expected.txt
   comm -12 /tmp/expected.txt /tmp/available-workshop.txt > /tmp/expected-workshop.txt
   diff -u /tmp/expected-workshop.txt /tmp/open-workshop-packs.txt
   ```

   Expected: the `diff` is empty; the command line contains
   `used_mods.txt;`. A non-empty diff is a failure even if the game reaches
   the main menu. Local `.pack` mods under `<game>/data` also appear in
   `/tmp/open-packs.txt`; compare the non-Workshop entries of
   `used_mods.txt` with those when the preset uses local mods.
5. Confirm the launcher never started: the `launcher.log` timestamp from step 2
   is unchanged (or the log is still absent), and
   `pgrep -af 'The Creative Assembly|Launcher.exe'` shows no CA launcher
   process.
6. Confirm the managed option files:
   `data/wh3mm_skip_intro.pack` and `data/script/enable_console_logging` exist
   while the options are enabled. Turn both off and launch again; the managed
   pack and the owned marker are removed, while a user-owned marker is not
   deleted.
7. While the game runs, try launching from the manager again. Expected: a
   validation error says the game is already running, and no files change.
8. If the result says the **steam** method, it is the fallback. Record the full
   message: it names the reason and warns that the preset may not reach the
   game. Fix the reported toolchain problem and repeat from step 2; do not sign
   off a fallback launch as a preset hand-off.

Windows launch behaviour is unchanged: `steam -applaunch 1142710`.

### LIN-08 — Recovery

1. Corrupt `used_mods.txt` (backup first) and restart.
2. Expected: the app reports the corrupt file, refuses to overwrite it, and
   offers the backup restore path.
3. Restore the backup and confirm the mod list matches the pre-corruption
   state.

## Sign-off

- [ ] LIN-01 through LIN-08 pass on native Steam + Proton.
- [ ] LIN-07 shows an empty pack diff, an unchanged launcher log, and the direct method.
- [ ] No write occurred outside the expected `used_mods.txt`/config paths.
- [ ] The CI `wh3mm-linux-x64` artifact matches the tested commit.
- [ ] Tester/date recorded in the environment block.
