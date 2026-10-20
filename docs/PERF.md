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
| Host so far | GitHub-hosted `windows-latest` (first pass, see Measured) |

### Method

1. Generate the fixture:

   ```bash
   node scripts/perf/generate-fixture.mjs --out perf-fixture/wh3-500 --count 500
   node scripts/perf/generate-fixture.mjs --verify perf-fixture/wh3-500
   ```

   The fixture is **not committed**: 500 binary packs, ~3.3 MB, rebuilt byte-for-byte from seed
   `20261020`. `fixture-manifest.json` records the variant counts and a SHA-256 over every pack.
   Current content: 432 valid/unicode/duplicate PFH5 packs, 60 deliberately malformed packs
   (15 bad magic, 15 truncated header, 15 inconsistent index, 15 empty files), 16 cross-source
   duplicate names, plus one synthetic vanilla `data.pack` listed in `data/manifest.txt`.
   `--verify` re-hashes the tree; the digest is stable across machines and runs.

   The generated packs were checked against the legacy project's own parser
   (`src/compressionAnalysis/analyzer.ts`, `parsePFH5PackBuffer`): all 432 well-formed packs parse,
   all 60 malformed packs are rejected, so the fixture exercises the real code path rather than a
   look-alike format.

2. Download and extract the release build (Windows):

   ```powershell
   gh release download v2.29.0 --repo Shazbot/WH3-Mod-Manager --pattern "wh3mm-win32-x64-2.29.0.zip" --dir C:\wh3mm
   Expand-Archive C:\wh3mm\wh3mm-win32-x64-2.29.0.zip -DestinationPath C:\wh3mm\app
   ```

3. Run five cold passes:

   ```bash
   WH3MM_APP=C:/wh3mm/app/wh3mm.exe WH3MM_RUNS=5 bash scripts/perf/legacy-baseline.sh
   ```

   or run the `Perf legacy baseline` workflow (`.github/workflows/perf-legacy-baseline.yml`,
   `workflow_dispatch`). Both write `docs/perf/legacy-baseline.json` and keep one raw stdout log per
   run under `docs/perf/.legacy-baseline-<timestamp>/run-<n>.log`.

### What the runner measures

The legacy app already logs its own startup instrumentation. The runner never patches it.

| Metric | Source |
| --- | --- |
| Cold start to interactive | `[startup] Main renderer React mounted after Nms` |
| DOM ready / bundle load | `[startup] Main renderer DOM ready` / `finished loading` |
| 500-mod enumeration | `before subscription filter: N` log line |
| Mod list populated | `after subscription filter: N` log line (main sends `modsPopulated` right after) |
| 500-mod PFH5 header parse | first write of `pack-headers-cache.bin` in the run's user-data directory, minus the enumeration timestamp |
| Persist / apply load order | **not yet automated** — the path is renderer `saveConfig` (debounced) plus a config write; needs renderer automation |
| Preset (profile) switch | **not yet automated** — Redux-only in the renderer, no main-process IPC to time |
| Game launch handoff | **manual proxy** — the legacy app writes `used_mods.txt` and then starts the game; without a real game install only the write can be timed |

Each run starts with a fresh `--user-data-dir`, removes `pack-headers-cache.bin`, and passes
`-nogpu`. One fixed cost is included and labelled: the app waits up to 5,000 ms for Steam workshop
subscription ids. On a machine without Steam every run pays that wait; subtract it before comparing
to the new app's scan numbers.

Raw output: `docs/perf/legacy-baseline.json` (schema `wh3mm.perf.legacy-baseline.v1`) plus the
per-run logs. JSON, not screenshots. Medians, min/max, standard deviation and coefficient of
variation are computed over the successful runs.

### Measured (first pass, GitHub `windows-latest`)

