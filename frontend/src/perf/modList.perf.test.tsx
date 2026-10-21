import { writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { cleanup, render } from '@testing-library/react'
import { afterAll, describe, expect, it } from 'vitest'
import { makeModRows, moveRow } from './modRows'
import { WindowedModList } from './WindowedModList'
import { DEFAULT_VIEWPORT_HEIGHT, OVERSCAN, ROW_HEIGHT, windowRange } from './virtualWindow'

/**
 * Frontend render guard (WAR-7 deliverable 3, skeleton).
 *
 * What it measures: initial window render, scroll rerender, and reorder commit on the 5k and 20k
 * row workloads. What it does **not** do: assert wall-clock thresholds. jsdom timings are an upper
 * bound and are reported, not gated; the real scroll/paint trace is a manual Chrome run documented
 * in `docs/PERF.md`.
 *
 * The hard assertions are structural: a windowed list must keep the mounted DOM row count bounded
 * regardless of dataset size. Timing samples are only printed and (optionally) written as JSON.
 */
const WORKLOADS = [5_000, 20_000] as const
const MAX_MOUNTED_ROWS = 64 // 20 visible rows + 2 * 8 overscan = 36; 64 catches "forgot to virtualize".
const SAMPLES = 7

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

function mountedRows(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="mod-row"]')].map((row) =>
    Number(row.dataset.rowIndex),
  )
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
    schema: 'wh3mm.perf.frontend-guard.v1',
    kind: 'jsdom-upper-bound',
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
      overscan: OVERSCAN,
      viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
      maxMountedRows: MAX_MOUNTED_ROWS,
    },
    timingGate: false,
    note: 'jsdom render cost, not paint or scroll latency; no wall-clock threshold is asserted.',
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
  it('windows a small list without dropping rows', () => {
    expect(windowRange(10, 0).mounted).toBe(10)
    expect(windowRange(0, 0)).toEqual({ start: 0, end: 0, mounted: 0 })
  })

  for (const count of WORKLOADS) {
    it(`keeps 5k/20k-scale DOM bounded and reports timings (${count} rows)`, () => {
      let rows = makeModRows(0)
      const build = sample(() => {
        rows = makeModRows(count)
      })
      expect(rows).toHaveLength(count)

      const bottom = Math.max(0, rows.length - 1) * ROW_HEIGHT
      const lastIndex = rows.length - 1

      // Initial render: mount, measure, unmount. A throwaway render warms the JSX path.
      const warmup = render(<WindowedModList rows={rows.slice(0, 100)} />)
      warmup.unmount()
      const initialRender = sample(() => {
        const view = render(<WindowedModList rows={rows} />)
        view.unmount()
      })

      // Scroll: rerender the same mounted list at alternating offsets.
      const view = render(<WindowedModList rows={rows} scrollTop={0} />)
      const atTop = mountedRows(view.container)
      let toBottom = true
      const scroll = sample(() => {
        view.rerender(<WindowedModList rows={rows} scrollTop={toBottom ? bottom : 0} />)
        toBottom = !toBottom
      })
      view.rerender(<WindowedModList rows={rows} scrollTop={bottom} />)
      const atBottom = mountedRows(view.container)
      view.unmount()

      // Reorder: move row 0 to index 100, commit, and move it back so each sample does real work.
      const reorderView = render(<WindowedModList rows={rows} />)
      const target = Math.min(100, rows.length - 1)
      let flipped = false
      const reorder = sample(() => {
        const ordered = flipped ? moveRow(rows, target, 0) : moveRow(rows, 0, target)
        flipped = !flipped
        reorderView.rerender(<WindowedModList rows={ordered} />)
      })
      const ordered = moveRow(rows, 0, target)
      expect(ordered).toHaveLength(rows.length)
      expect(ordered[target].id).toBe(rows[0].id)
      reorderView.unmount()

      // Structural contract: bounded DOM, and the window really moved to the end of the list.
      expect(atTop.length).toBeLessThanOrEqual(MAX_MOUNTED_ROWS)
      expect(atBottom.length).toBeLessThanOrEqual(MAX_MOUNTED_ROWS)
      expect(atTop[0]).toBe(0)
      expect(atTop).not.toContain(lastIndex)
      expect(atBottom).toContain(lastIndex)
      expect(atBottom).not.toContain(0)

      results.push({
        rows: count,
        buildMs: build.medianMs,
        initialRender,
        scroll,
        reorder,
        mountedAtTop: atTop.length,
        mountedAtBottom: atBottom.length,
      })

      // Keep the global suite fast even though we just built 20k rows.
      cleanup()
    })
  }
})
