#!/usr/bin/env bash
# Build a signed static repository tree; never deploys or installs packages.
# Needs apt-utils, createrepo-c, rpm/rpmsign, repo-add, flatpak/ostree and GPG.
# Usage: SIGNING_KEY=<fingerprint> BASE_URL=https://... build.sh <assets> <out>
set -euo pipefail
[[ $# == 2 ]] || { echo 'usage: build.sh <release-assets> <output-dir>' >&2; exit 2; }
: "${SIGNING_KEY:?Set the signing key fingerprint}"
: "${BASE_URL:?Set the public HTTPS repository URL}"
[[ $SIGNING_KEY =~ ^[A-F0-9]{40}$ && $BASE_URL =~ ^https://[A-Za-z0-9./_-]+$ ]] || exit 2
[[ ! -e $2 ]] || { echo 'Output must be a new directory.' >&2; exit 2; }
assets=$(realpath "$1")
mkdir -p "$2"
out=$(realpath "$2")
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
gpg --batch --export "$SIGNING_KEY" > "$out/repository-key.gpg"
gpg --batch --armor --export "$SIGNING_KEY" > "$out/repository-key.asc"
[[ -s $out/repository-key.gpg ]] || { echo 'Signing key not found' >&2; exit 1; }
mkdir -p "$out/apt/pool/main" "$out/apt/dists/stable/main/binary-amd64" "$out/rpm" "$out/arch/x86_64" "$out/flatpak"
cp "$assets"/*.deb "$out/apt/pool/main/"
cp "$assets"/*.rpm "$out/rpm/"
cp "$assets"/*.pkg.tar.zst "$out/arch/x86_64/"
(
  cd "$out/apt"
  apt-ftparchive packages pool > dists/stable/main/binary-amd64/Packages
  gzip -k dists/stable/main/binary-amd64/Packages
  apt-ftparchive -o APT::FTPArchive::Release::Origin=WH3MM \
    -o APT::FTPArchive::Release::Codename=stable \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Architectures=amd64 \
    -o APT::FTPArchive::Release::Components=main release dists/stable > dists/stable/Release
  gpg --batch --yes --local-user "$SIGNING_KEY" --clearsign --output dists/stable/InRelease dists/stable/Release
  gpg --batch --yes --local-user "$SIGNING_KEY" --armor --detach-sign --output dists/stable/Release.gpg dists/stable/Release
)
for package in "$out/rpm"/*.rpm; do
  rpmsign --define "_gpg_name $SIGNING_KEY" --define "_gpg_path $GNUPGHOME" \
    --define '__gpg /usr/bin/gpg' --addsign "$package"
done
createrepo_c "$out/rpm"
gpg --batch --yes --local-user "$SIGNING_KEY" --armor --detach-sign "$out/rpm/repodata/repomd.xml"
(
  cd "$out/arch/x86_64"
  for package in *.pkg.tar.zst; do
    gpg --batch --yes --local-user "$SIGNING_KEY" --detach-sign "$package"
  done
  repo-add wh3mm.db.tar.gz ./*.pkg.tar.zst
  # Pages does not preserve symlinks; publish actual .db/.files payloads.
  for name in wh3mm.db wh3mm.files; do
    rm "$name"
    cp "$name.tar.gz" "$name"
    gpg --batch --yes --local-user "$SIGNING_KEY" --detach-sign "$name"
  done
)
# Import the offline release bundle and sign its commit and summary. The
# unsigned build artifact is never exposed as an unsigned update remote.
ostree --repo="$out/flatpak" init --mode=archive-z2
flatpak build-import-bundle "$out/flatpak" "$assets/wh3mm-linux-x86_64.flatpak"
flatpak build-sign --gpg-sign="$SIGNING_KEY" "$out/flatpak" com.warhammerlabs.wh3mm master
flatpak build-update-repo --gpg-sign="$SIGNING_KEY" "$out/flatpak"
key=$(base64 -w0 "$out/repository-key.gpg")
cat > "$out/flatpak/wh3mm.flatpakref" <<REF
[Flatpak Ref]
Name=com.warhammerlabs.wh3mm
Branch=master
Title=Yet Another Warhammer Mod Manager
Url=$BASE_URL/flatpak
GPGKey=$key
RuntimeRepo=https://flathub.org/repo/flathub.flatpakrepo
IsRuntime=false
REF
sed -e "s|@BASE_URL@|$BASE_URL|g" -e "s|@FINGERPRINT@|$SIGNING_KEY|g" "$script_dir/setup.sh.in" > "$out/setup.sh"
printf '%s\n' "$SIGNING_KEY" > "$out/KEY_FINGERPRINT.txt"
touch "$out/.nojekyll"
printf '<!doctype html><title>Yet Another Warhammer Mod Manager packages</title><h1>Yet Another Warhammer Mod Manager packages</h1><p>Signing key: <code>%s</code></p><a href="flatpak/wh3mm.flatpakref">Install Flatpak</a> · <a href="setup.sh">Native repository setup</a>\n' "$SIGNING_KEY" > "$out/index.html"
echo "Signed repository staged in $out"
