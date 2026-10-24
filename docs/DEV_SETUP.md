# Development setup

## Build from source

### Prerequisites

#### Rust (all platforms)

Install Rust **stable** with [rustup](https://rustup.rs/). `rust-toolchain.toml`
selects the stable channel and the `rustfmt` and `clippy` components, and
`Cargo.toml` requires Rust 1.90 or newer. Rustup installs the pinned components
the first time `cargo` runs in this repository.

#### Node.js and pnpm (all platforms)

- Node.js **24.x** (the repository requires `>=24.15.0`; CI uses Node 24).
- pnpm **12.14.0**, pinned in `package.json` as `packageManager`.

With Node 24, activate the pinned pnpm through Corepack:

```bash
corepack enable
corepack prepare pnpm@12.14.0 --activate
```

If Corepack is not bundled with your Node distribution, install the same
version globally with `npm install -g pnpm@12.14.0`.

#### Windows (desktop shell)

- Windows 10 or 11.
- Microsoft C++ Build Tools with the **Desktop development with C++** workload
  (MSVC compiler, Windows SDK) and the Rust MSVC toolchain
  (`rustup default stable-msvc`).
- WebView2 Runtime. It ships with Windows 11 and current Windows 10; otherwise
  install the Evergreen runtime from Microsoft.

#### Linux (desktop shell)

The Tauri shell builds and runs on Linux against native Steam and Proton
installs. On Linux the game is started through Proton directly, using the
configured compatibility tool, the game's existing `compatdata` prefix, and the
Steam Linux Runtime. There is no automatic Steam fallback on Linux: a missing
prerequisite or a failed spawn is reported as a typed error code. Flatpak and
Snap Steam launches are not covered by this build.

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
WebKitGTK 4.1 runtime. Release workflows package it as described above;
see [the release guide](RELEASE.md) to reproduce those packages.

Use `cargo test -p wh3mm-core --locked` and `pnpm dev` for headless work.

## Troubleshooting

- **An error code needs an explanation** — see
  [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) for every `AppError` code,
  including the Linux Proton launch failures.
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
every push and pull request. The standalone Windows Tauri check is manual (`workflow_dispatch`); the
release workflow also builds the Windows installer. See
`.github/workflows/ci.yml`.

## Legacy WH3 Mod Manager reference

The legacy application ([`Shazbot/WH3-Mod-Manager`](https://github.com/Shazbot/WH3-Mod-Manager))
is the reference for M1/M2 porting work (UI, pack handling, load order) and for
the WAR-7 performance baselines. It is **not** part of this repository and is
never vendored, committed, or shipped.

### Pinned revision

| Field | Value |
|---|---|
| Repository | `https://github.com/Shazbot/WH3-Mod-Manager.git` |
| Commit | `07fcf3ea1428fe3aa88282ba7aed44d9947ef103` |
| Commit date | 2026-10-19 |
| License | MIT (upstream `LICENSE`) |

### Fetch it

From the repository root:

```bash
bash scripts/fetch-reference.sh
```

The script creates a shallow, detached checkout at `reference/WH3-Mod-Manager`
with exactly the pinned commit. It requires `git` and network access to GitHub.
The command is idempotent: when the checkout already exists at the pinned
commit it prints a confirmation and exits without changing anything.

`reference/` is listed in `.gitignore`, so the checkout never appears in
`git status` and never reaches a commit. No CI job needs to fetch it; any job
that does can call the same script.

### Read-only rule

Treat `reference/WH3-Mod-Manager` as read-only. Do not edit files there, do not
commit them, and do not copy the tree into the product. Use it to read the
legacy implementation, then write the Rust or TypeScript version in this
repository. Local edits make the checkout disagree with the pinned commit and
invalidate comparisons against the legacy baselines.

### Verify

```bash
git -C reference/WH3-Mod-Manager rev-parse HEAD   # prints the pinned commit
git status --porcelain                            # clean
git check-ignore reference/WH3-Mod-Manager        # prints the path
git ls-files reference/                           # prints nothing
```

### Re-pin

1. Pick the new upstream commit and update `PINNED_COMMIT` in
   `scripts/fetch-reference.sh` and the table above (commit and date).
2. Remove the old checkout: `rm -rf reference/WH3-Mod-Manager`.
3. Run `bash scripts/fetch-reference.sh` and repeat the verification commands.
4. Record why the revision moved in the task or pull request that changes it.
