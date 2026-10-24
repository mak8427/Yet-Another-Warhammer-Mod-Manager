# Testing and release checks

## Automated checks

Run from a clean checkout using the toolchains in [development](DEVELOPMENT.md):

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
pnpm test:reference
```

`Linux quality gates` runs on pushes and PRs. Windows shell compilation is available
through the manual CI input; Windows installers also build in the release workflow.
Package workflows test native installation/startup, Flatpak, Nix, Gentoo install
phases, and signed repository trust. All required results must be green on the
exact head being merged. Historical runs on an earlier head are not substitutes.

The retired migration parity scorecard is not a product correctness check and is
no longer generated or enforced. Keep the actual Rust, IPC, frontend, fixture,
packaging, and performance checks. Never weaken them to satisfy cleanup.

## Layers

- Core unit/integration tests cover discovery, pack parsing, config/profile state,
  load-order safety, Workshop metadata, conflicts, and launch planning/guards.
- App tests cover command dispatch and blocking-work behavior; contract tests keep
  Rust IPC payloads aligned with TypeScript.
- Frontend tests cover store/screen behavior, virtualization, keyboard access,
  zoom, and design-token rules.
- Script tests cover safe fixture targets, performance validation, packaging
  scripts, generated install recipes, and reference-fetch behavior.

Use deterministic inputs. Do not require a real game, Steam login, network, or
personal configuration in unit tests. Tests that depend on permissions should run
as a normal user rather than root. Report environment limits explicitly.

## Fixtures

`fixtures/manifest.json` records size and SHA-256 for committed synthetic data.
The generator and Rust fixture-contract tests reject drift, missing or unlisted
files. Git attributes preserve BOM/CRLF cases without text conversion.

The fixture set includes valid/malformed PFH5 headers and indexes, Steam VDF/ACF,
load-order BOM/CRLF/duplicates/unknown directives, corrupt/future/unknown config,
and a deterministic 500-mod index. WH3's Steam app ID is `1142710`.

```bash
node scripts/qa/generate-fixtures.mjs --verify
# Intentional fixture update only:
node scripts/qa/generate-fixtures.mjs --write
# A larger disposable tree, outside the repository:
node scripts/qa/generate-fixtures.mjs --scale /tmp/wh3-scale-500 --count 500
```

The generator refuses the repository, its ancestors, home directories, and
symlink aliases of protected paths. `--force` can replace an unrelated nonempty
target but never bypass protected-path checks. Performance workloads are ignored
build products, not committed game packs.

## Desktop and game checks

On each supported desktop, install/run the actual built package and record the
version, OS, artifact checksum, and outcome:

1. Check startup, missing-game recovery, discovery, and manual folder selection.
2. Scan a real collection; confirm pack thumbnails, filtering, sorting, selection,
   virtualization, keyboard navigation, and the inspector.
3. Toggle/reorder mods, save/apply/switch profiles, restart, and verify persistence.
4. Verify load-order backups and explicit corrupt-file recovery without touching
   pack archives. Unknown directives and empty writes must ask for intent.
5. With Steam running, launch through the manager and verify the game actually
   loads the selected mods. On Linux use native Steam/Proton and an existing prefix.
   A spawned process or a window-opening smoke test does not establish this.
6. Confirm Workshop pages open through Steam and subscriptions remain Steam-owned.
7. Check density, zoom shortcuts, window geometry/maximized state, off-screen
   recovery, and small-screen layout. Wayland placement remains compositor-owned.
8. Uninstall the package and document whether user config remains.

The launch guard is bounded; it does not certify mod compatibility or prevent all
later external edits. NixOS real-game/FHS behavior and full Gentoo runtime dependency
resolution need manual testing beyond their package build/install-phase checks.

## Screenshots

Run `pnpm build`, then `node scripts/qa/screenshots-m4.mjs` with Chromium installed.
Use `SHOT_OUT` to choose a separate output directory and comma-separated `SHOT_ONLY`
to capture specific views. Do not overwrite historical evidence unintentionally.

The README's `docs/screenshots/showcase/` uses the dark grey/blue palette from main
`6ae9103` and 1920×1080 comfortable density. Profiles, tags, enabled states, and
conflict reports are simulated. The mod-list/launch images include real installed
Workshop pack names/artwork through `SHOT_WORKSHOP_DIR`; they do not claim to be a
real user's load order or conflict report. Raw artwork is read locally and embedded
only in screenshots. Without that optional directory, captures remain deterministic
and use thumbnail placeholders.

All showcase captures were checked for page overflow and visually reviewed. The
mod list has 23 visible rows at the stated viewport. Historical screenshot and
performance artifacts remain in their directories; Git history preserves their
retired migration commentary.
