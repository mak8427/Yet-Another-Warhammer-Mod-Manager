# ADR-012 — Additional Linux distribution formats and signed updates

- Status: accepted for implementation; public hosting activation pending
- Date: 2026-10-24
- Related: ADR-008, `docs/INSTALLATION.md`, `docs/RELEASE.md`

## Decision

Extend the existing Ubuntu-built binary packaging with RPM, an offline Flatpak
bundle, and release-generated binary Nix/Gentoo recipe archives. Do not change
Steam-client support: the supported Linux launch path still uses native Steam
and Proton. The manager's Flatpak must launch host processes through
`flatpak-spawn --host` with explicit arguments, launch variables, and working
directory; it must also probe host processes rather than the private PID namespace.
Use `--watch-bus` so killing the launch helper also terminates its host command.
No command is constructed by interpolating a shell string.

Flatpak uses GNOME 50, broad filesystem access for Steam libraries, and permission
to call the Flatpak host-spawn interface. This trades isolation for the manager's
required file/launch functionality. The app's configuration remains under its
Flatpak XDG directories. Native/non-Flatpak launches retain their existing behavior.

RPM dependencies use shared-library capabilities so Fedora and openSUSE can
resolve their own package names. The binary baseline remains Ubuntu 24.04 /
glibc 2.39. Do not promise compatibility with older distributions.

Nix and Gentoo consume the exact release tarball. Generate their URLs and hashes
from that tarball, rather than committing placeholder checksums or referring to
mutable latest-release assets. Nix recipes are release archives rather than a
source-build flake at the repository root. Gentoo uses a local binary overlay;
there is no claim of an AUR, Gentoo-tree, Flathub, or nixpkgs listing.

A separate publisher consumes only an already-public release with a verified
checksum index. It produces apt InRelease/Release signatures, signed RPM packages
and repomd, signed pacman packages/databases, and signed Flatpak commits/summary.
Use an environment secret for the persistent signing key and variables for its
fingerprint and the HTTPS root. Fail if these are absent. Do not create throwaway
production keys or silently publish unsigned metadata.

Serve the generated tree through GitHub Pages. A release event or explicit
dispatch starts publishing; the existing release workflow still produces a draft
and does not make the app public. The generated setup script pins the key
fingerprint and verifies it before making system configuration changes. HTTPS
bootstrap trust and out-of-band fingerprint verification remain necessary.

## Verification and limits

The packaging matrix builds/starts Flatpak and Nix, installs/starts RPM on
Fedora/openSUSE, and retains the Debian/AppImage/Arch checks. A disposable test
key exercises signed repository generation and apt/dnf/pacman installs without
production secrets. Python tests exercise recipe archive contents and hashes.
Gentoo Portage install phases run with `--nodeps`; full Gentoo runtime
dependency resolution and real Steam/Proton launches need manual QA;
a window-opening smoke test is not evidence of either.

Maintainer activation of Pages, a signing secret, and a public release is still
required before the README may call the update repositories active.
