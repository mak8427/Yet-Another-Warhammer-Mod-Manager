import { describe, expect, it } from 'vitest'
import { virtualRange } from './virtual'

describe('virtualRange', () => {
  it('mounts only the viewport plus overscan', () => {
    const range = virtualRange(500, 32, 320, 0, 4)
    expect(range.start).toBe(0)
    expect(range.end).toBeLessThanOrEqual(10 + 8)
    expect(range.topPadding).toBe(0)
    expect(range.bottomPadding).toBe((500 - range.end) * 32)
  })

  it('moves the window as the user scrolls', () => {
    const range = virtualRange(500, 32, 320, 32 * 100, 4)
    expect(range.start).toBe(96)
    expect(range.end).toBeGreaterThan(100)
    expect(range.end).toBeLessThanOrEqual(104 + 10 + 8)
    expect(range.topPadding).toBe(96 * 32)
  })

  it('clamps at the end and handles an empty list', () => {
    const range = virtualRange(3, 30, 300, 0)
    expect(range).toMatchObject({ start: 0, end: 3, topPadding: 0, bottomPadding: 0 })
    expect(virtualRange(0, 30, 300, 0)).toMatchObject({ start: 0, end: 0 })
  })
})
