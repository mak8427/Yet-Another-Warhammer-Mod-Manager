#!/usr/bin/env bash
# One documented command for the WAR-7 core benchmarks: build the deterministic workloads,
# verify them, then run the optimized Criterion suite.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

node scripts/perf/generate-suite.mjs
node scripts/perf/generate-suite.mjs --verify perf-fixture
cargo_bin="$(command -v cargo || true)"
if [ -z "$cargo_bin" ] && [ -x "$HOME/.cargo/bin/cargo" ]; then
  cargo_bin="$HOME/.cargo/bin/cargo"
fi
if [ -z "$cargo_bin" ]; then
  printf 'error: cargo is not on PATH\n' >&2
  exit 1
fi
exec "$cargo_bin" bench -p wh3mm-core --bench hot_paths --locked "$@"
