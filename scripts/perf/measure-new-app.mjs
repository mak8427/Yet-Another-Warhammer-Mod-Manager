#!/usr/bin/env node
/**
 * Measures this manager's core session pipeline with independent cold-process samples.
 *
 * Run on a fixed fixture and record the host with each report:
 *
 *   node scripts/perf/measure-new-app.mjs \
 *     --bin target/release/wh3mm-perf.exe \
 *     --fixture perf-fixture/wh3-500 \
 *     --runs 12 \
 *     --stub "$WH3MM_GAME_STUB" \
 *     --out docs/perf/new-app.json
 *
 * Each sample is a fresh process (`crates/wh3mm-perf`) with a fresh config
 * directory, so the cold-start number is not a warm in-process repeat. The
 * harness measures the core session pipeline; `docs/PERFORMANCE.md` states exactly
 * what that excludes (WebView creation and paint) and which metrics are proxies.
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import nodeOs from "node:os";
import * as nodePath from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RESULT_PREFIX = "WH3MM_PERF_RESULT ";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const binPath = nodePath.resolve(readArg("bin", ""));
if (!readArg("bin", "")) {
  console.error("usage: node scripts/perf/measure-new-app.mjs --bin <wh3mm-perf> [--fixture DIR] [--runs N] [--out FILE] [--stub EXE]");
  process.exit(2);
}
const fixture = nodePath.resolve(readArg("fixture", "perf-fixture/wh3-500"));
const runs = Number(readArg("runs", "12"));
if (!Number.isInteger(runs) || runs < 1) {
  console.error(`--runs must be a positive integer, got ${readArg("runs", "12")}`);
  process.exit(2);
}
const outPath = nodePath.resolve(readArg("out", "docs/perf/new-app.json"));
const stamp = new Date().toISOString().replaceAll(":", "").replace(/\..+$/, "");
const rawLogDirectory = nodePath.resolve(readArg("raw-log-dir", `docs/perf/.new-app-${stamp}`));
const stub = readArg("stub", null);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Linear-interpolation quantile, the same definition R's type 7 uses. */
function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const round3 = (value) => Number(value.toFixed(3));

function summarize(values) {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  const p25 = quantile(values, 0.25);
  const p75 = quantile(values, 0.75);
  return {
    // Core commands finish below 1 ms on a warm machine, so medians keep
    // sub-millisecond resolution instead of rounding a real result to zero.
    n: values.length,
    medianMs: round3(median(values)),
    meanMs: round3(mean),
    p25Ms: round3(p25),
    p75Ms: round3(p75),
    iqrMs: round3(p75 - p25),
    minMs: round3(Math.min(...values)),
    maxMs: round3(Math.max(...values)),
    stdevMs: round3(stdev),
    cvPercent: mean === 0 ? null : Number(((stdev / mean) * 100).toFixed(1)),
    samplesMs: values.map(round3),
  };
}

function captureEnvironment() {
  return {
    capturedAt: new Date().toISOString(),
    os: `${process.platform} ${process.arch}`,
    osRelease:
      process.platform === "win32"
        ? execFileSync("cmd", ["/c", "ver"], { encoding: "utf8" }).trim()
        : nodeOs.release(),
    node: process.version,
    cpu:
      process.platform === "win32"
        ? process.env.PROCESSOR_IDENTIFIER ?? null
        : nodeOs.cpus()[0]?.model ?? null,
    cpuCores: nodeOs.cpus().length,
    totalMemoryGiB: Number((nodeOs.totalmem() / 1024 ** 3).toFixed(1)),
    freeMemoryGiB: Number((nodeOs.freemem() / 1024 ** 3).toFixed(1)),
    runnerName: process.env.RUNNER_NAME ?? null,
    runnerOs: process.env.ImageOS ?? process.env.RUNNER_OS ?? null,
    runnerImage: process.env.ImageVersion ?? process.env.RUNNER_IMAGE ?? null,
    target: "wh3mm-perf (headless core pipeline)",
  };
}

