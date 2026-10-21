#!/usr/bin/env bash
# Reproduces the legacy WH3 Mod Manager baseline procedure.
#
# Stage 1 (any OS): build the 500-mod fixture and verify its digest.
# Stage 2 (Windows only): run the official release build against it, N times, and record medians.
#
# The legacy app only ships a win32-x64 release build, so stage 2 needs a Windows host.
# Without one the script stops after stage 1 and exits 2 with the exact command to run elsewhere.
#
# Environment:
#   WH3MM_APP       path to the extracted release wh3mm.exe (stage 2)
#   WH3MM_RUNS      number of measured runs (default 12)
#   WH3MM_FIXTURE   fixture directory (default: $REPO/perf-fixture/wh3-500)
#   WH3MM_OUT       JSON output (default: $REPO/docs/perf/legacy-baseline.json)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="${WH3MM_FIXTURE:-$repo_root/perf-fixture/wh3-500}"
out="${WH3MM_OUT:-$repo_root/docs/perf/legacy-baseline.json}"
runs="${WH3MM_RUNS:-12}"
mode="${1:-all}"

echo "== fixture =="
node "$repo_root/scripts/perf/generate-fixture.mjs" --out "$fixture" --count 500
node "$repo_root/scripts/perf/generate-fixture.mjs" --verify "$fixture"

if [[ "$mode" == "--fixture-only" ]]; then
  echo "fixture-only mode: skipping measurement"
  exit 0
fi

echo "== legacy release build =="
if [[ -z "${WH3MM_APP:-}" ]]; then
  cat >&2 <<'EOF'

BLOCKED: WH3MM_APP is not set, so there is no release build to measure.

The official legacy release is win32-x64 only:
  gh release download v2.29.0 --repo Shazbot/WH3-Mod-Manager \
    --pattern 'wh3mm-win32-x64-2.29.0.zip' --dir /tmp/wh3mm-release
  unzip /tmp/wh3mm-release/wh3mm-win32-x64-2.29.0.zip -d /tmp/wh3mm-release/app
  WH3MM_APP=/tmp/wh3mm-release/app/wh3mm.exe bash scripts/perf/legacy-baseline.sh

On a Windows host the same command runs all twelve measured passes and writes docs/perf/legacy-baseline.json.
On Linux/macOS this stage cannot run: the release has no Linux/macOS artefact and the app needs a
Windows desktop session. See docs/PERF.md ("Legacy baseline / Feasibility").
EOF
  exit 2
fi

if [[ "$(uname -s)" != MINGW* && "$(uname -s)" != MSYS* && "$(uname -s)" != CYGWIN* && "${OS:-}" != Windows_NT ]]; then
  echo "WARNING: not running on Windows; the legacy release build will not start here." >&2
fi

mkdir -p "$(dirname "$out")"
node "$repo_root/scripts/perf/measure-legacy.mjs" \
  --app "$WH3MM_APP" \
  --fixture "$fixture" \
  --runs "$runs" \
  --out "$out"

echo "== done: $out =="
