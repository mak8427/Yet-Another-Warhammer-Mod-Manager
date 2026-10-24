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

## Troubleshooting

Every rejection from the Rust core carries an `AppError` with a stable
machine-readable `code`, a short user-facing `message`, optional diagnostic
`details`, and a `retryable` flag.

Start with the code, then read `details`: it names the paths and probes the
core used. The same codes are mirrored in `frontend/src/lib/ipc.ts`.

## Launch codes

| Code | Meaning | Likely cause | What to check |
|---|---|---|---|
| `proton_not_configured` | Steam is not configured to run WH3 through Proton, and `Warhammer3.exe` was not found. | The compatibility tool is not set, or the game path points at the wrong folder. | In Steam, open WH3 properties → Compatibility and select a Proton version. Confirm `<game>/Warhammer3.exe` exists. |
| `compat_data_missing` | The Proton compatibility data directory is absent. | WH3 has never been started through Proton, or the prefix lives in another library. | Check `<library>/steamapps/compatdata/1142710`. Start the game once through Steam/Proton to create it. The manager deliberately does not create a prefix. |
| `proton_not_installed` | No usable `steamapps/common/Proton*/proton` installation was found. | Proton is not installed, or it is installed in a library the manager cannot read. | Check every Steam library for `steamapps/common/Proton*`. Install a Proton version from Steam. Custom tools under `compatibilitytools.d` are not scanned. |
| `proton_runtime_missing` | No `SteamLinuxRuntime*/_v2-entry-point` was found. | The Steam Linux Runtime is not installed, or the runtime directory is incomplete. | Check `steamapps/common/SteamLinuxRuntime*`. Install/repair the Steam Linux Runtime from Steam. |
| `launch_failed` | The resolved Steam, Proton, or direct game process could not be spawned. | The executable is missing or not executable, the runtime is broken, or the OS refused the process. | Read `details` for the executable and OS error. Verify the path is executable and the runtime/Proton installation is complete. There is no automatic launcher fallback. |
| `load_order_overridden` | `used_mods.txt` does not match the applied order, contains duplicate/unmanaged entries, or changed during the launch guard window. | Another process (for example Creative Assembly's launcher) rewrote the file, or a user/tool edited it during launch. | The manager refused to launch, or stopped the immediate process it started and restored the snapshot; the runtime may already have spawned descendants. Compare `used_mods.txt` with the last preview and click Apply Load Order before retrying. Do not launch through Steam manually. |

### How the Linux launch path works

The Linux launch path is Proton-only:

```text
manager writes used_mods.txt (separate explicit operation)
  -> resolves Steam root, compatdata, Proton, and Steam Linux Runtime
  -> runtime --verb=waitforexitandrun -- proton waitforexitandrun Warhammer3.exe used_mods.txt;
  -> manager watches used_mods.txt for 3 seconds
  -> if it changed, kills the spawned process and returns load_order_overridden
```

There is no automatic Steam fallback: a fallback would reintroduce the launcher
that rewrites the mod list. If direct Proton cannot be resolved, fix the
reported prerequisite and retry.

The launch guard is bounded to three seconds. A rewrite after that window is
not detected by this check; the next launch's pre-launch check rejects it.

### How the Windows launch path works

The Windows launch path is direct:

```text
manager verifies used_mods.txt matches the selected order
  -> verifies the Steam client process is running
  -> starts <game>/Warhammer3.exe with used_mods.txt; and cwd=<game>
  -> manager watches used_mods.txt for 3 seconds
  -> if it changed, kills the spawned process and restores the snapshot
```

Steam is not the parent of the game and the Creative Assembly launcher is not
invoked. Do not launch WH3 through Steam manually: that path still opens the CA
launcher and can rewrite `used_mods.txt`. The manager will detect the mismatch
on the next launch and ask you to apply the order again.

### The game opens but a mod does not load

A Workshop or custom-folder pack needs a working-directory line before its
`mod` line:

```text
add_working_directory "C:\...\steamapps\workshop\content\1142710\<workshop-id>";
mod "the-mod.pack";
```

`used_mods.txt` must contain the folder that holds the pack. A local pack in
`<game>/data/` does not need one.

On Linux/Proton, the Windows game needs a Windows-visible path. The manager
writes Unix absolute directories with Proton's default `Z:` drive mapping:

```text
add_working_directory "Z:/home/player/.local/share/Steam/steamapps/workshop/content/1142710/<workshop-id>";
mod "the-mod.pack";
```

A bare `/home/...` directory can leave the Workshop pack undiscoverable even
when the file exists on Linux. After updating from a build that wrote bare Unix
paths, click **Apply Load Order** to regenerate the file before launching.

Check, in order:

1. The pack path. A Workshop mod lives under
   `steamapps/workshop/content/1142710/<id>`; a local mod usually lives under
   `<game>/data`.
2. That the Workshop folder appears in `add_working_directory`; if it is missing,
   click **Apply Load Order** again with the current build.
3. That the pack name in `mod "…";` is the actual `.pack` file name, not the
   Workshop title.
4. That the mod's dependencies and game-version compatibility are satisfied.
5. That Steam was running before the direct launch and is logged in.

For a controlled comparison, launch once through Steam/the CA launcher with the
same mod, copy the working `used_mods.txt`, then compare it byte-for-byte with
the manager's file. The CA file is the ground truth for the current game build.

## General codes

| Code | Meaning | Likely cause | What to check |
|---|---|---|---|
| `io` | A filesystem or process I/O operation failed. | Permission denied, a file disappeared, a read-only directory, or a failed process start. | Read `details` for the path and OS error. Check permissions and free space, then retry. |
| `config_corrupt` | Persisted app state could not be parsed or validated. | `config.json`, its backup, or `used_mods.txt` is malformed or unreadable. | Keep both files; use the Settings restore path for a valid backup. The core never silently overwrites corrupt state. |
| `game_not_found` | Total War: Warhammer III was not located. | The game is not installed, the library is not in `libraryfolders.vdf`, or the manual path is wrong. | Use Settings → Game path and select the folder containing `data/`. Confirm `appmanifest_1142710.acf`. |
| `steam_not_found` | Steam could not be located or read. | Steam is not installed, its library metadata is unreadable, or the game path is outside a discovered library. | Check native Steam, the `libraryfolders.vdf` entries, and the Workshop/ACF paths. Flatpak/Snap launch is not covered by the Linux build. |
| `steam_not_running` | Steam is installed but its client process is not running. | The manager launches WH3 directly on Windows, so Steamworks needs the Steam client already open. | Start Steam, wait for the login to finish, then launch again. |
| `process_detection_failed` | The manager could not determine whether the game or Steam is running. | `/proc` or `tasklist` was unavailable or returned an error. | Close WH3 or start Steam manually, confirm the process list is readable, then retry. Launch is blocked rather than risking a second instance. |
| `pack_parse_failed` | A `.pack` file is malformed or unreadable. | Bad PFH5 header, truncated file, or an invalid index. | Find the pack path in `details`; the mod stays listed with `packError`. Remove or repair the pack. |
| `not_found` | A requested mod, profile, or tag does not exist. | The UI sent a stale id after a refresh or deletion. | Refresh the view and retry. |
| `validation` | Caller-supplied input is invalid. | Invalid profile name, empty write without confirmation, unmanaged-directive loss without confirmation, or launching while the game runs. | Read the message; it names the confirmation or input that must change. |
| `internal` | An unexpected failure occurred. | A bug or an unhandled bridge/panic path. | Record the message, `details`, and the steps; report the issue. No stack trace is shown in the UI. |

## Collecting evidence for a report

1. The exact `code`, `message`, and `details` from the error banner.
2. The game path, Steam root, and Proton prefix from Settings.
3. Whether `Warhammer3.exe` exists.
4. The `CompatToolMapping` entry for `1142710` in `config/config.vdf`.
5. The Proton and `SteamLinuxRuntime*` directories under `steamapps/common`.
6. A copy of `used_mods.txt` and its hash before and after the failed launch.
7. The command line of any surviving process (`ps -eo pid,args` on Linux).


## Maintainer release process

Keep one `X.Y.Z` version in `Cargo.toml`, `crates/wh3mm-app/tauri.conf.json`, root
`package.json`, and `frontend/package.json`. Update CHANGELOG, build the embedded
frontend, and pass the current-head checks in [testing](TESTING.md). Package changes
must pass the Linux install/startup/signature matrix. Exercise Windows installer
and real desktop/game behavior separately; do not substitute compilation for QA.

Create a `vX.Y.Z` tag only for a reviewed, verified release commit. `release.yml`
builds Windows NSIS and all Linux formats, combines/verifies SHA-256 checksums,
and creates a **draft** GitHub release. Manual dispatch can build artifacts without
publishing. Review the assets and notes, verify installation and removal on target
systems, then publish only with maintainer authorization. Published releases can
trigger the separately configured signed repository publisher described above.

To reproduce native packages after building the frontend:

```bash
cd crates/wh3mm-app
# Linux:
npx --yes @tauri-apps/cli@2.12.4 build --ci --bundles deb,appimage,rpm
# Windows (MSVC host):
# npx --yes @tauri-apps/cli@2.12.4 build --ci --bundles nsis
```

Build outputs are under workspace `target/release/bundle/`. Arch, Flatpak, and
Nix/Gentoo recipe staging use the exact release tarball in the Linux workflow.
Production signing keys live in environment secrets, never files in the repo.
Checksums are not code signing; the Windows installer remains unsigned unless
signing is explicitly configured.

For rollback, preserve published tags and their artifacts. Publish a new patch
release or clearly select an older package; do not silently replace a published
tag. Keep user configuration/load-order backups and restore `used_mods.txt.bak`
only through an explicit recovery step. The manager must never edit pack archives
to repair a packaging or launch failure.
