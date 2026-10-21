#!/usr/bin/env bash
set -euo pipefail

readonly REPO_URL="https://github.com/Shazbot/WH3-Mod-Manager.git"
readonly PINNED_COMMIT="07fcf3ea1428fe3aa88282ba7aed44d9947ef103"
readonly REFERENCE_DIR="reference/WH3-Mod-Manager"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || die "git is not installed or not on PATH"

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ -e "$REFERENCE_DIR" ]; then
  if git -C "$REFERENCE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    current="$(git -C "$REFERENCE_DIR" rev-parse HEAD 2>/dev/null || true)"
    if [ "$current" = "$PINNED_COMMIT" ]; then
      printf 'reference checkout already at %s\n' "$PINNED_COMMIT"
      exit 0
    fi
    die "$REFERENCE_DIR is at ${current:-an unknown revision}, not $PINNED_COMMIT; remove it and re-run this script"
  fi
  die "$REFERENCE_DIR exists but is not a git checkout; remove it and re-run this script"
fi

parent="$(dirname -- "$REFERENCE_DIR")"
mkdir -p -- "$parent"
staging="$(mktemp -d "$parent/.wh3mm-reference.XXXXXX")"
cleanup() {
  rm -rf -- "$staging"
}
trap cleanup EXIT

git init --quiet "$staging"
git -C "$staging" remote add origin "$REPO_URL"

if ! git -C "$staging" fetch --quiet --depth 1 --no-tags origin "$PINNED_COMMIT"; then
  die "could not fetch $PINNED_COMMIT from $REPO_URL; check network access and that git can reach GitHub"
fi

git -C "$staging" -c advice.detachedHead=false checkout --quiet --detach FETCH_HEAD

actual="$(git -C "$staging" rev-parse HEAD)"
[ "$actual" = "$PINNED_COMMIT" ] || die "fetched $actual instead of $PINNED_COMMIT"

mv -- "$staging" "$REFERENCE_DIR"
trap - EXIT
printf 'fetched %s into %s\n' "$PINNED_COMMIT" "$REFERENCE_DIR"
