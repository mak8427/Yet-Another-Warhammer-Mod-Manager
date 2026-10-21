# QA Plan — WH3 Mod Manager v1.0

- Owner: Baltasar Gelt (QA)
- Status: **active — gate not yet complete** (see §10)
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
# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

# Fixtures (also runs in CI before the suites)
node scripts/qa/generate-fixtures.mjs --verify

# Frontend
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

A release candidate passes only when **all** of the following are true:

1. Every command above exits 0 on a clean checkout.
2. The counts in §9 are at or above the recorded baseline; no test is silently
   skipped. `#[ignore]` requires a comment and an owner (ADR-004).
3. Every row in §3 is `PASS` with evidence. `PENDING` or `BLOCKED` rows block
   the release.
4. The performance gate in §7 is `PASS`.
5. The Windows manual script in `docs/MANUAL_QA_WINDOWS.md` is completed and
   signed, and the NSIS/MSI artefact exists on the release.
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
| Frontend component | `frontend/src/**/*.test.tsx` | Vitest + Testing Library + jsdom | Rendering, interaction contracts, error states | < 10 s |
| Manual Windows | `docs/MANUAL_QA_WINDOWS.md` | Human | Install detection, first run, recovery, launch | per script |
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
| A1 | `cargo fmt --check` passes | CI `Rust format` step | PENDING — no suite run since M0 |
| A2 | `cargo clippy -- -D warnings` passes | CI `Rust clippy` step | PENDING |
| A3 | `cargo test` passes for the workspace | CI `Rust tests` step | PASS — 12 tests, 2026-10-21 (§9) |
| A4 | `pnpm typecheck`, `lint`, `test`, `build` pass | CI frontend steps | PASS — 6 tests, 2026-10-21 (§9) |

### 3.2 Rust integration coverage

