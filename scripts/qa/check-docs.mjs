#!/usr/bin/env node
// Validate local documentation links without network access or dependencies.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const documents = [
  'README.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'AGENTS.md', 'CHANGELOG.md',
  ...readdirSync(resolve(root, 'docs')).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`),
]
const failures = []
for (const document of documents) {
  const text = readFileSync(resolve(root, document), 'utf8')
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1].replace(/^<|>$/g, '')
    if (/^(?:https?:|mailto:|#)/.test(link)) continue
    const path = decodeURIComponent(link.split('#')[0])
    if (!existsSync(resolve(root, dirname(document), path))) failures.push(`${document}: ${link}`)
  }
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Documentation links resolve (${documents.length} guides).`)
}
