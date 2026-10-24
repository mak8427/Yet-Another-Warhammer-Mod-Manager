/** Whole-interface webview zoom, in percent. Mirrors `wh3mm_core::ipc`. */
export const ZOOM_MIN = 80
export const ZOOM_MAX = 200
export const ZOOM_STEP = 10
export const ZOOM_DEFAULT = 100

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_DEFAULT
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)))
}

/** Moves one step from the nearest step boundary, so an old non-round value
 * still lands on the 10% grid. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const base = Math.round(clampZoom(current) / ZOOM_STEP) * ZOOM_STEP
  return clampZoom(base + direction * ZOOM_STEP)
}
