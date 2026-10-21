import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  evaluate,
  loadConfig,
  renderMarkdown,
  repoRoot,
  scanCutFeatures,
  validateConfig,
} from './parity-report.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(scriptsDir, 'fixtures', 'parity')

function issuesFor(config) {
  const scan = scanCutFeatures(config)
  return validateConfig(config, { scanFindings: scan.findings })
}

test('PARITY.yaml is a complete 10 x 4 scorecard with weights summing to 100', () => {
  const config = loadConfig()
  const issues = validateConfig(config, { scanFindings: scanCutFeatures(config).findings })
  assert.deepEqual(issues, [])
  assert.equal(config.capabilities.length, 10)
  assert.equal(config.capabilities.reduce((sum, item) => sum + item.checks.length, 0), 40)
  assert.equal(
    config.capabilities.reduce((sum, item) => sum + item.weight, 0),
    100,
  )
})

test('the verified index and oracle coverage match the committed snapshot', () => {
  const result = evaluate(loadConfig())
  assert.equal(Number(result.index.toFixed(3)), 86.625)
  assert.equal(result.done, 30)
  assert.equal(result.partial, 9)
  assert.equal(result.missing, 1)
  assert.equal(result.checks, 40)
  assert.equal(result.oracle.mapped, 39)
  assert.equal(result.oracle.total, 39)
  assert.equal(result.oracle.ported, 12)
  assert.equal(result.oracle.rewritten, 10)
  assert.equal(result.oracle.notApplicable, 17)
})

test('docs/PARITY.md is reproducible from PARITY.yaml', () => {
  const config = loadConfig()
  const result = evaluate(config)
  const scan = scanCutFeatures(config)
  const expected = renderMarkdown(config, result, { scan })
  const committed = readFileSync(join(repoRoot, 'docs', 'PARITY.md'), 'utf8')
  assert.equal(committed, expected)
})

test('the cut-feature scan passes a known-good UI and IPC fixture', () => {
  const config = loadConfig()
  const scan = scanCutFeatures(config, { root: join(fixturesDir, 'good') })
  assert.deepEqual(scan.findings, [])
})

test('the cut-feature scan catches a deliberately-bad UI and IPC fixture', () => {
  const config = loadConfig()
  const scan = scanCutFeatures(config, { root: join(fixturesDir, 'bad') })
  assert.ok(scan.findings.length >= 2)
  assert.ok(scan.findings.some((finding) => finding.feature === 'unit-viewer'))
  assert.ok(scan.findings.some((finding) => finding.file.endsWith('commands.rs')))
})

test('a done check without evidence is rejected', () => {
  const config = structuredClone(loadConfig())
  const check = config.capabilities[0].checks.find((item) => item.status === 'done')
  check.evidence = []
  const issues = issuesFor(config)
  assert.ok(issues.some((issue) => issue.includes('missing evidence')))
})

test('a done check with only code text and no test or approved PR is rejected', () => {
  const config = structuredClone(loadConfig())
  const check = config.capabilities[0].checks.find((item) => item.status === 'done')
  check.evidence = [{ path: 'crates/wh3mm-core/src/atomic.rs', contains: 'atomic_write' }]
  const issues = issuesFor(config)
  assert.ok(issues.some((issue) => issue.includes('done needs a passing test')))
})

test('a done check backed only by a QA-pending PR is rejected', () => {
  const config = structuredClone(loadConfig())
  const check = config.capabilities[0].checks.find((item) => item.status === 'done')
  check.evidence = [
    {
      kind: 'pr',
      pr: 20,
      url: 'https://github.com/mak8427/Warhammer_mod_manager/pull/20',
      head: '774c252',
      qa: 'pending',
      path: 'crates/wh3mm-core/src/conflicts.rs',
      test: 'disabled_local_dependency_is_not_treated_as_a_base_game_pack',
    },
  ]
  const issues = issuesFor(config)
  assert.ok(issues.some((issue) => issue.includes('done needs a passing test')))
})

test('an index drop needs a recorded reason', () => {
  const config = structuredClone(loadConfig())
  const result = evaluate(config)
  config.snapshot.previous_index = Number((result.index + 1).toFixed(3))
  config.snapshot.drop_reason = ''
  let issues = issuesFor(config)
  assert.ok(issues.some((issue) => issue.includes('without snapshot.drop_reason')))

  config.snapshot.drop_reason = 'A check regressed; see the task thread.'
  issues = issuesFor(config)
  assert.ok(!issues.some((issue) => issue.includes('without snapshot.drop_reason')))
})

test('the oracle map covers all 39 files and ported entries point at real paths', () => {
  const config = loadConfig()
  assert.equal(config.oracle.files.length, 39)
  assert.equal(config.oracle.total, 39)
  assert.equal(config.oracle.legacy_assertions, 272)
  const ported = config.oracle.files.filter((entry) => entry.disposition === 'ported')
  assert.ok(ported.length > 0)
  for (const entry of ported) {
    assert.ok(entry.ported_to.length > 0, `${entry.path} must name a ported test`)
  }
})

test('the validation catches a malformed oracle entry', () => {
  const config = structuredClone(loadConfig())
  config.oracle.files[0].disposition = 'ported'
  config.oracle.files[0].ported_to = [{ path: 'crates/does-not-exist.rs', test: 'missing' }]
  const issues = issuesFor(config)
  assert.ok(issues.some((issue) => issue.includes('is not in this tree')))
})
