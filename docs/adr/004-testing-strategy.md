# ADR-004 — Testing strategy

- Status: accepted
- Date: 2026-10-20
- Owner: Katerina Zarina
- Depends on: ADR-001, ADR-002, ADR-003

## Context

The domain surface is mostly filesystem and binary parsing, which is where silent
data loss happens. The legacy app had tests, but they grew around Electron
process boundaries and the Redux renderer. The rebuild needs fast, headless
tests on Linux plus a small number of Windows checks for the shell and packaging.

## Decision

### Test layers

| Layer | Location | Tool | Runs on | Scope |
|---|---|---|---|---|
| Core unit tests | `crates/wh3mm-core/src/**` (`#[cfg(test)]`) | `cargo test` | Linux + Windows | Pure functions, validation, ordering, error mapping |
| Core integration tests | `crates/wh3mm-core/tests/` | `cargo test` | Linux + Windows | Fixtures on disk, atomic writes, parser round trips |
| App command tests | `crates/wh3mm-app/src/commands.rs` | `cargo test` | Linux + Windows | Command logic without a Tauri runtime |
| IPC contract tests | `crates/wh3mm-core/tests/ipc_contract.rs` + `frontend/src/lib/ipc.test.ts` | `cargo test`, Vitest | Linux | Serialized names, error envelope, wrapper normalization |
| Frontend unit/component | `frontend/src/**/*.test.ts(x)` | Vitest + Testing Library (jsdom) | Linux | Rendering, interaction contracts, error states, store logic |
| Tauri shell compile | `crates/wh3mm-app` | `cargo build -p wh3mm-app --locked` | Windows (manual CI) | `generate_context!`, command registration, capabilities |
| E2E | Tauri WebDriver or equivalent | TBD in M5 | Windows | Install detection, reorder, profile switch, launch, corrupt-file recovery |
| Performance | `benches/` + scripted fixtures | TBD by Genny4Real in M5 | Windows | 50-200 mod list load, filter, reorder, write latency |

### Linux quality gates

CI (`.github/workflows/ci.yml`) runs, in order:

```
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Linux must not install or link WebKitGTK. `tauri` and `tauri-build` are
Windows-target-only dependencies (ADR-001), so the core and app crates compile
without them. The Windows-only shell is compiled by the manual Windows job,
which runs `pnpm build` first because Tauri embeds `frontend/dist` at compile
time.

### Fixtures

- All fixtures are synthetic. No copyrighted game data, no user mods, no
  downloaded Workshop content is committed.
- Location: `crates/wh3mm-core/tests/fixtures/<domain>/`.
- Minimum M1 fixtures:
  - Steam `libraryfolders.vdf` with two libraries and one missing path.
  - WH3 install marker/data directory layout.
  - Valid pack header and three malformed variants (truncated, bad magic, bad
    string table) built by a small test helper so binary blobs stay small.
- M2 fixtures:
  - `used_mods.txt` variants: empty, CRLF, BOM, duplicates, unknown directives,
    missing final newline, names with spaces/unicode.
  - Corrupt `config.json`, valid `.bak`, unknown `schemaVersion`.
  - Profiles: default, duplicate names, deleting last profile.
- Tests use `tempfile::TempDir`; no test writes to a real game directory or the
  user's config directory.
- Failure-injection tests cover: temp-file write failure, rename failure,
  read-only target, missing parent directory, and a backup that is also corrupt.

### What must be true before a milestone is "done"

- **M1:** Steam/WH3 detection tests pass against fixtures; valid and malformed
  packs are both covered; `cargo clippy` and all frontend gates pass.
- **M2:** `used_mods.txt` round-trip (read → write → read) is byte-stable for
  the defined grammar; atomic write leaves the original intact when the target
  is locked; profile round-trip and first-run import pass; UI tests cover
  enable/disable, reorder callback payloads, filter/search, profile switch, and
  error states.
- **M3:** conflict winner tests cover file-level first/last wins, missing
  dependencies, and duplicate pack names; launch preconditions are tested
  without spawning the game.
- **M5:** Windows e2e covers first run, 50+ mod list, reorder, profile switch,
  launch, and recovery from a corrupted `used_mods.txt`; installer artifact is
  produced and attached to a release.

### Frontend testing rules

- Mock at the `frontend/src/lib/ipc.ts` boundary (module mock) or the Tauri
  `invoke` boundary for `ipc.ts` itself; do not mock `window.__TAURI_INTERNALS__`
  directly.
- Test observable behaviour and ARIA roles, not implementation classes. No
  snapshot-only tests for interactive components.
- Every error path that renders user-facing copy has a test for `IpcError` and
  for a malformed rejection.
- Virtualization tests assert the contract (which rows are mounted for a given
  scroll model), not jsdom scroll pixels; real scroll behaviour is covered in
  Windows e2e or a Playwright harness in M5.
- Keep jsdom tests fast (< 10s total). If a test needs a real filesystem or
  process, it belongs in Rust.

### CI operations

- Linux job runs on `ubuntu-24.04` with Node 24 and `pnpm --frozen-lockfile`;
  Rust comes from `dtolnay/rust-toolchain` (stable, rustfmt, clippy) and
  `Swatinem/rust-cache`.
- Windows job is `workflow_dispatch` in M0. It is promoted to `push` on `main`
  and tags when packaging lands in M5, with NSIS output as the artifact.
- A red gate blocks merges. Flaky tests are quarantined with an issue and a
  deadline, not silently skipped. `#[ignore]` requires a comment and an owner.
- Nightly/performance runs are Genny4Real's call in M5; they must not become a
  required gate until runtime thresholds are agreed.

## Consequences

- The critical domain surface is fully testable on Linux without a desktop
  stack, which keeps CI fast and cheap.
- Windows-only shell regressions are caught by the manual job in M0 and by
  required packaging CI from M5.
- Fixtures are deterministic and redistributable, so tests stay portable.
