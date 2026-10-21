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
- v1.0.0 is the first release. Create the `v1.0.0` tag only after M4 (WAR-10),
  WAR-106/WAR-107 (WAR-104 ruling B), the perf gate
  (`node scripts/qa/verify-perf-gate.mjs` PASS with Genny4Real's v1.0 sign-off),
  the **0-missing** parity check, and a green `main` are in place. Creating the
  tag is not publication: the tag run produces the Windows artifact and a draft
  release, WAR-12 audits that draft, and only then may a human publish it.

## Merge provenance (required)

GitHub is the record of what shipped, but every agent commits through one broker
identity. GitHub review approvals therefore cannot show independent QA or
tech-lead sign-off, and `reviewDecision` is empty by design. The merge evidence
is recorded in two places: the required CI checks on the pull-request head, and
the Paperclip task ids in the pull-request body.

### Required CI gate

A pull request may merge only when **both** required checks are
`completed/success` on the exact head SHA being merged:

| Check | Workflow | What it proves |
|---|---|---|
| `Linux quality gates` | `.github/workflows/ci.yml` | fmt, clippy, Rust tests, fixture guards, typecheck, lint, frontend tests, build |
| `Capability parity` | `.github/workflows/ci.yml` | `node scripts/parity-report.mjs --check` |

`Windows Tauri shell (manual until packaging)` is skipped on pull requests by
design and is not a required check. A change to the Tauri layer still needs the
manual Windows check in the pull-request template.

A `cancelled`, `failure`, `timed_out`, `neutral`, or `skipped` required check is
**not** a pass. `ci.yml` uses `concurrency: cancel-in-progress`, so pushing a new
commit cancels the older run: that is expected, and the gate is the newest head.
Never merge an older head on the strength of an earlier run.

Before merging, list every check-run on the exact head. Do not rely on the
pull-request summary: it can hide a superseded run on the same SHA.

```bash
gh api "repos/mak8427/Warhammer_mod_manager/commits/<head-sha>/check-runs?per_page=100" \
  --jq '.check_runs[] | select(.name == "Linux quality gates" or .name == "Capability parity") | [.name, .status, .conclusion, .started_at, .completed_at]'
```

Both check names must read `completed success` on the newest run per name. When
the push and pull-request events both produced a run, the newest `started_at` is
the run that counts; `completed_at` only shows how long it took. An older run on
the same SHA does not count. If a required check is cancelled or fails on the
final head, re-run it on that same SHA (`gh run rerun <run-id>`) or push a fix
and use the new head; do not merge and do not re-run a different SHA.

The post-merge push run on `main` is a monitoring check. If it fails, revert or
fix immediately. If it is cancelled because a newer commit superseded it, the
newer commit must have a green run, and the pull-request body records the
cancellation and the superseding run.

### Review evidence in the pull-request body

Every pull-request body contains a `## Review evidence` section with the
Paperclip approval ids, copied from the execution policy:

- QA review: `WAR-<n>` (owner: Baltasar Gelt), approved, with the stage
  decision id or review comment id;
- tech-lead approval: `WAR-<n>` (owner: Katerina Zarina), approved, with the
  stage decision id or approval comment id;
- the author is not the approver (`reviewPolicy: not_creator`);
- performance-sensitive change: the `WAR-<n>` sign-off with the before/after
  numbers.

When the named reviewer or approver is the author, substitute the next role up:
when the tech lead is the author, Torgrim approves; when QA is the author,
Genny4Real reviews. Nobody approves their own work.

The ids are the audit trail; a bare name is not evidence. The reviewer and the
approver record their verdict on their own Paperclip task, and the merge task
links both. This replaces GitHub review approvals until the company has a
separate GitHub identity for QA and the tech lead.

### Branch protection (owner action)

The default branch has one active ruleset (`Portect brahc`, id `25486392`) that
blocks deletion and non-fast-forward pushes. It does **not** require a pull
request or status checks, so the CI gate above is enforced by process until
Torgrim updates the ruleset. The required settings are:

- target `~DEFAULT_BRANCH`; enforcement active; no bypass actors;
- require a pull request before merging;
- require the status checks `Linux quality gates` and `Capability parity`;
- require branches to be up to date before merging;
- keep the existing deletion and non-fast-forward rules.

This is an owner action; it stays in `docs/STATUS.md` until it is done.

### Historical record: PR #30 (`1cdd35f`)

PR #30 (release-head parity index, WAR-73) merged as squash commit `1cdd35f` on
2026-10-21 at 16:43Z.

- Pre-merge gate: the pull-request head `ef8094e` had `Linux quality gates` and
  `Capability parity` both `completed/success` (runs
  [39636412756](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39636412756)
  and
  [39636419120](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39636419120)).
  The required gate was met.
- Post-merge push run
  [39637359257](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39637359257)
  on `1cdd35f`: `Capability parity` succeeded, `Linux quality gates` was
  cancelled at 16:45:07Z because the next commit superseded it. `1cdd35f` has no
  green `Linux quality gates` run of its own.
- Superseding run: `3106dd5`, the direct child of `1cdd35f`, is green (run
  [39637546916](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39637546916):
  Linux and parity success). The only diff from `1cdd35f` is
  `crates/wh3mm-app/Cargo.toml` and `Cargo.lock` for the WAR-101 Windows
  feature; Linux does not build that Windows-only dependency. The green
  `3106dd5` run therefore supersedes the cancelled Linux result for `1cdd35f`,
  and no unverified content shipped.

This is a one-time historical record, not a precedent. From WAR-127 onward the
rule above applies: green on the exact pull-request head, review ids in the
body, and a recorded explanation if a post-merge run is superseded.

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

Download the installer and `SHA256SUMS.txt` into the same directory, then verify
them with the exact name that was published:

```bash
sha256sum -c SHA256SUMS.txt
```

Releases built after `v1.0.0` write checksum entries with the uploaded asset
name (`WH3.Mod.Manager_<version>_x64-setup.exe`), not the build path, so this
command works verbatim. The `v1.0.0` draft keeps its original checksum file;
verify that asset with the installer-name command in its release notes. On
Windows PowerShell:

```powershell
(Get-FileHash .\WH3.Mod.Manager_1.0.0_x64-setup.exe -Algorithm SHA256).Hash.ToLower()
```

The result must match the SHA-256 printed in the release notes.

## Known limitations (v1.0)

These are accepted for v1.0. None is a correctness risk, and each has an exact
manual check in the QA pass below.

| ID | Limitation | Manual check |
|---|---|---|
| **WS-3** | Subscribe, unsubscribe, and update through the Steam client only. The app has no custom Steam authentication and never automates these actions. | On a clean Windows machine, subscribe to a Workshop mod in the Steam client, rescan, and confirm the mod appears; unsubscribe and confirm it disappears. Confirm the app never asks for Steam credentials. |
| **LA-1** | Launch goes through Steam. The measured launch number is a proxy (time from the app request to the Steam process starting), not an in-game load time. | In QA step 7, launch through the app and record the result. Keep the number labelled "proxy" in any report; do not compare it to an in-game load timing. |
| **ML-4** | Persisted scroll position and the 20k-row guard are polish, not correctness. | Scroll a long mod list, switch screens and back; a reset scroll position is accepted. Load the 20k-row fixture and confirm the guard shows a clear message instead of freezing. |
| **SET-2** | Density and thumbnail preferences persist best-effort. | Toggle density and thumbnail display; restart; confirm each value survived. Record any value that did not persist. |
| **DET-1 Linux roots** | Flatpak, Snap, and XDG game discovery is best-effort and may miss an installation. On Windows, the registry and native root are fixture-tested on WAR-10. | On a Flatpak or Snap install, confirm detection or use the manual path chooser. On Windows, confirm the registry/native detection finds the game without a manual path. |

The pack-author column is **removed in v1.0** (WAR-104, WAR-107), not
documented as a limitation: the PFH5 header and the Steam ACF carry no author,
and the legacy Steamworks persona lookup needs the custom Steam auth that v1.0
does not ship. The author column, author sort, author search dimension, and
Settings "Show authors" toggle are gone; PRODUCT_SCOPE capability 2 now covers
name, type, timestamp, and dependencies.

## Tag workflow (CI)

`.github/workflows/release.yml` runs on a `v*` tag:

1. Checks the tag against `tauri.conf.json` and fails on a mismatch.
2. Runs `cargo test --workspace --locked` and installs the frontend.
3. Builds the NSIS installer on `windows-latest`.
4. Stages the installer and `SHA256SUMS.txt` flat, writes checksum entries with
   the uploaded asset name, and verifies them with `sha256sum -c` before
   uploading the pair as the `wh3mm-windows-<version>` run artifact.
5. Creates a **draft** GitHub release with the installer and checksums attached.

It never publishes a release automatically. A human reviews the draft, edits the
notes, and publishes it. Linux PR gates in `.github/workflows/ci.yml` are
unchanged and stay required by process (see **Merge provenance** above); GitHub
enforces them only after the owner enables the required checks.

To exercise the build without creating a tag or a release, run the workflow
manually (`workflow_dispatch`) with the version input; that path uploads the
artifact only.

**Ordering.** GitHub only exposes `workflow_dispatch` for a workflow that is on
the default branch. The artifact-producing Windows run therefore comes **after**
the release-engineering PR merges to `main`: dispatch `release.yml` at the
release head, link the run and artifact on the task, and only then continue the
approval path. Do not dispatch from an unmerged feature branch. Create the
`v1.0.0` tag only after M4 (WAR-10), the WAR-104 ruling's WAR-106/WAR-107 work,
the perf gate, the 0-missing parity check, and a green `main` are in place. The
tag run produces the artifact and draft that WAR-12 audits; publish only after
WAR-12 signs off.

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
8. **Workshop open.** With at least one Workshop mod subscribed in Steam, open
   the Workshop screen, choose **Open page** on that item, and confirm the Steam
   client opens the item's Workshop page. Confirm the app itself never asks for
   Steam credentials. This is the manual fallback for the automated WS-2 test;
   record the result even when the automated test passes.
9. **Corrupt `used_mods.txt` recovery.** Close the app. In the detected WH3 game
   directory, replace `used_mods.txt` (next to `used_mods.txt.bak`) with
   garbage. Start the app: it must report the corrupt file and offer the backup,
   not crash or silently overwrite the user's data. Choose **Restore backup** in
   the app to recover `used_mods.txt.bak`, then confirm the previous order
   returns. Do not restore by copying files while the app is running.
10. **Uninstall.** Uninstall from Windows Settings. The Start-menu entry and
    program files are removed. User configuration under `%APPDATA%` may remain;
    note whether the user data is preserved (expected) and that no game files
    were touched.
11. **Unsigned-installer warning.** On a fresh machine, confirm the SmartScreen
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
      Linux roots. DSC-1 is done against the corrected PRODUCT_SCOPE after
      WAR-107, and WS-2 is done after WAR-106.
- [ ] The generated `docs/PARITY.md` and `docs/STATUS.md` are committed at that
      head; `docs/STATUS.md` names the five limitations with their manual checks.
      Never hand-edit `docs/PARITY.md`.
- [x] WAR-106 (WS-2 Workshop Open test) is merged and QA-approved (`f2e8b0f`).
- [x] WAR-107 (DSC-1 author surface cut and `PRODUCT_SCOPE` correction) is merged and QA-approved (`84b11c6`).
- [x] Version matches in `tauri.conf.json`, `Cargo.toml`, and both `package.json` files.
- [ ] `CHANGELOG.md` reflects the merged scope.
- [ ] Every PR merged after WAR-127 has green `Linux quality gates` and
      `Capability parity` runs on its exact head, and its body records the QA
      and tech-lead Paperclip approval ids (`docs/RELEASE.md`, Merge provenance).
- [ ] `node scripts/qa/verify-perf-gate.mjs` passes at the tag head and Genny4Real's v1.0 perf sign-off is recorded (WAR-98).
- [ ] Tag workflow produced the NSIS installer, `SHA256SUMS.txt`, and a draft release.
- [ ] WAR-12 audit signed off on that draft.
- [ ] Manual QA script passed on clean Windows 10 and 11 machines.
- [ ] Installer SHA-256 published in the release notes.
- [ ] Publish the draft only after every item above is checked.

At the WAR-106/WAR-107 head `84b11c6` the parity generator reports **94.000% with 35 done / 5 partial / 0 missing**,
with DSC-1 done against the corrected PRODUCT_SCOPE criteria and WS-2 done with
automated evidence. Regenerate the report at the exact tag head. The pre-tag
gate stays **0 missing**; do not tag while any check is missing, and never
hand-edit `docs/PARITY.md`.
