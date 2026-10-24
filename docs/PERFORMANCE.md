# Performance

Performance claims need a release build, fixture digest, command, host description,
run count, and raw output. Committed JSON/logs under `docs/perf/` are evidence;
they do not automatically describe the current commit.

## Core benchmarks

```bash
pnpm bench
pnpm bench:budget
```

The first command generates/verifies the deterministic 100/500/2000-pack suite,
then runs Criterion's `hot_paths` bench in release mode. Workloads share seed
`20261020`; suite digest:
`d8896967d0910fe6e3b8c1a6f5ae0a46f47d5cfd4c079c8d4ead98c3bc024217`.
Generated packs live in ignored `perf-fixture/`; do not commit them.

`scan-budget.mjs` checks 500-mod scanning against **2.3 ms** and 2000-mod scanning
against **10 ms**. These are wall-clock budgets from the Linux i9-13900K baseline,
not portable assertions about shared runners. Use the same host class when
reporting budget results. Diagnostic overrides must not become relaxed defaults.

## App vs legacy comparison

The legacy reference is release 2.29.0 of Shazbot/WH3-Mod-Manager, pinned source
`07fcf3ea1428fe3aa88282ba7aed44d9947ef103`. Its official comparison artifact is
Windows x64; Linux smoke numbers are not equivalent to the Windows comparison.

The comparison fixture has 500 pack files, with duplicate Workshop/local copies
and malformed variants; both measured apps list 492 deduplicated mods. Its digest
is `1de7de625da9ee53d1101a764d07d5ccbb61975932816c8b43574b648d0ab73a`.
Use release builds and the same fixture/host class on both sides. Record at least
five samples; the committed reference comparison uses twelve cold passes on the
same GitHub-hosted Windows runner class/image, not one physical machine.

Workflows `.github/workflows/perf-legacy-baseline.yml` and `perf-new-app.yml`
run the harnesses. Scripts under `scripts/perf/` generate the fixture, measure
legacy/new-app behavior, and produce raw JSON/logs. Read their options before
running on another host. An official legacy binary and Windows desktop session
are required for the Windows reference; fetching source alone is insufficient.

Metrics include cold start, 500-mod load, load-order apply, profile switch, and
launch handoff. **Launch is a process-start proxy**, not an in-game loading time.
A fast proxy does not establish that the game loaded selected mods.

```bash
pnpm perf:gate
# Equivalent:
node scripts/qa/verify-perf-gate.mjs
```

The validator checks `docs/perf/comparison.json`, referenced raw evidence, matching
host/fixture/build context, sample counts, sample medians, and strictly faster
measured paths. It warns when headline improvements miss the 2× target. Do not
fabricate samples, delete inconvenient runs, change the comparator's meaning, or
represent a historical comparison as a new measurement.

For performance-sensitive changes, include before/after results and exact commands
in the PR. If a suitable host is unavailable, report that limitation and keep the
existing budgets/evidence rather than claiming a pass from unrelated hardware.
