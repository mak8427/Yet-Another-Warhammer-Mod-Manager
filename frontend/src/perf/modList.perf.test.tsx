import { writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, describe, expect, it } from 'vitest'
import { ModList } from '../components/mod-list/ModList'
import { makeModRows, moveRow } from './modRows'

/**
 * Frontend render guard (WAR-7 deliverable 3).
 *
 * Runs the real M2 `ModList` over the 5k and 20k workloads and measures initial window render,
 * scroll rerender, and reorder commit. Wall-clock numbers are reported, not gated: jsdom is an
 * upper bound for synthetic rows and says nothing about paint. The hard assertions are structural:
 * the mounted DOM row count must stay bounded and the window must actually follow the scroll.
 */
const WORKLOADS = [5_000, 20_000] as const
const ROW_HEIGHT = 40
const VIEWPORT_HEIGHT = 560
// 14 visible rows + 2 * 6 overscan = 26; 48 catches a list that forgot to virtualize.
const MAX_MOUNTED_ROWS = 48
const SAMPLES = 7
const noop = () => {}

interface Timing {
  medianMs: number
  minMs: number
  maxMs: number
  samplesMs: number[]
}

const round = (value: number) => Math.round(value * 100) / 100

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function sample(action: () => void): Timing {
  action()
  const samplesMs: number[] = []
  for (let index = 0; index < SAMPLES; index++) {
    const startedAt = performance.now()
    action()
    samplesMs.push(round(performance.now() - startedAt))
  }
  return {
    medianMs: round(median(samplesMs)),
    minMs: Math.min(...samplesMs),
    maxMs: Math.max(...samplesMs),
    samplesMs,
  }
}

function listProps(mods: ReturnType<typeof makeModRows>, initialScrollTop = 0) {
  return {
    mods,
    tags: [],
    selection: [],
    density: 'comfortable' as const,
    showAuthors: true,
    showThumbnails: true,
    initialScrollTop,
    viewportHeightOverride: VIEWPORT_HEIGHT,
    onToggle: noop,
    onSelect: noop,
    onSelectAll: noop,
    onClearSelection: noop,
    onMove: noop,
    onReorder: noop,
    onScrollTop: noop,
  }
}

function mountedIds(): string[] {
  return screen.queryAllByRole('option').map((row) => row.getAttribute('data-mod-id') ?? '')
}

interface WorkloadResult {
  rows: number
  buildMs: number
  initialRender: Timing
  scroll: Timing
  reorder: Timing
  mountedAtTop: number
  mountedAtBottom: number
}

const results: WorkloadResult[] = []

afterAll(() => {
  const report = {
    schema: 'wh3mm.perf.frontend-guard.v2',
    kind: 'jsdom-upper-bound',
    component: 'frontend/src/components/mod-list/ModList.tsx',
    measuredAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
    },
    contract: {
      rowHeight: ROW_HEIGHT,
      viewportHeight: VIEWPORT_HEIGHT,
      maxMountedRows: MAX_MOUNTED_ROWS,
    },
    timingGate: false,
    note: 'jsdom render cost of the real ModList, not paint or scroll latency; no wall-clock threshold is asserted.',
    workloads: results,
  }
  if (process.env.WH3MM_PERF_OUT) {
    writeFileSync(process.env.WH3MM_PERF_OUT, `${JSON.stringify(report, null, 2)}\n`)
  }
  for (const workload of results) {
    console.log(
      `[perf] ${workload.rows} rows: initial ${workload.initialRender.medianMs} ms, ` +
        `scroll ${workload.scroll.medianMs} ms, reorder ${workload.reorder.medianMs} ms, ` +
        `mounted ${workload.mountedAtTop}/${workload.mountedAtBottom}`,
    )
  }
})

describe('mod list render guard', () => {
  for (const count of WORKLOADS) {
    it(`keeps 5k/20k-scale DOM bounded and reports timings (${count} rows)`, () => {
      let rows = makeModRows(0)
      const build = sample(() => {
        rows = makeModRows(count)
      })
      expect(rows).toHaveLength(count)

      const bottom = Math.max(0, rows.length * ROW_HEIGHT - VIEWPORT_HEIGHT)
      const lastId = rows[rows.length - 1].id

      // Initial render: mount, measure, unmount. A throwaway render warms the JSX path.
      const warmup = render(<ModList {...listProps(rows.slice(0, 100))} />)
      warmup.unmount()
      const initialRender = sample(() => {
        const view = render(<ModList {...listProps(rows)} />)
        view.unmount()
      })

      // Scroll: rerender the same mounted list at alternating offsets. jsdom has no layout, so the
      // guard drives the same scroll event the browser fires and checks which rows commit.
      const view = render(<ModList {...listProps(rows)} />)
      const listbox = screen.getByRole('listbox', { name: 'Mods' })
      const atTop = mountedIds()
      let toBottom = true
      const scroll = sample(() => {
        fireEvent.scroll(listbox, { target: { scrollTop: toBottom ? bottom : 0 } })
        toBottom = !toBottom
      })
      fireEvent.scroll(listbox, { target: { scrollTop: bottom } })
      const atBottom = mountedIds()
      view.unmount()

      // Reorder: move row 0 to index 100, commit, and move the target back so each sample works.
      const reorderView = render(<ModList {...listProps(rows)} />)
      const target = Math.min(100, rows.length - 1)
      let flipped = false
      const reorder = sample(() => {
        const ordered = flipped ? moveRow(rows, target, 0) : moveRow(rows, 0, target)
        flipped = !flipped
        reorderView.rerender(<ModList {...listProps(ordered)} />)
      })
      const ordered = moveRow(rows, 0, target)
      expect(ordered).toHaveLength(rows.length)
      expect(ordered[target].id).toBe(rows[0].id)
      reorderView.unmount()

      // Structural contract: bounded DOM, window followed the scroll, first row unmounted at the end.
      expect(atTop.length).toBeLessThanOrEqual(MAX_MOUNTED_ROWS)
      expect(atBottom.length).toBeLessThanOrEqual(MAX_MOUNTED_ROWS)
      expect(atTop[0]).toBe(rows[0].id)
      expect(atTop).not.toContain(lastId)
      expect(atBottom).toContain(lastId)
      expect(atBottom).not.toContain(rows[0].id)

      results.push({
        rows: count,
        buildMs: build.medianMs,
        initialRender,
        scroll,
        reorder,
        mountedAtTop: atTop.length,
        mountedAtBottom: atBottom.length,
      })

      cleanup()
    })
  }
})
