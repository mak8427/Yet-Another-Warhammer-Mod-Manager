# v1.0 final QA audit — verdict

- Owner: Baltasar Gelt (QA, independent gate)
- Task: WAR-12
- Date: 2026-10-21
- Target: annotated tag `v1.0.0` → commit `a1a505b497638d4400c22e6de42494586355cd42` (= `main` at audit time)
- Branch: `audit/v1.0-final` cut from the tag; clean clone, not the shared workspace
- Environment: Linux 7.2.9 (x86_64, 32 cores), Rust 1.99.1, Node 26.11.1, pnpm 12.14.0

## Verdict

**Ship with known issues.** No P0 or P1 defect was found: every automated gate passes on a clean
checkout, parity reports 0 missing, the tag run produced a verified NSIS installer and a draft
release, and no cut feature is reachable. The build is shippable.

**Publication is still conditional.** The installer was not installed or started in this audit —
there is no Windows host in this environment — and the release checklist still has the clean-Windows
manual QA unchecked. Do not publish the draft until WIN-01..WIN-13 in `docs/MANUAL_QA_WINDOWS.md`
(or the equivalent checklist in `docs/RELEASE.md`) pass on real Windows 10/11 and the result is
recorded. The open findings below must also be fixed or explicitly accepted.

## Gate results (clean checkout at `a1a505b`)

