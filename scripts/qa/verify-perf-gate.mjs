#!/usr/bin/env node
/**
 * Release gate for the CEO performance directive (WAR-6, WAR-7, WAR-19).
 *
 * `docs/PERF.md` is for humans. This script validates the machine-readable
 * comparison that backs it:
 *
 *   docs/perf/comparison.json   schema: wh3mm.perf.comparison.v1
 *
 * The gate fails when:
 *   - the file is missing (a missing comparison blocks v1.0 by CEO directive);
 *   - the two runs did not use the same host id or the same fixture digest;
 *   - either build is not a release build;
 *   - fewer than five samples were taken per metric;
 *   - any primary metric is not strictly faster than legacy.
 *
 * Usage:
 *   node scripts/qa/verify-perf-gate.mjs [--file PATH] [--json]
 *
 * This is a release-time check, not a per-PR CI job: the comparison can only
 * exist after WAR-7 measures the new app on the same host as the legacy run.
 */
import { existsSync, readFileSync } from 'node:fs'
import * as nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

export const COMPARISON_SCHEMA = 'wh3mm.perf.comparison.v1'
export const DEFAULT_FILE = 'docs/perf/comparison.json'
export const MIN_RUNS = 5
export const PRIMARY_METRICS = [
  'coldStartToInteractive',
  'modLoad500',
  'loadOrderApply',
  'profileSwitch',
  'launchHandoff',
]
export const HEADLINE_METRICS = ['coldStartToInteractive', 'modLoad500']

const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHA256_PATTERN = /^[0-9a-f]{64}$/

function isFinitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function checkSampleList(label, metric, failures) {
  if (!Array.isArray(metric.samples) || metric.samples.length < MIN_RUNS) {
    failures.push(`${label}: needs at least ${MIN_RUNS} samples, got ${Array.isArray(metric.samples) ? metric.samples.length : 'none'}`)
    return
  }
  if (metric.samples.some((sample) => !isFinitePositive(sample))) {
    failures.push(`${label}: samples must be positive finite numbers`)
    return
  }
  if (!isFinitePositive(metric.median)) {
    failures.push(`${label}: median must be a positive finite number`)
    return
  }
  const min = Math.min(...metric.samples)
  const max = Math.max(...metric.samples)
  if (metric.median < min || metric.median > max) {
    failures.push(`${label}: median ${metric.median} is outside the sample range ${min}..${max}`)
  }
}

/**
 * Pure validator. Returns { ok, failures, warnings, report }.
 * `checkRawOutputs` is false in unit tests that use synthetic paths.
 */
