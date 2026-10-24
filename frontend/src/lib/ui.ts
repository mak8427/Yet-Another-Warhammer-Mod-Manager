import type { Density } from './ipc'

export const DENSITIES: Density[] = ['compact', 'comfortable', 'roomy']

export const ROW_HEIGHT: Record<Density, number> = {
  compact: 32,
  comfortable: 40,
  roomy: 48,
}

export const DENSITY_LABEL: Record<Density, string> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
  roomy: 'Roomy',
}

const FACTION_SLOTS = [
  ['brass', '#d7b45f'],
  ['crimson', '#e37b84'],
  ['moss', '#9bb86a'],
  ['copper', '#d09055'],
  ['azure', '#7fb0d0'],
  ['violet', '#b08cc8'],
  ['ember', '#e07a63'],
  ['jade', '#6fbf9e'],
] as const

export type FactionSlot = (typeof FACTION_SLOTS)[number][0]

function channels(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** Maps a stored tag colour to the nearest of the eight faction accent slots. */
export function factionSlotForColor(color: string): FactionSlot {
  const input = channels(color)
  if (!input) return 'brass'
  let best: FactionSlot = 'brass'
  let distance = Number.POSITIVE_INFINITY
  for (const [slot, value] of FACTION_SLOTS) {
    const candidate = channels(value)
    if (!candidate) continue
    const next =
      (input[0] - candidate[0]) ** 2 +
      (input[1] - candidate[1]) ** 2 +
      (input[2] - candidate[2]) ** 2
    if (next < distance) {
      distance = next
      best = slot
    }
  }
  return best
}

export function middleEllipsis(value: string, max = 56): string {
  if (value.length <= max) return value
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function visibleRowCount(viewportHeight: number, rowHeight: number): number {
  return Math.floor(Math.max(0, viewportHeight) / Math.max(1, rowHeight))
}

export function modPositionLabel(mod: { isEnabled: boolean; loadOrder: number }): string {
  return mod.isEnabled ? `Position ${mod.loadOrder + 1}` : 'Not in load order'
}
