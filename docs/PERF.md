# Performance

This file records how we measure the paths users feel, on which machine, and with which command.
A number without an environment and a command does not belong here.

## Legacy baseline

Target: the unmodified WH3 Mod Manager release build, used as the A/B reference for the rebuild.

| Field | Value |
| --- | --- |
| Project | https://github.com/Shazbot/WH3-Mod-Manager |
| Commit | `07fcf3ea1428fe3aa88282ba7aed44d9947ef103` (2026-10-19) |
| Version | 2.29.0 |
| Build | official release asset `wh3mm-win32-x64-2.29.0.zip` (189,503,549 bytes), not a dev build |
| Licence | MIT |
| Host | GitHub-hosted `windows-latest`, 12 cold runs per metric |

### Host and scope decision (2026-10-21)

The CEO decided the final legacy A/B runs on `windows-latest` CI, with 10+ runs, median and IQR,
and the raw output in this file. No dedicated VM and no purchase is authorised. Repeated runs plus a
published distribution handle the runner-to-runner variance; a physical Windows box stays optional
and owner-provided, and it only re-validates the game-launch metric. The earlier host question is
withdrawn and is no longer a blocker.

Scope of deliverable 3, as decided:

- `load-order apply/persist` and `profile/preset switch` are measured on the same CI run and fixture.
- `game launch handoff` is a **documented proxy**: from the renderer's Play action to the spawn of a
  stub game process. It is labelled `proxy` here and in the JSON. It is not a TW:WH3 launch.
- The ≥2x bar applies to cold start and 500-mod load only. The other metrics must be strictly faster
  than legacy on the same harness, or the gap must be explained with evidence.

### Method

1. Generate the fixture:

   ```bash
   node scripts/perf/generate-fixture.mjs --out perf-fixture/wh3-500 --count 500
   node scripts/perf/generate-fixture.mjs --verify perf-fixture/wh3-500
   ```

   The fixture is **not committed**: 500 binary packs, ~3.3 MB, rebuilt byte-for-byte from seed
   `20261020`. `fixture-manifest.json` records the variant counts and a SHA-256 over every pack.
   Current content:

   | Variant | Files |
   | --- | --- |
   | valid PFH5 | 339 |
   | unicode-name PFH5 | 85 |
   | duplicate-name PFH5 (8 names, data + content copy) | 16 |
   | bad magic | 15 |
   | truncated header | 15 |
   | inconsistent index | 15 |
   | empty file | 15 |
   | **total** | **500** |

   So 440 files are structurally well-formed PFH5 packs and 60 are deliberately malformed. The 16
   duplicate files carry 8 distinct names; the legacy app removes the 8 content copies, which is why
   it lists 492 mods, not 500.

   The generated packs were checked against the legacy project's own parser
   (`src/compressionAnalysis/analyzer.ts`, `parsePFH5PackBuffer`): all 432 well-formed packs in
   `data/` parse, all 60 malformed packs are rejected. The 8 content copies are not parsed
   separately; they are deduped. The fixture exercises the real code path, not a look-alike format.

2. Download and extract the release build (Windows):

   ```powershell
   gh release download v2.29.0 --repo Shazbot/WH3-Mod-Manager --pattern "wh3mm-win32-x64-2.29.0.zip" --dir C:\wh3mm
   Expand-Archive C:\wh3mm\wh3mm-win32-x64-2.29.0.zip -DestinationPath C:\wh3mm\app
   ```

3. Build the process-start stub and run twelve cold passes:

   ```powershell
   # The workflow compiles a tiny stub that writes the marker file named in WH3MM_STUB_MARKER and
   # exits. Any equivalent stub works. CI has no game install, so this stands in for Warhammer3.exe.
   $env:WH3MM_GAME_STUB = "C:\wh3mm\Warhammer3.exe"
   $env:WH3MM_APP = "C:\wh3mm\app\wh3mm.exe"
   $env:WH3MM_RUNS = "12"
   bash scripts/perf/legacy-baseline.sh
   ```

   or run the `Perf legacy baseline` workflow (`.github/workflows/perf-legacy-baseline.yml`). Both
   write `docs/perf/legacy-baseline.json` and keep one raw stdout log per run under the run's
   temporary directory, `docs/perf/.legacy-baseline-<timestamp>/run-<n>.log`. The committed
   evidence copies are renamed to `docs/perf/legacy-baseline-run-<actions-run-id>/run-<n>.log`, so
   the path in the report (`rawLogDirectory` / `runs[].logPath`) always resolves in the branch.

   Each run starts with a fresh `--user-data-dir`, removes `pack-headers-cache.bin`, and passes
   `-nogpu`. One fixed cost is included and labelled: the app waits up to 5,000 ms for Steam
   workshop subscription ids. On a machine without Steam every run pays that wait; subtract it
   before comparing to the new app's scan numbers.