export function validateComparison(data, { repoRoot = REPO_ROOT, checkRawOutputs = true } = {}) {
  const failures = []
  const warnings = []

  if (!data || typeof data !== 'object') {
    return { ok: false, failures: ['comparison is not a JSON object'], warnings, report: null }
  }
  if (data.schema !== COMPARISON_SCHEMA) {
    failures.push(`schema must be ${COMPARISON_SCHEMA}, got ${JSON.stringify(data.schema)}`)
  }
  if (!isNonEmptyString(data.generatedAt) || Number.isNaN(Date.parse(data.generatedAt))) {
    failures.push('generatedAt must be an ISO-8601 timestamp')
  }

  const fixture = data.fixture ?? {}
  if (!isNonEmptyString(fixture.path)) failures.push('fixture.path is required')
  if (!SHA256_PATTERN.test(String(fixture.digest ?? ''))) {
    failures.push('fixture.digest must be a 64-character lowercase SHA-256 hex digest')
  }
  if (!Number.isInteger(fixture.modCount) || fixture.modCount < 500) {
    failures.push(`fixture.modCount must be at least 500, got ${fixture.modCount}`)
  }

  const environment = data.environment ?? {}
  if (environment.sameHost !== true) failures.push('environment.sameHost must be true')
  if (!isNonEmptyString(environment.hostId)) failures.push('environment.hostId is required')
  if (!isNonEmptyString(environment.os)) failures.push('environment.os is required')
  if (!isNonEmptyString(environment.cpu)) failures.push('environment.cpu is required')
  if (!isFinitePositive(environment.ramGb)) failures.push('environment.ramGb is required')
  if (!isNonEmptyString(environment.date)) failures.push('environment.date is required')
  if (!Number.isInteger(environment.runs) || environment.runs < MIN_RUNS) {
    failures.push(`environment.runs must be at least ${MIN_RUNS}, got ${environment.runs}`)
  }

  for (const side of ['legacy', 'newApp']) {
    const run = data[side] ?? {}
    if (run.build !== 'release') failures.push(`${side}.build must be "release", got ${JSON.stringify(run.build)}`)
    if (!isNonEmptyString(run.version)) failures.push(`${side}.version is required`)
    if (!isNonEmptyString(run.commit)) failures.push(`${side}.commit is required`)
    if (!isNonEmptyString(run.hostId)) failures.push(`${side}.hostId is required`)
    if (run.hostId !== environment.hostId) failures.push(`${side}.hostId must match environment.hostId`)
    if (!SHA256_PATTERN.test(String(run.fixtureDigest ?? ''))) {
      failures.push(`${side}.fixtureDigest must be a SHA-256 hex digest`)
    }
    if (run.fixtureDigest !== fixture.digest) failures.push(`${side}.fixtureDigest must match fixture.digest`)
    if (!isNonEmptyString(run.rawOutput)) {
      failures.push(`${side}.rawOutput is required`)
    } else if (checkRawOutputs && !existsSync(nodePath.resolve(repoRoot, run.rawOutput))) {
      failures.push(`${side}.rawOutput does not exist: ${run.rawOutput}`)
    }
  }
  if (isNonEmptyString(data.legacy?.hostId) && data.legacy?.hostId !== data.newApp?.hostId) {
    failures.push('legacy and newApp must run on the same hostId')
  }
  if (
    isNonEmptyString(data.legacy?.fixtureDigest) &&
    data.legacy?.fixtureDigest !== data.newApp?.fixtureDigest
  ) {
    failures.push('legacy and newApp must use the same fixtureDigest')
  }

  const metrics = data.metrics ?? {}
  const report = []
  for (const name of PRIMARY_METRICS) {
    const metric = metrics[name]
    if (!metric || typeof metric !== 'object') {
      failures.push(`metric ${name} is missing`)
      continue
    }
    checkSampleList(`${name}.legacy`, metric.legacy ?? {}, failures)
    checkSampleList(`${name}.newApp`, metric.newApp ?? {}, failures)
    if (!isFinitePositive(metric.legacy?.median) || !isFinitePositive(metric.newApp?.median)) {
      continue
    }
    const ratio = metric.legacy.median / metric.newApp.median
    report.push({
      metric: name,
      legacyMedianMs: metric.legacy.median,
      newMedianMs: metric.newApp.median,
      speedup: Number(ratio.toFixed(2)),
      unit: metric.unit ?? 'ms',
    })
    if (!(metric.newApp.median < metric.legacy.median)) {
      failures.push(
        `${name}: new app ${metric.newApp.median}${metric.unit ?? 'ms'} is not strictly faster than legacy ${metric.legacy.median}${metric.unit ?? 'ms'}`,
      )
    }
    if (HEADLINE_METRICS.includes(name) && ratio < 2) {
      warnings.push(`${name}: speedup ${ratio.toFixed(2)}x is below the 2x headline target`)
    }
  }

  return { ok: failures.length === 0, failures, warnings, report }
}

function parseArgs(argv) {
  const args = { file: DEFAULT_FILE, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--file') args.file = argv[index + 1] ?? DEFAULT_FILE
    if (argv[index] === '--json') args.json = true
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const absolute = nodePath.resolve(REPO_ROOT, args.file)
  if (!existsSync(absolute)) {
    const result = {
      ok: false,
      blocked: true,
      failures: [
        `BLOCKED: ${args.file} does not exist. The v1.0 gate requires a new-app vs legacy comparison on the same host and fixture. See docs/QA_PLAN.md §7.`,
      ],
      warnings: [],
      report: [],
    }
    console.log(args.json ? JSON.stringify(result, null, 2) : result.failures.join('\n'))
    process.exitCode = 1
    return
  }

  let data
  try {
    data = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    console.error(`BLOCKED: ${args.file} is not valid JSON: ${error.message}`)
    process.exitCode = 1
    return
  }

  const result = validateComparison(data)
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else if (result.ok) {
    console.log('PERF GATE: PASS')
    for (const row of result.report) {
      console.log(
        `  ${row.metric.padEnd(24)} legacy ${String(row.legacyMedianMs).padStart(8)} ${row.unit}  new ${String(row.newMedianMs).padStart(8)} ${row.unit}  ${row.speedup}x`,
      )
    }
    for (const warning of result.warnings) console.log(`  warning: ${warning}`)
  } else {
    console.log('PERF GATE: FAIL')
    for (const failure of result.failures) console.log(`  - ${failure}`)
    for (const warning of result.warnings) console.log(`  warning: ${warning}`)
  }
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] && nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