Run: [actions run 39457611317](https://github.com/mak8427/Warhammer_mod_manager/actions/runs/39457611317),
2026-10-20, release asset SHA-256 `3f8aa1b5d096b9f7c5bf387f4bf9fde3f47012d7e93d274d393a0514ca8c99da`.
Raw report: `docs/perf/legacy-baseline.json`; raw stdout logs:
`docs/perf/legacy-baseline-run-39457611317/run-1..5.log`.

The same job on the previous runner (run 39457059668) gave cold start 1037 ms, mod list 6510 ms,
header scan 525 ms. That 15% spread between two identical jobs on the same runner class is the
reason the final A/B needs a stable host.

| Field | Value |
| --- | --- |
| OS | Microsoft Windows Server 2025, `10.0.26100.33438`, x64 |
| CPU | AMD EPYC (Family 25 Model 17), 2 vCPU |
| RAM | 8 GiB |
| Node | v22.23.3 |
| Fixture | 500 packs, sha256 `1de7de62…` (identical to the POSIX digest) |

Five cold runs, fresh `--user-data-dir` and no header cache before each:

| Metric | Median | Min | Max | Stdev | CV |
| --- | --- | --- | --- | --- | --- |
| Cold start to React mounted | **1197 ms** | 1127 ms | 1330 ms | 76 ms | 6.2% |
| Mod list populated (500 packs) | **6718 ms** | 6665 ms | 8163 ms | 573 ms | 8.1% |
| PFH5 header scan (all mods) | **551 ms** | 517 ms | 584 ms | 25 ms | 4.5% |

The app reported **492 mods**. That is correct, not a fixture defect: the 500 packs include 8
data/content pairs with the same name, and the legacy app deliberately removes content copies that
duplicate a data mod. 492 = 500 − 8.

`modListPopulated` includes the legacy app's fixed 5,000 ms wait for Steam workshop subscription
ids. Without Steam every run pays it, so the scan-related part is roughly `6510 − 5000 = 1510 ms`
on this machine; the header scan (551 ms) is measured separately. Subtract the same fixed wait
before comparing with the new app.

Caveat: this is a shared 2-vCPU CI runner. The CV is low (4.5–8.1%) within a job, but two identical
jobs on the same runner class differed by ~15%. These numbers are not a substitute for a stable
host for the final A/B. See Feasibility.

### Feasibility

**Verdict: a first baseline is captured on a cloud Windows runner; the development host cannot
run the legacy release build at all.**

Evidence:

- The dev/CI host is CachyOS Linux (i9-13900K, 32 threads, 125 GiB RAM). The legacy project
  publishes only `wh3mm-win32-x64-2.29.0.zip`; there is no Linux or macOS release artefact.
- No Wine or Windows VM is installed, and Electron GUI apps under Wine are not a trustworthy
  measurement environment even when they start.
- The alternative that is actually available is a GitHub-hosted `windows-latest` runner: 4 vCPU,
  16 GiB RAM, ephemeral, interactive desktop session, and the repo's Windows CI already works.
  That gives a *feasible* measurement path but a noisy one; it is not a substitute for a stable
  machine when we close the performance gate.

GitHub Actions `windows-latest` works: the app launched, rendered and scanned the fixture, and
reported its own startup timings. What remains unresolved is a *stable* Windows host for the final
A/B (option B/C below). No numbers have been invented; every value above comes from the checked-in
runner and the uploaded JSON.

### Escalation and options

| Option | Cost | Fidelity | Recommendation |
| --- | --- | --- | --- |
| A. GitHub Actions `windows-latest` via `Perf legacy baseline` workflow | included CI minutes (a run takes ≈2 min; Windows overage ≈ $0.016/min) | Shared 2–4 vCPU runner, noisy neighbours, ephemeral. Proven to work for the first number; weak for the final A/B | done |
| B. Dedicated Windows VM (e.g. Azure `D4s_v5` ≈ $0.19/h pay-as-you-go, or Hetzner `CCX13` ≈ €0.02/h) for the duration of the gate | under $20 for the whole performance gate | Stable CPU, repeatable runs, can be pinned to the same machine as the new app | Do before the gate closes |
| C. Physical Windows box with the real WH3 install | existing hardware, if Torgrim has one | Only option that measures real game-data size and the game-launch handoff end to end | Optional, for the launch metric |

Decision needed from Torgrim/Katerina: name the machine for option B (or confirm A is acceptable
for the final comparison). Option A already answered "can the legacy app run at all?" with yes.

### Reproduce checklist for whoever runs it

- [ ] Windows 10/11 x64, 16 GB RAM, idle machine, no game running
- [ ] `gh release download v2.29.0 ...` and record the asset SHA-256
- [x] `node scripts/perf/generate-fixture.mjs --out perf-fixture/wh3-500` and record the fixture digest
- [x] `WH3MM_RUNS=5 bash scripts/perf/legacy-baseline.sh` (via the workflow)
- [x] Paste `environment`, `metrics` and the raw log paths into this section
- [ ] Re-run on the stable host once named, and replace the cloud-runner numbers
- [ ] Keep `main` green; attach the PR and task id `WAR-19`