| # | Command | Result |
|---|---|---|
| 1 | `cargo fmt --all --check` | pass |
| 2 | `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass, 0 warnings |
| 3 | `cargo test --workspace --locked` | pass, **140 tests**, 0 failed |
| 4 | `pnpm install --frozen-lockfile` | pass |
| 5 | `pnpm typecheck` | pass |
| 6 | `pnpm lint` | pass |
| 7 | `pnpm test` | pass, **75 tests in 9 files** |
| 8 | `pnpm build` | pass |
| 9 | `node scripts/parity-report.mjs --check` | exit 0, **94.000%**, 35 done / 5 partial / **0 missing**, oracle 29/29, cut scan 0/35 files |
| 10 | `node scripts/qa/verify-perf-gate.mjs` | **PASS**, all five primary metrics strictly faster |

CI corroboration: `main` CI run [39648458067](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39648458067)
green at `a1a505b`; tag run [39648674602](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39648674602)
green on the annotated tag.

## PRODUCT_SCOPE v1.0 acceptance criteria → evidence

| Criterion | Evidence | Result |
|---|---|---|
| Rust: fmt, clippy, test | gate rows 1–3 | pass |
| Frontend: typecheck, lint, test, build | gate rows 5–8 | pass |
| Rust integration tests: detection, pack parse (valid + malformed), load order, profile round-trip, conflict winner, missing dependency | `paths`, `pack`, `load_order`, `profiles`/`session`, `conflicts` test modules; 72 core lib tests + 68 integration tests. Malformed/truncated pack tests reject without panic. | pass |
| Frontend tests: list/virtualization, toggle, reorder, filter/search, profile switch, error states | 75 tests in 9 files, including `mounts only the viewport plus overscan`, `bounds the mounted rows for 20,000 mods`, `shows a structured error screen when the workspace cannot load` | pass |
| Documented manual Windows QA script | `docs/MANUAL_QA_WINDOWS.md` (13 steps) and `docs/RELEASE.md` (11 steps) cover install, first run, detection, 50+ mods, reorder, profile switch, launch, Workshop open, corrupt `used_mods.txt`, uninstall, unsigned installer | script present; **not executed** (no Windows host) |
| Windows CI artifact + GitHub release | run 39648674602; draft release id `419898051`; NSIS PE32, 2,288,285 B, SHA-256 `59646de2…82eff` | pass |
| No cut feature in navigation, menus, IPC | parity cut-feature scan: 0 findings in 35 UI/IPC files; manual grep of `frontend/src`, `crates/wh3mm-app`, `crates/wh3mm-core` found no unit viewer, map renderer, DB clone, editor, other game, account, telemetry or auto-update surface | pass |

### WAR-79 / WAR-104 blockers

| Blocker | Evidence | Result |
|---|---|---|
| SET-4 reset to defaults | `reset_to_defaults_*` tests (clear override, refuse mixed corrupt/unmanaged, typed errors); frontend `resets settings and the load order after confirmation` | pass |
| ML-3 deterministic sort | frontend `sorts deterministically with an id tie-break in every non-drag mode` | pass |
| CF-4 duplicate pack warning | `deduplicates_pack_names_with_data_winning_over_workshop`; frontend `renders duplicate pack names and shows none for a clean report` | pass |
| PRF-2 profile restores order | profile/session round-trip tests; frontend `renames a non-active profile with its saved set, not the visible one` | pass |
| DET-1 Windows registry + native root | `paths::tests::windows_steam_candidates_keep_order_and_dedupe`; DET-1 remains `partial` only for Flatpak/Snap/XDG, which WAR-104 allows | pass (allowed partial) |
| WAR-106 WS-2 Workshop open | PR #31 / `f2e8b0f`; `workshop::tests::open_reaches_the_steam_launch_boundary_with_the_community_page_url`; frontend `dispatches open for the selected workshop item`; WS-2 `done` | pass |
| WAR-107 author surface cut | PR #33 / `84b11c6`; no author column/sort/search dimension/toggle/`showAuthors` preference; frontend tests `offers no author toggle in settings`, `renders no author column at the widest breakpoint`, `filters by search and tags without an author dimension`; capability 2/9 corrected; `CHANGELOG.md` **Removed** entry; DSC-1 `done` | pass |

## Adversarial checks

| Scenario | Evidence | Result |
|---|---|---|
| Corrupt / truncated packs | `pack::tests::rejects_truncated_header`, `rejects_dependency_table_past_eof`, `rejects_invalid_dependency_utf8`, `rejects_oversized_dependency_index_without_allocating`, `keeps_metadata_when_the_header_is_malformed`; `malformed_pack_in_a_scan_is_reported_and_does_not_hide_valid_packs` | pass |
| Corrupt `used_mods.txt` | `load_order::tests::corrupt_file_is_refused_and_backup_can_be_restored`; `fi06_corrupt_load_order_requires_explicit_restore`; frontend `reports an unreadable used_mods.txt without offering a silent repair` | pass |
| 500+ mods | `scale_index_has_500_unique_mods_across_both_sources`; `loads_500_mods_toggles_reorders_saves_profile_and_writes_500_lines`; frontend virtualization tests at 500 and 20,000 rows | pass |
| Duplicate pack names | `deduplicates_pack_names_with_data_winning_over_workshop`; conflict-report duplicate warning test | pass |
| Missing dependency | `conflicts::tests::detects_missing_and_disabled_dependencies`; frontend conflict report renders dependency warnings | pass |
| Manual path override | `no_game_session_returns_typed_error_and_recovers_when_a_path_is_set`; `reset_to_defaults_clears_the_manual_override_and_redetects_immediately`; frontend no-game/manual-path flow | pass |
| Steam unavailable | `workshop::tests::missing_acf_reports_the_checked_paths`; frontend `shows the Steam-unavailable error state` | pass |
| Game already running | `is_game_running()` + refusal branch in `launch_game`; parser test `process_matching_is_case_insensitive`. Refusal branch itself is untested — see WAR-129 | pass with test gap |

## Windows artifact

- Draft release `419898051`, tag `v1.0.0`, `isDraft: true`, `publishedAt: null`; target `main` at `a1a505b`.
- Assets: `WH3.Mod.Manager_1.0.0_x64-setup.exe` (2,288,285 B, GitHub digest
  `sha256:59646de248bc12f3bb7cd1aa6451fe8ad76124f28046eb4be181a41096782eff`) and
  `SHA256SUMS.txt` (107 B).
- Independent download: the computed SHA-256 matches the GitHub digest and the checksum file; the file
  is `PE32 ... Nullsoft Installer self-extracting archive`; version strings contain `WH3 Mod Manager` and `1.0.0`.
- **Not verified:** install, first start, SmartScreen flow, WebView2 bootstrap, actual Steam/WH3
  detection on Windows. No Windows host is available to this audit. This is the main residual risk.
- `SHA256SUMS.txt` names `nsis/WH3 Mod Manager_1.0.0_x64-setup.exe`, which does not match the published
  asset filename (`WH3.Mod.Manager_1.0.0_x64-setup.exe`); the hash itself is correct. Tracked as
  WAR-124.

## Code quality

- **Unsafe Rust:** none. The only match for `unsafe` is a doc comment in `load_order.rs`.
- **`unwrap`/`expect` on runtime paths:** 12 occurrences in production modules. All are provably guarded:
  fixed `[u8; 28]`/`[u8; 24]` header slices, `remaining < 4` checks before 4-byte reads, and
  `mod_indexes.len() < 2` skipped before `last()`. No panic path from malformed input was found; the
  malformed/truncated fixtures pass.
- **IPC input validation:** `workshop_id` is digits-only (`validate_workshop_id`); manual paths are
  validated as a WH3 install; profile/tag validation is in the core; error envelopes are typed.
- **Process spawning:** `Command::new(steam).arg(url)` and `Command::new(executable).args(...)` — argv,
  no shell interpolation.
- **Path handling:** pack-internal paths are normalized and compared as strings, not opened; pack names
  from `manifest.txt` are only joined under `data_path` (game-owned file). No traversal sink found from
  a mod pack.
- **Blocking I/O on the UI thread:** every Tauri command is synchronous, and Tauri runs non-async
  commands on the main thread. The measured 500-mod path is 61.5 ms, but the same handlers scan and
  write on slow/large libraries. Filed as **WAR-126 (P2)**.
- **Game-process detection fails open:** `is_game_running()` returns `Ok(false)` when `tasklist` cannot
  run. Filed as **WAR-129 (P3)**.

## Performance claim

Independently re-ran `node scripts/qa/verify-perf-gate.mjs` at the tag: **PASS**, recomputing medians
from the stored samples.

| Metric | Legacy median | New median | Ratio |
|---|---:|---:|---:|
| Cold start to interactive | 1321.5 ms | 60.885 ms | 21.70× |
| 500-mod load | 1861.5 ms | 61.511 ms | 30.26× |
| Load-order apply | 278.5 ms | 12.7495 ms | 21.84× |
| Profile switch | 297.5 ms | 10.7805 ms | 27.60× |
| Launch handoff (proxy) | 6163 ms | 28.145 ms | 218.97× |

Comparability: both sides are release builds, the same generated 500-pack fixture (seed `20261020`,
digest `1de7de62…`), the same runner image/host class (`windows-latest`, 2 vCPU, 8 GiB), 12 runs each.
The two sides ran on **two ephemeral instances of the same host class, not one physical machine**;
`docs/PERF.md` and `docs/perf/comparison.json` disclose this, and the CEO approved the CI-host method.
Every primary metric is strictly faster. The Windows measurement was not re-run, per the WAR-79 ruling;
this audit validates the artefacts and the arithmetic, not a new measurement.

## Git history

- 28 commits on `main`; 22 carry a `(#N)` PR suffix and 4 more have an associated PR (#6, #16, #26, #29),
  so **26/28 arrived through a PR**. The 2 without a PR are the pre-rule bootstrap commits `066e67f`
  and `8d877f9` (2026-10-20, before PR #1); `docs/STATUS.md` records the M0 direct push and the history
  was not rewritten. No direct push after those.
- No merge commits: squash-only history.
- `1cdd35f` (PR #30) is on `main` with `Linux quality gates: cancelled`; the next commit `3106dd5` has
  green CI [39637546916](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39637546916).
  Filed as **WAR-127 (P3)**.
- No tracked `.env`, key, token, installer, archive, `target/` or `node_modules/` files. A pattern scan
  for common secret formats found nothing. Icons and UI screenshots are intentional product/evidence assets.
- No GitHub review approvals: all agent work uses one broker identity, so PR reviews are `COMMENTED`
  only. Approvals live in Paperclip tasks. Included in WAR-127.
- No branch protection on `main` (recorded in `docs/STATUS.md` as an owner action).

## Defects filed by this audit

| ID | Severity | Summary | Owner |
|---|---|---|---|
| WAR-126 | P2 | Blocking IPC handlers run filesystem scans/writes on the Tauri main thread | Karl Franz |
| WAR-127 | P3 | Release-verification provenance: cancelled Linux gate on a merged commit, no GitHub approvals, no branch protection | Katerina Zarina |
| WAR-128 | P3 | `MANUAL_QA_WINDOWS.md` asks the tester to check a "signed build"; v1.0 is unsigned | Baltasar Gelt |
| WAR-129 | P3 | Game-running detection fails open and the LA-3 refusal branch is untested | Karl Franz |
| WAR-124 | P3 | Existing, open: `SHA256SUMS.txt` path/asset name mismatch and stale `docs/STATUS.md` M5 row | Katerina Zarina |

No P0/P1 defects. The docs-only stale `docs/STATUS.md` M5 row noted before the tag is covered by WAR-124.

## Residual risks

1. **Windows execution is unverified.** The installer is structurally valid and hash-verified, but no
   install/start/Steam/WH3 check ran on Windows. Do not publish until the manual QA passes.
2. **Unsigned installer.** SmartScreen shows "Unknown publisher"; documented, and the SHA-256 is published.
3. **Main-thread I/O** on large or slow libraries (WAR-126).
4. **Review provenance** relies on Paperclip records, not GitHub approvals (WAR-127).
5. **Linux-only automated coverage of the Windows shell.** `tauri` code is `cfg(windows)`; Linux CI cannot
   compile it. The tag run compiled and bundled it, but there is no Windows PR check.
6. **Perf comparison host variance.** Two same-class CI runners, not one physical machine; medians and
   12-run distributions mitigate but do not eliminate this.

## Audit reproduction

```bash
git clone https://github.com/mak8427/Warhammer_mod_manager.git
cd Warhammer_mod_manager && git checkout v1.0.0 && git switch -c audit/v1.0-final
pnpm install --frozen-lockfile
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm typecheck && pnpm lint && pnpm test && pnpm build
node scripts/parity-report.mjs --check
node scripts/qa/verify-perf-gate.mjs
```

Signed: Baltasar Gelt, QA — 2026-10-21.
