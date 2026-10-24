# Development

## Toolchains

- Rust stable, 1.90+, with rustfmt and Clippy (selected by `rust-toolchain.toml`).
- Node.js 24.15+ and pnpm 12.14.0 (pinned in root `package.json`).
- Windows: MSVC C++ build tools, Windows SDK, and WebView2.
- Linux: C/C++ toolchain, pkg-config, GTK3/WebKitGTK 4.1 headers, and a desktop session.

Activate the pinned pnpm version with Corepack, or install it directly:

```bash
corepack enable
corepack prepare pnpm@12.14.0 --activate
# If your Node distribution has no Corepack:
# npm install -g pnpm@12.14.0
```

Linux build dependencies:

```bash
# Debian / Ubuntu
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libssl-dev libdbus-1-dev patchelf
# Arch
sudo pacman -S --needed base-devel pkgconf webkit2gtk-4.1 gtk3 \
  libayatana-appindicator librsvg openssl dbus patchelf
```

`pkg-config --modversion webkit2gtk-4.1` must succeed. Building needs development
headers; release installation normally needs only the runtime packages listed in
[installation](INSTALLATION.md).

## Build and run

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
cargo run -p wh3mm-app --locked
```

There is no backend service. Tauri embeds `frontend/dist` when Rust compiles the
app. After frontend changes, rebuild the frontend and restart the app. Normal
Cargo builds enable `custom-protocol`, so the WebView loads embedded assets rather
than localhost. This also keeps thumbnail asset URLs on the application scheme.

`pnpm dev` runs the UI in Vite at localhost:1420; Tauri IPC/filesystem actions are
unavailable in an ordinary browser. The `beforeDevCommand` and `devUrl` in Tauri's
config are used only by the Tauri CLI, not `cargo run`.

```bash
# Release binary
pnpm build
cargo build -p wh3mm-app --release --locked
./target/release/wh3mm
# Core-only development without WebKit or a frontend build
cargo test -p wh3mm-core --locked
```

Launch the app from a real X11/Wayland session. A sandbox unable to connect to the
display can fail GTK initialization even when compilation succeeded. Do not change
product rendering or disable security settings globally to work around a headless
build environment.

## Commands and layout

`pnpm dev/build/typecheck/lint/test` forward to `frontend/`. Supporting entry points:

| Command | Purpose |
|---|---|
| `pnpm reference` / `pnpm test:reference` | Fetch the pinned legacy comparison source / test the fetch helper |
| `pnpm fixtures:verify` | Verify committed fixtures and regenerate/check the ignored performance suite |
| `pnpm fixtures:write` | Regenerate committed synthetic fixture data intentionally |
| `pnpm fixtures:perf` | Generate the performance suite |
| `pnpm qa:scripts` | QA script and release-recipe checks |
| `pnpm bench` / `pnpm bench:budget` | Run Criterion / validate scan budgets |
| `pnpm perf:gate` | Validate the recorded performance comparison |

Helpers are organized under `scripts/dev`, `scripts/qa`, and `scripts/perf`.
See [testing](TESTING.md), [performance](PERFORMANCE.md), and
[architecture](../ARCHITECTURE.md) for the boundaries each command checks.

## Legacy comparison source

The original [Shazbot/WH3-Mod-Manager](https://github.com/Shazbot/WH3-Mod-Manager)
is a read-only behavioral/performance reference. `pnpm reference` creates the
ignored `reference/WH3-Mod-Manager` checkout at commit
`07fcf3ea1428fe3aa88282ba7aed44d9947ef103`. Do not edit, vendor, or ship it.
The reference helper is idempotent and rejects a conflicting checkout. If changing
the pin, update the helper and explain why in the PR.

No ordinary CI check requires a real game install or downloaded Workshop content.