Every row is required by `docs/PRODUCT_SCOPE.md` ("Rust integration tests
cover…"). The test file and test name are the contract; a differently named
test is acceptable only if it covers the same assertion and §3 is updated.

| ID | Criterion | Proving test (required) | Owner | Status |
| --- | --- | --- | --- | --- |
| R1 | Path detection from fixture VDF/registry data | `tests/detection.rs::detects_wh3_from_libraryfolders` and `::missing_library_path_is_skipped` | WAR-5 | BLOCKED |
| R2 | Manual game-path override wins over auto-detection | `tests/detection.rs::manual_override_validated_and_reportable` | WAR-5 | BLOCKED |
| R3 | Pack parsing, valid headers incl. dependencies/unicode | `tests/pack_parsing.rs::parses_all_valid_fixtures` | WAR-5 | BLOCKED |
| R4 | Pack parsing, malformed/truncated/oversized headers | `tests/pack_parsing.rs::rejects_every_malformed_fixture_without_panic` | WAR-5 | BLOCKED |
| R5 | Load-order read: BOM/CRLF/duplicates/unknown directives | `tests/load_order.rs::reads_all_used_mods_variants` | WAR-5 | BLOCKED |
| R6 | Load-order atomic write leaves original intact on failure | `tests/load_order.rs::failed_replace_preserves_original` | WAR-5 | BLOCKED |
| R7 | `.bak` created on successful write; recovery is explicit, never silent | `tests/load_order.rs::write_creates_bak_and_recovery_requires_intent` | WAR-5 | BLOCKED |
| R8 | Byte-stable round-trip (read → write → read) | `tests/load_order.rs::round_trip_is_byte_stable` | WAR-5 | BLOCKED |
| R9 | Profile round-trip: create/save/rename/duplicate/delete | `tests/profiles.rs::profile_lifecycle_round_trip` | WAR-5 | BLOCKED |
| R10 | Config corrupt + valid `.bak` recovery; future schema refused | `tests/profiles.rs::corrupt_config_recovers_from_bak` | WAR-5 | BLOCKED |
| R11 | Deleting the last profile refused; active-profile fallback | `tests/profiles.rs::cannot_delete_last_profile` | WAR-5 | BLOCKED |
| R12 | Conflict winner calculation (last line wins) | `tests/conflicts.rs::last_enabled_pack_wins_each_path` | WAR-9 | BLOCKED |
| R13 | Missing dependency warning | `tests/conflicts.rs::reports_missing_dependencies` | WAR-9 | BLOCKED |
| R14 | Duplicate pack names warned, IDs stay distinct | `tests/conflicts.rs::reports_duplicate_pack_names` | WAR-9 | BLOCKED |
| R15 | Fault injection: ≥ 3 deliberate faults, no panic, no data loss | `tests/fault_injection.rs` (FI-01…FI-10, §5) | WAR-6 | BLOCKED |
| R16 | 500-mod index: scan, order, persist within budget | `tests/scale.rs::handles_500_pack_fixture` | WAR-5 | BLOCKED |
| R17 | Fixture bytes match the documented variants | `tests/qa_fixtures.rs` (7 tests) | WAR-6 | PASS — 2026-10-21 (§9) |

### 3.3 Frontend coverage

| ID | Criterion | Proving test (required) | Owner | Status |
| --- | --- | --- | --- | --- |
| F1 | Startup with missing game shows a clear "set path" state, no crash | `App.test.tsx::startup_with_missing_game_offers_path_override` | WAR-5 | BLOCKED (basic error state exists) |
| F2 | Mod list renders dense rows and virtualizes | `modList.test.tsx::renders_and_virtualizes_500_mods` | WAR-5 | BLOCKED |
| F3 | Enable/disable toggles the right mod | `modList.test.tsx::toggles_enabled_state_for_clicked_row` | WAR-5 | BLOCKED |
| F4 | Reorder (drag + keyboard + top/bottom) sends complete order | `modList.test.tsx::reorder_sends_complete_ordered_ids` | WAR-5 | BLOCKED |
| F5 | Search/filter narrows the visible set | `modList.test.tsx::search_and_tag_filter_narrow_rows` | WAR-5 | BLOCKED |
| F6 | Profile switch restores enabled set and order | `profiles.test.tsx::applying_profile_restores_order` | WAR-5 | BLOCKED |
| F7 | Error states render `IpcError` and malformed rejections | `App.test.tsx::shows_structured_backend_errors`, `ipc.test.ts::rejects_malformed_error_payloads` | WAR-5 | PASS — 2026-10-21 |
| F8 | Pre-write report warns before destructive change | `loadOrder.test.tsx::shows_unmanaged_loss_warning_before_write` | WAR-5 | BLOCKED |
| F9 | Cut features absent from navigation and routes | `navigation.test.tsx::only_v1_sections_are_reachable` | WAR-8/WAR-9 | BLOCKED |

### 3.4 Manual and packaging

| ID | Criterion | Proving evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| M1 | Windows QA script covers install detection, first run, 50+ list, reorder, profile switch, launch, corrupt `used_mods.txt` recovery | `docs/MANUAL_QA_WINDOWS.md`, completed with evidence | QA + CEO | PENDING |
| M2 | Windows CI produces an installable artefact attached to a release | release page + CI run URL | WAR-11 | BLOCKED |
| M3 | No cut feature in navigation, menus, or IPC | F9 + `cargo test` contract surface + manual audit | WAR-12 | BLOCKED |

### 3.5 Performance (CEO directive 2026-10-20)

| ID | Criterion | Proving evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| P1 | `docs/PERF.md` method is reproducible | §7 checklist; script exit 0 + fresh output | WAR-7 | BLOCKED |
| P2 | Legacy baseline is valid: same machine, same fixture, release builds | §7 checklist; `docs/PERF.md` environment table | WAR-19 | BLOCKED (host decision open, PR #4) |
| P3 | Every primary metric strictly faster than legacy | §7 table, no metric ≤ legacy | WAR-7 | BLOCKED (no new-app A/B yet) |

A missing or invalid perf comparison blocks the v1.0 gate. See §7 for the exact
validity rules and the current state.

---

## 4. Fixture set

All fixtures are synthetic and committed under `fixtures/` except the 500-pack
tree, which is generated on demand. See `fixtures/README.md` for the file list
and provenance.

| Group | Purpose | Used by |
| --- | --- | --- |
| `packs/*.pack` | 6 valid PFH5 variants, 7 malformed variants | R3, R4, R15, R17 |
| `steam/*.vdf`, `*.acf` | Libraries (incl. Flatpak), WH3 manifest, Workshop metadata | R1, R2, WAR-9 |
| `load_order/used_mods_*.txt` | LF, CRLF, BOM, empty, corrupt, duplicates, directives, no final newline | R5–R8, FI-03, FI-04 |
| `config/config_*.json` | Valid v1, future v2, unknown fields, corrupt, truncated | R9–R11, FI-05 |
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

| ID | Fault | Expected result | Required test |
| --- | --- | --- | --- |
| FI-01 | Malformed pack in a directory scan | Skip + warning; other packs still load | `fault_injection.rs::malformed_pack_does_not_abort_scan` |
| FI-02 | Truncated/oversized-header pack | `pack_parse_failed`; no panic | `fault_injection.rs::oversized_header_is_a_typed_error` |
| FI-03 | `used_mods.txt` target is read-only / locked | Write fails; original unchanged; temp removed | `fault_injection.rs::locked_target_preserves_original` |
| FI-04 | Rename fails after `.bak` was written | Original unchanged; `.bak` is the last good copy; no partial file | `fault_injection.rs::rename_failure_is_atomic` |
| FI-05 | Corrupt `config.json` and corrupt `.bak` | Defaults in memory; both files untouched; `config_corrupt` surfaced | `fault_injection.rs::double_corrupt_config_is_not_overwritten` |
| FI-06 | Missing parent directory | `io` error; no file created | `fault_injection.rs::missing_parent_is_a_typed_error` |
| FI-07 | Zero-byte pack | Rejected; scan continues | `fault_injection.rs::empty_pack_is_rejected` |
| FI-08 | Summary drops unmanaged directives without confirmation | `validation`; no write | `fault_injection.rs::unmanaged_loss_requires_confirmation` |
| FI-09 | Write would empty a non-empty managed list without intent | `validation`; no write | `fault_injection.rs::empty_write_requires_intent` |
| FI-10 | Crash after temp write, before rename | On next start the original is intact; stale temp is ignored/cleaned | `fault_injection.rs::interrupted_write_leaves_original_intact` |

FI-03, FI-04, FI-08 and FI-09 are the minimum release-blocking set because they
are the paths that can destroy a user's load order.

---

## 6. Risk register

| ID | Risk | Likelihood | Impact | Mitigation / proof |
| --- | --- | --- | --- | --- |
| K1 | A failed write truncates `used_mods.txt` and destroys a working setup | Medium | Critical | Atomic temp → fsync → `.bak` → rename; R6, R7, FI-03, FI-04 |
| K2 | A malformed pack panics the scanner and the app dies | Medium | High | Typed `pack_parse_failed`; R4, FI-01, FI-02 |
| K3 | Duplicate pack names resolve to the wrong file | Medium | High | Case-insensitive name match + duplicate warning; R14 |
| K4 | Steam/Proton/Flatpak path detection misses a valid install | High | Medium | Multi-candidate detection + manual override; R1, R2 |
| K5 | Profile save races with a load-order write | Low | High | One mutex, explicit commands; R9, R10 |
| K6 | The 500-mod list is slow or unvirtualized | Medium | High | F2, R16, P1–P3 |
| K7 | Flaky suite erodes trust in the gate | Medium | Medium | Deterministic fixtures, no network/time, bounded CI; §1 |
| K8 | Fixtures drift from the documented format | Medium | Medium | `--verify` in CI + R17 + manifest |
| K9 | Windows-only shell regressions escape Linux CI | High | Medium | Manual script (M1) + M5 packaging CI |
| K10 | A cut feature leaks into v1.0 UI/IPC | Low | High | F9 + M3 |
| K11 | "Faster than legacy" is asserted without a valid A/B | Medium | Critical | P1–P3, §7; a guessed number fails the gate |
| K12 | CI waits hang in a post-step and stall review | Medium | Medium | Bounded checks, no bare watch (WAR-16) |

---

## 7. Performance gate (CEO directive)

`docs/PERF.md` must contain a **new-app vs legacy** comparison that a reviewer
can reproduce. The gate passes only when all four checks pass.

### 7.1 Validity checklist

- [ ] **PERF-V1 — Method:** `docs/PERF.md` names the exact commands, the fixture
      generator, the fixture digest, the run count (≥ 5 cold runs), and the raw
      output path (JSON/logs, not only screenshots).
- [ ] **PERF-V2 — Same machine:** legacy and new-app numbers come from the same
      physical/VM host class, with CPU, RAM, OS build, storage type, and date
      recorded for both.
- [ ] **PERF-V3 — Same fixture:** both runs use the same 500-mod fixture digest
      (`docs/PERF.md` and `fixture-manifest.json` agree).
- [ ] **PERF-V4 — Release builds:** legacy uses the official release asset; the
      new app uses `--release` (not `cargo run`/debug). Both build types and
      commits are recorded.
- [ ] **PERF-V5 — Reproducible:** rerunning the documented command on the same
      host reproduces each median within the stated variance.

### 7.2 Metrics and pass rule

| Metric | Legacy source | New-app source | Pass rule |
| --- | --- | --- | --- |
| Cold start → interactive mod list | `[startup] … React mounted` | startup instrumentation | new < legacy |
| 500-mod load/parse | enumeration + `pack-headers-cache.bin` | scan duration | new < legacy |
| Load-order apply/persist | write timing | write timing | new < legacy |
| Profile switch | preset switch | apply-profile timing | new < legacy |
| Game launch handoff | write + Steam handoff | launch handoff | new < legacy |

**Any metric that is equal to or slower than legacy fails the gate.** A metric
that is "not yet automated" (as some legacy metrics are today) also fails the
gate: it is unproven, not exempt. Headline target: ≥ 2× faster cold start and
500-mod load.

### 7.3 Current state — **BLOCKED**

`docs/PERF.md` (branch `perf/legacy-baseline`, PR #4) records a valid first-pass
legacy baseline (5 cold runs, release asset 2.29.0, commit `07fcf3e`, fixture
digest `1de7de62…`). It does **not** yet contain new-app numbers, and
load-order/persist, profile switch, and launch handoff are explicitly marked
"not yet automated" for legacy. Therefore PERF-V1/V3/V4 are partially met and
PERF-P3 cannot pass. The Windows host for the final A/B is an open human
decision on WAR-19. No guessed numbers will be accepted.

---

## 8. Defects and severity

Every defect is a child issue assigned to the owning engineer, with the
template in `docs/BUG_REPORT_TEMPLATE.md`. QA does not rewrite the feature.

| Severity | Meaning | Examples | Gate effect |
| --- | --- | --- | --- |
| S1 — Blocker | Data loss, crash on a normal path, security issue, unopenable build | Corrupt `used_mods.txt`; panic on a valid pack; installer fails | Blocks release and the PR |
| S2 — Major | v1.0 criterion broken, no workaround | Wrong conflict winner; profile switch loses order; no "game not found" state | Blocks release |
| S3 — Minor | Incorrect but recoverable; workaround exists | Wrong row highlighted; filter misses a tag | Fix before release or record as known issue |
| S4 — Trivial | Cosmetic, docs, test-only | Wording; missing tooltip | Queue, no gate |

A flaky test is a defect: quarantine with an issue and a deadline, not a silent
retry or `skip` (ADR-004). A release-blocking regression is reported on the PR
and the task with the run URL, failing test, and expected vs actual.

---

## 9. Evidence log

| Date | Commit | Command | Result |
| --- | --- | --- | --- |
| 2026-10-21 | `abceb50` + QA branch | `cargo test --workspace --locked` | PASS — 12 tests (1 app unit, 4 IPC contract, 7 fixture contract), 0 failed, 0 ignored, 0.12 s warm |
| 2026-10-21 | `abceb50` + QA branch | `pnpm test` | PASS — 2 files, 6 tests, 0.75 s |
| 2026-10-21 | `abceb50` + QA branch | `node scripts/qa/generate-fixtures.mjs --verify` | PASS — 33 fixtures, 500-mod index verified |
| 2026-10-21 | fixture set | legacy `parsePFH5Header`/`parsePFH5Index` (commit `07fcf3e`) | 6/6 valid packs parse; 7/7 malformed packs rejected |

The counts above are the regression baseline: if a later run has fewer tests,
the gate fails until the decrease is explained and approved.

---

## 10. Open gaps and escalations

| ID | Gap | Evidence | Owner / next action |
| --- | --- | --- | --- |
| G1 | The product suites in §3.2/§3.3 cannot be written against `main`: no pack parser, detection, load-order, profile, or mod-list code exists yet. WAR-6 was unblocked when WAR-4 closed, but the code under test is WAR-5. | `origin/main` `abceb50` has only `wh3mm-core/src/{error,ipc}.rs`; WAR-5 is `in_progress` with no branch/PR | WAR-6 blocked on WAR-5; QA writes the product tests as soon as the M1/M2 APIs land |
| G2 | WAR-6 names `appworkshop_3247630.acf`; WH3's Steam app id is 1142710 | `reference/WH3-Mod-Manager/src/supportedGames.ts` (`wh3: "1142710"`), `docs/PRODUCT_SCOPE.md` §1 | Fixtures use 1142710; task owner to correct the brief |
| G3 | `docs/PERF.md` has no new-app A/B and three legacy metrics are not automated | §7.3; PR #4; WAR-19 human host decision | WAR-7/WAR-19; perf gate stays BLOCKED |
| G4 | Windows shell and packaging are manual (`workflow_dispatch`) until M5 | `.github/workflows/ci.yml` | WAR-11 promotes them; M1/M2 stay manual |
| G5 | CI green is not yet demonstrated for any post-M0 branch | run history | QA re-checks every PR; WAR-16 tracks the hanging Windows job |

Escalate blockers to Katerina Zarina, scope conflicts to Torgrim, fixes to Karl
Franz, and performance regressions to Genny4Real.