### What the runner measures

The legacy app already logs its own startup instrumentation. The runner never patches it.

| Metric | Source | Status |
| --- | --- | --- |
| Cold start to interactive | `[startup] Main renderer React mounted after Nms` | measured, 12 runs |
| DOM ready / bundle load | `[startup] Main renderer DOM ready` / `finished loading` | measured, 12 runs |
| 500-mod enumeration | `before subscription filter: N` log line | measured, 12 runs |
| Mod list populated | `after subscription filter: N` log line (main sends `modsPopulated` right after) | measured, 12 runs |
| 500-mod PFH5 header parse | first write of `pack-headers-cache.bin` in the run's user-data directory, minus the enumeration timestamp | measured, 12 runs |
| Load-order apply/persist | CDP drop of a row at position 5 to the legacy app's own `config.json` write (v2.29.0 has no Apply button; it persists through the debounced `saveConfig`) | measured, 12/12 verified |
| Preset (profile) switch | CDP keyboard selection of the `Perf Half` preset to the `config.json` write that persists the new enabled set | measured, 12/12 verified |
| Game launch handoff | **proxy**: DOM click on `#playGame` to the marker write of a compiled stub `Warhammer3.exe` | measured, 11/12, `proxy` |

The game-launch proxy covers the renderer click, `startGame` IPC, `used_mods.txt` write, launch-plan
resolution, process creation and stub startup. It excludes Steam, the game engine, a real TW:WH3
launch, and anything that depends on a real game install. CI has no game install and no real game
data, so this number must never be presented as a full launch time.

Raw output: `docs/perf/legacy-baseline.json` (schema `wh3mm.perf.legacy-baseline.v1`) plus the
per-run logs. JSON, not screenshots. Medians, IQR, min/max, standard deviation and coefficient of
variation are computed over the successful runs.

### Measured baseline (final, GitHub `windows-latest`)

Run: [actions run 39577999775](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39577999775),
2026-10-21. Raw report: `docs/perf/legacy-baseline.json`. Raw stdout logs:
`docs/perf/legacy-baseline-run-39577999775/run-1..12.log`.

| Field | Value |
| --- | --- |
| OS | Microsoft Windows Server 2025, `10.0.26100.33650`, x64 |
| CPU | AMD64 Family 25 Model 1 Stepping 1 (`AuthenticAMD`), 2 cores |
| RAM | 8 GiB (5.2 GiB free at start) |
| Runner | GitHub Actions `win25-vs2026`, image `20261018.275.1` |
| Node | v22.23.3 |
| App asset SHA-256 | `3f8aa1b5d096b9f7c5bf387f4bf9fde3f47012d7e93d274d393a0514ca8c99da` |
| Fixture | 500 packs, sha256 `1de7de62…` (identical on Windows and POSIX) |
| Stub | compiled `Warhammer3.exe`, sha256 `e1efcd6e…` |

Twelve cold runs, fresh `--user-data-dir` and no header cache before each:

| Metric | n | Median | IQR | Min | Max | Stdev | CV |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cold start to React mounted | 12 | **1322 ms** | 213 ms | 1268 ms | 2019 ms | 218 ms | 15.2% |
| Mod list populated (500 packs) | 12 | **6862 ms** | 635 ms | 6815 ms | 8357 ms | 532 ms | 7.4% |
| PFH5 header scan (all mods) | 12 | **990 ms** | 64 ms | 645 ms | 1294 ms | 137 ms | 13.9% |
| Load-order apply/persist | 12 | **279 ms** | 13 ms | 272 ms | 293 ms | 7 ms | 2.6% |
| Preset switch (`Perf All` → `Perf Half`) | 12 | **298 ms** | 14 ms | 287 ms | 312 ms | 8 ms | 2.8% |
| Game launch handoff (**proxy**, stub process start) | 11 | **6163 ms** | 271 ms | 5860 ms | 6515 ms | 205 ms | 3.3% |

