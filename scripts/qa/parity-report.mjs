#!/usr/bin/env node
/**
 * Capability-parity scorecard for WH3 Mod Manager.
 *
 * Reads docs/PARITY.yaml, validates the 40 checks and the legacy oracle map,
 * scans the UI/IPC surface for cut features, prints the capability table and
 * weighted index, and checks that docs/PARITY.md is in sync with the YAML.
 * The check ignores the two live test-count rows so an unrelated test addition
 * does not make the snapshot stale.
 *
 * Usage:
 *   node scripts/qa/parity-report.mjs            # print + verify docs/PARITY.md
 *   node scripts/qa/parity-report.mjs --write    # regenerate docs/PARITY.md
 *   node scripts/qa/parity-report.mjs --check    # explicit check mode
 *   node scripts/qa/parity-report.mjs --json     # machine-readable result
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const configPath = join(repoRoot, 'docs', 'PARITY.yaml')
export const reportPath = join(repoRoot, 'docs', 'PARITY.md')

const CONFIG_SCHEMA = 'wh3mm.parity.v1'
const CAPABILITY_COUNT = 10
const CHECKS_PER_CAPABILITY = 4
const CHECK_COUNT = CAPABILITY_COUNT * CHECKS_PER_CAPABILITY
const ORACLE_TOTAL = 29
const STATUSES = new Set(['done', 'partial', 'missing'])
const DISPOSITIONS = new Set(['ported', 'rewritten', 'not-applicable'])
const WEIGHTS = {
  detection: 12,
  discovery: 10,
  'mod-list': 15,
  'load-order': 15,
  profiles: 10,
  conflicts: 12,
  workshop: 8,
  launch: 8,
  settings: 5,
  safety: 5,
}

function fail(message) {
  const error = new Error(message)
  error.isParityError = true
  return error
}

function walkFiles(directory, predicate) {
  if (!existsSync(directory)) return []
  const root = statSync(directory)
  if (root.isFile()) return predicate(directory) ? [directory] : []
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walkFiles(path, predicate))
    else if (predicate(path)) found.push(path)
  }
  return found
}

function normalizePath(path) {
  return path.split(sep).join('/')
}

function relativePath(root, path) {
  return normalizePath(relative(root, path))
}

function readText(path) {
  return readFileSync(path, 'utf8')
}

export function loadConfig(root = repoRoot) {
  const path = join(root, 'docs', 'PARITY.yaml')
  if (!existsSync(path)) throw fail(`Missing ${relativePath(root, path)}`)
  return parseYaml(readText(path))
}

function resolveEvidence(evidence, root, issues, context) {
  if (!evidence || typeof evidence !== 'object') {
    issues.push(`${context}: evidence entry is not an object`)
    return
  }

  const kind = evidence.kind ?? (evidence.pr ? 'pr' : evidence.url ? 'url' : 'path')
  if (kind === 'path') {
    if (typeof evidence.path !== 'string' || evidence.path.trim() === '') {
      issues.push(`${context}: path evidence needs a path`)
      return
    }
    const target = join(root, evidence.path)
    if (!existsSync(target)) {
      issues.push(`${context}: evidence path does not exist: ${evidence.path}`)
      return
    }
    if (evidence.test) {
      const text = readText(target)
      if (!text.includes(evidence.test)) {
        issues.push(`${context}: test "${evidence.test}" not found in ${evidence.path}`)
      }
    }
    if (evidence.contains) {
      const text = readText(target)
      if (!text.includes(evidence.contains)) {
        issues.push(`${context}: text "${evidence.contains}" not found in ${evidence.path}`)
      }
    }
    return
  }

  if (kind === 'pr') {
    if (!Number.isInteger(evidence.pr) || evidence.pr <= 0) {
      issues.push(`${context}: PR evidence needs a positive integer pr`)
      return
    }
    const expectedUrl = `https://github.com/mak8427/Warhammer_mod_manager/pull/${evidence.pr}`
    if (evidence.url !== expectedUrl) {
      issues.push(`${context}: PR ${evidence.pr} url must be ${expectedUrl}`)
    }
    if (typeof evidence.head !== 'string' || !/^[0-9a-f]{7,40}$/i.test(evidence.head)) {
      issues.push(`${context}: PR ${evidence.pr} needs a 7-40 character head SHA`)
    }
    if (!['approved', 'pending', 'merged'].includes(evidence.qa)) {
      issues.push(`${context}: PR ${evidence.pr} qa must be approved, pending, or merged`)
    }
    if (evidence.path) {
      const target = join(root, evidence.path)
      if (existsSync(target)) {
        if (evidence.test && !readText(target).includes(evidence.test)) {
          issues.push(`${context}: test "${evidence.test}" not found in ${evidence.path}`)
        }
        if (evidence.contains && !readText(target).includes(evidence.contains)) {
          issues.push(`${context}: text "${evidence.contains}" not found in ${evidence.path}`)
        }
      } else if (!evidence.ref && !evidence.head && evidence.qa !== 'merged') {
        // The path lives on an open PR. The head SHA is the audit pointer.
        issues.push(`${context}: PR ${evidence.pr} path is not in this tree and has no head/ref`)
      }
    }
    return
  }

  if (kind === 'url') {
    if (typeof evidence.url !== 'string' || !/^https?:\/\//.test(evidence.url)) {
      issues.push(`${context}: url evidence needs an http(s) URL`)
    }
    return
  }

  issues.push(`${context}: unknown evidence kind ${kind}`)
}

function evidenceIsStrong(evidence, root) {
  if (!evidence || typeof evidence !== 'object') return false
  const kind = evidence.kind ?? (evidence.pr ? 'pr' : 'path')
  if (kind === 'pr') return evidence.qa === 'approved' || evidence.qa === 'merged'
  if (kind === 'path' && evidence.path) {
    const target = join(root, evidence.path)
    return Boolean(
      existsSync(target) && evidence.test && readText(target).includes(evidence.test),
    )
  }
  return false
}

function validateEvidenceList(evidence, root, issues, context, { requireStrong = false } = {}) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    issues.push(`${context}: missing evidence`)
    return
  }
  for (const entry of evidence) resolveEvidence(entry, root, issues, context)
  if (requireStrong && !evidence.some((entry) => evidenceIsStrong(entry, root))) {
    issues.push(`${context}: done needs a passing test or a QA-approved/merged PR`)
  }
}

export function validateConfig(config, { root = repoRoot, scanFindings = [] } = {}) {
  const issues = []
  if (!config || typeof config !== 'object') throw fail('PARITY.yaml is empty or not an object')
  if (config.schema !== CONFIG_SCHEMA) {
    issues.push(`schema must be ${CONFIG_SCHEMA}`)
  }
  if (!config.snapshot || typeof config.snapshot !== 'object') {
    issues.push('snapshot is required')
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(config.snapshot.date ?? ''))) {
      issues.push('snapshot.date must be YYYY-MM-DD')
    }
    if (typeof config.snapshot.previous_index !== 'number') {
      issues.push('snapshot.previous_index must be a number')
    }
    const dropReason = String(config.snapshot.drop_reason ?? '').trim()
    const history = Array.isArray(config.snapshot.history) ? config.snapshot.history : []
    const { index } = evaluate(config)
    const recordedDrop = history.some(
      (entry) =>
        entry &&
        typeof entry.index === 'number' &&
        Math.abs(entry.index - index) < 0.0005 &&
        String(entry.reason ?? '').trim() !== '',
    )
    if (
      typeof config.snapshot.previous_index === 'number' &&
      index < config.snapshot.previous_index - 0.0005 &&
      !recordedDrop
    ) {
      issues.push(
        `index dropped from ${config.snapshot.previous_index} to ${index.toFixed(3)} without a matching snapshot.history reason` +
          (dropReason ? ' (drop_reason alone is not enough)' : ''),
      )
    }
  }

  const capabilities = Array.isArray(config.capabilities) ? config.capabilities : []
  if (capabilities.length !== CAPABILITY_COUNT) {
    issues.push(`expected ${CAPABILITY_COUNT} capabilities, found ${capabilities.length}`)
  }

  const seenCapabilities = new Set()
  const seenChecks = new Set()
  let totalChecks = 0
  let weightSum = 0

  for (const capability of capabilities) {
    if (!capability || typeof capability !== 'object') {
      issues.push('capability entry is not an object')
      continue
    }
    const id = capability.id
    if (typeof id !== 'string' || id === '') {
      issues.push('capability.id is required')
      continue
    }
    if (seenCapabilities.has(id)) issues.push(`duplicate capability id ${id}`)
    seenCapabilities.add(id)
    if (WEIGHTS[id] === undefined) {
      issues.push(`unknown capability ${id}; expected one of ${Object.keys(WEIGHTS).join(', ')}`)
    } else if (capability.weight !== WEIGHTS[id]) {
      issues.push(`${id}: weight must be ${WEIGHTS[id]}, found ${capability.weight}`)
    }
    if (typeof capability.weight === 'number') weightSum += capability.weight
    if (typeof capability.title !== 'string' || capability.title.trim() === '') {
      issues.push(`${id}: title is required`)
    }

    const checks = Array.isArray(capability.checks) ? capability.checks : []
    if (checks.length !== CHECKS_PER_CAPABILITY) {
      issues.push(`${id}: expected ${CHECKS_PER_CAPABILITY} checks, found ${checks.length}`)
    }
    for (const check of checks) {
      totalChecks += 1
      if (!check || typeof check !== 'object') {
        issues.push(`${id}: check is not an object`)
        continue
      }
      const checkId = check.id
      if (typeof checkId !== 'string' || checkId === '') {
        issues.push(`${id}: check.id is required`)
        continue
      }
      if (seenChecks.has(checkId)) issues.push(`duplicate check id ${checkId}`)
      seenChecks.add(checkId)
      if (typeof check.title !== 'string' || check.title.trim() === '') {
        issues.push(`${checkId}: title is required`)
      }
      if (!STATUSES.has(check.status)) {
        issues.push(`${checkId}: status must be done, partial, or missing`)
        continue
      }
      const context = `${id}/${checkId}`
      if (check.status === 'done') {
        validateEvidenceList(check.evidence, root, issues, context, { requireStrong: true })
      } else if (check.status === 'partial') {
        if (typeof check.need !== 'string' || check.need.trim() === '') {
          issues.push(`${context}: partial needs a non-empty need`)
        }
        if (check.evidence) validateEvidenceList(check.evidence, root, issues, context)
      } else if (check.evidence) {
        validateEvidenceList(check.evidence, root, issues, context)
      }
    }
  }

  if (weightSum !== 100) issues.push(`weights must sum to 100, found ${weightSum}`)
  if (totalChecks !== CHECK_COUNT) {
    issues.push(`expected ${CHECK_COUNT} checks, found ${totalChecks}`)
  }
  for (const id of Object.keys(WEIGHTS)) {
    if (!seenCapabilities.has(id)) issues.push(`missing capability ${id}`)
  }

  const oracle = config.oracle
  if (!oracle || typeof oracle !== 'object') {
    issues.push('oracle map is required')
  } else {
    if (oracle.total !== ORACLE_TOTAL) {
      issues.push(`oracle.total must be ${ORACLE_TOTAL}`)
    }
    if (!Number.isInteger(oracle.legacy_assertions) || oracle.legacy_assertions <= 0) {
      issues.push('oracle.legacy_assertions must be a positive integer')
    }
    if (typeof oracle.pinned_ref !== 'string' || !/^[0-9a-f]{40}$/i.test(oracle.pinned_ref)) {
      issues.push('oracle.pinned_ref must be the 40-character legacy commit')
    }
    const files = Array.isArray(oracle.files) ? oracle.files : []
    if (files.length !== ORACLE_TOTAL) {
      issues.push(`oracle map must contain ${ORACLE_TOTAL} files, found ${files.length}`)
    }
    const seenFiles = new Set()
    let assertionSum = 0
    for (const entry of files) {
      if (!entry || typeof entry !== 'object') {
        issues.push('oracle entry is not an object')
        continue
      }
      const path = entry.path
      if (typeof path !== 'string' || !path.startsWith('test/')) {
        issues.push(`oracle entry path must start with test/: ${path}`)
        continue
      }
      if (seenFiles.has(path)) issues.push(`duplicate oracle file ${path}`)
      seenFiles.add(path)
      if (!Number.isInteger(entry.assertions) || entry.assertions <= 0) {
        issues.push(`${path}: assertions must be a positive integer`)
      } else {
        assertionSum += entry.assertions
      }
      if (!seenCapabilities.has(entry.capability)) {
        issues.push(`${path}: unknown capability ${entry.capability}`)
      }
      if (!DISPOSITIONS.has(entry.disposition)) {
        issues.push(`${path}: disposition must be ported, rewritten, or not-applicable`)
        continue
      }
      if (entry.disposition === 'ported') {
        const targets = Array.isArray(entry.ported_to) ? entry.ported_to : []
        if (targets.length === 0) {
          issues.push(`${path}: ported entries need at least one ported_to target`)
        }
        for (const target of targets) {
          if (!target || typeof target.path !== 'string' || typeof target.test !== 'string') {
            issues.push(`${path}: ported_to needs path and test`)
            continue
          }
          const local = join(root, target.path)
          if (existsSync(local)) {
            if (!readText(local).includes(target.test)) {
              issues.push(`${path}: ported test "${target.test}" not found in ${target.path}`)
            }
          } else if (!target.ref && !target.pr) {
            issues.push(`${path}: ported path ${target.path} is not in this tree and has no ref/pr`)
          }
        }
      } else if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
        issues.push(`${path}: ${entry.disposition} needs a reason`)
      }
    }
    if (seenFiles.size !== ORACLE_TOTAL) {
      issues.push(`oracle map has ${seenFiles.size} unique files, expected ${ORACLE_TOTAL}`)
    }
    if (assertionSum !== oracle.legacy_assertions) {
      issues.push(
        `oracle.legacy_assertions is ${oracle.legacy_assertions}, but the entries sum to ${assertionSum}`,
      )
    }
  }

  const scan = config.cut_scan
  if (!scan || typeof scan !== 'object') {
    issues.push('cut_scan is required')
  } else {
    if (!Array.isArray(scan.roots) || scan.roots.length === 0) issues.push('cut_scan.roots is required')
    if (!Array.isArray(scan.features) || scan.features.length === 0) {
      issues.push('cut_scan.features is required')
    }
  }

  for (const finding of scanFindings) {
    issues.push(`cut feature "${finding.label}" found at ${finding.file}:${finding.line}`)
  }

  return issues
}

export function evaluate(config) {
  const capabilities = []
  let done = 0
  let partial = 0
  let missing = 0
  let weighted = 0

  for (const capability of config.capabilities ?? []) {
    const checks = capability.checks ?? []
    const counts = { done: 0, partial: 0, missing: 0 }
    for (const check of checks) counts[check.status] += 1
    const score = counts.done + counts.partial * 0.5
    const weightedPoints = ((capability.weight ?? 0) * score) / CHECKS_PER_CAPABILITY
    done += counts.done
    partial += counts.partial
    missing += counts.missing
    weighted += weightedPoints
    capabilities.push({
      id: capability.id,
      title: capability.title,
      weight: capability.weight,
      checks: checks.length,
      ...counts,
      score,
      weighted: weightedPoints,
    })
  }

  const oracleFiles = config.oracle?.files ?? []
  const oracleTotal = config.oracle?.total ?? ORACLE_TOTAL
  const oracle = {
    total: oracleTotal,
    mapped: oracleFiles.filter((entry) => DISPOSITIONS.has(entry.disposition)).length,
    ported: oracleFiles.filter((entry) => entry.disposition === 'ported').length,
    rewritten: oracleFiles.filter((entry) => entry.disposition === 'rewritten').length,
    notApplicable: oracleFiles.filter((entry) => entry.disposition === 'not-applicable').length,
  }
  oracle.coverage = oracleTotal > 0 ? oracle.mapped / oracleTotal : 0

  return {
    index: weighted,
    done,
    partial,
    missing,
    checks: done + partial + missing,
    capabilities,
    oracle,
    metrics: countTests(repoRoot),
  }
}

function countInFiles(files, pattern) {
  let count = 0
  for (const file of files) {
    const matches = readText(file).match(pattern)
    if (matches) count += matches.length
  }
  return count
}

export function countTests(root = repoRoot) {
  const rustFiles = walkFiles(join(root, 'crates'), (path) => path.endsWith('.rs'))
  const frontendFiles = walkFiles(
    join(root, 'frontend', 'src'),
    (path) => path.endsWith('.test.ts') || path.endsWith('.test.tsx'),
  )
  const frontendFilesWithTests = frontendFiles.filter((path) =>
    /^\s*(it|test)\(/m.test(readText(path)),
  )
  return {
    rust: countInFiles(rustFiles, /^\s*#\[test\]/gm),
    frontend: countInFiles(frontendFiles, /^\s*(it|test)\(/gm),
    frontendFiles: frontendFilesWithTests.length,
  }
}

export function scanCutFeatures(config, { root = repoRoot } = {}) {
  const scan = config.cut_scan ?? {}
  const exclude = scan.exclude_suffixes ?? ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx']
  const findings = []
  const scanned = []
  for (const scanRoot of scan.roots ?? []) {
    const absolute = join(root, scanRoot)
    const files = walkFiles(absolute, (path) => {
      if (!['.ts', '.tsx', '.rs'].includes(extname(path))) return false
      return !exclude.some((suffix) => path.endsWith(suffix))
    })
    for (const file of files) {
      scanned.push(relativePath(root, file))
      const lines = readText(file).split(/\r?\n/)
      for (const feature of scan.features ?? []) {
        for (const pattern of feature.patterns ?? []) {
          let regex
          try {
            regex = new RegExp(pattern, 'i')
          } catch (error) {
            findings.push({
              feature: feature.id,
              label: feature.label,
              file: relativePath(root, file),
              line: 0,
              pattern,
              invalid: error.message,
            })
            continue
          }
          lines.forEach((line, index) => {
            regex.lastIndex = 0
            if (regex.test(line)) {
              findings.push({
                feature: feature.id,
                label: feature.label,
                file: relativePath(root, file),
                line: index + 1,
                pattern,
              })
            }
          })
        }
      }
    }
  }
  return { findings, scanned }
}

function ordinal(value) {
  return `${value.toFixed(3)}`
}

function signed(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`
}

export function renderMarkdown(config, result, { scan = { findings: [], scanned: [] } } = {}) {
  const snapshot = config.snapshot ?? {}
  const previous = Number(snapshot.previous_index ?? 0)
  const delta = result.index - previous
  const lines = []
  lines.push('# Capability parity')
  lines.push('')
  lines.push(`Snapshot: **${snapshot.date}** · weighted scope: \`docs/PRODUCT_SCOPE.md\``)
  lines.push('')
  lines.push(
    `> Generated by \`scripts/qa/parity-report.mjs\` from [docs/PARITY.yaml](PARITY.yaml). Do not edit by hand; run \`node scripts/qa/parity-report.mjs --write\`.`,
  )
  lines.push('')
  lines.push('## Headline')
  lines.push('')
  lines.push(`| Metric | Value |`)
  lines.push('|---|---:|')
  lines.push(`| **Capability Parity Index** | **${ordinal(result.index)}%** |`)
  lines.push(`| Previous snapshot | ${ordinal(previous)}% |`)
  lines.push(`| Change | ${signed(delta)} points |`)
  lines.push(`| Checks | ${result.done} done / ${result.partial} partial / ${result.missing} missing (${result.checks} total) |`)
  lines.push(
    `| Legacy oracle coverage | ${result.oracle.mapped}/${result.oracle.total} (${(result.oracle.coverage * 100).toFixed(1)}%) |`,
  )
  lines.push(
    `| Oracle dispositions | ${result.oracle.ported} ported / ${result.oracle.rewritten} rewritten / ${result.oracle.notApplicable} not-applicable |`,
  )
  lines.push(`| Cut-feature scan | ${scan.findings.length} findings in ${scan.scanned.length} UI/IPC files |`)
  lines.push(`| Rust tests on this tree | ${result.metrics.rust} |`)
  lines.push(`| Frontend assertions on this tree | ${result.metrics.frontend} in ${result.metrics.frontendFiles} files |`)
  lines.push('')
  lines.push('## Capability table')
  lines.push('')
  lines.push('| # | Capability | Weight | Done | Partial | Missing | Score | Weighted |')
  lines.push('|---:|---|---:|---:|---:|---:|---:|---:|')
  result.capabilities.forEach((capability, index) => {
    lines.push(
      `| ${index + 1} | ${capability.title} | ${capability.weight} | ${capability.done} | ${capability.partial} | ${capability.missing} | ${capability.score.toFixed(2)}/4 | ${capability.weighted.toFixed(2)} |`,
    )
  })
  lines.push(
    `| | **Total** | **${result.capabilities.reduce((sum, capability) => sum + capability.weight, 0)}** | **${result.done}** | **${result.partial}** | **${result.missing}** | | **${ordinal(result.index)}** |`,
  )
  lines.push('')
  lines.push('## Corrections to the WAR-3 snapshot')
  lines.push('')
  const recordedDrop = (snapshot.history ?? []).find(
    (entry) => entry && typeof entry.index === 'number' && Math.abs(entry.index - result.index) < 0.0005,
  )
  const dropReason = recordedDrop?.reason ?? snapshot.drop_reason
  if (dropReason) {
    lines.push(`**Recorded index change:** ${String(dropReason).replace(/\s+/g, ' ').trim()}`)
    lines.push('')
  }
  if (Array.isArray(config.corrections) && config.corrections.length > 0) {
    lines.push('| Correction | Claim | Verified | Effect |')
    lines.push('|---|---|---|---|')
    for (const correction of config.corrections) {
      lines.push(
        `| ${correction.id} | ${correction.claim} | ${correction.verified} | ${correction.effect} |`,
      )
    }
    lines.push('')
  } else {
    lines.push('No corrections recorded.')
    lines.push('')
  }
  lines.push('## Evidence policy')
  lines.push('')
  lines.push(String(snapshot.evidence_policy ?? '').replace(/\s+/g, ' ').trim())
  lines.push('')
  lines.push('## How to run')
  lines.push('')
  lines.push('```bash')
  lines.push('node scripts/qa/parity-report.mjs          # print the report and verify this file')
  lines.push('node scripts/qa/parity-report.mjs --write  # regenerate this file from PARITY.yaml')
  lines.push('node scripts/qa/parity-report.mjs --check  # fail if this file is stale')
  lines.push('```')
  lines.push('')
  lines.push(
    '`--check` ignores the two live test-count rows; a PR that only adds tests does not need to regenerate this snapshot.',
  )
  lines.push('')
  lines.push(
    `Scope is the v1.0 contract, not legacy feature parity. Cut features score zero. Source: [docs/PRODUCT_SCOPE.md](PRODUCT_SCOPE.md).`,
  )
  return `${lines.join('\n')}\n`
}

function renderConsole(config, result, scan) {
  const capabilityWidth = Math.max(
    'Capability'.length,
    ...result.capabilities.map((capability) => capability.title.length),
  )
  const lines = []
  lines.push('WH3 Mod Manager — capability parity')
  lines.push(`Snapshot: ${config.snapshot?.date ?? 'unknown'}`)
  lines.push('')
  lines.push(
    `${'Capability'.padEnd(capabilityWidth)}  Weight  Done  Partial  Missing  Score  Weighted`,
  )
  lines.push(`${'-'.repeat(capabilityWidth)}  ------  ----  -------  -------  -----  --------`)
  for (const capability of result.capabilities) {
    lines.push(
      `${capability.title.padEnd(capabilityWidth)}  ${String(capability.weight).padStart(6)}  ${String(capability.done).padStart(4)}  ${String(capability.partial).padStart(7)}  ${String(capability.missing).padStart(7)}  ${capability.score.toFixed(2).padStart(5)}  ${capability.weighted.toFixed(2).padStart(8)}`,
    )
  }
  lines.push('')
  lines.push('Checks:')
  for (const capability of result.capabilities) {
    for (const check of config.capabilities.find((item) => item.id === capability.id).checks) {
      lines.push(`  ${check.id.padEnd(6)} ${check.status.padEnd(8)} ${check.title}`)
    }
  }
  lines.push('')
  lines.push(`Capability Parity Index: ${ordinal(result.index)}%`)
  lines.push(
    `Checks: ${result.done} done / ${result.partial} partial / ${result.missing} missing (${result.checks} total)`,
  )
  lines.push(
    `Oracle coverage: ${result.oracle.mapped}/${result.oracle.total} (${(result.oracle.coverage * 100).toFixed(1)}%) · ` +
      `${result.oracle.ported} ported / ${result.oracle.rewritten} rewritten / ${result.oracle.notApplicable} not-applicable`,
  )
  lines.push(`Cut-feature scan: ${scan.findings.length} findings in ${scan.scanned.length} UI/IPC files`)
  lines.push(`Rust tests: ${result.metrics.rust} · Frontend assertions: ${result.metrics.frontend} in ${result.metrics.frontendFiles} files`)
  return `${lines.join('\n')}\n`
}

export function comparableReport(markdown) {
  return markdown
    .replace(
      /^\| Rust tests on this tree \| \d+ \|$/m,
      '| Rust tests on this tree | <live count> |',
    )
    .replace(
      /^\| Frontend assertions on this tree \| \d+ in \d+ files \|$/m,
      '| Frontend assertions on this tree | <live count> in <live files> files |',
    )
}

function readReport() {
  if (!existsSync(reportPath)) return null
  return readText(reportPath)
}

function writeReport(markdown) {
  writeFileSync(reportPath, markdown)
}

export function main(argv = process.argv.slice(2)) {
  const known = new Set(['--write', '--check', '--json', '--help', '-h'])
  const unknown = argv.filter((arg) => !known.has(arg))
  if (unknown.length > 0) {
    console.error(`Unknown arguments: ${unknown.join(' ')}`)
    return 2
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node scripts/qa/parity-report.mjs [--write|--check|--json]')
    return 0
  }

  let config
  try {
    config = loadConfig()
  } catch (error) {
    console.error(error.message)
    return 1
  }

  const scan = scanCutFeatures(config)
  const issues = validateConfig(config, { scanFindings: scan.findings })
  if (issues.length > 0) {
    console.error('Parity check failed:')
    for (const issue of issues) console.error(`- ${issue}`)
    return 1
  }

  const result = evaluate(config)
  const markdown = renderMarkdown(config, result, { scan })

  if (argv.includes('--write')) {
    writeReport(markdown)
    process.stdout.write(renderConsole(config, result, scan))
    console.log(`Wrote ${relativePath(repoRoot, reportPath)}`)
    return 0
  }

  const existing = readReport()
  if (existing === null) {
    console.error('docs/PARITY.md is missing; run node scripts/qa/parity-report.mjs --write')
    return 1
  }
  if (comparableReport(existing) !== comparableReport(markdown)) {
    console.error('docs/PARITY.md is stale; run node scripts/qa/parity-report.mjs --write')
    return 1
  }

  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          index: Number(result.index.toFixed(3)),
          done: result.done,
          partial: result.partial,
          missing: result.missing,
          checks: result.checks,
          oracle: result.oracle,
          metrics: result.metrics,
          cutScan: { findings: scan.findings.length, scanned: scan.scanned.length },
        },
        null,
        2,
      ),
    )
    return 0
  }

  process.stdout.write(renderConsole(config, result, scan))
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
