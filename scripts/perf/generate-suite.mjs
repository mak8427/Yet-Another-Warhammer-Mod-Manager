#!/usr/bin/env node
/**
 * Builds the three benchmark workloads (100 / 500 / 2000 packs) from the *same* generator that
 * produces the QA and performance fixture, so every consumer measures the same bytes.
 *
 * The per-size generator lives in `generate-fixture.mjs`; this script only orchestrates it,
 * verifies each tree, and records one suite manifest. Nothing here is committed: the packs are
 * generated on demand and ignored by git.
 *
 * Usage:
 *   node scripts/perf/generate-suite.mjs [--out DIR] [--counts 100,500,2000] [--seed 20261020]
 *   node scripts/perf/generate-suite.mjs --verify DIR
 *
 * Output: <out>/suite-manifest.json (schema `wh3mm.perf.fixture-suite.v1`) and one
 * `<out>/wh3-<count>/fixture-manifest.json` per size.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = nodePath.dirname(fileURLToPath(import.meta.url));
const generator = nodePath.join(here, "generate-fixture.mjs");
const DEFAULTS = { out: nodePath.resolve("perf-fixture"), seed: 20261020, counts: [100, 500, 2000] };

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const hasFlag = (name) => args.includes(`--${name}`);

function parseCounts(raw) {
  const counts = String(raw)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (counts.length === 0) throw new Error(`invalid --counts: ${raw}`);
  return counts;
}

function suiteDigest(fixtures) {
  // The per-fixture sha256 is a content digest over the pack tree, so this is stable across hosts.
  const lines = fixtures
    .map((fixture) => `${fixture.count}:${fixture.sha256}:${fixture.packFiles}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(lines).digest("hex");
}

async function generateOne(out, count, seed) {
  const target = nodePath.join(out, `wh3-${count}`);
  const { stdout } = await run(
    process.execPath,
    [generator, "--out", target, "--count", String(count), "--seed", String(seed)],
    { maxBuffer: 1024 * 1024 },
  );
  const manifest = JSON.parse(stdout);
  const { stdout: verified } = await run(process.execPath, [generator, "--verify", target], {
    maxBuffer: 1024 * 1024,
  });
  const check = JSON.parse(verified);
  if (!check.ok) throw new Error(`fixture ${count} failed verification: ${verified}`);
  return {
    count,
    path: nodePath.relative(out, target).replaceAll("\\", "/"),
    packFiles: manifest.packFiles,
    variants: manifest.variants,
    sha256: manifest.sha256,
    generatedInMs: manifest.generatedInMs,
  };
}

async function verifySuite(out) {
  const manifest = JSON.parse(await readFile(nodePath.join(out, "suite-manifest.json"), "utf8"));
  const failures = [];
  for (const fixture of manifest.fixtures) {
    const target = nodePath.join(out, fixture.path);
    const { stdout } = await run(process.execPath, [generator, "--verify", target], {
      maxBuffer: 1024 * 1024,
    });
    const check = JSON.parse(stdout);
    if (!check.ok || check.sha256 !== fixture.sha256 || check.packs !== fixture.packFiles) {
      failures.push({
        count: fixture.count,
        expected: { sha256: fixture.sha256, packs: fixture.packFiles },
        actual: { sha256: check.sha256, packs: check.packs, ok: check.ok },
      });
    }
  }
  const actualDigest = suiteDigest(manifest.fixtures);
  const ok = failures.length === 0 && actualDigest === manifest.digest;
  console.log(
    JSON.stringify(
      { ok, digest: actualDigest, expectedDigest: manifest.digest, failures, fixtures: manifest.fixtures },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

const out = nodePath.resolve(readArg("out", DEFAULTS.out));
const seed = Number(readArg("seed", DEFAULTS.seed));
const counts = parseCounts(readArg("counts", DEFAULTS.counts.join(",")));

if (hasFlag("verify")) {
  await verifySuite(nodePath.resolve(readArg("verify", out)));
} else {
  const startedAt = Date.now();
  const fixtures = [];
  for (const count of counts) fixtures.push(await generateOne(out, count, seed));
  const suite = {
    schema: "wh3mm.perf.fixture-suite.v1",
    seed,
    counts,
    fixtures,
    digest: suiteDigest(fixtures),
  };
  await writeFile(
    nodePath.join(out, "suite-manifest.json"),
    `${JSON.stringify(suite, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      { ok: true, out, ...suite, generatedInMs: Date.now() - startedAt },
      null,
      2,
    ),
  );
}
