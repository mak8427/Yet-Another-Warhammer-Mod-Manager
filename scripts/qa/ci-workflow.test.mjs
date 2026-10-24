import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8'))

test('CI and packaging avoid duplicate branch-push runs for pull requests', () => {
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/linux-packages.yml']) {
    const config = parse(readFileSync(join(repoRoot, path), 'utf8'))
    assert.deepEqual(config.on.push.branches, ['main'])
    assert.ok(Object.hasOwn(config.on, 'pull_request'))
    assert.ok(Object.hasOwn(config.on, 'workflow_dispatch'))
    assert.equal(config.concurrency['cancel-in-progress'], true)
  }
})

test('test-only frontend changes do not rebuild Linux installers', () => {
  const packages = parse(readFileSync(join(repoRoot, '.github/workflows/linux-packages.yml'), 'utf8'))
  for (const event of ['push', 'pull_request']) {
    const paths = packages.on[event].paths
    assert.ok(paths.includes('frontend/**'), 'production frontend changes must still build packages')
    for (const excluded of [
      '!frontend/**/*.test.ts', '!frontend/**/*.test.tsx', '!frontend/**/*.bench.tsx',
      '!frontend/src/test/**', '!frontend/vite.perf.config.ts',
    ]) {
      assert.ok(paths.indexOf(excluded) > paths.indexOf('frontend/**'), excluded)
    }
  }
})

test('frontend behavior checks run without waiting for a desktop build', () => {
  const frontend = workflow.jobs.frontend
  assert.ok(frontend, 'frontend checks need an independent job')
  assert.equal(frontend.needs, undefined)
  assert.ok(frontend.steps.some((step) => step.run === 'pnpm typecheck'))
  assert.ok(frontend.steps.some((step) => step.run === 'pnpm lint'))
  const tests = frontend.steps.find((step) => step.run?.includes('vitest run'))
  assert.ok(tests, 'the frontend job must execute the behavior suite')
  assert.notEqual(tests['continue-on-error'], true)
  assert.match(tests.run, /--reporter=junit/)
  assert.match(tests.run, /--outputFile\.junit=test-results\/frontend\.xml/)
  const upload = frontend.steps.find((step) => step.with?.name === 'frontend-test-results')
  assert.ok(upload, 'test results must be retained for debugging failed runs')
  assert.equal(upload.if, 'always()')
  assert.equal(upload.with.path, 'frontend/test-results/frontend.xml')
})

test('the required Linux gate cannot pass when frontend checks fail or are skipped', () => {
  const linux = workflow.jobs.linux
  assert.equal(linux.name, 'Linux quality gates')
  assert.ok([linux.needs].flat().includes('frontend'))
  assert.match(linux.if, /!cancelled\(\)/)
  const gate = linux.steps[0]
  assert.equal(gate.env?.FRONTEND_RESULT, '${{ needs.frontend.result }}')
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', gate.run], {
      env: { ...process.env, FRONTEND_RESULT: result },
      encoding: 'utf8',
      timeout: 5_000,
    })
    assert.ifError(run.error)
    assert.equal(run.status, result === 'success' ? 0 : 1, `frontend result: ${result}`)
  }
})
