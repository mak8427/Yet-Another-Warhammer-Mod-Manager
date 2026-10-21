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
| M0 | Katerina | Repo layout, Rust workspace, Tauri shell, TS/Vite shell, typed IPC, ADRs, CI | Done, merged as `abceb50` (PR #1); follow-ups in WAR-20 |
| M1 | Karl | Steam/WH3 detection, pack parser, mod index, fixtures | Not started |
| M2 | Karl | Mod list, load order, tags, profiles | Not started |
| M3 | Karl | Conflicts, Workshop, launch | Not started |
| M4 | Katerina + Karl | TW:WH3 visual system, density, keyboard map, states | Not started |
| M5 | Baltasar + Genny4Real | E2E, performance budgets, Windows installer, release | Not started |

## M0 evidence (WAR-4)

- Branch: `feat/m0-bootstrap`, cut from `main` at `8d877f9`.
- Scaffold commit: `8d877f9` (`feat(m0): bootstrap Rust workspace, Tauri shell,
  typed IPC, ADRs, CI`).
- Pull request: [#1](https://github.com/mak8427/Warhammer_mod_manager/pull/1)
  ("M0: bootstrap Rust workspace, Tauri shell, typed IPC, ADRs, CI"), merged
  with squash commit `abceb50` on `main`.
- ADRs: `docs/adr/001-architecture.md` (layout, crate boundaries, legacy UI
  reuse/drop map), `002-ipc-contract.md` (payloads, error envelope, load-order
  preview/write contract), `003-data-model.md` (`used_mods.txt`, config,
  profiles, tags), `004-testing-strategy.md`.
- CI: `.github/workflows/ci.yml`. Linux gates are required on every PR; the
  Windows Tauri shell build is `workflow_dispatch` until packaging lands in M5.

### Independent QA (WAR-17)

Baltasar Gelt reviewed PR #1 from a fresh clone at `8c6ae03` and approved it at
head `27d6edc` after merging `main`. Evidence recorded in WAR-17:

- All Linux gates pass: `cargo fmt`, clippy with `--locked`, `cargo test
  --workspace --locked` (5 tests), `pnpm typecheck`, `pnpm lint`, `pnpm test`
  (6 tests), `pnpm build`.
- Linux CI on the reviewed head:
  [#39450015402](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39450015402)
  passes; the Windows job is skipped by design on pull requests.
- Manual Windows run
  [#39445706876](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39445706876)
  passes both jobs and compiles the Tauri shell (`tauri-build`,
  `generate_context!`, and the `app_info` handler).
- Scope and IPC contract checks pass: `wh3mm-core` has no Tauri/WebView
  dependency, the frontend imports `@tauri-apps/api/core` only in `ipc.ts`, and
  the Rust/TS payload and error shapes match.

The review's findings were non-blocking and are tracked in the follow-up list
below; none changes the M0 verdict.

### Linux verification

Fresh clone of `feat/m0-bootstrap` at `8d877f9`, 2026-10-20:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `cargo test --workspace --locked` | pass, 5 tests |
| `pnpm build` | pass |
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | pass, 6 tests |

QA repeated the same gates independently at `8c6ae03` and at the current head
`27d6edc`; both runs passed.

### Windows verification

Manual [CI run #39445706876](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39445706876)
on `feat/m0-bootstrap` (attempt 2): Linux and Windows jobs pass. The Windows
job runs `pnpm build`, `cargo test --workspace --locked`, and
`cargo build -p wh3mm-app --release --locked`; the `Build Tauri shell` step
compiles `tauri-build`, `generate_context!`, and the `app_info` handler.
`8d877f9` was missing the `icons/icon.ico` that `tauri-build` requires;
`2070b7f` fixes it.

## M0 follow-ups (WAR-20)

The independent QA findings are closed on `chore/m0-followups` (WAR-20):

1. **Pre-write/confirmation contract.** ADR-002 defines `preview_load_order`,
   the `write_load_order` request (`allowEmpty`, `confirmUnmanagedLoss`), and
   `LoadOrderWriteReport.unmanagedDirectives`. It records both `validation`
   refusals and the preview -> show warnings -> confirm -> write flow. ADR-003
   mirrors the contract. Rust and TypeScript contract tests cover both
   refusals.
2. **Command surface.** ADR-002's table now covers tag CRUD, settings
   get/update, profile rename/duplicate/delete, load-order restore, and
   Workshop subscribe/unsubscribe/open with request and response payloads.
3. **Legacy parity claim.** ADR-003 now records the intentional
   case-insensitive dedupe divergence from legacy `parseUsedMods`, with the
   Windows rationale, instead of claiming parity.
4. **Mechanical fixes.** The Windows release build uses `--locked`;
   `crates/wh3mm-app/gen/` is ignored; the unused `serde` dependency is removed
   from `wh3mm-app`; `serde_json` is test-only in `wh3mm-core`; ADR-004 and the
   README use `--locked` consistently; ADR-004 points at `commands.rs`; ADR-002
   and ADR-001 record the `csp: null` M0 exception and the M1/M2 CSP
   requirement.
5. **Status report.** This section records the merged M0 and the follow-up
   list.

## Risks and open items

- The Windows Tauri shell is not compiled by the Linux gates. It is verified by
  the manual `workflow_dispatch` job, not by a required PR check, until M5
  packaging makes it mandatory.
- `main` has no GitHub branch protection; the branch/PR policy is enforced by
  review. Enabling protection is an owner action for Torgrim.
- `tauri.conf.json` keeps `csp: null` for M0. ADR-002 requires a restrictive CSP
  before M1/M2 render external content or Workshop thumbnails.
- ADR-002's planned surface is now larger than the ~15-command manual-mirror
  trigger. Before M2 adds the bulk of the commands, Katerina Zarina must decide
  whether to keep the manual TypeScript mirror or schedule a generated-type
  migration (e.g. `ts-rs`) in a superseding ADR.
- `main` must stay green. A red merge is reverted immediately and gets a fix
  task.

## Next

1. Katerina Zarina: review and approve WAR-20; decide the manual-mirror versus
   generated-types question before M2.
2. Karl Franz: start M1 in WAR-5 with `wh3mm-core::paths` and
   `wh3mm-core::pack` from ADR-001.
3. Baltasar Gelt: keep WAR-6 (QA harness) and WAR-16 (Windows CI hang) moving;
   Genny4Real owns the WAR-7 baseline.
