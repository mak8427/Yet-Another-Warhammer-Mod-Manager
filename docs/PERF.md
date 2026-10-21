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

# WAR-7 — benchmarks, budgets, and guards

Status: core benchmarks, workloads, frontend guard, and non-blocking CI are in place and measured on
the Linux dev host. The same-host Windows comparison is partially done: core paths are measured,
cold-start-to-interactive and launch handoff still need a Windows shell/UI harness.

## Status at a glance

| Deliverable | State | Where |
| --- | --- | --- |
| 1. Criterion benches: pack header, mod index, `used_mods.txt`, profile restore | **Done, measured** | `crates/wh3mm-core/benches/hot_paths.rs` |
| 1b. Conflict/index comparison for 500 enabled packs | **Gated on M3** (no conflict API on `main`) | add when the M3 API lands |
| 2. Deterministic workloads for 100/500/2000 packs | **Done** | `scripts/perf/generate-suite.mjs` |
| 3. Frontend render/scroll/reorder guard on 5k/20k rows | **Done on the real `ModList`** | `frontend/src/perf/`, `pnpm test:perf` |
| 4. This file: baselines, budgets, limits | **First baseline published** | `docs/PERF.md` |
| 5. Non-blocking CI bench job | **Done** | `.github/workflows/perf-bench.yml` |

## Measurement host (CEO decision, plan rev 4)

- Final A/B runs on **GitHub-hosted `windows-latest`**, **10+ cold runs**, reporting **median and
  IQR** plus the raw output. No dedicated VM and no purchase is authorised.
- The ~15% spread between two identical runners is handled by repeated runs and by publishing the
  distribution, not by new hardware.
- A physical Windows host is optional and only re-validates the launch-handoff metric; it must not
  block M2 or M5.

## How to read this file

- **Measured** — produced by the command shown, on the machine shown.
- **Upper bound** — produced in jsdom, so it is slower or less representative than a real paint;
  useful for catching regressions, not for quoting as interaction latency.
- **Provisional** — a budget chosen from the legacy reference. It stays a target until the same-host
  new-app number exists.
- **Pending** — no honest number yet. Do not substitute a guess.
- **Not comparable** — the number is real, but it measures a smaller path than the legacy number
  (for example core-only versus core + Electron + React). It still counts for a gate only when the
  comparison row says so.

## Benchmark workloads (deliverable 2)

The workloads reuse the fixture generator that QA and the legacy baseline validated against the
legacy parser, so the app, the legacy baseline, and QA measure the same bytes.

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
| 500 | 500 | `1de7de625da9` | — | yes (identical to the legacy baseline) |
| 2000 | 2000 | `d147b4774c5f` | — | yes |
| all three | 2600 | suite `d8896967d091` | 403–431 ms | yes |

The 500-pack digest is the `1de7de62…` recorded in the legacy baseline, so the A/B and QA fixtures
are provably the same tree. Malformed variants stay proportional per size; the 16 cross-source
duplicate files are fixed per suite by design.

## Rust Criterion benchmarks (deliverable 1)

One command generates the fixtures and runs every bench in the optimized profile:

```bash
scripts/perf/bench.sh
# equivalent:
node scripts/perf/generate-suite.mjs
cargo bench -p wh3mm-core --bench hot_paths --locked
```

`WH3MM_PERF_FIXTURE=/path/to/perf-fixture` points the benches at an existing tree. A missing tree is
a hard error; a bench against an empty directory would be a lie.

Measured 2026-10-21 on the Linux dev host: CachyOS 7.2.9-2, i9-13900K (32 threads), 125 GiB,
`rustc 1.99.1`, Criterion 0.7, optimized bench profile. Two full runs, medians of 100 samples:

| Bench | Run 1 | Run 2 | Run-to-run |
| --- | --- | --- | --- |
| `pack_header/parse_pure` (28-byte header + deps) | 22.4 ns | 22.4 ns | ~0% |
| `pack_header/read_file` (open + stat + header) | 1.15 µs | 1.17 µs | +2% |
| `pack_header/batch_500` (500 files, mixed valid/malformed) | 586 µs | 595 µs | +2% |
| `mod_index/scan/100` | 573 µs | 559 µs | −2% |
| `mod_index/scan/500` | 2.97 ms | 2.99 ms | +1% |
| `mod_index/scan/2000` | 13.38 ms | 14.61 ms | +9% |
| `used_mods/parse_500` | 51.8 µs | 50.9 µs | −2% |
| `used_mods/plan_500` | 105 µs | 99.6 µs | −5% |
| `used_mods/write_500` (atomic + `.bak` + fsync) | 122 µs | 118.5 µs | −3% |
| `used_mods/restore_500` | 114 µs | 118 µs | +3% |
| `session/startup_500` (config + scan + load-order read) | 2.93 ms | 2.99 ms | +2% |
| `session/profile_switch_500` (core, includes config write) | 297 µs | 302 µs | +2% |
| `session/profile_restore_config_500` | 106 µs | 111 µs | +5% |

