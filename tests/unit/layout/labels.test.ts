import { describe, expect, test } from 'vitest'
import { placeLabel } from '../../../src/layout/labels'
import type { Box } from '../../../src/layout/types'
import { inside, intersects } from './fake'

const BOUNDS: Box = { x: 0, y: 0, w: 1200, h: 750 }
const size = { w: 40, h: 20 }

describe('placeLabel', () => {
  test('placeLabel avoids taken boxes; falls back to the first in-bounds position', () => {
    const anchor: [number, number] = [100, 100]
    const e = placeLabel(anchor, size, [], BOUNDS)
    expect(e.x).toBeGreaterThan(100)
    expect(e.y + e.h / 2).toBe(100)

    // something sits right of the anchor (not where NE goes) → NE
    const token: Box = { x: 110, y: 96, w: 30, h: 8 }
    const ne = placeLabel(anchor, size, [token], BOUNDS)
    expect(intersects(ne, token)).toBe(false)
    expect(ne.x).toBeGreaterThan(100)
    expect(ne.y + ne.h).toBeLessThan(100)

    // block everything around the anchor → first in-bounds candidate (E)
    const wall: Box = { x: 0, y: 0, w: 300, h: 300 }
    expect(placeLabel(anchor, size, [wall], BOUNDS)).toEqual(e)

    // at the right edge E, NE and N stick out of bounds → NW is next
    const edge = placeLabel([1195, 100], size, [], BOUNDS)
    expect(inside(edge, BOUNDS)).toBe(true)
    expect(edge.x + edge.w).toBeLessThan(1195)
    expect(edge.y + edge.h).toBeLessThan(100)
  })

  test('tries E, NE, N, NW, W, SW, S, SE in that order', () => {
    const anchor: [number, number] = [500, 400]
    const taken: Box[] = []
    const order: Box[] = []
    for (let i = 0; i < 8; i++) {
      const b = placeLabel(anchor, size, taken, BOUNDS)
      expect(taken.some((t) => intersects(t, b))).toBe(false)
      order.push(b)
      // block this candidate with a 2×2 token at its centre (neighbouring candidates may overlap)
      taken.push({ x: b.x + b.w / 2 - 1, y: b.y + b.h / 2 - 1, w: 2, h: 2 })
    }
    const cx = (b: Box) => b.x + b.w / 2 - 500
    const cy = (b: Box) => b.y + b.h / 2 - 400
    const dirs = order.map((b) => `${Math.sign(Math.round(cx(b)))},${Math.sign(Math.round(cy(b)))}`)
    expect(dirs).toEqual(['1,0', '1,-1', '0,-1', '-1,-1', '-1,0', '-1,1', '0,1', '1,1'])
  })

  test('nothing in bounds → clamped inside bounds', () => {
    const b = placeLabel([5, 5], { w: 2000, h: 20 }, [], BOUNDS)
    expect(inside(b, BOUNDS)).toBe(true)
  })
})
