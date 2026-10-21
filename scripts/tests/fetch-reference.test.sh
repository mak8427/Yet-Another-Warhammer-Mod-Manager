#!/usr/bin/env bash
set -euo pipefail

readonly PINNED_COMMIT="07fcf3ea1428fe3aa88282ba7aed44d9947ef103"
readonly TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$TEST_DIR/../.." && pwd)"
readonly SCRIPT="$REPO_ROOT/scripts/fetch-reference.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

commit_all() {
  git -C "$1" -c user.name=Test -c user.email=test@example.invalid add -A
  git -C "$1" -c user.name=Test -c user.email=test@example.invalid commit -q -m "${2:-fixture}"
}

# Build a throwaway repository around a copy of the script so the enclosing
# repository can be made a git checkout (the regression in WAR-23) and the
# pinned commit can be pointed at a fixture commit.
new_case() {
  local dir="$1" pinned="$2"
  mkdir -p "$dir/scripts"
  if [ -n "$pinned" ]; then
    sed "s|^readonly PINNED_COMMIT=.*|readonly PINNED_COMMIT=\"$pinned\"|" \
      "$SCRIPT" > "$dir/scripts/fetch-reference.sh"
  else
    cp "$SCRIPT" "$dir/scripts/fetch-reference.sh"
  fi
  git init -q "$dir"
}

run_case() {
  local name="$1" dir="$2" want_code="$3" want_text="$4"
  local output code
  set +e
  output="$(bash "$dir/scripts/fetch-reference.sh" 2>&1)"
  code=$?
  set -e
  [ "$code" -eq "$want_code" ] ||
    fail "$name: exit $code, want $want_code; output: $output"
  case "$output" in
    *"$want_text"*) printf 'ok: %s\n' "$name" ;;
    *) fail "$name: output does not contain '$want_text'; got: $output" ;;
  esac
}

bash -n "$SCRIPT" || fail "scripts/fetch-reference.sh has a syntax error"
grep -Fq "readonly PINNED_COMMIT=\"$PINNED_COMMIT\"" "$SCRIPT" ||
  fail "pinned commit changed; update this test with the re-pin"

sandbox="$(mktemp -d)"
trap 'rm -rf -- "$sandbox"' EXIT

# A non-git directory inside a product checkout must not inherit the product
# HEAD: git would otherwise walk up to the enclosing repository.
case_dir="$sandbox/non-git"
new_case "$case_dir" ""
commit_all "$case_dir" "business as usual"
mkdir -p "$case_dir/reference/WH3-Mod-Manager"
touch "$case_dir/reference/WH3-Mod-Manager/file"
run_case "non-git directory" "$case_dir" 1 \
  "reference/WH3-Mod-Manager exists but is not a git checkout"

case_dir="$sandbox/wrong-revision"
new_case "$case_dir" ""
mkdir -p "$case_dir/reference/WH3-Mod-Manager"
git init -q "$case_dir/reference/WH3-Mod-Manager"
touch "$case_dir/reference/WH3-Mod-Manager/file"
commit_all "$case_dir/reference/WH3-Mod-Manager" "other revision"
actual="$(git -C "$case_dir/reference/WH3-Mod-Manager" rev-parse HEAD)"
run_case "wrong revision" "$case_dir" 1 \
  "reference/WH3-Mod-Manager is at $actual, not $PINNED_COMMIT"

case_dir="$sandbox/correct-revision"
mkdir -p "$case_dir/reference/WH3-Mod-Manager"
git init -q "$case_dir/reference/WH3-Mod-Manager"
touch "$case_dir/reference/WH3-Mod-Manager/file"
commit_all "$case_dir/reference/WH3-Mod-Manager" "pinned revision"
pinned="$(git -C "$case_dir/reference/WH3-Mod-Manager" rev-parse HEAD)"
new_case "$case_dir" "$pinned"
run_case "pinned revision" "$case_dir" 0 \
  "reference checkout already at $pinned"

printf 'all fetch-reference tests passed\n'
