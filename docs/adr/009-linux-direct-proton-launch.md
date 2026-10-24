# ADR-009 — Linux direct Proton launch and load-order guard

- Status: accepted
- Date: 2026-10-24
- Owner: Boris Todbringer (implementation), Katerina Zarina (tech lead)
- Supersedes: ADR-006 Launch section, for Linux only
- Related: ADR-010 (Windows direct launch), `docs/TROUBLESHOOTING.md`, `docs/MANUAL_QA_LINUX.md`

## Context

Steam launches the newer Total War titles through Creative Assembly's launcher.
That launcher can rewrite `<game>/used_mods.txt` from its own selection moments
before the game reads it, so a load order written by this manager may not be the
one the game loads.

The manager already writes `used_mods.txt` through an explicit, previewed atomic
operation. The missing piece is a launch path that does not hand the file to the
Creative Assembly launcher. Running the Windows executable through Proton
directly, with the manager's mod-list argument, removes that intervening writer.

Linux is the target of this decision. Windows uses the direct executable launch
defined in ADR-010, not this Proton resolver.

## Decision

### Proton prerequisites

On Linux the launch path resolves, in order:

1. a Steam root that contains the game's library;
2. the game's Proton configuration:
   - a `CompatToolMapping[1142710]` name containing `proton`, or
   - an existing `Warhammer3.exe`;
3. an existing `<library>/steamapps/compatdata/1142710` directory;
4. a `steamapps/common/Proton*/proton` installation;
5. a `SteamLinuxRuntime*/_v2-entry-point` runtime.

The manager never creates a Proton prefix. A missing `compatdata` directory is a
typed `compat_data_missing` error; the user starts the game through Steam once to
create the prefix.

The Steam Linux Runtime is required. There is no bare-Proton fallback and no
automatic Steam fallback on Linux. Missing prerequisites or a failed spawn are
reported with a stable error code documented in `docs/TROUBLESHOOTING.md`.

### Proton and runtime selection

- Configured tool `proton_11` matches `Proton 11.0` by major version.
- Named tools match by substring, for example `proton_experimental` matches
  `Proton - Experimental`.
- An unmatched or custom tool falls back to the newest numbered Proton, then to
  rolling releases.
- Runtime ranking prefers `SteamLinuxRuntime_<n>` by generation, then `sniper`,
  `soldier`, and other named runtimes.
- Proton and runtime may live in different Steam libraries; every library listed
  by `libraryfolders.vdf` is searched.

### Command and environment

With a runtime:

```text
<runtime>/_v2-entry-point
  --verb=waitforexitandrun
  --
  <proton>/proton
  waitforexitandrun
  <game>/Warhammer3.exe
  used_mods.txt;
```

Environment:

| Variable | Value |
|---|---|
| `STEAM_COMPAT_APP_ID` | `1142710` |
| `STEAM_COMPAT_CLIENT_INSTALL_PATH` | Steam installation root |
| `STEAM_COMPAT_DATA_PATH` | `<library>/steamapps/compatdata/1142710` |
| `STEAM_COMPAT_INSTALL_PATH` | Directory containing `Warhammer3.exe` |
| `SteamAppId` | `1142710` |
| `SteamGameId` | `1142710` |

`used_mods.txt;` is one literal argument. The child working directory is the game
directory. Arguments are passed as an array; the manager never builds a shell
command.

The mod-list file also contains managed `add_working_directory` lines for every
enabled pack outside the game's `data` directory. Proton does not provide the
Workshop search path by itself, so the same rule as ADR-010 applies on Linux.
Unix absolute search directories are serialized as `Z:/...` using Proton's
default filesystem mapping. The Windows game cannot use bare Unix paths as
Unix absolute paths. The pre-launch check uses the same conversion; old files
with bare Unix directories must be regenerated with Apply Load Order.

`GameLocation.proton_prefix` points at `.../compatdata/1142710/pfx`. The
resolver uses its parent for `STEAM_COMPAT_DATA_PATH`; passing the `pfx`
directory itself would be wrong.

### Load-order guard

`launch_game` and `write_load_order` remain separate operations. Launch does not
write `used_mods.txt`.

Before spawning, launch snapshots `used_mods.txt`. After spawning, it watches the
file for three seconds (50 ms polling). If the file changes, the manager:

1. kills the spawned process;
2. returns `load_order_overridden`;
3. includes the PID, before/after sizes, and kill outcome in `details`.

The guard is bounded. An override after the three-second window is not detected
by this check.

### Windows

Windows does not use this resolver. ADR-010 defines the Windows path:
`<game>/Warhammer3.exe` is started directly with `used_mods.txt;`, Steam must
be running, and the same pre-launch/guard protection applies.

## Consequences

- Linux launch no longer depends on the Steam/CA launcher to deliver the mod
  list.
- A Linux installation without Proton, compatdata, or the Steam Linux Runtime
  gets an actionable error instead of a fallback launch.
- Steam Launch Options, overlays, and other environment assembled by Steam are
  not reproduced by the direct path.
- Custom tools under `compatibilitytools.d` and global default compatibility
  mappings are not scanned.
- The guard adds up to three seconds to the launch command. A kill of the
  runtime entry point may not terminate every descendant process; the error
  details say whether the immediate process was stopped.
- Flatpak and Snap Steam launches remain out of scope for this build.
