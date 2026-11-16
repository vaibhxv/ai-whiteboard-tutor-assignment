import { describe, expect, test } from 'vitest'
import { compile, normalizeInput, parseMath } from '../../../src/maths/safe'

describe('parseMath', () => {
  test.each(['import("fs")', 'evaluate("1")', 'x.constructor', 'f(x)=x', 'createUnit("x")', '[1,2]', '"str"', 'x ? 1 : 2', '=3', 'a:=1', 'foo(2)', 'abc', 'x!', '5 % 2'])(
    'rejects %s',
    (s) => expect(parseMath(s).ok).toBe(false),
  )
  test('accepts implicit multiplication and allowed functions', () => {
    ;['2x', '2(x+1)', '(x-1)(x-3)', 'x(x+1)', 'sqrt(x)+abs(x)', 'sin(x)^2', 'pi*r^2', 'log(x)', 'log10(x)', 'e^x', '-x'].forEach((s) =>
      expect(parseMath(s).ok, s).toBe(true),
    )
  })
  test('collects variables, excluding e and pi', () => {
    const r = parseMath('pi*r^2 + e*x')
    expect(r.ok && r.value.vars).toEqual(['r', 'x'])
  })
  test('splits equations and chains', () => {
    const r = parseMath('2^2-4*2+3 = 4-8+3 = -1')
    expect(r.ok && r.value.kind === 'equation' && r.value.sides.length).toBe(3)
    const q = parseMath('x = 3')
    expect(q.ok && q.value.kind).toBe('equation')
  })
  test('rejects over 200 chars', () => {
    expect(parseMath('x+'.repeat(100) + '1').ok).toBe(false)
    expect(parseMath('x+1+'.repeat(40) + '1').ok).toBe(true)
  })
  test('rejects over 200 nodes within the char cap', () => {
    const s = '2x+'.repeat(65) + '2x'
    expect(s.length).toBeLessThanOrEqual(200)
    expect(parseMath(s).ok).toBe(false)
  })
  test('nested implicit calls', () => {
    const run = (s: string, x: number) => {
      const r = parseMath(s)
      if (!r.ok || r.value.kind !== 'expr') throw new Error(s)
      return compile(r.value.node)({ x })
    }
    expect(run('x(x(x+1))', 2)).toBe(12)
    expect(run('x(2x(x+1))', 2)).toBe(24)
  })
  test('accepts a dense expression just under the node cap', () => {
    expect(parseMath(Array.from({ length: 100 }, () => '1').join('+')).ok).toBe(true)
  })
})

describe('compile', () => {
  const run = (s: string, scope: Record<string, number> = {}) => {
    const r = parseMath(s)
    if (!r.ok || r.value.kind !== 'expr') throw new Error('bad')
    return compile(r.value.node)(scope)
  }
  test('evaluates', () => {
    expect(run('2x+1', { x: 3 })).toBe(7)
    expect(run('pi')).toBeCloseTo(Math.PI)
    expect(run('e')).toBeCloseTo(Math.E)
    expect(run('x(x+1)', { x: 2 })).toBe(6)
  })
  test('NaN for sqrt(-1), 1/0 and missing variables', () => {
    expect(run('sqrt(-1)')).toBeNaN()
    expect(run('1/0')).toBeNaN()
    expect(run('x+1')).toBeNaN()
    expect(run('i', { i: 2 })).toBe(2)
  })
})

describe('normalizeInput', () => {
  test('maps unicode and trims', () => {
    expect(normalizeInput('−3×x² =')).toBe('-3*x^2')
    expect(normalizeInput('  ln(x)   ÷ 2 · 3³ ')).toBe('log(x) / 2 * 3^3')
  })
})
