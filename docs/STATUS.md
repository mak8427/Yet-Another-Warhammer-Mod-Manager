# Project status

- Owner: Katerina Zarina
- Updated: 2026-10-20
- Product contract: `docs/PRODUCT_SCOPE.md`
- Architecture: `docs/adr/001-architecture.md`

This is the single progress report for the rebuild. A milestone is done only
when its acceptance checks are recorded here with command evidence.

## Milestones

| Milestone | Owner | Scope | State |
|---|---|---|---|
| M0 | Katerina | Repo layout, Rust workspace, Tauri shell, TS/Vite shell, typed IPC, ADRs, CI | Implemented; PR open for QA and tech-lead review |
| M1 | Karl | Steam/WH3 detection, pack parser, mod index, fixtures | Not started |
| M2 | Karl | Mod list, load order, tags, profiles | Not started |
| M3 | Karl | Conflicts, Workshop, launch | Not started |
| M4 | Katerina + Karl | TW:WH3 visual system, density, keyboard map, states | Not started |
| M5 | Baltasar + Genny4Real | E2E, performance budgets, Windows installer, release | Not started |

## M0 evidence (WAR-4)

- Branch: `feat/m0-bootstrap`, cut from `main` at `8d877f9`.
- Scaffold commit: `8d877f9` (`feat(m0): bootstrap Rust workspace, Tauri shell,
  typed IPC, ADRs, CI`).
- Pull request: see the WAR-4 task thread and the PR titled
  "M0: bootstrap Rust workspace, Tauri shell, typed IPC, ADRs, CI".
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
| `cargo clippy --workspace --all-targets -- -D warnings` | pass |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | pass, 6 tests |

## Risks and open items

- The Windows Tauri shell is not compiled by the Linux gates. Until M5
  packaging, `.github/workflows/ci.yml`'s manual Windows job is the only proof
  that `tauri-build`, command registration, and `generate_context!` compile.
- `main` has no GitHub branch protection; the branch/PR policy is enforced by
  review. Enabling protection is an owner action for Torgrim.
- The M0 scaffold commit reached `main` before the CEO's no-direct-push
  directive. History was not rewritten; remaining M0 closure work is on
  `feat/m0-bootstrap`.
- `main` must stay green. A red merge is reverted immediately and gets a fix
  task.

## Next

1. Baltasar Gelt: QA review of the M0 PR and the scaffold on `main`.
2. Katerina Zarina: architecture review, squash merge, delete the branch, close
   WAR-4 with the PR link.
3. Start M1 in WAR-3 with `wh3mm-core::paths` and `wh3mm-core::pack` from
   ADR-001.
