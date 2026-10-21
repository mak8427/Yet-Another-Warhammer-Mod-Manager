/**
 * Virtualization contract shared by the render guard and the windowed list.
 * ADR-004: tests assert which rows are mounted for a scroll model, not jsdom scroll pixels.
 */
export const ROW_HEIGHT = 28
export const DEFAULT_VIEWPORT_HEIGHT = 560
export const OVERSCAN = 8

export interface WindowRange {
  start: number
  end: number
  mounted: number
}

export function windowRange(
  count: number,
  scrollTop: number,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
): WindowRange {
  const visible = Math.ceil(viewportHeight / ROW_HEIGHT)
  const first = Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT)
  const start = Math.max(0, Math.min(count, first - OVERSCAN))
  const end = Math.max(start, Math.min(count, start + visible + OVERSCAN * 2))
  return { start, end, mounted: end - start }
}
