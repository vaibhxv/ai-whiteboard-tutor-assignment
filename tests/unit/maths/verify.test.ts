import { describe, expect, test } from 'vitest'
import type { Action } from '../../../src/actions'
import { verifyAction, type VerifyContext } from '../../../src/maths/verify'

const idx = (...as: Action[]): VerifyContext => ({
  index: new Map(as.map((a) => [(a as { id?: string }).id ?? '', a])),
})
const math = (id: string, expr?: string): Action => ({ t: 'math', id, latex: 'x', ...(expr ? { expr } : {}) })
const step = (expr: string, from?: string): Action => ({ t: 'step', id: 's2', latex: 'x', expr, why: 'because', ...(from ? { from } : {}) })
const empty: VerifyContext = { index: new Map() }

describe('step', () => {
  test('expression to expression: pass when equivalent, fail with evidence when not', () => {
    const ctx = idx(math('m1', 'x^2-4x+3'))
    expect(verifyAction(step('(x-1)(x-3)', 'm1'), ctx).status).toBe('pass')
    const bad = verifyAction(step('(x-1)(x+3)', 'm1'), ctx)
    expect(bad.status).toBe('fail')
    expect(bad.evidence).toMatch(/at x = /)
  })
  test('defaults "from" to ctx.lastMathId; unchecked when neither', () => {
    const ctx = { ...idx(math('m1', 'x^2-4x+3')), lastMathId: 'm1' }
    expect(verifyAction(step('(x-1)(x-3)'), ctx).status).toBe('pass')
    expect(verifyAction(step('x+1'), ctx).status).toBe('fail')
    expect(verifyAction(step('x+1'), empty).status).toBe('unchecked')
    expect(verifyAction(step('x+1', 'm1'), idx(math('m1'))).status).toBe('unchecked')
  })
  test('equation to equation uses equationsEquivalent', () => {
    const ctx = idx(math('m1', '2x+3=7'))
    expect(verifyAction(step('x=2', 'm1'), ctx).status).toBe('pass')
    expect(verifyAction(step('x=3', 'm1'), ctx).status).toBe('fail')
    expect(verifyAction(step('x+1', 'm1'), ctx).status).toBe('unchecked')
  })
})

describe('math', () => {
  test('chain: all parts must agree', () => {
    const r = verifyAction(math('m', '2^2-4*2+3 = 4-8+3 = -2'), empty)
    expect(r.status).toBe('fail')
    expect(r.evidence).toContain('−2')
    expect(verifyAction(math('m', '2^2-4*2+3 = 4-8+3 = -1'), empty).status).toBe('pass')
  })
  test('identity passes, equation to solve and no expr are unchecked', () => {
    expect(verifyAction(math('m', 'x^2-4x+3=(x-1)(x-3)'), empty).status).toBe('pass')
    expect(verifyAction(math('m', '2x+3=7'), empty).status).toBe('unchecked')
    expect(verifyAction(math('m', 'y=x^2-4x+3'), empty).status).toBe('unchecked')
    expect(verifyAction(math('m'), empty).status).toBe('unchecked')
  })
  test('both sides constant', () => {
    expect(verifyAction(math('m', '3+4=8'), empty).status).toBe('fail')
    expect(verifyAction(math('m', '3+4=7'), empty).status).toBe('pass')
  })
})

describe('solutions', () => {
  const ctx = idx(math('m1', 'x^2-4x+3=0'))
  const sol = (values: number[]): Action => ({ t: 'solutions', id: 'sol', of: 'm1', var: 'x', values, latex: 'x' })
  test('correct set passes; missing root and wrong value fail', () => {
    expect(verifyAction(sol([1, 3]), ctx).status).toBe('pass')
    const miss = verifyAction(sol([1]), ctx)
    expect(miss.status).toBe('fail')
    expect(miss.evidence).toContain('missed a solution: x = 3')
    const wrong = verifyAction(sol([1, 2]), ctx)
    expect(wrong.status).toBe('fail')
    expect(wrong.evidence).toContain('x = 2')
  })
  test('unknown reference is unchecked', () => {
    expect(verifyAction(sol([1]), empty).status).toBe('unchecked')
  })
})

describe('point', () => {
  const plot: Action = { t: 'plot', id: 'p', x: [-1, 5], y: [-3, 5], fns: [{ id: 'f', expr: 'x^2-4x+3' }] }
  const ctx = idx(plot)
  const pt = (at: [number, number], on?: string): Action => ({ t: 'point', id: 'pt', plot: 'p', at, ...(on ? { on } : {}) })
  test('with on', () => {
    expect(verifyAction(pt([2, -1], 'f'), ctx).status).toBe('pass')
    const bad = verifyAction(pt([2, 1], 'f'), ctx)
    expect(bad.status).toBe('fail')
    expect(bad.evidence).toContain('−1')
  })
  test('without on: pass if on any fn, else unchecked', () => {
    expect(verifyAction(pt([2, -1]), ctx).status).toBe('pass')
    expect(verifyAction(pt([2, 4]), ctx).status).toBe('unchecked')
    expect(verifyAction(pt([2, -1]), empty).status).toBe('unchecked')
  })
})

describe('table', () => {
  const tbl = (rows: string[][]): Action => ({ t: 'table', id: 't', head: ['x', 'y'], rows, fn: 'x^2' })
  test('wrong cell fails naming the row; no fn is unchecked', () => {
    expect(verifyAction(tbl([['1', '1'], ['2', '4']]), empty).status).toBe('pass')
    const bad = verifyAction(tbl([['1', '1'], ['2', '5']]), empty)
    expect(bad.status).toBe('fail')
    expect(bad.evidence).toContain('row 2')
    expect(verifyAction({ t: 'table', id: 't', head: ['x'], rows: [] }, empty).status).toBe('unchecked')
  })
})

