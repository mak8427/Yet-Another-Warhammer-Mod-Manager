# Changelog

Notable changes to WH3 Mod Manager. Versioned entries marked unreleased describe
implemented work, not a public download. See [installation and release steps](docs/INSTALLATION.md).

## [1.1.0] - unreleased

### Added

- Linux Tauri desktop support with native Steam and Proton (`#48`, contribution
  by @Genny4Real1).
- Linux package builds for Debian, RPM, AppImage, tarball, Arch, Flatpak, and
  hash-pinned Nix/Gentoo binary recipes. Signed apt/RPM/pacman/Flatpak repository
  publishing is implemented; persistent signing and public hosting require activation.
- Persisted window geometry and whole-interface zoom (`#53`).
- Dark-grey surfaces and blue controls, with updated README screenshots (`#59`, `#64`).

### Fixed

- Linux launches through the configured Proton and Steam Linux Runtime using the
  existing compatibility prefix. Windows launches `Warhammer3.exe` directly with
  Steam running. Both avoid the CA launcher and protect the applied load order (`#61`).
- Managed Workshop working directories precede mod entries in `used_mods.txt`;
  Linux absolute paths use Proton's Windows-visible `Z:/...` mapping (`#62`).

### Changed

- Removed unused core APIs, duplicated parsing/constants, and redundant session
  operations while retaining current launch protections (`#50`).
- Removed unused frontend exports/actions/styles and centralized workspace state
  loading and mutation (`#51`).
- Consolidated documentation into nine current guides, added `AGENTS.md`, and
  grouped developer/QA/performance helpers by purpose (`#52`).
- Retired migration scorecards, agent-task approval records, reference-fetch
  tooling, and cross-application comparisons. Benchmarks now measure this app
  independently; scan budgets remain unchanged.

## [1.0.0] - unreleased

### Added

- Rust core, Tauri desktop shell, React/TypeScript interface, and typed IPC (`#1`).
- Steam/game discovery, PFH5 pack indexing, mod browsing, load-order editing,
  profiles, tags, atomic writes, and backup recovery (`#6`).
- Pack conflict/dependency inspection, Workshop metadata and thumbnails, and
  launch options (`#18`).
- Density controls, keyboard navigation, loading/error states, reset settings,
  deterministic sorting, duplicate-name warnings, and profile recovery (`#10`, `#26`).
- Windows per-user NSIS installer and a tag workflow that produces a reviewed
  draft release (`#25`).

### Removed

- Pack-author fields and controls: the available pack/Steam metadata does not
  provide author information without additional authentication.

### Current limitations

- Steam owns subscription changes; the manager opens Workshop pages and reads
  installed/subscribed state without automating Steam login.
- Native Steam is required for Linux launching. Flatpak/Snap discovery is
  best-effort; launching those Steam clients is unsupported.
- The Windows installer is unsigned. WebView2 setup can require a download.
- The launch guard is bounded and does not certify mod compatibility or game
  loading. Performance launch measurements use a process-start proxy.
- Real-game and platform-specific desktop behavior still need manual checks in
  addition to automated tests; see [testing](docs/TESTING.md).
