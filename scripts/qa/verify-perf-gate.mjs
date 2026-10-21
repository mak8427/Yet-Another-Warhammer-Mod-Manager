#!/usr/bin/env node
/**
 * Release gate for the CEO performance directive (WAR-6, WAR-7, WAR-19).
 *
 * `docs/PERF.md` is for humans. The gate reads the two raw reports the
 * performance work actually ships (WAR-19 + WAR-46):
 *
 *   docs/perf/legacy-baseline.json   schema: wh3mm.perf.legacy-baseline.v1
 *   docs/perf/new-app.json           schema: wh3mm.perf.new-app.v1
 *
 * A pre-merged `docs/perf/comparison.json` (schema
 * `wh3mm.perf.comparison.v1`) is still accepted for compatibility, but the
 * default path verifies the raw reports and recomputes every median from the
 * samples; the comparison block is treated as a claim to check, not evidence.
 *
 * The gate fails when:
 *   - the file is missing (a missing comparison blocks v1.0 by CEO directive);
 *   - the two runs did not use the same host id or the same fixture digest;
 *   - either build is not a release build;
 *   - fewer than five samples were taken per metric;
 *   - a declared median disagrees with the median computed from the samples;
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
export const LEGACY_SCHEMA = 'wh3mm.perf.legacy-baseline.v1'
export const NEW_APP_SCHEMA = 'wh3mm.perf.new-app.v1'
export const DEFAULT_FILE = 'docs/perf/comparison.json'
export const LEGACY_REPORT = 'docs/perf/legacy-baseline.json'
export const NEW_APP_REPORT = 'docs/perf/new-app.json'
export const PERF_DOC = 'docs/PERF.md'
export const MEDIAN_TOLERANCE_MS = 0.5
export const RATIO_TOLERANCE = 0.01
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

/**
 * Median of a non-empty numeric list. Even-length lists use the mean of the two
 * middle values, matching the usual statistics definition.
 */
export function computeMedian(samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function checkSampleList(label, metric, failures) {
  if (!Array.isArray(metric.samples) || metric.samples.length < MIN_RUNS) {
    failures.push(`${label}: needs at least ${MIN_RUNS} samples, got ${Array.isArray(metric.samples) ? metric.samples.length : 'none'}`)
    return null
  }
  if (metric.samples.some((sample) => !isFinitePositive(sample))) {
    failures.push(`${label}: samples must be positive finite numbers`)
    return null
  }
  if (!isFinitePositive(metric.median)) {
    failures.push(`${label}: median must be a positive finite number`)
    return null
  }
  const computed = computeMedian(metric.samples)
  if (Math.abs(metric.median - computed) > 1e-9 * Math.max(1, Math.abs(computed))) {
    failures.push(
      `${label}: declared median ${metric.median} does not match the median ${computed} computed from the samples`,
    )
    return null
  }
  return computed
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
    const legacyMedian = checkSampleList(`${name}.legacy`, metric.legacy ?? {}, failures)
    const newMedian = checkSampleList(`${name}.newApp`, metric.newApp ?? {}, failures)
    if (legacyMedian === null || newMedian === null) {
      continue
    }
    const ratio = legacyMedian / newMedian
    report.push({
      metric: name,
      legacyMedianMs: legacyMedian,
      newMedianMs: newMedian,
      speedup: Number(ratio.toFixed(2)),
      unit: metric.unit ?? 'ms',
    })
    if (!(newMedian < legacyMedian)) {
      failures.push(
        `${name}: new app ${newMedian}${metric.unit ?? 'ms'} is not strictly faster than legacy ${legacyMedian}${metric.unit ?? 'ms'}`,
      )
    }
    if (HEADLINE_METRICS.includes(name) && ratio < 2) {
      warnings.push(`${name}: speedup ${ratio.toFixed(2)}x is below the 2x headline target`)
    }
  }

  return { ok: failures.length === 0, failures, warnings, report }
}


