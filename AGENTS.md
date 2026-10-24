# Working in this repository

Read [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), and
[CONTRIBUTING.md](CONTRIBUTING.md) before changes. These current guides replace
the retired migration/swarm task documents. Do not restore the parity scorecard,
fictional reviewer roles, task-ID approval process, or per-milestone status files.

## Scope and workspace

- Follow the user's request and preserve unrelated work. Inspect `git status`
  before edits; never reset or stage somebody else's changes.
- Check existing PRs before duplicating work. Use an isolated checkout when the
  shared checkout has unrelated edits. Do not force-push shared branches.
- Keep changes focused. Remove verified dead code and duplicated logic without
  changing supported behavior or weakening tests to make a refactor pass.
- Do not spawn subagents unless the user explicitly requests delegation.
- Keep documentation compact: README, CONTRIBUTING, ARCHITECTURE, AGENTS,
  CHANGELOG, and the four guides in `docs/`. Update those instead of adding
  task logs, approval transcripts, or one-off Markdown summaries.

## Implementation

- Core logic belongs in `wh3mm-core`; frontend filesystem access goes through
  the typed IPC facade and Tauri commands. Keep IPC types synchronized.
- Preserve atomic writes, backups, future-schema refusal, explicit recovery,
  and confirmation before dropping unmanaged/empty load orders.
- Do not rewrite game packs, create Proton prefixes, automate Steam login, or
  add a Steam/CA-launcher fallback to direct launch.
- Keep launch args as arguments, never interpolated shell strings. Preserve
  Windows paths and Proton's `Z:/...` working-directory conversion.
- Use semantic design tokens and existing components. Preserve virtualization,
  density, zoom, keyboard access, and focus behavior.
- Tests and fixture generation must not touch a real game install or user config.
  Real-game/manual QA needs the user's explicit scope and accurate reporting.

## Verification

Build `frontend/dist` before Cargo workspace checks:

```bash
pnpm install --frozen-lockfile
pnpm build
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm typecheck
pnpm lint
pnpm test
pnpm qa:scripts
pnpm fixtures:verify
```

Use checks appropriate to the change. Follow [testing](docs/TESTING.md) for desktop,
package, and screenshot work; follow [performance](docs/PERFORMANCE.md) before
reporting speed changes. Do not claim CI/startup proves a real game launch.

## Delivery

Describe what changed, why, validation results, and remaining limitations. Merge
only when authorized and the latest required checks pass on the exact PR head;
package changes also need the package matrix. Never treat failed, cancelled, or
skipped required checks as a pass. Do not merge a different head than the one
verified. Publishing releases, signing keys, and package hosting is separate from
merging code and must remain within the user's authorization.
