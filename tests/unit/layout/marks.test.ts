import { describe, expect, test } from 'vitest'
import { markGeometry } from '../../../src/layout/marks'
import { plotTransform } from '../../../src/layout/plot-transform'
import type { Box } from '../../../src/layout/types'
import { inside } from './fake'

const BOUNDS: Box = { x: 0, y: 0, w: 1200, h: 750 }
const KINDS = ['circle', 'underline', 'arrow', 'box'] as const
const pt = (p: [number, number], b: Box) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h

describe('markGeometry', () => {
  test('circle pads by 10, box by 8, underline is a 6-px box under the target', () => {
    const t: Box = { x: 100, y: 100, w: 200, h: 40 }
    expect(markGeometry('circle', t, BOUNDS).shape).toEqual({ x: 90, y: 90, w: 220, h: 60 })
    expect(markGeometry('box', t, BOUNDS).shape).toEqual({ x: 92, y: 92, w: 216, h: 56 })
    const u = markGeometry('underline', t, BOUNDS).shape
    expect(u.h).toBe(6)
    expect(u.y).toBeGreaterThanOrEqual(140)
    expect(u.x).toBe(100)
    expect(u.w).toBe(200)
  })

  test('note anchor goes right of the shape when there is room, else below', () => {
    const left = markGeometry('circle', { x: 100, y: 100, w: 50, h: 50 }, BOUNDS)
    expect(left.noteAnchor[0]).toBeGreaterThan(left.shape.x + left.shape.w)
    const right = markGeometry('circle', { x: 1100, y: 100, w: 50, h: 50 }, BOUNDS)
    expect(right.noteAnchor[1]).toBeGreaterThan(right.shape.y + right.shape.h)
  })

  test('arrow touches the target edge and starts at the note', () => {
    const t: Box = { x: 100, y: 100, w: 50, h: 20 }
    const g = markGeometry('arrow', t, BOUNDS)
    expect(g.shape.x).toBeGreaterThanOrEqual(t.x + t.w)
    expect(g.shape.x - (t.x + t.w)).toBeLessThanOrEqual(8)
    expect(g.noteAnchor[0]).toBeGreaterThanOrEqual(g.shape.x + g.shape.w)
  })

  test('mark geometry stays inside bounds when target is at the board edge', () => {
    const edges: Box[] = [
      { x: 1180, y: 730, w: 20, h: 20 },
      { x: 0, y: 0, w: 30, h: 30 },
      { x: 1150, y: 0, w: 50, h: 750 },
      { x: 0, y: 740, w: 1200, h: 10 },
      { x: -50, y: -50, w: 1300, h: 900 },
    ]
    for (const t of edges)
      for (const k of KINDS) {
        const g = markGeometry(k, t, BOUNDS)
        expect(inside(g.shape, BOUNDS)).toBe(true)
        expect(pt(g.noteAnchor, BOUNDS)).toBe(true)
      }
  })
})

describe('plotTransform', () => {
  test('maps the range corners onto the inner box inset by 36', () => {
    const t = plotTransform({ x: 640, y: 40, w: 520, h: 670 }, [-1, 5], [-2, 6])
    expect(t.inner).toEqual({ x: 676, y: 76, w: 448, h: 598 })
    expect(t.toPx([-1, -2])).toEqual([676, 674])
    expect(t.toPx([5, 6])).toEqual([1124, 76])
    const [cx, cy] = t.toPx([2, 2])
    expect(cx).toBeCloseTo(900)
    expect(cy).toBeCloseTo(375)
  })
})
