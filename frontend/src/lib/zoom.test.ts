import { describe, expect, it } from 'vitest'
import {
  clampZoom,
  stepZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  zoomLabel,
  zoomScale,
} from './zoom'

describe('zoom levels', () => {
  it('clamps to the supported 80–200 percent range', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN)
    expect(clampZoom(79)).toBe(ZOOM_MIN)
    expect(clampZoom(80)).toBe(80)
    expect(clampZoom(137.4)).toBe(137)
    expect(clampZoom(200)).toBe(200)
    expect(clampZoom(201)).toBe(ZOOM_MAX)
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT)
  })

  it('moves in 10 percent steps and stops at the bounds', () => {
    expect(ZOOM_STEP).toBe(10)
    expect(stepZoom(100, 1)).toBe(110)
    expect(stepZoom(100, -1)).toBe(90)
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(stepZoom(137, 1)).toBe(150)
    expect(stepZoom(137, -1)).toBe(130)
  })

  it('converts a percentage to the webview scale factor', () => {
    expect(zoomScale(80)).toBeCloseTo(0.8)
    expect(zoomScale(125)).toBeCloseTo(1.25)
    expect(zoomScale(500)).toBeCloseTo(2)
    expect(zoomLabel(110)).toBe('110%')
  })
})
