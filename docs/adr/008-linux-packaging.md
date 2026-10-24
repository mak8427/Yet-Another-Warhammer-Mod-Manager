# ADR-008 — Linux release packaging

- Status: accepted
- Date: 2026-10-22
- Owner: Katerina Zarina (tech lead)
- Task: WAR-142 (v1.1 packaging workstream, WAR-3)
- Related: ADR-007 (Linux desktop shell), `docs/RELEASE.md`

## Context

ADR-007 made the Tauri shell build and run on Linux, and CI has shipped the
`wh3mm-linux-x64.tar.gz` workflow artifact since then. That artifact is a build
output, not an installable release: it has no desktop entry, no package
metadata, and no proof that it starts on a distribution other than the runner.
The v1.1 packaging workstream requires download-and-run/install paths for
Debian/Ubuntu, Fedora, and Arch with no Rust or Node toolchain.

The shell links WebKitGTK 4.1 and GTK3. Those libraries are large, distro
packaged, and not candidates for bundling in the application archive. Every
packaging decision below treats them as declared runtime dependencies and
leaves the application itself self-contained.

## Decision

### Artifacts

The release builds four Linux artifacts from one release binary:

| Format | Producer | Name |
|---|---|---|
| `.deb` | Tauri bundler (`--bundles deb`) | `wh3mm_<version>_amd64.deb` |
| AppImage | Tauri bundler (`--bundles appimage`) | `wh3mm_<version>_amd64.AppImage` |
| Tarball | release workflow | `wh3mm-<version>-linux-x86_64.tar.gz` |
| Arch package | `makepkg` from the release tarball | `wh3mm-bin-<version>-1-x86_64.pkg.tar.zst` |

The `.deb` declares its runtime dependencies in `tauri.conf.json`
(`bundle.linux.deb.depends`). The tarball contains the binary, a desktop entry,
and a 128×128 icon. The AppImage uses Tauri's linuxdeploy build and the
standard type-2 runtime. Direct execution needs FUSE 2 (`libfuse2`); where
FUSE is unavailable, the runtime's `APPIMAGE_EXTRACT_AND_RUN=1` mode executes
the same payload without mounting.

The tarball is the canonical artifact for Arch: the `wh3mm-bin` PKGBUILD
installs the binary, desktop entry, and icon from it. This keeps the Arch
package a thin installer of the exact bytes that CI started on Ubuntu and
Fedora, rather than a second compiled build with a different toolchain.

### PKGBUILD lifecycle

`packaging/arch/PKGBUILD.in` is the template. `packaging/arch/render.sh` renders
`PKGBUILD` and `.SRCINFO` with the release version and the tarball SHA-256, and
`build-package.sh` builds from a `file://` source in CI. The release attaches
the rendered release-URL `PKGBUILD` and `.SRCINFO`, so the AUR submission is a
copy of a file that CI has proved, not a second hand-maintained copy.
`pkgver` and `sha256sums` are therefore generated, never edited by hand.

### Verification

`.github/workflows/linux-packages.yml` is a reusable workflow that also runs
directly on packaging-relevant paths. It has four build/test jobs:

- `bundles` on `ubuntu-24.04`: frontend and Rust gates, AppImage and `.deb`
  build, tarball staging, checksums.
- `ubuntu-24-04` on `ubuntu:24.04`: checksum verification, `apt install` of the
  `.deb`, start the binary; then `chmod +x` the AppImage and start it through
  the runtime's extract-and-run mode because containers have no `/dev/fuse`.
- `fedora` on `fedora:latest`: checksum verification, start the tarball binary,
  start the AppImage the same way. The job installs `dbus-daemon`, which
  provides `dbus-run-session` for `xvfb-run`.
- `arch` on `archlinux:latest`: install `webkit2gtk-4.1`,
  `libayatana-appindicator`, and `patchelf`, build the shell, run the Rust and
  frontend gates, build the package from the release tarball, install it with
  `pacman -U`, and start the app. The frontend and Rust gates run as an
  unprivileged `builder` user because the read-only-directory fault-injection
  test is meaningless as root.

Each runtime job asserts that the main window appears under Xvfb; a process that
exits or a missing window fails the job. The workflow runs on
packaging-relevant paths, and `release.yml` calls it for tags and dispatches. A
release cannot contain a Linux format that CI has not installed and started.

### Checksums

Each job writes a `SHA256SUMS.txt` over its own files. The release `publish`
job deletes those per-job files and writes one index over every attached asset,
including `PKGBUILD` and `.SRCINFO`, then verifies it before creating the draft
release.
Checksums are SHA-256 because the release page and the docs already use that
format.

## Alternatives considered

- **Ship only the AppImage.** Rejected: Arch users expect `pacman`, and a `.deb`
  gives Debian/Ubuntu users dependency resolution without manual library
  installation.
- **Build the Arch package from source with a `PKGBUILD` that runs Cargo.**
  Rejected: it needs a full toolchain on the user's machine and a second
  multi-minute compile, contradicts the `wh3mm-bin` name, and would not prove
  the shipped binary runs.
- **Bundle WebKitGTK into the tarball/AppImage.** Rejected: licensing, size, and
  the distro-specific plugin paths make this a maintenance trap; the `.deb`
  dependency path is the supported way to get WebKitGTK.
- **Publish a signed apt/dnf/pacman repository now.** Originally deferred
  (WAR-149); the implementation is extended by [ADR-013](013-linux-distribution.md).
- **Add Flatpak.** Originally deferred (WAR-143); the sandbox/runtime decision
  and host launch boundary are now recorded in ADR-013.

## Consequences

- A Linux release is four assets plus `SHA256SUMS.txt`, `PKGBUILD`, and
  `.SRCINFO`.
- AppImage and tarball users must install WebKitGTK 4.1 and GTK3 from their
  distribution; the docs give the Ubuntu and Fedora commands. The `.deb` path
  does this automatically.
- The Arch package tracks the release tarball, so a tarball layout change is an
  Arch packaging change. `build-package.sh` fails if the layout does not match.
- The `Linux packaging` workflow duplicates part of the Linux quality gates.
  That is deliberate: a release job must be self-contained and the Arch job
  proves the toolchain works on Arch, not only on Ubuntu.
- Signed repositories, Flatpak, RPM, binary Nix/Gentoo recipes, and the README
  installation section are extended by ADR-013. Public hosting/signing activation
  remains distinct from implementing those formats.
