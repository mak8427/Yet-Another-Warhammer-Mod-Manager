# WH3 Mod Manager

A fast, dense mod manager for **Total War: Warhammer III**, rebuilt with a Rust
backend and a TypeScript frontend.

- Product scope and v1.0 acceptance criteria: [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md)
- Architecture decisions: [docs/adr/](docs/adr/)
- QA plan and release gate: [docs/QA_PLAN.md](docs/QA_PLAN.md)
- Bug report template: [docs/BUG_REPORT_TEMPLATE.md](docs/BUG_REPORT_TEMPLATE.md)
- Legacy reference (Electron, not copied): https://github.com/Shazbot/WH3-Mod-Manager

## Status

M0 (bootstrap) is implemented: Rust workspace, Windows-gated Tauri 2 shell,
React + Vite UI, typed IPC round trip (`app_info`), ADRs 001-004, and CI.
Current progress and evidence live in [docs/STATUS.md](docs/STATUS.md). Mod
discovery and the mod list land in M1/M2.

## Layout

```
crates/wh3mm-core/   pure domain logic (no Tauri/WebView; testable on Linux)
crates/wh3mm-app/    Tauri 2 command layer and `wh3mm` binary (Windows-gated)
frontend/            React + TypeScript + Vite UI
docs/adr/            architecture decisions
fixtures/            synthetic QA fixtures (see fixtures/README.md)
scripts/qa/          deterministic fixture generator
```

The frontend never touches the filesystem. All game, Steam, pack, and state
operations go through typed Tauri commands mirrored in
`frontend/src/lib/ipc.ts` (contract: [ADR-002](docs/adr/002-ipc-contract.md)).

## Prerequisites

### Rust (all platforms)

Install Rust **stable** with [rustup](https://rustup.rs/). `rust-toolchain.toml`
selects the stable channel and the `rustfmt` and `clippy` components, and
`Cargo.toml` requires Rust 1.90 or newer. Rustup installs the pinned components
the first time `cargo` runs in this repository.

### Node.js and pnpm (all platforms)

- Node.js **24.x** (the repository requires `>=24.15.0`; CI uses Node 24).
- pnpm **12.14.0**, pinned in `package.json` as `packageManager`.

With Node 24, activate the pinned pnpm through Corepack:

```bash
corepack enable
corepack prepare pnpm@12.14.0 --activate
```

If Corepack is not bundled with your Node distribution, install the same
version globally with `npm install -g pnpm@12.14.0`.

### Windows (desktop shell)

The Tauri shell is built and run on Windows only in M0.

- Windows 10 or 11.
- Microsoft C++ Build Tools with the **Desktop development with C++** workload
  (MSVC compiler, Windows SDK) and the Rust MSVC toolchain
  (`rustup default stable-msvc`).
- WebView2 Runtime. It ships with Windows 11 and current Windows 10; otherwise
  install the Evergreen runtime from Microsoft.

### Linux

Linux builds and tests the Rust workspace without a desktop stack; the Tauri
shell does not run here in M0.

- A C linker for Rust (for example `build-essential` on Debian/Ubuntu).
- No WebKitGTK or GTK packages are needed: `tauri` and `tauri-build` are
  Windows-target-only dependencies (see
  [ADR-001](docs/adr/001-architecture.md)).

## Rust backend

Run Rust commands from the repository root. `Cargo.toml` is the workspace root
for `wh3mm-core` (domain logic) and `wh3mm-app` (Tauri command layer plus the
`wh3mm` binary). M0 defines no feature flags; `--locked` matches CI and keeps
`Cargo.lock` authoritative.

```bash
# Fetch dependencies without changing Cargo.lock
cargo fetch --locked

# Build every workspace member
cargo build --workspace --locked

# Run the core, IPC contract, fixture-contract, and command tests
cargo test --workspace --locked

# Verify the committed synthetic fixtures against their manifest
node scripts/qa/generate-fixtures.mjs --verify

# The same lint gates CI enforces
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
```

On Linux, `cargo build` compiles `wh3mm-app` as a stub because the Tauri
dependencies are gated to Windows.

## TypeScript frontend

The frontend is the `@wh3mm/desktop` package in `frontend/`, registered in the
pnpm workspace by `pnpm-workspace.yaml`. Run commands from the repository root;
the root scripts forward to the frontend package. `pnpm --dir frontend <script>`
runs the same scripts inside the package.

```bash
# Install all workspace dependencies from the lockfile
pnpm install --frozen-lockfile

# Vite dev server (UI only; Tauri IPC is unavailable in a browser)
pnpm dev            # http://localhost:1420

# Type checking, linting, tests
pnpm typecheck
pnpm lint
pnpm test

# Production build -> frontend/dist
pnpm build
```

`pnpm build` runs `tsc --noEmit && vite build`; it does not compile Rust.

## Run the app end to end

There is no separate backend process: the Tauri window and the Rust command
layer start together. On Windows, from a clean checkout in PowerShell:

```powershell
git clone https://github.com/mak8427/Warhammer_mod_manager.git
cd Warhammer_mod_manager
corepack enable
corepack prepare pnpm@12.14.0 --activate
pnpm install --frozen-lockfile
pnpm build
cargo run -p wh3mm-app --locked
```

Order matters: `generate_context!` embeds `frontend/dist` when the Rust shell
compiles, so build the frontend before `cargo run`. The `beforeDevCommand` and
`devUrl` entries in `crates/wh3mm-app/tauri.conf.json` belong to the Tauri CLI,
which M0 does not install; the sequence above is the M0 path.

On Linux, `cargo run -p wh3mm-app` exits with:

```text
wh3mm: the Tauri desktop shell is Windows-only in M0; use `cargo test` for headless work.
```

Use `cargo test --workspace --locked` and `pnpm dev` for headless work; the full
application requires Windows.

## Troubleshooting

- **`wh3mm: the Tauri desktop shell is Windows-only in M0`** — expected on
  Linux and macOS. The shell is gated to Windows by ADR-001. Run the workspace
  tests, or run the app on Windows.
- **Windows build cannot find `frontend/dist`** — run `pnpm build` from the
  repository root before `cargo build -p wh3mm-app` or `cargo run -p wh3mm-app`.
  Tauri embeds that directory at compile time.

## CI

CI runs all Linux gates on every push and pull request. The Windows Tauri build
job is manual (`workflow_dispatch`) until packaging lands in M5. See
`.github/workflows/ci.yml`.
