import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../retry-command.sh')
const command = `
  const fs = require('node:fs')
  const [state, failures, code, ...args] = process.argv.slice(1)
  const count = fs.existsSync(state) ? Number(fs.readFileSync(state, 'utf8')) + 1 : 1
  fs.writeFileSync(state, String(count))
  console.log(JSON.stringify(args))
  process.exit(count <= Number(failures) ? Number(code) : 0)
`

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wh3mm-ci-retry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const state = join(root, 'attempts')
  return {
    state,
    run: (failures, code = 17, env = {}) => spawnSync('bash', [
      script, process.execPath, '-e', command, state, String(failures), String(code),
      'two words', 'literal $() and *',
    ], {
      encoding: 'utf8',
      env: { ...process.env, CI_RETRY_ATTEMPTS: '3', CI_RETRY_DELAY_SECONDS: '0', ...env },
      timeout: 5_000,
    }),
  }
}

test('dependency retries recover from transient errors and preserve arguments', (t) => {
  const { state, run } = fixture(t)
  const result = run(2)
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(state, 'utf8'), '3')
  assert.deepEqual(result.stdout.trim().split('\n').map((line) => JSON.parse(line)), [
    ['two words', 'literal $() and *'],
    ['two words', 'literal $() and *'],
    ['two words', 'literal $() and *'],
  ])
})

test('a successful command runs only once', (t) => {
  const { state, run } = fixture(t)
  assert.equal(run(0).status, 0)
  assert.equal(readFileSync(state, 'utf8'), '1')
})

test('persistent failures exhaust the retry limit and preserve the exit code', (t) => {
  const { state, run } = fixture(t)
  const result = run(10)
  assert.equal(result.status, 17)
  assert.equal(readFileSync(state, 'utf8'), '3')
})

test('interruption does not restart the command', (t) => {
  const { state, run } = fixture(t)
  assert.equal(run(10, 130).status, 130)
  assert.equal(readFileSync(state, 'utf8'), '1')
})

test('invalid retry settings fail before executing the command', (t) => {
  const { state, run } = fixture(t)
  for (const env of [
    { CI_RETRY_ATTEMPTS: '0' }, { CI_RETRY_ATTEMPTS: '6' },
    { CI_RETRY_ATTEMPTS: 'wrong' }, { CI_RETRY_DELAY_SECONDS: '-1' },
    { CI_RETRY_DELAY_SECONDS: '31' },
  ]) {
    assert.equal(run(0, 17, env).status, 2)
    assert.equal(existsSync(state), false)
  }
})