Criterion's 95% confidence intervals were within ±5% of the medians for every row. The 2000-pack
scan is the only row above ±5% run-to-run (+9%); it is the noisiest and the one that will get a
dedicated repeated run before any claim. Outliers (7–12% of samples) were high-side and are included
in the medians, not trimmed.

**Workload caveats that decide comparability:**

- The new parser reads the 28-byte header and the dependency table. It does **not** read the
  packed-file index. The legacy "header scan" builds its full index cache for every pack, so
  `batch_500` is not the same work as the legacy 990 ms scan even though both are called a header
  scan.
- The fixture packs are 0.25–8 KB of payload. These numbers are header/index-bound and say nothing
  about decompressing real mods.
- `session/startup_500` is the core state machine only: config load, detection, scan, and
  `used_mods.txt` read. It excludes the Tauri/WebView shell, React, and Steam Workshop metadata.

## Frontend render guard (deliverable 3)

```bash
pnpm test:perf
WH3MM_PERF_OUT=/tmp/render-guard.json pnpm test:perf   # write the JSON report
```

The guard runs the **real M2 `ModList`** (`frontend/src/components/mod-list/ModList.tsx`) over 5,000
and 20,000 deterministic rows. It measures the initial window render, a scroll rerender driven by the
same scroll event the browser fires, and a reorder commit. The **hard assertions are structural**:
the mounted row count must stay `<= 48` (26 in practice), the bottom window must contain the last
row and not the first, and the window must follow the scroll. **No wall-clock threshold is
asserted**; timings are printed and can be written as JSON.

Measured on the Linux dev host, jsdom, Node 26.11.1, i9-13900K (median of 7 samples, 3 runs):

| Rows | Initial window render | Scroll rerender | Reorder commit | Mounted rows (top/bottom) |
| --- | --- | --- | --- | --- |
| 5,000 | 5.23–5.77 ms | 4.85–5.00 ms | 2.10–2.53 ms | 26 / 20 |
| 20,000 | 5.16–5.64 ms | 3.58–3.98 ms | 1.56–1.68 ms | 26 / 20 |

The cost is driven by the mounted row count, not the dataset: 20k is not slower than 5k. These are
jsdom costs for synthetic rows, not paint or scroll latency. The real scroll/paint trace is a manual
Chrome run on Windows:

1. `pnpm dev` with 5k and 20k rows (or the M2 fixture).
2. DevTools Performance, 6x CPU throttle, record a scroll from top to bottom and one drag-reorder.
3. Capture long tasks, dropped frames, and the committed DOM row count.
4. Paste the trace filename, commit, and summary numbers into this section; attach the trace to the
   task, not the repo.

## Budgets and pass/fail

Source of the reference: legacy release 2.29.0, 500-pack fixture, 12 cold runs on `windows-latest`
(median; see the legacy section). Same-host comparison is mandatory for a final claim: identical CI
jobs differed by up to 89% on the header scan.

Legend: **gate** = must be strictly faster than the legacy reference; **headline** = the CEO's ≥2x
target. A row is only marked **PASS** when the measured new number is on a path that does the same
work; otherwise it is marked **not comparable** even when the number is fast.

| Path | Legacy reference | Gate | Headline (≥2x) | New (measured) | Verdict |
| --- | --- | --- | --- | --- | --- |
| Cold start to interactive mod list | 1322 ms | < 1322 ms | ≤ 661 ms | not measured (no UI-ready marker) | **PENDING** |
| 500-pack header scan | 990 ms | < 990 ms | ≤ 495 ms | 0.586–0.595 ms core header batch | **PASS, not comparable** (new skips the file index) |
| 500-mod load / core startup | 1862 ms (`6862 − 5000`) | < 1862 ms | ≤ 931 ms | 2.93–2.99 ms | **PASS, not comparable** (core only, no shell/Steam) |
| Load-order apply/persist (`used_mods.txt`) | 279 ms | < 279 ms | n/a | 0.119–0.122 ms core write | **PASS, not comparable** (no renderer/IPC) |
| Profile switch / restore | 298 ms | < 298 ms | n/a | 0.297–0.302 ms core switch; 0.106–0.111 ms config load | **PASS, not comparable** (no renderer) |
| Game launch handoff | 6163 ms (proxy) | < 6163 ms | n/a | not implemented on `main` (M3) | **PENDING** |
| Conflict comparison, 500 enabled packs | not measured | n/a | n/a | not implemented on `main` (M3) | **PENDING** |
| First window render, 5k rows (jsdom) | no legacy DOM metric | ≤ 20 ms upper bound | n/a | 5.23–5.77 ms | **PASS** |
| Scroll rerender, 20k rows (jsdom) | no legacy DOM metric | ≤ 16.7 ms (one 60 Hz frame) | n/a | 3.58–3.98 ms | **PASS** |
| Reorder commit, 20k rows (jsdom) | no legacy DOM metric | ≤ 32 ms (two frames) | n/a | 1.56–1.68 ms | **PASS** |

