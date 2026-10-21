# Performance

This file records how we measure the paths users feel, on which machine, and with which command.
A number without an environment and a command does not belong here.

<<<<<<< HEAD
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

## New app vs legacy (M2 gate)

**Status: OPEN — no Windows measurement has run, so no verdict is claimed.**

The branch `perf/new-app-comparison` (from `main` `c1a9cdd`) contains the measurement harness, the
workflow and one reproduction command. The Windows run is blocked, not skipped:

- This run has no managed GitHub identity. `git push -u origin perf/new-app-comparison` fails with
  `fatal: could not read Username for 'https://github.com': terminal prompts disabled`, and
  `gh auth status` reports `You are not logged into any GitHub hosts`.
- The exact command and error are recorded on WAR-46. The branch cannot be pushed, the PR cannot be
  opened, and `.github/workflows/perf-new-app.yml` cannot be dispatched until a run with GitHub
  identity picks the branch up.
- A Linux measurement exists and is committed (see Harness smoke), but the host classes differ.
  The comparison tool marks those rows `not comparable (host mismatch)` instead of inventing a
  ratio. A Linux ratio against a Windows legacy median is not evidence for this gate.

The table is filled by the Windows run. Until then every new-app cell is `pending`.

| Metric | Legacy n | Legacy median | Legacy for comparison | New n | New median | New IQR | Ratio | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cold start to interactive mod list | 12 | 1322 ms | 1322 ms | pending | pending | pending | pending | **pending** |
| 500-mod list populated | 12 | 6862 ms | 1862 ms (Steam wait removed) | pending | pending | pending | pending | **pending** |
| PFH5 header scan (500 packs) | 12 | 990 ms | 990 ms | pending | pending | pending | pending | **pending** |
| Load-order apply/persist | 12 | 279 ms | 279 ms | pending | pending | pending | pending | **pending** |
| Profile/preset switch | 12 | 298 ms | 298 ms | pending | pending | pending | pending | **pending** |
| Game-launch handoff (**proxy**) | 11 | 6163 ms | 6163 ms | pending | pending | pending | pending | **pending** |

Bar: **≥2x faster** on cold start and 500-mod list; every other metric strictly faster, or the gap
explained with evidence. A miss is reported as `miss`, with the measured hotspot, not massaged.

### What the new-app harness measures

`crates/wh3mm-perf` is a headless measurement binary. It is not shipped. It links `wh3mm-core` and
runs the same session pipeline the Tauri shell runs in `Manager::new` during setup.

| Metric | Implementation | Includes | Excludes |
| --- | --- | --- | --- |
| `coldStartMs` | process start → `Session::initialize` returns | config load, detection, 492-pack scan, `used_mods.txt` read | WebView creation, first paint |
| `modListPopulatedMs` | process start → first `ModListSnapshot` serialised for IPC | the same startup pipeline plus snapshot serialisation | DOM render of the list |
| `headerScanMs` | session `timings.scan_ms` | PFH5 header parse, data-folder enumeration, dedupe of 492 packs | the 8 workshop duplicate copies, which this app does not enumerate |
| `loadOrderPersistMs` | `set_load_order` command with the second enabled row moved to position 5 | config validation and the atomic `config.json` write | DOM drag dispatch |
| `presetSwitchMs` | `apply_profile("Perf Half")` | config validation and the atomic `config.json` write | DOM keyboard dispatch |
| `gameLaunchHandoffMs` | **proxy**: `used_mods.txt` write, then a stub process started by the harness | the app's last pre-launch write and a process start | a real game, Steam, the app's launch path (none exists at `c1a9cdd`) |

Two scope facts are deliberate and must not be edited out of a comparison:

1. The new-app interaction rows measure the **core command**, not the UI. The legacy rows include
   CDP drag/key dispatch, so those ratios are favourable to the new app by construction. The bar
   for those rows covers the backend path only; UI interaction latency is not claimed here.
2. `gameLaunchHandoffMs` is a **proxy** for both apps. The new app has no launch command at
   `c1a9cdd` (M3 adds it), so the harness starts the stub itself. The row is labelled in the table
   and in the JSON.

### Fixture and coverage

The workflow regenerates the fixture with the committed generator and **fails** unless the digest
is exactly `1de7de625da9ee53d1101a764d07d5ccbb61975932816c8b43574b648d0ab73a`.

All 500 packs are the same bytes the legacy baseline used. The new app scans **492** of them: the
8 `content/1142710` duplicate copies are only reachable through Steam workshop discovery, and the
manual game path does not enumerate that folder. The legacy app enumerated 500 and then dropped the
same 8 duplicate copies, so both UIs show **492 mods**. The header-scan comparison is therefore
492 files vs 500 files (1.6% fewer), stated rather than hidden.

### One command to reproduce

On Windows (the host class of the baseline):

