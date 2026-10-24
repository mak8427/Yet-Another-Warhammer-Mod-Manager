# ADR-010 — Windows direct launch and mod-list protection

- Status: accepted
- Date: 2026-10-24
- Supersedes: ADR-006 Launch section, for Windows
- Related: ADR-009, `docs/TROUBLESHOOTING.md`, `docs/MANUAL_QA_WINDOWS.md`

## Context

On Windows, `steam.exe -applaunch 1142710 used_mods.txt;` asks Steam to start
the game's configured entry point. That entry point is Creative Assembly's
launcher. The launcher can rewrite `<game>/used_mods.txt` from its own mod
selection before `Warhammer3.exe` reads it, so the order written by this manager
is not the order the game loads.

The same problem does not exist when the game executable is started directly.
The working upstream WH3 Mod Manager uses exactly that path on non-Linux
platforms: it runs `<game>/Warhammer3.exe` with the game argument array and the
game directory as the child working directory. Steam remains open for
Steamworks and Workshop, but Steam does not own the launch chain.

CA's newer launcher has an optional "straight into the game" boot setting, but
that is user/Steam configuration, can be reset, and is not controlled by this
app. It is not a dependable product fix.

## Decision

### Windows launch

- Resolve `<game>/Warhammer3.exe`; a missing executable is `game_not_found`.
- Start it directly with the literal argument `used_mods.txt;`.
- Set the child working directory to the game directory.
- Set `LaunchMethod::Direct`.
- Do **not** call `steam -applaunch` for WH3 launch.
- Do **not** fall back to Steam if the direct launch fails. A Steam fallback
  would reopen the CA launcher and recreate the data-loss path.
- Require the Steam client process to be running. Direct launch still needs
  Steamworks and Workshop; a missing client is `steam_not_running`. If the
  process probe fails, launch is blocked with `process_detection_failed`.

The Windows command is:

```text
<game>/Warhammer3.exe used_mods.txt;
```

The game directory is the working directory. The argument is a single argv
value; the manager never builds a shell command.

### Pre-launch consistency check

`launch_game` and `write_load_order` remain separate operations. Launch never
writes `used_mods.txt`.

Before any options are persisted or launch tweaks are written, launch:

1. reads `used_mods.txt` fresh;
2. rejects unreadable or corrupt files;
3. resolves the selected enabled ids to pack names;
4. compares the file's managed `mod "name";` entries with that selected order.

A mismatch returns `load_order_overridden` with both lists in `details` and does
not start the game. Duplicate managed entries and unmanaged directives are also
rejected, because either can change what the game loads. The UI tells the user
to apply the load order first.

### Workshop working directories

A Workshop pack is not in the game's `data` directory. Direct launch therefore
requires the CA-launcher/upstream format:

```text
add_working_directory "<workshop content folder>";
mod "<pack name>";
```

`write_load_order` emits one deduplicated `add_working_directory` line for every
enabled mod whose pack directory is not `<game>/data`, before the `mod` lines.
The pre-launch check compares both the mod order and the working-directory set.
Without this, the game starts normally, finds no Workshop pack, and silently
loads no mod; that is the observed failure mode this decision fixes.

This catches a CA-launcher rewrite from a previous manual Steam launch, another
tool changing the file, or a selection changed without an Apply.

### In-launch guard

After the direct command is resolved and options/tweaks are applied:

1. snapshot the exact bytes of `used_mods.txt`;
2. spawn the game;
3. watch the file for three seconds at 50 ms intervals;
4. if the bytes change, kill the spawned process, restore the snapshot
   atomically (or remove the file if it did not exist), and return
   `load_order_overridden`;
5. if the spawned process exits with a failure status, return `launch_failed`.

The guard is bounded. An external write after the three-second window is not
detected by this check, but the next launch's consistency check will reject it.
The guard's kill stops the immediate child; the runtime may already have
spawned descendants.

### Windows hard lock

A Windows share-mode read handle could deny writes for the whole guard window.
It is not enabled by default because WH3 may open the file with write access
during startup. It remains a separate hardening option only after manual QA
proves the game starts with the lock held.

## Consequences

- The CA launcher is no longer in the Windows launch chain.
- Steam must be running before the manager can launch.
- External Steam launches still invoke the CA launcher and can rewrite the
  file. The manager detects that on the next launch and refuses to start the
  game until the selected order is applied again.
- Direct launch bypasses Steam launch options, overlays, and other environment
  Steam would assemble. This is an accepted trade-off for a deterministic mod
  list.
- The exact game executable path is validated; a malformed install or a moved
  executable produces an actionable error.
- `used_mods.txt` protection is layered: consistency before launch, snapshot
  guard during launch, and restore on a detected rewrite.
