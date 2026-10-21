export interface VirtualRange {
  start: number
  end: number
  topPadding: number
  bottomPadding: number
}

/**
 * Fixed-row windowing. The UI only mounts rows inside the viewport plus a small
 * overscan, independent of the DOM's real scroll behaviour, so the contract is
 * testable in jsdom.
 */
export function virtualRange(
  total: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan = 6,
): VirtualRange {
  const safeRow = Math.max(1, rowHeight)
  const safeViewport = Math.max(0, viewportHeight)
  const safeScroll = Math.max(0, scrollTop)
  const visible = Math.ceil(safeViewport / safeRow)
  const start = Math.max(0, Math.floor(safeScroll / safeRow) - overscan)
  const end = Math.min(total, start + visible + overscan * 2)
  return {
    start,
    end,
    topPadding: start * safeRow,
    bottomPadding: Math.max(0, (total - end) * safeRow),
  }
}
