import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflows = ['.github/workflows/linux-packages.yml', '.github/workflows/release.yml']

function readWorkflow(path) {
  return parse(readFileSync(join(repoRoot, path), 'utf8'))
}

function steps(doc) {
  return Object.entries(doc.jobs ?? {}).flatMap(([jobName, job]) =>
    (job.steps ?? []).map((step, index) => ({ jobName, index: index + 1, step })),
  )
}

test('every pipefail step explicitly selects bash', () => {
  const offenders = []
  for (const path of workflows) {
    for (const { jobName, index, step } of steps(readWorkflow(path))) {
      const run = typeof step.run === 'string' ? step.run : ''
      if (/\bset -euo pipefail\b/.test(run) && step.shell !== 'bash') {
        offenders.push(`${path}: ${jobName} step ${index} (${step.name ?? 'unnamed'})`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})

test('Fedora smoke test installs the dbus-run-session provider', () => {
  const fedora = readWorkflow('.github/workflows/linux-packages.yml').jobs?.fedora
  assert.ok(fedora, 'fedora job is missing')
  const install = (fedora.steps ?? []).find(
    (step) => step.name === 'Install runtime dependencies and the smoke-test harness',
  )
  assert.ok(install, 'Fedora dependency step is missing')
  assert.match(install.run, /\bdbus-daemon\b/)
})

test('Arch Rust gates run as a non-root builder', () => {
  const arch = readWorkflow('.github/workflows/linux-packages.yml').jobs?.arch
  assert.ok(arch, 'arch job is missing')
  const create = (arch.steps ?? []).find((step) => step.name === 'Create non-root builder')
  assert.ok(create, 'arch job must create a non-root builder')
  const gates = (arch.steps ?? []).find((step) => step.name === 'Rust gates')
  assert.ok(gates, 'arch Rust gates step is missing')
  assert.match(gates.run, /id -u/)
  assert.match(gates.run, /sudo -u builder/)
})

test('packaging shell scripts parse', () => {
  for (const script of [
    'packaging/linux/smoke-test.sh',
    'packaging/arch/render.sh',
    'packaging/arch/build-package.sh',
  ]) {
    const result = spawnSync('bash', ['-n', join(repoRoot, script)], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${script}: ${result.stderr}`)
  }
})

test('smoke-test rejects a missing binary before touching the display', () => {
  const result = spawnSync('bash', [join(repoRoot, 'packaging/linux/smoke-test.sh'), '/no/such/wh3mm'], {
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing or not executable/)
})

test('render.sh substitutes the release version, digest, and source URL', () => {
  const out = mkdtempSync(join(tmpdir(), 'wh3mm-render-'))
  const digest = 'a'.repeat(64)
  try {
    execFileSync(
      'bash',
      [
        join(repoRoot, 'packaging/arch/render.sh'),
        '1.2.3',
        digest,
        'file:///tmp/wh3mm-1.2.3-linux-x86_64.tar.gz',
        out,
      ],
      { cwd: repoRoot },
    )
    const pkgbuild = readFileSync(join(out, 'PKGBUILD'), 'utf8')
    assert.match(pkgbuild, /^pkgver=1\.2\.3$/m)
    assert.match(pkgbuild, new RegExp(`^sha256sums=\\('${digest}'\\)$`, 'm'))
    assert.match(
      pkgbuild,
      /^source=\("wh3mm-\$\{pkgver\}-linux-x86_64\.tar\.gz::file:\/\/\/tmp\/wh3mm-1\.2\.3-linux-x86_64\.tar\.gz"\)$/m,
    )

    const srcinfo = readFileSync(join(out, '.SRCINFO'), 'utf8')
    assert.match(srcinfo, /^\tpkgver = 1\.2\.3$/m)
    assert.match(srcinfo, new RegExp(`^\\tsha256sums = ${digest}$`, 'm'))
    assert.match(srcinfo, /^\tdepends = webkit2gtk-4\.1$/m)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('render.sh rejects invalid versions and digests', () => {
  const out = mkdtempSync(join(tmpdir(), 'wh3mm-render-bad-'))
  try {
    const digest = 'b'.repeat(64)
    const badVersion = spawnSync(
      'bash',
      [join(repoRoot, 'packaging/arch/render.sh'), '1.2', digest, 'file:///tmp/x', out],
      { encoding: 'utf8' },
    )
    assert.notEqual(badVersion.status, 0)
    assert.match(badVersion.stderr, /not X\.Y\.Z/)

    const badDigest = spawnSync(
      'bash',
      [join(repoRoot, 'packaging/arch/render.sh'), '1.2.3', 'abc', 'file:///tmp/x', out],
      { encoding: 'utf8' },
    )
    assert.notEqual(badDigest.status, 0)
    assert.match(badDigest.stderr, /not a SHA-256 digest/)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('build-package.sh rejects missing arguments and tarballs', () => {
  const noArgs = spawnSync('bash', [join(repoRoot, 'packaging/arch/build-package.sh')], {
    encoding: 'utf8',
  })
  assert.equal(noArgs.status, 2)
  assert.match(noArgs.stderr, /usage: build-package\.sh/)

  const out = mkdtempSync(join(tmpdir(), 'wh3mm-arch-'))
  try {
    const missing = spawnSync(
      'bash',
      [join(repoRoot, 'packaging/arch/build-package.sh'), '1.2.3', '/no/such.tar.gz', out],
      { encoding: 'utf8' },
    )
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /tarball '\/no\/such\.tar\.gz' not found/)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