const REPORT_METRICS = [
  { key: 'coldStartMs', label: 'coldStartToInteractive', headline: true, bar: '>=2x faster' },
  { key: 'modListPopulatedMs', label: 'modLoad500', headline: true, bar: '>=2x faster' },
  { key: 'headerScanMs', label: 'headerScan500', headline: false, bar: 'strictly faster' },
  { key: 'loadOrderPersistMs', label: 'loadOrderApply', headline: false, bar: 'strictly faster' },
  { key: 'presetSwitchMs', label: 'profileSwitch', headline: false, bar: 'strictly faster' },
  { key: 'gameLaunchHandoffMs', label: 'launchHandoff', headline: false, bar: 'strictly faster' },
]

function metricMedian(metrics, key, label, failures) {
  const metric = metrics[key]
  if (!metric || typeof metric !== 'object') {
    failures.push(`${label}.${key} is missing`)
    return null
  }
  const samples = metric.samplesMs
  if (!Array.isArray(samples) || samples.length < MIN_RUNS) {
    failures.push(
      `${label}.${key}: needs at least ${MIN_RUNS} samples, got ${Array.isArray(samples) ? samples.length : 'none'}`,
    )
    return null
  }
  if (samples.some((sample) => !isFinitePositive(sample))) {
    failures.push(`${label}.${key}: samples must be positive finite numbers`)
    return null
  }
  if (!isFinitePositive(metric.medianMs)) {
    failures.push(`${label}.${key}: medianMs must be a positive finite number`)
    return null
  }
  const computed = computeMedian(samples)
  if (Math.abs(metric.medianMs - computed) > MEDIAN_TOLERANCE_MS) {
    failures.push(
      `${label}.${key}: declared median ${metric.medianMs} does not match the median ${computed} computed from the samples`,
    )
    return null
  }
  if (Number.isInteger(metric.n) && metric.n !== samples.length) {
    failures.push(`${label}.${key}: n=${metric.n} but ${samples.length} samples are present`)
  }
  return computed
}

function checkHostPair(legacy, newApp, failures) {
  const left = legacy.environment ?? {}
  const right = newApp.environment ?? {}
  for (const field of ['runnerOs', 'runnerImage', 'osRelease', 'cpu']) {
    if (!isNonEmptyString(left[field]) || !isNonEmptyString(right[field])) {
      failures.push(`host field ${field} is missing from one of the reports`)
    } else if (left[field] !== right[field]) {
      failures.push(`host mismatch on ${field}: legacy="${left[field]}" new="${right[field]}"`)
    }
  }
  if (!isFinitePositive(left.totalMemoryGiB) || left.totalMemoryGiB !== right.totalMemoryGiB) {
    failures.push(
      `host mismatch on totalMemoryGiB: legacy=${left.totalMemoryGiB} new=${right.totalMemoryGiB}`,
    )
  }
  if (newApp.comparison?.hostMatches !== true) {
    failures.push('new-app comparison.hostMatches must be true')
  }
}

function checkRawReportLogs(legacy, newApp, repoRoot, failures) {
  const legacyDir = legacy.rawLogDirectory
  if (!isNonEmptyString(legacyDir) || !existsSync(nodePath.resolve(repoRoot, legacyDir))) {
    failures.push(`legacy rawLogDirectory does not exist: ${legacyDir}`)
  }
  const newDir = newApp.rawLogDirectory
  if (!isNonEmptyString(newDir)) {
    failures.push('new-app rawLogDirectory is required')
    return
  }
  const candidates = [
    newDir,
    newDir.replace('/.', '/'),
    newDir.replace('.new-app-', 'new-app-run-'),
  ]
  if (!candidates.some((candidate) => existsSync(nodePath.resolve(repoRoot, candidate)))) {
    failures.push(`new-app rawLogDirectory does not exist: ${newDir} (tried ${candidates.join(', ')})`)
  }
}

/**
 * Validates the pair of raw reports and recomputes the comparison from samples.
 * Returns { ok, failures, warnings, report }.
 */
