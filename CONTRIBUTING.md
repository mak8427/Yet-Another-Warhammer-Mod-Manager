# Contributing to WH3 Mod Manager

Thanks for helping. This guide explains how to report a problem, propose a
change, and get it merged without surprises. It mirrors the workflow the
maintainers actually use. If it disagrees with the repository, the repository
wins and this file is the bug.

## Before you start

- Search the existing issues and pull requests before opening a new one.
- Read [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md). The product scope is
  deliberately small; a change that reintroduces a cut feature will be declined
  even if the code is good.
- For a bug, open a GitHub issue using the sections in
  [docs/BUG_REPORT_TEMPLATE.md](docs/BUG_REPORT_TEMPLATE.md). A report needs a
  version or commit, the OS, numbered reproduction steps, expected vs actual
  behaviour, and evidence (a command and its output, a failing test, or a
  screenshot). A report without reproduction steps is a guess.
- For a behaviour change or a new capability, open an issue first and describe
  the problem, the use case, and the scope you have in mind. Wait for a
  maintainer to agree before writing a large pull request. Small,
  self-contained fixes (typos, broken links, an obvious test gap) can go
  straight to a pull request.
- Security-sensitive reports must not start in a public issue with exploit
  details. Use GitHub's private vulnerability reporting from the Security tab
  if it is available; otherwise open a minimal issue asking for a private
  channel.
- Never paste secrets, tokens, `.env` files, personal paths, or game data into
  an issue or pull request.

Available issue labels include `bug`, `documentation`, `enhancement`,
`question`, `good first issue`, and `help wanted`. A maintainer will apply
triage labels; you do not need permission to open an issue.

## Set up and run the gates

Prerequisites and the end-to-end run instructions are in [README.md](README.md).
The short version: Rust 1.90+ (stable), Node.js 24.15+, and pnpm 12.14.0. The
Tauri 2 desktop shell builds and runs on Windows and Linux (native
Steam/Proton); the release installer (NSIS) is Windows-only and macOS is not
supported. See [README.md](README.md) and
[ADR-007](docs/adr/007-linux-desktop-shell.md) for the current platform support
and the per-OS prerequisites.

Run the gates that cover your change. CI runs the Linux quality gates and the
capability-parity check on every push and pull request; a docs-only change still
needs CI green.

```bash
# Frontend first: generate_context! embeds frontend/dist, so workspace-wide
# cargo commands fail on a clean checkout until the frontend is built.
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

# Reference and QA scripts
bash scripts/tests/fetch-reference.test.sh
node scripts/qa/generate-fixtures.mjs --verify
node --test scripts/qa/*.test.mjs
node --test scripts/parity-report.test.mjs
node scripts/parity-report.mjs --check
```

`pnpm build` is required before any workspace-wide cargo command on every
supported OS, because `generate_context!` embeds `frontend/dist` at compile
time. If the Tauri layer changed, also build the desktop shell:
`cargo build -p wh3mm-app --release` on Windows or Linux, or dispatch the `CI`
workflow with `run_windows` enabled for the manual Windows compile check. The
Windows job is manual on purpose; the Linux jobs are the required PR gates.

For performance work, follow [docs/PERF.md](docs/PERF.md). The release-time
gate is:

```bash
node scripts/qa/verify-perf-gate.mjs
```

The wall-clock scan budget (`node scripts/perf/scan-budget.mjs`) is valid only
on the budget host described in docs/PERF.md; do not report a shared-runner
number as a budget result.

## Branches and commits

Never commit to `main`. Branch from current `main` and use
`<type>/<short-slug>`:

| Prefix | Use for |
| --- | --- |
| `feat/` | A new capability |
| `fix/` | A defect fix |
| `test/` | Test-only work |
| `perf/` | A measured performance change |
| `refactor/` | A behaviour-preserving rewrite |
| `docs/` | Documentation |
| `chore/` | Build, tooling, or maintenance |

Use lowercase kebab-case after the prefix, for example
`fix/load-order-backup` or `docs/contributing-guide`.

Commit messages use conventional prefixes: `feat:`, `fix:`, `test:`, `perf:`,
`refactor:`, `docs:`, `chore:`. A scope is optional, as in
`docs(contributing): add the contributor policy`. Keep the subject imperative
and short, keep each commit to one logical change, and do not mix unrelated
cleanup into a change.

Rebase or merge current `main` into your branch before requesting review. Never
force-push a branch that is under review, never rewrite `main`, and never commit
build artefacts, dependencies, secrets, or `.env` files.

