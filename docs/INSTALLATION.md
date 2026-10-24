# Installation and updates

The [README](../README.md#downloads--installation) lists the installation paths.
Download assets from a **public** [GitHub release](https://github.com/mak8427/Warhammer_mod_manager/releases).
A draft release does not provide public downloads. The package workflows must pass
before publication; adding a workflow does not certify that its builds have passed.

## Verify downloads

Download `SHA256SUMS.txt` from the same release as the selected asset:

```bash
sha256sum --ignore-missing -c SHA256SUMS.txt
```

Check that each file you downloaded is listed and reports `OK`; missing files in
the full release index are skipped. SHA-256 detects corruption but is not a
publisher signature. In PowerShell, run `Get-FileHash .\<downloaded-file> -Algorithm SHA256`
and compare the hash with that file's entry in the checksum index.

Direct GitHub RPM/Arch packages may be unsigned. Do not disable signature
verification globally. If your distro rejects the local unsigned file, use the
signed repository when activated, or use Flatpak/AppImage after checksum verification.

## Flatpak

App ID: `com.warhammerlabs.wh3mm`. GNOME Platform/SDK branch: `50`.
The offline bundle installs the app; Flathub supplies the GNOME runtime.

Permissions include host filesystem access, networking, display/GPU access, and
`org.freedesktop.Flatpak` host spawning. The manager must edit Steam library files
and launch the host Steam Linux Runtime/Proton, so it deliberately has broad access.
It forwards the resolved launch variables and working directory to `flatpak-spawn
--host`; it keeps the host library environment rather than sending GNOME runtime
library paths into Proton. Running-game detection also queries the host.

Native Steam is still required. Flatpak Steam and Snap Steam launching remain
unsupported; packaging the manager is separate from supporting those Steam clients.
Host process detection needs `pgrep` (`procps`/`procps-ng` on the host).

Build locally after creating the release tarball:

```bash
flatpak install --user flathub org.gnome.Platform//50 org.gnome.Sdk//50
bash packaging/flatpak/build.sh wh3mm-1.0.0-linux-x86_64.tar.gz flatpak-out
flatpak install --user ./flatpak-out/wh3mm-linux-x86_64.flatpak
```

The local build and release bundle do not create an update remote. Once the
maintainer activates repository hosting, install its `flatpak/wh3mm.flatpakref`
from the configured HTTPS repository URL. That reference embeds the repository
public key and configures updates through `flatpak update` or a desktop software
store. This is a project-hosted remote, not a Flathub listing.

Remove with `flatpak uninstall --user com.warhammerlabs.wh3mm`. Add `--delete-data`
only if you also want to remove the manager's Flatpak configuration.

## Signed update repositories

The publication workflow is `.github/workflows/package-repositories.yml`. It runs
on a published release, or manually for a selected already-public `vX.Y.Z` tag.
It verifies the release checksum index, signs the package repository metadata,
and stages a static site for GitHub Pages. It does not publish an app release.

Maintainer activation (once, before advertising the repositories):

1. Merge the packaging work and pass the Linux package matrix, including the
   disposable-key signed repository integration job.
2. Configure GitHub Pages to use **GitHub Actions** as its source. This publisher
   owns the Pages site; integrate it with an existing site before sharing hosting.
3. Create the `package-repositories` environment. Store a dedicated, unencrypted
   ASCII-armored signing private key as its `REPOSITORY_SIGNING_KEY` secret. Use
   a persistent key with a valid signing-capable RSA key/subkey; the key must also
   work with RPM signing. Keep a secure backup and track its expiry. Never commit it.
4. Set repository/environment variables `REPOSITORY_KEY_FINGERPRINT` (40 uppercase
   hex characters for the primary key) and `PACKAGE_REPOSITORY_URL` (HTTPS Pages
   root, without a trailing slash, for example the project's Pages URL).
5. Publish the reviewed release, or manually dispatch the publisher for that
   public tag. Approve the Pages deployment if your environment requires it.
6. Check the public URL, signed metadata, and actual installs on target systems.
   Publish the key fingerprint through the README/release notes as an independent
   reference. Only then present the update repositories as active.

The output includes `setup.sh`, `repository-key.asc`, `KEY_FINGERPRINT.txt`, apt,
RPM, pacman, and Flatpak repositories. Download `setup.sh` from the activated
repository, inspect it, and run `bash setup.sh`. The generated script has a pinned
key fingerprint; it rejects a mismatching public key before making system changes.
It configures a scoped apt keyring, signed RPM metadata/packages, or signed pacman
database/packages. It does not install the application or upgrade the OS.

The bootstrap script and key served from one site still depend on HTTPS and trust
in that site. Compare the embedded fingerprint against the maintainer-published
fingerprint before running it. No script can establish independent trust by
comparing two values downloaded from the same compromised origin.

After setup use the package-manager commands in the README. apt/dnf/zypper package
name: `wh3-mod-manager`; pacman package name: `wh3mm-bin`; executable: `wh3mm`.
The `.flatpakref` sets up Flatpak separately.

Repository builds fail if the signing key, required package formats, or public
URL are absent. There is no unsigned-repository fallback. Publishing a later
release replaces the current packages; previous binaries remain in GitHub Releases.
Do not publish an older tag over an active repository except for an intentional rollback.

Remove the app using `apt remove wh3-mod-manager`, `dnf remove wh3-mod-manager`,
`zypper remove wh3-mod-manager`, or `pacman -R wh3mm-bin`. Repository removal is
separate: delete the corresponding `wh3mm` sources/repo file; for pacman also
remove its Include line from `/etc/pacman.conf` before deleting `/etc/pacman.d/wh3mm.conf`.

## Nix

The release includes `wh3mm-nix-<version>.tar.gz`, containing `flake.nix` and
`default.nix`. The renderer pins the binary archive URL/version and SHA-256 from
the exact CI-built tarball. `autoPatchelfHook` fixes the ELF interpreter/library
paths and `wrapGAppsHook3` provides GTK resources. Only `x86_64-linux` is supported.

```bash
tar -xzf wh3mm-nix-1.0.0.tar.gz
nix run ./wh3mm-nix-1.0.0
nix profile install ./wh3mm-nix-1.0.0
# Non-flake Nix users:
nix-build ./wh3mm-nix-1.0.0/default.nix
```

The flake's first invocation resolves nixpkgs; keep its generated `flake.lock`
for reproducible subsequent builds. The application archive itself is always
hash-pinned. Updates use the recipe for a new release.

For NixOS, enable `programs.steam.enable = true`. The game's unpatched Proton
scripts require a conventional filesystem layout; run the manager within the
Steam FHS environment, for example `steam-run ./result/bin/wh3mm` after
`nix build ./wh3mm-nix-1.0.0`. Install `pkgs.steam-run` if needed. The CI startup
check verifies the manager window, not real Proton game launching on NixOS;
that requires a real Steam/game installation and manual QA.

The source directory `packaging/nix` contains templates, not a directly runnable
flake: use the generated release recipe. Remove a profile installation with
`nix profile list` then `nix profile remove <entry>`.

## Gentoo

The generated archive is a **local binary overlay**, not a listing in the main
Gentoo tree or an independently maintained external overlay. Download/extract it,
then copy it into a root-owned location:

```bash
tar -xzf wh3mm-gentoo-1.0.0.tar.gz
sudo mkdir -p /var/db/repos/wh3mm
sudo cp -a wh3mm-gentoo-1.0.0/. /var/db/repos/wh3mm/
sudo mkdir -p /etc/portage/repos.conf /etc/portage/package.accept_keywords
printf '[wh3mm]\nlocation = /var/db/repos/wh3mm\nauto-sync = no\n' | sudo tee /etc/portage/repos.conf/wh3mm.conf
echo 'games-util/wh3mm-bin ~amd64' | sudo tee /etc/portage/package.accept_keywords/wh3mm
sudo emerge --ask games-util/wh3mm-bin
```

The ebuild downloads the release binary; its Manifest pins size, BLAKE2B, and
SHA512. Runtime dependencies include glibc 2.39+, WebKitGTK slot 4.1, GTK3,
libayatana-appindicator, librsvg, and OpenSSL 3. No Rust or Node toolchain is needed.
The binary requires glibc, not musl. Source-based Gentoo builds are not included.

Update by replacing the local overlay with the archive from a newer release,
then run `emerge --ask --update games-util/wh3mm-bin`. Remove with
`emerge --ask --depclean games-util/wh3mm-bin`. CI verifies the generated hashes and installs the ebuild through Portage with
`--nodeps` to exercise its fetch/install phases without compiling WebKit. Full
dependency resolution and desktop/game launch still need Gentoo manual QA.

## AppImage and tarball

Install runtime libraries once:

```bash
# Ubuntu 24.04
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0t64 libayatana-appindicator3-1 librsvg2-2
# Fedora
sudo dnf install webkit2gtk4.1 libayatana-appindicator-gtk3
# Arch
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg
```

For direct AppImage mounting, install FUSE 2 (`libfuse2t64` on Ubuntu 24.04,
`fuse-libs` on Fedora), or run with `APPIMAGE_EXTRACT_AND_RUN=1`. Remove an
AppImage or extracted tarball by deleting it. They do not configure automatic
updates. The manager's user configuration remains unless explicitly removed.

For a portable tarball desktop entry, install its binary into `~/.local/bin/wh3mm`
and its desktop/icon files into `~/.local/share/applications/` and
`~/.local/share/icons/hicolor/128x128/apps/`. Ensure `~/.local/bin` is in the
desktop session's PATH; the menu entry executes `wh3mm`.