The app reported **492 mods** on every run. That is correct, not a fixture defect: the 500 packs
include 8 data/content pairs with the same name, and the legacy app deliberately removes content
copies that duplicate a data mod. 492 = 500 − 8.

The one missing game-launch sample is run 1: the app ran out of memory while re-reading the packs
for the launch path on the cold page cache (`OOM error in V8: Ineffective mark-compacts near heap
limit`, recorded in `run-1.log` and in the JSON as a `gameLaunch` error). Runs 2–12 produced a
verified spawn (11/11). The proxy distribution is stable (CV 3.3%); the OOM is recorded rather than
discarded, and it is a real legacy-app risk on a 2-core / 8 GiB CI runner.

`modListPopulated` includes the legacy app's fixed 5,000 ms wait for Steam workshop subscription
ids. Without Steam every run pays it, so on this run the scan-related part is approximately
`6862 − 5000 = 1862 ms`; the header scan (990 ms) is measured separately. Subtract the same fixed
wait before comparing with the new app.

### Variance between identical CI jobs

CI runs are not interchangeable. The same workflow on the same runner label produced:

| Run | Date (UTC) | CPU | Cores / RAM | Cold start median | Mod list median | Header scan median |
| --- | --- | --- | --- | --- | --- | --- |
| 39457059668 | 2026-10-20 16:24 | AMD64 Family 25 Model 17 | 2 / 8 GiB | 1037 ms | 6510 ms | 525 ms |
| 39457611317 | 2026-10-20 16:28 | Intel64 Family 6 Model 207 | 2 / 8 GiB | 1197 ms | 6718 ms | 551 ms |
| 39458012045 | 2026-10-20 16:31 | AMD64 Family 25 Model 1 | 2 / 8 GiB | 1427 ms | 7087 ms | 777 ms |
| 39575136390 | 2026-10-21 09:12 | AMD64 Family 25 Model 1 | 2 / 8 GiB | 1294 ms | 6811 ms | 979 ms |
| 39577999775 | 2026-10-21 09:34 | AMD64 Family 25 Model 1 | 2 / 8 GiB | 1322 ms | 6862 ms | 990 ms |

The real spread is larger than the "~15%" quoted in the first draft. Across these jobs:

- cold start: 1037–1427 ms (+38%),
- mod list: 6510–7087 ms (+9%),
- header scan: 525–990 ms (+89%).

The early AMD line in the first report belonged to run 39457059668; the committed JSON for
39457611317 reported an Intel CPU. The final JSON records the environment **per run**, not just
once, and this table records the environment per job.

### Arithmetic and interpretation

- Final run: `6862 − 5000 = 1862 ms` scan-related for mod-list population.
- Previously committed run (39457611317): `6718 − 5000 = 1718 ms`, not the `1510 ms` written in
  the first draft (that used 6510 from the earlier job).
- Header scan is measured separately and should not be added to the Steam-subtracted mod-list
  number; they overlap in the app's own startup pipeline.
- Cold-start CV was 15.2% in the final job (one 2019 ms outlier); use the median and IQR, not a
  single run.
- The measured runner was 2 cores / 8 GiB, not the 4 vCPU / 16 GiB in the workflow documentation.

### Fixture facts and correction

- 16 duplicate-named **files**, 8 duplicate **names**; the app collapses the 8 content copies.
- 432 well-formed packs in `data/` parse; 60 malformed packs are rejected; 440 PFH5 files are
  structurally well-formed in total (432 data + 8 content copies).
- `492` is post-dedupe and is the correct mod count for this fixture.

### Feasibility

**Verdict: the legacy release build runs and is measured on GitHub `windows-latest`. The
development host cannot run it, and CI is the accepted host by CEO decision.**

Evidence:

- The dev host is CachyOS Linux (i9-13900K, 32 threads, 125 GiB RAM). The legacy project publishes
  only `wh3mm-win32-x64-2.29.0.zip`; there is no Linux or macOS release artefact.
- No Wine or Windows VM is installed, and Electron GUI apps under Wine are not a trustworthy
  measurement environment even when they start.
