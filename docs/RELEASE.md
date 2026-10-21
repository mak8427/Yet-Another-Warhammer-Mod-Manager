# Release guide

This guide covers the Windows installer, the tag workflow, the manual QA pass,
and the rollback path. It assumes a clean machine and no prior knowledge of the
repository. The product contract is `docs/PRODUCT_SCOPE.md`; the test strategy
is `docs/adr/004-testing-strategy.md`.

## Versioning

- The app uses semantic versioning: `MAJOR.MINOR.PATCH`.
- **One version, four files.** `crates/wh3mm-app/tauri.conf.json`, the Cargo
  workspace (`[workspace.package].version` in `Cargo.toml`), `package.json`, and
  `frontend/package.json` must all say the same `X.Y.Z`.
- The installer version and the `app_info` IPC response come from those files,
  so a mismatch is a release blocker.
- The release tag is `vX.Y.Z` and must match the configured version. The tag
  workflow refuses to build on a mismatch.
- v1.0.0 is the first release. The tag and draft release are created only after
  M4 (WAR-10) and the release gates are on `main`. Creating the tag is not
  publication: the workflow creates a draft, WAR-12 audits that draft, and only
  then may a human publish it.

## Build locally on Windows

Prerequisites:

| Tool | Version | Notes |
|---|---|---|
| Windows | 10 or 11, x64 | The installer's WebView2 bootstrapper downloads the runtime if it is missing; the first install needs network access |
| Rust | 1.90+ (stable) | `rustup default stable`; MSVC build tools |
| Node.js | 24.15+ | `node --version` |
| pnpm | 12.14 | `corepack enable` then `corepack prepare pnpm@12.14.0 --activate` |
| Tauri CLI | 2.12.4 | fetched by `npx`, nothing global to install |
| NSIS / WiX | bundled | Tauri downloads the packaging tools during the first bundle |

