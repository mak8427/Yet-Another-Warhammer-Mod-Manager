import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as nodePath from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  COMPARISON_SCHEMA,
  PRIMARY_METRICS,
  validateComparison,
} from './verify-perf-gate.mjs'

const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = nodePath.join(REPO_ROOT, 'scripts', 'qa', 'verify-perf-gate.mjs')
const DIGEST = 'a'.repeat(64)

function metric(legacyMedian, newMedian, unit = 'ms') {
  return {
    unit,
    legacy: { median: legacyMedian, samples: [legacyMedian, legacyMedian + 1, legacyMedian - 1, legacyMedian, legacyMedian] },
    newApp: { median: newMedian, samples: [newMedian, newMedian + 1, newMedian - 1, newMedian, newMedian] },
  }
}

function validComparison() {
  return {
    schema: COMPARISON_SCHEMA,
    generatedAt: '2026-10-25T12:00:00Z',
    fixture: { path: 'perf-fixture/wh3-500', digest: DIGEST, modCount: 500 },
    environment: {
      sameHost: true,
      hostId: 'win-ci-1',
      os: 'Windows 11 23H2 22631.4317',
      cpu: 'AMD EPYC 2 vCPU',
      ramGb: 32,
      date: '2026-10-25',
      runs: 5,
    },
    legacy: {
      build: 'release',
      version: '2.29.0',
      commit: '07fcf3ea1428fe3aa88282ba7aed44d9947ef103',
      hostId: 'win-ci-1',
      fixtureDigest: DIGEST,
      rawOutput: 'docs/perf/legacy.json',
    },
    newApp: {
      build: 'release',
      version: '1.0.0',
      commit: 'c1a9cdd',
      hostId: 'win-ci-1',
      fixtureDigest: DIGEST,
      rawOutput: 'docs/perf/new-app.json',
    },
    metrics: {
      coldStartToInteractive: metric(1197, 400),
      modLoad500: metric(1718, 600),
      loadOrderApply: metric(120, 60),
      profileSwitch: metric(80, 30),
      launchHandoff: metric(250, 120),
    },
  }
}

function validate(mutator, options = {}) {
  const data = validComparison()
  mutator(data)
  return validateComparison(data, { checkRawOutputs: false, ...options })
}

test('accepts a complete, strictly faster comparison', () => {
  const result = validate(() => {})
  assert.equal(result.ok, true, result.failures.join('\n'))
  assert.equal(result.report.length, PRIMARY_METRICS.length)
  assert.equal(result.warnings.length, 0)
})

test('rejects a metric that is slower than legacy', () => {
  const result = validate((data) => {
    data.metrics.modLoad500 = metric(1718, 2000)
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /modLoad500: new app .* is not strictly faster/)
})

test('rejects a declared median that disagrees with the samples (WAR-56 F1 repro)', () => {
  const result = validate((data) => {
    data.metrics.coldStartToInteractive = {
      unit: 'ms',
      legacy: { median: 100, samples: [99, 100, 100, 100, 101] },
      // Declared 50 looks 2x faster, but the real sample median is 200 (slower).
      newApp: { median: 50, samples: [50, 200, 200, 200, 200] },
    }
  })
  assert.equal(result.ok, false)
  assert.match(
    result.failures.join('\n'),
    /declared median 50 does not match the median 200 computed from the samples/,
  )
  assert.equal(
    result.report.some((row) => row.metric === 'coldStartToInteractive'),
    false,
    'a metric with a dishonest median must not appear in the PASS report',
  )
})

test('rejects a metric that is equal to legacy', () => {
  const result = validate((data) => {
    data.metrics.profileSwitch = metric(80, 80)
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /profileSwitch: new app .* is not strictly faster/)
})

test('rejects a missing primary metric', () => {
  const result = validate((data) => {
    delete data.metrics.launchHandoff
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /metric launchHandoff is missing/)
})

test('rejects different fixture digests between the two runs', () => {
  const result = validate((data) => {
    data.newApp.fixtureDigest = 'b'.repeat(64)
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /same fixtureDigest|must match fixture.digest/)
})

test('rejects a debug build on either side', () => {
  const result = validate((data) => {
    data.newApp.build = 'debug'
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /newApp.build must be "release"/)
})

test('rejects fewer than five runs', () => {
  const result = validate((data) => {
    data.environment.runs = 4
    data.metrics.coldStartToInteractive.legacy.samples = [1197, 1198, 1196, 1197]
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /at least 5 samples|environment.runs/)
})

test('rejects a different host id', () => {
  const result = validate((data) => {
    data.newApp.hostId = 'other-host'
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /same hostId/)
})

test('rejects sameHost=false', () => {
  const result = validate((data) => {
    data.environment.sameHost = false
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /sameHost must be true/)
})

test('rejects a missing raw output file when checking the repository', () => {
  const result = validate(() => {}, { checkRawOutputs: true })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /rawOutput does not exist/)
})

test('warns when a headline metric misses the 2x target but still passes', () => {
  const result = validate((data) => {
    data.metrics.coldStartToInteractive = metric(1000, 900)
  })
  assert.equal(result.ok, true, result.failures.join('\n'))
  assert.match(result.warnings.join('\n'), /below the 2x headline target/)
})

test('the release command blocks when the comparison file is missing', () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--file', 'docs/perf/definitely-missing.json', '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  assert.equal(result.status, 1)
  assert.match(result.stdout, /BLOCKED/)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.blocked, true)
})