- The available Windows path is a GitHub-hosted `windows-latest` runner. In practice that is 2
  cores and 8 GiB, ephemeral, with an interactive desktop session. It is feasible but noisy, so
  the report publishes the distribution instead of a single number.
- A physical Windows box with the real game install remains the only way to measure real game data
  and a real game launch. It is optional and does not block M2/M5.

No numbers have been invented: every value above comes from a checked-in runner, the committed
JSON, and the raw logs.

### Reproduce checklist

- [x] `node scripts/perf/generate-fixture.mjs --out perf-fixture/wh3-500` and record the fixture digest
- [x] `WH3MM_RUNS=12 bash scripts/perf/legacy-baseline.sh` (via the workflow)
- [x] Paste `environment`, `metrics` and the raw log paths into this section
- [x] Record the per-run environment and the spread across identical jobs
- [x] Record the game-launch handoff as a documented proxy, not a game-launch number
- [x] Keep `main` green; attach the PR and task id `WAR-19`

---

# WAR-7 — benchmarks, budgets, and guards (work in progress)

Status: harness and workloads in place; new-manager numbers are **pending** until WAR-5 exposes the
parser/index APIs. No number in this section is a claim about the new app unless the row says
**measured**.

## Status at a glance

| Deliverable | State | Where |
| --- | --- | --- |
| 1. Criterion benches: pack header, mod index, 500-pack conflicts, `used_mods.txt`, profile restore | **Gated** on WAR-5 APIs | `crates/wh3mm-core/benches/` (not created yet) |
| 2. Deterministic workloads for 100/500/2000 packs | **Done** | `scripts/perf/generate-suite.mjs` |
| 3. Frontend render/scroll/reorder guard on 5k/20k rows | **Skeleton, measured** | `frontend/src/perf/`, `pnpm test:perf` |
| 4. This file: baselines, budgets, limits | Scaffold; legacy numbers below are measured | `docs/PERF.md` |
| 5. Non-blocking CI bench job | **Done** | `.github/workflows/perf-bench.yml` |

## Measurement host (CEO decision, plan rev 4)

- Final A/B runs on **GitHub-hosted `windows-latest`**, **10+ cold runs**, reporting **median and
  IQR** plus the raw output. No dedicated VM and no purchase is authorised.
- The ~15% spread between two identical runners is handled by repeated runs and by publishing the
  distribution, not by new hardware.
- A physical Windows host is optional and only re-validates the launch-handoff metric; it must not
  block M2 or M5.
- This supersedes the open host question at the end of the legacy section; that section is updated
  by the WAR-19 PR, not here.

## How to read this file

- **Measured** — produced by the command shown, on the machine shown.
- **Upper bound** — produced in jsdom, so it is slower or less representative than a real paint;
  useful for catching regressions, not for quoting as interaction latency.
- **Provisional** — a budget chosen from the legacy reference before the new app exists. It is a
  target, not a pass/fail gate until a new-manager number exists.
- **Pending** — no honest number yet. Do not substitute a guess.

## Benchmark workloads (deliverable 2)

