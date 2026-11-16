import { describe, expect, test } from 'vitest'
import { equationsEquivalent, exprEquivalent } from '../../../src/maths/equivalence'
import { parseMath, type Parsed } from '../../../src/maths/safe'

const P = (s: string): Parsed => {
  const r = parseMath(s)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const E = (s: string) => {
  const p = P(s)
  if (p.kind !== 'expr') throw new Error('not expr')
  return p.node
}

describe('exprEquivalent', () => {
  test('equal forms', () => {
    expect(exprEquivalent(E('2(x+1)'), E('2x+2')).verdict).toBe('equal')
    expect(exprEquivalent(E('(x-1)(x-3)'), E('x^2-4x+3')).verdict).toBe('equal')
  })
  test('different with evidence', () => {
    const v = exprEquivalent(E('x^2-4x+3'), E('(x-1)(x+3)'))
    expect(v.verdict).toBe('different')
    expect(v.evidence).toBeDefined()
    expect(Math.abs(v.evidence!.left - v.evidence!.right)).toBeGreaterThan(1e-6)
  })
  test('sqrt(x^2) vs x', () => {
    const v = exprEquivalent(E('sqrt(x^2)'), E('x'))
    expect(v.verdict).toBe('different')
    expect(v.evidence!.at.x).toBeLessThan(0)
  })
  test('unknown on too few valid points', () => {
    expect(exprEquivalent(E('sqrt(-x^2-1)'), E('0')).verdict).toBe('unknown')
  })
  test('deterministic', () => {
    const a = exprEquivalent(E('x^2'), E('x^2+x'), { seed: 3 })
    const b = exprEquivalent(E('x^2'), E('x^2+x'), { seed: 3 })
    expect(a).toEqual(b)
  })
  test('constants', () => {
    expect(exprEquivalent(E('3/4'), E('0.75')).verdict).toBe('equal')
    expect(exprEquivalent(E('3/4'), E('0.8')).verdict).toBe('different')
  })
})

describe('equationsEquivalent', () => {
  test('single variable root sets', () => {
    expect(equationsEquivalent(P('2x+4=10'), P('2x=6')).verdict).toBe('equal')
    expect(equationsEquivalent(P('2x=6'), P('x=3')).verdict).toBe('equal')
    expect(equationsEquivalent(P('x^2=4'), P('x=2')).verdict).toBe('different')
  })
  test('multi variable proportional', () => {
    expect(equationsEquivalent(P('y=x^2-4x+3'), P('y=(x-1)(x-3)')).verdict).toBe('equal')
    expect(equationsEquivalent(P('y=x^2-4x+3'), P('y=(x-1)(x+3)')).verdict).toBe('different')
    expect(equationsEquivalent(P('2y=2x'), P('y=x')).verdict).toBe('equal')
  })
  test('non-equations are unknown', () => {
    expect(equationsEquivalent(P('x+1'), P('x=3')).verdict).toBe('unknown')
  })
})
