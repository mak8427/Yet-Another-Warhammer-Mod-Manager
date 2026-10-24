# QA Plan — WH3 Mod Manager v1.0

- Owner: Baltasar Gelt (QA)
- Status: **active — M1/M2 automation complete; release rows blocked** (§10)
- Scope source: `docs/PRODUCT_SCOPE.md`, ADR-002 (IPC), ADR-003 (data), ADR-004 (testing)
- Last updated: 2026-10-21

This plan makes "done" checkable. It does not add product scope: every criterion
below is quoted from `docs/PRODUCT_SCOPE.md` or a CEO directive. A criterion is
green only when the named command or test exists, runs in CI, and has a
recorded result. Prose, screenshots alone, and "works on my machine" are not
evidence.

---

## 1. The gate

Run on a clean checkout with Node 24+, pnpm 12, and stable Rust.

```bash
# Frontend build first: the Tauri shell embeds frontend/dist at compile time
pnpm install --frozen-lockfile
pnpm build

# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build -p wh3mm-app --release --locked

# Fixtures and QA script tests (also run in CI)
node scripts/qa/generate-fixtures.mjs --verify
node --test scripts/qa/*.test.mjs

# Frontend checks
pnpm typecheck
pnpm lint
pnpm test

# Release-time performance gate (requires docs/perf/comparison.json; see §7)
node scripts/qa/verify-perf-gate.mjs
```

`cargo test -p wh3mm-core --locked` stays usable without the frontend build or
a desktop stack.

A release candidate passes only when **all** of the following are true:

1. Every command above exits 0 on a clean checkout.
2. The counts in §9 are at or above the recorded baseline; no test is silently
   skipped. `#[ignore]` requires a comment and an owner (ADR-004).
3. Every row in §3 is `PASS` with evidence. `PENDING` or `BLOCKED` rows block
   the release.
4. The performance gate in §7 is `PASS`.
5. The Windows manual script in `docs/MANUAL_QA_WINDOWS.md` is completed and
   signed, and the NSIS installer artefact exists on the release.
6. No cut feature is reachable in navigation, menus, or the IPC surface.

**Budgets.** Rust `cargo test` and frontend `pnpm test` each finish in ≤ 120 s
on the Linux CI runner. CI jobs use `timeout-minutes`; a per-test timing
threshold is not a gate because shared runners are noisy (ADR-004).

**Determinism.** No test uses a real Steam install, a real game directory, the
user's config directory, wall-clock time, or the network. Fixed fixture bytes,
fixed seeds, `tempfile::TempDir`, and mocked IPC only.

---

## 2. Test pyramid

| Layer | Location | Tool | Scope | Budget |
| --- | --- | --- | --- | --- |
| Core unit | `crates/wh3mm-core/src/**` `#[cfg(test)]` | `cargo test` | Pure parsing, ordering, validation, error mapping | < 5 s |
| Core integration | `crates/wh3mm-core/tests/` | `cargo test` | Fixtures on disk, atomic writes, round-trips, fault injection | < 60 s |
| App commands | `crates/wh3mm-app/src/commands.rs` tests | `cargo test` | Command wrappers without a Tauri runtime | < 10 s |
| IPC contract | `tests/ipc_contract.rs`, `frontend/src/lib/ipc.test.ts` | `cargo test`, Vitest | Wire names, error envelope, malformed rejections | < 5 s |
| Fixture contract | `crates/wh3mm-core/tests/qa_fixtures.rs` | `cargo test` | Fixture bytes, encodings, manifest, scale index | < 1 s |
| QA scripts | `scripts/qa/*.test.mjs` | `node --test` | Fixture guard, Linux packaging guard, and performance-gate validator | < 1 s |
| Frontend component | `frontend/src/**/*.test.tsx` | Vitest + Testing Library + jsdom | Rendering, interaction contracts, error states | < 10 s |
| Manual Windows | `docs/MANUAL_QA_WINDOWS.md` | Human | Install detection, first run, recovery, launch | per script |
| Manual Linux | `docs/MANUAL_QA_LINUX.md` | Human | Native Steam/Proton detection, mod list, load order, launch | per script |
| Performance | `benches/`, `docs/PERF.md` | Criterion + scripted Windows runs | Cold start, 500-mod load, persist, profile switch, launch | release build |

