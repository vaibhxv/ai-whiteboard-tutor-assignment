import { describe, expect, test } from 'vitest'
import { findRealRoots } from '../../../src/maths/roots'

describe('findRealRoots', () => {
  test('simple roots', () => {
    const r = findRealRoots((x) => x * x - 4 * x + 3)
    expect(r).toHaveLength(2)
    expect(r[0]).toBeCloseTo(1, 6)
    expect(r[1]).toBeCloseTo(3, 6)
  })
  test('double root', () => {
    const r = findRealRoots((x) => (x - 2) ** 2)
    expect(r).toHaveLength(1)
    expect(r[0]).toBeCloseTo(2, 5)
  })
  test('ignores poles', () => {
    expect(findRealRoots((x) => 1 / x)).toEqual([])
    expect(findRealRoots((x) => Math.tan(x)).every((r) => Math.abs(r / Math.PI - Math.round(r / Math.PI)) < 1e-6)).toBe(true)
  })
  test('root exactly on a grid point and range args', () => {
    expect(findRealRoots((x) => x)).toEqual([0])
    expect(findRealRoots((x) => x - 100, -5, 5)).toEqual([])
  })
  test('NaN regions are skipped', () => {
    const r = findRealRoots((x) => Math.sqrt(x) - 2)
    expect(r).toHaveLength(1)
    expect(r[0]).toBeCloseTo(4, 6)
  })
})
