#!/usr/bin/env bash
# Verify every committed fixture, then regenerate and verify the gitignored perf workloads.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

printf '== committed QA fixtures ==\n'
node scripts/qa/generate-fixtures.mjs --verify

printf '== perf workloads (generated, gitignored) ==\n'
node scripts/perf/generate-suite.mjs
node scripts/perf/generate-suite.mjs --verify perf-fixture
