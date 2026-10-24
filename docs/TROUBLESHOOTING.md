# Troubleshooting by error code

Every rejection from the Rust core carries an `AppError` with a stable
machine-readable `code`, a short user-facing `message`, optional diagnostic
`details`, and a `retryable` flag.

Start with the code, then read `details`: it names the paths and probes the
core used. The same codes are mirrored in `frontend/src/lib/ipc.ts`.

## Launch codes

| Code | Meaning | Likely cause | What to check |
|---|---|---|---|
| `proton_not_configured` | Steam is not configured to run WH3 through Proton, and `Warhammer3.exe` was not found. | The compatibility tool is not set, or the game path points at the wrong folder. | In Steam, open WH3 properties → Compatibility and select a Proton version. Confirm `<game>/Warhammer3.exe` exists. |
| `compat_data_missing` | The Proton compatibility data directory is absent. | WH3 has never been started through Proton, or the prefix lives in another library. | Check `<library>/steamapps/compatdata/1142710`. Start the game once through Steam/Proton to create it. The manager deliberately does not create a prefix. |
| `proton_not_installed` | No usable `steamapps/common/Proton*/proton` installation was found. | Proton is not installed, or it is installed in a library the manager cannot read. | Check every Steam library for `steamapps/common/Proton*`. Install a Proton version from Steam. Custom tools under `compatibilitytools.d` are not scanned. |
| `proton_runtime_missing` | No `SteamLinuxRuntime*/_v2-entry-point` was found. | The Steam Linux Runtime is not installed, or the runtime directory is incomplete. | Check `steamapps/common/SteamLinuxRuntime*`. Install/repair the Steam Linux Runtime from Steam. |
| `launch_failed` | The resolved Steam, Proton, or direct game process could not be spawned. | The executable is missing or not executable, the runtime is broken, or the OS refused the process. | Read `details` for the executable and OS error. Verify the path is executable and the runtime/Proton installation is complete. There is no automatic launcher fallback. |
| `load_order_overridden` | `used_mods.txt` does not match the applied order, contains duplicate/unmanaged entries, or changed during the launch guard window. | Another process (for example Creative Assembly's launcher) rewrote the file, or a user/tool edited it during launch. | The manager refused to launch, or stopped the immediate process it started and restored the snapshot; the runtime may already have spawned descendants. Compare `used_mods.txt` with the last preview and click Apply Load Order before retrying. Do not launch through Steam manually. |

### How the Linux launch path works

The Linux launch path is Proton-only:

```text
manager writes used_mods.txt (separate explicit operation)
  -> resolves Steam root, compatdata, Proton, and Steam Linux Runtime
  -> runtime --verb=waitforexitandrun -- proton waitforexitandrun Warhammer3.exe used_mods.txt;
  -> manager watches used_mods.txt for 3 seconds
  -> if it changed, kills the spawned process and returns load_order_overridden
```

There is no automatic Steam fallback: a fallback would reintroduce the launcher
that rewrites the mod list. If direct Proton cannot be resolved, fix the
reported prerequisite and retry.

The launch guard is bounded to three seconds. A rewrite after that window is
not detected by this check; the next launch's pre-launch check rejects it.

### How the Windows launch path works

The Windows launch path is direct:

```text
manager verifies used_mods.txt matches the selected order
  -> verifies the Steam client process is running
  -> starts <game>/Warhammer3.exe with used_mods.txt; and cwd=<game>
  -> manager watches used_mods.txt for 3 seconds
  -> if it changed, kills the spawned process and restores the snapshot
```

Steam is not the parent of the game and the Creative Assembly launcher is not
invoked. Do not launch WH3 through Steam manually: that path still opens the CA
launcher and can rewrite `used_mods.txt`. The manager will detect the mismatch
on the next launch and ask you to apply the order again.

### The game opens but a mod does not load

A Workshop or custom-folder pack needs a working-directory line before its
`mod` line:

```text
add_working_directory "C:\...\steamapps\workshop\content\1142710\<workshop-id>";
mod "the-mod.pack";
```

`used_mods.txt` must contain the folder that holds the pack. A local pack in
`<game>/data/` does not need one.

Check, in order:

1. The pack path. A Workshop mod lives under
   `steamapps/workshop/content/1142710/<id>`; a local mod usually lives under
   `<game>/data`.
2. That the Workshop folder appears in `add_working_directory`; if it is missing,
   click **Apply Load Order** again with the current build.
3. That the pack name in `mod "…";` is the actual `.pack` file name, not the
   Workshop title.
4. That the mod's dependencies and game-version compatibility are satisfied.
5. That Steam was running before the direct launch and is logged in.

For a controlled comparison, launch once through Steam/the CA launcher with the
same mod, copy the working `used_mods.txt`, then compare it byte-for-byte with
the manager's file. The CA file is the ground truth for the current game build.

## General codes

| Code | Meaning | Likely cause | What to check |
|---|---|---|---|
| `io` | A filesystem or process I/O operation failed. | Permission denied, a file disappeared, a read-only directory, or a failed process start. | Read `details` for the path and OS error. Check permissions and free space, then retry. |
| `config_corrupt` | Persisted app state could not be parsed or validated. | `config.json`, its backup, or `used_mods.txt` is malformed or unreadable. | Keep both files; use the Settings restore path for a valid backup. The core never silently overwrites corrupt state. |
| `game_not_found` | Total War: Warhammer III was not located. | The game is not installed, the library is not in `libraryfolders.vdf`, or the manual path is wrong. | Use Settings → Game path and select the folder containing `data/`. Confirm `appmanifest_1142710.acf`. |
| `steam_not_found` | Steam could not be located or read. | Steam is not installed, its library metadata is unreadable, or the game path is outside a discovered library. | Check native Steam, the `libraryfolders.vdf` entries, and the Workshop/ACF paths. Flatpak/Snap launch is not covered by the Linux build. |
| `steam_not_running` | Steam is installed but its client process is not running. | The manager launches WH3 directly on Windows, so Steamworks needs the Steam client already open. | Start Steam, wait for the login to finish, then launch again. |
| `process_detection_failed` | The manager could not determine whether the game or Steam is running. | `/proc` or `tasklist` was unavailable or returned an error. | Close WH3 or start Steam manually, confirm the process list is readable, then retry. Launch is blocked rather than risking a second instance. |
| `pack_parse_failed` | A `.pack` file is malformed or unreadable. | Bad PFH5 header, truncated file, or an invalid index. | Find the pack path in `details`; the mod stays listed with `packError`. Remove or repair the pack. |
| `not_found` | A requested mod, profile, or tag does not exist. | The UI sent a stale id after a refresh or deletion. | Refresh the view and retry. |
| `validation` | Caller-supplied input is invalid. | Invalid profile name, empty write without confirmation, unmanaged-directive loss without confirmation, or launching while the game runs. | Read the message; it names the confirmation or input that must change. |
| `internal` | An unexpected failure occurred. | A bug or an unhandled bridge/panic path. | Record the message, `details`, and the steps; report the issue. No stack trace is shown in the UI. |

## Collecting evidence for a report

1. The exact `code`, `message`, and `details` from the error banner.
2. The game path, Steam root, and Proton prefix from Settings.
3. Whether `Warhammer3.exe` exists.
4. The `CompatToolMapping` entry for `1142710` in `config/config.vdf`.
5. The Proton and `SteamLinuxRuntime*` directories under `steamapps/common`.
6. A copy of `used_mods.txt` and its hash before and after the failed launch.
7. The command line of any surviving process (`ps -eo pid,args` on Linux).
