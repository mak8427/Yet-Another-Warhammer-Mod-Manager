#!/usr/bin/env bash
# Build the Arch wh3mm-bin package from a release tarball.
#
# Usage: build-package.sh <version> <tarball> <out-dir>
#
# The package is built from the same tarball that ships in the release, so CI
# proves that the published artifact installs on Arch. makepkg refuses to run
# as root, so when this script runs as root (the archlinux container) it drops
# to a throwaway builder account.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: build-package.sh <version> <tarball> <out-dir>" >&2
  exit 2
fi

version=$1
tarball=$2
out_dir=$3

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=${GITHUB_REPOSITORY:-mak8427/Warhammer_mod_manager}
tarball_name=$(basename "$tarball")

[ -f "$tarball" ] || {
  echo "build-package.sh: tarball '$tarball' not found" >&2
  exit 1
}

sha256=$(sha256sum "$tarball" | awk '{print $1}')
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp "$tarball" "$work/$tarball_name"
"$script_dir/render.sh" "$version" "$sha256" "file://$work/$tarball_name" "$work"

if [ "$(id -u)" -eq 0 ]; then
  id builder >/dev/null 2>&1 || useradd --create-home builder
  chown -R builder:builder "$work"
  su builder -s /bin/bash -c "cd '$work' && PKGDEST='$work' makepkg --noconfirm --cleanbuild --force --nodeps"
else
  (cd "$work" && PKGDEST="$work" makepkg --noconfirm --cleanbuild --force --nodeps)
fi

mkdir -p "$out_dir" "$out_dir/aur"
cp "$work"/wh3mm-bin-*.pkg.tar.zst "$out_dir/"

# The release URL only resolves once the draft release is published. The
# PKGBUILD is attached to the release for the AUR submission.
"$script_dir/render.sh" "$version" "$sha256" \
  "https://github.com/$repo/releases/download/v$version/$tarball_name" \
  "$out_dir/aur"

echo "build-package.sh: built $(basename "$out_dir"/wh3mm-bin-*.pkg.tar.zst)"
