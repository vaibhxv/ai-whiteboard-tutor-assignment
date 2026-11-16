import { describe, expect, test } from 'vitest'
import type { Action } from '../../../src/actions'
import { checkRefs } from '../../../src/pipeline/refs'

const plot: Action = { t: 'plot', id: 'p1', x: [-1, 1], y: [-1, 1], fns: [{ id: 'f1', expr: 'x' }] }
const math: Action = { t: 'math', id: 'm1', latex: 'x' }
const idx = (...a: Action[]) => new Map(a.map((x) => [(x as { id: string }).id, x]))
const none = new Set<string>()

describe('checkRefs', () => {
  test('mark unknown target', () => {
    expect(checkRefs({ t: 'mark', kind: 'circle', target: 'q9' }, idx(), none)).toEqual({ ok: false, reason: 'unknown target q9' })
    expect(checkRefs({ t: 'mark', kind: 'circle', target: 'm1' }, idx(math), none)).toEqual({ ok: true })
    expect(checkRefs({ t: 'mark', kind: 'circle', target: 'm1' }, idx(), new Set(['m1']))).toEqual({ ok: true })
  })
  test('duplicate id across segments', () => {
    const r = checkRefs({ t: 'math', id: 'm1', latex: 'y' }, idx(math), none)
    expect(r.ok).toBe(false)
    expect(checkRefs({ t: 'math', id: 'z', latex: 'y' }, idx(), new Set(['z'])).ok).toBe(false)
  })
  test('point/line/guide plot and on', () => {
    expect(checkRefs({ t: 'point', id: 'a', plot: 'p1', at: [0, 0] }, idx(plot), none).ok).toBe(true)
    expect(checkRefs({ t: 'point', id: 'a', plot: 'nope', at: [0, 0] }, idx(plot), none).ok).toBe(false)
    expect(checkRefs({ t: 'point', id: 'a', plot: 'm1', at: [0, 0] }, idx(math), none).ok).toBe(false)
    expect(checkRefs({ t: 'point', id: 'a', plot: 'p1', at: [0, 0], on: 'f1' }, idx(plot), none).ok).toBe(true)
    expect(checkRefs({ t: 'point', id: 'a', plot: 'p1', at: [0, 0], on: 'f9' }, idx(plot), none).ok).toBe(false)
    expect(checkRefs({ t: 'line', id: 'l', plot: 'q', from: [0, 0], to: [1, 1] }, idx(plot), none).ok).toBe(false)
    expect(checkRefs({ t: 'guide', id: 'g', plot: 'p1', x: 0 }, idx(plot), none).ok).toBe(true)
  })
  test('step.from and solutions.of', () => {
    const step = (from: string): Action => ({ t: 'step', id: 's', latex: 'x', expr: 'x', why: 'w', from })
    expect(checkRefs(step('m1'), idx(math), none).ok).toBe(true)
    expect(checkRefs(step('m2'), idx(math), none)).toEqual({ ok: false, reason: 'unknown from m2' })
    expect(checkRefs({ t: 'solutions', id: 's', of: 'zz', var: 'x', values: [], latex: 'x' }, idx(math), none).ok).toBe(false)
  })
  test('check tap and set', () => {
    const base = { t: 'check', id: 'c', prompt: 'p', explain: 'e', hint: 'h' } as const
    const explore: Action = { t: 'explore', id: 'e1', x: [0, 1], y: [0, 1], expr: 'a*x', prompt: 'p', params: [{ name: 'a', min: 0, max: 2, start: 1 }] }
    expect(checkRefs({ ...base, kind: 'tap', figure: 'p1', answer: 'f1' }, idx(plot), none).ok).toBe(true)
    expect(checkRefs({ ...base, kind: 'tap', figure: 'zz', answer: 'f1' }, idx(plot), none).ok).toBe(false)
    expect(checkRefs({ ...base, kind: 'tap', figure: 'p1', answer: 'zz' }, idx(plot), none).ok).toBe(false)
    expect(checkRefs({ ...base, kind: 'set', explore: 'e1', param: 'a', target: [1, 2] }, idx(explore), none).ok).toBe(true)
    expect(checkRefs({ ...base, kind: 'set', explore: 'p1', param: 'a', target: [1, 2] }, idx(plot), none).ok).toBe(false)
  })
})
