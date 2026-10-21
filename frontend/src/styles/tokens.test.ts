import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readStyle = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')

const tokensCss = readStyle('./tokens.css')
const themeCss = readStyle('./theme.css')

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function stylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return stylesheets(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

const allStyles = stylesheets(sourceDir).map((file) => ({
  file,
  css: readFileSync(file, 'utf8'),
}))
const componentStyles = allStyles.filter(({ file }) => !file.endsWith('tokens.css'))

function withoutLegacyShell(css: string): string {
  return css.replace(/\/\* legacy-m2:start[\s\S]*?\/\* legacy-m2:end \*\//g, '')
}

function declarations(css: string): Map<string, string> {
  const values = new Map<string, string>()
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
  let match = pattern.exec(css)
  while (match) {
    if (!values.has(match[1])) values.set(match[1], match[2].trim())
    match = pattern.exec(css)
  }
  return values
}

const tokens = declarations(tokensCss)

function resolveToken(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Circular token reference: ${name}`)
  seen.add(name)

  const value = tokens.get(name)
  if (!value) throw new Error(`Missing token: ${name}`)

  const alias = /^var\((--[a-z0-9-]+)\)$/i.exec(value)
  return alias ? resolveToken(alias[1], seen) : value
}

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) throw new Error(`Not a 6-digit hex colour: ${hex}`)
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

const REQUIRED_TOKENS = [
  '--color-bg-app',
  '--color-bg-rail',
  '--color-bg-content',
  '--color-bg-surface',
  '--color-bg-surface-raised',
  '--color-bg-row',
  '--color-bg-row-alt',
  '--color-bg-row-hover',
  '--color-bg-row-selected',
  '--color-bg-list-header',
  '--color-bg-toolbar',
  '--color-bg-inspector',
  '--color-bg-input',
  '--color-bg-menu',
  '--color-bg-dialog',
  '--color-bg-tooltip',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-text-disabled',
  '--color-text-inverse',
  '--color-text-accent',
  '--color-text-success',
  '--color-text-warning',
  '--color-text-danger',
  '--color-text-info',
  '--color-state-success',
  '--color-state-warning',
  '--color-state-danger',
  '--color-state-info',
  '--color-border-subtle',
  '--color-border-default',
  '--color-border-strong',
  '--color-border-control',
  '--color-border-focus',
  '--color-border-selected',
  '--color-action-primary-bg',
  '--color-action-primary-text',
  '--color-action-danger-bg',
  '--color-action-danger-text',
  '--color-tag-bg',
  '--color-tag-border',
  '--color-tag-text',
  '--font-display',
  '--font-body',
  '--font-mono',
  '--text-2xs',
  '--text-xs',
  '--text-sm',
  '--text-md',
  '--text-lg',
  '--text-xl',
  '--text-2xl',
  '--space-4',
  '--space-7',
  '--titlebar-h',
  '--statusbar-h',
  '--toolbar-h',
  '--list-header-h',
  '--rail-w',
  '--inspector-w',
  '--inspector-w-narrow',
  '--row-h-compact',
  '--row-h-comfortable',
  '--row-h-roomy',
  '--row-h',
  '--row-thumb',
  '--row-title-size',
  '--row-meta-size',
  '--control-h-sm',
  '--control-h-md',
  '--control-h-lg',
  '--radius-control',
  '--radius-panel',
  '--radius-dialog',
  '--shadow-menu',
  '--shadow-dialog',
  '--motion-fast',
  '--motion-base',
  '--motion-reorder',
  '--z-menu',
  '--z-dialog',
  '--z-tooltip',
  '--faction-accent',
  '--faction-accent-brass',
  '--faction-accent-crimson',
  '--faction-accent-moss',
  '--faction-accent-copper',
  '--faction-accent-azure',
  '--faction-accent-violet',
  '--faction-accent-ember',
  '--faction-accent-jade',
]

describe('design tokens', () => {
  it('declares the semantic contract', () => {
    for (const token of REQUIRED_TOKENS) {
      expect(tokens.has(token), `missing ${token}`).toBe(true)
    }
  })

  it('resolves every var() reference in every stylesheet', () => {
    for (const { file, css } of allStyles) {
      const pattern = /var\(\s*(--[a-z0-9-]+)/gi
      let match = pattern.exec(css)
      while (match) {
        expect(tokens.has(match[1]), `${file} references missing ${match[1]}`).toBe(true)
        match = pattern.exec(css)
      }
    }
  })

  it('keeps tokens as the only custom-property source', () => {
    expect(themeCss).toMatch(/^@import '\.\/tokens\.css';/m)
    for (const { file, css } of componentStyles) {
      expect(css, `${file} defines a custom property`).not.toMatch(/^\s*--[a-z0-9-]+\s*:/gim)
    }
  })

  it('keeps body and metadata text at 4.5:1 or better', () => {
    const pairs: Array<[string, string]> = [
      ['--color-text-primary', '--color-bg-app'],
      ['--color-text-primary', '--color-bg-surface'],
      ['--color-text-primary', '--color-bg-row-selected'],
      ['--color-text-secondary', '--color-bg-app'],
      ['--color-text-secondary', '--color-bg-surface'],
      ['--color-text-muted', '--color-bg-app'],
      ['--color-text-muted', '--color-bg-surface'],
      ['--color-text-muted', '--color-bg-row-selected'],
      ['--color-text-disabled', '--color-bg-surface'],
      ['--color-text-accent', '--color-bg-app'],
      ['--color-text-success', '--color-state-success-bg'],
      ['--color-text-warning', '--color-state-warning-bg'],
      ['--color-text-danger', '--color-state-danger-bg'],
      ['--color-text-info', '--color-state-info-bg'],
      ['--color-text-danger', '--color-bg-surface'],
      ['--color-text-inverse', '--color-bg-tooltip'],
      ['--color-action-primary-text', '--color-action-primary-bg'],
      ['--color-action-danger-text', '--color-action-danger-bg'],
      ['--color-tag-text', '--color-tag-bg'],
    ]

    for (const [foreground, background] of pairs) {
      const ratio = contrast(resolveToken(foreground), resolveToken(background))
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps focus and control boundaries at 3:1 or better', () => {
    const pairs: Array<[string, string]> = [
      ['--color-border-focus', '--color-bg-app'],
      ['--color-border-focus', '--color-bg-surface'],
      ['--color-border-focus', '--color-bg-row-selected'],
      ['--color-border-control', '--color-bg-input'],
      ['--color-border-control', '--color-bg-surface'],
    ]

    for (const [foreground, background] of pairs) {
      const ratio = contrast(resolveToken(foreground), resolveToken(background))
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps every faction accent readable on rows and app surfaces', () => {
    const accents = [
      '--faction-accent-brass',
      '--faction-accent-crimson',
      '--faction-accent-moss',
      '--faction-accent-copper',
      '--faction-accent-azure',
      '--faction-accent-violet',
      '--faction-accent-ember',
      '--faction-accent-jade',
    ]

    for (const accent of accents) {
      for (const surface of ['--color-bg-app', '--color-bg-row-selected']) {
        const ratio = contrast(resolveToken(accent), resolveToken(surface))
        expect(ratio, `${accent} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps row heights ordered and comfortable as the default density', () => {
    expect(resolveToken('--row-h-compact')).toBe('32px')
    expect(resolveToken('--row-h-comfortable')).toBe('40px')
    expect(resolveToken('--row-h-roomy')).toBe('48px')
    expect(tokens.get('--row-h')).toBe('var(--row-h-comfortable)')
  })

  it('forbids decorative gradients, glows, and external assets in every stylesheet', () => {
    for (const { file, css } of allStyles) {
      const checked = withoutLegacyShell(css)
      expect(checked, `${file} uses a gradient`).not.toMatch(/(linear|radial|conic)-gradient\(/i)
      expect(checked, `${file} uses a decorative shadow`).not.toMatch(/(drop|text)-shadow\(/i)
      expect(checked, `${file} loads a remote asset`).not.toMatch(/url\(\s*['"]?https?:/i)
      expect(checked, `${file} loads a web font`).not.toMatch(/@font-face/i)
    }
  })
})