describe('check', () => {
  const base = { t: 'check' as const, id: 'c', prompt: 'p', explain: 'e', hint: 'h' }
  test('choice: exactly one correct, distinct non-empty misconceptions', () => {
    const o = (id: string, correct: boolean, misconception?: string) => ({ id, text: id, correct, ...(misconception ? { misconception } : {}) })
    const ok: Action = { ...base, kind: 'choice', options: [o('a', true), o('b', false, 'm1'), o('c', false, 'm2')] }
    expect(verifyAction(ok, empty).status).toBe('pass')
    expect(verifyAction({ ...ok, options: [o('a', true), o('b', true), o('c', false, 'm')] } as Action, empty).status).toBe('fail')
    expect(verifyAction({ ...ok, options: [o('a', true), o('b', false, 'same'), o('c', false, 'same')] } as Action, empty).status).toBe('fail')
    expect(verifyAction({ ...ok, options: [o('a', true), o('b', false)] } as Action, empty).status).toBe('fail')
    const v = (id: string, correct: boolean, value: string) => ({ ...o(id, correct, correct ? undefined : 'm' + id), value })
    expect(verifyAction({ ...ok, options: [v('a', true, '2'), v('b', false, '3')] } as Action, empty).status).toBe('pass')
    expect(verifyAction({ ...ok, options: [v('a', true, '2'), v('b', false, '4/2')] } as Action, empty).status).toBe('fail')
  })
  test('number: answer parses; anticipated equal to answer fails', () => {
    const n = (answer: string, anticipated?: { value: string; misconception: string }[]): Action => ({ ...base, kind: 'number', answer, ...(anticipated ? { anticipated } : {}) })
    expect(verifyAction(n('3'), empty).status).toBe('pass')
    expect(verifyAction(n('x+'), empty).status).toBe('fail')
    expect(verifyAction(n('3', [{ value: '6/2', misconception: 'm' }]), empty).status).toBe('fail')
    expect(verifyAction(n('3', [{ value: '4', misconception: 'm' }]), empty).status).toBe('pass')
  })
  test('expr: answer parses; anticipated equivalent fails', () => {
    const e = (answer: string, anticipated?: { value: string; misconception: string }[]): Action => ({ ...base, kind: 'expr', answer, variable: 'x', ...(anticipated ? { anticipated } : {}) })
    expect(verifyAction(e('2x+2'), empty).status).toBe('pass')
    expect(verifyAction(e('2x+('), empty).status).toBe('fail')
    expect(verifyAction(e('2x+2', [{ value: '2(x+1)', misconception: 'm' }]), empty).status).toBe('fail')
    expect(verifyAction(e('2x+2', [{ value: '2x+1', misconception: 'm' }]), empty).status).toBe('pass')
  })
  test('tap: answer inside figure', () => {
    const plot: Action = { t: 'plot', id: 'p', x: [-1, 5], y: [-3, 5], fns: [{ id: 'f', expr: 'x' }] }
    const pt: Action = { t: 'point', id: 'v', plot: 'p', at: [1, 1] }
    const ctx = idx(plot, pt)
    const tap = (answer: string): Action => ({ ...base, kind: 'tap', figure: 'p', answer })
    expect(verifyAction(tap('v'), ctx).status).toBe('pass')
    expect(verifyAction(tap('f'), ctx).status).toBe('pass')
    expect(verifyAction(tap('zzz'), ctx).status).toBe('fail')
    expect(verifyAction(tap('v'), empty).status).toBe('unchecked')
  })
  test('set: target within param range', () => {
    const ex: Action = { t: 'explore', id: 'ex', x: [-5, 5], y: [-5, 5], expr: 'a*x', prompt: 'p', params: [{ name: 'a', min: 0, start: 1, max: 4 }] }
    const set = (target: [number, number], param = 'a'): Action => ({ ...base, kind: 'set', explore: 'ex', param, target })
    expect(verifyAction(set([2, 3]), idx(ex)).status).toBe('pass')
    expect(verifyAction(set([3, 6]), idx(ex)).status).toBe('fail')
    expect(verifyAction(set([2, 3], 'b'), idx(ex)).status).toBe('fail')
    expect(verifyAction(set([2, 3]), empty).status).toBe('unchecked')
  })
})

describe('explore', () => {
  const ex = (expr: string, name = 'a'): Action => ({ t: 'explore', id: 'ex', x: [-5, 5], y: [-5, 5], expr, prompt: 'p', params: [{ name, min: 0, start: 1, max: 4 }] })
  test('only x and declared params', () => {
    expect(verifyAction(ex('a*x^2'), empty).status).toBe('pass')
    expect(verifyAction(ex('b*x'), empty).status).toBe('fail')
    expect(verifyAction(ex('a*x+'), empty).status).toBe('fail')
    const long = verifyAction(ex('x', 'slope'), empty)
    expect(long.status).toBe('fail')
    expect(long.evidence).toContain('slope')
  })
})

test('prose and layout actions are unchecked without evidence', () => {
  const acts: Action[] = [
    { t: 'write', id: 'w', text: 'hi' }, { t: 'say', text: 'hi' }, { t: 'mark', kind: 'circle', target: 'w' },
    { t: 'ask', id: 'a', text: 'q' }, { t: 'page' },
  ]
  for (const a of acts) expect(verifyAction(a, empty)).toEqual({ status: 'unchecked' })
})
