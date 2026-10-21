#!/usr/bin/env node
/**
 * Enforces the WAR-7 scan budgets on a stable host.
 *
 * The budgets are wall-clock numbers measured on the Linux development host
 * (i9-13900K); they are not a claim about a shared CI runner. Run this on the
 * same host class that produced the baseline:
 *
 *   node scripts/perf/scan-budget.mjs
 *
 * Exit code 1 when either budget is exceeded, so the command can gate a local
 * or self-hosted job without any extra plumbing.
 *
 * The script:
 *   1. regenerates the deterministic 100/500/2000 fixture with the committed
 *      `generate-suite.mjs` and refuses a digest other than the approved one;
 *   2. runs the Criterion bench in bencher format so the estimate is machine
 *      readable;
 *   3. prints result, budget, and headroom per budgeted size.
 *
 * `--budget-500` / `--budget-2000` override a budget for diagnosis only. Never
 * relax the committed defaults to make a regression pass.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, "../..");
const suiteScript = nodePath.join(here, "generate-suite.mjs");

/** Approved fixture digest: 100/500/2000 trees generated from seed 20261020. */
const FIXTURE_DIGEST = "d8896967d0910fe6e3b8c1a6f5ae0a46f47d5cfd4c079c8d4ead98c3bc024217";
/** Size -> budget in milliseconds. WAR-66 left 35% / 32% headroom on these. */
const DEFAULT_BUDGETS = new Map([
  [500, 2.3],
  [2000, 10],
]);

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const fixtureDir = nodePath.resolve(readArg("fixture", nodePath.join(repoRoot, "perf-fixture")));
const budgets = new Map(DEFAULT_BUDGETS);
for (const size of DEFAULT_BUDGETS.keys()) {
  const raw = readArg(`budget-${size}`, null);
  if (raw === null) continue;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--budget-${size} must be a positive number of milliseconds, got ${raw}`);
    process.exit(2);
  }
  budgets.set(size, value);
}

function resolveCargo() {
  const candidates = [
    process.env.CARGO,
    nodePath.join(os.homedir(), ".cargo", "bin", "cargo"),
    "cargo",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(nodePath.sep) && !existsSync(candidate)) continue;
    return candidate;
  }
  throw new Error("cargo is not on PATH and ~/.cargo/bin/cargo does not exist");
}

function generateFixture() {
  const stdout = execFileSync(process.execPath, [suiteScript, "--out", fixtureDir], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const manifest = JSON.parse(stdout);
  if (manifest.digest !== FIXTURE_DIGEST) {
    throw new Error(
      `fixture digest ${manifest.digest} does not match the approved ${FIXTURE_DIGEST}; ` +
        "the budget would be measured on different bytes",
    );
  }
  return manifest;
}

function parseBencherEstimate(stdout) {
  const results = new Map();
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    const match = /^test\s+(\S+)\s+\.\.\.\s+bench:\s+([\d,]+)\s+ns\/iter/.exec(line);
    if (!match) continue;
    const scan = /^mod_index\/scan\/(\d+)$/.exec(match[1]);
    if (!scan) continue;
    results.set(Number(scan[1]), Number(match[2].replaceAll(",", "")));
  }
  return results;
}

const manifest = generateFixture();
const cargo = resolveCargo();
const benchArgs = [
  "bench",
  "-p",
  "wh3mm-core",
  "--bench",
  "hot_paths",
  "--locked",
  "--",
  "--output-format",
  "bencher",
  "scan/",
];

let stdout;
try {
  stdout = execFileSync(cargo, benchArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CARGO_TERM_COLOR: "never", WH3MM_PERF_FIXTURE: fixtureDir },
  });
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  throw error;
}

const estimates = parseBencherEstimate(stdout);
const missing = [...budgets.keys()].filter((size) => !estimates.has(size));
if (missing.length > 0) {
  process.stderr.write(stdout);
  throw new Error(`bench output is missing ${missing.map((size) => `mod_index/scan/${size}`).join(", ")}`);
}

const host = [
  os.cpus()[0]?.model?.trim() ?? "unknown CPU",
  `${os.cpus().length} threads`,
  `${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`,
  `${os.platform()} ${os.release()}`,
  `Node ${process.version}`,
].join(" / ");

console.log("Scan budget check (WAR-7 / WAR-115)");
console.log(`Host: ${host}`);
console.log(`Fixture: ${fixtureDir} (digest ${manifest.digest})`);
console.log(`Command: ${cargo} ${benchArgs.join(" ")}`);
console.log("Criterion 0.7, default 100 samples, bench profile (release)");
console.log("");
console.log(
  `${"Benchmark".padEnd(26)} ${"Result".padStart(10)} ${"Budget".padStart(10)} ${"Headroom".padStart(10)}  Verdict`,
);

let failed = false;
for (const size of [...budgets.keys()].sort((a, b) => a - b)) {
  const resultMs = estimates.get(size) / 1e6;
  const budgetMs = budgets.get(size);
  const headroom = ((budgetMs - resultMs) / budgetMs) * 100;
  const verdict = resultMs <= budgetMs ? "PASS" : "FAIL";
  if (verdict === "FAIL") failed = true;
  console.log(
    `${`mod_index/scan/${size}`.padEnd(26)} ${`${resultMs.toFixed(3)} ms`.padStart(10)} ` +
      `${`${budgetMs.toFixed(3)} ms`.padStart(10)} ${`${headroom.toFixed(1)}%`.padStart(10)}  ${verdict}`,
  );
}

if (failed) {
  console.error("\nSCAN BUDGET EXCEEDED: a scan path regressed past the approved budget.");
  console.error("Profile the change against the WAR-66 baseline before relaxing any number.");
  process.exitCode = 1;
}