The workloads reuse the fixture generator that QA (WAR-19 / PR #4) validated against the legacy
parser, so the app, the legacy baseline, and QA measure the same bytes.

```bash
node scripts/perf/generate-suite.mjs                       # 100, 500, 2000 packs
node scripts/perf/generate-suite.mjs --verify perf-fixture # re-hash all three trees
node scripts/perf/generate-suite.mjs --counts 100,500 --seed 20261020
```

Output: `perf-fixture/wh3-<count>/fixture-manifest.json` per size and
`perf-fixture/suite-manifest.json` (`schema: wh3mm.perf.fixture-suite.v1`) with one content digest
per size and a suite digest over them. Fixtures are generated on demand and git-ignored.

Measured on the Linux dev host (2026-10-21), three runs:

| Size | Packs | Content sha256 (first 12) | Generation | Same digest across runs |
| --- | --- | --- | --- | --- |
| 100 | 100 | `f74804664808` | — | yes |
| 500 | 500 | `1de7de625da9` | — | yes (identical to WAR-19) |
| 2000 | 2000 | `d147b4774c5f` | — | yes |
| all three | 2600 | suite `d8896967d091` | 403–423 ms | yes |

The 500-pack digest is the same `1de7de62…` recorded in the legacy baseline, so the A/B and QA
fixtures are provably the same tree. Malformed variants stay proportional per size; the 16
cross-source duplicate files are fixed per suite by design.

## Frontend render guard (deliverable 3)

```bash
pnpm test:perf
WH3MM_PERF_OUT=/tmp/render-guard.json pnpm test:perf   # write the JSON report
```

The guard builds 5,000 and 20,000 deterministic rows, mounts a windowed list, then measures the
initial window render, a scroll rerender, and a reorder commit. The **hard assertions are
structural**: the mounted DOM row count must stay `<= 64` (36 in practice) at the top and bottom of
the list, and the bottom window must contain the last row and not the first. **No wall-clock
threshold is asserted**; timings are printed and can be written as JSON.

Measured on the Linux dev host, jsdom, Node 26.11.1, i9-13900K (median of 7 samples, 3 runs):

| Rows | Initial window render | Scroll rerender | Reorder commit | Mounted rows (top/bottom) |
| --- | --- | --- | --- | --- |
| 5,000 | 2.85–3.42 ms | 1.78–2.07 ms | 0.95–2.19 ms | 36 / 9 |
| 20,000 | 1.85–2.04 ms | 1.47–1.66 ms | 0.90–0.99 ms | 36 / 9 |

First CI run (`ubuntu-24.04`, shared 2 vCPU, run 39572436256): 5k initial 14.5 ms / scroll 7.11 ms /
reorder 3.98 ms; 20k 6.33 / 4.64 / 3.23 ms; mounted 36 / 9. Slower than the dev host, still under
the 20 ms budget, and the reason the CI job has no timing gate.

**These are upper-bound-ish jsdom costs for a synthetic row**, not paint or scroll latency and not
the real M2 row (which will carry toggles, thumbnails, and tags). They prove the window is bounded
and give a regression floor. The row count, not the dataset size, drives the work.

This is a skeleton. When WAR-5 lands the real list, replace `WindowedModList` in
`frontend/src/perf/modList.perf.test.tsx` with the real component and keep the DOM contract
(`role="list"`, `data-row-index`, bounded mounted rows). The real scroll/paint trace is a manual
Chrome run on Windows:

1. `pnpm dev` with 5k and 20k rows (or the M2 fixture).
2. DevTools Performance, 6x CPU throttle, record a scroll from top to bottom and one drag-reorder.
3. Capture long tasks, dropped frames, and the committed DOM row count.
4. Paste the trace filename, commit, and summary numbers into this section; attach the trace to the
   task, not the repo.

## Rust Criterion benchmarks (deliverable 1)

Gated on WAR-5: the pack parser, mod index, conflict comparison, and `used_mods.txt` APIs are not on
`main` yet, so there is nothing to benchmark. Do not add fixtures that call stub functions; a bench
against a stub measures the stub.

Planned benches, to be added under `crates/wh3mm-core/benches/` with `criterion` as a dev
dependency, all in `--release`:

| Bench | Workload | Metric |
| --- | --- | --- |
| `pack_header` | one pack, repeated | ns per file |
| `pack_header_batch` | 500-pack fixture | ms per 500 |
| `mod_index_build` | 100/500/2000 fixture | ms per index |
| `conflict_compare` | 500 enabled packs | ms per comparison |
| `used_mods_write` | 500 names, temp dir | µs per write |
| `profile_restore` | restore 500 enabled + order | µs per restore |

CI already runs `cargo bench --workspace --locked` when `crates/*/benches/*.rs` exists; until then
the job records a skip in the step summary. Criterion output is not parsed into a gate.

## Budgets

Source of the reference: legacy release 2.29.0, 500-pack fixture, five cold runs on
`windows-latest` (see the legacy section). Same-host comparison is mandatory: a new-app number is
only judged against a legacy number from the same runner class and the same run date, because
identical CI jobs differed by ~15%.

Legend: **gate** = must be strictly faster than the legacy reference; **headline** = the CEO's
≥2x target. Both are provisional until the first new-app measurement.

| Path | Legacy reference | Gate | Headline (≥2x) | New app |
| --- | --- | --- | --- | --- |
| Cold start to interactive mod list | 1197 ms | < 1197 ms (provisional ceiling 1100 ms) | ≤ 598 ms | Pending (M2) |
| 500-pack header parse | 551 ms | < 551 ms (provisional ceiling 450 ms) | ≤ 276 ms | Pending (WAR-5 + M2) |
| 500-mod load/index, minus the 5,000 ms Steam wait | ≈ 1718 ms (`6718 − 5000`) | < 1718 ms (provisional ceiling 1500 ms) | ≤ 859 ms | Pending (M2) |
| Load-order apply/persist (`used_mods.txt`) | not measured | TBD after first measurement | n/a | Pending (WAR-5; legacy path needs renderer automation) |
| Profile switch / restore | not measured | TBD after first measurement | n/a | Pending (WAR-5) |
| Launch handoff | not measured | TBD after first measurement | n/a | Pending (needs a real install; optional physical host) |
| First window render, 5k rows (jsdom) | no legacy DOM metric | ≤ 20 ms jsdom upper bound | n/a | 2.85–3.42 ms (measured) |
| Scroll rerender, 20k rows (jsdom) | no legacy DOM metric | ≤ 16.7 ms (one 60 Hz frame) | n/a | 1.47–1.66 ms (measured) |
| Reorder commit, 20k rows (jsdom) | no legacy DOM metric | ≤ 32 ms (two frames) | n/a | 0.90–0.99 ms (measured) |

Justification:

- The Rust ceilings leave ~10–18% headroom under the legacy median, which is roughly the CI
  run-to-run spread; the headline is the 2x target, not a second gate.
- The frontend budgets are one/two 60 Hz frames, not measured user thresholds. The jsdom upper
  bound already has ~5x headroom under the 20 ms budget, which is enough to catch a de-virtualized
  list (it would render 5,000–20,000 rows, not 36).
- No budget is invented for apply/persist, profile switch, or launch handoff: the legacy harness
  cannot time them yet, and a guessed bar would be worse than a labelled `TBD`.

## CI (deliverable 5)

`.github/workflows/perf-bench.yml`, triggered by `workflow_dispatch` and PRs touching `crates/`,
`frontend/`, or `scripts/perf/`.

| Job | Command | Nature |
| --- | --- | --- |
| Workloads 100/500/2000 | `generate-suite.mjs` + `--verify` | Deterministic; fails on a digest mismatch |
| Frontend render guard | `pnpm test:perf` | Structural assertion; timings reported, never gated |
| Rust Criterion | `cargo bench --workspace --locked` | Skips with a summary note until WAR-5 benches exist |

The workflow is **not a required check** and has no timing gate. Adding it to branch protection
would make shared-runner noise a merge blocker; that is explicitly out of scope.

## Known limits

- **Header-only fixtures.** The packs are 0.25–8 KB of payload, ~6.6 KB average. Parse and index
  numbers are header/index-bound and say nothing about decompressing real mod payloads. Real
  WH3 packs are orders of magnitude larger; do not extrapolate I/O from these numbers.
- **Cold vs warm cache.** Legacy runs clear `pack-headers-cache.bin` and use a fresh user-data dir.
  New-app benches must state whether the OS cache is warm; on Windows, Defender scanning is part of
  the first cold run and is not removable on a shared runner.
- **Steam wait.** Legacy `mod list populated` includes a fixed 5,000 ms wait for Workshop
  subscription ids on a machine without Steam. Subtract it before comparing scan/load numbers, and
  state whether the new app waits the same way.
- **Disk-bound writes.** Atomic `used_mods.txt` writes are dominated by rename/fsync latency, so a
  CI runner's disk is part of the result. Report p50 and p95; a single fast sample proves nothing.
- **jsdom is not a browser.** The frontend numbers exclude layout, paint, compositing, and real
  scroll event coalescing. Only the manual Chrome trace on Windows closes that gap.
- **CI variance.** Two identical `windows-latest` jobs differed by ~15%. Ten runs with median and
  IQR are the minimum to make a same-host claim.

## Optimisation candidates

None ranked yet. The mandate is "no optimisation without a measurement", and there is no new-app
measurement to rank against. The first comparison (M2 checkpoint) produces the list in the required
shape: path, current number, budget, cause, proposed change, expected win. Any candidate will be a
focused child issue or a change to the author's branch with the benchmark in the same PR.