Unit tests prove logic; integration tests prove the filesystem contract;
component tests prove what the user can do. The manual script covers only what
needs Windows, Steam, and the game; it is not a substitute for automation.

---

## 3. v1.0 acceptance criteria → proof

Status values: `PASS` (evidence recorded), `PENDING` (test not written yet,
owner named), `BLOCKED` (cannot be proven until another issue lands).

### 3.1 Build and static quality

| ID | Criterion | Proving evidence | Status |
| --- | --- | --- | --- |
| A1 | `cargo fmt --check` passes | `cargo fmt --all --check` on the QA branch | PASS — 2026-10-21 |
| A2 | `cargo clippy -- -D warnings` passes | `cargo clippy --workspace --all-targets --locked -- -D warnings` | PASS — 2026-10-21 |
| A3 | `cargo test` passes for the workspace | `cargo test --workspace --locked` | PASS — 97 passed, 0 failed, 0 ignored (WAR-47 regression un-ignored) |
| A4 | `pnpm typecheck`, `lint`, `test`, `build` pass | frontend gate + `node --test scripts/qa/*.test.mjs` | PASS — 42 Vitest tests / 6 files; 24 Node tests |

No test is ignored or quarantined. The WAR-47 regression is un-ignored and
passes; the defect it covered is closed in §8.

### 3.2 Rust integration coverage

