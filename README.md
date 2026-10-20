# WH3 Mod Manager

A fast, dense mod manager for **Total War: Warhammer III**, rebuilt with a Rust
backend and a TypeScript frontend.

- Product scope and v1.0 acceptance criteria: [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md)
- Architecture decisions: [docs/adr/](docs/adr/)
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
```

The frontend never touches the filesystem. All game, Steam, pack, and state
operations go through typed Tauri commands mirrored in
`frontend/src/lib/ipc.ts` (contract: [ADR-002](docs/adr/002-ipc-contract.md)).

## Requirements

- Rust stable (`rust-toolchain.toml`; install with rustup)
- Node.js 24.15+ and pnpm 12.14
- On Linux, no WebKitGTK is needed for the core tests. The Tauri shell is built
  on Windows only (see [ADR-001](docs/adr/001-architecture.md)).
- Windows builds also need the Tauri 2 prerequisites (WebView2, MSVC build
  tools).

## Commands

```bash
pnpm install

# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev            # Vite dev server on http://localhost:1420
```

Run the desktop shell on Windows from `crates/wh3mm-app` after building the
frontend:

```powershell
pnpm build
cargo run -p wh3mm-app
```

CI runs all Linux gates on every push and pull request. The Windows Tauri build
job is manual (`workflow_dispatch`) until packaging lands in M5.