```powershell
node scripts/perf/generate-fixture.mjs --out perf-fixture/wh3-500 --count 500
node scripts/perf/generate-fixture.mjs --verify perf-fixture/wh3-500
cargo build --release -p wh3mm-perf --locked

node scripts/perf/measure-new-app.mjs `
  --bin target/release/wh3mm-perf.exe `
  --fixture perf-fixture/wh3-500 `
  --runs 12 `
  --stub "$env:WH3MM_GAME_STUB" `
  --out docs/perf/new-app.json `
  --raw-log-dir docs/perf/.new-app-<run-id>
```

`WH3MM_GAME_STUB` is the compiled `Warhammer3.exe` stub from
`.github/workflows/perf-new-app.yml`; the same C# stub contract as the legacy workflow. The
workflow (`.github/workflows/perf-new-app.yml`, `windows-latest`) is the supported path: it builds
the release harness, runs 12 cold samples, writes `docs/perf/new-app.json`, and uploads the per-run
JSON and logs.

Each sample is a **new process with a fresh config directory**. `used_mods.txt` and its backup are
removed before each run, so no run inherits the previous run's load order. The new app has no header
cache; the OS file cache warms after run 1 for both apps, as it did for the legacy baseline.

The report (`schema wh3mm.perf.new-app.v1`) records the environment per run, every sample,
median/IQR/min/max/CV, the verification flags, the raw log path and, when the host matches, the
comparison rows with ratio and verdict. Committed evidence goes to
`docs/perf/new-app-run-<actions-run-id>/run-<n>/run-<n>.{json,log}`.

### Harness smoke on the Linux dev host — **NOT the gate**

Ten cold runs of the harness on the development host, 2026-10-21. This validates the harness and
proves the command works; it says nothing about the Windows gate.

| Field | Value |
| --- | --- |
| Host | CachyOS, kernel `7.2.9-2-cachyos`, i9-13900K (32 threads), 125.5 GiB RAM |
| Node | v26.11.1 |
| Fixture | 500 packs, sha256 `1de7de62…` |
| Report | `docs/perf/new-app-smoke-linux.json` |
| Logs | `docs/perf/new-app-smoke-linux/run-1..10/` |

| Metric | n | Median | IQR | Min | Max | CV |
| --- | --- | --- | --- | --- | --- | --- |
| Cold start | 10 | 6.332 ms | 1.607 ms | 4.059 ms | 7.934 ms | 20.1% |
| Mod list populated | 10 | 6.643 ms | 1.705 ms | 4.332 ms | 8.193 ms | 19.5% |
| PFH5 header scan | 10 | 6 ms | 1.750 ms | 3 ms | 7 ms | 25.5% |
| Load-order persist | 10 | 0.590 ms | 0.317 ms | 0.437 ms | 0.861 ms | 25.4% |
| Preset switch | 10 | 0.256 ms | 0.116 ms | 0.179 ms | 0.341 ms | 23.2% |
| Launch handoff (proxy) | 10 | 2.505 ms | 0.194 ms | 2.388 ms | 3.082 ms | 7.6% |

The committed report contains `"hostMatches": false` and `not comparable (host mismatch)` on every
comparison row. Do not promote these numbers into the gate table. They do show that the measured
path is already far below the legacy numbers on a much faster machine; the Windows run is still
required because the legacy baseline was captured there.

### Measurement-scope decision

Driving the real Tauri window through CDP/WebDriver was rejected for this gate: the shell is
Windows-only, this run cannot push a branch or dispatch Windows CI, and an untested WebView driver
would add a failure mode to the only measurement that matters. The headless core harness measures
the same startup pipeline, is reproducible on any host, and states exactly what it excludes. When
M3 adds the launch path, the launch metric must be re-measured through the app rather than the
harness stub.

## Known limits

- **Core, not WebView.** Cold start excludes window/WebView creation and paint; mod-list population
  excludes DOM render. The numbers are a backend floor, not end-to-end frame timing.
- **Interaction scope.** The core commands exclude DOM dispatch that the legacy CDP numbers include.
  UI interaction latency needs the manual Chrome trace described in WAR-7; it is not claimed here.
- **Launch is a proxy.** `c1a9cdd` has no launch command; the harness starts the stub. This row can
  never be read as "the new app launches in N ms".
- **492 vs 500 packs.** The 8 workshop duplicate copies are not enumerated by the new app; both
  apps show 492 mods. Any future fixture should state its scan coverage the same way.
- **Shared CI host.** `windows-latest` is a 2-core shared runner; identical legacy jobs differed by
  up to 38% on cold start and 89% on header scan. Publish the distribution, never a single run.
- **Cold vs warm cache.** Only run 1 is cold for the OS file cache; the same was true for the legacy
  baseline. Defender scanning on Windows is part of that first run.
- **Sub-millisecond core commands.** Medians keep three decimals; a rounded `0 ms` is a lie about a
  real 0.2 ms call, so the report keeps the decimals.

## Optimisation candidates

None ranked. The mandate is "no optimisation without a measurement", and there is no same-host
new-app number yet. The first Windows comparison produces the list in the required shape: path,
current number, budget, cause, proposed change, expected win. Any candidate is a focused child task
or a change to the author's branch with its benchmark in the same PR.
