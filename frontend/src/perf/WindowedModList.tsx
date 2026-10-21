import type { PerfModRow } from './modRows'
import { DEFAULT_VIEWPORT_HEIGHT, ROW_HEIGHT, windowRange } from './virtualWindow'

/**
 * A minimal windowed list that encodes the virtualization contract from ADR-004:
 * for a given scroll offset only one screenful (+ overscan) of rows is mounted.
 *
 * This is the guard skeleton, not the M2 mod list. When WAR-5 lands the real list, swap the
 * component imported by `modList.perf.test.tsx`; keep `windowRange` and the DOM contract
 * (`role="list"`, `data-row-index`) so the guard keeps asserting the same thing.
 */
export function WindowedModList({
  rows,
  scrollTop = 0,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
}: {
  rows: readonly PerfModRow[]
  scrollTop?: number
  viewportHeight?: number
}) {
  const { start, end } = windowRange(rows.length, scrollTop, viewportHeight)

  return (
    <div
      data-testid="mod-list"
      role="list"
      style={{ height: `${viewportHeight}px`, overflow: 'hidden', position: 'relative' }}
    >
      <div style={{ height: `${rows.length * ROW_HEIGHT}px`, position: 'relative' }}>
        <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
          {rows.slice(start, end).map((row, offset) => {
            const index = start + offset
            return (
              <div
                key={row.id}
                data-testid="mod-row"
                data-row-index={index}
                role="listitem"
                aria-posinset={index + 1}
                aria-setsize={rows.length}
                style={{ height: `${ROW_HEIGHT}px`, display: 'flex', gap: '8px' }}
              >
                <span>{row.enabled ? 'on' : 'off'}</span>
                <span>{row.name}</span>
                <span>{row.author}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