export function validatePerfReports(
  legacy,
  newApp,
  { repoRoot = REPO_ROOT, checkRawOutputs = true, perfDoc = null } = {},
) {
  const failures = []
  const warnings = []

  if (legacy?.schema !== LEGACY_SCHEMA) {
    failures.push(`legacy schema must be ${LEGACY_SCHEMA}, got ${JSON.stringify(legacy?.schema)}`)
  }
  if (newApp?.schema !== NEW_APP_SCHEMA) {
    failures.push(`new-app schema must be ${NEW_APP_SCHEMA}, got ${JSON.stringify(newApp?.schema)}`)
  }

  const legacyEnv = legacy?.environment ?? {}
  const newEnv = newApp?.environment ?? {}
  for (const [label, env] of [
    ['legacy', legacyEnv],
    ['new-app', newEnv],
  ]) {
    if (!isNonEmptyString(env.capturedAt) || Number.isNaN(Date.parse(env.capturedAt))) {
      failures.push(`${label}.environment.capturedAt must be an ISO-8601 timestamp`)
    }
    if (!Number.isInteger(env.runs) || env.runs < MIN_RUNS) {
      failures.push(`${label}.environment.runs must be at least ${MIN_RUNS}`)
    }
    if (!Number.isInteger(env.fixturePacks) || env.fixturePacks < 500) {
      failures.push(`${label}.environment.fixturePacks must be at least 500`)
    }
    if (!SHA256_PATTERN.test(String(env.fixtureSha256 ?? ''))) {
      failures.push(`${label}.environment.fixtureSha256 must be a SHA-256 digest`)
    }
  }
  if (legacyEnv.fixtureSha256 !== newEnv.fixtureSha256) {
    failures.push('legacy and new app must use the same fixtureSha256')
  }

  if (!SHA256_PATTERN.test(String(legacyEnv.appSha256 ?? ''))) {
    failures.push('legacy appSha256 is required (release artefact identity)')
  }
  if (!isNonEmptyString(legacyEnv.appPath) || !legacyEnv.appPath.toLowerCase().endsWith('.exe')) {
    failures.push('legacy appPath is required and must point at the Windows executable')
  }
  if (!SHA256_PATTERN.test(String(newEnv.binSha256 ?? ''))) {
    failures.push('new-app binSha256 is required (release build identity)')
  }
  if (!isNonEmptyString(newEnv.binPath) || !/[\\/]release[\\/]/i.test(newEnv.binPath)) {
    failures.push('new-app binPath must point into a release build')
  }
  if (legacyEnv.gameStub?.proxy !== true) {
    failures.push('legacy gameLaunchHandoffMs must be marked as a proxy')
  }
  if (newEnv.stub?.proxy !== true) {
    failures.push('new-app gameLaunchHandoffMs must be marked as a proxy')
  }

  checkHostPair(legacy, newApp, failures)

  const comparison = newApp?.comparison
  if (!comparison || typeof comparison !== 'object') {
    failures.push('new-app comparison block is missing')
  } else {
    if (comparison.legacySchema !== legacy?.schema) {
      failures.push('comparison.legacySchema does not match the legacy report')
    }
    if (comparison.legacyCapturedAt !== legacyEnv.capturedAt) {
      failures.push('comparison.legacyCapturedAt does not match the legacy report')
    }
    if (comparison.legacyHost !== legacyEnv.osRelease) {
      failures.push('comparison.legacyHost does not match the legacy report')
    }
    if (comparison.steamWaitSubtractedMs !== 5000) {
      failures.push('comparison.steamWaitSubtractedMs must document the 5000 ms legacy Steam wait')
    }
    if (!Array.isArray(comparison.rows) || comparison.rows.length !== REPORT_METRICS.length) {
      failures.push(`comparison.rows must contain ${REPORT_METRICS.length} metrics`)
    }
  }

  const rowsByKey = new Map((comparison?.rows ?? []).map((row) => [row.key, row]))
  const report = []
  for (const spec of REPORT_METRICS) {
    const legacyMedian = metricMedian(legacy?.metrics ?? {}, spec.key, 'legacy', failures)
    const newMedian = metricMedian(newApp?.metrics ?? {}, spec.key, 'new-app', failures)
    const row = rowsByKey.get(spec.key)
    if (!row) {
      failures.push(`comparison row ${spec.key} is missing`)
      continue
    }
    if (row.proxy !== (spec.key === 'gameLaunchHandoffMs')) {
      failures.push(`${spec.key}: proxy flag must be ${spec.key === 'gameLaunchHandoffMs'}`)
    }
    if (legacyMedian === null || newMedian === null) {
      continue
    }
    const adjust = row.legacyAdjustMs ?? 0
    if (adjust !== 0 && adjust !== comparison?.steamWaitSubtractedMs) {
      failures.push(`${spec.key}: undocumented legacy adjustment ${adjust} ms`)
    }
    if (adjust !== 0 && !isNonEmptyString(row.adjustNote)) {
      failures.push(`${spec.key}: an adjustment requires an adjustNote`)
    }
    if (adjust !== 0 && spec.key !== 'modListPopulatedMs') {
      failures.push(`${spec.key}: only modListPopulatedMs may subtract the legacy Steam wait`)
    }
    const adjustedLegacy = legacyMedian - adjust
    if (adjustedLegacy <= 0) {
      failures.push(`${spec.key}: adjusted legacy median is not positive`)
      continue
    }
    const ratio = adjustedLegacy / newMedian
    report.push({
      metric: spec.label,
      legacyMedianMs: Number(adjustedLegacy.toFixed(3)),
      newMedianMs: Number(newMedian.toFixed(3)),
      speedup: Number(ratio.toFixed(2)),
      unit: 'ms',
    })
    if (row.legacyMedianMs !== undefined && Math.abs(row.legacyMedianMs - legacyMedian) > MEDIAN_TOLERANCE_MS) {
      failures.push(`${spec.key}: declared legacy median ${row.legacyMedianMs} disagrees with the raw report`)
    }
    if (row.newMedianMs !== undefined && Math.abs(row.newMedianMs - newMedian) > MEDIAN_TOLERANCE_MS) {
      failures.push(`${spec.key}: declared new median ${row.newMedianMs} disagrees with the raw report`)
    }
    if (row.legacyAdjustedMs !== undefined && Math.abs(row.legacyAdjustedMs - adjustedLegacy) > MEDIAN_TOLERANCE_MS) {
      failures.push(`${spec.key}: declared adjusted legacy median ${row.legacyAdjustedMs} is wrong`)
    }
    if (row.ratio !== undefined) {
      const declaredRatio =
        (row.legacyAdjustedMs ?? adjustedLegacy) / (row.newMedianMs ?? newMedian)
      if (Math.abs(row.ratio - declaredRatio) > RATIO_TOLERANCE) {
        failures.push(
          `${spec.key}: declared ratio ${row.ratio} disagrees with its own medians (${declaredRatio.toFixed(2)})`,
        )
      }
    }
    if (row.verdict !== 'pass') {
      failures.push(`${spec.key}: declared verdict is ${JSON.stringify(row.verdict)}, not pass`)
    }
    if (!(newMedian < adjustedLegacy)) {
      failures.push(
        `${spec.key}: new app ${newMedian} ms is not strictly faster than legacy ${adjustedLegacy} ms`,
      )
    }
    if (spec.bar === '>=2x faster' && ratio < 2) {
      failures.push(`${spec.key}: speedup ${ratio.toFixed(2)}x misses the >=2x bar`)
    } else if (spec.headline && ratio < 2) {
      warnings.push(`${spec.label}: speedup ${ratio.toFixed(2)}x is below the 2x headline target`)
    }
  }

  const summary = [
    ['loadOrderPersist', 'loadOrderPersist'],
    ['presetSwitch', 'presetSwitch'],
  ]
  for (const [legacyKey, newKey] of summary) {
    for (const [label, reportSide] of [
      ['legacy', legacy?.interactionSummary?.[legacyKey]],
      ['new-app', newApp?.interactionSummary?.[newKey]],
    ]) {
      if (!reportSide || (reportSide.verified ?? 0) < MIN_RUNS) {
        failures.push(`${label}.interactionSummary.${legacyKey} lacks ${MIN_RUNS} verified runs`)
      }
    }
  }
  if ((legacy?.interactionSummary?.gameLaunch?.verified ?? 0) < MIN_RUNS - 1) {
    failures.push('legacy gameLaunch needs at least 4 verified proxy samples')
  }
  if ((newApp?.interactionSummary?.gameLaunch?.verified ?? 0) < MIN_RUNS) {
    failures.push('new-app gameLaunch needs at least 5 verified proxy samples')
  }

  if (checkRawOutputs) {
    checkRawReportLogs(legacy, newApp, repoRoot, failures)
    const docText = perfDoc ?? (existsSync(nodePath.resolve(repoRoot, PERF_DOC))
      ? readFileSync(nodePath.resolve(repoRoot, PERF_DOC), 'utf8')
      : '')
    if (!docText.includes('## New app vs legacy')) {
      failures.push(`${PERF_DOC} has no "New app vs legacy" section`)
    }
    if (!docText.includes(legacyEnv.fixtureSha256 ?? '<missing-digest>')) {
      failures.push(`${PERF_DOC} does not record the fixture digest`)
    }
  }

  return { ok: failures.length === 0, failures, warnings, report }
}

