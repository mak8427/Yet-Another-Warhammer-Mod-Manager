# Project status

- Owner: Katerina Zarina
- Updated: 2026-10-21
- Product contract: `docs/PRODUCT_SCOPE.md`
- Architecture: `docs/adr/001-architecture.md`

This is the single progress report for the rebuild. A milestone is done only
when its acceptance checks are recorded here with command evidence.

## Milestones

| Milestone | Owner | Scope | State |
|---|---|---|---|
| M0 | Katerina | Repo layout, Rust workspace, Tauri shell, TS/Vite shell, typed IPC, ADRs, CI | Done; merged as `abceb50` (PR #1) |
| M1 | Karl | Steam/WH3 detection, pack parser, mod index, fixtures | Implemented; PR #6 open for QA and tech-lead review |
| M2 | Karl | Mod list, load order, tags, profiles | Implemented; PR #6 open for QA and tech-lead review |
| M3 | Karl | Conflicts, Workshop, launch | Implemented; PR #12 open for QA and tech-lead review |
| M4 | Katerina + Karl | TW:WH3 visual system, density, keyboard map, states | Not started |
| M5 | Baltasar + Genny4Real | E2E, performance budgets, Windows installer, release | Not started |

## M0 evidence (WAR-4)

- Branch: `feat/m0-bootstrap`, cut from `main` at `8d877f9`.
- Scaffold commit: `8d877f9` (`feat(m0): bootstrap Rust workspace, Tauri shell,
  typed IPC, ADRs, CI`).
- Pull request: [#1](https://github.com/mak8427/Warhammer_mod_manager/pull/1)
  ("M0: bootstrap Rust workspace, Tauri shell, typed IPC, ADRs, CI").
- ADRs: `docs/adr/001-architecture.md` (layout, crate boundaries, legacy UI
  reuse/drop map), `002-ipc-contract.md` (payloads, error envelope),
  `003-data-model.md` (`used_mods.txt`, config, profiles, tags),
  `004-testing-strategy.md`.
- CI: `.github/workflows/ci.yml`. Linux gates are required on every PR; the
  Windows Tauri shell build is `workflow_dispatch` until packaging lands in M5.

### Linux verification

Fresh clone of `feat/m0-bootstrap` at `8d877f9`, 2026-10-20:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `cargo test --workspace` | pass, 5 tests |
| `pnpm build` | pass |
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | pass, 6 tests |

GitHub Actions [PR run #39445715098](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39445715098):
`Linux quality gates` pass; Windows job skipped by design on pull requests.

### Windows verification

Manual [CI run #39445706876](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39445706876)
on `feat/m0-bootstrap` (attempt 2): Linux and Windows jobs pass. The Windows
job runs `pnpm build`, `cargo test --workspace --locked`, and
`cargo build -p wh3mm-app --release`; the `Build Tauri shell` step compiles
`tauri-build`, `generate_context!`, and the `app_info` handler. `8d877f9` was
missing the `icons/icon.ico` that `tauri-build` requires; `2070b7f` fixes it.

## M1/M2 evidence (WAR-5)

- Branch: `feat/m1-m2-core`, cut from `main` at `abceb50`.
- Pull request: [#6](https://github.com/mak8427/Warhammer_mod_manager/pull/6)
  ("M1+M2: WH3 detection, pack parsing, mod list, load order, profiles").
- Contract/ordering decisions: `docs/adr/005-m1-m2-implementation.md`; ADR-002
  and ADR-003 carry the implemented command/persistence details.
- Rust coverage: VDF and path discovery fixtures (two libraries + one missing),
  valid/malformed/truncated PFH5 headers, unicode dependencies, duplicate pack
  names, Workshop thumbnails, `used_mods.txt` BOM/CRLF/duplicates/unmanaged
  directives, atomic write + `.bak`, corrupt-file refusal and restore,
  profile/tag/UI-preference round-trips, no-game startup, and a 500-mod
  toggle/reorder/save/write flow.
- Frontend coverage: typed IPC argument mapping and error normalization, store
  boot/no-game/toggle/reorder/profile/preview/write/filter flows, virtualized
  500-row mount contract, keyboard reorder, and the load-order confirmation
  dialog.
- Instrumentation: startup, detection, pack scan, and mod-list/load-order read
  durations are logged as `wh3mm: timing …` and returned in
  `ModListSnapshot.timings` for WAR-7.

### Verification (2026-10-21, Linux)

| Command | Result |
|---|---|
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass |
| `cargo test --workspace --locked` | pass, 63 tests |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | pass, 37 tests |
| `pnpm build` | pass |

Windows shell compile remains covered by the manual `workflow_dispatch` job
until M5 packaging.

## M3 evidence (WAR-9)

- Branch: `feat/m3-conflicts-workshop-launch`, cut from `feat/m1-m2-core` at
  `6998a15` (PR #6 head), per the CEO ruling in WAR-35.
- Pull request: [#12](https://github.com/mak8427/Warhammer_mod_manager/pull/12)
  ("M3: conflict analysis, Workshop integration, and game launch").
- New modules: `crates/wh3mm-core/src/conflicts.rs`, `workshop.rs`, `launch.rs`;
  new screens under `frontend/src/components/{conflicts,workshop,launch}`.
  M1/M2 edits are additive wiring, documented in ADR-006.
- Contract decisions: ADR-002 M3 command table and ADR-006.
- Rust coverage: PFH5 file-index parsing (including the `0x40` hash bit),
  three-way winner calculation, missing/disabled dependencies, duplicate pack
  names, base-game table shadows, ACF state mapping (installed, update pending,
  subscribed), Steam URL construction, launch command construction, managed
  tweak files, and per-profile launch-option round trip.
- Frontend coverage: conflict report rendering and error state, Workshop
  subscriptions/error state, launch options/error/result, and navigation from
  the section rail.
- Manual demo: `docs/M3_MANUAL_QA.md`; fixture generator:
  `docs/fixtures/make_m3_conflicts.py`.

### Verification (2026-10-21, Linux)

| Command | Result |
|---|---|
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass |
| `cargo test --workspace --locked` | pass, 80 tests |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | pass, 40 tests |
| `pnpm build` | pass |

## Risks and open items

- The Windows Tauri shell is not compiled by the Linux gates. It is verified by
  the manual `workflow_dispatch` job, not by a required PR check, until M5
  packaging makes it mandatory.
- `main` has no GitHub branch protection; the branch/PR policy is enforced by
  review. Enabling protection is an owner action for Torgrim.
- The M0 scaffold commit reached `main` before the CEO's no-direct-push
  directive. History was not rewritten; remaining M0 closure work is on
  `feat/m0-bootstrap`.
- `main` must stay green. A red merge is reverted immediately and gets a fix
  task.

## Next

1. Baltasar Gelt: QA review of PR #6, including the no-game and corrupt-file
   recovery paths.
2. Katerina Zarina: design/contract review of ADR-005 and the command surface.
3. Genny4Real: use `ModListSnapshot.timings` and the `wh3mm: timing` log lines
   as the new-app baseline for WAR-7.
4. Baltasar Gelt and Katerina Zarina: review M3 at PR #12; the Windows manual QA
   script in `docs/M3_MANUAL_QA.md` still needs a real-install run.
