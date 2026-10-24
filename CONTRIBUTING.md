# Contributing

WH3 Mod Manager is a Rust/Tauri manager for Total War: Warhammer III mods.
Start with [README](README.md), [architecture](ARCHITECTURE.md), and
[development setup](docs/DEVELOPMENT.md).

## Issues and scope

Search existing issues and PRs first. Bug reports should include version/commit,
OS and Steam installation type, numbered reproduction steps, expected and actual
behavior, and relevant error codes/logs. Redact secrets and private paths. Report
security-sensitive details privately through GitHub security reporting where
available.

Discuss large behavior changes before implementing them. The app manages mods,
load orders, profiles, conflicts, and Steam Workshop metadata; archive editors,
custom Steam authentication, and automated subscription flows are outside its
current scope. Small fixes can go straight to a focused PR.

## Implementation and checks

Respect the boundaries in [ARCHITECTURE.md](ARCHITECTURE.md). Keep the frontend
filesystem-free, sync IPC types, surface typed errors, and preserve atomic writes,
backups, and explicit recovery. Use existing components/tokens and keep keyboard,
zoom, and virtualized-list behavior intact.

Run relevant checks from [testing](docs/TESTING.md). A frontend production build
must precede workspace Cargo commands because Tauri embeds it at compile time.
Add meaningful regression coverage for behavior changes; do not add tests that
only restate an implementation. Keep fixture inputs synthetic and deterministic.

For measured paths, use the procedure and host limitations in
[performance](docs/PERFORMANCE.md). Report before/after evidence accurately; do
not relax budgets or represent a launch proxy as in-game load time.

## Pull requests

Branch from current `main`; use a descriptive branch name and conventional commit
prefix (`fix:`, `feat:`, `refactor:`, `docs:`, `test:`, or `chore:`). Keep unrelated
changes separate. Do not commit dependencies, build outputs, game files, secrets,
or personal config. Preserve other contributors' uncommitted work and attribution.

A PR should describe the problem and resulting behavior, relevant design choices,
tests run and results, and any remaining limitations. Link an issue when one exists;
no external agent-task ID or simulated approval role is required. Use the repository
PR template. Update the compact guides when behavior or setup changes.

Before merging, current-main conflicts must be resolved and the latest required
checks must pass on the exact head being merged. `Linux quality gates` covers the
core/frontend/script checks. Packaging changes also require the Linux package
matrix; Tauri changes need the relevant Windows compile check. A failed/cancelled
or skipped required check is not a pass. Review and merge authorization come from
the repository maintainer. Prefer squash merges; do not force-push shared branches.

Publishing a release or activating signed package hosting is separate from merging
and follows [installation/release instructions](docs/INSTALLATION.md#maintainer-release-process).

## Credit

Keep author/contributor attribution in Git history and release notes. Mention
external bug reporters unless they ask otherwise. Explain removals or changed
limitations in the PR; do not erase historical evidence to improve reported results.
