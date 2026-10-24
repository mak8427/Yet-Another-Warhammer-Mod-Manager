# Performance

Measure this app using fixed synthetic workloads and release builds. Report the
commit, host, fixture digest, command, sample count, and raw output with any speed
claim. Core measurements exclude WebView creation/paint and are not complete UI
startup timings.

## Benchmarks and scan budgets

```bash
pnpm bench
pnpm bench:budget
```

The first command generates/verifies the deterministic 100/500/2000-pack suite,
then runs Criterion's `hot_paths` bench. Workloads use seed `20261020`; suite digest:
`d8896967d0910fe6e3b8c1a6f5ae0a46f47d5cfd4c079c8d4ead98c3bc024217`.
Generated packs live in ignored `perf-fixture/`; do not commit them.

The scan budget is **2.3 ms** at 500 mods and **10 ms** at 2000 mods. These are
wall-clock budgets from the Linux i9-13900K baseline, not portable assertions about
shared runners. Use that host class when claiming a budget pass. Diagnostic
command-line overrides must not become relaxed defaults.

## Cold-process session measurements

```bash
cargo build --release -p wh3mm-perf --locked
node scripts/perf/generate-fixture.mjs --out perf-fixture/wh3-500 --count 500
pnpm perf:measure -- --bin target/release/wh3mm-perf --runs 12 --out /tmp/wh3mm-perf.json
```

The harness starts a fresh process/config directory for each sample and records
host information, executable/fixture hashes, individual runs, medians, spread,
and raw logs. It measures core initialization, list serialization, header scanning,
load-order persistence, and profile switching. Optional `--stub <executable>` adds
a **process-start proxy**; this does not launch the game or measure game loading.
The fixture is synthetic and disposable; never point the harness at personal
configuration or a real game directory.

The `Core performance` workflow runs the same measurement on Windows. Its
`scan_budget` dispatch option uses a separately configured stable self-hosted
runner; noisy hosted runners do not enforce those wall-clock budgets.

Compare this app's before/after results using the same host class and fixture.
Do not fabricate samples, hide failed runs, or claim that old evidence measures
the current commit. If a suitable host is unavailable, say so and keep the current
budgets rather than presenting unrelated hardware as a regression check.
