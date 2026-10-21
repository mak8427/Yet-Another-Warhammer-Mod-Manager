/**
 * Deterministic mod rows for the render guard.
 *
 * The names and counts mirror `scripts/perf/generate-fixture.mjs` so the frontend guard and the
 * Rust workloads describe the same catalogue. No React import: this module is pure and cheap to
 * reuse from the real store.
 */
import type { ModSummary } from '../lib/ipc'

const UNICODE_STEMS = [
  'mod_ñandú',
  'mod_日本語_騎兵',
  'mod_über_artillerie',
  'mod_Ελληνικά',
  'mod_🚀_rocket',
  'mod_кирасиры',
  'mod_中文_单位',
  'mod_østfold',
]

/** xorshift32, the same family of PRNG as the fixture generator, so runs are reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}

export function makeModRows(count: number, seed = 20261020): ModSummary[] {
  const random = makeRandom(seed)
  const rows: ModSummary[] = []
  for (let index = 0; index < count; index++) {
    const unicode = index % 5 === 0
    const stem = unicode
      ? `${UNICODE_STEMS[index % UNICODE_STEMS.length]}_${String(index).padStart(4, '0')}`
      : `perf_mod_${String(index).padStart(4, '0')}`
    const enabled = random() > 0.25
    rows.push({
      id: `mod-${index}`,
      name: `${stem}.pack`,
      humanName: stem,
      author: `author_${index % 37}`,
      isWorkshop: index % 3 === 0,
      workshopId: index % 3 === 0 ? String(1_000_000 + index) : null,
      isEnabled: enabled,
      loadOrder: enabled ? index : -1,
      tags: [],
      updatedAt: null,
      thumbnailPath: null,
      dependencies: [],
      packError: null,
      isMovie: false,
      sizeBytes: 256 + Math.floor(random() * 8192),
    })
  }
  return rows
}

/** Returns a new array; the caller's rows stay untouched so a reorder can be measured in isolation. */
export function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  if (from === to) return rows.slice()
  const next = rows.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