Commands, from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
cargo test --workspace --locked
cd crates/wh3mm-app
npx --yes @tauri-apps/cli@2.12.4 build --ci --bundles nsis
```

Outputs (paths are relative to the repository root because the crates share one
Cargo target directory):

- NSIS: `target/release/bundle/nsis/WH3 Mod Manager_1.0.0_x64-setup.exe`
- Unpacked executable: `target/release/wh3mm.exe`

The NSIS installer is configured `currentUser`: it installs per user and needs no
administrator elevation. An MSI bundle is intentionally not shipped for v1.0;
Tauri's WiX MSI path is per-machine and would require UAC.

The installer is **not code-signed**. Windows SmartScreen will show an
"Unknown publisher" warning. Tell testers to choose **More info → Run anyway**
and never to bypass a warning for a file whose SHA-256 does not match the
checksum published with the release.

## Known limitations (v1.0)

These are accepted for v1.0. None is a correctness risk, and each has an exact
manual check in the QA pass below.

| ID | Limitation | Manual check |
|---|---|---|
| **WS-3** | Subscribe, unsubscribe, and update through the Steam client only. The app has no custom Steam authentication and never automates these actions. | On a clean Windows machine, subscribe to a Workshop mod in the Steam client, rescan, and confirm the mod appears; unsubscribe and confirm it disappears. Confirm the app never asks for Steam credentials. |
| **LA-1** | Launch goes through Steam. The measured launch number is a proxy (time from the app request to the Steam process starting), not an in-game load time. | In QA step 7, launch through the app and record the result. Keep the number labelled "proxy" in any report; do not compare it to an in-game load timing. |
| **ML-4** | Persisted scroll position and the 20k-row guard are polish, not correctness. | Scroll a long mod list, switch screens and back; a reset scroll position is accepted. Load the 20k-row fixture and confirm the guard shows a clear message instead of freezing. |
| **SET-2** | Density, author, and thumbnail preferences persist best-effort. | Toggle density, author, and thumbnail display; restart; confirm each value survived. Record any value that did not persist. |
| **DET-1 Linux roots** | Flatpak, Snap, and XDG game discovery is best-effort and may miss an installation. On Windows, the registry and native root are fixture-tested on WAR-10. | On a Flatpak or Snap install, confirm detection or use the manual path chooser. On Windows, confirm the registry/native detection finds the game without a manual path. |

## Tag workflow (CI)

`.github/workflows/release.yml` runs on a `v*` tag:

1. Checks the tag against `tauri.conf.json` and fails on a mismatch.
2. Runs `cargo test --workspace --locked` and installs the frontend.
3. Builds the NSIS installer on `windows-latest`.
4. Writes `SHA256SUMS.txt` and uploads the installer plus that file as the
   `wh3mm-windows-<version>` run artifact.
5. Creates a **draft** GitHub release with the installer and checksums attached.

It never publishes a release automatically. A human reviews the draft, edits the
notes, and publishes it. Linux PR gates in `.github/workflows/ci.yml` are
unchanged and stay required.

To exercise the build without creating a tag or a release, run the workflow
manually (`workflow_dispatch`) with the version input; that path uploads the
artifact only.

**Ordering.** GitHub only exposes `workflow_dispatch` for a workflow that is on
the default branch. The artifact-producing Windows run therefore comes **after**
the release-engineering PR merges to `main`: dispatch `release.yml` at the
release head, link the run and artifact on the task, and only then continue the
approval path. Do not dispatch from an unmerged feature branch. Create the
`v1.0.0` tag only after M4 (WAR-10) and the release gates are on `main`; that
tag exists so WAR-12 can audit the draft installer it produces.

## Manual Windows QA script

Run this on a machine that has never had the app installed. Record the build
number (from the About/app-info surface) and every result.

1. **Install.** Run the NSIS installer as a normal user. Confirm it completes
   without an administrator prompt, creates a Start-menu entry, and launches
   from the Start menu.
2. **First run.** The window opens at 1280x840, the title is `WH3 Mod Manager`,
   and no unhandled error dialog appears. Copy the version shown by the app; it
   must read `1.0.0`.
3. **Detect paths.** On a machine with Total War: WARHAMMER III installed, the
   app finds the game and reports the data directory. On a machine without the
   game, it shows the no-game state with a manual path chooser; choosing a valid
   game directory recovers without a restart.
4. **50+ mods.** Copy at least 50 Steam Workshop mods into the game's `data`
   directory. Trigger a scan. The list finishes, shows every mod, and scrolling
   500 rows stays responsive.
5. **Reorder.** Drag a mod to a new position (or use the keyboard reorder), then
   save the load order. Reopen the app and confirm the order persisted.
6. **Profile switch.** Create a profile, disable a mod, save, switch to the
   default profile, then switch back. The mod state and order match the profile.
7. **Launch.** With the game installed, launch through the app. The game starts
   with the saved load order; if the game is not installed, the button is
   disabled or gives a clear message.
8. **Corrupt `used_mods.txt` recovery.** Close the app. In the detected WH3 game
   directory, replace `used_mods.txt` (next to `used_mods.txt.bak`) with
   garbage. Start the app: it must report the corrupt file and offer the backup,
   not crash or silently overwrite the user's data. Choose **Restore backup** in
   the app to recover `used_mods.txt.bak`, then confirm the previous order
   returns. Do not restore by copying files while the app is running.
9. **Uninstall.** Uninstall from Windows Settings. The Start-menu entry and
   program files are removed. User configuration under `%APPDATA%` may remain;
   note whether the user data is preserved (expected) and that no game files
   were touched.
10. **Unsigned-installer warning.** On a fresh machine, confirm the SmartScreen
    warning is the documented "Unknown publisher" flow and that the SHA-256 of
    the downloaded file matches the release notes.

A release candidate passes only if every step passes on a clean Windows 10 or 11
machine and the evidence (screenshots or notes per step) is attached to the
release task.

## Rollback

- **Bad installer, no installs yet:** delete the draft release and the tag, fix
  the build, and cut a new patch tag. Never move a published tag.
- **Bad release already published:** mark the GitHub release as "pre-release",
  publish a fixed `vX.Y.Z+1`, and add a note to the release page. Do not delete
  the tag; users may already have downloaded it.
- **User-side rollback:** uninstall the broken build, install the previous
  `vX.Y.(Z-1)` installer, and restore the profile/config backup. The app writes
  an atomic `used_mods.txt` with a `.bak`, so a downgrade recovers the previous
  load order.
- **Data safety:** the app never modifies game archives. If launch misbehaves,
  restore `used_mods.txt` from its `.bak` before investigating further.

## Pre-release checklist

- [ ] M4 merged (WAR-10), including SET-4, ML-3, CF-4, PRF-2, and DET-1; `main` is green.
- [ ] `node scripts/parity-report.mjs` reports **0 missing checks** at the release
      head. The allowed limitations are WS-3, LA-1, ML-4, SET-2, and DET-1's
      Linux roots; DSC-1 (author) and WS-2 (Workshop open) may also remain
      `partial` — under WAR-79 the parity percentage is monitoring, not the gate.
- [ ] The generated `docs/PARITY.md` and `docs/STATUS.md` are committed at that
      head; `docs/STATUS.md` names the five limitations with their manual checks.
      Never hand-edit `docs/PARITY.md`.
- [ ] Version matches in `tauri.conf.json`, `Cargo.toml`, and both `package.json` files.
- [ ] `CHANGELOG.md` reflects the merged scope.
- [ ] Tag workflow produced the NSIS installer, `SHA256SUMS.txt`, and a draft release.
- [ ] WAR-12 audit signed off on that draft.
- [ ] Manual QA script passed on clean Windows 10 and 11 machines.
- [ ] Installer SHA-256 published in the release notes.
- [ ] Publish the draft only after every item above is checked.

At the release head `0e051204` the parity generator reports 0 missing checks
(91.750%; SET-4, ML-3, CF-4, and PRF-2 are done after WAR-10). The pre-tag gate
stays **0 missing**; do not tag while any check is missing.
