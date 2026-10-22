# Reviewer checklist

Use this for every pull request, including external contributions. The full
policy is [CONTRIBUTING.md](../CONTRIBUTING.md); this is the short version.

## Before reading the diff

- [ ] The pull request links a Paperclip task (`WAR-xxx`) or a GitHub issue.
- [ ] The body states what changed, why, and how it was verified.
- [ ] The branch is current with `main`; there are no conflicts.
- [ ] The change stays in scope. Unrelated cleanup is split out.
- [ ] A cross-cutting decision has an ADR in `docs/adr/` in the same pull
      request.
- [ ] CI at the current head: **Linux quality gates** and **Capability parity**
      are green.

## Run or confirm the gate

```bash
bash scripts/tests/fetch-reference.test.sh
node scripts/qa/generate-fixtures.mjs --verify
node --test scripts/qa/*.test.mjs
node --test scripts/parity-report.test.mjs
node scripts/parity-report.mjs --check

cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

A docs-only pull request can rely on CI instead of every local command, but CI
must be green. A Tauri-layer change also needs a Windows shell build
(`pnpm build`, then `cargo build -p wh3mm-app --release` on Windows, or the
`CI` workflow dispatched with `run_windows`).

Performance-sensitive paths (`crates/wh3mm-core`, `crates/wh3mm-perf`,
`scripts/perf/**`, `docs/perf/**`, or frontend list rendering at 500 rows)
additionally need:

```bash
node scripts/qa/verify-perf-gate.mjs
```

and before/after numbers measured by the method in [PERF.md](PERF.md).

## What blocks a merge

- A required check is red or was not run at the current head.
- QA (Baltasar Gelt) has not approved, or the tech lead (Katerina Zarina) has
  not approved. If the tech lead authored the change, Torgrim approves instead.
- A performance-sensitive change lacks before/after numbers and Genny4Real's
  sign-off.
- A behaviour change has no test, the tests are non-deterministic, an ignored
  test has no comment and owner, or a new fixture is missing from
  `fixtures/manifest.json`.
- The change can lose data, panic on malformed input, bypass the atomic-write
  and `.bak` contract, or overwrite a future config schema.
- The change reintroduces a cut feature, drifts from
  [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md), or duplicates an existing abstraction
  without an ADR.
- A release change has mismatched versions in `tauri.conf.json`, `Cargo.toml`,
  or either `package.json`, or the Windows package no longer builds.
- A build artefact, dependency directory, secret, token, or `.env` file is
  committed.
- The branch is behind `main` or has unresolved conflicts.
- A blocking review comment is still open.

## What is a follow-up, not a blocker

- Naming, formatting, and other nits that do not change behaviour.
- A refactor that is unrelated to the task.
- Optional extra coverage for a path that already has a test.
- An optimisation outside the measured performance budget.
- Documentation polish that does not make a command or contract wrong.

File the follow-up as a task or issue with an owner and link it from the pull
request. A comment alone is not a follow-up. Anything that can cause data loss,
a crash, a security problem, or an incorrect result is a blocker, not a
follow-up.

## Reviewing an external pull request

- Thank the contributor and review the change, not the person.
- Name the gate and the exact command or line that fails. "This is wrong" is not
  a review.
- If the pull request is too large, ask for a smaller first change and say which
  part would be most useful.
- Do not force-push or rewrite someone else's branch; ask the author to update
  it.
- If the author stops responding, a maintainer may adopt the change. Credit
  stays with the original author.

## Merge

1. Re-check CI, QA approval, tech-lead approval, and any performance sign-off at
   the current head.
2. Squash merge into `main` with the conventional commit subject.
3. Delete the branch.
4. Record the pull request URL and the merged SHA on the task or issue, and
   close it.
5. For a user-visible external contribution, confirm the `CHANGELOG.md` entry
   names the contributor.