async function readFixtureManifest(directory) {
  const text = await readFile(nodePath.join(directory, "fixture-manifest.json"), "utf8");
  return JSON.parse(text);
}

function parseResult(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith(RESULT_PREFIX));
  if (!line) return null;
  return JSON.parse(line.slice(RESULT_PREFIX.length));
}

async function runOnce(index, configRoot) {
  const runDirectory = nodePath.join(rawLogDirectory, `run-${index}`);
  // App state lives outside the evidence directory: the committed log tree must
  // contain only the per-run JSON and log, not generated config files.
  const configDirectory = nodePath.join(configRoot, `run-${index}`);
  await mkdir(runDirectory, { recursive: true });
  await mkdir(configDirectory, { recursive: true });
  // Fresh app state every run: no config, no imported load order, no backup.
  for (const name of ["used_mods.txt", "used_mods.txt.bak"]) {
    await rm(nodePath.join(fixture, name), { force: true });
  }
  await rm(nodePath.join(fixture, "stub-marker.txt"), { force: true });

  const runArgs = [
    "--fixture",
    fixture,
    "--config-dir",
    configDirectory,
    "--run",
    String(index),
  ];
  if (stub) runArgs.push("--stub", stub);

  const logPath = nodePath.join(runDirectory, `run-${index}.log`);
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let timedOut = false;
  try {
    const result = await execFileAsync(binPath, runArgs, {
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      encoding: "utf8",
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? String(error.message ?? error);
    exitCode = typeof error.code === "number" ? error.code : 1;
    timedOut = Boolean(error.killed);
  }
  const wallMs = Date.now() - started;

  await writeFile(
    logPath,
    [
      `$ ${binPath} ${runArgs.join(" ")}`,
      `--- exit: ${exitCode}${timedOut ? " (timed out)" : ""} wall: ${wallMs}ms`,
      "--- stdout ---",
      stdout.trimEnd(),
      "--- stderr ---",
      stderr.trimEnd(),
      "",
    ].join("\n"),
    "utf8",
  );

  const result = parseResult(stdout);
  if (!result) {
    return {
      run: index,
      logPath,
      error: timedOut
        ? "the measurement process timed out after 120s"
        : `no ${RESULT_PREFIX.trim()} line (exit ${exitCode})`,
    };
  }
  await writeFile(nodePath.join(runDirectory, `run-${index}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { ...result, logPath, wallMs };
}

function metricSamples(runResults, key, { verified } = {}) {
  return runResults
    .filter((run) => !run.error)
    .filter((run) => (verified ? run.verified?.[verified] : true))
    .map((run) => run[key])
    .filter((value) => Number.isFinite(value));
}

function interaction(runResults, key, verifiedKey, errorPrefix) {
  const attempted = runResults.length;
  const measured = metricSamples(runResults, key).length;
  const verified = runResults.filter((run) => run.verified?.[verifiedKey]).length;
  const errors = runResults
    .flatMap((run) => run.errors ?? [])
    .filter((error) => error.startsWith(errorPrefix));
  return { attempted, measured, verified, errors };
}

async function main() {
  await mkdir(rawLogDirectory, { recursive: true });
  await mkdir(nodePath.dirname(outPath), { recursive: true });
  const manifest = await readFixtureManifest(fixture);

  const configRoot = nodePath.join(nodeOs.tmpdir(), `wh3mm-new-app-${process.pid}-${stamp}`);
  const results = [];
  for (let index = 1; index <= runs; index += 1) {
    const result = await runOnce(index, configRoot);
    results.push(result);
    if (result.error) {
      console.error(`run ${index}/${runs}: ERROR ${result.error}`);
    } else {
      console.log(
        `run ${index}/${runs}: cold=${result.coldStartMs}ms list=${result.modListPopulatedMs}ms ` +
          `scan=${result.headerScanMs}ms persist=${result.loadOrderPersistMs ?? "n/a"}ms ` +
          `preset=${result.presetSwitchMs ?? "n/a"}ms launch=${result.gameLaunchHandoffMs ?? "n/a"}ms ` +
          `mods=${result.modCount}`,
      );
    }
    // Let the OS settle the previous process before the next cold start.
    await sleep(250);
  }
  await rm(configRoot, { recursive: true, force: true });

  const successful = results.filter((run) => !run.error);
  const metrics = {
    coldStartMs: summarize(metricSamples(results, "coldStartMs")),
    modListPopulatedMs: summarize(
      metricSamples(results, "modListPopulatedMs", { verified: "modListPopulated" }),
    ),
    headerScanMs: summarize(metricSamples(results, "headerScanMs")),
    loadOrderPersistMs: summarize(
      metricSamples(results, "loadOrderPersistMs", { verified: "loadOrderPersist" }),
    ),
    presetSwitchMs: summarize(
      metricSamples(results, "presetSwitchMs", { verified: "presetSwitch" }),
    ),
    gameLaunchHandoffMs: summarize(
      metricSamples(results, "gameLaunchHandoffMs", { verified: "gameLaunchHandoff" }),
    ),
  };

  const report = {
    schema: "wh3mm.perf.new-app.v1",
    environment: {
      ...captureEnvironment(),
      binPath,
      binSha256: await sha256File(binPath),
      fixturePath: fixture,
      fixtureSha256: manifest.sha256,
      fixturePacks: manifest.packFiles,
      fixtureSeed: manifest.seed,
      runs,
      stub: stub ? { path: nodePath.resolve(stub), proxy: true } : null,
    },
    metrics,
    interactionSummary: {
      loadOrderPersist: interaction(results, "loadOrderPersistMs", "loadOrderPersist", "loadOrderPersist"),
      presetSwitch: interaction(results, "presetSwitchMs", "presetSwitch", "presetSwitch"),
      gameLaunch: interaction(results, "gameLaunchHandoffMs", "gameLaunchHandoff", "gameLaunchHandoff"),
    },
    runs: results,
    rawLogDirectory: nodePath.relative(process.cwd(), rawLogDirectory).replaceAll("\\", "/"),
    notes: [
      "Every sample is a fresh wh3mm-perf process with a fresh config directory; used_mods.txt and its backup are removed before each run.",
      "coldStartMs is process start to Session::initialize returning: the work Tauri's Manager::new performs during setup, excluding WebView creation and paint.",
      "modListPopulatedMs is process start to the first ModListSnapshot serialised for IPC. Because startup initialises the session before the window is usable, it measures the same pipeline as coldStartMs.",
      "headerScanMs is the session's scan timing: PFH5 header parsing for the 492 packs the new app sees, not the 8 workshop copies it never enumerates.",
      "loadOrderPersistMs and presetSwitchMs call the core commands directly. UI interaction latency is not included.",
      "gameLaunchHandoffMs is a proxy: used_mods.txt write plus a stub process started by the harness. this does not start TW:WH3 or measure the real game-launch path.",
      ...(successful[0]?.notes ?? []),
    ],
  };

  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`\nnew app, ${successful.length}/${runs} successful runs on ${report.environment.os}`);
  console.log(`fixture ${manifest.packFiles} packs, sha256 ${manifest.sha256}`);
  for (const [key, summary] of Object.entries(metrics)) {
    if (!summary) {
      console.log(`${key}: no samples`);
      continue;
    }
    console.log(
      `${key}: n=${summary.n} median=${summary.medianMs}ms IQR=${summary.iqrMs}ms ` +
        `min=${summary.minMs} max=${summary.maxMs} CV=${summary.cvPercent}%`,
    );
  }
  console.log(`\nreport: ${nodePath.relative(process.cwd(), outPath)}`);
  console.log(`raw logs: ${report.rawLogDirectory}`);

  if (successful.length !== runs) {
    console.error(`only ${successful.length}/${runs} runs succeeded`);
    process.exitCode = 1;
  }
  const required = ["coldStartMs", "modListPopulatedMs", "headerScanMs"];
  if (required.some((key) => !metrics[key])) {
    console.error("a required metric has no samples");
    process.exitCode = 1;
  }
}

await main();
