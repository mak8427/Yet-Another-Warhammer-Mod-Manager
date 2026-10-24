#!/usr/bin/env bash
# Render the AUR-ready wh3mm-bin PKGBUILD and .SRCINFO.
#
# Usage: render.sh <version> <sha256> <source-url> <out-dir>
#
# <source-url> is the release tarball URL for AUR uploads, or a file:// URL for
# a local build. The package name stays wh3mm-bin in both cases; the archive
# contains the prebuilt binary, desktop entry, and icon.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: render.sh <version> <sha256> <source-url> <out-dir>" >&2
  exit 2
fi

version=$1
sha256=$2
source_url=$3
out_dir=$4

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "render.sh: version '$version' is not X.Y.Z" >&2
  exit 1
fi
if ! [[ "$sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "render.sh: '$sha256' is not a SHA-256 digest" >&2
  exit 1
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
template="$script_dir/PKGBUILD.in"
mkdir -p "$out_dir"

sed \
  -e "s|@PKGVER@|$version|g" \
  -e "s|@SHA256@|$sha256|g" \
  -e "s|@SOURCE_URL@|$source_url|g" \
  "$template" >"$out_dir/PKGBUILD"

cat >"$out_dir/.SRCINFO" <<EOF
pkgbase = wh3mm-bin
	pkgdesc = Mod manager for Total War: Warhammer III
	pkgver = $version
	pkgrel = 1
	url = https://github.com/mak8427/Warhammer_mod_manager
	arch = x86_64
	license = MIT
	depends = webkit2gtk-4.1
	depends = gtk3
	depends = libayatana-appindicator
	depends = librsvg
	provides = wh3mm
	conflicts = wh3mm
	source = wh3mm-$version-linux-x86_64.tar.gz::$source_url
	sha256sums = $sha256

pkgname = wh3mm-bin
EOF

echo "render.sh: wrote $out_dir/PKGBUILD and $out_dir/.SRCINFO"
