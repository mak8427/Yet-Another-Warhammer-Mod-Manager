#!/usr/bin/env bash
# Usage: build.sh <release-tarball> <output-dir>
set -euo pipefail
[[ $# == 2 ]] || { echo "usage: build.sh <release-tarball> <output-dir>" >&2; exit 2; }
tarball=$(realpath "$1")
mkdir -p "$2"
out=$(realpath "$2")
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$script_dir"/*.json "$script_dir"/*.xml "$work/"
cp "$tarball" "$work/release.tar.gz"
flatpak-builder --user --force-clean --disable-rofiles-fuse --repo="$out/flatpak-repo" \
  "$work/build" "$work/com.warhammerlabs.wh3mm.json"
flatpak build-bundle "$out/flatpak-repo" "$out/wh3mm-linux-x86_64.flatpak" \
  com.warhammerlabs.wh3mm master --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
