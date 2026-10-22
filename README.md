# WH3 Mod Manager

A fast, dense mod manager for **Total War: Warhammer III**, rebuilt with a Rust
backend and a TypeScript frontend.

- Product scope and v1.0 acceptance criteria: [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md)
- Architecture decisions: [docs/adr/](docs/adr/)
- QA plan and release gate: [docs/QA_PLAN.md](docs/QA_PLAN.md)
- Linux manual QA: [docs/MANUAL_QA_LINUX.md](docs/MANUAL_QA_LINUX.md)
- Capability parity scorecard: [docs/PARITY.md](docs/PARITY.md)
- Bug report template: [docs/BUG_REPORT_TEMPLATE.md](docs/BUG_REPORT_TEMPLATE.md)
- Contributing, review gates, and credit: [CONTRIBUTING.md](CONTRIBUTING.md)
- Legacy reference (Electron, not copied): https://github.com/Shazbot/WH3-Mod-Manager

## Status

The v1.0 feature set is implemented. The Tauri 2 desktop shell builds and runs
on Windows and Linux (native Steam/Proton); macOS is not supported. Current
progress and evidence live in [docs/STATUS.md](docs/STATUS.md).

## Layout

```
crates/wh3mm-core/   pure domain logic (no Tauri/WebView; testable on Linux)
crates/wh3mm-app/    Tauri 2 command layer and `wh3mm` binary (Windows + Linux)
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

- Windows 10 or 11.
- Microsoft C++ Build Tools with the **Desktop development with C++** workload
  (MSVC compiler, Windows SDK) and the Rust MSVC toolchain
  (`rustup default stable-msvc`).
- WebView2 Runtime. It ships with Windows 11 and current Windows 10; otherwise
  install the Evergreen runtime from Microsoft.

### Linux (desktop shell)

The Tauri shell builds and runs on Linux against native Steam and Proton
installs. Flatpak and Snap Steam launches are not covered by this build.

- A C linker and `pkg-config` (`build-essential pkg-config` on Debian/Ubuntu).
- WebKitGTK 4.1 and GTK3 development/runtime packages. On Debian/Ubuntu:

  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
    libayatana-appindicator3-dev librsvg2-dev libssl-dev libdbus-1-dev
  ```

  On Arch-based distributions:

  ```bash
  sudo pacman -S --needed base-devel webkit2gtk-4.1 \
    libayatana-appindicator librsvg openssl dbus
  ```

- A running X11 or Wayland desktop session.

## Rust backend

Run Rust commands from the repository root. `Cargo.toml` is the workspace root
for `wh3mm-core` (domain logic) and `wh3mm-app` (Tauri command layer plus the
`wh3mm` binary). `--locked` matches CI and keeps `Cargo.lock` authoritative.

The desktop shell embeds `frontend/dist` at compile time. On a clean checkout,
build the frontend before any workspace-wide `cargo` command:

```bash
pnpm install --frozen-lockfile
pnpm build
```

`cargo test -p wh3mm-core --locked` stays WebView- and frontend-free.

```bash
# Fetch dependencies without changing Cargo.lock
cargo fetch --locked

# Build every workspace member
cargo build --workspace --locked

# Run the core, IPC contract, fixture-contract, and command tests
cargo test --workspace --locked

# Verify the committed synthetic fixtures against their manifest
node scripts/qa/generate-fixtures.mjs --verify

# QA script tests (fixture guard + performance-gate validator)
node --test scripts/qa/*.test.mjs

# The same lint gates CI enforces
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
```

On Linux, the workspace build compiles the Tauri shell and links WebKitGTK.

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

# Release-time performance gate (needs docs/perf/comparison.json; see docs/QA_PLAN.md §7)
node scripts/qa/verify-perf-gate.mjs
```

`pnpm build` runs `tsc --noEmit && vite build`; it does not compile Rust.

## Run the app end to end

There is no separate backend process: the Tauri window and the Rust command
layer start together. From a clean checkout:

```bash
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
which this repository does not install; the sequence above is the supported
path. The app enables Tauri's `custom-protocol` feature so cargo-built binaries
serve the embedded frontend instead of the Vite dev server.

On Linux, `cargo build -p wh3mm-app --release --locked` produces
`target/release/wh3mm`. The binary embeds the frontend and requires the
WebKitGTK 4.1 runtime at run time. CI uploads the same binary as the
`wh3mm-linux-x64` artifact; there is no Linux installer yet.

Use `cargo test -p wh3mm-core --locked` and `pnpm dev` for headless work.

## Troubleshooting

- **The build cannot find `frontend/dist`** — run `pnpm build` from the
  repository root before any workspace-wide `cargo` command. Tauri embeds that
  directory at compile time.
- **Linux build cannot find `webkit2gtk-4.1`** — install the Linux desktop
  packages listed above. `pkg-config --modversion webkit2gtk-4.1` must succeed.
- **`wh3mm` exits with a shared-library error on Linux** — the WebKitGTK 4.1
  runtime is missing. Install the runtime packages for your distribution.
- **Steam actions fail on Linux** — this build supports a native Steam client
  (`steam.sh`/`steam`); Flatpak and Snap Steam clients are not covered.

## CI

CI runs all Linux gates plus a Linux Tauri shell build and binary artifact on
every push and pull request. The Windows Tauri build job is manual
(`workflow_dispatch`) until packaging lands in M5. See
`.github/workflows/ci.yml`.
