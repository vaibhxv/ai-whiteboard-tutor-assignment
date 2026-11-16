import { describe, expect, test } from 'vitest'
import { compile, parseMath } from '../../../src/maths/safe'
import { samplePath } from '../../../src/board/plot/sample'

const fn = (src: string) => {
  const p = parseMath(src)
  if (!p.ok || p.value.kind !== 'expr') throw new Error('bad')
  const f = compile(p.value.node)
  return (x: number) => f({ x })
}
const toPx = ([x, y]: [number, number]): [number, number] => [x * 10, -y * 10]
const ms = (d: string) => d.split('M').length - 1

describe('samplePath', () => {
  test('1/x on [-5,5] has >=2 M commands and no segment spanning x=0', () => {
    const d = samplePath(fn('1/x'), [-5, 5], [-5, 5], toPx)
    expect(ms(d)).toBeGreaterThanOrEqual(2)
    expect(d).not.toMatch(/NaN|Infinity/)
    // every drawn point is on one side; no L may jump from negative x to positive x
    let prev: number | undefined
    for (const tok of d.match(/[ML][-\d.e]+[ ,][-\d.e]+/g) ?? []) {
      const isM = tok.startsWith('M')
      const x = Number(tok.slice(1).split(/[ ,]/)[0])
      if (!isM && prev !== undefined) expect(prev < 0 && x > 0).toBe(false)
      prev = x
    }
  })
  test('sqrt(x) on [-2,2] starts at x>=0; log(x) has no NaN; tan(x) on [-3,3] has 2 breaks', () => {
    const s = samplePath(fn('sqrt(x)'), [-2, 2], [-3, 3], toPx)
    expect(s).not.toMatch(/NaN/)
    expect(Number(s.slice(1).split(/[ ,]/)[0])).toBeGreaterThanOrEqual(0)
    expect(samplePath(fn('log(x)'), [-2, 4], [-3, 3], toPx)).not.toMatch(/NaN/)
    const t = samplePath(fn('tan(x)'), [-3, 3], [-4, 4], toPx)
    expect(ms(t)).toBe(3)
    expect(t).not.toMatch(/NaN/)
  })
  test('empty path when nothing is finite', () => {
    expect(samplePath(() => NaN, [0, 1], [0, 1], toPx)).toBe('')
  })
  test('a pole falling between samples never draws a spike taller than the y span', () => {
    const span = 20
    const check = (d: string) => {
      let prevY: number | undefined
      for (const tok of d.match(/[ML][-\d.]+ [-\d.]+/g) ?? []) {
        const y = Number(tok.slice(1).split(' ')[1])
        if (!tok.startsWith('M') && prevY !== undefined) expect(Math.abs(y - prevY)).toBeLessThanOrEqual(span * 10 + 0.5)
        prevY = y
      }
    }
    check(samplePath(fn('tan(x)'), [-10, 10], [-10, 10], toPx))
    for (const n of [97, 100, 333, 480]) check(samplePath(fn('1/(x-0.0137)'), [-5, 5], [-10, 10], toPx, n))
    expect(samplePath(fn('1/(x-0.0137)'), [-5, 5], [-10, 10], toPx, 100).split('M').length - 1).toBeGreaterThanOrEqual(2)
  })
})
