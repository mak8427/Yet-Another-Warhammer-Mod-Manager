/**
 * Regression tests for the `--scale` destruction guard (WAR-24, WAR-29).
 *
 * The predicate tests only exercise the path predicate: they never run the
 * generator or delete an input, so a regression there cannot remove the
 * repository. The final test spawns the generator against a disposable temp
 * directory with a sentinel file, so a missing call-site guard fails the suite
 * without ever pointing `--scale` at the repository or a protected path.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { canonicalPath, checkScaleTarget, SCALE_OUTPUT_SCHEMA } from './fixture-target.mjs'

const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..')
const GENERATOR = nodePath.join(REPO_ROOT, 'scripts', 'qa', 'generate-fixtures.mjs')

function tempRoot(t, prefix) {
  const root = mkdtempSync(nodePath.join(tmpdir(), `wh3mm-${prefix}-`))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function makeRepo(t) {
  const root = tempRoot(t, 'guard-repo')
  const repo = nodePath.join(root, 'repository')
  mkdirSync(nodePath.join(repo, 'fixtures'), { recursive: true })
  return { root, repo, home: nodePath.join(root, 'home') }
}

test('rejects the repository root', (t) => {
  const { repo, home } = makeRepo(t)
  const result = checkScaleTarget(repo, { repoRoot: repo, home })
  assert.equal(result.ok, false)
  assert.match(result.reason, /repository root/)
})

test('rejects a path inside the repository, including one that does not exist yet', (t) => {
  const { repo, home } = makeRepo(t)
  for (const target of [
    nodePath.join(repo, 'fixtures'),
    nodePath.join(repo, 'build', 'scale-output'),
  ]) {
    const result = checkScaleTarget(target, { repoRoot: repo, home })
    assert.equal(result.ok, false, target)
    assert.match(result.reason, /inside the repository/)
  }
})

test('rejects an ancestor of the repository', (t) => {
  const { root, repo, home } = makeRepo(t)
  const result = checkScaleTarget(root, { repoRoot: repo, home })
  assert.equal(result.ok, false)
  assert.match(result.reason, /ancestor of the repository/)
})

test('rejects the home directory and its ancestors', (t) => {
  const repo = nodePath.join(tempRoot(t, 'guard-repo-only'), 'repository')
  mkdirSync(repo)
  const home = nodePath.join(tempRoot(t, 'guard-home-only'), 'nested', 'home')
  mkdirSync(home, { recursive: true })

  const atHome = checkScaleTarget(home, { repoRoot: repo, home })
  assert.equal(atHome.ok, false)
  assert.match(atHome.reason, /home directory/)

  const aboveHome = checkScaleTarget(nodePath.dirname(home), { repoRoot: repo, home })
  assert.equal(aboveHome.ok, false)
  assert.match(aboveHome.reason, /ancestor of the user home directory/)

  const realHome = checkScaleTarget(homedir(), { repoRoot: repo })
  assert.equal(realHome.ok, false)
  assert.match(realHome.reason, /home directory/)
})

test('rejects a non-empty unrelated directory without --force and accepts it with --force', (t) => {
  const { root, repo, home } = makeRepo(t)
  const target = nodePath.join(root, 'unrelated')
  mkdirSync(target)
  writeFileSync(nodePath.join(target, 'precious.txt'), 'precious\n')

  const refused = checkScaleTarget(target, { repoRoot: repo, home })
  assert.equal(refused.ok, false)
  assert.match(refused.reason, /not empty/)
  assert.match(refused.reason, /--force/)

  const forced = checkScaleTarget(target, { repoRoot: repo, home, force: true })
  assert.equal(forced.ok, true)
  assert.equal(forced.path, canonicalPath(target))
})

test('accepts a fresh directory and an empty existing directory', (t) => {
  const { root, repo, home } = makeRepo(t)
  const fresh = nodePath.join(root, 'fresh', 'output')
  const empty = nodePath.join(root, 'empty')
  mkdirSync(empty)

  for (const target of [fresh, empty]) {
    const result = checkScaleTarget(target, { repoRoot: repo, home })
    assert.equal(result.ok, true, target)
    assert.equal(result.path, canonicalPath(target))
  }
})

test('accepts a previous --scale output without --force', (t) => {
  const { root, repo, home } = makeRepo(t)
  const target = nodePath.join(root, 'previous-output')
  mkdirSync(target)
  writeFileSync(
    nodePath.join(target, 'fixture-manifest.json'),
    `${JSON.stringify({ schema: SCALE_OUTPUT_SCHEMA, count: 1, entries: [] })}\n`,
  )
  writeFileSync(nodePath.join(target, 'leftover.txt'), 'from a finished run\n')

  const result = checkScaleTarget(target, { repoRoot: repo, home })
  assert.equal(result.ok, true)
})

test('resolves symlinks before comparing', (t) => {
  const { root, repo, home } = makeRepo(t)
  const toRepo = nodePath.join(root, 'link-to-repo')
  symlinkSync(repo, toRepo, 'dir')
  const toInside = nodePath.join(root, 'link-to-fixtures')
  symlinkSync(nodePath.join(repo, 'fixtures'), toInside, 'dir')

  for (const target of [toRepo, toInside]) {
    const result = checkScaleTarget(target, { repoRoot: repo, home })
    assert.equal(result.ok, false, target)
    assert.match(result.reason, /repository/)
  }
})

test('--force never bypasses a protected target', (t) => {
  const { repo, home } = makeRepo(t)
  const result = checkScaleTarget(nodePath.join(repo, 'fixtures'), {
    repoRoot: repo,
    home,
    force: true,
  })
  assert.equal(result.ok, false)
  assert.match(result.reason, /inside the repository/)
})

test('rejects a target that exists but is not a directory', (t) => {
  const { root, repo, home } = makeRepo(t)
  const target = nodePath.join(root, 'not-a-directory')
  writeFileSync(target, 'data\n')

  const result = checkScaleTarget(target, { repoRoot: repo, home })
  assert.equal(result.ok, false)
  assert.match(result.reason, /not a directory/)
})

test('the CLI refuses a non-empty --scale target before deleting it', (t) => {
  const target = nodePath.join(tempRoot(t, 'guard-cli'), 'output')
  mkdirSync(target)
  const sentinel = nodePath.join(target, 'precious.txt')
  writeFileSync(sentinel, 'precious\n')

  const result = spawnSync(process.execPath, [GENERATOR, '--scale', target, '--count', '1'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })

  assert.equal(existsSync(sentinel), true, 'the sentinel file must survive a refused run')
  assert.equal(readFileSync(sentinel, 'utf8'), 'precious\n')
  assert.notEqual(result.status, 0, `generator must fail, got status ${result.status}`)
  assert.match(`${result.stdout}${result.stderr}`, /refusing/)
})