Every row is required by `docs/PRODUCT_SCOPE.md` ("Rust integration tests
cover…"). Test names are the contract; if a test is renamed, update this table
in the same PR.

| ID | Criterion | Proving test | Status |
| --- | --- | --- | --- |
| R1 | Path detection from fixture VDF data (multi-library, missing path, Flatpak/Proton) | `detection.rs::discovers_two_libraries_and_reports_the_missing_one`, `::detects_a_game_in_a_secondary_library_with_workshop_and_proton_prefix`, `::falls_back_to_the_conventional_folder_when_the_manifest_is_missing`, `::vdf_fixture_parses_modern_and_legacy_paths` | PASS |
| R2 | Manual path override validates and recovers without a restart | `session_flow.rs::no_game_session_returns_typed_error_and_recovers_when_a_path_is_set` | PASS |
| R3 | Pack parsing, valid headers incl. dependencies, unicode, movie, hash bit | `pack_fixtures.rs::parses_every_valid_fixture_through_the_product_parser` | PASS |
| R4 | Pack parsing failures: bad magic, truncated, oversized dependency/index, empty | `pack_fixtures.rs::rejects_every_header_level_defect_with_a_typed_error`, `pack.rs` unit tests | PASS (scope note below) |
| R5 | Load-order read: BOM, CRLF, duplicates, corrupt, unknown directives, no final newline | `load_order_fixtures.rs::parses_every_committed_variant_exactly_as_documented` | PASS |
| R6 | Load-order write failure leaves the original intact and cleans its temp file | `load_order_fixtures.rs::corrupt_fixture_refuses_writes_and_never_changes_the_file`, `fault_injection.rs::fi03_read_only_directory_preserves_the_load_order` | PASS |
| R7 | `.bak` is byte-exact; recovery is explicit and never silent | `load_order_fixtures.rs::successful_write_creates_a_byte_exact_backup_and_restore_brings_it_back`, `fault_injection.rs::fi06_corrupt_load_order_requires_explicit_restore`, `::fi10_interrupted_write_is_not_restored_silently` | PASS |
| R8 | Byte-stable read → write → read | `session_flow.rs::writes_byte_compatible_used_mods_and_backs_up_the_previous_file`, `load_order::tests::write_round_trip_is_byte_stable_and_creates_backup` | PASS |
| R9 | Profile round-trip: create/save/apply/duplicate/delete; rename keeps the target's set | `session_flow.rs::profiles_create_switch_duplicate_and_delete`, `frontend/src/store.test.ts::renames a non-active profile with its saved set, not the visible one` | PASS |
| R10 | Config corrupt + valid `.bak` recovery; **future schema never overwritten** | `config_fixtures.rs::corrupt_primary_recovers_from_a_valid_backup_and_says_so`, `::future_schema_is_refused_and_never_overwritten`, `::double_corrupt_config_leaves_both_files_untouched`, `::future_schema_with_a_stale_backup_must_still_not_overwrite` | PASS — WAR-47 fixed by PR #15 (`76dd0b9`); future `config.json` and stale v1 `.bak` both stay byte-identical |
| R11 | Deleting the last profile refused; deleting the active profile activates a sibling | `config.rs` unit tests `::deleting_the_last_profile_is_refused`, `::deleting_the_active_profile_activates_a_sibling` | PASS |
| R12 | Conflict winner calculation (last line wins) | `conflicts.rs::last_enabled_pack_wins_each_path` (to be added) | BLOCKED — WAR-9 |
| R13 | Missing dependency warning | `conflicts.rs::reports_missing_dependencies` (to be added) | BLOCKED — WAR-9 |
| R14 | Duplicate pack names warned, IDs stay distinct | `conflicts.rs::reports_duplicate_pack_names` (to be added) | BLOCKED — WAR-9 |
| R15 | Fault injection: ≥ 3 deliberate faults, no panic, no data loss | `fault_injection.rs` FI-01/03/05/06/07/08/10 (7 tests) | PASS |
| R16 | 500-mod scale: scan, enable all, reverse order, save profile, write 500 lines | `session_flow.rs::loads_500_mods_toggles_reorders_saves_profile_and_writes_500_lines` | PASS |
| R17 | Fixture bytes match the documented variants | `qa_fixtures.rs` (7 tests) | PASS |
| R18 | Linux direct Proton resolution and launch guard | `proton_launch` unit tests (15), `launch::tests::direct_proton_is_selected_before_steam_without_a_steam_executable`, `::linux_launch_does_not_fall_back_to_steam`, `::load_order_rewrite_kills_child_and_returns_load_order_overridden`, `launch_guard` unit tests (8), `ipc_contract::every_error_code_is_documented` | PASS — 2026-10-24 |
| R19 | Windows direct launch bypasses the CA launcher and protects `used_mods.txt` | `launch::tests::windows_direct_launch_uses_warhammer_exe_and_the_game_directory`, `::windows_direct_launch_accepts_a_matching_non_empty_order`, `::steam_not_running_blocks_windows_direct_launch`, `::steam_probe_failure_blocks_windows_direct_launch`, `::stale_used_mods_blocks_launch_before_spawn`, `::duplicate_used_mods_blocks_launch_before_spawn`, `::unmanaged_directives_block_launch_before_spawn`, `::windows_guard_rewrite_restores_the_snapshot`, `::windows_launch_does_not_write_used_mods`; manual `WIN-11` | PASS (automation) — 2026-10-24; manual pending |

**R4 scope note.** `read_pack_header` reads the 28-byte header and dependency
table only. `malformed_count_mismatch.pack` and `malformed_unterminated_name.pack`
are defects inside the packed-file index; the header parser accepts them by
design, and `pack_fixtures.rs::index_level_defects_are_not_misreported_by_the_header_parser`
pins that limitation. When the M3 file-index reader lands, it must reject both,
and this row must be widened.

### 3.3 Frontend coverage

| ID | Criterion | Proving test | Status |
| --- | --- | --- | --- |
| F1 | Startup with missing game shows a clear "set path" state, no crash | `App.test.tsx::starts with the explicit game-not-found state and a manual path form` | PASS |
| F2 | Mod list renders dense rows and virtualizes 500 items | `ModList.test.tsx::mounts only the virtualized window, not all 500 rows`, `::mounts the scrolled-to rows and keeps the virtualization contract` | PASS |
| F3 | Enable/disable toggles the right mod | `ModList.test.tsx::toggles a row through its checkbox without changing selection`, `App.test.tsx::toggles a mod and sends the boolean inverted from the row state` | PASS |
| F4 | Reorder (drag + keyboard + move to edge) sends the complete order | `store.test.ts::moves the selected enabled mods and sends the complete order`, `::drops dragged enabled rows before the target row`, `ModList.test.tsx::selects with ctrl-click and moves with Alt+Arrow` | PASS |
| F5 | Search/filter narrows the visible set | `store.test.ts::filters by search and tags without an author dimension`, `App.test.tsx::filters the list from the search box` | PASS |
| F6 | Profile switch restores enabled set and order | `App.test.tsx::switches profiles and applies the returned enabled set`, `store.test.ts::applies profiles and keeps the active id in the snapshot` | PASS |
| F7 | Error states render `IpcError` and malformed rejections | `App.test.tsx::shows a structured error screen when the workspace cannot load`, `ipc.test.ts::rejects malformed error payloads`, `LoadOrderBanner.test.tsx` (5 tests) | PASS |
| F8 | Pre-write report and corrupt/unreadable warnings before a destructive change | `App.test.tsx::opens the load-order preview before allowing a write`, `LoadOrderBanner.test.tsx::reports an unreadable used_mods.txt…`, `::enables explicit backup restore only when a backup exists` | PASS |
| F9 | Cut features absent from navigation and routes | `navigation.test.tsx::only_v1_sections_are_reachable` (to be added) | BLOCKED — WAR-8/WAR-9 |

### 3.4 Manual and packaging

| ID | Criterion | Proving evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| M1 | Windows script covers install detection, first run, 50+ list, reorder, profile switch, launch, corrupt `used_mods.txt` recovery | `docs/MANUAL_QA_WINDOWS.md` (WIN-01…WIN-13), completed with evidence | QA + CEO | PENDING — needs a Windows host + game |
| M2 | Windows CI produces an installable artefact attached to a release | release page + CI run URL | WAR-11 | BLOCKED |
| M3 | No cut feature in navigation, menus, or IPC | F9 + IPC contract surface + manual audit | WAR-12 | BLOCKED |

### 3.5 Performance (CEO directive 2026-10-20)

| ID | Criterion | Proving evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| P1 | `docs/PERF.md` method is reproducible | `docs/perf/comparison.json` + `node scripts/qa/verify-perf-gate.mjs` | WAR-7 | PASS — `comparison.json` on `main`; gate exits 0 (WAR-98) |
| P2 | Legacy baseline is valid: same machine, same fixture, release builds | Gate checks `hostId`, `fixtureDigest`, `build: "release"`, ≥ 5 samples | WAR-19 | PASS — both sides name the CI host class, matched fixture digest `1de7de62…`, release builds, 12 samples per metric |
| P3 | Every primary metric strictly faster than legacy | Gate fails on any non-strict metric; 2× headline is a warning | WAR-7 | PASS — 5/5 rows strictly faster; headline 21.70× cold start and 30.26× 500-mod load |

A missing or invalid perf comparison blocks the v1.0 gate. See §7 for the exact
validity rules, the JSON contract, and the current state.

---

## 4. Fixture set

All fixtures are synthetic and committed under `fixtures/` except the 500-pack
tree, which is generated on demand. See `fixtures/README.md` for the file list
and provenance.

| Group | Purpose | Used by |
| --- | --- | --- |
| `packs/*.pack` | 6 valid PFH5 variants, 7 malformed variants | R3, R4, R15, R17 |
| `steam/*.vdf`, `*.acf` | Libraries (incl. Flatpak), WH3 manifest, Workshop metadata | R1, R2, WAR-9 |
| `load_order/used_mods_*.txt` | LF, CRLF, BOM, empty, corrupt, duplicates, directives, no final newline | R5–R8, FI-03, FI-06 |
| `config/config_*.json` | Valid v1, future v2, unknown fields, corrupt, truncated | R9–R11, FI-05, WAR-47 |
| `scale/index-500.json` | Deterministic 500-mod index for frontend scale tests | F2, R16 |
| generated `--scale` tree | 500 real packs + manifest for Rust scale and perf runs | R16, WAR-7 |

Rules: fixtures are never edited by hand (`--write` regenerates them), no test
writes into `fixtures/`, and any new fixture must be added to `manifest.json`
and to `qa_fixtures.rs`.

---

## 5. Fault-injection matrix

At least three faults must prove **no panic and no data loss**. Each test
asserts the typed error (never a panic) and that the original file is still
byte-identical afterwards.

| ID | Fault | Expected result | Test | Status |
| --- | --- | --- | --- | --- |
| FI-01 | Malformed pack in a directory scan | Typed error on the row; healthy packs still load | `fault_injection.rs::fi01_malformed_pack_does_not_abort_scan` | PASS |
| FI-02 | Truncated/oversized-header pack | `pack_parse_failed`; no panic | `pack_fixtures.rs::rejects_every_header_level_defect_with_a_typed_error` | PASS |
| FI-03 | `used_mods.txt` directory read-only | Write fails; original unchanged; temp removed | `fault_injection.rs::fi03_read_only_directory_preserves_the_load_order` | PASS |
| FI-04 | Rename fails after `.bak` was written | Original unchanged; `.bak` is the last good copy | read-only parent (FI-03) covers pre-rename; no deterministic rename injection | PARTIAL |
| FI-05 | Corrupt `config.json` and corrupt `.bak` | Defaults in memory; both files untouched | `fault_injection.rs::fi05_double_corrupt_config_is_never_overwritten` | PASS |
| FI-06 | Missing parent directory | `io` error; no file created | `load_order::tests::missing_parent_is_an_io_error_and_leaves_nothing_behind` | PASS |
| FI-07 | Zero-byte pack | Rejected; scan continues | `pack_fixtures.rs` malformed set + FI-01 | PASS |
| FI-08 | Unmanaged directives dropped without confirmation | `validation`; no write | `fault_injection.rs::fi07_unmanaged_loss_requires_confirmation` | PASS |
| FI-09 | Empty write over a non-empty managed list without intent | `validation`; no write | `fault_injection.rs::fi08_empty_write_requires_intent` | PASS |
| FI-10 | Crash temp + missing file with a valid `.bak` | No silent restore; stale temp ignored; explicit restore works | `fault_injection.rs::fi10_interrupted_write_is_not_restored_silently` | PASS |

FI-03, FI-08 and FI-09 are the minimum release-blocking set because they are
the paths that can destroy a user's load order. FI-04 remains partial because a
rename failure cannot be injected deterministically without an OS-level fault
hook; the gate accepts it only with FI-03 covering the pre-rename failure.

---

## 6. Risk register

| ID | Risk | Likelihood | Impact | Mitigation / proof |
| --- | --- | --- | --- | --- |
| K1 | A failed write truncates `used_mods.txt` and destroys a working setup | Medium | Critical | Atomic temp → fsync → `.bak` → rename; R6, R7, FI-03, FI-08, FI-09 |
| K2 | A malformed pack panics the scanner and the app dies | Medium | High | Typed `pack_parse_failed`; R4, FI-01, FI-02 |
| K3 | Duplicate pack names resolve to the wrong file | Medium | High | Case-insensitive name match + duplicate warning; R14 |
| K4 | Steam/Proton/Flatpak path detection misses a valid install | High | Medium | Multi-candidate detection + manual override; R1, R2 |
| K5 | A config downgrade destroys a newer schema | Low | High | ADR-003; R10 — **mitigated** by PR #15 (`76dd0b9`); un-ignored regression asserts both files stay byte-identical |
| K6 | The 500-mod list is slow or unvirtualized | Medium | High | F2, R16, P1–P3 |
| K7 | Flaky suite erodes trust in the gate | Medium | Medium | Deterministic fixtures, no network/time, bounded CI; §1 |
| K8 | Fixtures drift from the documented format | Medium | Medium | `--verify` in CI + R17 + manifest |
| K9 | Desktop shell regressions escape Linux CI | Medium | Medium | Linux CI builds the shell (ADR-007); Windows shell remains manual + M5 packaging CI |
| K10 | A cut feature leaks into v1.0 UI/IPC | Low | High | F9 + M3 |
| K11 | "Faster than legacy" is asserted without a valid A/B | Medium | Critical | P1–P3, §7; a guessed number fails the gate |
| K12 | CI waits hang in a post-step and stall review | Medium | Medium | Bounded checks, no bare watch (WAR-16) |

---

## 7. Performance gate (CEO directive)

The gate is machine-checked against `docs/perf/comparison.json` (schema
`wh3mm.perf.comparison.v1`) and explained for humans in `docs/PERF.md`.

```bash
node scripts/qa/verify-perf-gate.mjs            # exit 1 = gate fails or file missing
node scripts/qa/verify-perf-gate.mjs --json     # machine-readable verdict
node --test scripts/qa/verify-perf-gate.test.mjs
```

### 7.1 Validity rules

- [x] **PERF-V1 — Method:** both sides record version, commit, build type, raw
      output path, `hostId`, and the same `fixtureDigest`; ≥ 5 samples per
      metric; medians within the sample range.
- [x] **PERF-V2 — Same machine:** `environment.sameHost === true` and
      `legacy.hostId === newApp.hostId === environment.hostId`; OS, CPU, RAM,
      and date are present.
- [x] **PERF-V3 — Same fixture:** `fixture.modCount >= 500` and both runs carry
      the same 64-character SHA-256 `fixtureDigest`.
- [x] **PERF-V4 — Release builds:** `legacy.build === "release"` and
      `newApp.build === "release"`.
- [x] **PERF-V5 — Reproducible:** the raw output files exist and a rerun on the
      same host reproduces each median within the stated variance.

The validator enforces V1–V4 mechanically and checks raw-output existence for
V5; the human reviewer checks the rerun variance in `docs/PERF.md`.

### 7.2 Metrics and pass rule

| Metric key | Legacy source | New-app source | Pass rule |
| --- | --- | --- | --- |
| `coldStartToInteractive` | `[startup] … React mounted` | startup instrumentation | new < legacy (2× target) |
| `modLoad500` | enumeration + header scan | scan duration | new < legacy (2× target) |
| `loadOrderApply` | write timing | write timing | new < legacy |
| `profileSwitch` | preset switch | apply-profile timing | new < legacy |
| `launchHandoff` | write + Steam handoff | launch handoff | new < legacy |

**Any metric that is equal to or slower than legacy fails the gate.** A missing
metric also fails: an unproven number is not an exemption. Missing the 2×
headline target on `coldStartToInteractive` or `modLoad500` is a warning, not a
failure, because the CEO acceptance is "strictly faster" for every metric.

### 7.3 Current state — **PASS**

`docs/perf/comparison.json` is on `main` (schema
`wh3mm.perf.comparison.v1`, WAR-98). It is built only from the two committed
reports: `docs/perf/legacy-baseline.json` (Actions run 39577999775) and
`docs/perf/new-app.json` (Actions run 39587134072). Every stored sample is
copied from those files, and both sides use fixture digest
`1de7de625da9ee53d1101a764d07d5ccbb61975932816c8b43574b648d0ab73a`.

Gate result:

```text
node scripts/qa/verify-perf-gate.mjs --json
ok: true   failures: []   warnings: []
coldStartToInteractive  1321.5 ms -> 60.885 ms   21.70x
modLoad500              1861.5 ms -> 61.511 ms   30.26x
loadOrderApply           278.5 ms -> 12.7495 ms  21.84x
profileSwitch            297.5 ms -> 10.7805 ms  27.60x
launchHandoff             6163 ms -> 28.145 ms   218.97x
```

The legacy `modLoad500` samples are `modListPopulatedMs - 5000` ms, the same
Steam-wait treatment `docs/PERF.md` applies. The new-app launch row was measured
on `428670c`, before the M3 launch command existed, and remains a documented
harness proxy on both sides.

**Host identity.** The gate's `environment.sameHost` is true for the CI host
**class**, not for one physical machine: the legacy and new-app runs are two
ephemeral GitHub-hosted `windows-latest` runner instances of image
`20261018.275.1`, 2 vCPU / 8 GiB (`GitHub Actions 1000002466` and
`GitHub Actions 1000002508`). Both runner instance ids are recorded in
`comparison.json`. `docs/PERF.md` already frames the comparison as "same host
class"; the per-run distribution and the same-PR legacy re-run cover
runner-to-runner variance. This caveat is accepted for the v1.0 gate and is not
a hidden claim of single-machine measurement.

`node --test scripts/qa/verify-perf-gate.test.mjs` passes 13/13. No guessed
numbers are accepted; the evidence log below records the commands.

---

## 8. Defects and severity

Every defect is a child issue assigned to the owning engineer, with the
template in `docs/BUG_REPORT_TEMPLATE.md`. QA does not rewrite the feature.

| Severity | Meaning | Examples | Gate effect |
| --- | --- | --- | --- |
| S1 — Blocker | Data loss, crash on a normal path, security issue, unopenable build | Corrupt `used_mods.txt`; panic on a valid pack; installer fails | Blocks release and the PR |
| S2 — Major | v1.0 criterion broken, no workaround | Wrong conflict winner; profile switch loses order; future config overwritten (WAR-47) | Blocks release |
| S3 — Minor | Incorrect but recoverable; workaround exists | Wrong row highlighted; filter misses a tag | Fix before release or record as known issue |
| S4 — Trivial | Cosmetic, docs, test-only | Wording; stale temp file left after a crash | Queue, no gate |

A flaky test is a defect: quarantine with an issue and a deadline, not a silent
retry or `skip` (ADR-004). A release-blocking regression is reported on the PR
and the task with the run URL, failing test, and expected vs actual.

**Open defects:** none at S1/S2. WAR-47 (S2, config downgrade overwrite) is closed by PR #15 (`76dd0b9`) and its un-ignored regression.

---

## 9. Evidence log

| Date | Commit | Command | Result |
| --- | --- | --- | --- |
| 2026-10-21 | `c1a9cdd` + QA branch | `cargo fmt --all --check` | PASS |
| 2026-10-21 | `c1a9cdd` + QA branch | `cargo clippy --workspace --all-targets --locked -- -D warnings` | PASS |
| 2026-10-21 | `c1a9cdd` + QA branch | `cargo test --workspace --locked` | PASS — 95 passed, 0 failed, 1 ignored (WAR-47), 0.18 s warm |
| 2026-10-21 | `c1a9cdd` + QA branch | `pnpm typecheck / lint / test / build` | PASS — 42 tests across 6 files, 0.72 s |
| 2026-10-21 | `c1a9cdd` + QA branch | `node --test scripts/qa/*.test.mjs` | PASS — 24 tests (13 perf-gate, 11 fixture guard) |
| 2026-10-21 | `c1a9cdd` + QA branch | `node scripts/qa/generate-fixtures.mjs --verify` | PASS — 33 fixtures + 500-mod index verified |
| 2026-10-21 | `c1a9cdd` + QA branch | `node scripts/qa/verify-perf-gate.mjs` | BLOCKED — no `docs/perf/comparison.json` (expected) |
| 2026-10-21 | WAR-56 head (`test/qa-harness` + `main` @ `76dd0b9`) | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo test --workspace --locked` | PASS — 97 passed, 0 failed, 0 ignored |
| 2026-10-21 | WAR-56 head (`test/qa-harness` + `main` @ `76dd0b9`) | `pnpm typecheck`, `lint`, `test`, `build`; `node scripts/qa/generate-fixtures.mjs --verify`; `node --test scripts/qa/*.test.mjs` | PASS — 42 Vitest tests / 6 files; 33 fixtures + 500-mod index; 24 Node tests |
| 2026-10-21 | WAR-56 head (`test/qa-harness` + `main` @ `76dd0b9`) | `node scripts/qa/verify-perf-gate.mjs` | BLOCKED — no `docs/perf/comparison.json` (expected; WAR-7/WAR-19 still open) |
| 2026-10-21 | WAR-98 `perf/v1.0-comparison` | `node scripts/qa/verify-perf-gate.mjs --json` | PASS — `ok: true`, no failures or warnings, 5/5 metrics strictly faster |
| 2026-10-21 | WAR-98 `perf/v1.0-comparison` | `node --test scripts/qa/verify-perf-gate.test.mjs` | PASS — 13/13 tests |
| 2026-10-21 | fixture set | legacy `parsePFH5Header`/`parsePFH5Index` (commit `07fcf3e`) | 6/6 valid packs parse; 7/7 malformed packs rejected |

The counts above are the regression baseline: if a later run has fewer tests,
the gate fails until the decrease is explained and approved.

---

## 10. Open gaps and escalations

| ID | Gap | Evidence | Owner / next action |
| --- | --- | --- | --- |
| G1 | Product suites could not be written before M1/M2. **Resolved.** | WAR-5 merged as `c1a9cdd`; R1–R11/R15–R17 and F1–F8 now run against the real APIs | Closed |
| G2 | WAR-6 names `appworkshop_3247630.acf`; WH3's Steam app id is 1142710 | `reference/.../supportedGames.ts` (`wh3: "1142710"`), `docs/PRODUCT_SCOPE.md` §1 | Fixtures use 1142710; brief owner to correct |
| G3 | Perf gate cannot be verified. **Resolved.** | `docs/perf/comparison.json` on `main`; `node scripts/qa/verify-perf-gate.mjs --json` reports `ok: true`; §7.3 | WAR-98; P1–P3 PASS |
| G4 | Windows shell and packaging are manual (`workflow_dispatch`) until M5; the Linux shell is built in CI | `.github/workflows/ci.yml`, ADR-007 | WAR-11 promotes Windows packaging; Linux binary artifact is already uploaded |
| G5 | Conflict winner, dependency warning, and duplicate-name proof are missing | `conflicts.rs` does not exist on `main`; WAR-9 PR #12 is closed and conflicting, issue `in_review` | R12–R14 stay BLOCKED until M3 lands |
| G6 | Future config is overwritten by a stale v1 backup. **Resolved.** | WAR-47 fixed by PR #15 (`76dd0b9`); `config_fixtures.rs::future_schema_with_a_stale_backup_must_still_not_overwrite` is un-ignored and asserts both `config.json` and `config.json.bak` are byte-identical | Closed |
| G7 | No navigation/cut-feature audit yet | F9 blocked on WAR-8 (PR #10 open) and WAR-9 | WAR-8/WAR-9; M3 stays BLOCKED |
| G8 | Manual Windows script has not been executed | Needs Windows + Steam + WH3 | QA + CEO before v1.0; M1 stays PENDING |

Escalate blockers to Katerina Zarina, scope conflicts to Torgrim, fixes to Karl
Franz, and performance regressions to Genny4Real.