## Pull requests

Open the pull request against `main`. Pushing early and opening a draft is
welcome; mark it ready when CI is green.

The pull request body must state:

- **What changed** — the concrete files or behaviour.
- **Why** — the problem and the linked task or issue.
- **Verification** — the commands you ran and their results.
- **Task link** — the Paperclip task (`WAR-xxx`) for maintainer work, or the
  GitHub issue for an external contribution.
- **Design impact** — an ADR in `docs/adr/` when the change crosses module
  boundaries, changes the IPC contract, persistence, or the update/install
  flow.

Keep one task per pull request. If you find an unrelated defect while working,
open a separate issue or task instead of fixing it in the same branch.

## Review rubric

Reviewers check four areas. The same rubric is in the short
[reviewer checklist](docs/REVIEW_CHECKLIST.md).

| Area | What must be true |
| --- | --- |
| **Correctness** | The change does what the task or issue says, and nothing unrelated. It respects [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md) and the ADRs. Errors are typed and surfaced, not panics. Filesystem writes stay atomic, keep the `.bak` contract, and never silently overwrite a future config schema. |
| **Tests** | New behaviour has a test at the right layer (core unit or integration, app command, IPC contract, or frontend component). Tests are deterministic: no network, real game install, real user config, or wall-clock dependence. A new fixture is added to `fixtures/manifest.json` and passes `--verify`. `#[ignore]` needs a comment and an owner. Test counts do not drop silently. |
| **Performance** | A change to a measured path (`crates/wh3mm-core`, `crates/wh3mm-perf`, `scripts/perf/**`, `docs/perf/**`, or frontend list rendering at 500 rows) includes before/after numbers using the method in [docs/PERF.md](docs/PERF.md). The release gate (`verify-perf-gate.mjs`) still passes. No unmeasured regression is accepted. |
| **Packaging** | A release change keeps the version identical in `crates/wh3mm-app/tauri.conf.json`, `Cargo.toml`, `package.json`, and `frontend/package.json`. The Windows NSIS build still works, the unsigned-installer warning is unchanged, and no build artefact or secret is committed. |

## Merge gates

A pull request merges only when all of these are true at its current head:

1. The branch is current with `main` and has no conflicts.
2. The **Linux quality gates** job in `.github/workflows/ci.yml` is green.
3. The **Capability parity** job is green (`node scripts/parity-report.mjs
   --check`).
4. QA (Baltasar Gelt) has approved the change.
5. The tech lead (Katerina Zarina) has approved the architecture and scope. If
   the tech lead authored the change, Torgrim approves instead; nobody approves
   their own work.
6. Performance-sensitive changes carry Genny4Real's before/after numbers and
   sign-off.
7. Changes to the Tauri layer have a Windows shell build, and release changes
   have the packaging checks above.

Merging is a squash merge into `main`. The branch is deleted after the merge.
Do not merge your own pull request. The maintainer who merges records the pull
request URL and merged SHA on the task and closes it.

## Response expectations

This is a small, best-effort project. There is no response SLA and no
guaranteed review time; please do not plan around one.

- One polite ping after 14 days without a response is appropriate. Repeated
  pings do not make a review faster.
- If a pull request has no author response for 30 days after review feedback, a
  maintainer may close it to keep the queue honest. Reopen it or open a fresh
  pull request when you are ready.
- Reviews are about the change, not the person. Ask for clarification when a
  comment is unclear; reasoned disagreement is fine.
- A request to split a large pull request is not a rejection. It is how the
  change gets reviewed properly.

## Credit

- You keep the copyright to your contribution. We do not require a contributor
  licence agreement (CLA).
- The Rust workspace declares MIT in `Cargo.toml`. By submitting a pull request
  you confirm you have the right to contribute the work and agree that it is
  distributed under the same MIT terms.
- Every merged pull request keeps its number in the squashed commit and in the
  repository history. A user-visible change from an external contributor names
  the contributor in [CHANGELOG.md](CHANGELOG.md) and in the release notes.
- External bug reporters are named in the changelog entry for the fix unless
  they ask not to be.
- Reviewers and QA are credited on the pull request. We do not run a separate
  contributor leaderboard, and we do not remove attribution.
- If you want a different name or no credit, say so in the pull request.

## Questions

Open an issue with the `question` label or ask on the pull request. For
maintainer work, the Paperclip task is the place for decisions that affect
scope or architecture.