The core paths pass the numeric bar with large headroom, but **the CEO comparison is not closed**:
cold start to an interactive list is the headline metric and it has no new-app number yet. A Tauri
shell run on Windows that logs UI-ready (or a Playwright/WebDriver trace) is required; a core-only
number must not be presented as cold start.

## Comparison status

| Metric | Legacy | New core | Same host? | Same work? | Claim |
| --- | --- | --- | --- | --- | --- |
| 500-pack scan | 990 ms | 0.586 ms | no (Win CI vs Linux dev) | no (index vs header) | faster, not yet an A/B |
| 500-mod load | 1862 ms | 2.93 ms | no | no (shell/Steam excluded) | faster, not yet an A/B |
| Apply/persist | 279 ms | 0.122 ms | no | no (renderer excluded) | faster, not yet an A/B |
| Profile switch | 298 ms | 0.297 ms | no | no (renderer excluded) | faster, not yet an A/B |

Next step for a valid A/B: run the new app's shell and the legacy build on the same
`windows-latest` job class, same fixture, 10+ cold runs, and report median + IQR for each primary
metric. The legacy half is already automated (`perf-legacy-baseline.yml`); the new half needs the
UI-ready marker.

## CI (deliverable 5)

`.github/workflows/perf-bench.yml`, triggered by `workflow_dispatch` and PRs touching `crates/`,
`frontend/`, or `scripts/perf/`.

| Job | Command | Nature |
| --- | --- | --- |
| Workloads 100/500/2000 | `generate-suite.mjs` + `--verify` | Deterministic; fails on a digest mismatch |
| Frontend render guard | `pnpm test:perf` | Structural assertions; timings reported, never gated |
| Rust Criterion (Linux) | `generate-suite.mjs` + `cargo bench -p wh3mm-core --bench hot_paths --locked` | Informational; no threshold parsed |
| Rust Criterion (Windows) | same command on `windows-latest` | Same-host data for the eventual A/B; informational |

The workflow is **not a required check** and has no timing gate. Adding it to branch protection
would make shared-runner noise a merge blocker; that is explicitly out of scope. The legacy baseline
stays in its own workflow because it downloads and launches the old release.

## Known limits

- **Header-only parsing.** The new header reader skips the packed-file index on purpose; the legacy
  scan builds that index. Never present the 0.6 ms number as "the same scan" without the caveat.
- **Synthetic payloads.** Packs are ~6.6 KB average, so these are metadata/syscall measurements, not
  decompression or real game-data measurements.
- **Cold vs warm cache.** Legacy runs clear `pack-headers-cache.bin` and use a fresh user-data dir.
  Criterion runs on a warm OS cache. Windows Defender scanning is part of a real first run and is
  not removable on a shared runner.
- **Core vs shell.** `session/startup_500` excludes Tauri/WebView, React, and Steam Workshop
  metadata. Cold start to interactive must be measured through the shell.
- **Steam wait.** Legacy `mod list populated` includes a fixed 5,000 ms wait for Workshop
  subscription ids on a machine without Steam. The scan-related comparison subtracts it and says so.
- **Disk-bound writes.** `used_mods/write_500` is fsync/rename-bound. A CI runner's disk is part of
  the number; report the distribution, not one fast sample.
- **jsdom is not a browser.** Frontend numbers exclude layout, paint, compositing, and scroll event
  coalescing. Only the manual Chrome trace on Windows closes that gap.
- **CI variance.** Identical `windows-latest` jobs differed by up to 89% on the legacy header scan.
  Same-host, same-job-class, 10+ runs with median and IQR is the minimum for a claim.

## Optimisation candidates (ranked by measured impact)

1. **One stat per pack in `mod_index::scan`.** Current: 2.97 ms for 500 packs, 13.38 ms for 2000
   (≈6.7–7.3 µs/pack); `session/startup_500` is 2.93 ms and is almost entirely this scan. Cause:
   `discover_mod` calls `fs::metadata`, then `read_pack_header` opens the file and calls
   `file.metadata()` again, so every pack pays an extra stat. Proposed change: read size/mtime from
   the opened file's metadata (or pass the `Metadata` into `read_pack_header`) — one open + one
   fstat per pack, no behaviour change. Expected win: 10–20% on `mod_index/scan/*` and
   `session/startup_500`. Verify with the same bench; hand to Karl as a scoped change, not a rewrite.
2. **2000-pack scaling.** 4x packs cost 4.9x the 500-pack time; the gap is small and within run
   noise (+9% on one run). Measure with 5 repetitions before touching directory enumeration. Expected
   win: <10%, so do not prioritise.
3. **No other candidate.** `used_mods` writes are fsync-bound (0.12 ms) and the frontend guard is
   dataset-independent (26 mounted rows at 5k and 20k). Changing either would add complexity without
   a measured win.

Nothing here is required for v1.0 acceptance: every measured path is far inside its gate. Candidate 1
is the only one worth scheduling, and only with the benchmark in the same change.