function parseArgs(argv) {
  const args = { file: null, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--file') args.file = argv[index + 1] ?? DEFAULT_FILE
    if (argv[index] === '--json') args.json = true
  }
  return args
}

function blocked(message) {
  const result = { ok: false, blocked: true, failures: [message], warnings: [], report: [] }
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = 1
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else if (result.ok) {
    console.log('PERF GATE: PASS')
    for (const row of result.report) {
      console.log(
        `  ${row.metric.padEnd(20)} legacy ${String(row.legacyMedianMs).padStart(9)} ${row.unit}  new ${String(row.newMedianMs).padStart(9)} ${row.unit}  ${row.speedup}x`,
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

function main() {
  const args = parseArgs(process.argv.slice(2))
  const explicitComparison = args.file ?? (existsSync(nodePath.resolve(REPO_ROOT, DEFAULT_FILE)) ? DEFAULT_FILE : null)

  if (explicitComparison) {
    const absolute = nodePath.resolve(REPO_ROOT, explicitComparison)
    if (!existsSync(absolute)) {
      blocked(
        `BLOCKED: ${explicitComparison} does not exist. The v1.0 gate requires a new-app vs legacy comparison on the same host and fixture. See docs/QA_PLAN.md §7.`,
      )
      return
    }
    let data
    try {
      data = JSON.parse(readFileSync(absolute, 'utf8'))
    } catch (error) {
      blocked(`BLOCKED: ${explicitComparison} is not valid JSON: ${error.message}`)
      return
    }
    printResult(validateComparison(data), args.json)
    return
  }

  const legacyPath = nodePath.resolve(REPO_ROOT, LEGACY_REPORT)
  const newAppPath = nodePath.resolve(REPO_ROOT, NEW_APP_REPORT)
  if (!existsSync(legacyPath) || !existsSync(newAppPath)) {
    const missing = [existsSync(legacyPath) ? null : LEGACY_REPORT, existsSync(newAppPath) ? null : NEW_APP_REPORT]
      .filter(Boolean)
      .join(', ')
    blocked(
      `BLOCKED: missing raw performance report(s): ${missing}. Expected ${LEGACY_REPORT} + ${NEW_APP_REPORT} (or ${DEFAULT_FILE}). See docs/QA_PLAN.md §7.`,
    )
    return
  }

  let legacy
  let newApp
  try {
    legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
    newApp = JSON.parse(readFileSync(newAppPath, 'utf8'))
  } catch (error) {
    blocked(`BLOCKED: a performance report is not valid JSON: ${error.message}`)
    return
  }
  printResult(validatePerfReports(legacy, newApp), args.json)
}

if (process.argv[1] && nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
