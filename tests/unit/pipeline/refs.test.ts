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
  test('mark on a curve (fn id) of an existing plot is accepted; an unknown id is not', () => {
    expect(checkRefs({ t: 'mark', kind: 'circle', target: 'f1' }, idx(plot), none)).toEqual({ ok: true })
    expect(checkRefs({ t: 'mark', kind: 'circle', target: 'f9' }, idx(plot), none)).toEqual({ ok: false, reason: 'unknown target f9' })
    expect(checkRefs({ t: 'mark', kind: 'circle', target: 'f1' }, idx(), none).ok).toBe(false)
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
  test('tap figure must be plot/explore; answer must be on figure', () => {
    const base = { t: 'check', id: 'c', prompt: 'p', explain: 'e', hint: 'h', kind: 'tap' } as const
    const plot2: Action = { t: 'plot', id: 'p2', x: [0, 1], y: [0, 1], fns: [{ id: 'g1', expr: 'x' }] }
    const pt1: Action = { t: 'point', id: 'pt1', plot: 'p1', at: [0, 0] }
    const pt2: Action = { t: 'point', id: 'pt2', plot: 'p2', at: [0, 0] }
    const i = idx(plot, plot2, math, pt1, pt2)
    expect(checkRefs({ ...base, figure: 'm1', answer: 'm1' }, i, none)).toEqual({ ok: false, reason: 'tap figure m1 is not a plot' })
    expect(checkRefs({ ...base, figure: 'p1', answer: 'm1' }, i, none)).toEqual({ ok: false, reason: 'tap answer m1 is not on figure p1' })
    expect(checkRefs({ ...base, figure: 'p1', answer: 'pt2' }, i, none).ok).toBe(false)
    expect(checkRefs({ ...base, figure: 'p1', answer: 'g1' }, i, none).ok).toBe(false)
    expect(checkRefs({ ...base, figure: 'p1', answer: 'pt1' }, i, none).ok).toBe(true)
    expect(checkRefs({ ...base, figure: 'p1', answer: 'f1' }, i, none).ok).toBe(true)
  })
  test('plot fn ids join the duplicate-id check', () => {
    const mk = (...ids: string[]): Action => ({ t: 'plot', id: 'pz', x: [0, 1], y: [0, 1], fns: ids.map((id) => ({ id, expr: 'x' })) })
    expect(checkRefs(mk('m1'), idx(math), none)).toEqual({ ok: false, reason: 'duplicate id m1' })
    expect(checkRefs(mk('a', 'a'), idx(), none).ok).toBe(false)
    expect(checkRefs(mk('f1'), idx(plot), none).ok).toBe(false)
    expect(checkRefs(mk('a'), idx(), new Set(['a'])).ok).toBe(false)
    expect(checkRefs(mk('pz'), idx(), none).ok).toBe(false)
    expect(checkRefs({ t: 'math', id: 'f1', latex: 'x' }, idx(plot), none).ok).toBe(false)
    expect(checkRefs(mk('a', 'b'), idx(), none).ok).toBe(true)
  })
})
