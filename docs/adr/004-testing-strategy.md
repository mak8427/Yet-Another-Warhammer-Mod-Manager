# ADR-004 — Testing strategy

- Status: accepted
- Date: 2026-10-20
- Amended: 2026-10-21 (fixture location; see "Fixtures — amendment");
  2026-10-22 (Linux desktop shell; ADR-007)
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
| App command tests | `crates/wh3mm-app/src/commands/**` | `cargo test` | Linux + Windows | Command logic without a Tauri runtime |
| IPC contract tests | `crates/wh3mm-core/tests/ipc_contract.rs` + `frontend/src/lib/ipc.test.ts` | `cargo test`, Vitest | Linux | Serialized names, error envelope, wrapper normalization |
| Frontend unit/component | `frontend/src/**/*.test.ts(x)` | Vitest + Testing Library (jsdom) | Linux | Rendering, interaction contracts, error states, store logic |
| Tauri shell compile | `crates/wh3mm-app` | `cargo build -p wh3mm-app` | Linux + Windows | `generate_context!`, command registration, capabilities |
| E2E | Tauri WebDriver or equivalent | TBD in M5 | Windows | Install detection, reorder, profile switch, launch, corrupt-file recovery |
| Performance | `benches/` + scripted fixtures | TBD by Genny4Real in M5 | Windows | 50-200 mod list load, filter, reorder, write latency |

### Linux quality gates

CI (`.github/workflows/ci.yml`) runs, in order:

```
pnpm install --frozen-lockfile
pnpm build
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm typecheck
pnpm lint
pnpm test
cargo build -p wh3mm-app --release
```

The Linux job installs WebKitGTK 4.1/GTK3 and builds the desktop shell
(ADR-007). It runs `pnpm build` first because Tauri embeds `frontend/dist` at
compile time. `wh3mm-core` stays free of WebView dependencies, so
`cargo test -p wh3mm-core` remains the fast headless target. The Windows shell
is still compiled by the manual Windows job.

### Fixtures

- All fixtures are synthetic. No copyrighted game data, no user mods, no
  downloaded Workshop content is committed.
- Location: `fixtures/<domain>/` at the repository root (amended 2026-10-21;
  see below).
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

#### Fixtures — amendment 2026-10-21

The committed fixture set lives at the repository root, `fixtures/<domain>/`,
with `fixtures/manifest.json` and a deterministic generator in `scripts/qa/`.
This replaces the earlier `crates/wh3mm-core/tests/fixtures/<domain>/` location.

Reason: the same bytes are consumed by the Rust core integration tests, the
frontend scale tests, the fixture generator, and the QA documents. A crate-local
path would force the frontend and the generator to reach into a Rust crate's
test directory and would make the ownership of fixture drift ambiguous. Rust
tests read the root path as `CARGO_MANIFEST_DIR/../../fixtures`; the crate is
not published, so self-containment has no value here.

Rules: `fixtures/**` stays `-text` in `.gitattributes`; every data fixture is
listed in `fixtures/manifest.json` and checked by
`node scripts/qa/generate-fixtures.mjs --verify` in CI; tests never write into
`fixtures/`.

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
  stack, which keeps core work fast and cheap; the full workspace gate also
  compiles the Linux shell.
- Windows-specific shell regressions are caught by the manual job in M0 and by
  required packaging CI from M5.
- Fixtures are deterministic and redistributable, so tests stay portable.
